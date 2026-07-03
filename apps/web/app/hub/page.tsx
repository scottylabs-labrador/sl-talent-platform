// The Hub — a role-aware landing you can always return to. Every surface's
// "Hub" link points here. Signed-in users see a card for their surface plus a
// sign out; anonymous visitors are sent to sign in.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { BrandGlyph } from '@/components/ui';
import { SignOutButton } from './SignOutButton';

const TARTAN =
  'repeating-linear-gradient(90deg, rgba(215,36,68,.6) 0 5px, transparent 5px 26px, rgba(255,255,255,.18) 26px 28px, transparent 28px 52px), repeating-linear-gradient(0deg, rgba(14,150,209,.5) 0 2px, transparent 2px 7px)';

interface Surface {
  title: string;
  href: string;
  blurb: string;
  tag: string;
}

const STUDENT_SURFACE: Surface = {
  title: 'Student app',
  href: '/',
  blurb: 'Your Living Profile, the Talent Rep call, Matches, and the Data Ledger.',
  tag: 'Student',
};

const SURFACES: Record<string, Surface> = {
  student: STUDENT_SURFACE,
  sponsor: {
    title: 'Sponsor portal',
    href: '/sponsor',
    blurb:
      'Dashboard, role intake with the Concierge, the ranked shortlist, and dossiers.',
    tag: 'Sponsor',
  },
  operator: {
    title: 'Ops console',
    href: '/ops',
    blurb: 'The exception queue, agent workforce, and student creation tools.',
    tag: 'Operator',
  },
};

export default async function HubPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.userId) redirect('/login');

  const role = user.role ?? 'student';
  const surface: Surface = SURFACES[role] ?? STUDENT_SURFACE;

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        padding: 40,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <BrandGlyph size={44} />
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 26,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          ScottyLabs Talent
        </h1>
        <p style={{ color: 'var(--ink-500)', fontSize: 13, margin: 0 }}>
          Signed in as {user.name ?? 'you'} · {surface.tag}
        </p>
      </div>

      <Link
        href={surface.href}
        style={{
          textDecoration: 'none',
          color: 'inherit',
          background: '#fff',
          border: '1px solid #e9ebf8',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 1px 2px rgba(30,30,30,.06)',
          width: 'min(420px, 100%)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ height: 6, backgroundColor: '#063f58', backgroundImage: TARTAN }} />
        <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.015em' }}>
            Open the {surface.title.toLowerCase()}
          </span>
          <span style={{ fontSize: 13, lineHeight: 1.55, color: '#4a5662' }}>{surface.blurb}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#0e96d1', marginTop: 2 }}>Continue →</span>
        </div>
      </Link>

      <SignOutButton />
    </main>
  );
}
