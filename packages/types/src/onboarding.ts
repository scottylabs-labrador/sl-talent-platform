// Onboarding, profile authoring, and ops create-student API schemas.
//
// These back the new "create a student profile from scratch" surfaces: the
// self-serve onboarding wizard, the manual profile author/editor (student edits
// their own; ops edits any), and the ops create-student tool. All additive to
// the existing api.ts contracts.
//
// Convention (matches api.ts): `XxxInput` = request payload, `XxxOutput` =
// response payload. Authoring outputs return the updated read-model entity so
// the client can patch its Living Profile in place without a refetch.
//
// Trust rules baked into the contracts: new/edited evidence and claims default
// provenance 'pending'/'self_reported' and verified=false at the server; the
// `verified` flag is system-set by the verification worker and is NOT accepted
// on any input here.

import { z } from 'zod';
import { StudentKind, Visibility } from './enums.js';
import { CompExpectation, EvidenceMeta, WorkAuth } from './json.js';
import {
  EvidenceCard,
  ExperienceStory,
  TalentGraphSkill,
  UpdateVisibilityInput,
  UpdateVisibilityOutput,
} from './api.js';
import { ResumeParseResult } from './agents.js';

// ── The editable profile shape ────────────────────────────────────────────
// What the onboarding wizard and the profile editor render and mutate. Mirrors
// the Living Profile read model (ProfileOutput) so a brand-new profile and a
// fully-authored one use one shape. Skills/evidence/stories reuse the exact
// read-model DTOs; identity + logistics are the editable scalars.

export const EditableProfile = z.object({
  studentId: z.string().uuid(),
  name: z.string(),
  andrewId: z.string().nullable(),
  kind: StudentKind,
  program: z.string().nullable(),
  gradDateISO: z.string().nullable(),
  visibility: Visibility,
  // work auth is shown exactly as self-declared; null until the student states it.
  workAuth: WorkAuth.nullable(),
  locations: z.array(z.string()),
  compExpectation: CompExpectation.nullable(),
  startupOpen: z.boolean(),
  onboarded: z.boolean(),
  // Living Profile blocks (same DTOs the read path returns).
  talentGraph: z.array(TalentGraphSkill),
  evidence: z.array(EvidenceCard),
  stories: z.array(ExperienceStory),
});
export type EditableProfile = z.infer<typeof EditableProfile>;

// ── Onboarding state machine ──────────────────────────────────────────────

export const onboardingStepValues = [
  'welcome',
  'logistics',
  'author',
  'review',
  'done',
] as const;
export const OnboardingStep = z.enum(onboardingStepValues);
export type OnboardingStep = z.infer<typeof OnboardingStep>;

export const OnboardingStateOutput = z.object({
  step: OnboardingStep,
  onboarded: z.boolean(),
  profile: EditableProfile,
});
export type OnboardingStateOutput = z.infer<typeof OnboardingStateOutput>;

// Visibility during onboarding reuses the existing student visibility contract
// verbatim (a paused profile is never sponsor-visible). Re-exported under the
// onboarding name the wizard consumes.
export const SetVisibilityInput = UpdateVisibilityInput;
export type SetVisibilityInput = z.infer<typeof SetVisibilityInput>;
export const SetVisibilityOutput = UpdateVisibilityOutput;
export type SetVisibilityOutput = z.infer<typeof SetVisibilityOutput>;

// The logistics step: everything under the logistics chips row. All optional so
// the student can fill it in any order and save partials.
export const SetLogisticsInput = z.object({
  program: z.string().optional(),
  gradDateISO: z.string().optional(),
  kind: StudentKind.optional(),
  workAuth: WorkAuth.optional(),
  locations: z.array(z.string()).optional(),
  compExpectation: CompExpectation.optional(),
  startupOpen: z.boolean().optional(),
});
export type SetLogisticsInput = z.infer<typeof SetLogisticsInput>;

export const SetLogisticsOutput = z.object({
  profile: EditableProfile,
});
export type SetLogisticsOutput = z.infer<typeof SetLogisticsOutput>;

// Resume parse jump-start: raw extracted text in, structured draft out. The
// draft is never auto-committed; the wizard pre-fills the author step with it.
export const ParseResumeInput = z.object({
  text: z.string().min(1),
});
export type ParseResumeInput = z.infer<typeof ParseResumeInput>;

export const ParseResumeOutput = z.object({
  draft: ResumeParseResult,
});
export type ParseResumeOutput = z.infer<typeof ParseResumeOutput>;

// Complete onboarding: stamp students.onboarded_at. Optionally carries a final
// visibility choice so "finish" and "go live" are one action.
export const CompleteOnboardingInput = z.object({
  visibility: Visibility.optional(),
});
export type CompleteOnboardingInput = z.infer<typeof CompleteOnboardingInput>;

export const CompleteOnboardingOutput = z.object({
  onboarded: z.literal(true),
  onboardedAt: z.string(), // ISO
  visibility: Visibility,
});
export type CompleteOnboardingOutput = z.infer<typeof CompleteOnboardingOutput>;

