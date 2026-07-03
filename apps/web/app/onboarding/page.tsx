// /onboarding — the self-serve student onboarding wizard.
//
// Server guard: only students reach it (requireSession), and an already-
// onboarded student is redirected home (defence in depth — middleware also
// gates this, but middleware fails open). The wizard itself is a client
// component that reads/writes over tRPC.
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth';
import { getServerApi } from '@/lib/trpc/server';
import { OnboardingWizard } from './_components/OnboardingWizard';

export default async function OnboardingPage() {
  await requireSession('student');
  const api = await getServerApi();
  const state = await api.student.onboardingState();
  if (state.onboarded) redirect('/');
  return <OnboardingWizard initialStep={state.step} />;
}
