// @tartan/db schema — every table in ARCHITECTURE.md section 3.
//
// Conventions: snake_case columns, uuid PKs default gen_random_uuid(),
// created_at/updated_at timestamptz (updated_at maintained via $onUpdate).
// pgEnums are built from the exact value tuples in @tartan/types so the DB
// enum and the app enum cannot drift. jsonb columns are typed with $type<T>()
// against the same zod-inferred types the API uses.
//
// FERPA: there is NO grades table and NO transcript-of-grades column. Coursework
// is student attestation captured as evidence(type='course') meta.courseCode.
//
// coaching_reports lives in its own table and is NEVER referenced by any
// sponsor-facing query path. See the loud comment on that table and the
// relations file (no relation links it toward jobs/shortlists/orgs).

import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import type {
  AgentRunOutput,
  AsyncAnswer,
  Calibration,
  CompExpectation,
  CompRange,
  ConfigValue,
  ConsentEvidence,
  ConsentVerbalSpan,
  CoachingReportBody,
  DossierCompetencies,
  DossierFlags,
  EvidenceChips,
  EvidenceMeta,
  ExceptionContext,
  Followups,
  JobRequirements,
  LedgerDetail,
  Transcript,
  WorkAuth,
} from '@tartan/types';
import {
  agentNameValues,
  dossierStatusValues,
  entryKindValues,
  entryStatusValues,
  evidenceTypeValues,
  exceptionCategoryValues,
  exceptionStatusValues,
  jobStatusValues,
  ledgerActorKindValues,
  ledgerEventKindValues,
  outcomeStageValues,
  provenanceValues,
  revealConsentValues,
  screenStatusValues,
  shortlistStatusValues,
  sponsorMemberRoleValues,
  sponsorTierValues,
  studentKindValues,
  userRoleValues,
  visibilityValues,
} from '@tartan/types';

// ── pgEnums (built from the shared value tuples) ──────────────────────────

export const userRoleEnum = pgEnum('user_role', userRoleValues);
export const studentKindEnum = pgEnum('student_kind', studentKindValues);
export const visibilityEnum = pgEnum('visibility', visibilityValues);
export const sponsorTierEnum = pgEnum('sponsor_tier', sponsorTierValues);
export const sponsorMemberRoleEnum = pgEnum(
  'sponsor_member_role',
  sponsorMemberRoleValues,
);
export const evidenceTypeEnum = pgEnum('evidence_type', evidenceTypeValues);
export const provenanceEnum = pgEnum('provenance', provenanceValues);
export const screenStatusEnum = pgEnum('screen_status', screenStatusValues);
export const dossierStatusEnum = pgEnum('dossier_status', dossierStatusValues);
export const jobStatusEnum = pgEnum('job_status', jobStatusValues);
export const shortlistStatusEnum = pgEnum(
  'shortlist_status',
  shortlistStatusValues,
);
export const entryKindEnum = pgEnum('entry_kind', entryKindValues);
export const entryStatusEnum = pgEnum('entry_status', entryStatusValues);
export const revealConsentEnum = pgEnum('reveal_consent', revealConsentValues);
export const outcomeStageEnum = pgEnum('outcome_stage', outcomeStageValues);
export const ledgerActorKindEnum = pgEnum(
  'ledger_actor_kind',
  ledgerActorKindValues,
);
export const ledgerEventKindEnum = pgEnum(
  'ledger_event_kind',
  ledgerEventKindValues,
);
export const agentNameEnum = pgEnum('agent_name', agentNameValues);
export const exceptionStatusEnum = pgEnum(
  'exception_status',
  exceptionStatusValues,
);
export const exceptionCategoryEnum = pgEnum(
  'exception_category',
  exceptionCategoryValues,
);

