import { requireSession } from '@/auth';
import { StudentShell } from '../_components/StudentShell';
import { InterviewsScreen } from '../_components/InterviewsScreen';

export default async function Page() {
  await requireSession('student');
  return (
    <StudentShell active="interviews">
      <InterviewsScreen />
    </StudentShell>
  );
}
