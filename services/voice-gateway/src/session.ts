// Call session state, persisted as a Redis hash session:{screenId} so a student
// who drops can rejoin within 5 minutes to the same section, elapsed time,
// transcript cursor, and consent state (ARCHITECTURE section 5).
//
// Elapsed time is derived from wall-clock (callStartEpoch + pausedMs) rather
// than a counter, so it stays correct across a disconnect/rejoin with no ticking
// process in between.

import { randomUUID } from 'node:crypto';
import { getRedis } from './redis.js';
import {
  ACTIVE_SESSION_TTL_SECONDS,
  RESUME_WINDOW_SECONDS,
} from './config.js';

export interface CallSession {
  screenId: string;
  studentId: string;
  /**
   * Random per-call rejoin credential. The signed call token is single-use
   * and expires in ~2 minutes; a dropped client reconnects with this token
   * (handed over in the ready frame) within the 5-minute rejoin window.
   */
  resumeToken: string;
  /** Current section index (0..5). */
  sectionIndex: number;
  /** Wall-clock ms when the call started. */
  callStartEpoch: number;
  /** Accumulated paused duration in ms (frozen intervals). */
  pausedMs: number;
  /** Epoch ms when the current pause began, or null if running. */
  pausedAtEpoch: number | null;
  /** Number of transcript words already persisted to screens.transcript. */
  transcriptCursor: number;
  /** In-app consent row exists and is granted (consents table). */
  consentApp: boolean;
  /** Verbal consent confirmed by the Rep tool call. */
  consentVerbal: boolean;
  /** True once S3 upload has begun (both consent gates passed). */
  recording: boolean;
  simulated: boolean;
  status: 'active' | 'ended';
}

function key(screenId: string): string {
  return `session:${screenId}`;
}

function serialize(s: CallSession): Record<string, string> {
  return {
    screenId: s.screenId,
    studentId: s.studentId,
    resumeToken: s.resumeToken,
    sectionIndex: String(s.sectionIndex),
    callStartEpoch: String(s.callStartEpoch),
    pausedMs: String(s.pausedMs),
    pausedAtEpoch: s.pausedAtEpoch === null ? '' : String(s.pausedAtEpoch),
    transcriptCursor: String(s.transcriptCursor),
    consentApp: s.consentApp ? '1' : '0',
    consentVerbal: s.consentVerbal ? '1' : '0',
    recording: s.recording ? '1' : '0',
    simulated: s.simulated ? '1' : '0',
    status: s.status,
  };
}

function deserialize(h: Record<string, string>): CallSession | null {
  if (!h.screenId || !h.studentId) return null;
  return {
    screenId: h.screenId,
    studentId: h.studentId,
    resumeToken: h.resumeToken ?? '',
    sectionIndex: Number(h.sectionIndex ?? '0'),
    callStartEpoch: Number(h.callStartEpoch ?? '0'),
    pausedMs: Number(h.pausedMs ?? '0'),
    pausedAtEpoch: h.pausedAtEpoch ? Number(h.pausedAtEpoch) : null,
    transcriptCursor: Number(h.transcriptCursor ?? '0'),
    consentApp: h.consentApp === '1',
    consentVerbal: h.consentVerbal === '1',
    recording: h.recording === '1',
    simulated: h.simulated === '1',
    status: h.status === 'ended' ? 'ended' : 'active',
  };
}

export function newSession(input: {
  screenId: string;
  studentId: string;
  simulated: boolean;
  consentApp: boolean;
}): CallSession {
  return {
    screenId: input.screenId,
    studentId: input.studentId,
    resumeToken: randomUUID(),
    sectionIndex: 0,
    callStartEpoch: Date.now(),
    pausedMs: 0,
    pausedAtEpoch: null,
    transcriptCursor: 0,
    consentApp: input.consentApp,
    consentVerbal: false,
    recording: false,
    simulated: input.simulated,
    status: 'active',
  };
}

/** Elapsed ms since the call started, excluding paused spans. */
export function elapsedMs(s: CallSession): number {
  const end = s.pausedAtEpoch ?? Date.now();
  return Math.max(0, end - s.callStartEpoch - s.pausedMs);
}

/** True if BOTH consent gates are satisfied (S3 write is permitted). */
export function consentSatisfied(s: CallSession): boolean {
  return s.consentApp && s.consentVerbal;
}

export async function saveSession(s: CallSession): Promise<void> {
  const r = getRedis();
  await r.hset(key(s.screenId), serialize(s));
  await r.expire(key(s.screenId), ACTIVE_SESSION_TTL_SECONDS);
}

export async function loadSession(screenId: string): Promise<CallSession | null> {
  const h = await getRedis().hgetall(key(screenId));
  if (!h || Object.keys(h).length === 0) return null;
  return deserialize(h);
}

/** Shorten the TTL to the 5-minute rejoin window after a socket drops. */
export async function markResumable(screenId: string): Promise<void> {
  await getRedis().expire(key(screenId), RESUME_WINDOW_SECONDS);
}

export async function deleteSession(screenId: string): Promise<void> {
  await getRedis().del(key(screenId));
}
