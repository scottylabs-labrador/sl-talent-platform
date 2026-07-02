'use client';

// Dashboard (/sponsor). Greeting + 4 stat tiles + the "Your roles" table (SLA
// chips + per-row action pill) + the Concierge suggestion card. The RoleRow
// contract carries jobId/title/status/sla/action but not the design's meta line
// or status sentence, so those two strings are derived from JobStatus here
// (verbatim design copy). See the report note on that type gap.

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { JobStatus, RoleRow } from '@tartan/types';
import { trpc } from '@/lib/trpc/client';
import { MonoText, useToast } from '@/components/ui';
import { BrandGlyph } from '@/components/ui';
import styles from './_components/dashboard.module.css';

// Design copy the RoleRow type cannot carry (unique per seeded status).
const ROLE_META: Record<string, { meta: string; statusLine: string }> = {
  delivered: {
    meta: 'Posted Jun 26 · storage replication team',
    statusLine: 'Shortlist ready · 10 candidates, 1 wildcard',
  },
  matching: {
    meta: 'Posted Jun 30 · confirmed yesterday',
    statusLine: 'Recruiter matching · longlist of 27 in deep evaluation',
  },
  confirmed: {
    meta: 'Confirmed · matching underway',
    statusLine: 'Recruiter matching · deep evaluation in progress',
  },
  intake: {
    meta: 'Draft · one intake question open',
    statusLine: 'Concierge is waiting on your calibration answer',
  },
};

const SLA_TONE: Record<
  RoleRow['slaTone'],
  { bg: string; fg: string }
> = {
  green: { bg: '#dcefe0', fg: '#0d4b17' },
  amber: { bg: '#fdf6e3', fg: '#654a00' },
  gray: { bg: '#f0f4f8', fg: '#5f6f7f' },
};

function metaFor(status: JobStatus): { meta: string; statusLine: string } {
  return ROLE_META[status] ?? { meta: '', statusLine: '' };
}

export default function SponsorDashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const dashboard = trpc.sponsor.dashboard.useQuery();
  const createJob = trpc.sponsor.createJob.useMutation();

  const postRole = async () => {
    const res = await createJob.mutateAsync({ title: 'New role' });
    router.push(`/sponsor/intake/${res.jobId}`);
  };

  const conciergeChip = () =>
    toast(
      'Concierge is on it. Reads are instant; anything that commits the platform gets drafted for operator approval.',
      { durationMs: 3000 },
    );

  if (!dashboard.data) {
    return <div className={styles.wrap} aria-busy="true" />;
  }
  const d = dashboard.data;

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <div className={styles.headerCol}>
          <h1 className={styles.greeting}>Morning, Jordan</h1>
          <p className={styles.subtitle}>
            Tuesday, July 1 · one shortlist waiting on you, one role matching, one
            intake open
          </p>
        </div>
        <button
          className={styles.postBtn}
          onClick={postRole}
          disabled={createJob.isPending}
        >
          Post a role
        </button>
      </div>

      <div className={styles.statGrid}>
        {d.stats.map((s, i) => (
          <div key={i} className={styles.statTile}>
            <MonoText className={styles.statNumber}>{s.value}</MonoText>
            <span className={styles.statLabel}>{s.label}</span>
          </div>
        ))}
      </div>

      <div className={styles.rolesCard}>
        <div className={styles.rolesHeader}>
          <span className={styles.rolesTitle}>Your roles</span>
          <span className={styles.rolesSla}>
            shortlist SLA: 72 hours from confirm
          </span>
        </div>
        {d.roles.map((r) => {
          const m = metaFor(r.status);
          const tone = SLA_TONE[r.slaTone];
          return (
            <div key={r.jobId} className={styles.roleRow}>
              <div className={styles.roleNameCol}>
                <span className={styles.roleName}>{r.title}</span>
                <span className={styles.roleMeta}>{m.meta}</span>
              </div>
              <span className={styles.roleStatus}>{m.statusLine}</span>
              <span
                className={styles.slaChip}
                style={{ background: tone.bg, color: tone.fg }}
              >
                {r.slaLabel}
              </span>
              {r.action ? (
                <Link
                  href={r.action.href ?? '#'}
                  className={styles.roleAction}
                >
                  {r.action.label}
                </Link>
              ) : (
                <span className={styles.roleAction} aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.conciergeCard}>
        <div className={styles.conciergeHeader}>
          <BrandGlyph size={30} inset={false} />
          <div className={styles.conciergeTextCol}>
            <span className={styles.conciergeName}>Concierge</span>
            <span className={styles.conciergeCaption}>
              reads anything you are licensed to see · commitments get drafted for
              a human
            </span>
          </div>
        </div>
        <div className={styles.chipsRow}>
          {d.conciergeSuggestions.map((c, i) => (
            <button key={i} className={styles.conciergeChip} onClick={conciergeChip}>
              {c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
