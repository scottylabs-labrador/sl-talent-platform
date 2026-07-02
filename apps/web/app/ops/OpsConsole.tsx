'use client';

// The single interactive Ops Console component. Holds the exception queue as
// local state (open cards flip to dashed resolved rows in place), wires the
// three resolve actions to the ops router, and fires the canonical bottom-center
// toast. Ported from the prototype's DCLogic; copy is verbatim from the design.

import { useState } from 'react';
import type { AgentName } from '@tartan/types';
import type { ExceptionsOutput } from '@tartan/types';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import styles from './ops.module.css';

type ExceptionCard = ExceptionsOutput['exceptions'][number];

// Short agent display names (interpolated into the approve/override toasts and
// shown in the context box tag), keyed by the AgentName enum.
const AGENT_SHORT: Record<AgentName, string> = {
  rep: 'Talent Rep',
  synthesizer: 'Synthesizer',
  verifier: 'Verifier',
  recruiter: 'Recruiter',
  concierge: 'Concierge',
  coach: 'Coach',
  sentinel: 'Sentinel',
};

// Category tag colors (text / background), exact per the design.
const CAT_COLORS: Record<ExceptionCard['categoryTone'], { fg: string; bg: string }> = {
  amber: { fg: '#654a00', bg: '#fdf6e3' },
  blue: { fg: '#0a6b94', bg: '#e7f5fa' },
  red: { fg: '#991a30', bg: '#fdf2f4' },
  gray: { fg: '#4a5662', bg: '#f0f4f8' },
};

// Resolved-status → the bold label shown in the collapsed dashed row.
const STATUS_LABEL: Record<string, string> = {
  approved: 'Approved recommended',
  overridden: 'Overridden by operator',
  escalated: 'Escalated to Platform Lead',
};

type Action = 'approve' | 'override' | 'escalate';
const ACTION_STATUS: Record<Action, ExceptionCard['status']> = {
  approve: 'approved',
  override: 'overridden',
  escalate: 'escalated',
};

function toastCopy(action: Action, agentShort: string): string {
  if (action === 'approve') {
    return `Done in one click. Resolution logged as eval data for the ${agentShort}.`;
  }
  if (action === 'override') {
    return `Override logged. The ${agentShort} learns from the diff between its call and yours.`;
  }
  return `Escalated with full context. It lands in the lead's Monday digest thread.`;
}

