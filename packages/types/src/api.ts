// API I/O schemas — every endpoint in ARCHITECTURE.md section 7, shaped by the
// screens each surface renders (README "Screens / Views"). Consumed verbatim by
// the tRPC routers in apps/web: input schemas validate the request, output
// schemas are exported as zod (and inferred types) so the client is typed and
// the server response cannot drift from what the UI expects.
//
// Convention: `XxxInput` = request payload, `XxxOutput` = response payload.
// Shared read-model DTOs (Identity, LedgerEntry, ...) are defined once and
// composed into the per-screen payloads.

import { z } from 'zod';
import {
  DossierStatus,
  EntryKind,
  EntryStatus,
  EvidenceType,
  ExceptionCategory,
  ExceptionStatus,
  JobStatus,
  OutcomeStage,
  Provenance,
  RevealConsent,
  ScreenStatus,
  ShortlistStatus,
  SponsorMemberRole,
  SponsorTier,
  StudentKind,
  Visibility,
  AgentName,
} from './enums.js';
import {
  CoachingReportBody,
  CompExpectation,
  CompRange,
  Calibration,
  DossierCompetencies,
  DossierFlags,
  EvidenceChips,
  EvidenceMeta,
  Followups,
  JobRequirements,
  LedgerDetail,
  ShortlistFunnel,
  WorkAuth,
} from './json.js';

// ── Shared read-model DTOs ────────────────────────────────────────────────

export const Identity = z.object({
  studentId: z.string().uuid(),
  name: z.string(),
  andrewId: z.string().nullable(),
  program: z.string().nullable(),
  gradDate: z.string().nullable(), // ISO date
  kind: StudentKind,
  avatarColor: z.string().optional(),
  ssoVerified: z.boolean(), // "SSO verified" / "Alum, verified" badge
});
export type Identity = z.infer<typeof Identity>;

// The logistics chips row on the profile (work auth, locations, comp, startup).
export const LogisticsChip = z.object({
  label: z.string(),
  value: z.string(),
  tone: z.enum(['neutral', 'info', 'warn']).default('neutral'),
});
export type LogisticsChip = z.infer<typeof LogisticsChip>;

export const EvidenceCard = z.object({
  id: z.string().uuid(),
  type: EvidenceType,
  provenance: Provenance,
  title: z.string(),
  url: z.string().nullable(),
  meta: EvidenceMeta,
  // caption line beneath the label, e.g. "3 wired" / "no proof yet".
  caption: z.string().optional(),
});
export type EvidenceCard = z.infer<typeof EvidenceCard>;

// A skill node in the Talent Graph with its claim + the evidence edges.
export const TalentGraphSkill = z.object({
  skillId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  track: z.string().nullable(),
  courseCode: z.string().nullable(),
  proficiency: z.number().int().min(0).max(5).nullable(),
  verified: z.boolean(),
  // ids into the evidence[] list on the same payload (the graph edges).
  evidenceIds: z.array(z.string().uuid()),
});
export type TalentGraphSkill = z.infer<typeof TalentGraphSkill>;

export const ExperienceStory = z.object({
  id: z.string().uuid(),
  title: z.string(),
  situation: z.string(),
  contribution: z.string(),
  // null outcome renders as the italic prompt, never blank (design rule).
  outcome: z.string().nullable(),
  provenance: Provenance,
});
export type ExperienceStory = z.infer<typeof ExperienceStory>;

