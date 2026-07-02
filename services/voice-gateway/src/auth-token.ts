// ─────────────────────────────────────────────────────────────────────────────
// CALL AUTH TOKEN — the contract between the web app and this gateway.
//
// The WS connect URL carries a short-lived token minted by the web app:
//
//     wss://<gateway>/voice/:screenId?token=<TOKEN>
//
// TOKEN FORMAT (keep it simple — this is the exact shape the web CallRoom hook
// must mint, e.g. inside a tRPC `screens.callToken` procedure):
//
//     TOKEN   = base64url(payloadJson) + "." + base64url(hmacSha256(payloadJson, AUTH_SECRET))
//     payload = { "screenId": <uuid>, "studentId": <uuid>, "exp": <unix seconds> }
//
//   - payloadJson is the UTF-8 JSON of the payload object (compact, no spaces).
//   - The signature is HMAC-SHA256 over the *payloadJson bytes* (NOT over the
//     base64url string), keyed by AUTH_SECRET (the same secret Auth.js uses).
//   - base64url is RFC-4648 url-safe, unpadded ('+'→'-', '/'→'_', no '=').
//   - `exp` is Unix time in SECONDS. Mint with a short life (~120s is plenty;
//     the socket only needs the token to open, not for the call's duration).
//
// The gateway verifies: signature matches (constant-time), `exp` is in the
// future, and the payload's screenId equals the :screenId in the path.
//
// Reference minting (web side), for the integrator:
//
//     import { createHmac } from 'node:crypto';
//     const payload = JSON.stringify({ screenId, studentId, exp: Math.floor(Date.now()/1000)+120 });
//     const b64 = (b: Buffer) => b.toString('base64url');
//     const sig = createHmac('sha256', process.env.AUTH_SECRET!).update(payload).digest();
//     const token = `${b64(Buffer.from(payload))}.${b64(sig)}`;
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const CallTokenPayload = z.object({
  screenId: z.string().uuid(),
  studentId: z.string().uuid(),
  exp: z.number().int().positive(),
});
export type CallTokenPayload = z.infer<typeof CallTokenPayload>;

export type VerifyResult =
  | { ok: true; payload: CallTokenPayload }
  | { ok: false; reason: string };

function authSecret(): string | undefined {
  const s = process.env.AUTH_SECRET;
  return s && s.length > 0 ? s : undefined;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** Mint a token. Exposed so the web team (and tests) can reuse the exact codec. */
export function mintCallToken(
  input: { screenId: string; studentId: string; ttlSeconds?: number },
  secret: string = authSecret() ?? '',
): string {
  const payload = JSON.stringify({
    screenId: input.screenId,
    studentId: input.studentId,
    exp: Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? 120),
  });
  const sig = createHmac('sha256', secret).update(payload).digest();
  return `${b64url(Buffer.from(payload, 'utf8'))}.${b64url(sig)}`;
}

/** Verify a token against AUTH_SECRET. Never throws; returns a tagged result. */
export function verifyCallToken(token: string | undefined | null): VerifyResult {
  const secret = authSecret();
  if (!secret) return { ok: false, reason: 'server_missing_auth_secret' };
  if (!token) return { ok: false, reason: 'missing_token' };

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed_token' };

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let payloadBuf: Buffer;
  let sigBuf: Buffer;
  try {
    payloadBuf = Buffer.from(payloadB64, 'base64url');
    sigBuf = Buffer.from(sigB64, 'base64url');
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }

  const expected = createHmac('sha256', secret).update(payloadBuf).digest();
  if (sigBuf.length !== expected.length || !timingSafeEqual(sigBuf, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let json: unknown;
  try {
    json = JSON.parse(payloadBuf.toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad_payload_json' };
  }

  const parsed = CallTokenPayload.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'bad_payload_shape' };

  if (parsed.data.exp * 1000 <= Date.now()) return { ok: false, reason: 'expired' };

  return { ok: true, payload: parsed.data };
}
