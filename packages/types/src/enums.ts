// Enums — mirror the Postgres enums in ARCHITECTURE.md section 3 exactly.
// Each is a zod enum (runtime validation, single source of truth) plus the
// inferred TS union type. The `*Values` tuple is exported so packages/db can
// build the matching pgEnum from the identical list (contracts cannot drift).

import { z } from 'zod';

// people and orgs ----------------------------------------------------------

export const userRoleValues = ['student', 'sponsor', 'operator'] as const;
export const UserRole = z.enum(userRoleValues);
export type UserRole = z.infer<typeof UserRole>;

export const studentKindValues = ['undergrad', 'grad', 'alum'] as const;
export const StudentKind = z.enum(studentKindValues);
export type StudentKind = z.infer<typeof StudentKind>;

export const visibilityValues = ['searchable', 'match_only', 'paused'] as const;
export const Visibility = z.enum(visibilityValues);
export type Visibility = z.infer<typeof Visibility>;

export const sponsorTierValues = ['premier', 'community'] as const;
export const SponsorTier = z.enum(sponsorTierValues);
export type SponsorTier = z.infer<typeof SponsorTier>;

export const sponsorMemberRoleValues = [
  'recruiter',
  'hiring_manager',
  'viewer',
] as const;
export const SponsorMemberRole = z.enum(sponsorMemberRoleValues);
export type SponsorMemberRole = z.infer<typeof SponsorMemberRole>;

// talent graph -------------------------------------------------------------

export const evidenceTypeValues = [
  'repo',
  'paper',
  'demo',
  'hackathon',
  'course',
  'work',
  'interview_moment',
] as const;
export const EvidenceType = z.enum(evidenceTypeValues);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const provenanceValues = [
  'verified',
  'self_reported',
  'pending',
] as const;
export const Provenance = z.enum(provenanceValues);
export type Provenance = z.infer<typeof Provenance>;

// screens and dossiers -----------------------------------------------------

export const screenStatusValues = [
  'scheduled',
  'live',
  'processing',
  'review',
  'published',
  'struck',
] as const;
export const ScreenStatus = z.enum(screenStatusValues);
export type ScreenStatus = z.infer<typeof ScreenStatus>;

export const dossierStatusValues = ['draft', 'approved'] as const;
export const DossierStatus = z.enum(dossierStatusValues);
export type DossierStatus = z.infer<typeof DossierStatus>;

// roles and matching -------------------------------------------------------

export const jobStatusValues = [
  'intake',
  'confirmed',
  'matching',
  'delivered',
  'closed',
] as const;
export const JobStatus = z.enum(jobStatusValues);
export type JobStatus = z.infer<typeof JobStatus>;

export const shortlistStatusValues = [
  'assembling',
  'human_gate',
  'delivered',
  'rerun',
] as const;
export const ShortlistStatus = z.enum(shortlistStatusValues);
export type ShortlistStatus = z.infer<typeof ShortlistStatus>;

export const entryKindValues = [
  'fit',
  'wildcard',
  'alum',
  'match_only',
] as const;
export const EntryKind = z.enum(entryKindValues);
export type EntryKind = z.infer<typeof EntryKind>;

export const entryStatusValues = ['none', 'intro', 'passed', 'saved'] as const;
export const EntryStatus = z.enum(entryStatusValues);
export type EntryStatus = z.infer<typeof EntryStatus>;

export const revealConsentValues = [
  'n/a',
  'requested',
  'granted',
  'declined',
] as const;
export const RevealConsent = z.enum(revealConsentValues);
export type RevealConsent = z.infer<typeof RevealConsent>;

export const outcomeStageValues = [
  'intro',
  'interview',
  'offer',
  'hire',
  'pass',
] as const;
export const OutcomeStage = z.enum(outcomeStageValues);
export type OutcomeStage = z.infer<typeof OutcomeStage>;

// trust and ops ------------------------------------------------------------

export const ledgerActorKindValues = [
  'sponsor',
  'agent',
  'system',
  'student',
] as const;
export const LedgerActorKind = z.enum(ledgerActorKindValues);
export type LedgerActorKind = z.infer<typeof LedgerActorKind>;

export const ledgerEventKindValues = [
  'view',
  'search_hit',
  'shortlist',
  'export',
  'stream',
  'verify',
  'edit',
] as const;
export const LedgerEventKind = z.enum(ledgerEventKindValues);
export type LedgerEventKind = z.infer<typeof LedgerEventKind>;

export const agentNameValues = [
  'rep',
  'synthesizer',
  'verifier',
  'recruiter',
  'concierge',
  'coach',
  'sentinel',
] as const;
export const AgentName = z.enum(agentNameValues);
export type AgentName = z.infer<typeof AgentName>;

export const exceptionStatusValues = [
  'open',
  'approved',
  'overridden',
  'escalated',
] as const;
export const ExceptionStatus = z.enum(exceptionStatusValues);
export type ExceptionStatus = z.infer<typeof ExceptionStatus>;

// The six categories from the ops-console design (README + ops-console.md).
export const exceptionCategoryValues = [
  'verification_conflict',
  'low_confidence_shortlist',
  'policy_refusal',
  'sla_risk',
  'student_report',
  'consent_edge',
] as const;
export const ExceptionCategory = z.enum(exceptionCategoryValues);
export type ExceptionCategory = z.infer<typeof ExceptionCategory>;

// consent kinds (consents.kind) -------------------------------------------
// Not a DB enum in the DDL (free text column), but the product only issues a
// fixed set, so we type it for the app layer.
export const consentKindValues = [
  'app_recording',
  'verbal_recording',
  'data_processing',
  'reveal_identity',
] as const;
export const ConsentKind = z.enum(consentKindValues);
export type ConsentKind = z.infer<typeof ConsentKind>;

// work authorization status (students.work_auth jsonb) ---------------------
export const workAuthStatusValues = [
  'citizen',
  'permanent_resident',
  'f1_opt',
  'f1_cpt',
  'h1b_needed',
  'other',
] as const;
export const WorkAuthStatus = z.enum(workAuthStatusValues);
export type WorkAuthStatus = z.infer<typeof WorkAuthStatus>;
