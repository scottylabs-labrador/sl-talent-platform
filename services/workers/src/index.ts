// workers — the async backbone (ARCHITECTURE sections 4/6/8/9). Boots every
// BullMQ worker, the plain-list BRPOP bridge from the voice-gateway, the
// repeatable schedules, and a tiny http control plane; shuts all of it down
// gracefully on SIGINT/SIGTERM.

import './load-env.js'; // must be first: loads .env before ./env reads env
import type { Server } from 'node:http';
import type { Worker } from 'bullmq';
import { closeDb } from '@tartan/db';
import { log } from './logger.js';
import { CLEANUP_ON_EXIT, DRY_RUN } from './env.js';
import { closeQueues } from './queues.js';
import { startHttpServer } from './http.js';
import { startBridges, type Bridge } from './bridge.js';
import { startSynthesisWorker } from './workers/synthesis.js';
import { startVerificationWorker } from './workers/verification.js';
import { startMatchingWorker } from './workers/matching.js';
import { startLedgerFanoutWorker } from './workers/ledgerFanout.js';
import { startNotificationsWorker } from './workers/notifications.js';
import { startDeletionWorker } from './workers/deletion.js';
import {
  startSchedulesWorker,
  registerSchedules,
  removeSchedules,
} from './schedules/index.js';

const SCOPE = 'main';

let shuttingDown = false;

async function main(): Promise<void> {
  log.info(SCOPE, 'starting workers service', { dryRun: DRY_RUN });

  const httpServer: Server = startHttpServer();

  const workers: Worker[] = [
    startSynthesisWorker(),
    startVerificationWorker(),
    startMatchingWorker(),
    startLedgerFanoutWorker(),
    startNotificationsWorker(),
    startDeletionWorker(),
    startSchedulesWorker(),
  ];
  log.info(SCOPE, 'workers started', { count: workers.length });

  const bridge: Bridge = startBridges();

  await registerSchedules();

  log.info(SCOPE, 'workers service ready');

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(SCOPE, `received ${signal}, shutting down`);

    await bridge.stop().catch(() => undefined);
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
    if (CLEANUP_ON_EXIT) await removeSchedules().catch(() => undefined);
    await closeQueues();
    await closeDb().catch(() => undefined);

    log.info(SCOPE, 'shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error(SCOPE, 'fatal boot error', {
    error: err instanceof Error ? err.stack ?? err.message : String(err),
  });
  process.exit(1);
});
