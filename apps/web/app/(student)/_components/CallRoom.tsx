'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Check } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/components/ui';
import { TartanBand } from '@/components/ui';
import styles from '../student.module.css';
import { useVoiceSession } from '@/lib/voice/useVoiceSession';
import { VoiceBars, ProgressArc, VisibilitySwitch, AudioMomentRow, CompetencyRow } from './parts';
import { clockLabel } from './format';

type Phase = 'pre' | 'live' | 'post';

const AGENDA = [
  ['01', 'Consent + warm-up', '2 min'],
  ['02', 'Resume walkthrough, gaps only', '6 min'],
  ['03', 'Two experience deep-dives', '12 min'],
  ['04', 'Domain drill, calibrated to 15-440', '6 min'],
  ['05', 'Logistics + what great looks like', '3 min'],
  ['06', 'Wrap, what happens next', '1 min'],
];

function mmss(ms: number): string {
  const t = Math.floor(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function CallRoom({ screenId, initialPhase }: { screenId: string; initialPhase: Phase }) {
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [consentA, setConsentA] = useState(false);
  const [consentB, setConsentB] = useState(false);
  const [conn, setConn] = useState<{ wsUrl: string; token: string; simulated: boolean } | null>(null);

  const startCall = trpc.student.startCall.useMutation();

  const voice = useVoiceSession({
    wsUrl: conn?.wsUrl ?? null,
    token: conn?.token ?? null,
    screenId,
    enabled: phase === 'live' && Boolean(conn),
    simulatedHint: conn?.simulated,
  });

  const bg = phase === 'live' ? '#070c11' : phase === 'post' ? '#f5f7fa' : '#fff';

  return (
    <div className={styles.shell}>
      <div className={styles.phone} style={{ background: bg }}>
        {phase === 'pre' && (
          <Consent
            consentA={consentA}
            consentB={consentB}
            setA={setConsentA}
            setB={setConsentB}
            pending={startCall.isPending}
            onClose={() => router.push('/')}
            onTextMode={() => toast('The written version is coming soon.', { durationMs: 2600 })}
            onStart={() => {
              startCall.mutate(
                { screenId, consentRecording: consentA, consentLicense: consentB },
                {
                  onSuccess: (d) => {
                    setConn({ wsUrl: d.wsUrl, token: d.token, simulated: d.simulated });
                    setPhase('live');
                  },
                  onError: () => toast('Could not start the call. Please try again.', { durationMs: 2600 }),
                },
              );
            }}
          />
        )}

        {phase === 'live' && <Live voice={voice} onEnd={() => { voice.endCall(); setPhase('post'); }} />}

        {phase === 'post' && (
          <PostReview
            screenId={screenId}
            onClose={() => router.push('/')}
            onApproved={() => {
              void utils.student.home.invalidate();
              void utils.student.profile.invalidate();
              toast('Dossier published. Sponsors now see your approved version.', { durationMs: 2600 });
              router.push('/profile');
            }}
            onStrike={() => toast('Struck moments never render for sponsors, and it is not held against you.', { durationMs: 2600 })}
          />
        )}
      </div>
    </div>
  );
}

// ── Consent ─────────────────────────────────────────────────────────────────
function Checkbox({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={checked} style={{ border: `1px solid ${checked ? '#0e96d1' : '#e9ebf8'}`, borderRadius: 12, padding: '13px 14px', display: 'flex', gap: 11, alignItems: 'flex-start', background: '#fff', textAlign: 'left', cursor: 'pointer' }}>
      <span style={{ width: 20, height: 20, borderRadius: 5, border: `1.75px solid ${checked ? '#0e96d1' : '#869db3'}`, background: checked ? '#0e96d1' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
        {checked && <Check size={11} strokeWidth={3.5} color="#fff" />}
      </span>
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#1e1e1e' }}>{children}</span>
    </button>
  );
}

function Consent({ consentA, consentB, setA, setB, onStart, onClose, onTextMode, pending }: {
  consentA: boolean; consentB: boolean; setA: (v: boolean) => void; setB: (v: boolean) => void;
  onStart: () => void; onClose: () => void; onTextMode: () => void; pending: boolean;
}) {
  const both = consentA && consentB;
  return (
    <div className={styles.overlay} style={{ background: '#fff', position: 'relative', minHeight: '100dvh' }}>
      <div style={{ padding: '64px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 21, letterSpacing: '-0.02em' }}>Before we start</div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid #c7d2dc', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={14} color="#4a5662" />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ border: '1px solid #e9ebf8', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#869db3' }}>30 minutes, six parts</div>
          {AGENDA.map(([n, name, time]) => (
            <div key={n} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#0e96d1' }}>{n}</span>
              <span style={{ fontSize: 13, color: '#1e1e1e', flex: 1 }}>{name}</span>
              <span style={{ fontSize: 11.5, color: '#869db3' }}>{time}</span>
            </div>
          ))}
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #e9ebf8', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: '#869db3' }}>The recording, plainly</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: '#4a5662' }}>Nothing is retained until you consent, here and again out loud on the call. You approve every sponsor-visible word before it ships. Audio is stream only for sponsors and auto-deletes 18 months after your last activity.</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: '#4a5662' }}>Pennsylvania is an all-party consent state, so the Rep will confirm again at minute zero.</div>
        </div>

        <Checkbox checked={consentA} onToggle={() => setA(!consentA)}>I consent to this call being recorded and processed into my profile, dossier and coaching report.</Checkbox>
        <Checkbox checked={consentB} onToggle={() => setB(!consentB)}>I understand sponsors receive my approved dossier under license: internal recruiting use only, no resale, no model training, deletion on contract end.</Checkbox>

        <button type="button" disabled={!both || pending} onClick={onStart} className={both ? styles.btnDark : styles.btnDisabled} style={{ height: 48, fontSize: 15, fontWeight: 600, marginTop: 2 }}>
          {pending ? 'Starting…' : 'Start the call'}
        </button>
        <button type="button" onClick={onTextMode} className={styles.linkBtn} style={{ height: 40, color: '#5f6f7f', fontSize: 12.5, fontWeight: 500 }}>Prefer text? Take the written version instead</button>
      </div>
    </div>
  );
}

// ── Live ──────────────────────────────────────────────────────────────────
function Live({ voice, onEnd }: { voice: ReturnType<typeof useVoiceSession>; onEnd: () => void }) {
  const section = voice.sections[voice.currentSection];
  const lastThree = voice.captions.slice(-3);
  return (
    <div className={styles.overlay} style={{ background: '#070c11', position: 'relative', minHeight: '100dvh' }}>
      <div style={{ padding: '62px 20px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 600, letterSpacing: '.05em', color: '#f3bbc5', border: '1px solid rgba(215,36,68,.5)', borderRadius: 100, padding: '6px 11px' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d72444' }} /> REC · consented
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(255,255,255,.75)' }}>{mmss(voice.elapsed)} / 30:00</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 0 0' }}>
        <ProgressArc activeIndex={voice.currentSection}>
          <VoiceBars playing={!voice.paused} />
          <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{section?.name}</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.55)' }}>{section?.sub}</div>
        </ProgressArc>
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'rgba(255,255,255,.4)', marginTop: 6 }}>The Rep is listening</div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 10, padding: '12px 18px 14px' }}>
        {lastThree.map((c, i) => {
          const isYou = c.speaker === 'student';
          const isLast = i === lastThree.length - 1;
          return (
            <div key={c.turnId} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignSelf: isYou ? 'flex-end' : 'flex-start', maxWidth: '88%', opacity: isLast ? 1 : 0.45 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'rgba(255,255,255,.45)', padding: '0 6px' }}>{isYou ? 'You' : 'Talent Rep'}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: '#fff', borderRadius: 14, padding: '9px 13px', background: isYou ? 'rgba(14,150,209,.22)' : 'rgba(255,255,255,.08)', border: `1px solid ${isYou ? 'rgba(14,150,209,.45)' : 'rgba(255,255,255,.14)'}` }}>{c.text}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, padding: '6px 20px 36px' }}>
        <button type="button" onClick={() => (voice.paused ? voice.resume() : voice.pause())} style={{ flex: 1, height: 48, borderRadius: 100, border: '1px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.06)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          {voice.paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" onClick={onEnd} className={styles.btnDanger} style={{ flex: 1, height: 48, fontSize: 14, fontWeight: 600 }}>End call</button>
      </div>
    </div>
  );
}

// ── Post-call review ────────────────────────────────────────────────────────
function PostReview({ screenId, onClose, onApproved, onStrike }: {
  screenId: string; onClose: () => void; onApproved: () => void; onStrike: () => void;
}) {
  const review = trpc.student.screenReview.useQuery({ screenId });
  const updateMoment = trpc.student.updateMoment.useMutation();
  const approve = trpc.student.approveScreen.useMutation();

  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [struck, setStruck] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (review.data) {
      const v: Record<string, boolean> = {};
      const s: Record<string, boolean> = {};
      for (const m of review.data.moments) { v[m.id] = m.studentVisible; s[m.id] = m.struck; }
      setVisible(v);
      setStruck(s);
    }
  }, [review.data]);

  const competencyRows = useMemo(
    () =>
      (review.data?.dossier?.competency ?? []).map((c) => ({
        name: c.name,
        score: c.score,
        link: c.momentId && c.timestampMs != null ? `moment ${clockLabel(c.timestampMs)}` : 'full transcript',
      })),
    [review.data],
  );

  if (review.isLoading || !review.data) {
    return <div style={{ padding: 40, color: '#869db3' }}>Loading your review…</div>;
  }
  const { coachingReport, dossier, moments } = review.data;
  const shown = moments.filter((m) => !struck[m.id]);

  const toggleVisible = (id: string) => {
    const next = !visible[id];
    setVisible((v) => ({ ...v, [id]: next }));
    updateMoment.mutate({ momentId: id, studentVisible: next });
  };
  const strike = (id: string) => {
    setStruck((s) => ({ ...s, [id]: true }));
    updateMoment.mutate({ momentId: id, struck: true });
    onStrike();
  };

  const coach: [string, string, string[]][] = [
    ['What landed', '#0d4b17', coachingReport?.landed ?? []],
    ['What was vague', '#654a00', coachingReport?.vague ?? []],
    ['Practice next', '#0a6b94', coachingReport?.practiceNext ?? []],
  ];

  return (
    <div className={styles.overlay} style={{ background: '#f5f7fa', position: 'relative', minHeight: '100dvh' }}>
      <div style={{ padding: '64px 20px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 21, letterSpacing: '-0.02em' }}>Two things arrived</div>
          <div style={{ fontSize: 12, color: '#5f6f7f' }}>Call ended at 29:12 · transcript saved</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid #c7d2dc', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={14} color="#4a5662" />
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 20px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Coaching report */}
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 11, boxShadow: 'var(--shadow-resting)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Coaching Report</div>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: '#4b2d8f', background: '#d1c4ee', borderRadius: 4, padding: '3px 8px' }}>Private to you</span>
          </div>
          {coach.map(([label, color, lines]) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color }}>{label}</div>
              {lines.map((l, i) => (
                <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: '#4a5662' }}>{l}</div>
              ))}
            </div>
          ))}
        </div>

        {/* Dossier draft */}
        <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-resting)' }}>
          <TartanBand recipe="student" thickness={5} />
          <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Screen Dossier, draft</div>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#654a00', background: '#fdf6e3', borderRadius: 4, padding: '3px 8px' }}>Ships only if you approve</span>
            </div>
            {competencyRows.map((c) => (
              <CompetencyRow key={c.name} name={c.name} score={c.score} link={c.link} />
            ))}

            <div style={{ borderTop: '1px solid #e9ebf8', paddingTop: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#869db3' }}>Audio moments · you control each</div>
              {shown.map((m) => (
                <AudioMomentRow
                  key={m.id}
                  momentId={m.id}
                  tag={m.tag}
                  quote={m.quote}
                  durationMs={m.tEndMs - m.tStartMs}
                  right={<VisibilitySwitch on={visible[m.id] ?? m.studentVisible} onClick={() => toggleVisible(m.id)} label={`Sponsor visibility for ${m.tag}`} />}
                />
              ))}
              {shown[0] && (
                <button type="button" onClick={() => strike(shown[0]!.id)} className={styles.linkBtn} style={{ fontSize: 12, color: '#5f6f7f', textAlign: 'left', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  Strike a moment entirely
                </button>
              )}
            </div>

            <button
              type="button"
              disabled={approve.isPending || !dossier}
              onClick={() => approve.mutate({ screenId }, { onSuccess: onApproved })}
              className={styles.btnDark}
              style={{ height: 46, fontSize: 14, fontWeight: 600 }}
            >
              {approve.isPending ? 'Publishing…' : 'Approve and publish to sponsors'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
