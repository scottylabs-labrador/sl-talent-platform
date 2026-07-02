// Minimal WAV (PCM) container helpers.
//
// v1 DIVERGENCE (documented in the brief): the spec's bucket layout is
// raw/{screen_id}.ogg (opus). A pure-JS opus encoder is not an installed
// dependency, so we upload WAV-wrapped PCM16 as raw/{screenId}.wav instead.
// The synthesis worker consumes word timestamps from screens.transcript; the
// raw audio object is for clip cutting and can be transcoded later.

import { AUDIO_BITS_PER_SAMPLE, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from './config.js';

const HEADER_BYTES = 44;

/** Canonical 44-byte WAV header for a known PCM data length. */
export function wavHeader(dataLength: number): Buffer {
  const h = Buffer.alloc(HEADER_BYTES);
  const byteRate =
    (AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * AUDIO_BITS_PER_SAMPLE) / 8;
  const blockAlign = (AUDIO_CHANNELS * AUDIO_BITS_PER_SAMPLE) / 8;

  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataLength, 4); // RIFF chunk size
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16); // PCM fmt chunk size
  h.writeUInt16LE(1, 20); // audio format = PCM
  h.writeUInt16LE(AUDIO_CHANNELS, 22);
  h.writeUInt32LE(AUDIO_SAMPLE_RATE, 24);
  h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(AUDIO_BITS_PER_SAMPLE, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataLength, 40);
  return h;
}

/**
 * Streaming WAV header: the data length is unknown when a multipart upload
 * begins, so we write 0xFFFFFFFF for the sizes. Most players (and ffmpeg, which
 * the worker uses to cut clips) tolerate this "streaming WAV" form. When the
 * full PCM is buffered we instead use wavHeader() with the real length.
 */
export function streamingWavHeader(): Buffer {
  const h = wavHeader(0);
  h.writeUInt32LE(0xffffffff, 4);
  h.writeUInt32LE(0xffffffff, 40);
  return h;
}

/** Wrap a complete PCM16 buffer as a self-describing WAV file. */
export function wrapPcmAsWav(pcm: Buffer): Buffer {
  return Buffer.concat([wavHeader(pcm.length), pcm]);
}
