// Student router — the real implementation backing the student app surface
// (docs/design-notes/student-app.md + ARCHITECTURE section 7). Every procedure
// is scoped to the signed-in student (ctx.principal.studentId); a student can
// only ever read/write their own rows. All mutations that change what a sponsor
// can see, or that a student would want an audit trail of, append a
// ledger_events row via writeLedgerEvent.

import { randomUUID, createHmac } from 'node:crypto';
import { z } from 'zod';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  sql,
  claimEvidence,
  coachingReports,
  config,
  consents,
  dossiers,
  evidence,
  exceptions,
  experienceStories,
  jobs,
  ledgerEvents,
  screenMoments,
  screens,
  shortlistEntries,
  shortlists,
  skillClaims,
  skills,
  sponsorOrgs,
  students,
  users,
} from '@tartan/db';
import { embedOne, parseResume } from '@tartan/agents';
import {
  enqueueDeletion,
  enqueueExport,
  enqueueVerification,
} from '@/lib/redis';
import {
  AddEvidenceInput,
  AddEvidenceOutput,
  ApproveScreenInput,
  ApproveScreenOutput,
  CreateScreenInput,
  CreateScreenOutput,
  DeleteAccountInput,
  DeleteAccountOutput,
  ExportOutput,
  ExportStatus,
  exportConfigKey,
  HomeOutput,
  LedgerInput,
  LedgerOutput,
  MatchesOutput,
  ProfileOutput,
  ReplyToMatchInput,
  ReplyToMatchOutput,
  ScreenReviewOutput,
  UpdateMomentInput,
  UpdateMomentOutput,
  UpdateProfileInput,
  UpdateVisibilityInput,
  UpdateVisibilityOutput,
  UpsertSkillClaimInput,
  UpsertSkillClaimOutput,
  DeleteSkillClaimInput,
  DeleteSkillClaimOutput,
  UpsertStoryInput,
  UpsertStoryOutput,
  DeleteStoryInput,
  DeleteStoryOutput,
  UpdateEvidenceInput,
  UpdateEvidenceOutput,
  DeleteEvidenceInput,
  DeleteEvidenceOutput,
  OnboardingStateOutput,
  SetLogisticsInput,
  SetLogisticsOutput,
  ParseResumeInput,
  ParseResumeOutput,
  CompleteOnboardingInput,
  CompleteOnboardingOutput,
  type EditableProfile,
  type OnboardingStep,
  type CoachingReportBody,
  type DossierCompetencies,
  type DossierFlags,
  type Followups,
  type LedgerDetail,
  type ScreenDossierCard as ScreenDossierCardT,
  type WorkAuth,
} from '@tartan/types';
import { TRPCError } from '@trpc/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { router, studentProcedure, type TRPCContext } from '../trpc';
import { writeLedgerEvent } from '@/lib/ledger';
import { s3 } from '@/lib/s3';
import { formatCompRange } from '@/lib/format';
import { slugify } from '@/lib/resume';

type Db = TRPCContext['db'];

// ── shared loaders ──────────────────────────────────────────────────────────

async function loadIdentity(db: Db, studentId: string) {
  const rows = await db
    .select({
      studentId: students.id,
      name: users.name,
      andrewId: students.andrewId,
      program: students.program,
      gradDate: students.gradDate,
      kind: students.kind,
    })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .where(eq(students.id, studentId))
    .limit(1);
  const r = rows[0];
  if (!r) throw new TRPCError({ code: 'NOT_FOUND', message: 'student not found' });
  return {
    identity: {
      studentId: r.studentId,
      name: r.name,
      andrewId: r.andrewId,
      program: r.program,
      gradDate: r.gradDate ? r.gradDate.toISOString() : null,
      kind: r.kind,
      avatarColor: '#063f58',
      ssoVerified: Boolean(r.andrewId),
    },
    andrewId: r.andrewId,
  };
}

/** The student's representative screen: prefer a published one, else the latest. */
async function loadRepresentativeScreen(db: Db, studentId: string) {
  const screenRows = await db
    .select({ id: screens.id, status: screens.status, createdAt: screens.createdAt })
    .from(screens)
    .where(eq(screens.studentId, studentId))
    .orderBy(desc(screens.createdAt));
  if (screenRows.length === 0) return null;
  const published = screenRows.find((s) => s.status === 'published');
  const screen = published ?? screenRows[0]!;
  const dossierRows = await db
    .select({ id: dossiers.id, status: dossiers.status })
    .from(dossiers)
    .where(eq(dossiers.screenId, screen.id))
    .limit(1);
  return { screen, dossier: dossierRows[0] ?? null };
}

function buildDossierCard(
  screen: { id: string; status: (typeof screens.$inferSelect)['status'] },
  dossier: { id: string; status: 'draft' | 'approved' } | null,
): ScreenDossierCardT {
  const screenStatus = screen.status;
  const dossierStatus = dossier?.status ?? null;
  let statusLabel: string;
  let statusTone: 'amber' | 'green' | 'gray';
  let action: { label: string; href?: string } | null;
  if (screenStatus === 'published' && dossierStatus === 'approved') {
    statusLabel = 'Live';
    statusTone = 'green';
    action = { label: 'Manage moment visibility', href: '/interviews' };
  } else if (screenStatus === 'review' || screenStatus === 'processing') {
    statusLabel = 'Awaiting your approval';
    statusTone = 'amber';
    action = { label: 'Review the draft', href: `/call/${screen.id}?state=post` };
  } else {
    statusLabel = 'Pending';
    statusTone = 'amber';
    action = { label: 'Start the screen', href: `/call/${screen.id}` };
  }
  return {
    screenId: screen.id,
    dossierId: dossier?.id ?? null,
    screenStatus,
    dossierStatus,
    statusLabel,
    statusTone,
    action,
  };
}

async function loadLedger(db: Db, studentId: string, limit: number, cursor?: string) {
  const where = cursor
    ? and(eq(ledgerEvents.studentId, studentId), lt(ledgerEvents.createdAt, new Date(cursor)))
    : eq(ledgerEvents.studentId, studentId);
  const rows = await db
    .select()
    .from(ledgerEvents)
    .where(where)
    .orderBy(desc(ledgerEvents.createdAt))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit ? page[page.length - 1]!.createdAt.toISOString() : null;
  const entries = page.map((r) => ({
    id: r.id,
    eventKind: r.kind,
    actorLabel: r.actorId ?? '',
    detail: (r.detail ?? { kind: r.kind }) as LedgerDetail,
    license: r.license,
    createdAt: r.createdAt.toISOString(),
  }));
  return { entries, nextCursor };
}

function workAuthChip(wa: WorkAuth | null | undefined): string {
  switch (wa?.status) {
    case 'f1_cpt':
      return 'F-1 · CPT eligible';
    case 'f1_opt':
      return 'F-1 · OPT eligible';
    case 'h1b_needed':
      return 'H-1B sponsorship needed';
    case 'permanent_resident':
      return 'Permanent resident';
    case 'citizen':
      return 'US citizen';
    default:
      return 'Work authorization on file';
  }
}

