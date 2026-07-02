'use client';

// DossierView — the 880px modal with the 12px vertical tartan spine. For a
// candidate with audio (June, rank 1) it shows four pill tabs (Summary /
// Evidence / Screen / Logistics); others render the rationale + scope note. The
// competency matrix links each rating to its minute of evidence; clicking a
// timestamp jumps to the Screen tab and cues that clip. Opening a dossier writes
// a 'view' ledger event server-side (in sponsor.dossier).

import { useEffect, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';
import type { DossierViewOutput } from '@tartan/types';
import { trpc } from '@/lib/trpc/client';
import { MonoText, TartanBand } from '@/components/ui';
import { formatMomentTimestamp, formatMonthYear } from '@/lib/format';
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
  const isFull = Boolean(d && !d.scopeNote);

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
      } · rank ${d.rank} of 10 · fit ${d.fit}`
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

              {isFull ? (
                <>
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
                    {tab === 'summary' && (
                      <SummaryTab d={d} onJump={jumpTo} />
                    )}
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
              ) : (
                <div className={styles.scopeWrap}>
                  <div className={styles.rationalePanel}>
                    <span className={styles.rationaleEyebrow}>
                      The Recruiter&apos;s rationale
                    </span>
                    <span className={styles.rationaleBody}>{d.rationale}</span>
                  </div>
                  <div className={styles.scopeNote}>{d.scopeNote}</div>
                </div>
              )}
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
