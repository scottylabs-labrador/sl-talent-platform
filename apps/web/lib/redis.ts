// Web-side Redis producer. The only thing the web app pushes onto Redis is the
// matching bridge: after a sponsor confirms a role, we LPUSH {jobId} onto the
// plain list 'jobs:matching', mirroring the voice-gateway → workers synthesis
// bridge contract ('jobs:synthesis'). The workers service must BRPOP this list
// into its BullMQ 'matching' queue (see the note in the sponsor router / report:
// today workers only bridge synthesis, so a matching bridge needs adding there).
//
// Lazy singleton — never connects at import time (a build with no REDIS_URL must
// not throw).

import Redis from 'ioredis';

let _redis: Redis | undefined;

function client(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set');
    // lazyConnect keeps import/build safe; the first command opens the socket.
    _redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
  }
  return _redis;
}

/** The list key the workers' matching bridge must BRPOP (mirror of jobs:synthesis). */
export const MATCHING_LIST_KEY = 'jobs:matching';

/** Enqueue a recruiter matching run for a confirmed job. */
export async function enqueueMatching(jobId: string): Promise<void> {
  await client().lpush(
    MATCHING_LIST_KEY,
    JSON.stringify({ jobId, enqueuedAt: Date.now() }),
  );
}
