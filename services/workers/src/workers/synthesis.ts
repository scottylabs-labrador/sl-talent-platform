// SYNTHESIS worker — the post-call pipeline (the brief's step 3; ARCHITECTURE
// sections 4/6). load screen + transcript -> Synthesizer dossier draft ->
// refine/insert screen_moments (merged with the Rep's live-marked candidates) ->
// cut highlight clips (degrading gracefully when ffmpeg or the raw audio is
// absent) -> dossiers(draft) + coaching_reports(coach) -> screens.status='review'
// -> notify the student. Everything works in stub mode (runAgent stubs).

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker, type Job } from 'bullmq';
import {
  db,
  screens,
  screenMoments,
  dossiers,
  coachingReports,
  eq,
} from '@tartan/db';
import {
  runAgent,
  SYNTHESIZER_PROMPT,
  COACH_PROMPT,
} from '@tartan/agents';
import { DossierDraft, CoachingReport } from '@tartan/types';
import type { DossierCompetencies } from '@tartan/types';
import { QUEUE } from '../queues.js';
import { queues } from '../queues.js';
import { bullConnection } from '../redis.js';
import { QUEUE_PREFIX, DRY_RUN } from '../env.js';
import { log } from '../logger.js';
import { transcriptToText, inputRef } from '../util.js';
import { SynthesisJob, type NotificationJob } from '../jobs.js';
import { ffmpegAvailable, cutClip } from '../ffmpeg.js';
import {
  getObjectToFile,
  putFile,
  safeUnlink,
  rawKey,
  clipKey as clipKeyFor,
  s3Configured,
} from '../s3.js';

const SCOPE = 'synthesis';
const DEDUP_TOLERANCE_MS = 1500;

type MomentRow = typeof screenMoments.$inferSelect;

export async function processSynthesis(job: Job): Promise<void> {
  const { screenId } = SynthesisJob.parse(job.data);

  if (DRY_RUN) {
    log.info(SCOPE, 'dry-run: skipping synthesis', { screenId });
    return;
  }

  const [screen] = await db()
    .select()
    .from(screens)
    .where(eq(screens.id, screenId))
    .limit(1);
  if (!screen) {
    log.warn(SCOPE, 'screen not found', { screenId });
    return;
  }

  // Idempotency: if a dossier already exists we have already synthesized.
  const existingDossier = await db()
    .select({ id: dossiers.id })
    .from(dossiers)
    .where(eq(dossiers.screenId, screenId))
    .limit(1);
  if (existingDossier.length > 0) {
    log.info(SCOPE, 'dossier already exists, skipping', { screenId });
    return;
  }

  const transcriptText = transcriptToText(screen.transcript);

  // ── Synthesizer: dossier draft ─────────────────────────────────────────────
  const { output: draft } = await runAgent(
    'synthesizer',
    {
      system: SYNTHESIZER_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Screening transcript (speaker-tagged, from Cartesia):\n\n${
            transcriptText || '(no transcript captured)'
          }`,
        },
      ],
    },
    { schema: DossierDraft, inputRef: inputRef({ screenId }) },
  );

  // ── Merge moments: keep the Rep's live pins, add refined ones ──────────────
  const existing = await db()
    .select()
    .from(screenMoments)
    .where(eq(screenMoments.screenId, screenId));

  const isDuplicate = (m: DossierDraft['moments'][number]): boolean =>
    existing.some(
      (e) =>
        e.tag === m.tag &&
        Math.abs(e.tStartMs - m.tStartMs) <= DEDUP_TOLERANCE_MS,
    );

  const toInsert = draft.moments.filter((m) => !isDuplicate(m));
  const inserted: MomentRow[] =
    toInsert.length > 0
      ? await db()
          .insert(screenMoments)
          .values(
            toInsert.map((m) => ({
              screenId,
              tStartMs: m.tStartMs,
              tEndMs: m.tEndMs,
              tag: m.tag,
              quote: m.quote,
              repNote: m.repNote ?? null,
            })),
          )
          .returning()
      : [];

  const allMoments: MomentRow[] = [...existing, ...inserted];
  log.info(SCOPE, 'moments merged', {
    screenId,
    existing: existing.length,
    added: inserted.length,
  });

  // ── Anchor each competency to a moment by its timestamp ─────────────────────
  const competency: DossierCompetencies = draft.competency.map((c) => {
    if (c.momentId) return c;
    if (typeof c.timestampMs === 'number') {
      const ts = c.timestampMs;
      const m = allMoments.find((mm) => mm.tStartMs <= ts && ts <= mm.tEndMs);
      if (m) return { ...c, momentId: m.id };
    }
    return c;
  });

  // ── Cut clips (graceful degradation) ────────────────────────────────────────
  await cutClips(screenId, screen.audioKey, allMoments);

  // ── dossiers(draft) ─────────────────────────────────────────────────────────
  await db().insert(dossiers).values({
    screenId,
    status: 'draft',
    competency,
    flags: draft.flags,
    followups: draft.followups,
  });

  // ── coaching_reports (student-only) ─────────────────────────────────────────
  const { output: coaching } = await runAgent(
    'coach',
    {
      system: COACH_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Screening transcript (speaker-tagged):\n\n${
            transcriptText || '(no transcript captured)'
          }`,
        },
      ],
    },
    { schema: CoachingReport, inputRef: inputRef({ screenId }) },
  );
  await db().insert(coachingReports).values({
    screenId,
    body: coaching.body,
  });

  // ── screens.status = 'review' ───────────────────────────────────────────────
  await db()
    .update(screens)
    .set({ status: 'review' })
    .where(eq(screens.id, screenId));

  // ── notify the student ("Two things arrived") ──────────────────────────────
  const note: NotificationJob = {
    studentId: screen.studentId,
    kind: 'screen_ready',
    title: 'Two things arrived',
    body: 'Your dossier draft and a private coaching note are ready to review.',
  };
  await queues.notifications.add(note.kind, note);

  log.info(SCOPE, 'synthesis complete', { screenId });
}

