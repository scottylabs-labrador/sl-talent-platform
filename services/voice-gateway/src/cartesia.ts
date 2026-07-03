// Cartesia streaming STT (ink-whisper, word timestamps) and Sonic TTS clients
// for the REAL pipeline (ARCHITECTURE section 5). These run only when
// CARTESIA_API_KEY is set; the demo default is simulation mode, so this path is
// implemented to Cartesia's documented WS API shape but is UNTESTED here (no key
// in dev). All failures are contained and reported via callbacks, never thrown
// into the socket loop.

import { WebSocket } from 'ws';
import {
  cartesiaKey,
  CARTESIA_VERSION,
  CARTESIA_STT_MODEL,
  CARTESIA_STT_URL,
  CARTESIA_TTS_MODEL,
  CARTESIA_TTS_URL,
  CARTESIA_TTS_VOICE,
  AUDIO_SAMPLE_RATE,
} from './config.js';
import type { TranscriptWord } from '@tartan/types';

// ── STT ──────────────────────────────────────────────────────────────────────

export interface SttWord {
  word: string;
  start: number; // seconds
  end: number;
}

export interface SttCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string, words: SttWord[]) => void;
  onError?: (err: unknown) => void;
}

export class CartesiaSttClient {
  private ws: WebSocket | undefined;
  private open = false;
  private queue: Buffer[] = [];

  constructor(private readonly cb: SttCallbacks) {}

  connect(): void {
    const key = cartesiaKey();
    if (!key) return;
    const url =
      `${CARTESIA_STT_URL}?api_key=${encodeURIComponent(key)}` +
      `&cartesia_version=${encodeURIComponent(CARTESIA_VERSION)}` +
      `&model=${encodeURIComponent(CARTESIA_STT_MODEL)}` +
      `&encoding=pcm_s16le&sample_rate=${AUDIO_SAMPLE_RATE}&language=en`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.binaryType = 'nodebuffer';
    ws.on('open', () => {
      this.open = true;
      for (const b of this.queue) ws.send(b);
      this.queue = [];
    });
    ws.on('message', (data: Buffer) => this.onMessage(data));
    ws.on('error', (e) => this.cb.onError?.(e));
    ws.on('close', () => {
      this.open = false;
    });
  }

  private onMessage(data: Buffer): void {
    let msg: {
      type?: string;
      text?: string;
      is_final?: boolean;
      words?: { word: string; start: number; end: number }[];
    };
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (msg.type === 'transcript' && typeof msg.text === 'string') {
      if (msg.is_final) {
        const words: SttWord[] = (msg.words ?? []).map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
        }));
        this.cb.onFinal(msg.text, words);
      } else {
        this.cb.onPartial(msg.text);
      }
    }
  }

  sendAudio(pcm: Buffer): void {
    if (!this.ws) return;
    if (this.open) this.ws.send(pcm);
    else this.queue.push(pcm);
  }

  /** Tell Cartesia to flush a final for the current utterance. The ink-whisper
   *  WS protocol expects the bare command string `finalize` (NOT a JSON frame);
   *  it replies with a final transcript then a `flush_done`. */
  finalize(): void {
    if (this.ws && this.open) {
      try {
        this.ws.send('finalize');
      } catch {
        /* ignore */
      }
    }
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = undefined;
    this.open = false;
  }
}

export function toTranscriptWords(
  words: SttWord[],
  speaker: 'rep' | 'student',
): TranscriptWord[] {
  return words.map((w) => ({
    word: w.word,
    t0: Math.round(w.start * 1000),
    t1: Math.round(w.end * 1000),
    speaker,
  }));
}

// ── TTS ──────────────────────────────────────────────────────────────────────

export interface TtsCallbacks {
  onChunk: (audioBase64: string) => void;
  onDone: () => void;
  onError?: (err: unknown) => void;
}

/**
 * Speak `text` via Cartesia Sonic over a one-shot WS. `contextId` lets the
 * caller continue a prior context (Cartesia's continuation API) for smoother
 * multi-sentence prosody; pass the same id across sentence chunks of one turn.
 */
export function cartesiaTts(
  text: string,
  contextId: string,
  cb: TtsCallbacks,
  opts?: { continue?: boolean },
): void {
  const key = cartesiaKey();
  if (!key) {
    cb.onDone();
    return;
  }
  const url =
    `${CARTESIA_TTS_URL}?api_key=${encodeURIComponent(key)}` +
    `&cartesia_version=${encodeURIComponent(CARTESIA_VERSION)}`;
  const ws = new WebSocket(url);
  ws.binaryType = 'nodebuffer';
  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        model_id: CARTESIA_TTS_MODEL,
        transcript: text,
        voice: { mode: 'id', id: CARTESIA_TTS_VOICE },
        language: 'en',
        context_id: contextId,
        continue: opts?.continue ?? false,
        output_format: {
          container: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: AUDIO_SAMPLE_RATE,
        },
      }),
    );
  });
  ws.on('message', (data: Buffer) => {
    let msg: { type?: string; data?: string };
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    if (msg.type === 'chunk' && typeof msg.data === 'string') {
      cb.onChunk(msg.data);
    } else if (msg.type === 'done') {
      cb.onDone();
      ws.close();
    } else if (msg.type === 'error') {
      cb.onError?.(new Error('cartesia tts error'));
      ws.close();
    }
  });
  ws.on('error', (e) => {
    cb.onError?.(e);
  });
  ws.on('close', () => {
    /* onDone already fired on 'done' */
  });
}
