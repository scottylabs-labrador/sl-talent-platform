'use client';

import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import styles from '../student.module.css';

const ROOT: React.CSSProperties = { padding: '64px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 };

export function InterviewsScreen() {
  const { data, isLoading } = trpc.student.home.useQuery();
  if (isLoading || !data) return <div style={{ ...ROOT, color: '#869db3' }}>Loading…</div>;

  const card = data.dossierCard;
  const published = card?.screenStatus === 'published' && card?.dossierStatus === 'approved';
  const screenId = card?.screenId;
  const startHref = screenId ? `/call/${screenId}` : '#';
  const reviewHref = screenId ? `/call/${screenId}?state=post` : '#';

  return (
    <div style={ROOT}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>Interviews</div>

      {/* Talent Rep screen status */}
      <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'var(--shadow-resting)' }}>
        {published ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Talent Rep screen</div>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#0d4b17', background: '#dcefe0', borderRadius: 4, padding: '3px 8px' }}>Completed · Jul 1</span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#4a5662' }}>Dossier live with 3 audio moments. Coaching report below is private to you, always.</div>
            <Link href={startHref} className={styles.btnGhost} style={{ height: 38, fontSize: 12.5, fontWeight: 600 }}>Retake (1 left this semester, invisible to sponsors)</Link>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Talent Rep screen</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#4a5662' }}>Not done yet. It is the one contribution that unlocks Premier shortlists, and you keep the coaching report either way.</div>
            <Link href={startHref} className={styles.btnDark} style={{ height: 44, fontSize: 13.5, fontWeight: 600 }}>Start the 30-minute screen</Link>
          </>
        )}
      </div>

      {/* Coaching report entry */}
      <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'var(--shadow-resting)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Coaching Report · Jul 1</div>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: '#4b2d8f', background: '#d1c4ee', borderRadius: 4, padding: '3px 8px' }}>Private to you</span>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#4a5662' }}>Two strengths, two growth areas, two practice suggestions from the Coach. The Coach is on your side; the Recruiter is neutral.</div>
        <Link href={reviewHref} className={styles.btnGhost} style={{ height: 38, fontSize: 12.5, fontWeight: 600 }}>Open report + dossier review</Link>
      </div>

      {/* Semester refresher */}
      <div style={{ border: '1px dashed #aebdcc', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#4a5662' }}>Semester refresher · opens Dec 8</div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: '#5f6f7f' }}>A 10-minute voice check-in to log new coursework and your internship. Keeps your freshness date current in matching.</div>
      </div>

      <div style={{ height: 76 }} />
    </div>
  );
}
