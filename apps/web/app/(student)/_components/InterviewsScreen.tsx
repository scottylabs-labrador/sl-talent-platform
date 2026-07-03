'use client';

import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/components/ui';
import styles from '../student.module.css';
import { TapFloorLink } from './parts';

const ROOT: React.CSSProperties = { padding: '64px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 };

export function InterviewsScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const { data, isLoading } = trpc.student.home.useQuery();
  const createScreen = trpc.student.createScreen.useMutation();

  if (isLoading || !data) return <div style={{ ...ROOT, color: '#869db3' }}>Loading…</div>;

  const card = data.dossierCard;
  const status = card?.screenStatus ?? null;
  const screenId = card?.screenId ?? null;
  const published = status === 'published' && card?.dossierStatus === 'approved';
  const inReview = status === 'review';
  const processing = status === 'processing';
  // A screen that was created but not yet completed can be resumed in place
  // rather than creating a second row.
  const resumable = status === 'scheduled' || status === 'live';
  // The coaching report and dossier draft exist once synthesis has run.
  const hasCoaching = status === 'review' || status === 'published';
  const reviewHref = screenId ? `/call/${screenId}?state=post` : '#';
  const starting = createScreen.isPending;

  // Start, resume, or retake the Talent Rep screen. A brand-new student has no
  // screen row yet, so we create one and then navigate into the call room; an
  // in-progress screen is resumed by navigating straight to it. `retakeOf`
  // links a retake to the prior published screen.
  function beginScreen(retakeOf?: string) {
    if (resumable && screenId && !retakeOf) {
      router.push(`/call/${screenId}`);
      return;
    }
    createScreen.mutate(retakeOf ? { retakeOf } : {}, {
      onSuccess: (d) => router.push(`/call/${d.screenId}`),
      onError: () =>
        toast('Could not start the screen. Please try again.', { durationMs: 2600 }),
    });
  }

  return (
    <div style={ROOT}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>Interviews</div>

      {/* Talent Rep screen status */}
      <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'var(--shadow-resting)' }}>
        {published ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Talent Rep screen</div>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#0d4b17', background: '#dcefe0', borderRadius: 4, padding: '3px 8px' }}>Live</span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#4a5662' }}>Your dossier is live for sponsors. The coaching report below stays private to you, always.</div>
            <button type="button" disabled={starting} onClick={() => beginScreen(screenId ?? undefined)} className={styles.btnGhost} style={{ minHeight: 38, fontSize: 12.5, fontWeight: 600 }}>
              {starting ? 'Starting…' : 'Retake (invisible to sponsors until you approve it)'}
            </button>
          </>
        ) : inReview ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Talent Rep screen</div>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#654a00', background: '#fdf6e3', borderRadius: 4, padding: '3px 8px' }}>Draft ready</span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#4a5662' }}>Your screen is done. Review and approve the dossier draft before any sponsor sees it.</div>
            <TapFloorLink href={reviewHref} className={styles.btnDark} visualHeight={44} style={{ fontSize: 13.5, fontWeight: 600 }}>Review the draft</TapFloorLink>
          </>
        ) : processing ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Talent Rep screen</div>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#654a00', background: '#fdf6e3', borderRadius: 4, padding: '3px 8px' }}>Processing</span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#4a5662' }}>We are turning your screen into a dossier draft and coaching report. This takes a few minutes; check back shortly.</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Talent Rep screen</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#4a5662' }}>{resumable ? 'You have a screen ready to begin. It is the one contribution that unlocks Premier shortlists, and you keep the coaching report either way.' : 'Not done yet. It is the one contribution that unlocks Premier shortlists, and you keep the coaching report either way.'}</div>
            <button type="button" disabled={starting} onClick={() => beginScreen()} className={styles.btnDark} style={{ height: 44, fontSize: 13.5, fontWeight: 600 }}>
              {starting ? 'Starting…' : resumable ? 'Resume the 30-minute screen' : 'Start the 30-minute screen'}
            </button>
          </>
        )}
      </div>

      {/* Coaching report entry — only once a real report exists. */}
      {hasCoaching && (
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'var(--shadow-resting)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Coaching Report</div>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: '#4b2d8f', background: '#d1c4ee', borderRadius: 4, padding: '3px 8px' }}>Private to you</span>
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#4a5662' }}>Strengths, growth areas, and practice suggestions from the Coach. The Coach is on your side; the Recruiter is neutral.</div>
          <TapFloorLink href={reviewHref} className={styles.btnGhost} visualHeight={38} style={{ fontSize: 12.5, fontWeight: 600 }}>Open report + dossier review</TapFloorLink>
        </div>
      )}

      {/* Semester refresher */}
      <div style={{ border: '1px dashed #aebdcc', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#4a5662' }}>Semester refresher</div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: '#5f6f7f' }}>A short voice check-in each term to log new coursework and your internship. Keeps your freshness date current in matching. We will let you know when yours opens.</div>
      </div>

      <div style={{ height: 76 }} />
    </div>
  );
}
