// retention_sweep (daily) — ARCHITECTURE section 4: delete raw + clips for
// students inactive 18 months (from students.last_verified_at). DIVERGENCE
// CHOICE (documented per the brief): this sweep enqueues an AUDIO-ONLY purge
// ('purge_audio' on the deletion queue) — it deletes the S3 objects and nulls
// the keys but KEEPS the DB rows. Full account deletion is a separate, explicit
// user action (DELETE /me -> deletion 'delete'). S3 lifecycle rules remain the
// 24-month hard backstop; this DB-driven sweep is the source of truth.

import { db, students, and, isNotNull, lt } from '@tartan/db';
import { queues } from '../queues.js';
import { DRY_RUN } from '../env.js';
import { log } from '../logger.js';
import { DELETION_JOB, type PurgeAudioJob } from '../jobs.js';

const SCOPE = 'retention_sweep';
const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;

export async function retentionSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - EIGHTEEN_MONTHS_MS);

  const stale = await db()
    .select({ id: students.id })
    .from(students)
    .where(
      and(isNotNull(students.lastVerifiedAt), lt(students.lastVerifiedAt, cutoff)),
    );

  if (DRY_RUN) {
    log.info(SCOPE, 'dry-run complete', { wouldPurge: stale.length });
    return;
  }

  for (const s of stale) {
    const data: PurgeAudioJob = { studentId: s.id };
    await queues.deletion.add(DELETION_JOB.purgeAudio, data, {
      jobId: `purge_audio:${s.id}`, // idempotent: one pending purge per student
    });
  }

  log.info(SCOPE, 'complete', { enqueuedAudioPurges: stale.length });
}
