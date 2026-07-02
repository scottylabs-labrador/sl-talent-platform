// Consent-gated raw audio upload to S3 via multipart (ARCHITECTURE section 4).
//
// The uploader is only ever constructed AFTER both consent gates pass (in-app
// consent row + verbal confirmation). Until then, audio lives only in memory on
// the InterviewSession and is dropped if consent is declined or the call is
// abandoned pre-consent.
//
// v1 DIVERGENCE: object is raw/{screenId}.wav (WAV-wrapped PCM16), not .ogg/opus
// — no opus encoder is installed and we do not add deps. See wav.ts.

import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { S3_BUCKET, S3_REGION } from './config.js';
import { streamingWavHeader } from './wav.js';
import { log } from './log.js';

const PART_SIZE = 5 * 1024 * 1024; // S3 minimum part size (except the last part)

let _client: S3Client | undefined;
function client(): S3Client {
  if (!_client) _client = new S3Client({ region: S3_REGION });
  return _client;
}

export function audioKeyFor(screenId: string): string {
  return `raw/${screenId}.wav`;
}

/** True when S3 is configured; when false, uploads are skipped (laptop demo). */
export function s3Enabled(): boolean {
  return Boolean(S3_BUCKET) && Boolean(process.env.AWS_ACCESS_KEY_ID);
}

export class AudioUploader {
  readonly key: string;
  private uploadId: string | undefined;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private parts: CompletedPart[] = [];
  private partNumber = 0;
  private started = false;
  private failed = false;

  constructor(private readonly screenId: string) {
    this.key = audioKeyFor(screenId);
  }

  /** Open the multipart upload and prime the streaming WAV header. */
  async begin(): Promise<void> {
    if (this.started || !s3Enabled()) return;
    this.started = true;
    try {
      const res = await client().send(
        new CreateMultipartUploadCommand({
          Bucket: S3_BUCKET,
          Key: this.key,
          ContentType: 'audio/wav',
        }),
      );
      this.uploadId = res.UploadId;
      this.push(streamingWavHeader());
      log.info('audio upload started', { screenId: this.screenId, key: this.key });
    } catch (e) {
      this.failed = true;
      log.error('audio upload begin failed', e);
    }
  }

  private push(chunk: Buffer): void {
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
  }

  /** Buffer a PCM chunk; flush a part once we cross the 5MB threshold. */
  async write(pcm: Buffer): Promise<void> {
    if (!this.uploadId || this.failed) return;
    this.push(pcm);
    if (this.pendingBytes >= PART_SIZE) await this.flushPart();
  }

  private async flushPart(): Promise<void> {
    if (!this.uploadId || this.pendingBytes === 0) return;
    const body = Buffer.concat(this.pending, this.pendingBytes);
    this.pending = [];
    this.pendingBytes = 0;
    this.partNumber += 1;
    const pn = this.partNumber;
    try {
      const res = await client().send(
        new UploadPartCommand({
          Bucket: S3_BUCKET,
          Key: this.key,
          UploadId: this.uploadId,
          PartNumber: pn,
          Body: body,
        }),
      );
      this.parts.push({ ETag: res.ETag, PartNumber: pn });
    } catch (e) {
      this.failed = true;
      log.error('audio upload part failed', e);
    }
  }

  /** Flush the remaining bytes and complete. Returns the object key or null. */
  async finish(): Promise<string | null> {
    if (!this.uploadId) return null;
    if (this.failed) {
      await this.abort();
      return null;
    }
    await this.flushPart();
    if (this.parts.length === 0) {
      await this.abort();
      return null;
    }
    try {
      await client().send(
        new CompleteMultipartUploadCommand({
          Bucket: S3_BUCKET,
          Key: this.key,
          UploadId: this.uploadId,
          MultipartUpload: { Parts: this.parts },
        }),
      );
      log.info('audio upload completed', { key: this.key, parts: this.parts.length });
      return this.key;
    } catch (e) {
      log.error('audio upload complete failed', e);
      await this.abort();
      return null;
    }
  }

  /** Abort the upload and discard any uploaded parts (consent declined path). */
  async abort(): Promise<void> {
    if (!this.uploadId) return;
    const uploadId = this.uploadId;
    this.uploadId = undefined;
    try {
      await client().send(
        new AbortMultipartUploadCommand({
          Bucket: S3_BUCKET,
          Key: this.key,
          UploadId: uploadId,
        }),
      );
      log.info('audio upload aborted', { key: this.key });
    } catch (e) {
      log.error('audio upload abort failed', e);
    }
  }
}
