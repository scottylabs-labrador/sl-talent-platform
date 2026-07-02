'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Pill.module.css';

export type PillVariant =
  | 'primary'
  | 'accent'
  | 'secondary'
  | 'danger'
  | 'ghost';
export type PillSize = 'sm' | 'md' | 'lg';

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PillVariant;
  size?: PillSize;
  /** Full-width pill. */
  block?: boolean;
  /** Leading node (icon). */
  leading?: ReactNode;
  /** Trailing node (icon). */
  trailing?: ReactNode;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The single button primitive. 100px radius, hover darkens (never scales),
 * 44px tap target by default. Renders a real <button>; pass `disabled` for
 * the disabled state (both styling and behavior).
 */
export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  {
    variant = 'primary',
    size = 'md',
    block = false,
    leading,
    trailing,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cx(
        styles.pill,
        styles[size],
        disabled ? styles.disabled : styles[variant],
        block && styles.block,
        className,
      )}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </button>
  );
});
