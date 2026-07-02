import type { HTMLAttributes } from 'react';
import styles from './BrandGlyph.module.css';

/** The Scotty terrier monogram path (viewBox 0 0 64 55), verbatim from
 * "Talent Hub.dc.html" / "Sponsor Portal.dc.html". Rendered inline white. */
const SCOTTY_PATH =
  'M 3.251 55 L 0 55 C 0 49.426 1.006 44.008 2.98 38.94 C 3.754 36.991 4.644 35.12 5.689 33.288 L 6.114 32.548 L 6.966 32.47 C 8.63 32.353 11.261 32.002 14.241 30.911 C 18.575 29.352 22.096 26.857 24.728 23.505 C 26.779 20.893 28.21 17.892 28.984 14.539 L 25.502 2.222 L 28.791 0 L 29.72 0.702 C 31.848 2.3 34.092 3.82 36.414 5.106 C 37.885 5.964 39.433 6.743 40.98 7.445 C 43.96 7.328 46.979 7.016 49.92 6.588 C 53.596 6.042 57.272 5.301 60.871 4.327 L 62.341 3.937 L 62.844 5.418 C 63.735 8.147 64.122 10.953 63.967 13.799 C 63.851 16.488 63.231 19.1 62.187 21.556 L 59.207 20.269 C 60.097 18.164 60.6 15.904 60.716 13.604 C 60.832 11.694 60.639 9.784 60.174 7.913 C 56.962 8.731 53.673 9.394 50.384 9.862 C 47.211 10.33 43.96 10.602 40.71 10.758 L 40.323 10.758 L 39.974 10.602 C 38.233 9.784 36.492 8.926 34.789 7.952 C 33.009 6.938 31.229 5.808 29.526 4.6 L 32.39 14.461 L 32.312 14.851 C 31.422 18.866 29.758 22.452 27.32 25.532 C 24.302 29.391 20.277 32.197 15.363 33.99 C 12.499 35.004 9.945 35.471 8.088 35.666 C 7.314 37.108 6.617 38.629 5.998 40.149 C 4.179 44.826 3.251 49.816 3.251 55 Z';

export interface BrandGlyphProps extends HTMLAttributes<HTMLSpanElement> {
  /** Tile edge length in px. Source sizes: 34 (header), 30 (concierge card). */
  size?: number;
  /** Corner radius in px. Defaults 9 at >=34px, else 8. */
  radius?: number;
  /** Inset shadow (header tile). Off on the small concierge tile. */
  inset?: boolean;
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The ScottyLabs brand mark: conic-gradient tile + inline white Scotty
 * monogram. The monogram scales with the tile (0 0 64 55 viewBox).
 */
export function BrandGlyph({
  size = 34,
  radius,
  inset = size >= 34,
  className,
  style,
  ...rest
}: BrandGlyphProps) {
  const r = radius ?? (size >= 34 ? 9 : 8);
  // Spec pairs from the prototypes: 34px tile → 18x16 monogram, 30px tile →
  // 15x13. Other tile sizes scale off the 34px pair.
  const [glyphW, glyphH] =
    size === 34 ? [18, 16]
    : size === 30 ? [15, 13]
    : [Math.round((size * 18) / 34), Math.round((size * 16) / 34)];
  return (
    <span
      className={cx(styles.tile, inset && styles.inset, className)}
      style={{ width: size, height: size, borderRadius: r, ...style }}
      {...rest}
    >
      <svg
        width={glyphW}
        height={glyphH}
        viewBox="0 0 64 55"
        role="img"
        aria-label="ScottyLabs"
      >
        <path d={SCOTTY_PATH} fillRule="nonzero" />
      </svg>
    </span>
  );
}
