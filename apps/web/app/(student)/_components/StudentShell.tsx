'use client';

// The mobile app frame: full-bleed on phones, a 390px column on larger screens.
// The iPhone bezel from the prototype is presentation-only and not shipped. The
// frosted 5-tab bar is fixed to the bottom of the phone column.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Home, User, Mic, Briefcase, SlidersHorizontal } from 'lucide-react';
import styles from '../student.module.css';

export type StudentTab = 'home' | 'profile' | 'interviews' | 'matches' | 'settings';

const TABS: { id: StudentTab; label: string; href: string; Icon: typeof Home }[] = [
  { id: 'home', label: 'Home', href: '/', Icon: Home },
  { id: 'profile', label: 'Profile', href: '/profile', Icon: User },
  { id: 'interviews', label: 'Interviews', href: '/interviews', Icon: Mic },
  { id: 'matches', label: 'Matches', href: '/matches', Icon: Briefcase },
  { id: 'settings', label: 'You', href: '/settings', Icon: SlidersHorizontal },
];

export function StudentShell({
  active,
  children,
}: {
  active: StudentTab;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <div className={styles.phone}>
        <div className={styles.content}>{children}</div>
        <nav className={styles.tabbar} aria-label="Primary">
          {TABS.map(({ id, label, href, Icon }) => {
            const isActive = id === active;
            return (
              <Link
                key={id}
                href={href}
                className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon width={22} height={22} strokeWidth={1.9} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
