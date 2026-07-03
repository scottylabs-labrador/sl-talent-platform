// JSONB column schemas — one zod schema per jsonb column in ARCHITECTURE.md
// section 3. packages/db types each column with `.$type<T>()` importing the
// inferred types below, so the DB contract and the app contract are identical.
//
// FERPA note: evidence meta intentionally has NO grade field. Coursework taken
// is student attestation only (course code, never a grade). Do not add one.

import { z } from 'zod';
import {
  ExceptionCategory,
  LedgerEventKind,
  WorkAuthStatus,
} from './enums.js';

// students.work_auth ------------------------------------------------------
export const WorkAuth = z.object({
  status: WorkAuthStatus,
  needsSponsorship: z.boolean(),
  note: z.string().optional(),
});
export type WorkAuth = z.infer<typeof WorkAuth>;

// students.comp_expectation ----------------------------------------------
export const CompExpectation = z.object({
  min: z.number().nonnegative().optional(),
  max: z.number().nonnegative().optional(),
  hourly: z.boolean().optional(),
  currency: z.string().default('USD'),
  note: z.string().optional(),
});
export type CompExpectation = z.infer<typeof CompExpectation>;

// evidence.meta -----------------------------------------------------------
// Flexible but typed. NEVER a grade field (FERPA). courseCode is a bare
// identifier like "15-445"; coursework is attestation only.
export const EvidenceMeta = z.object({
  repoUrl: z.string().url().optional(),
  stars: z.number().int().nonnegative().optional(),
  commitCount: z.number().int().nonnegative().optional(),
  primaryLanguage: z.string().optional(),
  courseCode: z.string().optional(),
  orgName: z.string().optional(),
  role: z.string().optional(),
  dates: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
  description: z.string().optional(),
  // interview_moment evidence points back at a screen_moment.
  momentId: z.string().uuid().optional(),
  screenId: z.string().uuid().optional(),
  timestampMs: z.number().int().nonnegative().optional(),
});
export type EvidenceMeta = z.infer<typeof EvidenceMeta>;

// screens.transcript -----------------------------------------------------
// Word-level timestamps from Cartesia STT. These power the synced player and
// moment clipping — never discarded. speaker is rep|student only.
export const TranscriptWord = z.object({
  word: z.string(),
  t0: z.number().nonnegative(), // ms from call start
  t1: z.number().nonnegative(),
  speaker: z.enum(['rep', 'student']),
});
export type TranscriptWord = z.infer<typeof TranscriptWord>;

export const Transcript = z.array(TranscriptWord);
export type Transcript = z.infer<typeof Transcript>;

// dossiers.competency ----------------------------------------------------
// Every competency is anchored to a moment (see synthesizer prompt: no
// competency without a moment). score is the 1..5 dot scale in the UI.
export const DossierCompetency = z.object({
  name: z.string(),
  score: z.number().int().min(1).max(5),
  summary: z.string().optional(),
  momentId: z.string().uuid().optional(),
  timestampMs: z.number().int().nonnegative().optional(),
});
export type DossierCompetency = z.infer<typeof DossierCompetency>;

export const DossierCompetencies = z.array(DossierCompetency);
export type DossierCompetencies = z.infer<typeof DossierCompetencies>;

// dossiers.flags ---------------------------------------------------------
// Bidirectional flags: green (strengths) and probe (worth probing). Matches
// the DossierView "Green flag / Worth probing" tags.
export const DossierFlags = z.object({
  green: z.array(z.string()),
  probe: z.array(z.string()),
});
export type DossierFlags = z.infer<typeof DossierFlags>;

// dossiers.followups -----------------------------------------------------
// Suggested follow-up questions for the sponsor ("we are your first round,
// not your replacement").
export const Followups = z.array(z.string());
export type Followups = z.infer<typeof Followups>;

// coaching_reports.body --------------------------------------------------
// Student-only. Matches the design's "What landed / What was vague /
// Practice next" groups. Never joined into sponsor queries.
export const CoachingReportBody = z.object({
  landed: z.array(z.string()),
  vague: z.array(z.string()),
  practiceNext: z.array(z.string()),
});
export type CoachingReportBody = z.infer<typeof CoachingReportBody>;

// jobs.requirements ------------------------------------------------------
export const JobRequirements = z.object({
  mustHaves: z.array(z.string()),
  niceToHaves: z.array(z.string()),
  skills: z.array(z.string()),
  team: z.string().optional(),
  timeline: z.string().optional(),
  locations: z.array(z.string()).optional(),
  workModel: z.enum(['onsite', 'hybrid', 'remote']).optional(),
  other: z.string().optional(),
});
export type JobRequirements = z.infer<typeof JobRequirements>;

