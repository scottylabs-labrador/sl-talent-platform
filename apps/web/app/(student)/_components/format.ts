// Student-surface display helpers. Pure, client-safe. Ledger timestamps are
// formatted in America/New_York against a fixed demo "now" (the prototype world
// is 2026-07-02) so the strings match the design exactly regardless of the
// server clock.

const DEMO_NOW = new Date('2026-07-02T14:00:00Z');
const ET = 'America/New_York';

function etParts(d: Date) {
  const s = d.toLocaleString('en-US', {
    timeZone: ET,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const [m, day, y] = s.split('/').map((n) => parseInt(n, 10));
  return { y: y!, m: m!, d: day! };
}

function etMidnightIndex(d: Date): number {
  const { y, m, d: day } = etParts(d);
  return Date.UTC(y, m - 1, day) / 86_400_000;
}

/** "Today, 9:41 AM" · "Yesterday" · "Mon, Jun 29" · "Jun 21". */
export function ledgerWhen(iso: string): string {
  const d = new Date(iso);
  const diffDays = etMidnightIndex(DEMO_NOW) - etMidnightIndex(d);
  if (diffDays <= 0) {
    const t = d.toLocaleString('en-US', {
      timeZone: ET,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `Today, ${t}`;
  }
  if (diffDays === 1) return 'Yesterday';
  const monthDay = d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric' });
  if (diffDays < 7) {
    const dow = d.toLocaleString('en-US', { timeZone: ET, weekday: 'short' });
    return `${dow}, ${monthDay}`;
  }
  return monthDay;
}

export interface LedgerChip {
  code: string; // 2-3 letter chip (Home preview)
  kindWord: string; // "View" / "Verify" ... (Settings ledger tag)
  bg: string;
  fg: string;
}

/** A short chip code derived from the real actor label (org/person name), e.g.
 * a two-word name -> its initials, "Jordan Lee" -> "JL". Falls back to "SP"
 * (sponsor) when the label is empty. No hardcoded org initials. */
function actorCode(actorLabel: string): string {
  const words = actorLabel.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const w = words[0] ?? '';
  return w.slice(0, 2).toUpperCase() || 'SP';
}

/** Chip letters + colors, per student-app.md "Data Ledger". The sponsor-facing
 * events (view, stream) derive their code from the real actor label. */
export function ledgerChip(eventKind: string, actorLabel: string): LedgerChip {
  switch (eventKind) {
    case 'view':
      return { code: actorCode(actorLabel), kindWord: 'View', bg: '#063f58', fg: '#fff' };
    case 'verify':
      return { code: 'VF', kindWord: 'Verify', bg: '#e7f5fa', fg: '#0a6b94' };
    case 'shortlist':
    case 'search_hit':
      return { code: 'SL', kindWord: 'Shortlist', bg: '#dcefe0', fg: '#0d4b17' };
    case 'export':
      return { code: 'EX', kindWord: 'Export', bg: '#f3ecd2', fg: '#654a00' };
    case 'stream':
      return { code: actorCode(actorLabel), kindWord: 'Stream', bg: '#063f58', fg: '#fff' };
    case 'edit':
    default:
      return { code: 'YOU', kindWord: 'Edit', bg: '#f0f4f8', fg: '#4a5662' };
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + last).toUpperCase() || first.toUpperCase();
}

// ── Talent Graph evidence provenance derivation ────────────────────────────
export type EvState = 'verified' | 'audio' | 'pending' | 'self_reported' | 'missing';

const SRC_WORD: Record<string, string> = {
  course: 'course',
  repo: 'repo',
  work: 'work',
  demo: 'site',
  paper: 'paper',
  hackathon: 'hackathon',
  interview_moment: 'audio',
};

export function evidenceState(
  type: string,
  provenance: string,
  url: string | null,
): EvState {
  if (type === 'interview_moment') return 'audio';
  if (provenance === 'verified') return 'verified';
  if (provenance === 'pending') return 'pending';
  // self_reported: with a real source vs. a bare claim ("dangling").
  return url ? 'self_reported' : 'missing';
}

export function evidenceCaption(
  type: string,
  provenance: string,
  url: string | null,
): string {
  const state = evidenceState(type, provenance, url);
  const src = SRC_WORD[type] ?? 'evidence';
  switch (state) {
    case 'audio':
      return 'Verified · audio';
    case 'verified':
      return `Verified · ${src}`;
    case 'pending':
      return 'Pending · Verifier check';
    case 'self_reported':
      return `Self-reported · ${src}`;
    case 'missing':
      return 'Missing · attach to verify';
  }
}

/** "0:08" style mm:ss from ms (used for moment durations/positions). */
export function clockLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
