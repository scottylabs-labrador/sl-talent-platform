// Sponsor portal shell. Server component: gates on the sponsor role, fetches the
// lightweight org context for the persistent chrome (header + sidebar meter),
// and wraps every sponsor route in <SponsorChrome>. The main pane swaps by route
// (dashboard / intake / shortlist); the chrome never re-renders across them.

import { SessionProvider } from 'next-auth/react';
import { requireSession } from '@/auth';
import { getServerApi } from '@/lib/trpc/server';
import { SponsorChrome } from './_components/SponsorChrome';
import { ConciergeProvider } from './_components/ConciergeSheet';

export default async function SponsorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The session carries the real logged-in identity; SessionProvider makes it
  // available to the client chrome (greeting, author labels, avatar) so nothing
  // is hardcoded to a demo name.
  const session = await requireSession('sponsor');
  const api = await getServerApi();
  const { org, nav } = await api.sponsor.chrome();
  return (
    <SessionProvider session={session}>
      <ConciergeProvider orgName={org.name}>
        <SponsorChrome org={org} nav={nav}>
          {children}
        </SponsorChrome>
      </ConciergeProvider>
    </SessionProvider>
  );
}
