// BullMQ queue registry. All queues share the 'tartan' prefix and the single
// non-blocking connection. Producers (this service's http trigger, the deletion
// worker chaining an export, etc.) import `queues` and add jobs; the Workers in
// ./workers consume them.

import { Queue } from 'bullmq';
import { QUEUE_PREFIX } from './env.js';
import { bullConnection } from './redis.js';

export const QUEUE = {
  synthesis: 'synthesis',
  verification: 'verification',
  matching: 'matching',
  ledgerFanout: 'ledger_fanout',
  notifications: 'notifications',
  deletion: 'deletion',
  schedules: 'schedules',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

function makeQueue(name: QueueName): Queue {
  return new Queue(name, {
    connection: bullConnection(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
    },
  });
}

export const queues = {
  synthesis: makeQueue(QUEUE.synthesis),
  verification: makeQueue(QUEUE.verification),
  matching: makeQueue(QUEUE.matching),
  ledgerFanout: makeQueue(QUEUE.ledgerFanout),
  notifications: makeQueue(QUEUE.notifications),
  deletion: makeQueue(QUEUE.deletion),
  schedules: makeQueue(QUEUE.schedules),
} as const;

export async function closeQueues(): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.close().catch(() => undefined)));
}
