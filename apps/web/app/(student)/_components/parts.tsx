'use client';

// Shared presentational parts for the student surface. All pixel values quoted
// from student-app.md / "Student App.dc.html".

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Play, Pause } from 'lucide-react';
import styles from '../student.module.css';
import { clockLabel } from './format';

// ── Avatar (deep-blue initials tile) ───────────────────────────────────────
export function Avatar({
  children,
  size = 40,
  radius = '50%',
  fontSize = 14,
  company = false,
}: {
  children: ReactNode;
  size?: number;
  radius?: number | string;
  fontSize?: number;
  /** Company glyph tiles use Satoshi 700 (person initials stay Inter 600). */
  company?: boolean;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: '#063f58',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: company ? 700 : 600,
        fontSize,
        flex: 'none',
        fontFamily: company ? 'var(--font-display)' : 'var(--font-ui)',
      }}
    >
      {children}
    </div>
  );
}

// ── Step timeline (Home + Matches) ─────────────────────────────────────────
export function StepTimeline({ done, count = 5 }: { done: number; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {Array.from({ length: count }).map((_, i) => {
        const isDone = i < done;
        const isLast = i === count - 1;
        const barBlue = i < done - 1; // bar blue when the NEXT step is done
        return (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', flex: isLast ? 0 : 1 }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: isDone ? '#0e96d1' : '#fff',
                border: `2px solid ${isDone ? '#0e96d1' : '#c7d2dc'}`,
                flex: 'none',
              }}
            />
            {!isLast && (
              <div
                style={{ height: 2, flex: 1, background: barBlue ? '#0e96d1' : '#e0e6ee' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Live-call voice bars (24) ──────────────────────────────────────────────
const LIVE_BARS = Array.from({ length: 24 }, (_, i) => ({
  h: 8 + ((i * 53) % 20),
  d: (i * 137) % 400,
}));
export function VoiceBars({ playing }: { playing: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2.5, height: 26 }}>
      {LIVE_BARS.map((b, i) => (
        <span
          key={i}
          className={styles.voiceBar}
          style={{
            width: 3,
            height: b.h,
            background: '#5eb9e0',
            animationDelay: `${b.d}ms`,
            animationPlayState: playing ? 'running' : 'paused',
          }}
        />
      ))}
    </div>
  );
}

// ── Record-pill bars ───────────────────────────────────────────────────────
const REC_BARS = Array.from({ length: 22 }, (_, i) => ({
  h: 5 + ((i * 29) % 13),
  d: (i * 97) % 500,
}));
export function RecBars() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 18, flex: 1 }}>
      {REC_BARS.map((b, i) => (
        <span
          key={i}
          className={styles.recBar}
          style={{ width: 2.5, height: b.h, maxHeight: 18, animationDelay: `${b.d}ms` }}
        />
      ))}
    </div>
  );
}

// ── Progress arc (live call) — 6 segments, geometry verbatim ───────────────
const ARC_PATHS = [
  'M 96.6 14.3 A 76 76 0 0 1 152.3 46.4',
  'M 158.9 57.9 A 76 76 0 0 1 158.9 122.1',
  'M 152.3 133.6 A 76 76 0 0 1 96.6 165.7',
  'M 83.4 165.7 A 76 76 0 0 1 27.7 133.6',
  'M 21.1 122.1 A 76 76 0 0 1 21.1 57.9',
  'M 27.7 46.4 A 76 76 0 0 1 83.4 14.3',
];
export function ProgressArc({ activeIndex, children }: { activeIndex: number; children?: ReactNode }) {
  return (
    <div style={{ position: 'relative', width: 180, height: 180 }}>
      <svg width={180} height={180} viewBox="0 0 180 180">
        {ARC_PATHS.map((d, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <path
              key={i}
              d={d}
              fill="none"
              strokeLinecap="round"
              stroke={done ? '#0e96d1' : active ? '#5eb9e0' : 'rgba(255,255,255,.14)'}
              strokeWidth={active ? 7 : 5}
            />
          );
        })}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 22,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 50% 38%, rgba(14,150,209,.28), rgba(7,12,17,0) 70%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Visibility switch (40×23) ──────────────────────────────────────────────
export function VisibilitySwitch({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    // Transparent 44px button (a11y tap floor); the inner span is the spec
    // 40x23 visual track. Negative margins keep the layout footprint at 40x23.
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label ?? 'Toggle sponsor visibility'}
      style={{
        width: 44,
        height: 44,
        margin: '-10.5px -2px',
        padding: 0,
        border: 'none',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flex: 'none',
      }}
    >
      <span
        style={{
          width: 40,
          height: 23,
          borderRadius: 100,
          border: `1px solid ${on ? '#0e96d1' : '#aebdcc'}`,
          background: on ? '#0e96d1' : '#fff',
          position: 'relative',
          display: 'block',
          flex: 'none',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: on ? 20 : 2,
            width: 17,
            height: 17,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,.2)',
            transition: 'left 180ms cubic-bezier(.2,0,0,1)',
          }}
        />
      </span>
    </button>
  );
}

// ── Audio moment row (post-call review + sponsor render) ───────────────────
// Streams the student's own clip via GET /api/stream/:momentId (which
// license-checks, logs a ledger `stream` event, and 302s to a 60s presigned
// URL). A client timer drives the progress fill so the row animates even before
// audio metadata resolves; if the real element errors we keep the timer.
export function AudioMomentRow({
  momentId,
  tag,
  quote,
  durationMs,
  playSize = 34,
  wrapperStyle,
  right,
}: {
  momentId: string;
  tag: string;
  quote?: string;
  durationMs: number;
  playSize?: number;
  wrapperStyle?: CSSProperties;
  right?: ReactNode;
}) {
  const [playing, setPlaying] = useState(false);
  const [posMs, setPosMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };
  const stop = () => {
    clearTimer();
    audioRef.current?.pause();
    setPlaying(false);
    setPosMs(0);
  };
  useEffect(() => () => clearTimer(), []);

  const toggle = () => {
    if (playing) {
      stop();
      return;
    }
    setPlaying(true);
    setPosMs(0);
    // Best-effort real stream (also records the ledger stream event).
    try {
      const el = new Audio(`/api/stream/${momentId}`);
      audioRef.current = el;
      void el.play().catch(() => {});
    } catch {
      /* ignore */
    }
    const started = Date.now();
    timerRef.current = setInterval(() => {
      const p = Date.now() - started;
      if (p >= durationMs) {
        stop();
      } else {
        setPosMs(p);
      }
    }, 100);
  };

  const pct = playing ? Math.min(100, (posMs / durationMs) * 100) : 0;

  return (
    <div
      style={{
        border: '1px solid #e9ebf8',
        borderRadius: 10,
        padding: '11px 12px',
        background: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        ...wrapperStyle,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause moment' : 'Play moment'}
          style={{
            // 44px hit area (a11y floor) around the spec-size visual circle:
            // the padding is part of the button but clipped out of the fill.
            width: 44,
            height: 44,
            padding: (44 - playSize) / 2,
            margin: (playSize - 44) / 2,
            borderRadius: '50%',
            border: 'none',
            background: '#063f58',
            backgroundClip: 'content-box',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flex: 'none',
          }}
        >
          {playing ? (
            <Pause size={playSize <= 32 ? 11 : 12} fill="#fff" />
          ) : (
            <Play size={playSize <= 32 ? 11 : 12} fill="#fff" />
          )}
        </button>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1e1e1e' }}>{tag}</div>
          <div
            style={{
              height: 4,
              borderRadius: 100,
              background: '#e0e6ee',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                background: '#0e96d1',
                width: `${pct}%`,
                transition: 'width 90ms linear',
              }}
            />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#869db3' }}>
            {playing ? clockLabel(posMs) : '0:00'} / {clockLabel(durationMs)}
          </div>
        </div>
        {right}
      </div>
      {quote && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: '#4a5662',
            fontStyle: 'italic',
          }}
        >
          &ldquo;{quote}&rdquo;
        </div>
      )}
    </div>
  );
}

// ── Competency 5-dot row ───────────────────────────────────────────────────
export function CompetencyRow({
  name,
  score,
  link,
}: {
  name: string;
  score: number;
  link: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ fontSize: 12.5, color: '#1e1e1e', flex: 1 }}>{name}</div>
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: i < score ? '#0e96d1' : '#e0e6ee',
            }}
          />
        ))}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: '#0e96d1',
          width: 86,
          textAlign: 'right',
        }}
      >
        {link}
      </div>
    </div>
  );
}
