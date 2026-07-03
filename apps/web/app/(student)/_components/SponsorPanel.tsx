'use client';

// The "view as sponsor" desktop panel (640px) rendered beside the phone. This is
// exactly what a licensed sponsor sees: the same profile data, the same moment
// visibility the student controls, and NOTHING that is private (coaching report,
// struck moments, grades, retake history).

import { Shield, Lock, EyeOff } from 'lucide-react';
import { TartanBand } from '@/components/ui';
import styles from '../student.module.css';
import { Avatar, AudioMomentRow, CompetencyRow } from './parts';
import { initials } from './format';

export interface SponsorSkill {
  skillId: string;
  name: string;
  verified: boolean;
  count: number;
}
export interface SponsorMoment {
  id: string;
  tag: string;
  quote: string;
  durationMs: number;
  studentVisible: boolean;
  struck: boolean;
}
export interface SponsorCompetency {
  name: string;
  score: number;
  link: string;
}

export function SponsorPanel({
  name,
  andrewId,
  metaLine,
  subLine,
  skills,
  expandedSkillId,
  competency,
  moments,
}: {
  name: string;
  andrewId: string;
  metaLine: string;
  subLine: string;
  skills: SponsorSkill[];
  expandedSkillId: string | null;
  competency: SponsorCompetency[];
  moments: SponsorMoment[];
}) {
  return (
    <div className={styles.sponsorPanel}>
      {/* Browser chrome */}
      <div style={{ background: '#1e1e1e', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: '#4a5662' }} />
          ))}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#aebdcc' }}>
          talent.scottylabs.org/pool/{andrewId} · as a licensed sponsor
        </div>
      </div>

      {/* License banner */}
      <div style={{ background: '#e7f5fa', borderBottom: '1px solid #b4def1', padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Shield size={13} color="#0a6b94" style={{ flex: 'none' }} />
        <div style={{ fontSize: 11.5, color: '#0a6b94' }}>
          Premier license: internal recruiting use only, no resale, no model training. Every real sponsor view is logged to your ledger.
        </div>
      </div>

      {/* Body */}
      <div style={{ background: '#f5f7fa', padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Identity */}
        <div style={{ background: '#fff', borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: 'var(--shadow-resting)' }}>
          <Avatar size={52} radius={14} fontSize={18}>{initials(name)}</Avatar>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.015em' }}>{name}</span>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: '#0a6b94', background: '#e7f5fa', border: '1px solid #90cfea', borderRadius: 4, padding: '2px 6px' }}>
                SSO verified
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: '#4a5662' }}>{metaLine}</div>
            <div style={{ fontSize: 11.5, color: '#869db3' }}>{subLine}</div>
          </div>
        </div>

        {/* Skills */}
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'var(--shadow-resting)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#869db3' }}>Skills, evidence-weighted</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {skills.map((s) => {
              const selected = s.skillId === expandedSkillId;
              const style: React.CSSProperties = selected
                ? { background: '#063f58', color: '#fff', border: '1.5px solid #063f58' }
                : s.verified
                  ? { background: '#e7f5fa', color: '#0a6b94', border: '1.5px solid #90cfea' }
                  : { background: '#fff', color: '#5f6f7f', border: '1.5px dashed #aebdcc' };
              return (
                <span key={s.skillId} style={{ height: 30, padding: '0 12px', borderRadius: 100, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 12, ...style }}>
                  {s.name}
                  {s.verified && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, opacity: 0.75 }}>×{s.count}</span>}
                </span>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: '#869db3' }}>Hollow chips are the candidate&rsquo;s own claims. They rank lower until evidence attaches.</div>
        </div>

        {/* Dossier */}
        <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-resting)' }}>
          <TartanBand recipe="student" thickness={5} />
          <div style={{ padding: '16px 20px 18px', display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Screen Dossier</div>
              <div style={{ fontSize: 10.5, color: '#869db3' }}>audio is stream only, plays are logged</div>
            </div>
            {competency.map((c) => (
              <CompetencyRow key={c.name} name={c.name} score={c.score} link={c.link} />
            ))}
            <div style={{ borderTop: '1px solid #e9ebf8', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {moments.map((m) => {
                const visible = m.studentVisible && !m.struck;
                if (visible) {
                  return (
                    <AudioMomentRow
                      key={m.id}
                      momentId={m.id}
                      tag={m.tag}
                      quote={m.quote}
                      durationMs={m.durationMs}
                      playSize={32}
                      wrapperStyle={{ padding: '10px 12px' }}
                    />
                  );
                }
                return (
                  <div key={m.id} style={{ border: '1px dashed #c7d2dc', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, opacity: 0.65 }}>
                    <EyeOff size={14} color="#869db3" style={{ flex: 'none' }} />
                    <div style={{ fontSize: 11.5, color: '#869db3' }}>You hid &ldquo;{m.tag}&rdquo;. Sponsors do not see this row at all.</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Never in this view */}
        <div style={{ border: '1px dashed #aebdcc', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <Lock size={14} color="#5f6f7f" style={{ flex: 'none', marginTop: 1 }} />
          <div style={{ fontSize: 11.5, lineHeight: 1.55, color: '#5f6f7f' }}>
            Never in this view: your coaching report, struck moments, grades, retake history, and anything you set to hidden. This panel is exactly what a sponsor sees, nothing more.
          </div>
        </div>
      </div>
    </div>
  );
}
