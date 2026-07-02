// S3 access for the web service: the stream endpoint (presigned GET, 60s TTL,
// inline disposition — sponsors never receive a durable URL) and async-answer
// uploads (student's recorded reply to a sponsor follow-up). The voice gateway
// and workers have their own S3 helpers; this one is web-scoped.

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let _client: S3Client | undefined;

/** Lazy S3 client from env (never constructed at import time). */
export function s3(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
    });
  }
  return _client;
}

function bucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error('S3_BUCKET is not set');
  return b;
}

export interface PresignGetOptions {
  /** URL lifetime in seconds. Stream policy: 60s. */
  ttlSeconds?: number;
  /** inline (stream in the player) vs attachment (download). Default inline. */
  inline?: boolean;
  /** Optional download filename when inline is false. */
  filename?: string;
}

/**
 * Presign a GET for an object. Short TTL + inline disposition is the stream-only
 * enforcement (the ledger stream event is the audit trail). Range requests pass
 * through to the presigned URL so the player can seek.
 */
export async function presignGetUrl(
  key: string,
  opts: PresignGetOptions = {},
): Promise<string> {
  const { ttlSeconds = 60, inline = true, filename } = opts;
  const disposition = inline
    ? 'inline'
    : `attachment${filename ? `; filename="${filename}"` : ''}`;
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ResponseContentDisposition: disposition,
  });
  return getSignedUrl(s3(), command, { expiresIn: ttlSeconds });
}

export interface PutObjectOptions {
  contentType?: string;
}

/** Upload bytes to a key (e.g. a student's async audio answer). */
export async function putObject(
  key: string,
  body: Uint8Array | Buffer | string,
  opts: PutObjectOptions = {},
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: opts.contentType,
    }),
  );
}
