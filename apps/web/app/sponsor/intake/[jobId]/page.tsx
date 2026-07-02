'use client';

// Role intake (/sponsor/intake/[jobId]). Two columns (1.5fr / 1fr): a live chat
// thread + composer on the left, a sticky requirements summary on the right.
// Each sponsor turn posts to sponsor.intakeMessage → runAgent('concierge') with
// the intake-extraction schema; the reply lands in the thread and the summary
// panel re-renders from jobs.requirements. The policy guard runs on every
// extraction; a refusal surfaces as an in-thread Concierge message and the
// standing "Refused" row always shows. Confirm is gated on comp disclosure.

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, Clock } from 'lucide-react';
import type { CompRange, JobRequirements, RequirementRow } from '@tartan/types';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/components/ui';
import { formatDayTime } from '@/lib/format';
import styles from './intake.module.css';

interface Msg {
  who: 'me' | 'concierge';
  text: string;
}

export default function RoleIntake() {
  const { jobId } = useParams<{ jobId: string }>();
  const { toast } = useToast();

  const jobQ = trpc.sponsor.job.useQuery({ jobId });
  const intakeM = trpc.sponsor.intakeMessage.useMutation();
  const confirmM = trpc.sponsor.confirmJob.useMutation();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [summary, setSummary] = useState<RequirementRow[]>([]);
  const [requirements, setRequirements] = useState<JobRequirements | null>(null);
  const [compRange, setCompRange] = useState<CompRange | null>(null);
  const [canConfirm, setCanConfirm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [slaDueAt, setSlaDueAt] = useState<string | null>(null);
  const [text, setText] = useState('');
  const seeded = useRef(false);

  const title = jobQ.data?.title ?? 'Role intake';

  // Seed the thread + summary once the job loads.
  useEffect(() => {
    if (!jobQ.data || seeded.current) return;
    seeded.current = true;
    const j = jobQ.data;
    setSummary(j.summaryRows);
    setRequirements(j.requirements);
    setCompRange(j.compRange);
    setCanConfirm(j.canConfirm);
    setSlaDueAt(j.slaDueAt);
    if (j.status !== 'intake') {
      setConfirmed(true);
    }
    const opening =
      j.requirements && j.requirements.mustHaves.length
        ? `Here is the role as I understand it so far: ${j.title}. Must-haves: ${j.requirements.mustHaves.join(
            ' · ',
          )}. Tell me what to refine, or confirm when the summary looks right.`
        : 'I am the Concierge. Paste a JD or just talk; I extract the structured role and ask only what matters.';
    setMessages([{ who: 'concierge', text: opening }]);
  }, [jobQ.data]);

  const send = async () => {
    const message = text.trim();
    if (!message || intakeM.isPending) return;
    setText('');
    setMessages((m) => [...m, { who: 'me', text: message }]);
    const res = await intakeM.mutateAsync({ jobId, message });
    setMessages((m) => [...m, { who: 'concierge', text: res.reply }]);
    setSummary(res.summaryRows);
    setRequirements(res.requirements);
    setCompRange(res.compRange);
    setCanConfirm(res.canConfirm);
  };

  const confirm = async () => {
    if (!requirements || !compRange || confirmM.isPending) return;
    const res = await confirmM.mutateAsync({ jobId, requirements, compRange });
    setConfirmed(true);
    setSlaDueAt(res.slaDueAt);
    toast('Confirmed. Shortlist due Friday 4:12 PM. The Recruiter starts now.', {
      durationMs: 3000,
    });
  };

  const dueLabel = slaDueAt
    ? `72h clock running · shortlist due ${formatDayTime(slaDueAt)}`
    : '72h clock running';

  return (
    <div className={styles.wrap}>
      <div className={styles.headerCol}>
        <h1 className={styles.title}>Role intake</h1>
        <p className={styles.subtitle}>
          A conversation, not a form. Paste a JD or just talk; the Concierge
          extracts the structured role and asks only what matters.
        </p>
      </div>

      <div className={styles.grid}>
        {/* ── Chat panel ─────────────────────────────────────────────────── */}
        <div className={styles.chatPanel}>
          <div className={styles.chatHeader}>
            <span className={styles.greenDot} />
            <span>{title} · intake thread</span>
          </div>
          <div className={styles.messages}>
            {messages.map((m, i) => (
              <div
                key={i}
                className={`${styles.message} ${
                  m.who === 'me' ? styles.msgMe : styles.msgConcierge
                }`}
              >
                <span className={styles.who}>
                  {m.who === 'me' ? 'Jordan @ Scogle' : 'Concierge'}
                </span>
                <div
                  className={`${styles.bubble} ${
                    m.who === 'me' ? styles.bubbleMe : styles.bubbleConcierge
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.composer}>
            {confirmed ? (
              <div className={styles.doneBanner}>
                <Check width={14} height={14} strokeWidth={2.4} />
                Confirmed. The Recruiter is matching; you will be pinged, not
                polled.
              </div>
            ) : canConfirm ? (
              <button
                className={styles.confirmBtn}
                onClick={confirm}
                disabled={confirmM.isPending}
              >
                Confirm requirements, start the 72h clock
              </button>
            ) : (
              <>
                <input
                  className={styles.input}
                  value={text}
                  placeholder="Type your answer, or paste a JD"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void send();
                  }}
                />
                <button
                  className={styles.sendBtn}
                  onClick={send}
                  disabled={intakeM.isPending}
                >
                  Send
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Requirements summary ───────────────────────────────────────── */}
        <div className={styles.summary}>
          <div className={styles.summaryHeader}>
            The role, as the platform understands it
          </div>
          <div className={styles.summaryBody}>
            {summary.map((row, i) => (
              <div key={i} className={styles.summaryRow}>
                <span
                  className={styles.dot}
                  style={{
                    background:
                      row.status === 'ok' ? 'var(--status-green)' : 'var(--status-amber)',
                  }}
                />
                <div className={styles.summaryTextCol}>
                  <span className={styles.summaryKey}>{row.key}</span>
                  <span className={styles.summaryValue}>{row.value}</span>
                </div>
              </div>
            ))}
            <div
              className={styles.slaRow}
              style={{ color: confirmed ? 'var(--green-900)' : 'var(--ink-400)' }}
            >
              <Clock width={15} height={15} strokeWidth={2} />
              <span>
                {confirmed ? dueLabel : 'The 72-hour SLA starts when you confirm'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