// jobs.calibration -------------------------------------------------------
// Learned from pass reasons over shortlists for this org/job.
export const Calibration = z.object({
  passReasons: z.array(
    z.object({
      reason: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  notes: z.string().optional(),
});
export type Calibration = z.infer<typeof Calibration>;

// jobs.comp_range (NOT NULL — comp disclosure is required) ----------------
export const CompRange = z.object({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  period: z.enum(['hour', 'year']),
  currency: z.string().default('USD'),
  equity: z.string().optional(),
});
export type CompRange = z.infer<typeof CompRange>;

// shortlist_entries.evidence_chips ---------------------------------------
// The three chips on a CandidateCard. kind lets the UI tint by provenance.
export const EvidenceChip = z.object({
  label: z.string(),
  kind: z.enum(['verified', 'self_reported', 'pending', 'moment']),
});
export type EvidenceChip = z.infer<typeof EvidenceChip>;

export const EvidenceChips = z.array(EvidenceChip);
export type EvidenceChips = z.infer<typeof EvidenceChips>;

// shortlist_entries.async_answer -----------------------------------------
// The student's answer to the recruiter's async follow-up question. Audio is
// stored by key (streamed via /api/stream/answer/:entryId, never a durable
// URL); text is the typed alternative. answeredAt is an ISO timestamp; question
// is the prompt the student answered (denormalized so the card is self-describing).
export const AsyncAnswer = z.object({
  question: z.string().optional(),
  audioKey: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  answeredAt: z.string(),
});
export type AsyncAnswer = z.infer<typeof AsyncAnswer>;

// ledger_events.detail ---------------------------------------------------
// Discriminated by the event kind so each row carries exactly the context
// that kind needs. The `kind` here mirrors ledger_events.kind (denormalized
// into the detail so the payload is self-describing off the wire).
const LedgerDetailBase = { note: z.string().optional() };

export const LedgerDetail = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('view'),
    surface: z.enum(['profile', 'dossier', 'shortlist']).optional(),
    ...LedgerDetailBase,
  }),
  z.object({
    kind: z.literal('search_hit'),
    query: z.string().optional(),
    rank: z.number().int().optional(),
    ...LedgerDetailBase,
  }),
  z.object({
    kind: z.literal('shortlist'),
    jobId: z.string().uuid().optional(),
    shortlistId: z.string().uuid().optional(),
    rank: z.number().int().optional(),
    ...LedgerDetailBase,
  }),
  z.object({
    kind: z.literal('export'),
    scope: z.string().optional(),
    ...LedgerDetailBase,
  }),
  z.object({
    kind: z.literal('stream'),
    momentId: z.string().uuid().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    ...LedgerDetailBase,
  }),
  z.object({
    kind: z.literal('verify'),
    evidenceId: z.string().uuid().optional(),
    method: z.string().optional(),
    result: z.enum(['verified', 'failed', 'inconclusive']).optional(),
    ...LedgerDetailBase,
  }),
  z.object({
    kind: z.literal('edit'),
    field: z.string().optional(),
    ...LedgerDetailBase,
  }),
]);
export type LedgerDetail = z.infer<typeof LedgerDetail>;
// Re-export the kind list so callers can assert coverage against LedgerEventKind.
export const ledgerDetailKinds = LedgerEventKind.options;

// screens.consent_verbal_span --------------------------------------------
// The [t0, t1] transcript span (ms from call start) the Rep marked when the
// student gave spoken consent. Shared with ConsentEvidence.verbalSpanMs below
// so the two representations of the same span cannot diverge.
export const ConsentVerbalSpan = z.object({
  t0: z.number().nonnegative(),
  t1: z.number().nonnegative(),
});
export type ConsentVerbalSpan = z.infer<typeof ConsentVerbalSpan>;

// consents.evidence ------------------------------------------------------
// How a consent was captured: the app checkbox event and/or the verbal
// confirmation span the Rep marked during the call.
export const ConsentEvidence = z.object({
  method: z.enum(['app_checkbox', 'verbal', 'both']),
  screenId: z.string().uuid().optional(),
  verbalSpanMs: ConsentVerbalSpan.optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
  confirmedAt: z.string().datetime().optional(),
});
export type ConsentEvidence = z.infer<typeof ConsentEvidence>;

// agent_runs.output ------------------------------------------------------
// Unknown-typed passthrough (each agent writes its own structured output).
// confidence is surfaced separately for the ops dashboard and gate logic.
export const AgentRunOutput = z.object({
  confidence: z.number().min(0).max(1).optional(),
  result: z.unknown(),
  error: z.string().optional(),
});
export type AgentRunOutput = z.infer<typeof AgentRunOutput>;

// exceptions.context -----------------------------------------------------
// What the ops card renders: which agent, the quote box, and refs to the
// underlying rows an operator may want to open.
export const ExceptionContext = z.object({
  agent: z.string(),
  // One-line card title (14px/600 in the queue; resolved rows collapse to it).
  title: z.string().optional(),
  quote: z.string(),
  refs: z
    .object({
      screenId: z.string().uuid().optional(),
      jobId: z.string().uuid().optional(),
      shortlistId: z.string().uuid().optional(),
      entryId: z.string().uuid().optional(),
      studentId: z.string().uuid().optional(),
      evidenceId: z.string().uuid().optional(),
    })
    .optional(),
  category: ExceptionCategory.optional(),
});
export type ExceptionContext = z.infer<typeof ExceptionContext>;

// config.value -----------------------------------------------------------
// Versioned config blobs (rubrics, autonomy levels, SLA hours, prompt
// versions). Untyped at the column; specific readers validate their slice.
export const ConfigValue = z.unknown();
export type ConfigValue = z.infer<typeof ConfigValue>;

// A couple of well-known config shapes, for readers that want them typed.
export const AutonomyConfig = z.record(z.string(), z.enum(['A', 'B', 'C']));
export type AutonomyConfig = z.infer<typeof AutonomyConfig>;

export const PromptVersionsConfig = z.record(z.string(), z.string());
export type PromptVersionsConfig = z.infer<typeof PromptVersionsConfig>;

// shortlist funnel (rendered on the Shortlist header) --------------------
// "62 screened, 27 deep, 9 answered follow-up".
export const ShortlistFunnel = z.object({
  screened: z.number().int().nonnegative(),
  deepEvaluated: z.number().int().nonnegative(),
  answeredFollowup: z.number().int().nonnegative(),
});
export type ShortlistFunnel = z.infer<typeof ShortlistFunnel>;
