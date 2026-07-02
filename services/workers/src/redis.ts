// Redis connections.
//
// Two consumers with different needs:
//  1. BullMQ Queues/Workers — handed connection *options* (not an instance) so
//     BullMQ builds and owns its own (bundled) ioredis client per queue/worker.
//     Passing an instance would clash on the dual ioredis versions (BullMQ pins
//     its own). BullMQ requires maxRetriesPerRequest: null for blocking clients.
//  2. The plain-list BRPOP bridge — a real ioredis instance we own directly.

import { Redis as IORedis } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { REDIS_URL } from './env.js';

export type Redis = IORedis;

/** BullMQ connection options parsed from REDIS_URL. */
export function bullConnection(): ConnectionOptions {
  if (!REDIS_URL) throw new Error('REDIS_URL is not set');
  const u = new URL(REDIS_URL);
  const opts: ConnectionOptions = {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  return opts;
}

/** A real ioredis instance we own (the BRPOP bridge). */
export function newRedis(): Redis {
  if (!REDIS_URL) throw new Error('REDIS_URL is not set');
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  });
}
