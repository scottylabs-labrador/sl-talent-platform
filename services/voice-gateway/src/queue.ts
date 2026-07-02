// Synthesis job hand-off to the workers service.
//
// COORDINATION NOTE (documented in the brief): the workers service consumes
// BullMQ, whose Queue class is NOT a dependency of this gateway, and adding deps
// is out of scope. Rather than hand-craft a fragile BullMQ-compatible payload,
// the gateway and workers agree on a dead-simple Redis list:
//
//     gateway:  LPUSH jobs:synthesis '{"screenId":"...","enqueuedAt":<ms>}'
//     workers:  BRPOP jobs:synthesis  (blocking pop, then run synthesis)
//
// One JSON string per job. If the workers team wires a BullMQ Queue instead,
// they can bridge this list into it; the queue NAME to standardize on is
// 'synthesis' and the list key is 'jobs:synthesis'.

import { getRedis } from './redis.js';
import { log } from './log.js';

export const SYNTHESIS_LIST_KEY = 'jobs:synthesis';

export interface SynthesisJob {
  screenId: string;
  enqueuedAt: number;
}

export async function enqueueSynthesis(screenId: string): Promise<void> {
  const job: SynthesisJob = { screenId, enqueuedAt: Date.now() };
  try {
    await getRedis().lpush(SYNTHESIS_LIST_KEY, JSON.stringify(job));
    log.info('enqueued synthesis job', { screenId });
  } catch (e) {
    log.error('failed to enqueue synthesis job', e);
  }
}
