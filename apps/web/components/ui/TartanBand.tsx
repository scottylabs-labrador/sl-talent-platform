import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './TartanBand.module.css';

export interface TartanBandProps extends HTMLAttributes<HTMLDivElement> {
  /** horizontal band (default) or vertical spine. */
  orientation?: 'horizontal' | 'vertical';
  /** Stripe pitch: student (Recipe A) or sponsor portal (Recipe B). */
  recipe?: 'student' | 'sponsor';
  /**
   * Band thickness in px (height when horizontal, width when vertical).
   * Defaults: student horizontal 5, sponsor horizontal 10, any vertical 12.
   */
  thickness?: number;
  /** Corner rounding in px (e.g. to match a card top). */
  radius?: number;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The tartan signature. PREMIUM ARTIFACTS ONLY — shortlist header, dossier
 * spine/cards. Never buttons, nav, or ordinary cards.
 */
export function TartanBand({
  orientation = 'horizontal',
  recipe = 'student',
  thickness,
  radius,
  className,
  style,
  ...rest
}: TartanBandProps) {
  const horizontal = orientation === 'horizontal';
  const t =
    thickness ?? (horizontal ? (recipe === 'sponsor' ? 10 : 5) : 12);

  const variant =
    recipe === 'sponsor'
      ? horizontal
        ? styles.sponsorHorizontal
        : styles.sponsorVertical
      : horizontal
        ? styles.studentHorizontal
        : styles.studentVertical;

  const sizeStyle: CSSProperties = horizontal
    ? { height: t, width: '100%' }
    : { width: t, alignSelf: 'stretch' };
  if (radius != null) sizeStyle.borderRadius = radius;

  return (
    <div
      aria-hidden="true"
      className={cx(styles.band, variant, className)}
      style={{ ...sizeStyle, ...style }}
      {...rest}
    />
  );
}
