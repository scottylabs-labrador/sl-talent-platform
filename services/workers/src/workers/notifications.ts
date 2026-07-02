// NOTIFICATIONS worker (the brief's step 6, kept honest). Real email is out of
// scope for v1. This worker logs the notification to the console (Railway
// captures it) and, when the payload carries a ledgerable action, appends that
// ledger event. It never fabricates a delivery channel.

import { Worker, type Job } from 'bullmq';
import { QUEUE } from '../queues.js';
import { bullConnection } from '../redis.js';
import { QUEUE_PREFIX, DRY_RUN } from '../env.js';
import { log } from '../logger.js';
import { appendLedger } from '../ledger.js';
import { NotificationJob } from '../jobs.js';

const SCOPE = 'notifications';

export async function processNotification(job: Job): Promise<void> {
  const n = NotificationJob.parse(job.data);

  // Notifications are logged even in dry-run (they mutate nothing by default).
  log.info(SCOPE, `notify -> ${n.title}`, {
    studentId: n.studentId,
    kind: n.kind,
    body: n.body,
  });

  if (n.ledger && !DRY_RUN) {
    await appendLedger([n.ledger]);
    log.info(SCOPE, 'appended ledger event for notification', {
      kind: n.ledger.kind,
    });
  }
}

export function startNotificationsWorker(): Worker {
  const worker = new Worker(QUEUE.notifications, processNotification, {
    connection: bullConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 4,
  });
  worker.on('failed', (job, err) =>
    log.error(SCOPE, 'job failed', { jobId: job?.id, error: err.message }),
  );
  return worker;
}
