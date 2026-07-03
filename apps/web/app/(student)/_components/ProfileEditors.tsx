'use client';

// Living Profile edit-mode sub-components. Presentational: they render the
// on-token forms and controls; the parent (ProfileScreen) owns the tRPC
// mutations, optimistic cache patching, invalidation, and toasts. Everything
// here stays inside the Living Profile's reading language — same fields, same
// 44px tap floors, sentence case, no em dashes.

import { useState } from 'react';
import { Minus, Plus, Trash2, Check, X } from 'lucide-react';
import styles from '../student.module.css';
import type { WorkAuthStatus } from '@tartan/types';

// Shared field atoms (kept identical to the add-evidence form in ProfileScreen).
export const FIELD_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '.05em',
  color: '#869db3',
};
export const FIELD_INPUT: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid #c7d2dc',
  background: '#fff',
  fontSize: 12.5,
  color: '#1e1e1e',
  fontFamily: 'var(--font-ui)',
};
const TEXTAREA: React.CSSProperties = {
  ...FIELD_INPUT,
  padding: '10px 12px',
  minHeight: 66,
  lineHeight: 1.5,
  resize: 'vertical',
};

// A small round 44px-target icon button.
export function IconButton({
  onClick,
  label,
  disabled,
  tone = 'neutral',
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  tone?: 'neutral' | 'danger';
  children: React.ReactNode;
}) {
  const fg = tone === 'danger' ? '#991a30' : '#4a5662';
  const bg = tone === 'danger' ? '#fdecef' : '#f0f4f8';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 30,
        height: 30,
        minWidth: 30,
        borderRadius: '50%',
        border: 'none',
        background: bg,
        color: fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flex: 'none',
      }}
    >
      {children}
    </button>
  );
}

// ── Proficiency stepper (1..5) ──────────────────────────────────────────────
export function ProficiencyStepper({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.max(1, Math.min(5, n));
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <IconButton
        label="Lower proficiency"
        disabled={disabled || value <= 1}
        onClick={() => onChange(clamp(value - 1))}
      >
        <Minus size={14} strokeWidth={2.2} />
      </IconButton>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          fontWeight: 600,
          color: '#1e1e1e',
          minWidth: 30,
          textAlign: 'center',
        }}
      >
        {value}/5
      </span>
      <IconButton
        label="Raise proficiency"
        disabled={disabled || value >= 5}
        onClick={() => onChange(clamp(value + 1))}
      >
        <Plus size={14} strokeWidth={2.2} />
      </IconButton>
    </div>
  );
}

