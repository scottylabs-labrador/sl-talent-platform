import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Tag.module.css';

export type TagColor =
  | 'neutral'
  | 'info'
  | 'green'
  | 'amber'
  | 'red'
  | 'purple'
  | 'ink';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  color?: TagColor;
  /** Uppercase mono-label treatment (10px, 0.05em tracking). */
  uppercase?: boolean;
  leading?: ReactNode;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Small status / evidence label. 11px/600, radius 4. Pass `color` to tint;
 * `uppercase` for the mono-caption treatment (e.g. "Rep's note").
 */
export function Tag({
  color = 'neutral',
  uppercase = false,
  leading,
  className,
  children,
  ...rest
}: TagProps) {
  return (
    <span
      className={cx(
        styles.tag,
        styles[color],
        uppercase && styles.uppercase,
        className,
      )}
      {...rest}
    >
      {leading}
      {children}
    </span>
  );
}
