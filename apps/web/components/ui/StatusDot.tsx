import type { HTMLAttributes } from 'react';
import styles from './StatusDot.module.css';

export type StatusTone = 'green' | 'amber' | 'red' | 'gray' | 'blue' | 'purple';

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  /** Diameter in px (default 8). */
  size?: number;
  /** Soft pulse (for "live" states). */
  pulse?: boolean;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** A small filled status circle. Pair with a label in status/health rows. */
export function StatusDot({
  tone = 'gray',
  size = 8,
  pulse = false,
  className,
  style,
  ...rest
}: StatusDotProps) {
  return (
    <span
      className={cx(styles.dot, styles[tone], pulse && styles.pulse, className)}
      style={{ width: size, height: size, ...style }}
      {...rest}
    />
  );
}
