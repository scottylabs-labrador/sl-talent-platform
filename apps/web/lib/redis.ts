// Web-side Redis producer. The web app enqueues background work by LPUSHing
// JSON onto the plain lists in @tartan/types JOB_LISTS; the workers service
// bridges each list into its BullMQ queue (services/workers/src/bridge.ts).
//
// Lazy singleton — never connects at import time (a build with no REDIS_URL must
// not throw).

import Redis from 'ioredis';
import {
  JOB_LISTS,
  type VerificationJobPayload,
  type ExportJobPayload,
  type DeletionJobPayload,
} from '@tartan/types';

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

/** The list key the workers' matching bridge BRPOPs (mirror of jobs:synthesis). */
export const MATCHING_LIST_KEY = JOB_LISTS.matching;

/** Enqueue a recruiter matching run for a confirmed job. */
export async function enqueueMatching(jobId: string): Promise<void> {
  await client().lpush(
    MATCHING_LIST_KEY,
    JSON.stringify({ jobId, enqueuedAt: Date.now() }),
  );
}

/** Enqueue verification of a newly added evidence row. */
export async function enqueueVerification(
  payload: VerificationJobPayload,
): Promise<void> {
  await client().lpush(JOB_LISTS.verification, JSON.stringify(payload));
}

/** Enqueue the full-data export for a student. */
export async function enqueueExport(payload: ExportJobPayload): Promise<void> {
  await client().lpush(JOB_LISTS.export, JSON.stringify(payload));
}

/** Enqueue the hard account deletion for a student. */
export async function enqueueDeletion(
  payload: DeletionJobPayload,
): Promise<void> {
  await client().lpush(JOB_LISTS.deletion, JSON.stringify(payload));
}

/** Enqueue a ledger fanout (shortlist delivery or explicit event batch). */
export async function enqueueLedgerFanout(payload: unknown): Promise<void> {
  await client().lpush(JOB_LISTS.ledgerFanout, JSON.stringify(payload));
}
