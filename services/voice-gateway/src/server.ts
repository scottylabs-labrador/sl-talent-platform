// HTTP + WebSocket server. GET /health for the Railway healthcheck; WS upgrade
// on /voice/:screenId?token=... . Heartbeat every 15s terminates dead sockets;
// SIGTERM/SIGINT drains gracefully.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import type { Socket } from 'node:net';
import { PORT, HEARTBEAT_MS, isSimulation } from './config.js';
import { ConnectionHandler } from './connection.js';
import { closeRedis } from './redis.js';
import { log } from './log.js';

const VOICE_PATH = /^\/voice\/([^/?]+)/;

const connections = new Set<ConnectionHandler>();

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/';
  if (req.method === 'GET' && (url === '/health' || url.startsWith('/health?'))) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'voice-gateway' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
}

export function createGateway(): { start: () => void } {
  const server = createServer(handleHttp);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = VOICE_PATH.exec(url.pathname);
    if (!match || !match[1]) {
      socket.destroy();
      return;
    }
    const screenId = decodeURIComponent(match[1]);
    const token = url.searchParams.get('token');

    wss.handleUpgrade(req, socket, head, (ws) => {
      const handler = new ConnectionHandler(ws, screenId, token);
      connections.add(handler);
      ws.on('close', () => connections.delete(handler));
      handler.start();
    });
  });

  // Heartbeat: ping everyone; terminate anyone who missed the last pong.
  const heartbeat = setInterval(() => {
    for (const conn of connections) {
      if (!conn.isAlive) {
        conn.terminate();
        connections.delete(conn);
        continue;
      }
      conn.isAlive = false;
      conn.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`received ${signal}, draining`);
    clearInterval(heartbeat);
    await Promise.allSettled([...connections].map((c) => c.shutdown()));
    connections.clear();
    wss.close();
    server.close();
    await closeRedis();
    // Give sockets a beat to flush, then exit.
    setTimeout(() => process.exit(0), 250).unref();
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return {
    start(): void {
      server.listen(PORT, () => {
        log.info(
          `voice-gateway listening on :${PORT} (${isSimulation() ? 'SIMULATION' : 'REAL Cartesia'} mode)`,
        );
      });
    },
  };
}
