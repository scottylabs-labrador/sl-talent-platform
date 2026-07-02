'use client';

// Shortlist (/sponsor/shortlist/[shortlistId]). Tartan header card (10px band) +
// SLA eyebrow + funnel line + Recalibrate / View intake pills, then the ten
// CandidateCards and the conditional honesty footer. Opening any candidate mounts
// the DossierView modal. Shortlist load writes one 'shortlist' view ledger event
// per delivery (deduped server-side).

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { EntryKind } from '@tartan/types';
import { trpc } from '@/lib/trpc/client';
import { TartanBand, useToast } from '@/components/ui';
import { CandidateCard } from '../../_components/CandidateCard';
import { DossierView } from '../../_components/DossierView';
import styles from '../../_components/shortlist.module.css';

const NUM = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve',
];
const word = (n: number): string =>
  (NUM[n] ?? String(n)).replace(/^./, (c) => c.toUpperCase());

export default function ShortlistPage() {
  const { shortlistId } = useParams<{ shortlistId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const q = trpc.sponsor.shortlist.useQuery({ shortlistId });
  const recalibrate = trpc.sponsor.recalibrate.useMutation();
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  const onRecalibrate = async () => {
    await recalibrate
      .mutateAsync({ shortlistId, note: 'Recalibration requested from the shortlist header.' })
      .catch(() => undefined);
    toast(
      'Concierge: tell me what to change ("more storage depth", "closer to Kirkland") and I rerun within the same SLA.',
      { durationMs: 3000 },
    );
  };

  if (!q.data) return <div className={styles.wrap} aria-busy="true" />;
  const s = q.data;

  const count = (k: EntryKind) => s.candidates.filter((c) => c.kind === k).length;
  const archetypeFits = count('fit') + count('match_only');
  const alums = count('alum');
  const wildcards = count('wildcard');

  const funnelLine =
    `${s.funnel.screened} screened, ${s.funnel.deepEvaluated} deep-evaluated, ` +
    `${s.funnel.answeredFollowup} answered your follow-up question. ` +
    `${word(archetypeFits)} archetype fits, ${word(alums)} alum${
      alums === 1 ? '' : 's'
    }, ${word(wildcards)} wildcard${wildcards === 1 ? '' : 's'}: composition is ` +
    'policy, and every rank explains itself.';

  return (
    <div className={styles.wrap}>
      <div className={styles.headerCard}>
        <TartanBand orientation="horizontal" recipe="sponsor" thickness={10} />
        <div className={styles.headerBody}>
          <div className={styles.headerTextCol}>
            <span className={styles.eyebrow}>{s.slaEyebrow}</span>
            <h1 className={styles.headerTitle}>{s.jobTitle}</h1>
            <p className={styles.funnel}>{funnelLine}</p>
          </div>
          <div className={styles.headerBtns}>
            <button className={styles.headerPill} onClick={onRecalibrate}>
              Recalibrate + rerun
            </button>
            <button
              className={styles.headerPill}
              onClick={() => router.push(`/sponsor/intake/${s.jobId}`)}
            >
              View intake
            </button>
          </div>
        </div>
      </div>

      <div className={styles.list}>
        {s.candidates.map((c) => (
          <CandidateCard key={c.entryId} candidate={c} onOpen={setOpenEntry} />
        ))}
      </div>

      {s.shortfallNote && <p className={styles.honesty}>{s.shortfallNote}</p>}

      {openEntry && (
        <DossierView entryId={openEntry} onClose={() => setOpenEntry(null)} />
      )}
    </div>
  );
}
