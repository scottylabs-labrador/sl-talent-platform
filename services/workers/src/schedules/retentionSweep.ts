// retention_sweep (daily) — ARCHITECTURE section 4: delete raw + clips for
// students inactive 18 months (from students.last_verified_at). DIVERGENCE
// CHOICE (documented per the brief): this sweep enqueues an AUDIO-ONLY purge
// ('purge_audio' on the deletion queue) — it deletes the S3 objects and nulls
// the keys but KEEPS the DB rows. Full account deletion is a separate, explicit
// user action (DELETE /me -> deletion 'delete'). S3 lifecycle rules remain the
// 24-month hard backstop; this DB-driven sweep is the source of truth.

import {
  db,
  students,
  screenMoments,
  and,
  eq,
  isNotNull,
  lt,
  inArray,
} from '@tartan/db';
import { queues } from '../queues.js';
import { DRY_RUN } from '../env.js';
import { log } from '../logger.js';
import { DELETION_JOB, type PurgeAudioJob } from '../jobs.js';
import { deleteKeys, s3Configured } from '../s3.js';

const SCOPE = 'retention_sweep';
const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function retentionSweep(): Promise<void> {
  await sweepInactiveStudents();
  await sweepStruckClips();
}

/** Inactive-18-months audio purge: enqueue one audio-only purge per stale student. */
async function sweepInactiveStudents(): Promise<void> {
  const cutoff = new Date(Date.now() - EIGHTEEN_MONTHS_MS);

  const stale = await db()
    .select({ id: students.id })
    .from(students)
    .where(
      and(isNotNull(students.lastVerifiedAt), lt(students.lastVerifiedAt, cutoff)),
    );

  if (DRY_RUN) {
    log.info(SCOPE, 'dry-run: inactive-student purge', { wouldPurge: stale.length });
    return;
  }

  for (const s of stale) {
    const data: PurgeAudioJob = { studentId: s.id };
    await queues.deletion.add(DELETION_JOB.purgeAudio, data, {
      jobId: `purge_audio:${s.id}`, // idempotent: one pending purge per student
    });
  }

  log.info(SCOPE, 'inactive-student purge complete', {
    enqueuedAudioPurges: stale.length,
  });
}

/**
 * Struck-moment clip retention: a struck moment is soft-deleted (row kept,
 * student_visible cleared) immediately, but its S3 clip object must be
 * hard-deleted within 24h. This sweep finds struck moments whose clip is still
 * present and older than 24h, deletes the S3 object, then nulls clip_key so the
 * row can never re-surface an orphaned key.
 */
async function sweepStruckClips(): Promise<void> {
  const cutoff = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);

  const rows = await db()
    .select({ id: screenMoments.id, clipKey: screenMoments.clipKey })
    .from(screenMoments)
    .where(
      and(
        eq(screenMoments.struck, true),
        isNotNull(screenMoments.clipKey),
        lt(screenMoments.updatedAt, cutoff),
      ),
    );

  const targets = rows.filter(
    (r): r is { id: string; clipKey: string } => Boolean(r.clipKey),
  );

  if (DRY_RUN) {
    log.info(SCOPE, 'dry-run: struck-clip sweep', { wouldDelete: targets.length });
    return;
  }
  if (targets.length === 0) {
    log.info(SCOPE, 'struck-clip sweep complete', { deletedClips: 0 });
    return;
  }
  if (!s3Configured()) {
    log.warn(SCOPE, 'struck clips pending but S3 not configured; skipping', {
      pending: targets.length,
    });
    return;
  }

  const deleted = await deleteKeys(targets.map((t) => t.clipKey));
  await db()
    .update(screenMoments)
    .set({ clipKey: null })
    .where(
      inArray(
        screenMoments.id,
        targets.map((t) => t.id),
      ),
    );

  log.info(SCOPE, 'struck-clip sweep complete', {
    deletedClips: deleted,
    clearedKeys: targets.length,
  });
}
