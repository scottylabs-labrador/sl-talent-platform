// Student Home at '/'. Anonymous visitors go to /login; sponsors and operators
// are redirected to their own surfaces by requireSession. Students land here.

import { requireSession } from '@/auth';
import { StudentShell } from './(student)/_components/StudentShell';
import { HomeScreen } from './(student)/_components/HomeScreen';

export default async function Page() {
  await requireSession('student');
  return (
    <StudentShell active="home">
      <HomeScreen />
    </StudentShell>
  );
}
