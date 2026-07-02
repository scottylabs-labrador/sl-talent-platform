// Agent structured outputs — the zod schemas each OpenRouter agent must emit in
// JSON-schema mode. packages/agents derives the JSON Schema from these with
// zod-to-json-schema, so the LLM contract and the app contract are the same
// object. Keep every field the app reads present and typed; the model is held
// to strict:true against the derived schema.

import { z } from 'zod';
import {
  CompRange,
  DossierCompetencies,
  DossierFlags,
  Followups,
  CoachingReportBody,
  JobRequirements,
} from './json.js';
import { EntryKind } from './enums.js';

// ── Synthesizer: dossier draft ────────────────────────────────────────────
// Evidence-backed from the transcript. Every competency must reference a
// moment (see the synthesizer prompt). Moments are candidate highlights the
// worker will clip; timestamps are in ms from call start.

export const SynthMoment = z.object({
  tStartMs: z.number().int().nonnegative(),
  tEndMs: z.number().int().nonnegative(),
  tag: z.string(),
  quote: z.string(),
  repNote: z.string().optional(),
});
export type SynthMoment = z.infer<typeof SynthMoment>;

export const DossierDraft = z.object({
  competency: DossierCompetencies,
  flags: DossierFlags,
  followups: Followups,
  moments: z.array(SynthMoment),
  confidence: z.number().min(0).max(1),
});
export type DossierDraft = z.infer<typeof DossierDraft>;

// ── Coach: coaching report ────────────────────────────────────────────────
// Student-visible only. Kind, specific, actionable.

export const CoachingReport = z.object({
  body: CoachingReportBody,
  confidence: z.number().min(0).max(1),
});
export type CoachingReport = z.infer<typeof CoachingReport>;

// ── Synthesizer: experience stories extraction ────────────────────────────
// Situation / Contribution / Outcome pulled from the transcript. A missing
// outcome stays null (rendered as the italic prompt) — never invented.

export const ExtractedStory = z.object({
  title: z.string(),
  situation: z.string(),
  contribution: z.string(),
  outcome: z.string().nullable(),
});
export type ExtractedStory = z.infer<typeof ExtractedStory>;

export const ExperienceStories = z.object({
  stories: z.array(ExtractedStory),
  confidence: z.number().min(0).max(1),
});
export type ExperienceStories = z.infer<typeof ExperienceStories>;

// ── Recruiter: ranking ────────────────────────────────────────────────────
// Rank against the rubric. Each entry: two-sentence rationale, exactly three
// evidence chips, a kind (fit/wildcard/alum/match_only). Slate composition
// (8 fits + wildcards) is enforced by validator code, not the model alone.

export const RankedCandidate = z.object({
  studentId: z.string().uuid(),
  rank: z.number().int().positive(),
  fit: z.number().int().min(0).max(100),
  rationale: z.string(), // two sentences
  evidenceChips: z.array(z.string()).length(3),
  kind: EntryKind,
});
export type RankedCandidate = z.infer<typeof RankedCandidate>;

export const RecruiterRanking = z.object({
  ranking: z.array(RankedCandidate),
  confidence: z.number().min(0).max(1),
});
export type RecruiterRanking = z.infer<typeof RecruiterRanking>;

// ── Concierge/Recruiter: intake extraction ────────────────────────────────
// Structured requirements + comp + open questions from the intake turn.

export const IntakeExtraction = z.object({
  title: z.string(),
  requirements: JobRequirements,
  compRange: CompRange.nullable(),
  openQuestions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type IntakeExtraction = z.infer<typeof IntakeExtraction>;

// ── Verifier: verdict ─────────────────────────────────────────────────────
// Cheap model pattern check; the real checks are deterministic code. The
// verdict records the evidence checked and the decision.

export const VerifierVerdict = z.object({
  evidenceId: z.string().uuid(),
  verdict: z.enum(['verified', 'failed', 'inconclusive']),
  method: z.string(), // e.g. "github_commit_email", "date_consistency"
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});
export type VerifierVerdict = z.infer<typeof VerifierVerdict>;

// ── Concierge: reply ──────────────────────────────────────────────────────
// Scoped to the sponsor's licensed data; suggests follow-ups; never reveals
// hidden moments.

export const ConciergeReply = z.object({
  reply: z.string(),
  suggestions: z.array(z.string()),
  refs: z.array(
    z.object({
      label: z.string(),
      entryId: z.string().uuid().optional(),
    }),
  ),
  confidence: z.number().min(0).max(1),
});
export type ConciergeReply = z.infer<typeof ConciergeReply>;

// ── Sentinel: weekly digest ───────────────────────────────────────────────

export const SentinelDigest = z.object({
  headline: z.string(),
  highlights: z.array(z.string()),
  costAlerts: z.array(
    z.object({
      agent: z.string(),
      note: z.string(),
      pctOfBudget: z.number().min(0),
    }),
  ),
  adverseImpactNote: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type SentinelDigest = z.infer<typeof SentinelDigest>;
