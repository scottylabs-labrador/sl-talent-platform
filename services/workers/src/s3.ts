// S3 access for audio (raw/{screenId}.ogg, clips/{momentId}.mp3) and exports
// (exports/{studentId}.json). Private bucket, SSE-S3 (ARCHITECTURE section 4).
//
// Presigning: @aws-sdk/s3-request-presigner is not installed, so presignGetUrl()
// implements AWS Signature V4 query-string signing with node:crypto directly
// (no new dependency). Used only for the 24h export URL — audio is never handed
// to sponsors as an S3 URL (the web's /api/stream route owns that with 60s TTLs).

import { createHash, createHmac } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { S3_BUCKET, S3_REGION } from './env.js';
import { log } from './logger.js';

let _client: S3Client | undefined;
function client(): S3Client {
  if (!_client) _client = new S3Client({ region: S3_REGION });
  return _client;
}

export function rawKey(screenId: string): string {
  return `raw/${screenId}.ogg`;
}
export function clipKey(momentId: string): string {
  return `clips/${momentId}.mp3`;
}
export function exportKey(studentId: string): string {
  return `exports/${studentId}.json`;
}

/** Download an object to a local file path (ffmpeg needs a seekable input). */
export async function getObjectToFile(key: string, destPath: string): Promise<void> {
  const res = await client().send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
  );
  const body = res.Body;
  if (!body) throw new Error(`empty S3 body for ${key}`);
  await pipeline(body as Readable, createWriteStream(destPath));
}

export async function putFile(
  key: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  const buf = await readFile(filePath);
  await putBytes(key, buf, contentType);
}

export async function putBytes(
  key: string,
  body: Uint8Array | string,
  contentType: string,
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** Delete a set of keys. No-op on empty input. Best-effort per AWS batch limits. */
export async function deleteKeys(keys: string[]): Promise<number> {
  const present = keys.filter(Boolean);
  if (present.length === 0) return 0;
  let deleted = 0;
  // DeleteObjects takes up to 1000 keys per call.
  for (let i = 0; i < present.length; i += 1000) {
    const batch = present.slice(i, i + 1000);
    const res = await client().send(
      new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    deleted += batch.length - (res.Errors?.length ?? 0);
    if (res.Errors && res.Errors.length > 0) {
      log.warn('s3', 'some deletes failed', { count: res.Errors.length });
    }
  }
  return deleted;
}

/** List every key under a prefix (paginated). */
export async function listPrefix(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await client().send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const o of res.Contents ?? []) if (o.Key) out.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export async function safeUnlink(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}

// ── SigV4 presigned GET (query-string) ───────────────────────────────────────

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}
function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}
function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}
// Path segments: encode each segment but keep the slashes.
function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeRfc3986(seg))
    .join('/');
}

/**
 * Presign a GET for `key`, valid for `expiresSeconds` (default 24h). Returns a
 * fully-qualified https URL. Reads static credentials from the environment.
 */
export function presignGetUrl(key: string, expiresSeconds = 86400): string {
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  if (!accessKey || !secretKey) {
    throw new Error('AWS credentials not set; cannot presign export URL');
  }

  const region = S3_REGION;
  const host = `${S3_BUCKET}.s3.${region}.amazonaws.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const params = new Map<string, string>([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKey}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ]);
  if (sessionToken) params.set('X-Amz-Security-Token', sessionToken);

  const canonicalQuery = [...params.entries()]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const canonicalUri = `/${encodeKeyPath(key)}`;
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function s3Configured(): boolean {
  return Boolean(S3_BUCKET);
}
