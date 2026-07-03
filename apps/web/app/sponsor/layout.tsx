// Sponsor portal shell. Server component: gates on the sponsor role, fetches the
// lightweight org context for the persistent chrome (header + sidebar meter),
// and wraps every sponsor route in <SponsorChrome>. The main pane swaps by route
// (dashboard / intake / shortlist); the chrome never re-renders across them.

import { requireSession } from '@/auth';
import { getServerApi } from '@/lib/trpc/server';
import { SponsorChrome } from './_components/SponsorChrome';
import { ConciergeProvider } from './_components/ConciergeSheet';

export default async function SponsorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession('sponsor');
  const api = await getServerApi();
  const { org, nav } = await api.sponsor.chrome();
  return (
    <ConciergeProvider>
      <SponsorChrome org={org} nav={nav}>
        {children}
      </SponsorChrome>
    </ConciergeProvider>
  );
}