// ── Profile authoring (student edits own; ops edits any) ──────────────────
// Every mutation writes a ledger edit event and (for evidence/claims) keeps
// provenance self-reported/pending + verified=false. `verified` is never an
// input — the verification worker sets it.

// Upsert a skill claim. skillClaimId present = edit proficiency; absent = create
// (server resolves skillSlug→skills row, creating the skill via slugify(name)
// when no slug matches the taxonomy).
export const UpsertSkillClaimInput = z.object({
  skillClaimId: z.string().uuid().optional(),
  skillName: z.string().min(1),
  skillSlug: z.string().optional(),
  proficiency: z.number().int().min(1).max(5),
});
export type UpsertSkillClaimInput = z.infer<typeof UpsertSkillClaimInput>;

export const UpsertSkillClaimOutput = z.object({
  skill: TalentGraphSkill,
});
export type UpsertSkillClaimOutput = z.infer<typeof UpsertSkillClaimOutput>;

export const DeleteSkillClaimInput = z.object({
  skillClaimId: z.string().uuid(),
});
export type DeleteSkillClaimInput = z.infer<typeof DeleteSkillClaimInput>;

export const DeleteSkillClaimOutput = z.object({
  skillClaimId: z.string().uuid(),
  deleted: z.literal(true),
});
export type DeleteSkillClaimOutput = z.infer<typeof DeleteSkillClaimOutput>;

// Upsert an experience story. storyId present = edit; absent = create. A missing
// outcome stays null (renders the italic prompt, never invented).
export const UpsertStoryInput = z.object({
  storyId: z.string().uuid().optional(),
  title: z.string().min(1),
  situation: z.string().min(1),
  contribution: z.string().min(1),
  outcome: z.string().optional(),
});
export type UpsertStoryInput = z.infer<typeof UpsertStoryInput>;

export const UpsertStoryOutput = z.object({
  story: ExperienceStory,
});
export type UpsertStoryOutput = z.infer<typeof UpsertStoryOutput>;

export const DeleteStoryInput = z.object({
  storyId: z.string().uuid(),
});
export type DeleteStoryInput = z.infer<typeof DeleteStoryInput>;

export const DeleteStoryOutput = z.object({
  storyId: z.string().uuid(),
  deleted: z.literal(true),
});
export type DeleteStoryOutput = z.infer<typeof DeleteStoryOutput>;

// Update an existing evidence item (AddEvidenceInput already exists for create).
// Editing any field re-opens provenance to pending and clears verified, since
// the previously-checked artifact may have changed.
export const UpdateEvidenceInput = z.object({
  evidenceId: z.string().uuid(),
  title: z.string().min(1).optional(),
  url: z.string().url().nullable().optional(),
  meta: EvidenceMeta.optional(),
});
export type UpdateEvidenceInput = z.infer<typeof UpdateEvidenceInput>;

export const UpdateEvidenceOutput = z.object({
  evidence: EvidenceCard,
});
export type UpdateEvidenceOutput = z.infer<typeof UpdateEvidenceOutput>;

export const DeleteEvidenceInput = z.object({
  evidenceId: z.string().uuid(),
});
export type DeleteEvidenceInput = z.infer<typeof DeleteEvidenceInput>;

export const DeleteEvidenceOutput = z.object({
  evidenceId: z.string().uuid(),
  deleted: z.literal(true),
});
export type DeleteEvidenceOutput = z.infer<typeof DeleteEvidenceOutput>;

// ── Ops: create a student from scratch ────────────────────────────────────
// Creates the user + student rows with onboarded_at stamped now (an
// ops-created profile is considered onboarded and skips the wizard). When
// resumeText is present the server parses it and pre-seeds skills/stories/
// evidence, exactly like the self-serve upload.

export const CreateStudentInput = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  andrewId: z.string().optional(),
  kind: StudentKind,
  program: z.string().optional(),
  gradDateISO: z.string().optional(),
  visibility: Visibility.optional(),
  // when present, triggers a resume parse to jump-start the new profile.
  resumeText: z.string().optional(),
  workAuth: WorkAuth.optional(),
  locations: z.array(z.string()).optional(),
  compExpectation: CompExpectation.optional(),
});
export type CreateStudentInput = z.infer<typeof CreateStudentInput>;

export const CreateStudentOutput = z.object({
  studentId: z.string().uuid(),
  userId: z.string().uuid(),
});
export type CreateStudentOutput = z.infer<typeof CreateStudentOutput>;

// A roster row for the ops students list.
export const OpsStudentRow = z.object({
  studentId: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  andrewId: z.string().nullable(),
  kind: StudentKind,
  program: z.string().nullable(),
  gradDateISO: z.string().nullable(),
  visibility: Visibility,
  onboarded: z.boolean(),
  onboardedAt: z.string().nullable(), // ISO
  createdAt: z.string(), // ISO
});
export type OpsStudentRow = z.infer<typeof OpsStudentRow>;

export const OpsStudentsListOutput = z.object({
  students: z.array(OpsStudentRow),
});
export type OpsStudentsListOutput = z.infer<typeof OpsStudentsListOutput>;
