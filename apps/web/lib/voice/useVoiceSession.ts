'use client';

// useVoiceSession — the browser side of the CallRoom live call. Opens the WS to
// the voice-gateway (WS_URL/voice/:screenId?token=...), speaks the @tartan/types
// ClientMsg/ServerMsg protocol, and exposes a small React-friendly surface for
// the CallRoom UI.
//
// Transport notes:
//  - The gateway's `ready` frame carries an extra `simulated` boolean (a superset
//    of ServerReady). We read it straight off the raw JSON, not through the strict
//    zod schema (which would strip it).
//  - REAL (Cartesia) mode: capture the mic via an AudioWorklet that downsamples to
//    16 kHz PCM16 and stream it as binary WS frames. SIMULATION mode (the demo
//    default, no Cartesia key): we never touch the mic.
//  - TTS: `tts_chunk` frames are decoded best-effort through WebAudio. In
//    simulation there is usually no audio; the visual voice bars animate anyway.
//  - Reconnect: if the socket drops unexpectedly within 5 minutes of the call
//    start, we re-open and re-`hello` with the resume token (the gateway holds the
//    session for the rejoin window).

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseServerMsg } from '@tartan/types';
import { PCM_WORKLET_SOURCE } from './pcm-worklet';

export interface CaptionTurn {
  turnId: string;
  speaker: 'rep' | 'student';
  text: string;
  partial: boolean;
}

export interface SectionDef {
  index: number;
  name: string;
  sub: string;
}

// Mirrors services/voice-gateway/src/sections.ts (arc labels + subs).
export const CALL_SECTIONS: readonly SectionDef[] = [
  { index: 0, name: 'Consent', sub: 'Intro and verbal consent' },
  { index: 1, name: 'Walkthrough', sub: 'Background and the shape of your work' },
  { index: 2, name: 'Deep dive 1', sub: 'Consensus under partition, 15-440' },
  { index: 3, name: 'Deep dive 2', sub: 'RailTrace, TartanHacks 2026' },
  { index: 4, name: 'Domain', sub: 'Domain drill, calibrated to 15-440' },
  { index: 5, name: 'Wrap', sub: 'Your questions, and what happens next' },
];

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export interface VoiceSessionOptions {
  wsUrl: string | null; // base, e.g. wss://gateway/voice/:screenId
  token: string | null;
  screenId: string;
  enabled: boolean; // flip true once the student starts the call
  simulatedHint?: boolean; // from startCall; authoritative flag comes off `ready`
}

export interface VoiceSession {
  status: VoiceStatus;
  sections: readonly SectionDef[];
  currentSection: number;
  elapsed: number; // ms
  captions: CaptionTurn[];
  consentAcked: boolean;
  simulated: boolean;
  paused: boolean;
  endedReason: string | null;
  error: string | null;
  pause: () => void;
  resume: () => void;
  endCall: () => void;
}

const RESUME_WINDOW_MS = 5 * 60_000;

