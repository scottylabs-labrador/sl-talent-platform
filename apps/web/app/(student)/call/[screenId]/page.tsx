import { requireSession } from '@/auth';
import { CallRoom } from '../../_components/CallRoom';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ screenId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireSession('student');
  const { screenId } = await params;
  const sp = await searchParams;
  const initialPhase = sp.state === 'post' ? 'post' : 'pre';
  return <CallRoom screenId={screenId} initialPhase={initialPhase} />;
}
