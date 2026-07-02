// Shared UI primitives. Import from '@/components/ui'.
// Presentational primitives (Tag, Card, TartanBand, BrandGlyph, StatusDot,
// MonoText, Provenance*) are directive-free so they render in both server and
// client components. Pill and the Toast system are client components.

export { Pill } from './Pill';
export type { PillProps, PillVariant, PillSize } from './Pill';

export { Tag } from './Tag';
export type { TagProps, TagColor } from './Tag';

export { Card } from './Card';
export type { CardProps } from './Card';

export { TartanBand } from './TartanBand';
export type { TartanBandProps } from './TartanBand';

export { BrandGlyph } from './BrandGlyph';
export type { BrandGlyphProps } from './BrandGlyph';

export { ToastProvider, useToast } from './Toast';

export { ProvenanceEdge, ProvenanceChip } from './Provenance';
export type {
  ProvenanceState,
  ProvenanceEdgeProps,
  ProvenanceChipProps,
} from './Provenance';

export { StatusDot } from './StatusDot';
export type { StatusDotProps, StatusTone } from './StatusDot';

export { MonoText } from './MonoText';
export type { MonoTextProps } from './MonoText';
