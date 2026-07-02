import type { HTMLAttributes, ReactNode } from 'react';
import type { Provenance } from '@tartan/types';
import styles from './Provenance.module.css';

/**
 * The five provenance states in the design grammar. Extends the DB `Provenance`
 * enum ('verified' | 'self_reported' | 'pending') with the two UI-only states
 * the Talent Graph draws: 'audio' (interview moment) and 'missing' (no proof
 * yet). Callers derive 'audio'/'missing' from context.
 */
export type ProvenanceState = Provenance | 'audio' | 'missing';

const EDGE_CLASS: Record<ProvenanceState, string | undefined> = {
  verified: styles.verified,
  self_reported: styles.self_reported,
  pending: styles.pending,
  audio: styles.audio,
  missing: styles.missing,
};

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface ProvenanceEdgeProps extends HTMLAttributes<HTMLDivElement> {
  state: ProvenanceState;
}

/**
 * Evidence card with the provenance-colored left edge (verified blue, audio
 * purple, pending amber, self-reported/missing dashed). Put the label + caption
 * inside as children.
 */
export function ProvenanceEdge({
  state,
  className,
  children,
  ...rest
}: ProvenanceEdgeProps) {
  return (
    <div className={cx(styles.edge, EDGE_CLASS[state], className)} {...rest}>
      {children}
    </div>
  );
}

export interface ProvenanceChipProps
  extends HTMLAttributes<HTMLSpanElement> {
  state: ProvenanceState;
  /** Interaction state (Talent Graph: solid deep fill, white text). */
  selected?: boolean;
  /** Renders as clickable (cursor + role); wire onClick to select the thread. */
  selectable?: boolean;
  leading?: ReactNode;
}

/**
 * A skill / claim chip carrying its provenance state. `selected` overrides the
 * provenance styling with the deep-fill interaction state.
 */
export function ProvenanceChip({
  state,
  selected = false,
  selectable = false,
  leading,
  className,
  children,
  ...rest
}: ProvenanceChipProps) {
  return (
    <span
      className={cx(
        styles.chip,
        selected ? styles.selected : styles[state],
        selectable && styles.selectable,
        className,
      )}
      {...rest}
    >
      {leading}
      {children}
    </span>
  );
}
