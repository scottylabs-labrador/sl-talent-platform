// Centralized environment access for the workers service. Nothing here throws
// at import time (the module is imported by the http health path, which must
// work even with a partial env); requireEnv() throws only when a value is
// actually needed.

export const PORT = Number(process.env.PORT ?? 8788);

/** Queue key prefix (ARCHITECTURE section 1: Redis plugin, BullMQ). */
export const QUEUE_PREFIX = 'tartan';

/** Shared secret for POST /trigger/:job and the ledger subject-hash salt. */
export const AUTH_SECRET = process.env.AUTH_SECRET ?? '';

export const REDIS_URL = process.env.REDIS_URL ?? '';

/**
 * Dry-run: sweeps and pipelines log what they would do but perform no writes,
 * clip cuts, or enqueues. Set during the boot smoke-test so a short-lived
 * process never mutates seeded data (see the brief's guard).
 */
export const DRY_RUN = process.env.WORKERS_DRY_RUN === '1';

/**
 * Remove the repeatable job schedulers on graceful shutdown. Off in production
 * (schedules must persist in Redis); on for the boot smoke-test so it leaves
 * nothing behind.
 */
export const CLEANUP_ON_EXIT = process.env.WORKERS_CLEANUP_ON_EXIT === '1';

// S3 (audio + exports).
export const S3_BUCKET = process.env.S3_BUCKET ?? '';
export const S3_REGION = process.env.S3_REGION ?? 'us-east-1';

/** Salt for the deletion audit hash. Never the raw student id in the kept row. */
export const LEDGER_SALT =
  process.env.LEDGER_SALT ?? process.env.AUTH_SECRET ?? 'tartan-ledger';

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