// ── shared column groups ──────────────────────────────────────────────────

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ── people and orgs ────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: id(),
  googleSub: text('google_sub').unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: userRoleEnum('role').notNull().default('student'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const students = pgTable(
  'students',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    andrewId: text('andrew_id').unique(),
    program: text('program'),
    gradDate: timestamp('grad_date', { withTimezone: true }),
    kind: studentKindEnum('kind').notNull().default('undergrad'),
    visibility: visibilityEnum('visibility').notNull().default('searchable'),
    startupOpen: boolean('startup_open').notNull().default(false),
    workAuth: jsonb('work_auth').$type<WorkAuth>(),
    locations: text('locations').array(),
    compExpectation: jsonb('comp_expectation').$type<CompExpectation>(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    freshnessScore: doublePrecision('freshness_score'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('students_user_id_idx').on(t.userId)],
);

export const sponsorOrgs = pgTable('sponsor_orgs', {
  id: id(),
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  tier: sponsorTierEnum('tier').notNull().default('premier'),
  contractStart: timestamp('contract_start', { withTimezone: true }),
  contractEnd: timestamp('contract_end', { withTimezone: true }),
  roleSlots: integer('role_slots').notNull().default(10),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sponsorMembers = pgTable(
  'sponsor_members',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => sponsorOrgs.id, { onDelete: 'cascade' }),
    role: sponsorMemberRoleEnum('role').notNull().default('viewer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sponsor_members_org_id_idx').on(t.orgId)],
);

// ── talent graph ────────────────────────────────────────────────────────────

export const skills = pgTable('skills', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  track: text('track'),
  courseCode: text('course_code'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const skillClaims = pgTable(
  'skill_claims',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'restrict' }),
    proficiency: integer('proficiency').notNull().default(0),
    verified: boolean('verified').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('skill_claims_student_id_idx').on(t.studentId)],
);

export const evidence = pgTable(
  'evidence',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    type: evidenceTypeEnum('type').notNull(),
    provenance: provenanceEnum('provenance').notNull().default('self_reported'),
    title: text('title').notNull(),
    url: text('url'),
    meta: jsonb('meta').$type<EvidenceMeta>(),
    embedding: vector('embedding', { dimensions: 1536 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('evidence_student_id_idx').on(t.studentId)],
);

// The edges between claims and evidence.
export const claimEvidence = pgTable('claim_evidence', {
  id: id(),
  claimId: uuid('claim_id')
    .notNull()
    .references(() => skillClaims.id, { onDelete: 'cascade' }),
  evidenceId: uuid('evidence_id')
    .notNull()
    .references(() => evidence.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
});

export const experienceStories = pgTable(
  'experience_stories',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    situation: text('situation').notNull(),
    contribution: text('contribution').notNull(),
    outcome: text('outcome'), // nullable -> renders the italic prompt
    meta: jsonb('meta').$type<EvidenceMeta>(),
    embedding: vector('embedding', { dimensions: 1536 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('experience_stories_student_id_idx').on(t.studentId)],
);

// ── screens and dossiers ─────────────────────────────────────────────────────

export const screens = pgTable(
  'screens',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    status: screenStatusEnum('status').notNull().default('scheduled'),
    consentAppAt: timestamp('consent_app_at', { withTimezone: true }),
    consentVerbalSpan: jsonb('consent_verbal_span').$type<ConsentVerbalSpan>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    retakeOf: uuid('retake_of'),
    audioKey: text('audio_key'),
    transcript: jsonb('transcript').$type<Transcript>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('screens_student_id_idx').on(t.studentId)],
);

export const screenMoments = pgTable(
  'screen_moments',
  {
    id: id(),
    screenId: uuid('screen_id')
      .notNull()
      .references(() => screens.id, { onDelete: 'cascade' }),
    tStartMs: integer('t_start_ms').notNull(),
    tEndMs: integer('t_end_ms').notNull(),
    tag: text('tag').notNull(),
    quote: text('quote').notNull(),
    repNote: text('rep_note'),
    clipKey: text('clip_key'),
    studentVisible: boolean('student_visible').notNull().default(true),
    struck: boolean('struck').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('screen_moments_screen_id_idx').on(t.screenId)],
);

export const dossiers = pgTable(
  'dossiers',
  {
    id: id(),
    screenId: uuid('screen_id')
      .notNull()
      .references(() => screens.id, { onDelete: 'cascade' }),
    status: dossierStatusEnum('status').notNull().default('draft'),
    competency: jsonb('competency').$type<DossierCompetencies>(),
    flags: jsonb('flags').$type<DossierFlags>(),
    followups: jsonb('followups').$type<Followups>(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('dossiers_screen_id_idx').on(t.screenId)],
);

// STUDENT-ONLY. NEVER joined into any sponsor-facing query path. There is no
// FK from any sponsor aggregate to this table, and relations.ts deliberately
// exposes no relation that would let a sponsor query traverse into it. If you
// are writing a sponsor/MCP query and you reach this table, stop — that is a
// data-leak bug, not a feature.
export const coachingReports = pgTable('coaching_reports', {
  id: id(),
  screenId: uuid('screen_id')
    .notNull()
    .references(() => screens.id, { onDelete: 'cascade' }),
  body: jsonb('body').$type<CoachingReportBody>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── roles and matching ───────────────────────────────────────────────────────

export const jobs = pgTable('jobs', {
  id: id(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => sponsorOrgs.id, { onDelete: 'cascade' }),
  status: jobStatusEnum('status').notNull().default('intake'),
  title: text('title').notNull(),
  jdRaw: text('jd_raw'),
  requirements: jsonb('requirements').$type<JobRequirements>(),
  calibration: jsonb('calibration').$type<Calibration>(),
  // comp disclosure is required — NOT NULL (ARCHITECTURE section 8).
  compRange: jsonb('comp_range').$type<CompRange>().notNull(),
  // Requirements embedding for pgvector retrieval (recruiter longlist:
  // cosine-nearest students over evidence/story embeddings). HNSW index in
  // the guards migration.
  embedding: vector('embedding', { dimensions: 1536 }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const shortlists = pgTable(
  'shortlists',
  {
    id: id(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    status: shortlistStatusEnum('status').notNull().default('assembling'),
    poolNote: text('pool_note'),
    sampled: boolean('sampled').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('shortlists_job_id_idx').on(t.jobId)],
);

export const shortlistEntries = pgTable(
  'shortlist_entries',
  {
    id: id(),
    shortlistId: uuid('shortlist_id')
      .notNull()
      .references(() => shortlists.id, { onDelete: 'cascade' }),
    // cross-aggregate ref: restrict so a student cannot be hard-deleted out
    // from under a live shortlist; the deletion worker removes entries first.
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    rank: integer('rank').notNull(),
    fit: integer('fit').notNull(),
    rationale: text('rationale'),
    evidenceChips: jsonb('evidence_chips').$type<EvidenceChips>(),
    kind: entryKindEnum('kind').notNull().default('fit'),
    status: entryStatusEnum('status').notNull().default('none'),
    passReason: text('pass_reason'),
    // The student's answer to the recruiter's async follow-up (audio key +/or
    // text + answeredAt). Nullable: only set once the student replies.
    asyncAnswer: jsonb('async_answer').$type<AsyncAnswer>(),
    revealConsent: revealConsentEnum('reveal_consent')
      .notNull()
      .default('n/a'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('shortlist_entries_shortlist_id_rank_idx').on(t.shortlistId, t.rank),
    index('shortlist_entries_student_id_idx').on(t.studentId),
  ],
);

export const outcomes = pgTable('outcomes', {
  id: id(),
  entryId: uuid('entry_id')
    .notNull()
    .references(() => shortlistEntries.id, { onDelete: 'cascade' }),
  stage: outcomeStageEnum('stage').notNull(),
  loggedBy: uuid('logged_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── trust and ops ────────────────────────────────────────────────────────────

// APPEND-ONLY. UPDATE and DELETE are blocked by a database trigger (see the
// guards migration). student_id is nullable + set null on deletion; the
// retained audit row keeps subject_hash (a salted hash of the student id) so
// the deletion itself is auditable without retaining identity.
export const ledgerEvents = pgTable(
  'ledger_events',
  {
    id: id(),
    studentId: uuid('student_id').references(() => students.id, {
      onDelete: 'set null',
    }),
    subjectHash: text('subject_hash'),
    actorKind: ledgerActorKindEnum('actor_kind').notNull(),
    actorId: text('actor_id'),
    kind: ledgerEventKindEnum('kind').notNull(),
    detail: jsonb('detail').$type<LedgerDetail>(),
    license: text('license'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_events_student_id_created_at_idx').on(
      t.studentId,
      t.createdAt.desc(),
    ),
  ],
);

export const consents = pgTable(
  'consents',
  {
    id: id(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    granted: boolean('granted').notNull().default(false),
    evidence: jsonb('evidence').$type<ConsentEvidence>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('consents_student_id_idx').on(t.studentId)],
);

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: id(),
    agent: agentNameEnum('agent').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version'),
    inputRef: text('input_ref'),
    output: jsonb('output').$type<AgentRunOutput>(),
    confidence: doublePrecision('confidence'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    tokens: integer('tokens'),
    flagged: boolean('flagged').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('agent_runs_agent_created_at_idx').on(t.agent, t.createdAt.desc())],
);

export const exceptions = pgTable(
  'exceptions',
  {
    id: id(),
    category: exceptionCategoryEnum('category').notNull(),
    agent: agentNameEnum('agent'),
    context: jsonb('context').$type<ExceptionContext>(),
    recommendation: text('recommendation'),
    status: exceptionStatusEnum('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('exceptions_status_idx').on(t.status)],
);

export const config = pgTable('config', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<ConfigValue>(),
  version: integer('version').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Convenience: the raw SQL for the visibility view is created in the guards
// migration, not here (drizzle does not model views in this schema). See
// drizzle/ for CREATE VIEW sponsor_visible_students.
export const SPONSOR_VISIBLE_STUDENTS_VIEW = sql`sponsor_visible_students`;
