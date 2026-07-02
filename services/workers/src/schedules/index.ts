// Scheduled jobs registry. Each schedule is a BullMQ repeatable (job scheduler)
// on the 'schedules' queue and is ALSO fireable one-off via POST /trigger/:job
// (ops + Railway cron compatibility). The schedules worker dispatches by job name
// to the handler. Cron patterns (not `every`) are used so the first run lands on
// the next boundary rather than immediately at boot.

import { Worker, type Job } from 'bullmq';
import { QUEUE, queues } from '../queues.js';
import { bullConnection } from '../redis.js';
import { QUEUE_PREFIX } from '../env.js';
import { log } from '../logger.js';
import { SCHEDULE_JOB, type ScheduleJobName } from '../jobs.js';
import { slaSweep } from './slaSweep.js';
import { retentionSweep } from './retentionSweep.js';
import { mondayDigest } from './mondayDigest.js';
import { adverseImpactRollup } from './adverseImpactRollup.js';

const SCOPE = 'schedules';

interface ScheduleDef {
  name: ScheduleJobName;
  pattern: string; // cron
  handler: () => Promise<void>;
  description: string;
}

export const SCHEDULE_DEFS: readonly ScheduleDef[] = [
  {
    name: SCHEDULE_JOB.slaSweep,
    pattern: '*/5 * * * *', // every 5 minutes
    handler: slaSweep,
    description: 'sla risk sweep',
  },
  {
    name: SCHEDULE_JOB.retentionSweep,
    pattern: '0 7 * * *', // daily 07:00
    handler: retentionSweep,
    description: 'retention audio purge sweep',
  },
  {
    name: SCHEDULE_JOB.mondayDigest,
    pattern: '0 8 * * 1', // Mondays 08:00
    handler: mondayDigest,
    description: 'sentinel weekly digest',
  },
  {
    name: SCHEDULE_JOB.adverseImpactRollup,
    pattern: '0 9 * * 1', // Mondays 09:00
    handler: adverseImpactRollup,
    description: 'adverse-impact rollup',
  },
];

const HANDLERS = new Map<string, () => Promise<void>>(
  SCHEDULE_DEFS.map((d) => [d.name, d.handler]),
);

export function isScheduleName(name: string): name is ScheduleJobName {
  return HANDLERS.has(name);
}

async function dispatch(job: Job): Promise<void> {
  const handler = HANDLERS.get(job.name);
  if (!handler) {
    log.warn(SCOPE, 'no handler for scheduled job', { name: job.name });
    return;
  }
  log.info(SCOPE, 'running scheduled job', { name: job.name });
  await handler();
}

export function startSchedulesWorker(): Worker {
  const worker = new Worker(QUEUE.schedules, dispatch, {
    connection: bullConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 1,
  });
  worker.on('failed', (job, err) =>
    log.error(SCOPE, 'scheduled job failed', {
      name: job?.name,
      error: err.message,
    }),
  );
  return worker;
}

/** Register (idempotent) every repeatable schedule; logs one line per schedule. */
export async function registerSchedules(): Promise<void> {
  for (const def of SCHEDULE_DEFS) {
    await queues.schedules.upsertJobScheduler(
      def.name,
      { pattern: def.pattern },
      { name: def.name },
    );
    log.info(SCOPE, 'registered repeatable', {
      name: def.name,
      pattern: def.pattern,
      description: def.description,
    });
  }
}

/** Remove every repeatable schedule (boot smoke-test cleanup only). */
export async function removeSchedules(): Promise<void> {
  for (const def of SCHEDULE_DEFS) {
    await queues.schedules.removeJobScheduler(def.name).catch(() => undefined);
  }
  log.info(SCOPE, 'removed repeatable schedules');
}

/** Fire a schedule once, now (POST /trigger/:job). */
export async function runScheduleNow(name: ScheduleJobName): Promise<void> {
  await queues.schedules.add(name, {}, { removeOnComplete: true });
}