// ── inline lucide-style icons (exact geometry from the prototype) ────────────
function WandIcon() {
  return (
    <svg
      className={styles.recIcon}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0a6b94"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 4V2m0 20v-2M8 9l-1.5-1.5M19 20l-1.5-1.5M2 15h2m16 0h2M19 4l-9.5 9.5" />
      <path d="m14.5 9.5 1 1" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg
      className={styles.checkIcon}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0d4b17"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function ArrowLeftIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

export interface SidebarData {
  week: string;
  digestSent: string;
  medianResolveMin: number;
  stats: { label: string; value: string; color: string }[];
  adverseImpact: { body: string; meta: string };
  workforce: { name: string; note: string; eval: string; aut: string; dot: string }[];
}

export interface OpsConsoleProps {
  initialExceptions: ExceptionCard[];
  sidebar: SidebarData;
  operatorInitial: string;
}

export function OpsConsole({
  initialExceptions,
  sidebar,
  operatorInitial,
}: OpsConsoleProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<ExceptionCard[]>(initialExceptions);
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overrideNote, setOverrideNote] = useState('');

  const resolveMutation = trpc.ops.resolveException.useMutation();

  const openCount = items.filter((e) => e.status === 'open').length;
  const allDone = openCount === 0;

  function resolve(item: ExceptionCard, action: Action, note?: string) {
    if (item.status !== 'open') return;
    const agentShort = AGENT_SHORT[item.agent];
    const newStatus = ACTION_STATUS[action];

    // Optimistic in-place flip + toast (matches the prototype's instant feel).
    setItems((prev) =>
      prev.map((e) => (e.id === item.id ? { ...e, status: newStatus } : e)),
    );
    setOverrideId(null);
    setOverrideNote('');
    toast(toastCopy(action, agentShort));

    resolveMutation.mutate(
      { exceptionId: item.id, action, ...(note ? { note } : {}) },
      {
        onError: () => {
          // Roll the card back into the queue and tell the operator.
          setItems((prev) =>
            prev.map((e) => (e.id === item.id ? { ...e, status: 'open' } : e)),
          );
          toast('Could not save that. The item is back in the queue.');
        },
      },
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.hubLink} href="/">
          <ArrowLeftIcon />
          Hub
        </a>
        <span className={styles.divider} />
        <span className={styles.brand}>Talent Ops</span>
        <span className={styles.scopePill}>
          internal · volunteers handle exceptions, agents handle everything else
        </span>
        <div className={styles.headerMeta}>
          <span className={styles.digestStamp}>
            {sidebar.week} · {sidebar.digestSent}
          </span>
          <div className={styles.avatar}>{operatorInitial}</div>
        </div>
      </header>

      <div className={styles.body}>
        {/* ── Exception queue ─────────────────────────────────────────────── */}
        <div className={styles.queue}>
          <div className={styles.queueHeader}>
            <div className={styles.queueTitleCol}>
              <span className={styles.queueTitle}>Exception queue</span>
              <span className={styles.queueSubtitle}>
                {openCount} open · every item arrives with agent context and a
                recommended action · target median under 2 minutes
              </span>
            </div>
            <span className={styles.medianStamp}>
              median this wk: {sidebar.medianResolveMin} min
            </span>
          </div>

          {items.map((item) => {
            if (item.status !== 'open') {
              const label = STATUS_LABEL[item.status] ?? 'Resolved';
              return (
                <div key={item.id} className={styles.resolvedRow}>
                  <CheckIcon />
                  <span className={styles.resolvedText}>
                    <b>{label}</b> · {item.title}
                  </span>
                  <span className={styles.resolvedStamp}>logged, becomes eval data</span>
                </div>
              );
            }

            const colors = CAT_COLORS[item.categoryTone];
            const agentShort = AGENT_SHORT[item.agent];
            const isOverriding = overrideId === item.id;
            return (
              <div key={item.id} className={styles.card}>
                <div className={styles.cardTitleRow}>
                  <span
                    className={styles.catTag}
                    style={{ color: colors.fg, background: colors.bg }}
                  >
                    {item.categoryLabel}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 }}>
                    {item.title}
                  </span>
                  <span className={styles.ageStamp}>
                    {formatRelative(item.createdAt)}
                  </span>
                </div>

                <div className={styles.contextBox}>
                  <span className={styles.agentTag}>{agentShort}</span>
                  <span className={styles.contextText}>{item.quote}</span>
                </div>

                <div className={styles.recLine}>
                  <WandIcon />
                  <span className={styles.recText}>
                    <b>Recommended:</b> {item.recommendation}
                  </span>
                </div>

                {isOverriding ? (
                  <div className={styles.overrideForm}>
                    <input
                      className={styles.overrideInput}
                      type="text"
                      autoFocus
                      placeholder="One line on what you changed and why"
                      value={overrideNote}
                      onChange={(e) => setOverrideNote(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          resolve(item, 'override', overrideNote.trim() || undefined);
                        } else if (e.key === 'Escape') {
                          setOverrideId(null);
                          setOverrideNote('');
                        }
                      }}
                    />
                    <button
                      className={styles.approveBtn}
                      onClick={() =>
                        resolve(item, 'override', overrideNote.trim() || undefined)
                      }
                    >
                      Log override
                    </button>
                    <button
                      className={styles.outlineBtn}
                      onClick={() => {
                        setOverrideId(null);
                        setOverrideNote('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className={styles.actions}>
                    <button
                      className={styles.approveBtn}
                      onClick={() => resolve(item, 'approve')}
                    >
                      Approve recommended
                    </button>
                    <button
                      className={styles.outlineBtn}
                      onClick={() => {
                        setOverrideId(item.id);
                        setOverrideNote('');
                      }}
                    >
                      Override
                    </button>
                    <button
                      className={styles.outlineBtn}
                      onClick={() => resolve(item, 'escalate')}
                    >
                      Escalate to lead
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {allDone && (
            <div className={styles.emptyState}>
              <span className={styles.emptyText}>
                Queue clear. The agents have the rest. See you at the Monday digest.
              </span>
            </div>
          )}
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <div className={styles.sidebar}>
          <div className={styles.statsCard}>
            <span className={styles.cardLabel}>This week</span>
            {sidebar.stats.map((s) => (
              <div key={s.label} className={styles.statRow}>
                <span className={styles.statLabel}>{s.label}</span>
                <span className={styles.statValue} style={{ color: s.color }}>
                  {s.value}
                </span>
              </div>
            ))}
          </div>

          <div className={styles.workforceCard}>
            <div className={styles.workforceHeader}>
              <span className={styles.cardLabel}>Agent workforce</span>
              <span className={styles.workforceRight}>eval / autonomy</span>
            </div>
            {sidebar.workforce.map((a) => (
              <div key={a.name} className={styles.agentRow}>
                <span className={styles.agentDot} style={{ background: a.dot }} />
                <div className={styles.agentNameCol}>
                  <span className={styles.agentName}>{a.name}</span>
                  <span className={styles.agentNote}>{a.note}</span>
                </div>
                <span className={styles.agentEval}>{a.eval}</span>
                <span className={styles.agentAut}>{a.aut}</span>
              </div>
            ))}
            <span className={styles.footnote}>
              Autonomy graduates on written criteria, never on &quot;seems
              fine&quot;. Exceptions caused per 100 runs must fall monthly.
            </span>
          </div>

          <div className={styles.adverseCard}>
            <span className={styles.adverseHeader}>Adverse-impact monitor</span>
            <span className={styles.adverseBody}>{sidebar.adverseImpact.body}</span>
            <span className={styles.adverseMeta}>{sidebar.adverseImpact.meta}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
