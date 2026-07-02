import { requireSession } from '@/auth';
import { StudentShell } from '../_components/StudentShell';
import { MatchesScreen } from '../_components/MatchesScreen';

export default async function Page() {
  await requireSession('student');
  return (
    <StudentShell active="matches">
      <MatchesScreen />
    </StudentShell>
  );
}
