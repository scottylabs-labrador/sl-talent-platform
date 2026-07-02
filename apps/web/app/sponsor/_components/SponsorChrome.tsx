'use client';

// The persistent portal chrome: 64px header + 208px sidebar. Three active nav
// rows (Dashboard / Roles / Shortlist) route the main pane; four P2-stubbed rows
// fire a "ships in phase 2" toast without navigating. The role-slot meter is
// pinned to the sidebar bottom. "Ask the Concierge" fires the header toast.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  Briefcase,
  Code,
  LayoutDashboard,
  LineChart,
  List,
  MessageSquare,
  Search,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandGlyph, useToast } from '@/components/ui';
import { MonoText } from '@/components/ui';
import styles from './SponsorChrome.module.css';

interface ChromeOrg {
  id: string;
  name: string;
  tier: 'premier' | 'community';
  roleSlots: { used: number; total: number };
}
interface ChromeNav {
  rolesHref: string | null;
  shortlistHref: string | null;
}

const TIER_LABEL: Record<ChromeOrg['tier'], string> = {
  premier: 'Premier',
  community: 'Community',
};

export function SponsorChrome({
  org,
  nav,
  children,
}: {
  org: ChromeOrg;
  nav: ChromeNav;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();

  const pingConcierge = () =>
    toast(
      'Concierge: I can answer pool questions, rerun shortlists, or take a new role. Try me from any screen.',
      { durationMs: 3000 },
    );

  const p2 = (label: string) =>
    toast(`${label} ships in phase 2. The Concierge can answer most of it today.`, {
      durationMs: 3000,
    });

  const isDashboard = pathname === '/sponsor';
  const isRoles = pathname.startsWith('/sponsor/intake');
  const isShortlist = pathname.startsWith('/sponsor/shortlist');

  const iconProps = { width: 17, height: 17, strokeWidth: 1.75 } as const;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href="/" className={styles.hubLink}>
            <ArrowLeft width={14} height={14} strokeWidth={2} />
            Hub
          </Link>
          <span className={styles.divider} />
          <BrandGlyph size={34} />
          <div className={styles.lockup}>
            <span className={styles.brand}>ScottyLabs Talent</span>
            <span className={styles.brandCaption}>
              Sponsor portal · {org.name} · {TIER_LABEL[org.tier]}
            </span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.licensePill}>
            License: internal recruiting use only · all access logged
          </span>
          <button className={styles.askBtn} onClick={pingConcierge}>
            <MessageSquare width={13} height={13} strokeWidth={2} />
            Ask the Concierge
          </button>
          <span className={styles.avatar}>J</span>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <Link
            href="/sponsor"
            className={`${styles.navRow} ${isDashboard ? styles.navActive : ''}`}
          >
            <LayoutDashboard {...iconProps} />
            <span className={styles.navLabel}>Dashboard</span>
          </Link>

          <button
            className={`${styles.navRow} ${isRoles ? styles.navActive : ''}`}
            onClick={() =>
              nav.rolesHref ? router.push(nav.rolesHref) : p2('Roles')
            }
          >
            <Briefcase {...iconProps} />
            <span className={styles.navLabel}>Roles</span>
          </button>

          <button
            className={`${styles.navRow} ${isShortlist ? styles.navActive : ''}`}
            onClick={() =>
              nav.shortlistHref
                ? router.push(nav.shortlistHref)
                : p2('Shortlist')
            }
          >
            <List {...iconProps} />
            <span className={styles.navLabel}>Shortlist</span>
          </button>

          <button className={styles.navRow} onClick={() => p2('Talent Search')}>
            <Search {...iconProps} />
            <span className={styles.navLabel}>Talent Search</span>
            <span className={styles.p2}>P2</span>
          </button>
          <button className={styles.navRow} onClick={() => p2('Pipeline')}>
            <Activity {...iconProps} />
            <span className={styles.navLabel}>Pipeline</span>
            <span className={styles.p2}>P2</span>
          </button>
          <button className={styles.navRow} onClick={() => p2('API + MCP')}>
            <Code {...iconProps} />
            <span className={styles.navLabel}>API + MCP</span>
            <span className={styles.p2}>P2</span>
          </button>
          <button className={styles.navRow} onClick={() => p2('Analytics')}>
            <LineChart {...iconProps} />
            <span className={styles.navLabel}>Analytics</span>
            <span className={styles.p2}>P2</span>
          </button>

          <div className={styles.meter}>
            <div className={styles.meterRow}>
              <span>Role slots</span>
              <MonoText>
                {org.roleSlots.used} / {org.roleSlots.total}
              </MonoText>
            </div>
            <div className={styles.meterTrack}>
              <div
                className={styles.meterFill}
                style={{
                  width: `${Math.round(
                    (org.roleSlots.used / Math.max(1, org.roleSlots.total)) * 100,
                  )}%`,
                }}
              />
            </div>
            <span className={styles.meterCaption}>
              {TIER_LABEL[org.tier]} · renews Aug 2026
            </span>
          </div>
        </aside>

        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
