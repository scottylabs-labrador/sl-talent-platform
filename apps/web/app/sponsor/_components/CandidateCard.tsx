'use client';

// One row of the Sponsor Shortlist (canonical density "1d"). Rank, avatar, name
// (hover blue), kind badge, two-sentence rationale, three evidence chips, and
// the action column: Request intro / Pass / Save, each writing through
// sponsor.entryAction with the design's verbatim toast. Pass opens the required
// one-tap reason row; passing dims the card to 45%. Match-only candidates render
// anonymized until reveal consent is granted.

import { useState } from 'react';
import type { CandidateCard as CandidateCardData, EntryStatus } from '@tartan/types';
import { trpc } from '@/lib/trpc/client';
import { MonoText, useToast } from '@/components/ui';
import styles from './shortlist.module.css';

const BADGE: Record<
  string,
  { label: string; bg: string; fg: string } | undefined
> = {
  wildcard: { label: 'Wildcard slot', bg: '#d1c4ee', fg: '#4b2d8f' },
  alum: { label: 'Alum', bg: '#e7f5fa', fg: '#0a6b94' },
  match_only: { label: 'Match-only', bg: '#f0f4f8', fg: '#5f6f7f' },
};

const PASS_REASONS: {
  key: 'too_junior' | 'missing_must_have' | 'overlaps_existing_hire' | 'other';
  label: string;
}[] = [
  { key: 'too_junior', label: 'Too junior for this req' },
  { key: 'missing_must_have', label: 'Missing a must-have' },
  { key: 'overlaps_existing_hire', label: 'Overlaps an existing hire' },
  { key: 'other', label: 'Other' },
];

export function CandidateCard({
  candidate,
  onOpen,
}: {
  candidate: CandidateCardData;
  onOpen: (entryId: string) => void;
}) {
  const { toast } = useToast();
  const action = trpc.sponsor.entryAction.useMutation();
  const [status, setStatus] = useState<EntryStatus>(candidate.status);
  const [passOpen, setPassOpen] = useState(false);

  const badge = BADGE[candidate.kind];
  const dimmed = status === 'passed';

  const requestIntro = async () => {
    await action.mutateAsync({ entryId: candidate.entryId, action: 'intro' });
    setStatus('intro');
    if (candidate.anonymized) {
      toast('Consent to reveal requested. They choose first; you hear back within 48h.', {
        durationMs: 3000,
      });
    } else {
      const first = candidate.name.split(' ')[0];
      toast(`Intro requested. ${first} picks from your interview slots tonight.`, {
        durationMs: 3000,
      });
    }
  };

  const pickReason = async (reason: (typeof PASS_REASONS)[number]['key']) => {
    await action.mutateAsync({
      entryId: candidate.entryId,
      action: 'pass',
      passReason: reason,
    });
    setStatus('passed');
    setPassOpen(false);
    toast('Passed with a reason. Reasons tune your bar for the next run.', {
      durationMs: 3000,
    });
  };

  const save = async () => {
    await action.mutateAsync({ entryId: candidate.entryId, action: 'save' });
    setStatus('saved');
    toast('Saved for later. Saved candidates surface again on your next role.', {
      durationMs: 3000,
    });
  };

  const initials = candidate.anonymized
    ? '·'
    : candidate.name
        .split(' ')
        .map((p) => p[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

  return (
    <div className={styles.card} style={{ opacity: dimmed ? 0.45 : 1 }}>
      <MonoText className={styles.rank}>{candidate.rank}</MonoText>
      <div
        className={styles.avatar}
        style={{ background: candidate.avatarColor ?? '#063f58' }}
      >
        {initials}
      </div>

      <div className={styles.middle}>
        <div className={styles.nameRow}>
          <button className={styles.name} onClick={() => onOpen(candidate.entryId)}>
            {candidate.name}
          </button>
          {badge && (
            <span
              className={styles.badge}
              style={{ background: badge.bg, color: badge.fg }}
            >
              {badge.label}
            </span>
          )}
        </div>

        <p className={styles.why}>{candidate.rationale}</p>

        <div className={styles.chips}>
          {candidate.evidenceChips.map((c, i) => (
            <span key={i} className={styles.chip}>
              {c.label}
            </span>
          ))}
        </div>

        {passOpen && (
          <div className={styles.passRow}>
            <span className={styles.passLabel}>Why pass? Feeds calibration:</span>
            {PASS_REASONS.map((r) => (
              <button
                key={r.key}
                className={styles.passReason}
                onClick={() => pickReason(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.actionsCol}>
        <MonoText className={styles.fit}>fit {candidate.fit}</MonoText>

        {status === 'none' ? (
          <div className={styles.actionsRow}>
            <button className={styles.introBtn} onClick={requestIntro}>
              Request intro
            </button>
            <button
              className={styles.passBtn}
              onClick={() => setPassOpen((o) => !o)}
            >
              Pass
            </button>
            <button className={styles.saveBtn} onClick={save}>
              Save
            </button>
          </div>
        ) : status === 'intro' ? (
          <span className={`${styles.statusChip} ${styles.introChip}`}>
            Intro requested ✓
          </span>
        ) : status === 'passed' ? (
          <span className={`${styles.statusChip} ${styles.passedChip}`}>Passed</span>
        ) : (
          <span className={`${styles.statusChip} ${styles.savedChip}`}>Saved</span>
        )}

        <button className={styles.openDossier} onClick={() => onOpen(candidate.entryId)}>
          Open dossier →
        </button>
      </div>
    </div>
  );
}
