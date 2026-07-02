// Per-socket handler: token auth, protocol validation, heartbeat liveness, and
// wiring the browser <-> InterviewSession. One ConnectionHandler per WS.

import { WebSocket } from 'ws';
import { parseClientMsg } from '@tartan/types';
import type { ServerError } from '@tartan/types';
import { verifyCallToken } from './auth-token.js';
import {
  loadSession,
  newSession,
  saveSession,
  type CallSession,
} from './session.js';
import { hasAppConsent } from './store.js';
import { InterviewSession, type Outgoing, isSimulation } from './interview.js';
import { log } from './log.js';

export class ConnectionHandler {
  /** Heartbeat liveness flag, flipped by the server's ping loop. */
  isAlive = true;

  private interview: InterviewSession | undefined;
  private initialized = false;
  private studentId = '';
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly screenId: string,
    private readonly token: string | null,
  ) {}

  start(): void {
    this.ws.binaryType = 'nodebuffer';

    // Authenticate before anything else.
    const v = verifyCallToken(this.token);
    if (!v.ok) {
      this.error('unauthorized', `auth failed: ${v.reason}`);
      this.ws.close(1008, 'unauthorized');
      return;
    }
    if (v.payload.screenId !== this.screenId) {
      this.error('unauthorized', 'token screenId does not match path');
      this.ws.close(1008, 'unauthorized');
      return;
    }
    this.studentId = v.payload.studentId;

    this.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) this.onBinary(data);
      else void this.onText(data);
    });
    this.ws.on('pong', () => {
      this.isAlive = true;
    });
    this.ws.on('close', () => void this.onClose());
    this.ws.on('error', (e) => log.error('ws error', e));
  }

  // ── heartbeat control (called by the server loop) ──────────────────────────

  ping(): void {
    try {
      this.ws.ping();
      this.send({ type: 'ping' });
    } catch {
      /* ignore */
    }
  }

  terminate(): void {
    try {
      this.ws.terminate();
    } catch {
      /* ignore */
    }
  }

  async shutdown(): Promise<void> {
    await this.interview?.stop();
    try {
      this.ws.close(1001, 'server shutting down');
    } catch {
      /* ignore */
    }
  }

  // ── outbound ────────────────────────────────────────────────────────────────

  private send(msg: Outgoing): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private error(code: ServerError['code'], message: string): void {
    this.send({ type: 'error', code, message });
  }

  private closeSocket(code = 1000): void {
    try {
      this.ws.close(code);
    } catch {
      /* ignore */
    }
  }

  // ── inbound ──────────────────────────────────────────────────────────────────

  private onBinary(data: Buffer): void {
    // A binary frame is a 16kHz PCM16 audio chunk (the fast path).
    this.interview?.handleAudio(data);
  }

  private async onText(data: Buffer): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(data.toString('utf8'));
    } catch {
      this.error('bad_message', 'invalid JSON frame');
      return;
    }
    const msg = parseClientMsg(json);
    if (!msg) {
      this.error('bad_message', 'message did not match the client protocol');
      return;
    }

    if (msg.type === 'hello') {
      await this.onHello();
      return;
    }

    // Every other message requires an initialized session.
    if (!this.interview) {
      this.error('session_not_found', 'send a hello frame first');
      return;
    }

    switch (msg.type) {
      case 'consent_confirmed':
        await this.interview.onConsentConfirmed();
        break;
      case 'audio':
        this.interview.handleAudio(Buffer.from(msg.pcm16, 'base64'));
        break;
      case 'pause':
        await this.interview.onPause();
        break;
      case 'resume':
        await this.interview.onResume();
        break;
      case 'end_call':
        await this.interview.end('ended_by_student');
        break;
      case 'pong':
        this.isAlive = true;
        break;
    }
  }

  private async onHello(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const simulated = isSimulation();
    let session: CallSession;
    let resumed = false;

    try {
      const existing = await loadSession(this.screenId);
      if (existing && existing.status === 'active') {
        session = existing;
        resumed = true;
        log.info('resuming call within rejoin window', { screenId: this.screenId });
      } else {
        const consentApp = await hasAppConsent(this.studentId);
        session = newSession({
          screenId: this.screenId,
          studentId: this.studentId,
          simulated,
          consentApp,
        });
        await saveSession(session);
      }
    } catch (e) {
      log.error('session init failed', e);
      this.error('internal', 'could not initialize session');
      this.closeSocket(1011);
      return;
    }

    this.interview = new InterviewSession(session, {
      send: (m) => this.send(m),
      closeSocket: (code) => this.closeSocket(code),
    });

    try {
      await this.interview.start(resumed);
    } catch (e) {
      log.error('interview start failed', e);
      this.error('internal', 'could not start interview');
      this.closeSocket(1011);
    }
  }

  private async onClose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Freeze the session for the 5-minute rejoin window (does NOT end the call).
    await this.interview?.stop();
  }
}
