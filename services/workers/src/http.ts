// Tiny http control plane (the brief's step 1).
//   GET  /health          -> {ok:true,service:'workers'} (Railway healthcheck)
//   POST /trigger/:job     -> fire a scheduled job (or a pipeline job with a JSON
//                             body) once, now. Requires header
//                             X-Trigger-Key === AUTH_SECRET. Enables ops + the
//                             Railway cron service to drive schedules over http.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { PORT, AUTH_SECRET } from './env.js';
import { log } from './logger.js';
import { queues } from './queues.js';
import {
  SynthesisJob,
  VerificationJob,
  MatchingJob,
  LedgerFanoutJob,
  ExportJob,
  DeletionJob,
  PurgeAudioJob,
  DELETION_JOB,
} from './jobs.js';
import { isScheduleName, runScheduleNow } from './schedules/index.js';

const SCOPE = 'http';

// Pipeline jobs that ops can trigger with a JSON body (validated per handler).
const PIPELINE_TRIGGERS: Record<string, (body: unknown) => Promise<unknown>> = {
  synthesis: (b) => queues.synthesis.add('synthesis', SynthesisJob.parse(b)),
  verification: (b) =>
    queues.verification.add('verification', VerificationJob.parse(b)),
  matching: (b) => queues.matching.add('matching', MatchingJob.parse(b)),
  ledger_fanout: (b) => queues.ledgerFanout.add('fanout', LedgerFanoutJob.parse(b)),
  export: (b) => queues.deletion.add(DELETION_JOB.export, ExportJob.parse(b)),
  delete: (b) => queues.deletion.add(DELETION_JOB.delete, DeletionJob.parse(b)),
  purge_audio: (b) =>
    queues.deletion.add(DELETION_JOB.purgeAudio, PurgeAudioJob.parse(b)),
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 1_000_000) throw new Error('request body too large');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && path === '/health') {
    send(res, 200, { ok: true, service: 'workers' });
    return;
  }

  if (req.method === 'POST' && path.startsWith('/trigger/')) {
    // Auth: shared header must equal AUTH_SECRET (and AUTH_SECRET must be set).
    const key = req.headers['x-trigger-key'];
    if (!AUTH_SECRET) {
      send(res, 503, { ok: false, error: 'AUTH_SECRET not configured' });
      return;
    }
    if (key !== AUTH_SECRET) {
      send(res, 401, { ok: false, error: 'invalid trigger key' });
      return;
    }

    const jobName = decodeURIComponent(path.slice('/trigger/'.length));

    if (isScheduleName(jobName)) {
      await runScheduleNow(jobName);
      log.info(SCOPE, 'triggered schedule', { job: jobName });
      send(res, 202, { ok: true, enqueued: jobName, kind: 'schedule' });
      return;
    }

    const trigger = PIPELINE_TRIGGERS[jobName];
    if (trigger) {
      let body: unknown;
      try {
        body = await readBody(req);
      } catch (err) {
        send(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : 'bad body',
        });
        return;
      }
      try {
        await trigger(body);
      } catch (err) {
        send(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : 'invalid payload',
        });
        return;
      }
      log.info(SCOPE, 'triggered pipeline job', { job: jobName });
      send(res, 202, { ok: true, enqueued: jobName, kind: 'pipeline' });
      return;
    }

    send(res, 404, { ok: false, error: `unknown job: ${jobName}` });
    return;
  }

  send(res, 404, { ok: false, error: 'not found' });
}

export function startHttpServer(): Server {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.error(SCOPE, 'request handler error', {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) send(res, 500, { ok: false, error: 'internal error' });
    });
  });
  server.listen(PORT, () => {
    log.info(SCOPE, `listening on :${PORT}`, {
      routes: ['GET /health', 'POST /trigger/:job'],
    });
  });
  return server;
}
