// Ops Students route. Operator-only. Server component: guards the principal,
// loads the roster through the request-scoped tRPC caller, then hands it to the
// interactive client tool (roster table + create-student modal).

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getServerApi } from '@/lib/trpc/server';
import { OpsStudents } from './OpsStudents';

export const metadata = {
  title: 'Talent Ops · Students',
};

// The roster mutates as operators mint profiles; never statically cache it.
export const dynamic = 'force-dynamic';

export default async function OpsStudentsPage() {
  const session = await auth();
  if (!session?.user?.userId) redirect('/login');
  if (session.user.role !== 'operator') redirect('/');

  const api = await getServerApi();
  const { students } = await api.ops.opsStudents();

  const operatorInitial = session.user.name?.trim()?.[0]?.toUpperCase() ?? 'L';

  return (
    <OpsStudents initialStudents={students} operatorInitial={operatorInitial} />
  );
}
