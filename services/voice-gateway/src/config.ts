// Runtime configuration. All read from process.env (the repo .env is symlinked
// into this workspace and loaded via `node --env-file=.env`). Nothing here
// throws at import time so the module graph loads in any environment.

export const PORT = Number(process.env.PORT ?? 8787);

// Heartbeat / liveness.
export const HEARTBEAT_MS = 15_000;

// The state machine emits an elapsed tick at this cadence.
export const ELAPSED_TICK_MS = 1_000;

// Hard budget for a full screen (ARCHITECTURE section 5: 30-minute screen).
export const CALL_BUDGET_MS = 30 * 60_000;

// Redis session TTLs. During an active call we keep a generous TTL; the moment a
// socket drops we shorten it to the 5-minute rejoin window (section 5).
export const ACTIVE_SESSION_TTL_SECONDS = 40 * 60;
export const RESUME_WINDOW_SECONDS = 5 * 60;

// End-of-turn silence threshold for VAD in the real pipeline (section 5: ~700ms).
export const VAD_SILENCE_MS = 700;

// Simulation pacing: seconds per section on the compressed demo schedule.
// Six sections * 12s => a full demo call runs in ~72s.
export const SIM_SECTION_SECONDS = Number(process.env.SIM_SECTION_SECONDS ?? 12);

// Browser mic format (AudioWorklet): 16kHz mono PCM16.
export const AUDIO_SAMPLE_RATE = 16_000;
export const AUDIO_CHANNELS = 1;
export const AUDIO_BITS_PER_SAMPLE = 16;

// S3 (raw call audio). Empty bucket disables uploads (they are simply skipped
// and logged) so the service still runs in a laptop demo.
export const S3_BUCKET = process.env.S3_BUCKET ?? '';
export const S3_REGION = process.env.S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';

// Cost model (ARCHITECTURE section 5: ~$2 to $5 per 30-min screen). Rough
// per-minute estimate for Cartesia STT + TTS combined; LLM cost comes from the
// per-call usage runAgent already captures. Overridable per env.
export const CARTESIA_USD_PER_MINUTE = Number(
  process.env.CARTESIA_USD_PER_MINUTE ?? 0.06,
);

/** The Cartesia API key, or undefined when unset/blank (simulation default). */
export function cartesiaKey(): string | undefined {
  const k = process.env.CARTESIA_API_KEY;
  return k && k.trim().length > 0 ? k.trim() : undefined;
}

/**
 * True when no Cartesia key is present, or when VOICE_SIMULATION=true forces
 * the scripted simulation even with a key configured (demo/e2e safety valve).
 */
export function isSimulation(): boolean {
  if (process.env.VOICE_SIMULATION === 'true') return true;
  return cartesiaKey() === undefined;
}

// Cartesia model + endpoints (real pipeline). Overridable per env.
export const CARTESIA_VERSION = process.env.CARTESIA_VERSION ?? '2024-11-13';
export const CARTESIA_STT_MODEL = process.env.CARTESIA_STT_MODEL ?? 'ink-whisper';
export const CARTESIA_TTS_MODEL = process.env.CARTESIA_TTS_MODEL ?? 'sonic-2';
export const CARTESIA_TTS_VOICE =
  process.env.CARTESIA_TTS_VOICE ?? '694f9389-aac1-45b6-b726-9d9369183238';
export const CARTESIA_STT_URL =
  process.env.CARTESIA_STT_URL ?? 'wss://api.cartesia.ai/stt/websocket';
export const CARTESIA_TTS_URL =
  process.env.CARTESIA_TTS_URL ?? 'wss://api.cartesia.ai/tts/websocket';
