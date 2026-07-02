// DELETION worker (the brief's step 7; ARCHITECTURE section 8 "deletion that
// actually deletes"). Three named jobs:
//   delete       -> transactional cascade of every student row, S3 raw+clips+
//                   export objects, and queued jobs; then a single audit
//                   ledger_events row with student_id nulled to a salted hash.
//   export       -> gather everything about a student into one JSON, upload to
//                   exports/{studentId}.json, presign a 24h URL, stash it in
//                   config key export.{studentId} for the web to hand out.
//   purge_audio  -> retention sweep target: delete raw+clips, null the keys,
//                   KEEP the rows (divergence from full delete, documented).

import { Worker, type Job } from 'bullmq';
import {
  db,
  students,
  users,
  screens,
  screenMoments,
  dossiers,
  coachingReports,
  evidence,
  experienceStories,
  skillClaims,
  shortlistEntries,
  consents,
  ledgerEvents,
  config,
  eq,
  inArray,
} from '@tartan/db';
import { QUEUE, queues } from '../queues.js';
import { bullConnection } from '../redis.js';
import { QUEUE_PREFIX, DRY_RUN } from '../env.js';
import { log } from '../logger.js';
import { subjectHash, appendLedger } from '../ledger.js';
import { writeConfig } from '../config.js';
import {
  deleteKeys,
  putBytes,
  presignGetUrl,
  exportKey,
  s3Configured,
} from '../s3.js';
import {
  DeletionJob,
  ExportJob,
  PurgeAudioJob,
  DELETION_JOB,
} from '../jobs.js';

const SCOPE = 'deletion';

export async function processDeletion(job: Job): Promise<void> {
  if (DRY_RUN) {
    log.info(SCOPE, 'dry-run: skipping deletion job', {
      name: job.name,
      data: job.data,
    });
    return;
  }

  switch (job.name) {
    case DELETION_JOB.delete:
      await fullDelete(DeletionJob.parse(job.data).studentId);
      break;
    case DELETION_JOB.export:
      await exportStudent(ExportJob.parse(job.data).studentId);
      break;
    case DELETION_JOB.purgeAudio:
      await purgeAudio(PurgeAudioJob.parse(job.data).studentId);
      break;
    default:
      log.warn(SCOPE, 'unknown deletion job name', { name: job.name });
  }
}

interface ScreenKeys {
  screenIds: string[];
  audioKeys: string[];
  clipKeys: string[];
}

async function gatherScreenKeys(studentId: string): Promise<ScreenKeys> {
  const screenRows = await db()
    .select({ id: screens.id, audioKey: screens.audioKey })
    .from(screens)
    .where(eq(screens.studentId, studentId));
  const screenIds = screenRows.map((r) => r.id);
  const audioKeys = screenRows
    .map((r) => r.audioKey)
    .filter((k): k is string => Boolean(k));

  let clipKeys: string[] = [];
  if (screenIds.length > 0) {
    const moms = await db()
      .select({ clipKey: screenMoments.clipKey })
      .from(screenMoments)
      .where(inArray(screenMoments.screenId, screenIds));
    clipKeys = moms.map((m) => m.clipKey).filter((k): k is string => Boolean(k));
  }
  return { screenIds, audioKeys, clipKeys };
}

/** Remove queued jobs across the pipeline queues that reference this student. */
async function removeStudentJobs(
  studentId: string,
  screenIds: string[],
): Promise<number> {
  const screenSet = new Set(screenIds);
  const scanQueues = [
    queues.synthesis,
    queues.verification,
    queues.matching,
    queues.notifications,
  ];
  let removed = 0;
  for (const q of scanQueues) {
    const pending = await q.getJobs(
      ['waiting', 'delayed', 'paused', 'prioritized'],
      0,
      -1,
    );
    for (const j of pending) {
      const data = (j.data ?? {}) as Record<string, unknown>;
      const refsStudent = data['studentId'] === studentId;
      const refsScreen =
        typeof data['screenId'] === 'string' && screenSet.has(data['screenId']);
      if (refsStudent || refsScreen) {
        try {
          await j.remove();
          removed += 1;
        } catch {
          /* locked/active job — leave it */
        }
      }
    }
  }
  return removed;
}

// ── full delete ───────────────────────────────────────────────────────────────

async function fullDelete(studentId: string): Promise<void> {
  const [student] = await db()
    .select({ id: students.id, userId: students.userId })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!student) {
    log.warn(SCOPE, 'student not found (already deleted?)', { studentId });
    return;
  }

  const { screenIds, audioKeys, clipKeys } = await gatherScreenKeys(studentId);
  const removedJobs = await removeStudentJobs(studentId, screenIds);

  // Cascade delete. shortlist_entries.student_id is ON DELETE RESTRICT, so it
  // must go first; deleting the student then cascades screens/evidence/stories/
  // moments/dossiers/coaching/consents; deleting the user is the final identity
  // removal. ledger_events.student_id is ON DELETE SET NULL (rows survive,
  // de-identified).
  await db().transaction(async (tx) => {
    await tx
      .delete(shortlistEntries)
      .where(eq(shortlistEntries.studentId, studentId));
    await tx.delete(students).where(eq(students.id, studentId));
    await tx.delete(users).where(eq(users.id, student.userId));
  });

  // S3 objects (raw audio, clips, any export).
  const deletedObjects = await deleteKeys([
    ...audioKeys,
    ...clipKeys,
    exportKey(studentId),
  ]);

  // Drop any stashed export pointer.
  await db().delete(config).where(eq(config.key, `export.${studentId}`));

  // Final audit row: student_id nulled to a salted hash so the deletion itself
  // is auditable without retaining identity. No 'delete' ledger kind exists;
  // 'edit' on field 'account' documents it.
  await db()
    .insert(ledgerEvents)
    .values({
      studentId: null,
      subjectHash: subjectHash(studentId),
      actorKind: 'system',
      actorId: 'deletion',
      kind: 'edit',
      detail: {
        kind: 'edit',
        field: 'account',
        note: 'account deleted; all rows and audio purged',
      },
    });

  log.info(SCOPE, 'student deleted', {
    studentId,
    removedJobs,
    deletedObjects,
  });
}

