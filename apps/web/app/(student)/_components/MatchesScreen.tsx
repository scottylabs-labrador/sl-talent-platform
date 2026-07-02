'use client';

import { useRef, useState } from 'react';
import { Mic, Check } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/components/ui';
import styles from '../student.module.css';
import { Avatar, StepTimeline, RecBars } from './parts';

const ROOT: React.CSSProperties = { padding: '64px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 };
const STEP_LABELS = ['Matched', 'Shortlisted', 'Intro', 'Interview', 'Outcome'];
const REC_CAP_MS = 14_000;

type RecState = 'idle' | 'rec' | 'sent';

export function MatchesScreen() {
  const { data, isLoading } = trpc.student.matches.useQuery();
  const { toast } = useToast();
  const uploadUrl = trpc.student.replyUploadUrl.useMutation();
  const reply = trpc.student.replyToMatch.useMutation();

  const [recState, setRecState] = useState<RecState>('idle');
  const [recT, setRecT] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  if (isLoading || !data) return <div style={{ ...ROOT, color: '#869db3' }}>Loading matches…</div>;
  const match = data.matches[0];

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  };

  const send = async (entryId: string, blob: Blob | null) => {
    try {
      let audioKey: string | undefined;
      if (blob && blob.size > 0) {
        const { url, key } = await uploadUrl.mutateAsync({ entryId, contentType: blob.type || 'audio/webm' });
        await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'audio/webm' } });
        audioKey = key;
      }
      await reply.mutateAsync({ entryId, audioKey });
    } catch {
      // Delivery is best-effort in the demo; still confirm to the student.
      try {
        await reply.mutateAsync({ entryId });
      } catch {
        /* ignore */
      }
    }
    setRecState('sent');
    toast('Reply sent to the Recruiter. Scogle sees it with your shortlist card.', { durationMs: 2600 });
  };

  const startRec = async (entryId: string) => {
    setRecState('rec');
    setRecT(0);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        cleanup();
        void send(entryId, blob);
      };
      rec.start();
    } catch {
      // No mic permission — the record UX still runs; we deliver a text-less reply.
      recorderRef.current = null;
    }
    const started = Date.now();
    timerRef.current = setInterval(() => {
      const t = (Date.now() - started) / 1000;
      if (t * 1000 >= REC_CAP_MS) doneRec(entryId);
      else setRecT(t);
    }, 100);
  };

  const doneRec = (entryId: string) => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop(); // onstop -> send
    } else {
      cleanup();
      void send(entryId, null);
    }
  };

  return (
    <div style={ROOT}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>Matches</div>

      {match && (
        <>
          {/* Role card */}
          <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 11, boxShadow: 'var(--shadow-resting)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar size={32} radius={8} fontSize={13}>{match.company[0]}</Avatar>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{match.roleTitle}</div>
                <div style={{ fontSize: 11.5, color: '#5f6f7f' }}>{match.company} · Pittsburgh or Kirkland</div>
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#0d4b17', background: '#dcefe0', borderRadius: 4, padding: '3px 8px' }}>Shortlisted</span>
            </div>
            <div style={{ fontSize: 12, color: '#4a5662' }}>{match.compLabel} · Summer 2027 · CPT friendly · comp disclosed per platform policy</div>
            <StepTimeline done={match.timelineDone} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#5f6f7f' }}>
              {STEP_LABELS.map((l) => <span key={l}>{l}</span>)}
            </div>
          </div>

          {/* Async question card */}
          {match.asyncQuestion && (
            <div style={{ background: '#fff', border: '1.5px solid #90cfea', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 2px 8px rgba(14,150,209,.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: '#0a6b94' }}>Follow-up from the Recruiter</div>
                <div style={{ fontSize: 10.5, color: '#869db3' }}>2 min · voice</div>
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, color: '#1e1e1e' }}>{match.asyncQuestion.text}</div>

              {recState === 'idle' && (
                <button type="button" onClick={() => startRec(match.entryId)} className={styles.btnDark} style={{ height: 46, fontSize: 13.5, fontWeight: 600 }}>
                  <Mic size={14} /> Tap to record your reply
                </button>
              )}
              {recState === 'rec' && (
                <div style={{ background: '#070c11', borderRadius: 100, padding: '8px 10px 8px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d72444', flex: 'none' }} />
                  <RecBars />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#fff' }}>{recT.toFixed(1)}s</span>
                  <button type="button" onClick={() => doneRec(match.entryId)} className={styles.btnAccent} style={{ height: 34, padding: '0 16px', fontSize: 12.5, fontWeight: 600 }}>Done</button>
                </div>
              )}
              {recState === 'sent' && (
                <div style={{ background: '#dcefe0', borderRadius: 10, padding: '11px 13px', display: 'flex', gap: 9, alignItems: 'center' }}>
                  <Check size={15} strokeWidth={2.4} color="#0d4b17" style={{ flex: 'none' }} />
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: '#0d4b17' }}>Sent. It rides with your shortlist card, and you can hear it in your ledger.</div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div style={{ height: 76 }} />
    </div>
  );
}