function monthYear(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function buildProfile(db: Db, studentId: string) {
  const { identity } = await loadIdentity(db, studentId);
  const stuRows = await db
    .select({
      visibility: students.visibility,
      workAuth: students.workAuth,
      locations: students.locations,
      compExpectation: students.compExpectation,
      startupOpen: students.startupOpen,
      freshnessScore: students.freshnessScore,
      lastVerifiedAt: students.lastVerifiedAt,
    })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  const stu = stuRows[0]!;
  const locations = stu.locations ?? [];

  const logisticsChips = [
    { label: 'availability', value: monthYear(identity.gradDate), tone: 'neutral' as const },
    { label: 'seeking', value: 'Internships + new grad', tone: 'neutral' as const },
    {
      label: 'locations',
      value: locations.length ? locations.join(' or ') : 'Open to relocation',
      tone: 'neutral' as const,
    },
    { label: 'work-auth', value: workAuthChip(stu.workAuth), tone: 'info' as const },
    ...(stu.startupOpen
      ? [{ label: 'startups', value: 'Open to startups', tone: 'neutral' as const }]
      : []),
  ].filter((c) => c.value);

  // ── Talent Graph ─────────────────────────────────────────────────────────
  const claimRows = await db
    .select({
      claimId: skillClaims.id,
      skillId: skills.id,
      slug: skills.slug,
      name: skills.name,
      track: skills.track,
      courseCode: skills.courseCode,
      proficiency: skillClaims.proficiency,
      verified: skillClaims.verified,
    })
    .from(skillClaims)
    .innerJoin(skills, eq(skills.id, skillClaims.skillId))
    .where(eq(skillClaims.studentId, studentId));

  const edgeRows = await db
    .select({ claimId: claimEvidence.claimId, evidenceId: claimEvidence.evidenceId })
    .from(claimEvidence)
    .innerJoin(skillClaims, eq(skillClaims.id, claimEvidence.claimId))
    .where(eq(skillClaims.studentId, studentId))
    .orderBy(asc(claimEvidence.id));

  const byClaim = new Map<string, string[]>();
  for (const e of edgeRows) {
    const arr = byClaim.get(e.claimId) ?? [];
    arr.push(e.evidenceId);
    byClaim.set(e.claimId, arr);
  }

  // Real ordering: verified claims first, then by proficiency, then by the
  // number of evidence edges, then by name for a stable tiebreak. No fixed
  // demo slug list — any student's real skills render sensibly.
  const talentGraph = claimRows
    .slice()
    .sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      if (a.proficiency !== b.proficiency) return b.proficiency - a.proficiency;
      const ea = (byClaim.get(a.claimId) ?? []).length;
      const eb = (byClaim.get(b.claimId) ?? []).length;
      if (ea !== eb) return eb - ea;
      return a.name.localeCompare(b.name);
    })
    .map((c) => ({
      skillId: c.skillId,
      slug: c.slug,
      name: c.name,
      track: c.track,
      courseCode: c.courseCode,
      proficiency: c.proficiency,
      verified: c.verified,
      evidenceIds: byClaim.get(c.claimId) ?? [],
    }));

  const evidenceRows = await db
    .select()
    .from(evidence)
    .where(eq(evidence.studentId, studentId))
    .orderBy(asc(evidence.id));
  const evidenceCards = evidenceRows.map((e) => ({
    id: e.id,
    type: e.type,
    provenance: e.provenance,
    title: e.title,
    url: e.url,
    meta: e.meta ?? {},
  }));

  const storyRows = await db
    .select()
    .from(experienceStories)
    .where(eq(experienceStories.studentId, studentId))
    .orderBy(asc(experienceStories.id));
  const stories = storyRows.map((s) => ({
    id: s.id,
    title: s.title,
    situation: s.situation,
    contribution: s.contribution,
    outcome: s.outcome,
    provenance: (s.outcome ? 'verified' : 'self_reported') as 'verified' | 'self_reported',
  }));

  const rep = await loadRepresentativeScreen(db, studentId);
  const screenDossierCard = rep ? buildDossierCard(rep.screen, rep.dossier) : null;

  return {
    identity,
    visibility: stu.visibility,
    logisticsChips,
    workAuth: stu.workAuth ?? { status: 'other' as const, needsSponsorship: false },
    locations,
    compExpectation: stu.compExpectation ?? null,
    startupOpen: stu.startupOpen,
    freshnessScore: stu.freshnessScore,
    lastVerifiedAt: stu.lastVerifiedAt ? stu.lastVerifiedAt.toISOString() : null,
    talentGraph,
    evidence: evidenceCards,
    stories,
    screenDossierCard,
  };
}

