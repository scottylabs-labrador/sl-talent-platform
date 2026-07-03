'use client';

// Dashboard (/sponsor). Greeting + 4 stat tiles + the "Your roles" table (SLA
// chips + per-row action pill) + the Concierge suggestion card. The RoleRow
// contract carries jobId/title/status/sla/action but not the design's meta line
// or status sentence, so those two strings are derived from JobStatus here
// (verbatim design copy). See the report note on that type gap.

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import type { JobStatus, RoleRow } from '@tartan/types';
import { trpc } from '@/lib/trpc/client';
import { MonoText } from '@/components/ui';
import { BrandGlyph } from '@/components/ui';
import { useConcierge } from './_components/ConciergeSheet';
import styles from './_components/dashboard.module.css';

const SLA_TONE: Record<
  RoleRow['slaTone'],
  { bg: string; fg: string }
> = {
  green: { bg: '#dcefe0', fg: '#0d4b17' },
  amber: { bg: '#fdf6e3', fg: '#654a00' },
  gray: { bg: '#f0f4f8', fg: '#5f6f7f' },
};

// Honest per-status description lines (the RoleRow type carries status + SLA but
// not a meta/status sentence). No fabricated dates or counts.
function metaFor(status: JobStatus): { meta: string; statusLine: string } {
  switch (status) {
    case 'delivered':
      return { meta: 'Shortlist delivered', statusLine: 'Shortlist ready to review' };
    case 'matching':
    case 'confirmed':
      return {
        meta: 'Confirmed · matching underway',
        statusLine: 'The Recruiter is matching now',
      };
    case 'intake':
      return {
        meta: 'Draft',
        statusLine: 'Intake open · confirm to start the 72h clock',
      };
    case 'closed':
      return { meta: 'Closed', statusLine: 'Role closed' };
    default:
      return { meta: '', statusLine: '' };
  }
}

// Honest subtitle built from the real role states.
function subtitleFor(roles: RoleRow[]): string {
  const delivered = roles.filter((r) => r.status === 'delivered').length;
  const matching = roles.filter(
    (r) => r.status === 'matching' || r.status === 'confirmed',
  ).length;
  const intake = roles.filter((r) => r.status === 'intake').length;
  const parts: string[] = [];
  if (delivered)
    parts.push(`${delivered} shortlist${delivered === 1 ? '' : 's'} ready`);
  if (matching) parts.push(`${matching} role${matching === 1 ? '' : 's'} matching`);
  if (intake) parts.push(`${intake} intake${intake === 1 ? '' : 's'} open`);
  return parts.length
    ? parts.join(' · ')
    : `${roles.length} role${roles.length === 1 ? '' : 's'} in flight`;
}

export default function SponsorDashboard() {
  const router = useRouter();
  const { data: session } = useSession();
  const concierge = useConcierge();
  const dashboard = trpc.sponsor.dashboard.useQuery();
  const createJob = trpc.sponsor.createJob.useMutation();

  const postRole = async () => {
    const res = await createJob.mutateAsync({ title: 'New role' });
    router.push(`/sponsor/intake/${res.jobId}`);
  };

  // The suggestion chips open the Concierge sheet prefilled with the question.
  const conciergeChip = (prompt: string) => concierge.open(prompt);

  if (!dashboard.data) {
    return <div className={styles.wrap} aria-busy="true" />;
  }
  const d = dashboard.data;

  const firstName = session?.user?.name?.split(' ')[0] ?? null;
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  const greeting = firstName ? `${partOfDay}, ${firstName}` : partOfDay;
  const hasRoles = d.roles.length > 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <div className={styles.headerCol}>
          <h1 className={styles.greeting}>{greeting}</h1>
          <p className={styles.subtitle}>
            {hasRoles
              ? subtitleFor(d.roles)
              : 'No roles yet. Start one to get a shortlist.'}
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
        {!hasRoles && (
          <div className={styles.roleRow}>
            <div className={styles.roleNameCol}>
              <span className={styles.roleName}>No roles yet</span>
              <span className={styles.roleMeta}>
                Start one to get a shortlist.
              </span>
            </div>
            <button
              className={styles.roleAction}
              onClick={postRole}
              disabled={createJob.isPending}
            >
              Post a role
            </button>
          </div>
        )}
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
            <button
              key={i}
              className={styles.conciergeChip}
              onClick={() => conciergeChip(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
