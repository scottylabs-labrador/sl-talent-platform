'use client';

// The canonical audio highlight player (option 2a; README production values:
// 46px play button, 42-bar waveform, 5px progress, 14px/1.75 transcript). Audio
// streams from GET /api/stream/:momentId (license-checked, ledger-logged, 302 to
// a 60s presigned URL). Because Cartesia is in simulation mode for the demo, the
// UI is driven by a 100ms tick over the clip's real duration; a real <audio>
// element is also pointed at the stream so, when the clip exists, sound plays and
// the play is recorded in the student's ledger.

import { useEffect, useRef, useState } from 'react';
import type { AudioClip } from '@tartan/types';
import { MonoText } from '@/components/ui';
import { formatMomentTimestamp } from '@/lib/format';
import styles from './shortlist.module.css';

// 42 bars: h = 6 + ((i*37)%22), delay = (i*97)%500.
const BARS = Array.from({ length: 42 }, (_, i) => ({
  h: 6 + ((i * 37) % 22),
  d: (i * 97) % 500,
}));

function label(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return s < 10 ? `0:0${s}` : `0:${s}`;
}

export function AudioPlayer({
  clips,
  focusClip,
}: {
  clips: AudioClip[];
  focusClip?: string | null;
}) {
  const [selId, setSelId] = useState(clips[0]?.momentId ?? '');
  const [playing, setPlaying] = useState<string | null>(null);
  const [playT, setPlayT] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const sel = clips.find((c) => c.momentId === selId) ?? clips[0];
  const durSec = sel ? Math.round(sel.durationMs / 1000) : 0;

  // Competency link jumped us here: select that clip, reset playback.
  useEffect(() => {
    if (focusClip && clips.some((c) => c.momentId === focusClip)) {
      setSelId(focusClip);
      setPlaying(null);
      setPlayT(0);
    }
  }, [focusClip, clips]);

  // 100ms tick — advance playT, auto-stop at the clip duration.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setPlayT((t) => {
        const nt = t + 0.1;
        if (nt >= durSec) {
          setPlaying(null);
          return 0;
        }
        return nt;
      });
    }, 100);
    return () => clearInterval(id);
  }, [playing, durSec]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  if (!sel) return null;

  const isPlaying = playing === sel.momentId;
  const frac = isPlaying ? Math.min(1, playT / Math.max(1, durSec)) : 0;
  const words = sel.quote.split(/\s+/).filter(Boolean);

  const toggle = () => {
    if (isPlaying) {
      audioRef.current?.pause();
      setPlaying(null);
      setPlayT(0);
      return;
    }
    // Fresh Audio element pointed at the stream — the GET records the ledger
    // event and, if the clip exists, plays the real audio.
    audioRef.current?.pause();
    const audio = new Audio(sel.streamPath);
    audioRef.current = audio;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // No object in S3 (demo) or autoplay blocked — the tick still animates and
      // the ledger event was already written server-side by the GET.
    });
    setPlaying(sel.momentId);
    setPlayT(0);
  };

  const pick = (id: string) => {
    audioRef.current?.pause();
    setSelId(id);
    setPlaying(null);
    setPlayT(0);
  };

  return (
    <div>
      <div className={styles.playerCard}>
        <div className={styles.playerTop}>
          <button className={styles.playBtn} onClick={toggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#fff">
                <rect x="5" y="4" width="4.5" height="16" rx="1.5" />
                <rect x="14.5" y="4" width="4.5" height="16" rx="1.5" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
                <path d="M7 4.5v15l13-7.5z" />
              </svg>
            )}
          </button>
          <div className={styles.playerTextCol}>
            <span className={styles.playerTag}>{sel.tag}</span>
            <span className={styles.playerCaption}>
              minute {formatMomentTimestamp(sel.startMs)} · streamed, never
              downloadable · every play lands in the student&apos;s ledger
            </span>
          </div>
          <MonoText className={styles.playerTime}>
            {label(isPlaying ? playT : 0)} / {label(durSec)}
          </MonoText>
        </div>

        <div className={styles.waveform}>
          {BARS.map((b, i) => (
            <span
              key={i}
              className={styles.bar}
              style={{
                height: b.h,
                animationDelay: `${b.d}ms`,
                animationPlayState: isPlaying ? 'running' : 'paused',
              }}
            />
          ))}
        </div>

        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${frac * 100}%` }} />
        </div>

        <div className={styles.transcript}>
          {words.map((w, i) => {
            const spoken = frac > 0 && i / words.length <= frac;
            return (
              <span
                key={i}
                className={styles.word}
                style={{
                  color: spoken ? 'var(--ink-900)' : 'var(--ink-300)',
                  fontWeight: spoken ? 600 : 400,
                }}
              >
                {w}&nbsp;
              </span>
            );
          })}
        </div>

        {sel.repNote && (
          <div className={styles.repNoteRow}>
            <span className={styles.repNoteTag}>Rep&apos;s note</span>
            <span className={styles.repNoteText}>{sel.repNote}</span>
          </div>
        )}
      </div>

      <div className={styles.clipList}>
        {clips.map((c) => {
          const selected = c.momentId === sel.momentId;
          return (
            <button
              key={c.momentId}
              className={`${styles.clipRow} ${selected ? styles.clipSelected : ''}`}
              onClick={() => pick(c.momentId)}
            >
              <MonoText className={styles.clipAt}>
                {formatMomentTimestamp(c.startMs)}
              </MonoText>
              <span className={styles.clipTag}>{c.tag}</span>
              <span className={styles.clipDur}>{label(Math.round(c.durationMs / 1000))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
