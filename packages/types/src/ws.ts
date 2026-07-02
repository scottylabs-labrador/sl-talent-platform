// Voice WS protocol — the discriminated unions shared by voice-gateway and the
// browser CallRoom client (ARCHITECTURE.md sections 5 and 7). Both sides import
// these zod schemas; the client parses ServerMsg, the gateway parses ClientMsg.
//
// Audio transport: control + small audio frames travel as JSON text frames
// ({type:'audio', ...} base64 pcm16). The gateway ALSO accepts raw binary WS
// frames as a fast path for 16kHz PCM (see BINARY_AUDIO_FRAME note) — a binary
// frame is treated exactly like an {type:'audio'} message with an implicit
// increasing seq. Prefer binary frames in production; JSON audio is the
// portable fallback and what the schema below documents.

import { z } from 'zod';

// ── Client → Server ───────────────────────────────────────────────────────

export const ClientHello = z.object({
  type: z.literal('hello'),
  screenId: z.string().uuid(),
  // Present when rejoining an interrupted call within the 5-min window.
  resumeToken: z.string().optional(),
});
export type ClientHello = z.infer<typeof ClientHello>;

export const ClientConsentConfirmed = z.object({
  type: z.literal('consent_confirmed'),
});
export type ClientConsentConfirmed = z.infer<typeof ClientConsentConfirmed>;

export const ClientAudio = z.object({
  type: z.literal('audio'),
  seq: z.number().int().nonnegative(),
  // base64-encoded 16kHz mono PCM16 chunk. (Binary frames are the fast path.)
  pcm16: z.string(),
});
export type ClientAudio = z.infer<typeof ClientAudio>;

export const ClientPause = z.object({ type: z.literal('pause') });
export type ClientPause = z.infer<typeof ClientPause>;

export const ClientResume = z.object({ type: z.literal('resume') });
export type ClientResume = z.infer<typeof ClientResume>;

export const ClientEndCall = z.object({ type: z.literal('end_call') });
export type ClientEndCall = z.infer<typeof ClientEndCall>;

export const ClientPong = z.object({ type: z.literal('pong') });
export type ClientPong = z.infer<typeof ClientPong>;

export const ClientMsg = z.discriminatedUnion('type', [
  ClientHello,
  ClientConsentConfirmed,
  ClientAudio,
  ClientPause,
  ClientResume,
  ClientEndCall,
  ClientPong,
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

// ── Server → Client ───────────────────────────────────────────────────────

export const ServerReady = z.object({
  type: z.literal('ready'),
  // True when the gateway runs the scripted simulation (no Cartesia key or
  // VOICE_SIMULATION=true). Clients skip mic capture in simulated sessions.
  simulated: z.boolean().optional(),
  // Per-call rejoin credential. The signed call token is single-use and
  // short-lived; a dropped client reconnects with ?resume=<this> within the
  // 5-minute rejoin window.
  resumeToken: z.string().optional(),
});
export type ServerReady = z.infer<typeof ServerReady>;

export const ServerCaption = z.object({
  type: z.literal('caption'),
  turnId: z.string(),
  speaker: z.enum(['rep', 'student']),
  text: z.string(),
  // partial (interim ASR) vs final segment.
  partial: z.boolean(),
});
export type ServerCaption = z.infer<typeof ServerCaption>;

export const ServerSection = z.object({
  type: z.literal('section'),
  index: z.number().int().nonnegative(),
  name: z.string(),
  startedAtMs: z.number().int().nonnegative(),
});
export type ServerSection = z.infer<typeof ServerSection>;

export const ServerConsentAck = z.object({ type: z.literal('consent_ack') });
export type ServerConsentAck = z.infer<typeof ServerConsentAck>;

export const ServerMomentMarked = z.object({
  type: z.literal('moment_marked'),
  tag: z.string(),
  note: z.string().optional(),
});
export type ServerMomentMarked = z.infer<typeof ServerMomentMarked>;

export const ServerTtsChunk = z.object({
  type: z.literal('tts_chunk'),
  seq: z.number().int().nonnegative(),
  // base64-encoded audio chunk from Cartesia Sonic.
  audio: z.string(),
});
export type ServerTtsChunk = z.infer<typeof ServerTtsChunk>;

export const ServerTtsEnd = z.object({
  type: z.literal('tts_end'),
  turnId: z.string(),
});
export type ServerTtsEnd = z.infer<typeof ServerTtsEnd>;

export const ServerElapsed = z.object({
  type: z.literal('elapsed'),
  ms: z.number().int().nonnegative(),
});
export type ServerElapsed = z.infer<typeof ServerElapsed>;

export const ServerPing = z.object({ type: z.literal('ping') });
export type ServerPing = z.infer<typeof ServerPing>;

export const serverEndedReasonValues = [
  'completed',
  'ended_by_student',
  'consent_declined',
  'incomplete_timeout',
  'error',
] as const;
export const ServerEnded = z.object({
  type: z.literal('ended'),
  reason: z.enum(serverEndedReasonValues),
});
export type ServerEnded = z.infer<typeof ServerEnded>;

export const serverErrorCodeValues = [
  'bad_message',
  'unauthorized',
  'consent_required',
  'session_not_found',
  'session_expired',
  'stt_failure',
  'tts_failure',
  'llm_failure',
  'internal',
] as const;
export const ServerError = z.object({
  type: z.literal('error'),
  code: z.enum(serverErrorCodeValues),
  message: z.string(),
});
export type ServerError = z.infer<typeof ServerError>;

export const ServerMsg = z.discriminatedUnion('type', [
  ServerReady,
  ServerCaption,
  ServerSection,
  ServerConsentAck,
  ServerMomentMarked,
  ServerTtsChunk,
  ServerTtsEnd,
  ServerElapsed,
  ServerPing,
  ServerEnded,
  ServerError,
]);
export type ServerMsg = z.infer<typeof ServerMsg>;

// The six interview sections the Rep drives via advance_section, in order.
export const interviewSectionValues = [
  'intro_consent',
  'background',
  'experience_deep_dive_1',
  'experience_deep_dive_2',
  'technical_probe',
  'student_questions',
] as const;
export type InterviewSection = (typeof interviewSectionValues)[number];

// ── Type guards ─────────────────────────────────────────────────────────
// Narrowing helpers so consumers do not re-implement discriminant checks.

export function isClientMsg(v: unknown): v is ClientMsg {
  return ClientMsg.safeParse(v).success;
}
export function isServerMsg(v: unknown): v is ServerMsg {
  return ServerMsg.safeParse(v).success;
}

export function isClientMsgOfType<T extends ClientMsg['type']>(
  msg: ClientMsg,
  type: T,
): msg is Extract<ClientMsg, { type: T }> {
  return msg.type === type;
}
export function isServerMsgOfType<T extends ServerMsg['type']>(
  msg: ServerMsg,
  type: T,
): msg is Extract<ServerMsg, { type: T }> {
  return msg.type === type;
}

// Parse-and-narrow: returns the typed message or null (no throw). Use on the
// wire where a malformed frame must not crash the socket loop.
export function parseClientMsg(v: unknown): ClientMsg | null {
  const r = ClientMsg.safeParse(v);
  return r.success ? r.data : null;
}
export function parseServerMsg(v: unknown): ServerMsg | null {
  const r = ServerMsg.safeParse(v);
  return r.success ? r.data : null;
}
