'use client';

// DossierView — the 880px modal with the 12px vertical tartan spine. Every
// candidate shows the four pill tabs (Summary / Evidence / Screen / Logistics)
// built from their own real rows. The competency matrix links each rating to
// its minute of evidence; clicking a timestamp jumps to the Screen tab and cues
// that clip. Opening a dossier writes a 'view' ledger event server-side (in
// sponsor.dossier).

import { useEffect, useRef, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import type { AsyncFollowUp, DossierViewOutput } from '@tartan/types';
import { trpc } from '@/lib/trpc/client';
import { MonoText, TartanBand } from '@/components/ui';
import { formatDate, formatMomentTimestamp, formatMonthYear } from '@/lib/format';
import { AudioPlayer } from './AudioPlayer';
import styles from './dossier.module.css';

type Tab = 'summary' | 'evidence' | 'screen' | 'logistics';

export function DossierView({
  entryId,
  onClose,
}: {
  entryId: string;
  onClose: () => void;
}) {
  const q = trpc.sponsor.dossier.useQuery({ entryId });
  const [tab, setTab] = useState<Tab>('summary');
  const [focusClip, setFocusClip] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = q.data;

  const jumpTo = (momentId: string) => {
    setTab('screen');
    setFocusClip(momentId);
  };

  const initials = d
    ? d.student.name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '';

  const metaLine = d
    ? `${d.student.program ?? d.student.kind}${
        d.student.gradDate ? ` · ${formatMonthYear(d.student.gradDate)}` : ''
      } · rank ${d.rank} · fit ${d.fit}`
    : '';

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <TartanBand orientation="vertical" recipe="sponsor" thickness={12} />
        <div className={styles.content}>
          {!d ? (
            <div className={styles.loading} aria-busy="true" />
          ) : (
            <>
              <div className={styles.header}>
                <div
                  className={styles.avatar}
                  style={{ background: d.student.avatarColor ?? '#063f58' }}
                >
                  {initials}
                </div>
                <div className={styles.headerCol}>
                  <div className={styles.nameRow}>
                    <span className={styles.name}>{d.student.name}</span>
                    {d.student.ssoVerified && (
                      <span className={styles.ssoTag}>SSO verified</span>
                    )}
                  </div>
                  <span className={styles.meta}>{metaLine}</span>
                </div>
                <button className={styles.close} onClick={onClose} aria-label="Close">
                  <X width={15} height={15} strokeWidth={2} />
                </button>
              </div>

              <div className={styles.tabs}>
                {(['summary', 'evidence', 'screen', 'logistics'] as Tab[]).map(
                  (t) => (
                    <button
                      key={t}
                      className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
                      onClick={() => setTab(t)}
                    >
                      {t[0]!.toUpperCase() + t.slice(1)}
                    </button>
                  ),
                )}
              </div>

              <div className={styles.tabContent}>
                {tab === 'summary' && <SummaryTab d={d} onJump={jumpTo} />}
                {tab === 'evidence' && <EvidenceTab d={d} />}
                {tab === 'screen' &&
                  (d.clips.length ? (
                    <AudioPlayer clips={d.clips} focusClip={focusClip} />
                  ) : (
                    <p className={styles.plain}>No screen clips available.</p>
                  ))}
                {tab === 'logistics' && <LogisticsTab d={d} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type Dossier = DossierViewOutput;

function SummaryTab({ d, onJump }: { d: Dossier; onJump: (m: string) => void }) {
  return (
    <div className={styles.summary}>
      <div className={styles.rationalePanel}>
        <span className={styles.rationaleEyebrow}>
          Why ranked {d.rank} · the Recruiter&apos;s rationale
        </span>
        <span className={styles.rationaleBody}>
          {d.rationale} Ratings below link to the exact minute of evidence;
          nothing here is unexplainable.
        </span>
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryLeft}>
          <span className={styles.groupLabel}>
            Competency, rated on the public rubric
          </span>
          {d.competency.map((c, i) => (
            <div key={i} className={styles.compRow}>
              <span className={styles.compName}>{c.name}</span>
              <div className={styles.dots}>
                {Array.from({ length: 5 }, (_, k) => (
                  <span
                    key={k}
                    className={styles.dot}
                    style={{
                      background: k < c.score ? 'var(--blue-500)' : '#e0e6ee',
                    }}
                  />
                ))}
              </div>
              {c.momentId ? (
                <button
                  className={styles.compLink}
                  onClick={() => onJump(c.momentId!)}
                >
                  {c.timestampMs != null
                    ? formatMomentTimestamp(c.timestampMs)
                    : 'clip'}
                </button>
              ) : (
                <MonoText className={styles.compLinkStatic}>transcript</MonoText>
              )}
            </div>
          ))}
        </div>

        <div className={styles.summaryRight}>
          <span className={styles.groupLabel}>Flags, both directions</span>
          {d.flags.green.map((f, i) => (
            <div key={`g${i}`} className={styles.flagRow}>
              <span className={`${styles.flagTag} ${styles.flagGreen}`}>Green flag</span>
              <span className={styles.flagText}>{f}</span>
            </div>
          ))}
          {d.flags.probe.map((f, i) => (
            <div key={`p${i}`} className={styles.flagRow}>
              <span className={`${styles.flagTag} ${styles.flagProbe}`}>Worth probing</span>
              <span className={styles.flagText}>{f}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.followups}>
        <span className={styles.groupLabel}>
          Suggested follow-ups for your loop · we are your first round, not your
          replacement
        </span>
        {d.followups.map((f, i) => (
          <div key={i} className={styles.followupRow}>
            <MessageSquare
              width={14}
              height={14}
              strokeWidth={2}
              className={styles.followupIcon}
            />
            <span className={styles.followupText}>{f}</span>
          </div>
        ))}
      </div>

      {d.followUp && <FollowUpBlock followUp={d.followUp} />}
    </div>
  );
}

function FollowUpBlock({ followUp }: { followUp: AsyncFollowUp }) {
  const answered = followUp.answered;
  const stateLabel = answered
    ? followUp.answeredAt
      ? `Answered · ${formatDate(followUp.answeredAt)}`
      : 'Answered'
    : 'Awaiting reply';
  return (
    <div className={styles.followUpBlock}>
      <div className={styles.followUpHead}>
        <span className={styles.groupLabel}>Follow-up</span>
        <span
          className={`${styles.followUpTag} ${
            answered ? styles.followUpAnswered : styles.followUpAwaiting
          }`}
        >
          {stateLabel}
        </span>
      </div>
      <div className={styles.followUpQuestion}>
        <MessageSquare
          width={14}
          height={14}
          strokeWidth={2}
          className={styles.followupIcon}
        />
        <span className={styles.followUpQuestionText}>{followUp.question}</span>
      </div>
      {answered && followUp.text && (
        <p className={styles.followUpAnswerText}>{followUp.text}</p>
      )}
      {answered && followUp.audio && (
        <FollowUpAudioRow
          streamPath={followUp.audio.streamPath}
          tag={followUp.audio.tag}
        />
      )}
    </div>
  );
}

function FollowUpAudioRow({
  streamPath,
  tag,
}: {
  streamPath: string;
  tag: string;
}) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const toggle = () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    // Fresh Audio pointed at the answer stream — the GET license-checks and
    // records the ledger 'stream' event (302 to a 60s presigned URL).
    audioRef.current?.pause();
    const audio = new Audio(streamPath);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    void audio.play().catch(() => {
      // No object in S3 (demo) or autoplay blocked — the ledger event was still
      // written server-side by the GET.
    });
    setPlaying(true);
  };

  return (
    <div className={styles.answerRow}>
      <button
        className={styles.answerPlay}
        onClick={toggle}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
            <rect x="5" y="4" width="4.5" height="16" rx="1.5" />
            <rect x="14.5" y="4" width="4.5" height="16" rx="1.5" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="#fff">
            <path d="M7 4.5v15l13-7.5z" />
          </svg>
        )}
      </button>
      <div className={styles.answerCol}>
        <span className={styles.answerTag}>{tag}</span>
        <span className={styles.answerCaption}>
          streamed, never downloadable · every play lands in the student&apos;s
          ledger
        </span>
      </div>
    </div>
  );
}

function EvidenceTab({ d }: { d: Dossier }) {
  return (
    <div className={styles.evidence}>
      {d.stories.map((s) => {
        const pending = s.provenance === 'pending';
        return (
          <div key={s.id} className={styles.storyCard}>
            <div className={styles.storyHeader}>
              <span className={styles.storyTitle}>{s.title}</span>
              <span
                className={`${styles.provTag} ${pending ? styles.provPending : styles.provVerified}`}
              >
                {pending ? 'Pending' : 'Verified'}
              </span>
            </div>
            <span className={styles.storyDesc}>
              {s.situation} {s.contribution}
              {s.outcome ? ` ${s.outcome}` : ''}
            </span>
          </div>
        );
      })}
      <span className={styles.evidenceNote}>
        Provenance is shown honestly everywhere: verified, self-reported, or
        pending. Pending means the Verifier is still cross-checking; it is not a
        penalty.
      </span>
    </div>
  );
}

function LogisticsTab({ d }: { d: Dossier }) {
  return (
    <div className={styles.logistics}>
      {d.logistics.map((row, i) => (
        <div key={i} className={styles.logRow}>
          <span className={styles.logKey}>{row.label}</span>
          <span className={styles.logValue}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}
