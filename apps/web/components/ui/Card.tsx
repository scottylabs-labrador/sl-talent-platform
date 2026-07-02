import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Radius: standard 12px (default), large 14px (players/modals), graph 18px. */
  radius?: 'card' | 'lg' | 'graph';
  /** Built-in padding preset. Omit to control padding yourself. */
  pad?: boolean | 'lg';
  raised?: boolean;
  well?: boolean;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** White surface, radius 12, resting shadow. The default container. */
export function Card({
  radius = 'card',
  pad = false,
  raised = false,
  well = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cx(
        styles.card,
        radius === 'lg' && styles.lg,
        radius === 'graph' && styles.graph,
        pad === true && styles.pad,
        pad === 'lg' && styles.padLg,
        raised && styles.raised,
        well && styles.well,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