export const LedgerEntry = z.object({
  id: z.string().uuid(),
  eventKind: z.string(), // ledger_events.kind, drives the chip tag
  actorLabel: z.string(), // e.g. "Scogle, Inc" / "Talent Rep"
  detail: LedgerDetail,
  license: z.string().nullable(),
  createdAt: z.string(), // ISO
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

// The dossier card shown on the profile / home (status + one action).
export const ScreenDossierCard = z.object({
  screenId: z.string().uuid(),
  dossierId: z.string().uuid().nullable(),
  screenStatus: ScreenStatus,
  dossierStatus: DossierStatus.nullable(),
  statusLabel: z.string(), // "Pending" | "Awaiting approval" | "Live"
  statusTone: z.enum(['amber', 'green', 'gray']),
  action: z
    .object({ label: z.string(), href: z.string().optional() })
    .nullable(),
});
export type ScreenDossierCard = z.infer<typeof ScreenDossierCard>;

// ── Student: GET /me/home ─────────────────────────────────────────────────

export const StrengthMeter = z.object({
  label: z.string(),
  value: z.number().int().min(0).max(100),
  doNext: z.string(), // the "do this next" dashed-box row
});
export type StrengthMeter = z.infer<typeof StrengthMeter>;

export const PrimaryAction = z.object({
  eyebrow: z.string(),
  title: z.string(),
  body: z.string(),
  primary: z.object({ label: z.string(), href: z.string().optional() }),
  secondary: z
    .object({ label: z.string(), href: z.string().optional() })
    .nullable(),
});
export type PrimaryAction = z.infer<typeof PrimaryAction>;

// The 5-step dot timeline live-match card on home.
export const LiveMatchCard = z.object({
  entryId: z.string().uuid(),
  company: z.string(),
  roleTitle: z.string(),
  statusTag: z.string(),
  // 5-step timeline: index of the last completed step (0..4).
  stepsDone: z.number().int().min(0).max(5),
  stepLabels: z.array(z.string()).length(5),
});
export type LiveMatchCard = z.infer<typeof LiveMatchCard>;

export const HomeOutput = z.object({
  student: Identity,
  strengthMeter: StrengthMeter,
  primaryAction: PrimaryAction,
  liveMatch: LiveMatchCard.nullable(),
  ledgerPreview: z.array(LedgerEntry),
  dossierCard: ScreenDossierCard.nullable(),
});
export type HomeOutput = z.infer<typeof HomeOutput>;

// ── Student: GET /me/profile ──────────────────────────────────────────────

export const ProfileOutput = z.object({
  identity: Identity,
  visibility: Visibility,
  logisticsChips: z.array(LogisticsChip),
  workAuth: WorkAuth,
  locations: z.array(z.string()),
  compExpectation: CompExpectation.nullable(),
  startupOpen: z.boolean(),
  freshnessScore: z.number().nullable(),
  lastVerifiedAt: z.string().nullable(),
  // Talent Graph: skills carry claims + evidence edges into `evidence`.
  talentGraph: z.array(TalentGraphSkill),
  evidence: z.array(EvidenceCard),
  stories: z.array(ExperienceStory),
  screenDossierCard: ScreenDossierCard.nullable(),
});
export type ProfileOutput = z.infer<typeof ProfileOutput>;

// ── Student: PATCH /me/profile ────────────────────────────────────────────

export const UpdateProfileInput = z.object({
  program: z.string().optional(),
  gradDate: z.string().optional(),
  workAuth: WorkAuth.optional(),
  locations: z.array(z.string()).optional(),
  compExpectation: CompExpectation.optional(),
  startupOpen: z.boolean().optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

// ── Student: POST /me/evidence ────────────────────────────────────────────

export const AddEvidenceInput = z.object({
  type: EvidenceType,
  title: z.string().min(1),
  url: z.string().url().optional(),
  meta: EvidenceMeta.optional(),
  // optional skill slugs to wire this evidence to (creates claim edges).
  skillSlugs: z.array(z.string()).optional(),
});
export type AddEvidenceInput = z.infer<typeof AddEvidenceInput>;

export const AddEvidenceOutput = z.object({
  evidence: EvidenceCard,
});
export type AddEvidenceOutput = z.infer<typeof AddEvidenceOutput>;

// ── Student: GET /me/ledger ───────────────────────────────────────────────

export const LedgerInput = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type LedgerInput = z.infer<typeof LedgerInput>;

export const LedgerOutput = z.object({
  entries: z.array(LedgerEntry),
  nextCursor: z.string().nullable(),
});
export type LedgerOutput = z.infer<typeof LedgerOutput>;

// ── Student: PATCH /me/visibility ─────────────────────────────────────────

export const UpdateVisibilityInput = z.object({
  visibility: Visibility,
});
export type UpdateVisibilityInput = z.infer<typeof UpdateVisibilityInput>;

export const UpdateVisibilityOutput = z.object({
  visibility: Visibility,
});
export type UpdateVisibilityOutput = z.infer<typeof UpdateVisibilityOutput>;

// ── Student: POST /screens (start/book) ───────────────────────────────────

export const CreateScreenInput = z.object({
  mode: z.enum(['voice', 'text']).default('voice'),
  scheduledAt: z.string().optional(), // ISO; omitted = start now
  retakeOf: z.string().uuid().optional(),
});
export type CreateScreenInput = z.infer<typeof CreateScreenInput>;

export const CreateScreenOutput = z.object({
  screenId: z.string().uuid(),
  status: ScreenStatus,
  wsUrl: z.string(), // WS /voice/:screenId join URL
  resumeToken: z.string(),
});
export type CreateScreenOutput = z.infer<typeof CreateScreenOutput>;

// ── Student: GET /screens/:id/review (post-call) ──────────────────────────

export const MomentReview = z.object({
  id: z.string().uuid(),
  tStartMs: z.number().int().nonnegative(),
  tEndMs: z.number().int().nonnegative(),
  tag: z.string(),
  quote: z.string(),
  repNote: z.string().nullable(),
  clipKey: z.string().nullable(),
  studentVisible: z.boolean(), // the sponsor-visibility switch
  struck: z.boolean(),
});
export type MomentReview = z.infer<typeof MomentReview>;

export const ScreenReviewOutput = z.object({
  screenId: z.string().uuid(),
  status: ScreenStatus,
  // "Two things arrived": the coaching report (private) + the dossier draft.
  coachingReport: CoachingReportBody.nullable(),
  dossier: z
    .object({
      id: z.string().uuid(),
      status: DossierStatus,
      competency: DossierCompetencies,
      flags: DossierFlags,
      followups: Followups,
    })
    .nullable(),
  moments: z.array(MomentReview),
});
export type ScreenReviewOutput = z.infer<typeof ScreenReviewOutput>;

// ── Student: POST /screens/:id/approve ────────────────────────────────────

export const ApproveScreenInput = z.object({
  screenId: z.string().uuid(),
});
export type ApproveScreenInput = z.infer<typeof ApproveScreenInput>;

export const ApproveScreenOutput = z.object({
  screenId: z.string().uuid(),
  status: ScreenStatus, // -> 'published'
  publishedAt: z.string(),
});
export type ApproveScreenOutput = z.infer<typeof ApproveScreenOutput>;

// ── Student: PATCH /moments/:id (visibility / strike) ─────────────────────

export const UpdateMomentInput = z.object({
  momentId: z.string().uuid(),
  studentVisible: z.boolean().optional(),
  struck: z.boolean().optional(),
});
export type UpdateMomentInput = z.infer<typeof UpdateMomentInput>;

export const UpdateMomentOutput = z.object({
  moment: MomentReview,
});
export type UpdateMomentOutput = z.infer<typeof UpdateMomentOutput>;

// ── Student: POST /matches/:entryId/reply (async question) ────────────────

export const ReplyToMatchInput = z.object({
  entryId: z.string().uuid(),
  // Either a recorded audio answer (uploaded key) or a text answer.
  audioKey: z.string().optional(),
  text: z.string().optional(),
});
export type ReplyToMatchInput = z.infer<typeof ReplyToMatchInput>;

export const ReplyToMatchOutput = z.object({
  entryId: z.string().uuid(),
  delivered: z.boolean(),
});
export type ReplyToMatchOutput = z.infer<typeof ReplyToMatchOutput>;

// ── Student: Matches list (renders the Matches tab) ───────────────────────

export const MatchCard = z.object({
  entryId: z.string().uuid(),
  company: z.string(),
  roleTitle: z.string(),
  compLabel: z.string(), // always shown, e.g. "$54/hr"
  status: EntryStatus,
  kind: EntryKind,
  revealConsent: RevealConsent,
  timelineDone: z.number().int().min(0).max(5),
  // present when the sponsor has posed an async follow-up question.
  asyncQuestion: z
    .object({
      id: z.string().uuid(),
      text: z.string(),
      answered: z.boolean(),
    })
    .nullable(),
});
export type MatchCard = z.infer<typeof MatchCard>;

export const MatchesOutput = z.object({
  matches: z.array(MatchCard),
});
export type MatchesOutput = z.infer<typeof MatchesOutput>;

// ── Student: POST /me/export, DELETE /me ──────────────────────────────────

export const ExportOutput = z.object({
  requested: z.boolean(),
  // a job id the client can poll; the archive is emailed/linked when ready.
  jobId: z.string().uuid(),
});
export type ExportOutput = z.infer<typeof ExportOutput>;

export const DeleteAccountInput = z.object({
  confirm: z.literal(true),
});
export type DeleteAccountInput = z.infer<typeof DeleteAccountInput>;

export const DeleteAccountOutput = z.object({
  scheduled: z.boolean(),
  jobId: z.string().uuid(), // cascades DB + S3 purge + queue cleanup
});
export type DeleteAccountOutput = z.infer<typeof DeleteAccountOutput>;

// ══ SPONSOR ════════════════════════════════════════════════════════════════

// ── Sponsor: GET /org/dashboard ───────────────────────────────────────────

export const StatTile = z.object({
  label: z.string(),
  value: z.string(), // mono number, pre-formatted
  caption: z.string().optional(),
});
export type StatTile = z.infer<typeof StatTile>;

export const RoleRow = z.object({
  jobId: z.string().uuid(),
  title: z.string(),
  status: JobStatus,
  slaTone: z.enum(['green', 'amber', 'gray']), // delivered / running / idle
  slaLabel: z.string(),
  shortlistId: z.string().uuid().nullable(),
  action: z
    .object({ label: z.string(), href: z.string().optional() })
    .nullable(),
});
export type RoleRow = z.infer<typeof RoleRow>;

export const DashboardOutput = z.object({
  org: z.object({
    id: z.string().uuid(),
    name: z.string(),
    tier: SponsorTier,
    roleSlots: z.object({ used: z.number().int(), total: z.number().int() }),
  }),
  stats: z.array(StatTile),
  roles: z.array(RoleRow),
  conciergeSuggestions: z.array(z.string()),
});
export type DashboardOutput = z.infer<typeof DashboardOutput>;

// ── Sponsor: POST /jobs ───────────────────────────────────────────────────

export const CreateJobInput = z.object({
  title: z.string().min(1),
  jdRaw: z.string().optional(),
});
export type CreateJobInput = z.infer<typeof CreateJobInput>;

export const CreateJobOutput = z.object({
  jobId: z.string().uuid(),
  status: JobStatus, // -> 'intake'
});
export type CreateJobOutput = z.infer<typeof CreateJobOutput>;

// ── Sponsor: POST /jobs/:id/intake-message ────────────────────────────────
// The scripted intake conversation. Client sends a turn, gets back the
// Concierge reply + the live requirements summary + open questions.

export const IntakeMessageInput = z.object({
  jobId: z.string().uuid(),
  message: z.string(),
});
export type IntakeMessageInput = z.infer<typeof IntakeMessageInput>;

// A row in the sticky requirements summary panel (status dot + key + value).
export const RequirementRow = z.object({
  key: z.string(), // uppercase label, e.g. "MUST HAVES"
  value: z.string(),
  status: z.enum(['ok', 'open']), // green ok / amber open
});
export type RequirementRow = z.infer<typeof RequirementRow>;

export const IntakeMessageOutput = z.object({
  jobId: z.string().uuid(),
  reply: z.string(), // Concierge bubble
  requirements: JobRequirements,
  summaryRows: z.array(RequirementRow),
  openQuestions: z.array(z.string()),
  compRange: CompRange.nullable(),
  // the standing "Refused: filters that proxy protected classes" row, when a
  // refusal was triggered this turn.
  refusal: z.string().nullable(),
  canConfirm: z.boolean(), // false until comp_range present + no open blockers
});
export type IntakeMessageOutput = z.infer<typeof IntakeMessageOutput>;

// ── Sponsor: POST /jobs/:id/confirm (starts sla_due_at) ───────────────────

export const ConfirmJobInput = z.object({
  jobId: z.string().uuid(),
  requirements: JobRequirements,
  compRange: CompRange, // required — comp disclosure
});
export type ConfirmJobInput = z.infer<typeof ConfirmJobInput>;

export const ConfirmJobOutput = z.object({
  jobId: z.string().uuid(),
  status: JobStatus, // -> 'confirmed'
  slaDueAt: z.string(), // "72h clock running · due Fri 4:12 PM"
});
export type ConfirmJobOutput = z.infer<typeof ConfirmJobOutput>;

// ── Sponsor: GET /shortlists/:id ──────────────────────────────────────────

export const CandidateCard = z.object({
  entryId: z.string().uuid(),
  studentId: z.string().uuid().nullable(), // null when anonymized (match_only)
  rank: z.number().int(),
  name: z.string(), // "Candidate (consent requested)" when anonymized
  anonymized: z.boolean(),
  avatarColor: z.string().optional(),
  kind: EntryKind, // fit / wildcard / alum / match_only badges
  fit: z.number().int().min(0).max(100),
  rationale: z.string(), // two sentences
  evidenceChips: EvidenceChips,
  status: EntryStatus,
  passReason: z.string().nullable(),
  revealConsent: RevealConsent,
  ssoVerified: z.boolean(),
});
export type CandidateCard = z.infer<typeof CandidateCard>;

export const ShortlistOutput = z.object({
  shortlistId: z.string().uuid(),
  jobId: z.string().uuid(),
  jobTitle: z.string(),
  status: ShortlistStatus,
  // "delivered in 41h of the 72h SLA"
  slaEyebrow: z.string(),
  funnel: ShortlistFunnel,
  candidates: z.array(CandidateCard),
  // fewer-than-ten honesty note when the slate is short.
  shortfallNote: z.string().nullable(),
});
export type ShortlistOutput = z.infer<typeof ShortlistOutput>;

// ── Sponsor: POST /entries/:id/intro | pass | save ────────────────────────

export const EntryActionInput = z.object({
  entryId: z.string().uuid(),
  action: z.enum(['intro', 'pass', 'save']),
  // required when action === 'pass' (one-tap reason feeds calibration).
  passReason: z
    .enum([
      'too_junior',
      'missing_must_have',
      'overlaps_existing_hire',
      'other',
    ])
    .optional(),
  passReasonNote: z.string().optional(),
});
export type EntryActionInput = z.infer<typeof EntryActionInput>;

export const EntryActionOutput = z.object({
  entryId: z.string().uuid(),
  status: EntryStatus,
});
export type EntryActionOutput = z.infer<typeof EntryActionOutput>;

// ── Sponsor: GET /dossiers/:entryId ───────────────────────────────────────

export const AudioClip = z.object({
  momentId: z.string().uuid(),
  tag: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  quote: z.string(),
  repNote: z.string().nullable(),
  // NOTE: no S3 URL here. The player calls GET /api/stream/:momentId, which
  // license-checks, logs a ledger stream event, and 302s to a 60s presigned
  // GET. Sponsors never receive a durable audio URL.
  streamPath: z.string(), // e.g. "/api/stream/{momentId}"
});
export type AudioClip = z.infer<typeof AudioClip>;

export const DossierViewOutput = z.object({
  entryId: z.string().uuid(),
  student: Identity,
  rank: z.number().int(),
  fit: z.number().int().min(0).max(100),
  rationale: z.string(),
  competency: DossierCompetencies,
  flags: DossierFlags,
  followups: Followups,
  stories: z.array(ExperienceStory),
  clips: z.array(AudioClip),
  // synced transcript for the currently-selected clip (word timestamps).
  logistics: z.array(LogisticsChip),
  workAuth: WorkAuth, // shown exactly as self-declared, never auto-filtered
  // production: every candidate gets full structure; a scope note when partial.
  scopeNote: z.string().nullable(),
});
export type DossierViewOutput = z.infer<typeof DossierViewOutput>;

// ── Sponsor: GET /api/stream/:momentId ────────────────────────────────────
// (HTTP 302 in practice; typed here for the tRPC-adjacent helper that returns
// the redirect target after license + visibility + reveal checks + ledger.)

export const StreamGrantOutput = z.object({
  momentId: z.string().uuid(),
  url: z.string(), // presigned GET, 60s TTL, inline disposition
  expiresInSec: z.number().int(),
});
export type StreamGrantOutput = z.infer<typeof StreamGrantOutput>;

// ── Sponsor: POST /outcomes ───────────────────────────────────────────────

export const LogOutcomeInput = z.object({
  entryId: z.string().uuid(),
  stage: OutcomeStage,
});
export type LogOutcomeInput = z.infer<typeof LogOutcomeInput>;

export const LogOutcomeOutput = z.object({
  outcomeId: z.string().uuid(),
  entryId: z.string().uuid(),
  stage: OutcomeStage,
});
export type LogOutcomeOutput = z.infer<typeof LogOutcomeOutput>;

// ── Sponsor: POST /concierge/messages ─────────────────────────────────────

export const ConciergeMessageInput = z.object({
  message: z.string(),
  // optional context scoping (a job/shortlist the sponsor is looking at).
  jobId: z.string().uuid().optional(),
  shortlistId: z.string().uuid().optional(),
});
export type ConciergeMessageInput = z.infer<typeof ConciergeMessageInput>;

export const ConciergeMessageOutput = z.object({
  reply: z.string(),
  suggestions: z.array(z.string()),
  // references the concierge is allowed to surface (within licensed scope).
  refs: z.array(
    z.object({ label: z.string(), entryId: z.string().uuid().optional() }),
  ),
});
export type ConciergeMessageOutput = z.infer<typeof ConciergeMessageOutput>;

// ══ OPS ═════════════════════════════════════════════════════════════════════

// ── Ops: GET /ops/exceptions ──────────────────────────────────────────────

export const ExceptionCard = z.object({
  id: z.string().uuid(),
  category: ExceptionCategory,
  categoryLabel: z.string(),
  categoryTone: z.enum(['amber', 'blue', 'red', 'gray']),
  agent: AgentName,
  title: z.string(), // one-line card title; resolved rows collapse to it
  quote: z.string(), // agent context quote box
  recommendation: z.string(), // "Recommended:" line
  status: ExceptionStatus,
  createdAt: z.string(),
  resolvedBy: z.string().nullable(),
  resolvedAt: z.string().nullable(),
});
export type ExceptionCard = z.infer<typeof ExceptionCard>;

export const ExceptionsOutput = z.object({
  openCount: z.number().int().nonnegative(),
  exceptions: z.array(ExceptionCard),
});
export type ExceptionsOutput = z.infer<typeof ExceptionsOutput>;

// ── Ops: POST /ops/exceptions/:id/{approve,override,escalate} ─────────────

export const ResolveExceptionInput = z.object({
  exceptionId: z.string().uuid(),
  action: z.enum(['approve', 'override', 'escalate']),
  note: z.string().optional(),
});
export type ResolveExceptionInput = z.infer<typeof ResolveExceptionInput>;

export const ResolveExceptionOutput = z.object({
  exceptionId: z.string().uuid(),
  status: ExceptionStatus,
});
export type ResolveExceptionOutput = z.infer<typeof ResolveExceptionOutput>;

// ── Ops: GET /ops/agents (agent workforce health) ─────────────────────────

export const AgentHealth = z.object({
  agent: AgentName,
  evalScore: z.number().min(0).max(100).nullable(),
  autonomy: z.enum(['A', 'B', 'C']),
  status: z.enum(['healthy', 'degraded', 'paused']),
  runs7d: z.number().int().nonnegative(),
  costUsd7d: z.number().nonnegative(),
  flaggedRate: z.number().min(0).max(1),
});
export type AgentHealth = z.infer<typeof AgentHealth>;

export const AgentsOutput = z.object({
  agents: z.array(AgentHealth),
  weekly: z.object({
    exceptionsPer100Runs: z.number().nonnegative(),
    exceptionsTrend: z.enum(['up', 'down', 'flat']),
    operatorHours: z.number().nonnegative(),
    costPerScreen: z.number().nonnegative(),
  }),
});
export type AgentsOutput = z.infer<typeof AgentsOutput>;

// ── Ops: GET /ops/sampler/:shortlistId (adverse-impact rollup) ────────────

export const SamplerOutput = z.object({
  shortlistId: z.string().uuid(),
  jobTitle: z.string(),
  passReasons: Calibration,
  // aggregate rollup rows; no protected-class attributes, only outcome funnel.
  funnel: ShortlistFunnel,
  notes: z.array(z.string()),
});
export type SamplerOutput = z.infer<typeof SamplerOutput>;

// ── Ops: PATCH /ops/config/:key ───────────────────────────────────────────

export const UpdateConfigInput = z.object({
  key: z.string(),
  value: z.unknown(),
});
export type UpdateConfigInput = z.infer<typeof UpdateConfigInput>;

export const UpdateConfigOutput = z.object({
  key: z.string(),
  version: z.number().int(),
});
export type UpdateConfigOutput = z.infer<typeof UpdateConfigOutput>;
