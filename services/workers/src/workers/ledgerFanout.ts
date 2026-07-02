// LEDGER_FANOUT worker (the brief's step 6). Batch-writes ledger_events for many
// students. Two shapes: {shortlistId} expands into one 'shortlist' event per
// entry (fired on ops approval) plus an SLA check; {events} writes an explicit
// batch (e.g. 'search_hit' fanout). Status flips on the shortlist/job are the
// web app's job (it flips then enqueues this) — we only write the ledger + SLA.

import { Worker, type Job } from 'bullmq';
import { db, shortlists, shortlistEntries, jobs, eq } from '@tartan/db';
import { QUEUE } from '../queues.js';
import { bullConnection } from '../redis.js';
import { QUEUE_PREFIX, DRY_RUN } from '../env.js';
import { log } from '../logger.js';
import { appendLedger } from '../ledger.js';
import { fileException } from '../util.js';
import { LedgerFanoutJob, type LedgerEventInput } from '../jobs.js';

const SCOPE = 'ledger_fanout';

export async function processLedgerFanout(job: Job): Promise<void> {
  const data = LedgerFanoutJob.parse(job.data);

  if (DRY_RUN) {
    log.info(SCOPE, 'dry-run: skipping fanout', {
      shape: 'events' in data ? 'events' : 'shortlist',
    });
    return;
  }

  if ('events' in data) {
    const n = await appendLedger(data.events);
    log.info(SCOPE, 'wrote explicit event batch', { count: n });
    return;
  }

  const { shortlistId } = data;
  const [shortlist] = await db()
    .select()
    .from(shortlists)
    .where(eq(shortlists.id, shortlistId))
    .limit(1);
  if (!shortlist) {
    log.warn(SCOPE, 'shortlist not found', { shortlistId });
    return;
  }
  const [jobRow] = await db()
    .select()
    .from(jobs)
    .where(eq(jobs.id, shortlist.jobId))
    .limit(1);

  const entries = await db()
    .select({
      studentId: shortlistEntries.studentId,
      rank: shortlistEntries.rank,
    })
    .from(shortlistEntries)
    .where(eq(shortlistEntries.shortlistId, shortlistId));

  const events: LedgerEventInput[] = entries.map((e) => ({
    studentId: e.studentId,
    actorKind: 'system',
    actorId: jobRow?.orgId ?? undefined,
    kind: 'shortlist',
    detail: {
      kind: 'shortlist',
      jobId: shortlist.jobId,
      shortlistId,
      rank: e.rank,
    },
  }));
  const n = await appendLedger(events);
  log.info(SCOPE, 'shortlist fanout written', { shortlistId, students: n });

  // ── SLA check on delivery ───────────────────────────────────────────────────
  if (jobRow?.slaDueAt) {
    const now = Date.now();
    const due = jobRow.slaDueAt.getTime();
    if (now > due) {
      await fileException({
        category: 'sla_risk',
        agent: 'recruiter',
        context: {
          agent: 'system',
          quote: `Shortlist delivered after the SLA due time (${jobRow.slaDueAt.toISOString()}).`,
          refs: { jobId: shortlist.jobId, shortlistId },
          category: 'sla_risk',
        },
        recommendation:
          'Delivered past SLA. Note in the org account review and check pipeline throughput.',
      });
      log.warn(SCOPE, 'delivered past SLA', { jobId: shortlist.jobId });
    }
  }
}

export function startLedgerFanoutWorker(): Worker {
  const worker = new Worker(QUEUE.ledgerFanout, processLedgerFanout, {
    connection: bullConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 2,
  });
  worker.on('failed', (job, err) =>
    log.error(SCOPE, 'job failed', { jobId: job?.id, error: err.message }),
  );
  return worker;
}
