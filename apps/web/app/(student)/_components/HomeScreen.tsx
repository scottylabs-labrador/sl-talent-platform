'use client';

import Link from 'next/link';
import { Check, Plus } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { TartanBand } from '@/components/ui';
import styles from '../student.module.css';
import { Avatar, StepTimeline } from './parts';
import { initials, ledgerChip, ledgerWhen } from './format';

const ROOT: React.CSSProperties = {
  padding: '64px 20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

export function HomeScreen() {
  const { data, isLoading } = trpc.student.home.useQuery();

  if (isLoading || !data) {
    return <div style={{ ...ROOT, color: '#869db3' }}>Loading your home…</div>;
  }

  const { student, strengthMeter, primaryAction, liveMatch, ledgerPreview, dossierCard } = data;
  const published = dossierCard?.screenStatus === 'published' && dossierCard?.dossierStatus === 'approved';

  return (
    <div style={ROOT}>
      {/* Greeting */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
            Hey, {student.name.split(' ')[0]}
          </div>
          <div style={{ fontSize: 12.5, color: '#5f6f7f' }}>ScottyLabs Talent · profile live</div>
        </div>
        <Avatar size={40} fontSize={14}>{initials(student.name)}</Avatar>
      </div>

      {/* Primary action OR published confirmation */}
      {published ? (
        <div style={{ background: '#fff', borderRadius: 12, padding: 18, display: 'flex', gap: 12, boxShadow: 'var(--shadow-resting)' }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#e7f5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <Check size={16} strokeWidth={2.2} color="#0e96d1" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Your Screen Dossier is live</div>
            <div style={{ fontSize: 12.5, color: '#5f6f7f' }}>Visible to 10 Premier sponsors under license</div>
          </div>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-raised)' }}>
          <TartanBand recipe="student" thickness={5} />
          <div style={{ padding: '18px 18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#0a6b94' }}>
              {primaryAction.eyebrow}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.015em', lineHeight: 1.25 }}>
              {primaryAction.title}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: '#4a5662' }}>{primaryAction.body}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <Link href={primaryAction.primary.href ?? '#'} className={styles.btnDark} style={{ height: 44, padding: '0 22px', fontSize: 14, fontWeight: 600 }}>
                {primaryAction.primary.label}
              </Link>
              {primaryAction.secondary && (
                <button type="button" className={styles.btnGhost} style={{ height: 44, padding: '0 18px', fontSize: 14, fontWeight: 600 }}>
                  {primaryAction.secondary.label}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Strength meter */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: 'var(--shadow-resting)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{strengthMeter.label}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: '#0a6b94' }}>{strengthMeter.value}</div>
        </div>
        <div style={{ height: 6, borderRadius: 100, background: '#e9ebf8', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${strengthMeter.value}%`, background: 'linear-gradient(90deg,#0e96d1,#6940c9)' }} />
        </div>
        <Link href="/profile" className={styles.nudge} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8, border: '1px dashed #aebdcc', background: '#f8fafc', textDecoration: 'none' }}>
          <Plus size={15} strokeWidth={2} color="#0a6b94" style={{ flex: 'none', marginTop: 1 }} />
          <div style={{ fontSize: 12.5, lineHeight: 1.45, color: '#4a5662' }}>
            <span style={{ fontWeight: 600, color: '#1e1e1e' }}>Do this next:</span> {strengthMeter.doNext} <span style={{ fontWeight: 600, color: '#0a6b94' }}>+4</span>
          </div>
        </Link>
      </div>

      {/* Live match */}
      {liveMatch && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'var(--shadow-resting)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Live match</div>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#0d4b17', background: '#dcefe0', borderRadius: 4, padding: '3px 8px' }}>{liveMatch.statusTag}</span>
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>{liveMatch.roleTitle} · {liveMatch.company}</div>
          <StepTimeline done={liveMatch.stepsDone} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#5f6f7f' }}>
            {liveMatch.stepLabels.map((l) => <span key={l}>{l}</span>)}
          </div>
          <Link href="/matches" className={styles.btnGhost} style={{ height: 40, fontSize: 13, fontWeight: 600, marginTop: 2 }}>
            Answer Scogle&rsquo;s follow-up question
          </Link>
        </div>
      )}

      {/* Ledger preview */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 2, boxShadow: 'var(--shadow-resting)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Your data, at work</div>
          <Link href="/settings" style={{ fontSize: 12, fontWeight: 600, color: '#0e96d1' }}>Full ledger</Link>
        </div>
        {ledgerPreview.map((row) => {
          const chip = ledgerChip(row.eventKind, row.actorLabel);
          return (
            <div key={row.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: '1px solid #e9ebf8', alignItems: 'flex-start' }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: chip.bg, color: chip.fg, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                {chip.code}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.4, color: '#1e1e1e' }}>{row.detail.note ?? chip.kindWord}</div>
                <div style={{ fontSize: 11, color: '#869db3' }}>{ledgerWhen(row.createdAt)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ height: 76 }} />
    </div>
  );
}
