import { requireSession } from '@/auth';
import { ProfileScreen } from '../_components/ProfileScreen';

export default async function Page() {
  await requireSession('student');
  return <ProfileScreen />;
}
