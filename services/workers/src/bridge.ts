// BRPOP bridges (the brief's step 2). The producers outside this service have no
// BullMQ; they LPUSH plain JSON onto Redis lists and rely on this service to
// bridge each list into its real BullMQ queue:
//
//   voice-gateway → 'jobs:synthesis'       {screenId}             → synthesis
//   web (sponsor)  → 'jobs:matching'        {jobId,...}            → matching
//   web (ops)      → 'jobs:ledger_fanout'   {shortlistId}|{events} → ledger_fanout
//
// Each list gets its own blocking connection so one slow list never starves
// another, and shutdown aborts every in-flight BRPOP immediately.

import type { ZodType } from 'zod';
import type { Queue } from 'bullmq';
import type { Redis } from './redis.js';
import { newRedis } from './redis.js';
import { queues } from './queues.js';
import { QUEUE } from './queues.js';
import { log } from './logger.js';
import { SynthesisJob, MatchingJob, LedgerFanoutJob } from './jobs.js';

const SCOPE = 'bridge';
export const SYNTHESIS_LIST = 'jobs:synthesis';
export const MATCHING_LIST = 'jobs:matching';
export const LEDGER_FANOUT_LIST = 'jobs:ledger_fanout';

export interface Bridge {
  stop: () => Promise<void>;
}

interface BridgeDef<T> {
  list: string;
  queue: Queue;
  jobName: string;
  schema: ZodType<T>;
  // Optional stable id for deduping repeat pushes.
  jobId?: (data: T) => string | undefined;
}

const BRIDGES: readonly BridgeDef<unknown>[] = [
  {
    list: SYNTHESIS_LIST,
    queue: queues.synthesis,
    jobName: QUEUE.synthesis,
    schema: SynthesisJob,
    jobId: (d) => `synthesis-${(d as { screenId: string }).screenId}`,
  } as BridgeDef<unknown>,
  {
    list: MATCHING_LIST,
    queue: queues.matching,
    jobName: QUEUE.matching,
    schema: MatchingJob,
    jobId: (d) => `matching-${(d as { jobId: string }).jobId}`,
  } as BridgeDef<unknown>,
  {
    list: LEDGER_FANOUT_LIST,
    queue: queues.ledgerFanout,
    jobName: QUEUE.ledgerFanout,
    schema: LedgerFanoutJob,
    // Dedupe only the shortlist-fanout variant; explicit event batches are unique.
    jobId: (d) => {
      const shortlistId = (d as { shortlistId?: string }).shortlistId;
      return shortlistId ? `ledger_fanout-${shortlistId}` : undefined;
    },
  } as BridgeDef<unknown>,
];

function startBridge(def: BridgeDef<unknown>): Bridge {
  const conn: Redis = newRedis();
  let running = true;

  const loop = async (): Promise<void> => {
    log.info(SCOPE, 'listening for bridge jobs', { list: def.list });
    while (running) {
      let payload: string | undefined;
      try {
        // Block up to 5s so shutdown stays responsive.
        const res = await conn.brpop(def.list, 5);
        if (!res) continue;
        payload = res[1];
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(payload);
        } catch {
          log.warn(SCOPE, 'dropped non-JSON bridge payload', {
            list: def.list,
            payload,
          });
          continue;
        }
        const parsed = def.schema.safeParse(parsedJson);
        if (!parsed.success) {
          log.warn(SCOPE, 'dropped invalid bridge payload', {
            list: def.list,
            payload,
          });
          continue;
        }
        const jobId = def.jobId?.(parsed.data);
        await def.queue.add(
          def.jobName,
          parsed.data,
          jobId ? { jobId } : undefined,
        );
        log.info(SCOPE, 'bridged job', { list: def.list, jobId });
      } catch (err) {
        if (!running) break;
        // BRPOP already consumed the item; put it back so a transient enqueue
        // failure (Redis blip, BullMQ error) cannot silently lose the job.
        if (payload !== undefined) {
          await conn.lpush(def.list, payload).catch(() => undefined);
        }
        log.warn(SCOPE, 'bridge loop error; retrying', {
          list: def.list,
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };

  void loop();

  return {
    stop: async (): Promise<void> => {
      running = false;
      // disconnect() aborts the in-flight blocking BRPOP immediately.
      conn.disconnect();
    },
  };
}

/** Start all plain-list → BullMQ bridges. Returns one handle that stops them all. */
export function startBridges(): Bridge {
  const bridges = BRIDGES.map(startBridge);
  return {
    stop: async (): Promise<void> => {
      await Promise.all(bridges.map((b) => b.stop()));
    },
  };
}

/** Back-compat alias — starts every bridge, not just synthesis. */
export function startSynthesisBridge(): Bridge {
  return startBridges();
}
