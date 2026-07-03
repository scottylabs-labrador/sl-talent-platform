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
import { EntryKind, EvidenceType, StudentKind, WorkAuthStatus } from './enums.js';

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

// ── Synthesizer (resume role): resume parse jump-start ─────────────────────
// Structured extraction from an uploaded resume's plain text, used to seed the
// onboarding wizard. Extract ONLY what the resume states; never invent. Every
// field is optional-tolerant so a sparse resume still parses. The student edits
// everything afterward, so a miss is cheap and a fabrication is not.

// Two hard constraints shape every optional field below.
//
// 1) Under the provider's strict JSON-schema mode the wire schema renders every
//    optional leaf as NULLABLE (type: [T, "null"]), so the model legitimately
//    returns `null` for anything the resume does not state. We therefore use
//    `.nullish()` (accepts null AND undefined) on every optional; a plain
//    `.optional()` would reject the model's null and fail validation.
// 2) The Anthropic structured-output compiler caps union-typed parameters at
//    16. So nested blocks (comp, work auth) keep their inner fields REQUIRED —
//    the block is present-in-full or omitted — rather than reusing the shared
//    CompExpectation/WorkAuth whose many optional leaves blow the cap.
//
// The lean comp/work-auth blocks are structural subsets of the shared
// CompExpectation/WorkAuth; the onboarding/create-student layer composes the
// full shapes (adding currency 'USD', etc.) when it lands a draft.

export const ResumeCompExpectation = z.object({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  hourly: z.boolean(),
});
export type ResumeCompExpectation = z.infer<typeof ResumeCompExpectation>;

export const ResumeWorkAuth = z.object({
  status: WorkAuthStatus,
  needsSponsorship: z.boolean(),
});
export type ResumeWorkAuth = z.infer<typeof ResumeWorkAuth>;

// A logistics fact block the resume may state (program, grad date, work auth,
// locations, comp, startup interest). Every field optional-tolerant.
export const ResumeLogistics = z.object({
  program: z.string().nullish(),
  gradDateISO: z.string().nullish(), // ISO date, e.g. "2027-05-01"
  kind: StudentKind.nullish(), // undergrad | grad | alum
  workAuth: ResumeWorkAuth.nullish(),
  locations: z.array(z.string()).nullish(),
  compExpectation: ResumeCompExpectation.nullish(),
  startupOpen: z.boolean().nullish(),
});
export type ResumeLogistics = z.infer<typeof ResumeLogistics>;

// A skill the resume names. slug is filled only when it maps obviously onto the
// seeded taxonomy; else left null (authoring code slugifies on save).
export const ResumeSkill = z.object({
  name: z.string(),
  slug: z.string().nullish(),
  proficiency: z.number().int().min(1).max(5).nullish(),
  evidenceHint: z.string().nullish(), // where in the resume it was demonstrated
});
export type ResumeSkill = z.infer<typeof ResumeSkill>;

// A situation / contribution / outcome story pulled from real described work.
export const ResumeStory = z.object({
  title: z.string(),
  situation: z.string(),
  contribution: z.string(),
  outcome: z.string().nullish(),
});
export type ResumeStory = z.infer<typeof ResumeStory>;

// An evidence artifact the resume points at (a repo, a paper, a course, work).
export const ResumeEvidence = z.object({
  type: EvidenceType,
  title: z.string(),
  url: z.string().nullish(),
  note: z.string().nullish(),
});
export type ResumeEvidence = z.infer<typeof ResumeEvidence>;

// The four blocks are required (never .default()/.optional()): under the
// provider's strict JSON mode a `.default()` becomes an anyOf union and every
// optional becomes nullable, and the Anthropic structured-output compiler caps
// union-typed parameters at 16. Required blocks the model always emits (empty
// arrays / an all-null logistics object for a sparse resume), which keeps the
// schema lean while staying fully optional-tolerant at the leaves.
export const ResumeParseResult = z.object({
  logistics: ResumeLogistics,
  skills: z.array(ResumeSkill),
  stories: z.array(ResumeStory),
  evidence: z.array(ResumeEvidence),
});
export type ResumeParseResult = z.infer<typeof ResumeParseResult>;

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