/**
 * Cut a clip per moment into clips/{momentId}.mp3. Degrades to a raw-object
 * reference (t_start/t_end already persisted on the row) when ffmpeg is missing,
 * S3 is unconfigured, or the raw audio does not exist. Never throws upward.
 */
async function cutClips(
  screenId: string,
  audioKey: string | null,
  moments: MomentRow[],
): Promise<void> {
  const pending = moments.filter((m) => !m.clipKey);
  if (pending.length === 0) return;

  if (!s3Configured()) {
    log.warn(SCOPE, 'S3 not configured; referencing raw bounds only', { screenId });
    return;
  }
  const hasFfmpeg = await ffmpegAvailable();
  if (!hasFfmpeg) {
    log.warn(SCOPE, 'ffmpeg unavailable; referencing raw bounds only', {
      screenId,
      moments: pending.length,
    });
    return;
  }

  const srcKey = audioKey ?? rawKey(screenId);
  const rawPath = join(tmpdir(), `raw-${screenId}.ogg`);
  let haveRaw = false;
  try {
    await getObjectToFile(srcKey, rawPath);
    haveRaw = true;
  } catch (err) {
    log.warn(SCOPE, 'raw audio not available; referencing bounds only', {
      screenId,
      srcKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (haveRaw) {
    for (const m of pending) {
      const outPath = join(tmpdir(), `clip-${m.id}.mp3`);
      const dest = clipKeyFor(m.id);
      try {
        await cutClip({
          inputPath: rawPath,
          outputPath: outPath,
          startMs: m.tStartMs,
          endMs: m.tEndMs,
        });
        await putFile(dest, outPath, 'audio/mpeg');
        await db()
          .update(screenMoments)
          .set({ clipKey: dest })
          .where(eq(screenMoments.id, m.id));
      } catch (err) {
        log.warn(SCOPE, 'clip cut failed; leaving bounds reference', {
          momentId: m.id,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await safeUnlink(outPath);
      }
    }
  }
  await safeUnlink(rawPath);
}

export function startSynthesisWorker(): Worker {
  const worker = new Worker(QUEUE.synthesis, processSynthesis, {
    connection: bullConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 2,
  });
  worker.on('failed', (job, err) =>
    log.error(SCOPE, 'job failed', { jobId: job?.id, error: err.message }),
  );
  return worker;
}
