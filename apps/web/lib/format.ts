// Formatting helpers shared across surfaces. Dates/times use the app's calm,
// no-em-dash style; durations and timestamps render mono. These are pure and
// safe on both server and client (no locale surprises: fixed en-US).

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function toDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input);
}

/**
 * "Fri 4:12 PM" — the SLA / ledger timestamp style. Day-of-week + 12h clock.
 */
export function formatDayTime(input: Date | string | number): string {
  const d = toDate(input);
  const dow = DOW[d.getDay()];
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${dow} ${h}:${m} ${ampm}`;
}

/** "May 2027" — grad-date / month-year style. */
export function formatMonthYear(input: Date | string | number): string {
  const d = toDate(input);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** "Jul 2, 2026" — compact absolute date. */
export function formatDate(input: Date | string | number): string {
  const d = toDate(input);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Elapsed "mm:ss" (or "h:mm:ss" past an hour). For audio position / call
 * duration. Input is milliseconds.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = s.toString().padStart(2, '0');
  if (h > 0) {
    const mm = m.toString().padStart(2, '0');
    return `${h}:${mm}:${ss}`;
  }
  return `${m}:${ss}`;
}

/** "14:42" — a moment timestamp (minutes:seconds) from ms. Same as elapsed. */
export const formatMomentTimestamp = formatElapsed;

/**
 * Relative "just now / 3m ago / 2h ago / Jul 2" — for ledger/feed rows.
 */
export function formatRelative(
  input: Date | string | number,
  now: Date = new Date(),
): string {
  const d = toDate(input);
  const diffMs = now.getTime() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return formatDate(d);
}

/**
 * Comp range → "$54/hr" or "$120k–$150k/yr". Pairs with CompRange from
 * @tartan/types (period 'hour' | 'year').
 */
export function formatCompRange(range: {
  min: number;
  max: number;
  period: 'hour' | 'year';
  currency?: string;
}): string {
  const unit = range.period === 'hour' ? '/hr' : '/yr';
  const fmt = (n: number) =>
    range.period === 'hour'
      ? `$${n}`
      : n >= 1000
        ? `$${Math.round(n / 1000)}k`
        : `$${n}`;
  if (range.min === range.max) return `${fmt(range.min)}${unit}`;
  return `${fmt(range.min)}–${fmt(range.max)}${unit}`;
}