// ── Add-skill inline form ───────────────────────────────────────────────────
export function AddSkillForm({
  onAdd,
  pending,
}: {
  onAdd: (name: string, proficiency: number) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [prof, setProf] = useState(3);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '8px 11px',
          borderRadius: 12,
          fontWeight: 600,
          fontSize: 11,
          textAlign: 'left',
          lineHeight: 1.35,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          background: '#fff',
          color: '#0a6b94',
          border: '1.5px dashed #90cfea',
          minHeight: 44,
        }}
      >
        <Plus size={13} strokeWidth={2.2} />
        Add skill
      </button>
    );
  }

  const submit = () => {
    const n = name.trim();
    if (!n || pending) return;
    onAdd(n, prof);
    setName('');
    setProf(3);
    setOpen(false);
  };

  return (
    <div
      style={{
        border: '1.5px solid #90cfea',
        borderRadius: 12,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: '#f8fbfd',
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Skill name"
        style={{ ...FIELD_INPUT, fontSize: 12 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <ProficiencyStepper value={prof} onChange={setProf} disabled={pending} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim() || pending}
          className={name.trim() && !pending ? styles.btnDark : styles.btnDisabled}
          style={{ height: 40, flex: 1, fontSize: 12.5, fontWeight: 600 }}
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={styles.btnGhost}
          style={{ height: 40, fontSize: 12.5, fontWeight: 600, padding: '0 12px' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Story form (add + edit share this) ──────────────────────────────────────
export interface StoryDraft {
  title: string;
  situation: string;
  contribution: string;
  outcome: string;
}

export function StoryForm({
  initial,
  onSave,
  onCancel,
  pending,
  submitLabel,
}: {
  initial?: Partial<StoryDraft>;
  onSave: (draft: StoryDraft) => void;
  onCancel: () => void;
  pending: boolean;
  submitLabel: string;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [situation, setSituation] = useState(initial?.situation ?? '');
  const [contribution, setContribution] = useState(initial?.contribution ?? '');
  const [outcome, setOutcome] = useState(initial?.outcome ?? '');

  const ready = title.trim() && situation.trim() && contribution.trim() && !pending;
  const submit = () => {
    if (!ready) return;
    onSave({
      title: title.trim(),
      situation: situation.trim(),
      contribution: contribution.trim(),
      outcome: outcome.trim(),
    });
  };

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: 'var(--shadow-resting)',
        border: '1.5px solid #90cfea',
      }}
    >
      <label style={FIELD_LABEL}>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. summer internship" style={FIELD_INPUT} />

      <label style={FIELD_LABEL}>Setup</label>
      <textarea value={situation} onChange={(e) => setSituation(e.target.value)} placeholder="What was the situation?" style={TEXTAREA} />

      <label style={FIELD_LABEL}>Your part</label>
      <textarea value={contribution} onChange={(e) => setContribution(e.target.value)} placeholder="What did you do?" style={TEXTAREA} />

      <label style={FIELD_LABEL}>Outcome (optional)</label>
      <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Add a measured outcome. Leave blank to fill in later." style={TEXTAREA} />

      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          className={ready ? styles.btnDark : styles.btnDisabled}
          style={{ height: 44, flex: 1, fontSize: 13.5, fontWeight: 600 }}
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={styles.btnGhost}
          style={{ height: 44, fontSize: 13, fontWeight: 600, padding: '0 16px' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Logistics form ──────────────────────────────────────────────────────────
const WORK_AUTH_OPTIONS: { value: WorkAuthStatus; label: string }[] = [
  { value: 'citizen', label: 'US citizen' },
  { value: 'permanent_resident', label: 'Permanent resident' },
  { value: 'f1_opt', label: 'F-1, OPT eligible' },
  { value: 'f1_cpt', label: 'F-1, CPT eligible' },
  { value: 'h1b_needed', label: 'H-1B sponsorship needed' },
  { value: 'other', label: 'Other' },
];

export interface LogisticsDraft {
  program: string;
  gradDate: string; // YYYY-MM-DD or ''
  workAuthStatus: WorkAuthStatus;
  locations: string[];
  compMin: number | null;
  compMax: number | null;
  compHourly: boolean;
  startupOpen: boolean;
}

export function LogisticsForm({
  initial,
  onSave,
  onCancel,
  pending,
}: {
  initial: LogisticsDraft;
  onSave: (draft: LogisticsDraft) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [program, setProgram] = useState(initial.program);
  const [gradDate, setGradDate] = useState(initial.gradDate);
  const [workAuthStatus, setWorkAuthStatus] = useState<WorkAuthStatus>(initial.workAuthStatus);
  const [locations, setLocations] = useState(initial.locations.join(', '));
  const [compMin, setCompMin] = useState(initial.compMin != null ? String(initial.compMin) : '');
  const [compMax, setCompMax] = useState(initial.compMax != null ? String(initial.compMax) : '');
  const [compHourly, setCompHourly] = useState(initial.compHourly);
  const [startupOpen, setStartupOpen] = useState(initial.startupOpen);

  const submit = () => {
    if (pending) return;
    const num = (s: string) => {
      const n = Number(s.replace(/[^0-9.]/g, ''));
      return s.trim() && Number.isFinite(n) ? n : null;
    };
    onSave({
      program: program.trim(),
      gradDate,
      workAuthStatus,
      locations: locations
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean),
      compMin: num(compMin),
      compMax: num(compMax),
      compHourly,
      startupOpen,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
      <label style={FIELD_LABEL}>Program</label>
      <input value={program} onChange={(e) => setProgram(e.target.value)} placeholder="e.g. BS Computer Science, Carnegie Mellon" style={FIELD_INPUT} />

      <label style={FIELD_LABEL}>Graduation date</label>
      <input type="date" value={gradDate} onChange={(e) => setGradDate(e.target.value)} style={FIELD_INPUT} />

      <label style={FIELD_LABEL}>Work authorization</label>
      <select value={workAuthStatus} onChange={(e) => setWorkAuthStatus(e.target.value as WorkAuthStatus)} style={FIELD_INPUT}>
        {WORK_AUTH_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <label style={FIELD_LABEL}>Locations</label>
      <input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="e.g. San Francisco, New York" style={FIELD_INPUT} />
      <span style={{ fontSize: 10.5, color: '#869db3', marginTop: -4 }}>Comma separated. Leave blank if open to relocation.</span>

      <label style={FIELD_LABEL}>Compensation expectation</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={compMin} onChange={(e) => setCompMin(e.target.value)} placeholder="Min" inputMode="numeric" style={FIELD_INPUT} />
        <input value={compMax} onChange={(e) => setCompMax(e.target.value)} placeholder="Max" inputMode="numeric" style={FIELD_INPUT} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 12.5, color: '#4a5662', cursor: 'pointer' }}>
        <input type="checkbox" checked={compHourly} onChange={(e) => setCompHourly(e.target.checked)} style={{ width: 18, height: 18 }} />
        Hourly rate
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 12.5, color: '#4a5662', cursor: 'pointer' }}>
        <input type="checkbox" checked={startupOpen} onChange={(e) => setStartupOpen(e.target.checked)} style={{ width: 18, height: 18 }} />
        Open to startups
      </label>

      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={pending ? styles.btnDisabled : styles.btnDark}
          style={{ height: 44, flex: 1, fontSize: 13.5, fontWeight: 600 }}
        >
          {pending ? 'Saving…' : 'Save logistics'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={styles.btnGhost}
          style={{ height: 44, fontSize: 13, fontWeight: 600, padding: '0 16px' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Re-export icons the parent uses in edit affordances so it imports one module.
export { Trash2, Check, X, Plus };