// ── HMAC call-token minting (matches services/voice-gateway/src/auth-token.ts) ─
function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}
function mintCallToken(screenId: string, studentId: string, ttlSeconds = 120): string {
  const secret = process.env.AUTH_SECRET ?? '';
  const payload = JSON.stringify({
    screenId,
    studentId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
  const sig = createHmac('sha256', secret).update(payload).digest();
  return `${b64url(Buffer.from(payload, 'utf8'))}.${b64url(sig)}`;
}
function voiceWsBase(): string {
  const raw = process.env.WS_URL ?? 'ws://localhost:8787';
  return raw.replace(/\/+$/, '');
}

async function assertOwnScreen(db: Db, screenId: string, studentId: string) {
  const rows = await db
    .select({ id: screens.id, status: screens.status })
    .from(screens)
    .where(and(eq(screens.id, screenId), eq(screens.studentId, studentId)))
    .limit(1);
  if (!rows[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'not your screen' });
  return rows[0];
}

// ── onboarding helpers ───────────────────────────────────────────────────────

/**
 * Whether a student has finished onboarding. onboarded_at is the authoritative
 * flag, but the seeded demo students predate the column (null onboarded_at) yet
 * have a fully authored profile — so a published screen OR any skill claim also
 * counts as onboarded. This keeps demo accounts out of the wizard while a truly
 * brand-new profile (no claims, no screen, null onboarded_at) is gated into it.
 */
export async function resolveOnboarded(
  db: Db,
  studentId: string,
  onboardedAt: Date | null,
): Promise<boolean> {
  if (onboardedAt) return true;
  const claim = await db
    .select({ id: skillClaims.id })
    .from(skillClaims)
    .where(eq(skillClaims.studentId, studentId))
    .limit(1);
  if (claim[0]) return true;
  const pub = await db
    .select({ id: screens.id })
    .from(screens)
    .where(and(eq(screens.studentId, studentId), eq(screens.status, 'published')))
    .limit(1);
  return Boolean(pub[0]);
}

/**
 * The editable Living Profile the wizard and the profile editor render/mutate.
 * Mirrors ProfileOutput's Talent Graph / evidence / stories blocks but returns
 * the flat editable scalars (identity + logistics) instead of the display chips.
 * Authored stories are self-reported until the verification worker promotes
 * them, matching the provenance grammar.
 */
async function buildEditableProfile(
  db: Db,
  studentId: string,
): Promise<EditableProfile> {
  const rows = await db
    .select({
      studentId: students.id,
      name: users.name,
      andrewId: students.andrewId,
      kind: students.kind,
      program: students.program,
      gradDate: students.gradDate,
      visibility: students.visibility,
      workAuth: students.workAuth,
      locations: students.locations,
      compExpectation: students.compExpectation,
      startupOpen: students.startupOpen,
      onboardedAt: students.onboardedAt,
    })
    .from(students)
    .innerJoin(users, eq(users.id, students.userId))
    .where(eq(students.id, studentId))
    .limit(1);
  const r = rows[0];
  if (!r) throw new TRPCError({ code: 'NOT_FOUND', message: 'student not found' });

  const claimRows = await db
    .select({
      claimId: skillClaims.id,
      skillId: skills.id,
      slug: skills.slug,
      name: skills.name,
      track: skills.track,
      courseCode: skills.courseCode,
      proficiency: skillClaims.proficiency,
      verified: skillClaims.verified,
    })
    .from(skillClaims)
    .innerJoin(skills, eq(skills.id, skillClaims.skillId))
    .where(eq(skillClaims.studentId, studentId))
    .orderBy(asc(skillClaims.createdAt));

  const edgeRows = await db
    .select({ claimId: claimEvidence.claimId, evidenceId: claimEvidence.evidenceId })
    .from(claimEvidence)
    .innerJoin(skillClaims, eq(skillClaims.id, claimEvidence.claimId))
    .where(eq(skillClaims.studentId, studentId))
    .orderBy(asc(claimEvidence.id));
  const byClaim = new Map<string, string[]>();
  for (const e of edgeRows) {
    const arr = byClaim.get(e.claimId) ?? [];
    arr.push(e.evidenceId);
    byClaim.set(e.claimId, arr);
  }
  const talentGraph = claimRows.map((c) => ({
    skillId: c.skillId,
    slug: c.slug,
    name: c.name,
    track: c.track,
    courseCode: c.courseCode,
    proficiency: c.proficiency,
    verified: c.verified,
    evidenceIds: byClaim.get(c.claimId) ?? [],
  }));

  const evidenceRows = await db
    .select()
    .from(evidence)
    .where(eq(evidence.studentId, studentId))
    .orderBy(asc(evidence.id));
  const evidenceCards = evidenceRows.map((e) => ({
    id: e.id,
    type: e.type,
    provenance: e.provenance,
    title: e.title,
    url: e.url,
    meta: e.meta ?? {},
    caption: e.type.replace(/_/g, ' '),
  }));

  const storyRows = await db
    .select()
    .from(experienceStories)
    .where(eq(experienceStories.studentId, studentId))
    .orderBy(asc(experienceStories.id));
  const stories = storyRows.map((s) => ({
    id: s.id,
    title: s.title,
    situation: s.situation,
    contribution: s.contribution,
    outcome: s.outcome,
    provenance: 'self_reported' as const,
  }));

  const onboarded = await resolveOnboarded(db, studentId, r.onboardedAt);

  return {
    studentId: r.studentId,
    name: r.name,
    andrewId: r.andrewId,
    kind: r.kind,
    program: r.program,
    gradDateISO: r.gradDate ? r.gradDate.toISOString() : null,
    visibility: r.visibility,
    workAuth: r.workAuth ?? null,
    locations: r.locations ?? [],
    compExpectation: r.compExpectation ?? null,
    startupOpen: r.startupOpen,
    onboarded,
    talentGraph,
    evidence: evidenceCards,
    stories,
  };
}

/** Best resume point for the wizard: authored → review, logistics → author. */
function deriveStep(profile: EditableProfile): OnboardingStep {
  if (profile.onboarded) return 'done';
  const hasAuthored =
    profile.talentGraph.length > 0 ||
    profile.stories.length > 0 ||
    profile.evidence.length > 0;
  if (hasAuthored) return 'review';
  const hasLogistics =
    Boolean(profile.program) ||
    Boolean(profile.gradDateISO) ||
    Boolean(profile.workAuth) ||
    profile.locations.length > 0 ||
    Boolean(profile.compExpectation);
  if (hasLogistics) return 'author';
  return 'welcome';
}

// Real profile-strength score. Five equally weighted completeness signals,
// 20 points each (0-100): has any skill, has verified evidence, has a story
// with a measured outcome, has logistics set, and has a published/approved
// Talent Rep screen. doNext points at the biggest missing piece with an honest,
// specific suggestion — never a hardcoded name or "+4" copy.
async function computeStrengthMeter(
  db: Db,
  studentId: string,
  published: boolean,
): Promise<{ label: string; value: number; doNext: string }> {
  const claimRows = await db
    .select({
      claimId: skillClaims.id,
      name: skills.name,
    })
    .from(skillClaims)
    .innerJoin(skills, eq(skills.id, skillClaims.skillId))
    .where(eq(skillClaims.studentId, studentId))
    .orderBy(asc(skillClaims.id));

  const evRows = await db
    .select({ provenance: evidence.provenance })
    .from(evidence)
    .where(eq(evidence.studentId, studentId));

  const storyRows = await db
    .select({ title: experienceStories.title, outcome: experienceStories.outcome })
    .from(experienceStories)
    .where(eq(experienceStories.studentId, studentId))
    .orderBy(asc(experienceStories.id));

  const edgeRows = await db
    .select({ claimId: claimEvidence.claimId })
    .from(claimEvidence)
    .innerJoin(skillClaims, eq(skillClaims.id, claimEvidence.claimId))
    .where(eq(skillClaims.studentId, studentId));
  const claimsWithEvidence = new Set(edgeRows.map((e) => e.claimId));

  const stuRows = await db
    .select({
      program: students.program,
      gradDate: students.gradDate,
      workAuth: students.workAuth,
      locations: students.locations,
      compExpectation: students.compExpectation,
    })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  const stu = stuRows[0];

  const hasSkills = claimRows.length > 0;
  const hasVerifiedEvidence = evRows.some((e) => e.provenance === 'verified');
  const hasStoryOutcome = storyRows.some((s) => Boolean(s.outcome));
  const hasLogistics = Boolean(
    stu &&
      (stu.program ||
        stu.gradDate ||
        stu.workAuth ||
        (stu.locations && stu.locations.length > 0) ||
        stu.compExpectation),
  );

  const signals = [hasSkills, hasVerifiedEvidence, hasStoryOutcome, hasLogistics, published];
  const value = signals.filter(Boolean).length * 20;

  // Biggest missing piece, most fundamental first.
  const storyWithoutOutcome = storyRows.find((s) => !s.outcome);
  const skillWithoutEvidence = claimRows.find((c) => !claimsWithEvidence.has(c.claimId));
  let doNext: string;
  if (!hasSkills) {
    doNext = 'Add your first skill to your Talent Graph.';
  } else if (storyRows.length === 0) {
    doNext = 'Add a story about your best work.';
  } else if (storyWithoutOutcome) {
    doNext = `Add a measured outcome to your ${storyWithoutOutcome.title} story.`;
  } else if (skillWithoutEvidence) {
    doNext = `Add evidence to ${skillWithoutEvidence.name}.`;
  } else if (!published) {
    doNext = 'Book your Talent Rep screen.';
  } else if (!hasLogistics) {
    doNext = 'Set your availability and locations.';
  } else {
    doNext = 'Your profile is looking strong. Keep it fresh.';
  }

  return { label: 'Profile strength', value, doNext };
}

// Real timeline position for a shortlist entry against the 5-step ladder
// (Matched, Shortlisted, Intro, Interview, Outcome). A shortlisted entry is at
// least step 2; 'intro' advances to step 3. Derived from the entry's real
// status, never a fixed constant.
function entryTimeline(status: string): { done: number; tag: string } {
  switch (status) {
    case 'intro':
      return { done: 3, tag: 'Intro' };
    default:
      return { done: 2, tag: 'Shortlisted' };
  }
}

// ── router ──────────────────────────────────────────────────────────────────

export const studentRouter = router({
  home: studentProcedure.output(HomeOutput).query(async ({ ctx }) => {
    const db = ctx.db;
    const studentId = ctx.principal.studentId;
    const { identity } = await loadIdentity(db, studentId);
    const rep = await loadRepresentativeScreen(db, studentId);
    const published = rep?.screen.status === 'published' && rep.dossier?.status === 'approved';

    const strengthMeter = await computeStrengthMeter(db, studentId, published);

    const startHref = rep ? `/call/${rep.screen.id}` : '/interviews';
    const primaryAction = {
      eyebrow: 'One thing to do',
      title: 'Do your Talent Rep screen',
      body: '30 minutes with our AI talent rep gets you a verified profile, a real practice report, and Premier shortlist eligibility.',
      primary: { label: 'Start now', href: startHref },
      secondary: { label: 'Book a slot' },
    };

    const entryRows = await db
      .select({
        entryId: shortlistEntries.id,
        status: shortlistEntries.status,
        jobTitle: jobs.title,
        orgName: sponsorOrgs.name,
      })
      .from(shortlistEntries)
      .innerJoin(shortlists, eq(shortlists.id, shortlistEntries.shortlistId))
      .innerJoin(jobs, eq(jobs.id, shortlists.jobId))
      .innerJoin(sponsorOrgs, eq(sponsorOrgs.id, jobs.orgId))
      .where(eq(shortlistEntries.studentId, studentId))
      .orderBy(asc(shortlistEntries.rank))
      .limit(1);
    const liveMatch = entryRows[0]
      ? (() => {
          const tl = entryTimeline(entryRows[0]!.status);
          return {
            entryId: entryRows[0]!.entryId,
            company: entryRows[0]!.orgName,
            roleTitle: entryRows[0]!.jobTitle,
            statusTag: tl.tag,
            stepsDone: tl.done,
            stepLabels: ['Matched', 'Shortlisted', 'Intro', 'Interview', 'Outcome'],
          };
        })()
      : null;

    const { entries: ledgerPreview } = await loadLedger(db, studentId, 4);

    return {
      student: identity,
      strengthMeter,
      primaryAction,
      liveMatch,
      ledgerPreview,
      dossierCard: rep ? buildDossierCard(rep.screen, rep.dossier) : null,
    };
  }),

  profile: studentProcedure.output(ProfileOutput).query(async ({ ctx }) => {
    return buildProfile(ctx.db, ctx.principal.studentId);
  }),

  updateProfile: studentProcedure
    .input(UpdateProfileInput)
    .output(ProfileOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      const patch: Record<string, unknown> = {};
      if (input.program !== undefined) patch.program = input.program;
      if (input.gradDate !== undefined) patch.gradDate = new Date(input.gradDate);
      if (input.workAuth !== undefined) patch.workAuth = input.workAuth;
      if (input.locations !== undefined) patch.locations = input.locations;
      if (input.compExpectation !== undefined) patch.compExpectation = input.compExpectation;
      if (input.startupOpen !== undefined) patch.startupOpen = input.startupOpen;
      if (Object.keys(patch).length) {
        await db.update(students).set(patch).where(eq(students.id, studentId));
        await writeLedgerEvent({
          studentId,
          actorKind: 'student',
          actorId: ctx.principal.userId,
          kind: 'edit',
          detail: { kind: 'edit', field: Object.keys(patch).join(', '), note: 'You updated your profile.' },
        });
      }
      return buildProfile(db, studentId);
    }),

  ledger: studentProcedure
    .input(LedgerInput)
    .output(LedgerOutput)
    .query(async ({ ctx, input }) => {
      return loadLedger(ctx.db, ctx.principal.studentId, input.limit, input.cursor);
    }),

  updateVisibility: studentProcedure
    .input(UpdateVisibilityInput)
    .output(UpdateVisibilityOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      await db
        .update(students)
        .set({ visibility: input.visibility })
        .where(eq(students.id, studentId));
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'visibility',
          note: `You set visibility to ${input.visibility}. Effective now, including the MCP layer.`,
        },
      });
      return { visibility: input.visibility };
    }),

  createScreen: studentProcedure
    .input(CreateScreenInput)
    .output(CreateScreenOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const inserted = await db
        .insert(screens)
        .values({
          studentId: ctx.principal.studentId,
          status: 'scheduled',
          retakeOf: input.retakeOf ?? null,
        })
        .returning({ id: screens.id, status: screens.status });
      const row = inserted[0]!;
      return {
        screenId: row.id,
        status: row.status,
        wsUrl: `${voiceWsBase()}/voice/${row.id}`,
        resumeToken: randomUUID(),
      };
    }),

  // Mint the WS call token AFTER writing the app-consent rows (contract in
  // services/voice-gateway/src/auth-token.ts). Returns the full connect URL.
  startCall: studentProcedure
    .input(
      z.object({
        screenId: z.string().uuid(),
        consentRecording: z.boolean(),
        consentLicense: z.boolean(),
      }),
    )
    .output(
      z.object({
        screenId: z.string().uuid(),
        wsUrl: z.string(),
        token: z.string(),
        simulated: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      await assertOwnScreen(db, input.screenId, studentId);
      if (!input.consentRecording || !input.consentLicense) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'both consents are required' });
      }
      const nowIso = new Date().toISOString();
      await db.insert(consents).values([
        {
          studentId,
          kind: 'app_recording',
          granted: true,
          evidence: { method: 'app_checkbox', screenId: input.screenId, confirmedAt: nowIso },
        },
        {
          studentId,
          kind: 'data_processing',
          granted: true,
          evidence: { method: 'app_checkbox', screenId: input.screenId, confirmedAt: nowIso },
        },
      ]);
      await db
        .update(screens)
        .set({ consentAppAt: new Date() })
        .where(eq(screens.id, input.screenId));
      const token = mintCallToken(input.screenId, studentId);
      return {
        screenId: input.screenId,
        wsUrl: `${voiceWsBase()}/voice/${input.screenId}`,
        token,
        // The gateway runs in simulation when no Cartesia key is set; it is the
        // demo path. The client also reads the authoritative flag off the
        // gateway's `ready` frame.
        simulated: !process.env.CARTESIA_API_KEY?.trim(),
      };
    }),

  screenReview: studentProcedure
    .input(z.object({ screenId: z.string().uuid() }))
    .output(ScreenReviewOutput)
    .query(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      const screen = await assertOwnScreen(db, input.screenId, studentId);

      const dossierRows = await db
        .select()
        .from(dossiers)
        .where(eq(dossiers.screenId, input.screenId))
        .limit(1);
      const d = dossierRows[0] ?? null;

      const coachRows = await db
        .select({ body: coachingReports.body })
        .from(coachingReports)
        .where(eq(coachingReports.screenId, input.screenId))
        .limit(1);

      const momentRows = await db
        .select()
        .from(screenMoments)
        .where(eq(screenMoments.screenId, input.screenId))
        .orderBy(asc(screenMoments.tStartMs));

      return {
        screenId: input.screenId,
        status: screen.status,
        coachingReport: (coachRows[0]?.body ?? null) as CoachingReportBody | null,
        dossier: d
          ? {
              id: d.id,
              status: d.status,
              competency: (d.competency ?? []) as DossierCompetencies,
              flags: (d.flags ?? { green: [], probe: [] }) as DossierFlags,
              followups: (d.followups ?? []) as Followups,
            }
          : null,
        moments: momentRows.map((m) => ({
          id: m.id,
          tStartMs: m.tStartMs,
          tEndMs: m.tEndMs,
          tag: m.tag,
          quote: m.quote,
          repNote: m.repNote,
          clipKey: m.clipKey,
          studentVisible: m.studentVisible,
          struck: m.struck,
        })),
      };
    }),

  approveScreen: studentProcedure
    .input(ApproveScreenInput)
    .output(ApproveScreenOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      await assertOwnScreen(db, input.screenId, studentId);
      const now = new Date();
      await db
        .update(screens)
        .set({ status: 'published' })
        .where(eq(screens.id, input.screenId));
      await db
        .update(dossiers)
        .set({ status: 'approved', approvedAt: now })
        .where(eq(dossiers.screenId, input.screenId));
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'dossier',
          note: 'You approved and published your Screen Dossier.',
        },
      });
      return { screenId: input.screenId, status: 'published', publishedAt: now.toISOString() };
    }),

  updateMoment: studentProcedure
    .input(UpdateMomentInput)
    .output(UpdateMomentOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      // Ownership: the moment's screen must belong to this student.
      const owned = await db
        .select({ id: screenMoments.id, tag: screenMoments.tag })
        .from(screenMoments)
        .innerJoin(screens, eq(screens.id, screenMoments.screenId))
        .where(and(eq(screenMoments.id, input.momentId), eq(screens.studentId, studentId)))
        .limit(1);
      if (!owned[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'not your moment' });

      const patch: Record<string, unknown> = {};
      if (input.studentVisible !== undefined) patch.studentVisible = input.studentVisible;
      if (input.struck !== undefined) patch.struck = input.struck;
      if (Object.keys(patch).length) {
        await db.update(screenMoments).set(patch).where(eq(screenMoments.id, input.momentId));
      }
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'moment_visibility',
          note:
            input.struck === true
              ? `You struck the moment "${owned[0].tag}".`
              : `You set "${owned[0].tag}" to ${input.studentVisible ? 'visible' : 'hidden'} for sponsors.`,
        },
      });

      const after = await db
        .select()
        .from(screenMoments)
        .where(eq(screenMoments.id, input.momentId))
        .limit(1);
      const m = after[0]!;
      return {
        moment: {
          id: m.id,
          tStartMs: m.tStartMs,
          tEndMs: m.tEndMs,
          tag: m.tag,
          quote: m.quote,
          repNote: m.repNote,
          clipKey: m.clipKey,
          studentVisible: m.studentVisible,
          struck: m.struck,
        },
      };
    }),

  matches: studentProcedure.output(MatchesOutput).query(async ({ ctx }) => {
    const db = ctx.db;
    const studentId = ctx.principal.studentId;
    const rows = await db
      .select({
        entryId: shortlistEntries.id,
        status: shortlistEntries.status,
        kind: shortlistEntries.kind,
        revealConsent: shortlistEntries.revealConsent,
        asyncAnswer: shortlistEntries.asyncAnswer,
        jobTitle: jobs.title,
        orgName: sponsorOrgs.name,
        compRange: jobs.compRange,
      })
      .from(shortlistEntries)
      .innerJoin(shortlists, eq(shortlists.id, shortlistEntries.shortlistId))
      .innerJoin(jobs, eq(jobs.id, shortlists.jobId))
      .innerJoin(sponsorOrgs, eq(sponsorOrgs.id, jobs.orgId))
      .where(eq(shortlistEntries.studentId, studentId))
      .orderBy(asc(shortlistEntries.rank));

    return {
      matches: rows.map((r) => {
        // A follow-up shows only when the recruiter actually posed one on this
        // entry (async_answer.question). Answered once the student has recorded
        // audio or typed a reply. No question -> just the role + timeline.
        const question = r.asyncAnswer?.question;
        const answered = Boolean(r.asyncAnswer?.audioKey || r.asyncAnswer?.text);
        return {
          entryId: r.entryId,
          company: r.orgName,
          roleTitle: r.jobTitle,
          compLabel: r.compRange ? formatCompRange(r.compRange) : 'comp disclosed',
          status: r.status,
          kind: r.kind,
          revealConsent: r.revealConsent,
          timelineDone: entryTimeline(r.status).done,
          asyncQuestion: question
            ? { id: r.entryId, text: question, answered }
            : null,
        };
      }),
    };
  }),

  // Presign a PUT for the student's recorded async answer. The client uploads
  // the audio directly, then calls replyToMatch with the returned key.
  replyUploadUrl: studentProcedure
    .input(z.object({ entryId: z.string().uuid(), contentType: z.string().default('audio/webm') }))
    .output(z.object({ key: z.string(), url: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db
        .select({ id: shortlistEntries.id })
        .from(shortlistEntries)
        .where(and(eq(shortlistEntries.id, input.entryId), eq(shortlistEntries.studentId, ctx.principal.studentId)))
        .limit(1);
      if (!owned[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'not your match' });
      const bucket = process.env.S3_BUCKET;
      if (!bucket) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'S3 not configured' });
      const key = `async-replies/${input.entryId}/${randomUUID()}.webm`;
      const url = await getSignedUrl(
        s3(),
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: input.contentType }),
        { expiresIn: 120 },
      );
      return { key, url };
    }),

  replyToMatch: studentProcedure
    .input(ReplyToMatchInput)
    .output(ReplyToMatchOutput)
    .mutation(async ({ ctx, input }) => {
      const studentId = ctx.principal.studentId;
      const owned = await ctx.db
        .select({ id: shortlistEntries.id, asyncAnswer: shortlistEntries.asyncAnswer })
        .from(shortlistEntries)
        .where(and(eq(shortlistEntries.id, input.entryId), eq(shortlistEntries.studentId, studentId)))
        .limit(1);
      if (!owned[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'not your match' });
      // Persist the answer onto the entry so it surfaces in the sponsor dossier
      // (audio streams via /api/stream/answer/:entryId; never a durable URL).
      // Preserve the recruiter's real question that was posed on the entry.
      await ctx.db
        .update(shortlistEntries)
        .set({
          asyncAnswer: {
            question: owned[0].asyncAnswer?.question,
            audioKey: input.audioKey ?? null,
            text: input.text ?? null,
            answeredAt: new Date().toISOString(),
          },
        })
        .where(eq(shortlistEntries.id, input.entryId));
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'match_reply',
          note: 'You answered the recruiter follow-up. It rides with your shortlist card.',
        },
      });
      return { entryId: input.entryId, delivered: true };
    }),

  // Match-only reveal, student side. When a sponsor requests identity reveal on
  // a match-only entry (reveal_consent='requested'), the student grants or
  // declines here. Grant flips the entry to 'granted' (the visibility layer then
  // lets the sponsor read the identity); decline flips it to 'declined'. Either
  // way the choice is appended to the student's ledger. Ownership-scoped, and it
  // only ever acts on an entry that actually has a pending request.
  respondReveal: studentProcedure
    .input(z.object({ entryId: z.string().uuid(), grant: z.boolean() }))
    .output(
      z.object({
        entryId: z.string().uuid(),
        revealConsent: z.enum(['granted', 'declined']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      const owned = await db
        .select({
          id: shortlistEntries.id,
          revealConsent: shortlistEntries.revealConsent,
        })
        .from(shortlistEntries)
        .where(
          and(
            eq(shortlistEntries.id, input.entryId),
            eq(shortlistEntries.studentId, studentId),
          ),
        )
        .limit(1);
      if (!owned[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'not your match' });
      if (owned[0].revealConsent !== 'requested') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'no reveal request is pending on this match',
        });
      }
      const next = input.grant ? ('granted' as const) : ('declined' as const);
      await db
        .update(shortlistEntries)
        .set({ revealConsent: next })
        .where(eq(shortlistEntries.id, input.entryId));
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'reveal_consent',
          note: input.grant
            ? 'You revealed your identity to the sponsor for this match.'
            : 'You kept your identity hidden for this match.',
        },
      });
      return { entryId: input.entryId, revealConsent: next };
    }),

  exportData: studentProcedure.output(ExportOutput).mutation(async ({ ctx }) => {
    const studentId = ctx.principal.studentId;
    const requestedAt = new Date().toISOString();
    const pending: ExportStatus = { state: 'pending', requestedAt };
    // Upsert the status key the export worker flips to ready, then enqueue.
    await ctx.db
      .insert(config)
      .values({ key: exportConfigKey(studentId), value: pending })
      .onConflictDoUpdate({
        target: config.key,
        set: { value: pending, version: sql`${config.version} + 1` },
      });
    await enqueueExport({ studentId });
    await writeLedgerEvent({
      studentId,
      actorKind: 'student',
      actorId: ctx.principal.userId,
      kind: 'edit',
      detail: { kind: 'edit', field: 'export', note: 'You requested your full data export.' },
    });
    return { requested: true, jobId: randomUUID() };
  }),

  // Poll target for the Settings screen: the export worker writes the same
  // config key with state ready + a 24h download url.
  exportStatus: studentProcedure
    .output(ExportStatus.nullable())
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({ value: config.value })
        .from(config)
        .where(eq(config.key, exportConfigKey(ctx.principal.studentId)))
        .limit(1);
      if (!rows[0]) return null;
      const parsed = ExportStatus.safeParse(rows[0].value);
      return parsed.success ? parsed.data : null;
    }),

  deleteAccount: studentProcedure
    .input(DeleteAccountInput)
    .output(DeleteAccountOutput)
    .mutation(async ({ ctx }) => {
      const studentId = ctx.principal.studentId;
      const requestedAt = new Date().toISOString();
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'account',
          note: 'You asked us to delete your account. Everything goes: rows, audio, exports.',
        },
      });
      // The deletion worker anonymizes the historical ledger (salted hash),
      // cascades every row, and purges S3 raw/clips/exports (spec section 8).
      await enqueueDeletion({ studentId, requestedAt });
      return { scheduled: true, jobId: randomUUID() };
    }),

  // The consent screen's text-mode escape link files a real accommodation
  // request in the ops exception queue (text-mode screens are phase 1.5).
  requestTextMode: studentProcedure
    .input(z.object({ screenId: z.string().uuid() }))
    .output(z.object({ requested: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const studentId = ctx.principal.studentId;
      await assertOwnScreen(ctx.db, input.screenId, studentId);
      await ctx.db.insert(exceptions).values({
        category: 'student_report',
        agent: 'rep',
        context: {
          agent: 'rep',
          quote: 'Student requested the written interview format.',
          category: 'student_report',
          refs: { screenId: input.screenId, studentId },
        },
        recommendation: 'Schedule a text-mode screen and release the voice slot.',
        status: 'open',
      });
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'screen',
          note: 'You asked for the written interview format.',
        },
      });
      return { requested: true };
    }),

  // POST /me/evidence (spec section 7): pending provenance, immediate render
  // under the provenance grammar, then the verification worker takes over.
  addEvidence: studentProcedure
    .input(AddEvidenceInput)
    .output(AddEvidenceOutput)
    .mutation(async ({ ctx, input }) => {
      const studentId = ctx.principal.studentId;
      let embedding: number[] | null = null;
      try {
        embedding = await embedOne(
          `${input.type}: ${input.title} ${input.url ?? ''}`,
        );
      } catch {
        embedding = null; // embeddings are an optimization, never a blocker
      }
      const inserted = await ctx.db
        .insert(evidence)
        .values({
          studentId,
          type: input.type,
          provenance: 'pending',
          title: input.title,
          url: input.url ?? null,
          meta: input.meta ?? {},
          embedding,
        })
        .returning();
      const row = inserted[0]!;

      // Optional claim edges by skill slug.
      if (input.skillSlugs?.length) {
        const skillRows = await ctx.db
          .select({ id: skills.id, slug: skills.slug })
          .from(skills)
          .where(inArray(skills.slug, input.skillSlugs));
        for (const s of skillRows) {
          const claim = await ctx.db
            .select({ id: skillClaims.id })
            .from(skillClaims)
            .where(and(eq(skillClaims.studentId, studentId), eq(skillClaims.skillId, s.id)))
            .limit(1);
          const claimId = claim[0]
            ? claim[0].id
            : (
                await ctx.db
                  .insert(skillClaims)
                  .values({ studentId, skillId: s.id, proficiency: 3, verified: false })
                  .returning({ id: skillClaims.id })
              )[0]!.id;
          await ctx.db
            .insert(claimEvidence)
            .values({ claimId, evidenceId: row.id })
            .onConflictDoNothing();
        }
      }

      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'evidence',
          note: `You added "${input.title}". Verification is queued.`,
        },
      });
      try {
        await enqueueVerification({ evidenceId: row.id, studentId });
      } catch {
        // Redis unreachable: evidence stays pending; the verification sweep
        // can pick it up later. Never block the student on queue plumbing.
      }

      return {
        evidence: {
          id: row.id,
          type: row.type,
          provenance: row.provenance,
          title: row.title,
          url: row.url,
          meta: row.meta ?? {},
          caption: row.type.replace(/_/g, ' '),
        },
      };
    }),

  // ── Living Profile authoring ──────────────────────────────────────────────
  // Manual create/edit of the Living Profile's skills, stories, and evidence.
  // Every mutation is scoped to ctx.principal.studentId, writes a ledger 'edit',
  // and keeps the trust invariant: `verified` is never accepted from the client
  // (system-only) and edited evidence returns to pending provenance. The
  // onboarding agent calls these by these exact names.

  // The Living Profile read model (ProfileOutput.talentGraph) exposes skillId
  // but not the underlying skill_claims.id that deleteSkillClaim keys on. This
  // returns that mapping so the editor can wire a chip's remove control to its
  // claim. Scoped to the student, read-only.
  skillClaimIndex: studentProcedure
    .output(
      z.object({
        items: z.array(
          z.object({
            skillId: z.string().uuid(),
            skillClaimId: z.string().uuid(),
          }),
        ),
      }),
    )
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({ skillId: skillClaims.skillId, skillClaimId: skillClaims.id })
        .from(skillClaims)
        .where(eq(skillClaims.studentId, ctx.principal.studentId));
      return { items: rows };
    }),

  // Insert or update a skill claim. With skillClaimId it edits proficiency on an
  // owned claim; without it, resolves skillSlug (or slugify(name)) to a skills
  // taxonomy row — creating it (track null) when absent — then upserts the
  // student's claim for that skill. verified stays system-set (never written).
  upsertSkillClaim: studentProcedure
    .input(UpsertSkillClaimInput)
    .output(UpsertSkillClaimOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;

      let claimId: string;
      let skillId: string;

      if (input.skillClaimId) {
        const owned = await db
          .select({ id: skillClaims.id, skillId: skillClaims.skillId })
          .from(skillClaims)
          .where(and(eq(skillClaims.id, input.skillClaimId), eq(skillClaims.studentId, studentId)))
          .limit(1);
        if (!owned[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'not your skill claim' });
        claimId = owned[0].id;
        skillId = owned[0].skillId;
        await db
          .update(skillClaims)
          .set({ proficiency: input.proficiency, updatedAt: new Date() })
          .where(eq(skillClaims.id, claimId));
      } else {
        // Find-or-create the taxonomy row. A slug collision reuses the existing
        // skill so two students naming "Rust" share one node.
        const slug = input.skillSlug?.trim() || slugify(input.skillName);
        const existingSkill = await db
          .select({ id: skills.id })
          .from(skills)
          .where(eq(skills.slug, slug))
          .limit(1);
        skillId = existingSkill[0]
          ? existingSkill[0].id
          : (
              await db
                .insert(skills)
                .values({ slug, name: input.skillName, track: null })
                .returning({ id: skills.id })
            )[0]!.id;

        // Upsert the student's claim for that skill (one claim per skill).
        const existingClaim = await db
          .select({ id: skillClaims.id })
          .from(skillClaims)
          .where(and(eq(skillClaims.studentId, studentId), eq(skillClaims.skillId, skillId)))
          .limit(1);
        if (existingClaim[0]) {
          claimId = existingClaim[0].id;
          await db
            .update(skillClaims)
            .set({ proficiency: input.proficiency, updatedAt: new Date() })
            .where(eq(skillClaims.id, claimId));
        } else {
          claimId = (
            await db
              .insert(skillClaims)
              .values({ studentId, skillId, proficiency: input.proficiency, verified: false })
              .returning({ id: skillClaims.id })
          )[0]!.id;
        }
      }

      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'skill',
          note: `You saved the skill "${input.skillName}" at proficiency ${input.proficiency}.`,
        },
      });

      const skillRow = (
        await db.select().from(skills).where(eq(skills.id, skillId)).limit(1)
      )[0]!;
      const claimRow = (
        await db
          .select({ proficiency: skillClaims.proficiency, verified: skillClaims.verified })
          .from(skillClaims)
          .where(eq(skillClaims.id, claimId))
          .limit(1)
      )[0]!;
      const edges = await db
        .select({ evidenceId: claimEvidence.evidenceId })
        .from(claimEvidence)
        .where(eq(claimEvidence.claimId, claimId))
        .orderBy(asc(claimEvidence.id));

      return {
        skill: {
          skillId: skillRow.id,
          slug: skillRow.slug,
          name: skillRow.name,
          track: skillRow.track,
          courseCode: skillRow.courseCode,
          proficiency: claimRow.proficiency,
          verified: claimRow.verified,
          evidenceIds: edges.map((e) => e.evidenceId),
        },
      };
    }),

  // Delete a skill claim (its claim_evidence edges cascade). The shared skills
  // taxonomy row is left intact — other students may claim it.
  deleteSkillClaim: studentProcedure
    .input(DeleteSkillClaimInput)
    .output(DeleteSkillClaimOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      const owned = await db
        .select({ id: skillClaims.id, skillId: skillClaims.skillId })
        .from(skillClaims)
        .where(and(eq(skillClaims.id, input.skillClaimId), eq(skillClaims.studentId, studentId)))
        .limit(1);
      if (!owned[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'not your skill claim' });
      const skillName = (
        await db
          .select({ name: skills.name })
          .from(skills)
          .where(eq(skills.id, owned[0].skillId))
          .limit(1)
      )[0]?.name;
      // claim_evidence.claim_id cascades on delete; the edges go with the claim.
      await db.delete(skillClaims).where(eq(skillClaims.id, input.skillClaimId));
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'skill',
          note: `You removed the skill "${skillName ?? 'a skill'}" from your Talent Graph.`,
        },
      });
      return { skillClaimId: input.skillClaimId, deleted: true };
    }),

  // Insert or update an experience story. A missing outcome stays null (renders
  // the italic prompt, never invented). Embeds on save, best-effort.
  upsertStory: studentProcedure
    .input(UpsertStoryInput)
    .output(UpsertStoryOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      const outcome = input.outcome?.trim() ? input.outcome : null;

      let embedding: number[] | null = null;
      try {
        embedding = await embedOne(
          `${input.title}\n${input.situation}\n${input.contribution}\n${outcome ?? ''}`,
        );
      } catch {
        embedding = null; // embeddings are an optimization, never a blocker
      }

      let row: typeof experienceStories.$inferSelect;
      if (input.storyId) {
        const owned = await db
          .select({ id: experienceStories.id })
          .from(experienceStories)
          .where(
            and(
              eq(experienceStories.id, input.storyId),
              eq(experienceStories.studentId, studentId),
            ),
          )
          .limit(1);
        if (!owned[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'not your story' });
        const set: Record<string, unknown> = {
          title: input.title,
          situation: input.situation,
          contribution: input.contribution,
          outcome,
          updatedAt: new Date(),
        };
        if (embedding) set.embedding = embedding;
        row = (
          await db
            .update(experienceStories)
            .set(set)
            .where(eq(experienceStories.id, input.storyId))
            .returning()
        )[0]!;
      } else {
        row = (
          await db
            .insert(experienceStories)
            .values({
              studentId,
              title: input.title,
              situation: input.situation,
              contribution: input.contribution,
              outcome,
              embedding,
            })
            .returning()
        )[0]!;
      }

      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'story',
          note: `You saved the experience story "${input.title}".`,
        },
      });

      return {
        story: {
          id: row.id,
          title: row.title,
          situation: row.situation,
          contribution: row.contribution,
          outcome: row.outcome,
          provenance: (row.outcome ? 'verified' : 'self_reported') as
            | 'verified'
            | 'self_reported',
        },
      };
    }),

  deleteStory: studentProcedure
    .input(DeleteStoryInput)
    .output(DeleteStoryOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      const owned = await db
        .select({ id: experienceStories.id, title: experienceStories.title })
        .from(experienceStories)
        .where(
          and(
            eq(experienceStories.id, input.storyId),
            eq(experienceStories.studentId, studentId),
          ),
        )
        .limit(1);
      if (!owned[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'not your story' });
      await db.delete(experienceStories).where(eq(experienceStories.id, input.storyId));
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'story',
          note: `You removed the experience story "${owned[0].title}".`,
        },
      });
      return { storyId: input.storyId, deleted: true };
    }),

  // Update an existing evidence item. Any edit re-opens provenance to pending
  // (the previously-checked artifact may have changed) and re-queues the
  // verification worker; `verified`/provenance are never taken from the client.
  updateEvidence: studentProcedure
    .input(UpdateEvidenceInput)
    .output(UpdateEvidenceOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      const owned = await db
        .select()
        .from(evidence)
        .where(and(eq(evidence.id, input.evidenceId), eq(evidence.studentId, studentId)))
        .limit(1);
      if (!owned[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'not your evidence' });
      const cur = owned[0];

      const nextTitle = input.title ?? cur.title;
      const nextUrl = input.url !== undefined ? input.url : cur.url;
      let embedding: number[] | null = cur.embedding;
      try {
        embedding = await embedOne(`${cur.type}: ${nextTitle} ${nextUrl ?? ''}`);
      } catch {
        // keep the prior embedding if re-embedding fails
      }

      const patch: Record<string, unknown> = {
        provenance: 'pending',
        embedding,
        updatedAt: new Date(),
      };
      if (input.title !== undefined) patch.title = input.title;
      if (input.url !== undefined) patch.url = input.url; // null clears the link
      if (input.meta !== undefined) patch.meta = input.meta;

      const row = (
        await db
          .update(evidence)
          .set(patch)
          .where(eq(evidence.id, input.evidenceId))
          .returning()
      )[0]!;

      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'evidence',
          note: `You edited "${row.title}". Verification is queued again.`,
        },
      });
      try {
        await enqueueVerification({ evidenceId: row.id, studentId });
      } catch {
        // Redis unreachable: it stays pending; the sweep re-checks it later.
      }

      return {
        evidence: {
          id: row.id,
          type: row.type,
          provenance: row.provenance,
          title: row.title,
          url: row.url,
          meta: row.meta ?? {},
          caption: row.type.replace(/_/g, ' '),
        },
      };
    }),

  // Delete an evidence item. claim_evidence edges cascade on evidence delete;
  // the skill claims they wired stay (they simply lose that proof).
  deleteEvidence: studentProcedure
    .input(DeleteEvidenceInput)
    .output(DeleteEvidenceOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      const owned = await db
        .select({ id: evidence.id, title: evidence.title })
        .from(evidence)
        .where(and(eq(evidence.id, input.evidenceId), eq(evidence.studentId, studentId)))
        .limit(1);
      if (!owned[0]) throw new TRPCError({ code: 'FORBIDDEN', message: 'not your evidence' });
      await db.delete(evidence).where(eq(evidence.id, input.evidenceId));
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'evidence',
          note: `You removed the evidence "${owned[0].title}".`,
        },
      });
      return { evidenceId: input.evidenceId, deleted: true };
    }),

  // ── onboarding ────────────────────────────────────────────────────────────
  // The self-serve wizard's read + write surface. onboardingState is the gate
  // signal (also fetched by middleware) and the wizard's initial data;
  // setLogistics/parseResume/completeOnboarding are its writes. Authoring of
  // skills/stories/evidence reuses the upsert*/delete* procedures above.

  // Gate + hydrate. Returns whether onboarding is complete, the best resume
  // step, and the editable profile the wizard renders.
  onboardingState: studentProcedure
    .output(OnboardingStateOutput)
    .query(async ({ ctx }) => {
      const profile = await buildEditableProfile(ctx.db, ctx.principal.studentId);
      return { step: deriveStep(profile), onboarded: profile.onboarded, profile };
    }),

  // The logistics step: program, expected graduation, degree kind, work
  // authorization, target locations, comp expectation, startup interest. All
  // fields optional so partial saves work; writes one ledger edit.
  setLogistics: studentProcedure
    .input(SetLogisticsInput)
    .output(SetLogisticsOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      const patch: Record<string, unknown> = {};
      if (input.program !== undefined) patch.program = input.program;
      if (input.gradDateISO !== undefined) patch.gradDate = new Date(input.gradDateISO);
      if (input.kind !== undefined) patch.kind = input.kind;
      if (input.workAuth !== undefined) patch.workAuth = input.workAuth;
      if (input.locations !== undefined) patch.locations = input.locations;
      if (input.compExpectation !== undefined) patch.compExpectation = input.compExpectation;
      if (input.startupOpen !== undefined) patch.startupOpen = input.startupOpen;
      if (Object.keys(patch).length) {
        patch.updatedAt = new Date();
        await db.update(students).set(patch).where(eq(students.id, studentId));
        await writeLedgerEvent({
          studentId,
          actorKind: 'student',
          actorId: ctx.principal.userId,
          kind: 'edit',
          detail: {
            kind: 'edit',
            field: 'logistics',
            note: 'You updated your logistics and preferences.',
          },
        });
      }
      return { profile: await buildEditableProfile(db, studentId) };
    }),

  // Resume-parse jump-start. Stashes the extracted text (audit + re-parse), then
  // runs the live Synthesizer parse (agent_runs is written inside runAgent). The
  // draft is NOT committed here — the wizard pre-fills the review step with it,
  // and each item is only persisted when the student saves it (as
  // pending/self_reported). PDF→text extraction happens at /onboarding/extract;
  // this mutation takes the already-extracted text.
  parseResume: studentProcedure
    .input(ParseResumeInput)
    .output(ParseResumeOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      await db
        .update(students)
        .set({ resumeText: input.text, updatedAt: new Date() })
        .where(eq(students.id, studentId));
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'resume',
          note: 'You uploaded a resume to jump-start your profile. Everything it drafts is self-reported until verified.',
        },
      });
      const draft = await parseResume(input.text);
      return { draft };
    }),

  // Finish onboarding: stamp onboarded_at (the gate flips), optionally apply a
  // final visibility choice so "finish and go live" is one action. A brand-new
  // profile without a published screen is correctly still not in sponsor results
  // — that is by design (the sponsor_visible_students view needs a screen).
  completeOnboarding: studentProcedure
    .input(CompleteOnboardingInput)
    .output(CompleteOnboardingOutput)
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      const now = new Date();
      const patch: Record<string, unknown> = { onboardedAt: now, updatedAt: now };
      if (input.visibility !== undefined) patch.visibility = input.visibility;
      await db.update(students).set(patch).where(eq(students.id, studentId));
      if (input.visibility !== undefined) {
        await writeLedgerEvent({
          studentId,
          actorKind: 'student',
          actorId: ctx.principal.userId,
          kind: 'edit',
          detail: {
            kind: 'edit',
            field: 'visibility',
            note: `You set visibility to ${input.visibility}. Effective now, including the MCP layer.`,
          },
        });
      }
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'onboarding',
          note: 'You finished onboarding. Your Living Profile is live.',
        },
      });
      const cur = await db
        .select({ visibility: students.visibility })
        .from(students)
        .where(eq(students.id, studentId))
        .limit(1);
      return {
        onboarded: true,
        onboardedAt: now.toISOString(),
        visibility: cur[0]!.visibility,
      };
    }),

  // Remove a skill from the profile, keyed by skillId. The profile editor's
  // deleteSkillClaim is keyed by skillClaimId, but the read model (TalentGraphSkill)
  // only exposes skillId — so onboarding/editor UIs that render the graph need a
  // skillId-keyed delete. Scoped to the student's own claim; edges cascade.
  removeSkillBySkillId: studentProcedure
    .input(z.object({ skillId: z.string().uuid() }))
    .output(z.object({ skillId: z.string().uuid(), deleted: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const db = ctx.db;
      const studentId = ctx.principal.studentId;
      const owned = await db
        .select({ id: skillClaims.id })
        .from(skillClaims)
        .where(and(eq(skillClaims.studentId, studentId), eq(skillClaims.skillId, input.skillId)))
        .limit(1);
      if (!owned[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'no claim for that skill' });
      const nameRows = await db
        .select({ name: skills.name })
        .from(skills)
        .where(eq(skills.id, input.skillId))
        .limit(1);
      await db.delete(skillClaims).where(eq(skillClaims.id, owned[0].id));
      await writeLedgerEvent({
        studentId,
        actorKind: 'student',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'skill',
          note: `You removed the skill "${nameRows[0]?.name ?? 'skill'}".`,
        },
      });
      return { skillId: input.skillId, deleted: true };
    }),
});