export function useVoiceSession(opts: VoiceSessionOptions): VoiceSession {
  const { wsUrl, token, screenId, enabled, simulatedHint } = opts;

  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [currentSection, setCurrentSection] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [captions, setCaptions] = useState<CaptionTurn[]>([]);
  const [consentAcked, setConsentAcked] = useState(false);
  const [simulated, setSimulated] = useState(simulatedHint ?? true);
  const [paused, setPaused] = useState(false);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const startedAtRef = useRef<number>(0);
  const intentionalCloseRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTokenRef = useRef<string | null>(null);

  // audio in/out (real mode only)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playTimeRef = useRef(0);

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // ── TTS playback (best-effort) ─────────────────────────────────────────────
  const playTts = useCallback((b64: string) => {
    try {
      let ctx = playCtxRef.current;
      if (!ctx) {
        ctx = new AudioContext();
        playCtxRef.current = ctx;
        playTimeRef.current = ctx.currentTime;
      }
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      void ctx.decodeAudioData(bytes.buffer.slice(0)).then((buf) => {
        const node = ctx!.createBufferSource();
        node.buffer = buf;
        node.connect(ctx!.destination);
        const at = Math.max(ctx!.currentTime, playTimeRef.current);
        node.start(at);
        playTimeRef.current = at + buf.duration;
      }).catch(() => {
        /* partial/opaque chunk — skip, the visual bars carry the moment */
      });
    } catch {
      /* ignore */
    }
  }, []);

  // ── mic capture (real mode only) ───────────────────────────────────────────
  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const blob = new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' });
      const moduleUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'pcm16-downsample', {
        processorOptions: { targetRate: 16000 },
      });
      workletNodeRef.current = node;
      node.port.onmessage = (e: MessageEvent) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && !intentionalCloseRef.current) {
          ws.send(e.data as ArrayBuffer); // binary PCM16 fast path
        }
      };
      source.connect(node);
      // Keep the graph alive without echoing mic to speakers.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(ctx.destination);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'microphone unavailable');
    }
  }, []);

  const stopMic = useCallback(() => {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  const handleMessage = useCallback(
    (raw: unknown) => {
      const msg = parseServerMsg(raw);
      if (!msg) return;
      switch (msg.type) {
        case 'ready': {
          setStatus('live');
          const sim =
            typeof (raw as { simulated?: unknown }).simulated === 'boolean'
              ? (raw as { simulated: boolean }).simulated
              : (simulatedHint ?? true);
          setSimulated(sim);
          const rt = (raw as { resumeToken?: unknown }).resumeToken;
          if (typeof rt === 'string' && rt) resumeTokenRef.current = rt;
          // We already collected app consent on the consent screen; confirm it.
          send({ type: 'consent_confirmed' });
          if (!sim) void startMic();
          break;
        }
        case 'consent_ack':
          setConsentAcked(true);
          break;
        case 'section':
          setCurrentSection(msg.index);
          break;
        case 'elapsed':
          setElapsed(msg.ms);
          break;
        case 'caption':
          setCaptions((prev) => {
            const idx = prev.findIndex((c) => c.turnId === msg.turnId);
            const turn: CaptionTurn = {
              turnId: msg.turnId,
              speaker: msg.speaker,
              text: msg.text,
              partial: msg.partial,
            };
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = turn;
              return next;
            }
            return [...prev, turn];
          });
          break;
        case 'tts_chunk':
          if (!paused) playTts(msg.audio);
          break;
        case 'ping':
          send({ type: 'pong' });
          break;
        case 'ended':
          intentionalCloseRef.current = true;
          setEndedReason(msg.reason);
          setStatus('ended');
          break;
        case 'error':
          setError(msg.message);
          if (msg.code === 'unauthorized' || msg.code === 'session_expired') {
            intentionalCloseRef.current = true;
            setStatus('error');
          }
          break;
        default:
          break;
      }
    },
    [paused, playTts, send, simulatedHint, startMic],
  );

  const connect = useCallback(() => {
    if (!wsUrl || !token) return;
    // First connect authenticates with the (single-use) signed call token;
    // reconnects use the per-call resume token handed over in `ready`.
    const resume = resumeTokenRef.current;
    const url = resume
      ? `${wsUrl}?resume=${encodeURIComponent(resume)}`
      : `${wsUrl}?token=${encodeURIComponent(token)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not open socket');
      setStatus('error');
      return;
    }
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    setStatus('connecting');

    ws.onopen = () => {
      send({ type: 'hello', screenId });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          handleMessage(JSON.parse(ev.data));
        } catch {
          /* ignore malformed */
        }
      }
      // Binary frames from the gateway (if any) are ignored client-side.
    };
    ws.onerror = () => {
      // onclose handles reconnect; surface nothing noisy here.
    };
    ws.onclose = () => {
      wsRef.current = null;
      if (intentionalCloseRef.current) return;
      const withinWindow = Date.now() - startedAtRef.current < RESUME_WINDOW_MS;
      if (withinWindow && enabled) {
        reconnectTimer.current = setTimeout(() => connect(), 1200);
      } else {
        setStatus((s) => (s === 'ended' ? s : 'error'));
      }
    };
  }, [wsUrl, token, screenId, enabled, send, handleMessage]);

  // Open the socket once the student starts the call.
  useEffect(() => {
    if (!enabled || !wsUrl || !token) return;
    intentionalCloseRef.current = false;
    startedAtRef.current = Date.now();
    connect();
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      stopMic();
      void playCtxRef.current?.close().catch(() => {});
      playCtxRef.current = null;
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, wsUrl, token]);

  const pause = useCallback(() => {
    setPaused(true);
    send({ type: 'pause' });
  }, [send]);
  const resume = useCallback(() => {
    setPaused(false);
    send({ type: 'resume' });
  }, [send]);
  const endCall = useCallback(() => {
    intentionalCloseRef.current = true;
    send({ type: 'end_call' });
    stopMic();
    setStatus('ended');
  }, [send, stopMic]);

  return {
    status,
    sections: CALL_SECTIONS,
    currentSection,
    elapsed,
    captions,
    consentAcked,
    simulated,
    paused,
    endedReason,
    error,
    pause,
    resume,
    endCall,
  };
}