// ── export ────────────────────────────────────────────────────────────────────

async function exportStudent(studentId: string): Promise<void> {
  const [student] = await db()
    .select()
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!student) {
    log.warn(SCOPE, 'export: student not found', { studentId });
    return;
  }
  const [user] = await db()
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, student.userId))
    .limit(1);

  // Embeddings are internal derived artifacts (and huge); omit from the export.
  const evidenceRows = await db()
    .select({
      id: evidence.id,
      type: evidence.type,
      provenance: evidence.provenance,
      title: evidence.title,
      url: evidence.url,
      meta: evidence.meta,
      createdAt: evidence.createdAt,
    })
    .from(evidence)
    .where(eq(evidence.studentId, studentId));

  const storyRows = await db()
    .select({
      id: experienceStories.id,
      title: experienceStories.title,
      situation: experienceStories.situation,
      contribution: experienceStories.contribution,
      outcome: experienceStories.outcome,
      meta: experienceStories.meta,
    })
    .from(experienceStories)
    .where(eq(experienceStories.studentId, studentId));

  const claimRows = await db()
    .select()
    .from(skillClaims)
    .where(eq(skillClaims.studentId, studentId));

  const screenRows = await db()
    .select()
    .from(screens)
    .where(eq(screens.studentId, studentId));
  const screenIds = screenRows.map((s) => s.id);

  const momentRows = screenIds.length
    ? await db()
        .select()
        .from(screenMoments)
        .where(inArray(screenMoments.screenId, screenIds))
    : [];
  const dossierRows = screenIds.length
    ? await db().select().from(dossiers).where(inArray(dossiers.screenId, screenIds))
    : [];
  const coachingRows = screenIds.length
    ? await db()
        .select()
        .from(coachingReports)
        .where(inArray(coachingReports.screenId, screenIds))
    : [];

  const entryRows = await db()
    .select()
    .from(shortlistEntries)
    .where(eq(shortlistEntries.studentId, studentId));
  const consentRows = await db()
    .select()
    .from(consents)
    .where(eq(consents.studentId, studentId));
  const ledgerRows = await db()
    .select()
    .from(ledgerEvents)
    .where(eq(ledgerEvents.studentId, studentId));

  const payload = {
    exportedAt: new Date().toISOString(),
    student,
    user: user ?? null,
    skillClaims: claimRows,
    evidence: evidenceRows,
    experienceStories: storyRows,
    screens: screenRows,
    screenMoments: momentRows,
    dossiers: dossierRows,
    coachingReports: coachingRows,
    shortlistEntries: entryRows,
    consents: consentRows,
    ledgerEvents: ledgerRows,
  };

  const key = exportKey(studentId);
  let url: string | undefined;
  const expiresAt = new Date(Date.now() + 86400000).toISOString();

  if (s3Configured()) {
    await putBytes(key, JSON.stringify(payload, null, 2), 'application/json');
    try {
      url = presignGetUrl(key, 86400);
    } catch (err) {
      log.warn(SCOPE, 'presign failed; stored object without url', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    log.warn(SCOPE, 'S3 not configured; export not uploaded', { studentId });
  }

  await writeConfig(`export.${studentId}`, {
    key,
    url: url ?? null,
    generatedAt: new Date().toISOString(),
    expiresAt,
    uploaded: s3Configured(),
  });

  await appendLedger([
    {
      studentId,
      actorKind: 'student',
      kind: 'export',
      detail: { kind: 'export', scope: 'full' },
    },
  ]);

  log.info(SCOPE, 'export ready', { studentId, uploaded: s3Configured() });
}

// ── retention audio purge (rows kept) ──────────────────────────────────────────

async function purgeAudio(studentId: string): Promise<void> {
  const { screenIds, audioKeys, clipKeys } = await gatherScreenKeys(studentId);
  const deleted = await deleteKeys([...audioKeys, ...clipKeys]);

  if (screenIds.length > 0) {
    await db()
      .update(screens)
      .set({ audioKey: null })
      .where(eq(screens.studentId, studentId));
    await db()
      .update(screenMoments)
      .set({ clipKey: null })
      .where(inArray(screenMoments.screenId, screenIds));
  }

  await appendLedger([
    {
      studentId,
      actorKind: 'system',
      actorId: 'retention',
      kind: 'edit',
      detail: {
        kind: 'edit',
        field: 'audio',
        note: 'retention: audio purged after 18 months inactive, rows kept',
      },
    },
  ]);

  log.info(SCOPE, 'audio purged (rows kept)', { studentId, deleted });
}

export function startDeletionWorker(): Worker {
  const worker = new Worker(QUEUE.deletion, processDeletion, {
    connection: bullConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 1,
  });
  worker.on('failed', (job, err) =>
    log.error(SCOPE, 'job failed', { jobId: job?.id, error: err.message }),
  );
  return worker;
}
