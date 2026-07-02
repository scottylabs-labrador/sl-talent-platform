// The six-section interview state machine (ARCHITECTURE section 5; section names
// and arc from docs/design-notes/student-app.md CallRoom). Keys are the canonical
// interviewSectionValues shared with the browser in @tartan/types.

import type { InterviewSection } from '@tartan/types';
import { interviewSectionValues } from '@tartan/types';

export interface SectionDef {
  key: InterviewSection;
  index: number;
  /** Arc label shown on the live progress ring. */
  name: string;
  /** Secondary line under the section name. */
  sub: string;
  /** Soft budget for the real pipeline (the Rep aims to advance around here). */
  budgetMs: number;
}

export const SECTIONS: readonly SectionDef[] = [
  {
    key: 'intro_consent',
    index: 0,
    name: 'Consent',
    sub: 'Intro and verbal consent',
    budgetMs: 2 * 60_000,
  },
  {
    key: 'background',
    index: 1,
    name: 'Walkthrough',
    sub: 'Background and the shape of your work',
    budgetMs: 6 * 60_000,
  },
  {
    key: 'experience_deep_dive_1',
    index: 2,
    name: 'Deep dive 1',
    sub: 'Consensus under partition, 15-440',
    budgetMs: 6 * 60_000,
  },
  {
    key: 'experience_deep_dive_2',
    index: 3,
    name: 'Deep dive 2',
    sub: 'RailTrace, TartanHacks 2026',
    budgetMs: 6 * 60_000,
  },
  {
    key: 'technical_probe',
    index: 4,
    name: 'Domain',
    sub: 'Domain drill, calibrated to 15-440',
    budgetMs: 6 * 60_000,
  },
  {
    key: 'student_questions',
    index: 5,
    name: 'Wrap',
    sub: 'Your questions, and what happens next',
    budgetMs: 4 * 60_000,
  },
] as const;

export const SECTION_COUNT = SECTIONS.length;

// Runtime guarantee that SECTIONS covers the shared enum in the same order.
if (
  SECTIONS.length !== interviewSectionValues.length ||
  SECTIONS.some((s, i) => s.key !== interviewSectionValues[i])
) {
  throw new Error('SECTIONS is out of sync with interviewSectionValues');
}

export function sectionAt(index: number): SectionDef | undefined {
  return SECTIONS[index];
}
