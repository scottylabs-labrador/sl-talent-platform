// Ops Console route. Operator-only. Server component: guards the principal,
// loads the exception queue + the sidebar rollups through the request-scoped
// tRPC caller, then hands them to the interactive client component.

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getServerApi } from '@/lib/trpc/server';
import { OpsConsole } from './OpsConsole';

export const metadata = {
  title: 'Talent Ops',
};

// Live data (the queue mutates); never statically cache this surface.
export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  const session = await auth();
  if (!session?.user?.userId) redirect('/login');
  if (session.user.role !== 'operator') redirect('/');

  const api = await getServerApi();
  const [exceptions, sidebar] = await Promise.all([
    api.ops.exceptions(),
    api.ops.sidebar(),
  ]);

  // Real operator initial: first letter of the logged-in operator's name (or
  // email when unnamed). Never a seeded placeholder.
  const operatorInitial =
    (session.user.name?.trim() || session.user.email?.trim() || '')
      .charAt(0)
      .toUpperCase() || '?';

  return (
    <OpsConsole
      initialExceptions={exceptions.exceptions}
      sidebar={sidebar}
      operatorInitial={operatorInitial}
    />
  );
}
