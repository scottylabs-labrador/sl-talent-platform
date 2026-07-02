import type { ElementType, HTMLAttributes } from 'react';
import styles from './MonoText.module.css';

export interface MonoTextProps extends HTMLAttributes<HTMLElement> {
  /** Element to render (default <span>). */
  as?: ElementType;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * JetBrains Mono wrapper for course codes, timestamps, scores, and ids.
 * Tabular numerals so columns of numbers align. Never system-ui.
 */
export function MonoText({
  as,
  className,
  children,
  ...rest
}: MonoTextProps) {
  const Comp = (as ?? 'span') as ElementType;
  return (
    <Comp className={cx(styles.mono, className)} {...rest}>
      {children}
    </Comp>
  );
}
