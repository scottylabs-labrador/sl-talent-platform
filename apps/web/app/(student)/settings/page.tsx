import { requireSession } from '@/auth';
import { StudentShell } from '../_components/StudentShell';
import { SettingsScreen } from '../_components/SettingsScreen';

export default async function Page() {
  await requireSession('student');
  return (
    <StudentShell active="settings">
      <SettingsScreen />
    </StudentShell>
  );
}
