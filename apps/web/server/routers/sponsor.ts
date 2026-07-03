// Sponsor router — ARCHITECTURE section 7 (Sponsor) + the sponsor-portal
// screens. Every query is scoped to ctx.principal.orgId; a student the org has
// no delivered shortlist entry for is invisible (defense in depth beyond the
// sponsor_visible_students view, which we still read for the visibility gate).
//
// The audio stream is a REST route (GET /api/stream/:momentId), not a procedure
// here — it 302s to a 60s presigned URL after license/visibility checks + a
// ledger stream event (see app/api/stream/[momentId]/route.ts).

import { z } from 'zod';
import {
  ConciergeMessageInput,
  ConciergeMessageOutput,
  ConciergeReply,
  ConfirmJobInput,
  ConfirmJobOutput,
  CreateJobInput,
  CreateJobOutput,
  DashboardOutput,
  DossierViewOutput,
  EntryActionInput,
  EntryActionOutput,
  IntakeExtraction,
  IntakeMessageInput,
  IntakeMessageOutput,
  LogOutcomeInput,
  LogOutcomeOutput,
  ShortlistOutput,
} from '@tartan/types';
import type {
  AsyncFollowUp,
  Calibration,
  CandidateCard,
  CompRange,
  Identity,
  JobRequirements,
  LogisticsChip,
  RequirementRow,
  RoleRow,
  ShortlistFunnel,
  StatTile,
} from '@tartan/types';
import {
  runAgent,
  CONCIERGE_PROMPT,
  INTAKE_REFUSAL_COPY,
  validateIntakeRequirements,
} from '@tartan/agents';
import { TRPCError } from '@trpc/server';
import {
  and,
  config,
  db as getDb,
  dossiers as dossiersTable,
  eq,
  exceptions,
  experienceStories as experienceStoriesTable,
  inArray,
  jobs,
  outcomes,
  rawSql,
  screenMoments,
  screens,
  shortlistEntries,
  shortlists,
  sponsorOrgs,
} from '@/lib/db';
import { writeLedgerEvent } from '@/lib/ledger';
import { enqueueMatching } from '@/lib/redis';
import { formatCompRange } from '@/lib/format';
import { visibleStudents, type VisibleStudent } from '@/lib/visibility';
import { router, sponsorProcedure } from '../trpc';

// ── constants ────────────────────────────────────────────────────────────────

const LICENSE = 'Premier: internal recruiting use only';
const REFUSED_ROW_VALUE =
  'Filters that proxy protected classes are declined at intake, by policy';
const SLA_HOURS = 72;
// The demo narrative's one async follow-up (mirrors student.ts). Shown on the
// SWE Intern shortlist so the Summary tab's Follow-up block has a question even
// before the student answers. There is no async_questions table; the answer,
// once given, is persisted on shortlist_entries.async_answer.
const ASYNC_QUESTION_TEXT =
  'RailTrace buffered bursty writes for one rail line. What breaks first if Scogle pointed 40,000 fleet units at it, and what would you change?';
const SCOPE_NOTE =
  'This prototype builds the complete dossier for June Park, rank 1. Open hers for the full Summary, Evidence, Screen and Logistics experience; every candidate gets the same structure in production.';


// ── helpers ────────────────────────────────────────────────────────────────

async function readConfig<T>(key: string): Promise<T | null> {
  const rows = await getDb()
    .select({ value: config.value })
    .from(config)
    .where(eq(config.key, key))
    .limit(1);
  return (rows[0]?.value as T | undefined) ?? null;
}

// visibleStudents lives in @/lib/visibility — shared with the audio stream
// route so both enforce the same single visibility authority.

/** The sticky requirements summary rows, derived from jobs.requirements. */
function buildSummaryRows(
  title: string,
  req: JobRequirements | null,
  compRange: CompRange | null,
  calibration: Calibration | null,
  openQuestions: string[],
): RequirementRow[] {
  const r = req ?? { mustHaves: [], niceToHaves: [], skills: [] };
  const rows: RequirementRow[] = [];

  rows.push({
    key: 'Role',
    value: r.team ? `${title} (${r.team})` : title,
    status: 'ok',
  });

  const logistics: string[] = [];
  if (r.timeline) logistics.push(r.timeline);
  if (r.locations?.length) logistics.push(r.locations.join(' or '));
  if (compRange)
    logistics.push(`${formatCompRange(compRange)}, disclosed to candidates`);
  rows.push({
    key: 'Logistics',
    value: logistics.length ? logistics.join(' · ') : 'Pending disclosure',
    status: compRange ? 'ok' : 'open',
  });

  rows.push({
    key: 'Must-have',
    value: r.mustHaves.length ? r.mustHaves.join(' · ') : 'Pending',
    status: r.mustHaves.length ? 'ok' : 'open',
  });

  rows.push({
    key: 'Trainable',
    value: r.niceToHaves.length
      ? r.niceToHaves.join(' · ')
      : 'Open question: what is trainable, not a filter?',
    status: r.niceToHaves.length ? 'ok' : 'open',
  });

  rows.push({
    key: 'Calibration',
    value:
      openQuestions[0] ??
      calibration?.notes ??
      'What does great look like for this role?',
    status: openQuestions.length ? 'open' : 'ok',
  });

  // Standing policy row — ALWAYS present, green dot (a promise kept, not a flag).
  rows.push({ key: 'Refused', value: REFUSED_ROW_VALUE, status: 'ok' });

  return rows;
}

/** Confirm an entry belongs to a shortlist under a job this org owns. */
async function entryInOrg(
  entryId: string,
  orgId: string,
): Promise<{
  entry: typeof shortlistEntries.$inferSelect;
  jobId: string;
} | null> {
  const rows = await getDb()
    .select({ entry: shortlistEntries, jobId: jobs.id })
    .from(shortlistEntries)
    .innerJoin(shortlists, eq(shortlists.id, shortlistEntries.shortlistId))
    .innerJoin(jobs, eq(jobs.id, shortlists.jobId))
    .where(
      and(
        eq(shortlistEntries.id, entryId),
        eq(jobs.orgId, orgId),
        // Human gate: sponsors only ever see delivered shortlists. Assembling
        // and human_gate slates are ops-only until an operator approves.
        eq(shortlists.status, 'delivered'),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? { entry: row.entry, jobId: row.jobId } : null;
}

function statusRank(status: string): number {
  switch (status) {
    case 'delivered':
      return 0;
    case 'matching':
    case 'confirmed':
      return 1;
    case 'intake':
      return 2;
    default:
      return 3;
  }
}

/**
 * A compact, licensed-scope digest the Concierge is grounded on: the org's
 * roles + statuses, the candidates on delivered shortlists (name/rank/fit/chips,
 * anonymized where reveal is not granted), and the funnel numbers. It NEVER
 * includes hidden/struck moments, coaching reports, or paused/unpublished
 * students — those never leave the visibility view. Passed as system context so
 * replies stay inside the license.
 */
async function buildConciergeDigest(orgId: string): Promise<string> {
  const db = getDb();
  const jobRows = await db
    .select({ id: jobs.id, title: jobs.title, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.orgId, orgId));

  const lines: string[] = [];
  lines.push(
    'LICENSED SCOPE (answer only from what is below; never name a candidate not listed here, never mention hidden moments, coaching notes, grades, retakes, or paused students):',
  );
  lines.push('');
  lines.push('Roles this sponsor owns:');
  if (jobRows.length === 0) lines.push('- none yet');
  for (const j of jobRows) lines.push(`- ${j.title} (status: ${j.status})`);

  const deliveredRows = await db
    .select({ shortlistId: shortlists.id, jobTitle: jobs.title })
    .from(shortlists)
    .innerJoin(jobs, eq(jobs.id, shortlists.jobId))
    .where(and(eq(jobs.orgId, orgId), eq(shortlists.status, 'delivered')));

  const funnelBlob = await readConfig<{ funnel?: ShortlistFunnel }>(
    'sponsor.scogle_dashboard',
  );

  for (const sl of deliveredRows) {
    const entries = await db
      .select()
      .from(shortlistEntries)
      .where(eq(shortlistEntries.shortlistId, sl.shortlistId))
      .orderBy(shortlistEntries.rank);
    const visible = await visibleStudents(entries.map((e) => e.studentId));
    lines.push('');
    lines.push(`Delivered shortlist for ${sl.jobTitle}:`);
    for (const e of entries) {
      const v = visible.get(e.studentId);
      const anon = (e.kind === 'match_only' && e.revealConsent !== 'granted') || !v;
      const name = anon
        ? 'Match-only candidate (identity withheld pending consent)'
        : v!.name;
      const chips = (e.evidenceChips ?? []).map((c) => c.label).join(', ');
      const parts = [`rank ${e.rank}: ${name}`, `fit ${e.fit}`];
      if (e.kind !== 'fit') parts.push(e.kind);
      if (e.status !== 'none') parts.push(`status ${e.status}`);
      lines.push(`- ${parts.join(', ')}${chips ? ` — ${chips}` : ''}`);
    }
    const answered = entries.filter((e) => e.asyncAnswer != null).length;
    const f = funnelBlob?.funnel;
    lines.push(
      `Funnel: ${f?.screened ?? 62} screened, ${f?.deepEvaluated ?? 27} deep-evaluated, ${
        answered > 0 ? answered : (f?.answeredFollowup ?? 9)
      } answered the recruiter follow-up.`,
    );
  }
  return lines.join('\n');
}

// ── router ───────────────────────────────────────────────────────────────────

export const sponsorRouter = router({
  // Lightweight org context for the persistent chrome (header + sidebar meter).
  chrome: sponsorProcedure.query(async ({ ctx }) => {
    const { orgId } = ctx.principal;
    const [org] = await getDb()
      .select()
      .from(sponsorOrgs)
      .where(eq(sponsorOrgs.id, orgId))
      .limit(1);
    if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'org' });
    const jobRows = await getDb()
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(eq(jobs.orgId, orgId));

    // Sidebar nav targets (the "Roles" and "Shortlist" rows need real ids).
    const intakeJob = jobRows
      .slice()
      .sort((a, b) => statusRank(a.status) - statusRank(b.status))
      .find((j) => j.status !== 'delivered' && j.status !== 'closed');
    const deliveredShortlist = await getDb()
      .select({ id: shortlists.id })
      .from(shortlists)
      .innerJoin(jobs, eq(jobs.id, shortlists.jobId))
      .where(and(eq(jobs.orgId, orgId), eq(shortlists.status, 'delivered')))
      .limit(1);

    return {
      org: {
        id: org.id,
        name: org.name,
        tier: org.tier,
        roleSlots: { used: jobRows.length, total: org.roleSlots },
      },
      nav: {
        rolesHref: intakeJob ? `/sponsor/intake/${intakeJob.id}` : null,
        shortlistHref: deliveredShortlist[0]
          ? `/sponsor/shortlist/${deliveredShortlist[0].id}`
          : null,
      },
    };
  }),

  // GET /org/dashboard
  dashboard: sponsorProcedure.output(DashboardOutput).query(async ({ ctx }) => {
    const { orgId } = ctx.principal;
    const [org] = await getDb()
      .select()
      .from(sponsorOrgs)
      .where(eq(sponsorOrgs.id, orgId))
      .limit(1);
    if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'org' });

    const jobRows = await getDb()
      .select()
      .from(jobs)
      .where(eq(jobs.orgId, orgId));

    // Delivered jobs → their shortlist id for the "Review shortlist" link, plus
    // status + delivery time so the SLA chip can be a real countdown.
    const shortlistRows = await getDb()
      .select({
        id: shortlists.id,
        jobId: shortlists.jobId,
        status: shortlists.status,
        updatedAt: shortlists.updatedAt,
      })
      .from(shortlists)
      .innerJoin(jobs, eq(jobs.id, shortlists.jobId))
      .where(eq(jobs.orgId, orgId));
    const shortlistByJob = new Map(shortlistRows.map((s) => [s.jobId, s.id]));
    const deliveredByJob = new Map(
      shortlistRows
        .filter((s) => s.status === 'delivered')
        .map((s) => [s.jobId, s]),
    );

    const now = Date.now();

    // ── Live stats (each tile falls back to the seeded blob only with no data) ──
    const deliveredShortlistIds = shortlistRows
      .filter((s) => s.status === 'delivered')
      .map((s) => s.id);

    let introCount = 0;
    let screenedCount = 0;
    if (deliveredShortlistIds.length) {
      const entryRows = await getDb()
        .select({
          studentId: shortlistEntries.studentId,
          status: shortlistEntries.status,
        })
        .from(shortlistEntries)
        .where(inArray(shortlistEntries.shortlistId, deliveredShortlistIds));
      introCount = entryRows.filter((e) => e.status === 'intro').length;
      const studentIds = [...new Set(entryRows.map((e) => e.studentId))];
      if (studentIds.length) {
        const pubScreens = await getDb()
          .select({ id: screens.id })
          .from(screens)
          .where(
            and(
              inArray(screens.studentId, studentIds),
              eq(screens.status, 'published'),
            ),
          );
        screenedCount = pubScreens.length;
      }
    }

    // Time to first shortlist: confirmedAt → delivery of the earliest delivered
    // role, in hours (SLA is 72h). Falls back to the seeded value if unknown.
    let ttfsLabel: string | null = null;
    for (const j of jobRows) {
      const sl = deliveredByJob.get(j.id);
      if (sl && j.confirmedAt) {
        const hrs = Math.max(
          1,
          Math.round((sl.updatedAt.getTime() - j.confirmedAt.getTime()) / 3_600_000),
        );
        ttfsLabel = `${hrs}h`;
        break;
      }
    }
    const roles: RoleRow[] = jobRows
      .slice()
      .sort((a, b) => statusRank(a.status) - statusRank(b.status))
      .map((j) => {
        // Sponsors can only open DELIVERED shortlists (human gate); a newer
        // assembling/human_gate slate for the same job must never be linked.
        const shortlistId = deliveredByJob.get(j.id)?.id ?? null;
        let slaTone: 'green' | 'amber' | 'gray' = 'gray';
        let slaLabel = 'SLA starts on confirm';
        let action: RoleRow['action'] = null;
        if (j.status === 'delivered') {
          slaTone = 'green';
          const sl = deliveredByJob.get(j.id);
          const deliveredHrs =
            sl && j.confirmedAt
              ? Math.max(
                  1,
                  Math.round(
                    (sl.updatedAt.getTime() - j.confirmedAt.getTime()) /
                      3_600_000,
                  ),
                )
              : null;
          slaLabel = deliveredHrs ? `Delivered in ${deliveredHrs}h` : 'Delivered in 41h';
          action = shortlistId
            ? { label: 'Review shortlist', href: `/sponsor/shortlist/${shortlistId}` }
            : null;
        } else if (j.status === 'matching' || j.status === 'confirmed') {
          slaTone = 'amber';
          const hrsLeft = j.slaDueAt
            ? Math.max(0, Math.ceil((j.slaDueAt.getTime() - now) / 3_600_000))
            : SLA_HOURS;
          slaLabel = `${hrsLeft}h left`;
          action = { label: 'View intake', href: `/sponsor/intake/${j.id}` };
        } else {
          slaTone = 'gray';
          slaLabel = 'SLA starts on confirm';
          action = { label: 'Resume intake', href: `/sponsor/intake/${j.id}` };
        }
        return {
          jobId: j.id,
          title: j.title,
          status: j.status,
          slaTone,
          slaLabel,
          shortlistId,
          action,
        };
      });

    // Concierge chips + the seeded stat blob (used only as a per-tile fallback
    // for numbers with no live data source). Labels stay design-verbatim.
    const blob = await readConfig<{
      stats?: { n: string; label: string }[];
      conciergeChips?: string[];
    }>('sponsor.scogle_dashboard');
    const seededStat = (i: number): string | null => blob?.stats?.[i]?.n ?? null;

    const stats: StatTile[] = [
      {
        label: 'candidates screened for your roles',
        value: screenedCount > 0 ? String(screenedCount) : (seededStat(0) ?? '62'),
      },
      {
        label: 'time to first shortlist, SLA 72h',
        value: ttfsLabel ?? (seededStat(1) ?? '41h'),
      },
      {
        label: 'intros accepted on role 1 so far',
        value:
          introCount > 0 ? `${introCount} / 10` : (seededStat(2) ?? '4 / 10'),
      },
      {
        label: 'role slots used this year',
        value: `${jobRows.length} / ${org.roleSlots}`,
      },
    ];

    const conciergeSuggestions = blob?.conciergeChips ?? [
      'How many ML systems students graduate in May?',
      'Rerun role 1, weight Go higher',
      'Which shortlisted candidates are alumni?',
    ];

    return {
      org: {
        id: org.id,
        name: org.name,
        tier: org.tier,
        roleSlots: { used: jobRows.length, total: org.roleSlots },
      },
      stats,
      roles,
      conciergeSuggestions,
    };
  }),

  // GET the live intake state of a job (renders the intake screen initial view).
  job: sponsorProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [j] = await getDb()
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, input.jobId), eq(jobs.orgId, ctx.principal.orgId)))
        .limit(1);
      if (!j) throw new TRPCError({ code: 'NOT_FOUND', message: 'job' });
      const req = j.requirements ?? null;
      const compRange = j.compRange && j.compRange.max > 0 ? j.compRange : null;
      const summaryRows = buildSummaryRows(
        j.title,
        req,
        compRange,
        j.calibration ?? null,
        [],
      );
      return {
        jobId: j.id,
        title: j.title,
        status: j.status,
        requirements: req,
        compRange,
        summaryRows,
        slaDueAt: j.slaDueAt ? j.slaDueAt.toISOString() : null,
        canConfirm: Boolean(compRange) && j.status === 'intake',
      };
    }),

  // POST /jobs — creates a draft (intake) job. comp_range is NOT NULL in the DB,
  // so a draft carries a zeroed placeholder; real comp is disclosed at confirm.
  createJob: sponsorProcedure
    .input(CreateJobInput)
    .output(CreateJobOutput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await getDb()
        .insert(jobs)
        .values({
          orgId: ctx.principal.orgId,
          status: 'intake',
          title: input.title,
          jdRaw: input.jdRaw ?? null,
          requirements: { mustHaves: [], niceToHaves: [], skills: [] },
          compRange: { min: 0, max: 0, period: 'hour', currency: 'USD' },
        })
        .returning({ id: jobs.id, status: jobs.status });
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return { jobId: row.id, status: row.status };
    }),

  // POST /jobs/:id/intake-message — one turn of the intake conversation.
  // Concierge extracts structured requirements (IntakeExtraction schema); the
  // deterministic policy guard runs on every extraction; requirements + comp are
  // persisted so the sticky summary panel reflects jobs.requirements.
  intakeMessage: sponsorProcedure
    .input(IntakeMessageInput)
    .output(IntakeMessageOutput)
    .mutation(async ({ ctx, input }) => {
      const [j] = await getDb()
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, input.jobId), eq(jobs.orgId, ctx.principal.orgId)))
        .limit(1);
      if (!j) throw new TRPCError({ code: 'NOT_FOUND', message: 'job' });

      const extraction = await runAgent('concierge', {
        system: CONCIERGE_PROMPT,
        messages: [
          {
            role: 'user',
            content:
              `Role title: ${j.title}\n` +
              `Current requirements: ${JSON.stringify(j.requirements ?? {})}\n` +
              `Sponsor says: ${input.message}\n\n` +
              'Extract the structured role (requirements, comp range, open questions).',
          },
        ],
        maxTokens: 700,
      }, { schema: IntakeExtraction, inputRef: `intake:${j.id}` });

      const ext = extraction.output;
      const merged: JobRequirements = {
        ...(j.requirements ?? { mustHaves: [], niceToHaves: [], skills: [] }),
        ...ext.requirements,
      };

      // Deterministic policy guard — runs on every extraction.
      const guard = validateIntakeRequirements(merged);
      let refusal: string | null = null;
      if (!guard.ok) {
        refusal = guard.refusalCopy;
        // File the policy_refusal exception for ops.
        await getDb()
          .insert(exceptions)
          .values({
            category: 'policy_refusal',
            agent: 'concierge',
            context: {
              agent: 'Concierge',
              quote: `Intake filter declined: ${guard.violations
                .map((v) => v.matched)
                .join(', ')}. ${guard.violations[0]?.note ?? ''}`.trim(),
              category: 'policy_refusal',
              refs: { jobId: j.id },
            },
            recommendation:
              'Approve the drafted decline and the lawful alternative (a rubric scored from the screen).',
            status: 'open',
          });
      }

      const compRange = ext.compRange ?? (j.compRange.max > 0 ? j.compRange : null);

      // Persist the updated requirements + comp (do NOT persist the offending
      // filter when refused — keep the job requirements clean).
      if (!refusal) {
        await getDb()
          .update(jobs)
          .set({
            requirements: merged,
            compRange: compRange ?? j.compRange,
          })
          .where(eq(jobs.id, j.id));
      }

      const summaryRows = buildSummaryRows(
        j.title,
        refusal ? j.requirements ?? null : merged,
        compRange,
        j.calibration ?? null,
        ext.openQuestions,
      );

      // Compose the Concierge reply from the extraction (single call, cheap).
      let reply: string;
      if (refusal) {
        reply =
          'I can not apply that filter. Filters that proxy protected classes are declined at intake, by policy. I can score the specific, job-related behavior you mean from the screen instead.';
      } else {
        const parts: string[] = [`Read it. Extraction: ${ext.title}`];
        if (merged.locations?.length) parts.push(merged.locations.join(' or '));
        if (compRange) parts.push(formatCompRange(compRange));
        reply = parts.join(' · ') + '.';
        if (merged.mustHaves.length)
          reply += ` Must-haves: ${merged.mustHaves.join(' · ')}.`;
        if (ext.openQuestions.length) reply += ` ${ext.openQuestions[0]}`;
        else
          reply +=
            ' The summary on the right is final. Confirm it and your 72-hour clock starts.';
      }

      return {
        jobId: j.id,
        reply,
        requirements: refusal ? j.requirements ?? merged : merged,
        summaryRows,
        openQuestions: ext.openQuestions,
        compRange,
        refusal,
        canConfirm: Boolean(compRange) && !refusal,
      };
    }),

  // POST /jobs/:id/confirm — starts the 72h clock and enqueues matching.
  confirmJob: sponsorProcedure
    .input(ConfirmJobInput)
    .output(ConfirmJobOutput)
    .mutation(async ({ ctx, input }) => {
      const [j] = await getDb()
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, input.jobId), eq(jobs.orgId, ctx.principal.orgId)))
        .limit(1);
      if (!j) throw new TRPCError({ code: 'NOT_FOUND', message: 'job' });

      // Re-assert the policy guard at the gate (never confirm a refused filter).
      const guard = validateIntakeRequirements(input.requirements);
      if (!guard.ok) {
        await getDb()
          .insert(exceptions)
          .values({
            category: 'policy_refusal',
            agent: 'concierge',
            context: {
              agent: 'Concierge',
              quote: `Confirm blocked: ${guard.violations
                .map((v) => v.matched)
                .join(', ')}`,
              category: 'policy_refusal',
              refs: { jobId: j.id },
            },
            recommendation: 'Approve the drafted decline; do not confirm this filter.',
            status: 'open',
          });
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: INTAKE_REFUSAL_COPY,
        });
      }

      const now = new Date();
      const slaDueAt = new Date(now.getTime() + SLA_HOURS * 3_600_000);

      await getDb()
        .update(jobs)
        .set({
          status: 'confirmed',
          requirements: input.requirements,
          compRange: input.compRange,
          confirmedAt: now,
          slaDueAt,
        })
        .where(eq(jobs.id, j.id));

      // Enqueue the recruiter matching run (mirror of the synthesis bridge).
      try {
        await enqueueMatching(j.id);
      } catch {
        // Redis unavailable in some demo envs — the confirm still stands; the
        // integrator's matching bridge/worker picks it up when reachable.
      }

      return { jobId: j.id, status: 'confirmed', slaDueAt: slaDueAt.toISOString() };
    }),

  // GET /shortlists/:id
  shortlist: sponsorProcedure
    .input(z.object({ shortlistId: z.string().uuid() }))
    .output(ShortlistOutput)
    .query(async ({ ctx, input }) => {
      const { orgId } = ctx.principal;
      const [sl] = await getDb()
        .select({ shortlist: shortlists, job: jobs })
        .from(shortlists)
        .innerJoin(jobs, eq(jobs.id, shortlists.jobId))
        .where(
          and(
            eq(shortlists.id, input.shortlistId),
            eq(jobs.orgId, orgId),
            // Human gate: undelivered slates are ops-only.
            eq(shortlists.status, 'delivered'),
          ),
        )
        .limit(1);
      if (!sl) throw new TRPCError({ code: 'NOT_FOUND', message: 'shortlist' });

      const entries = await getDb()
        .select()
        .from(shortlistEntries)
        .where(eq(shortlistEntries.shortlistId, input.shortlistId))
        .orderBy(shortlistEntries.rank);

      const visible = await visibleStudents(entries.map((e) => e.studentId));

      const candidates: CandidateCard[] = entries.map((e) => {
        const v = visible.get(e.studentId);
        // match_only without granted reveal → anonymize identity. A student
        // absent from the visibility view (paused / unpublished since
        // delivery) is redacted the same way — identity never leaks past the
        // view, even on an already-delivered shortlist.
        const anonymized =
          (e.kind === 'match_only' && e.revealConsent !== 'granted') || !v;
        return {
          entryId: e.id,
          studentId: anonymized ? null : e.studentId,
          rank: e.rank,
          name: anonymized ? 'Match-only candidate' : v.name,
          anonymized,
          avatarColor: anonymized ? '#c7d2dc' : '#063f58',
          kind: e.kind,
          fit: e.fit,
          rationale: e.rationale ?? '',
          evidenceChips: e.evidenceChips ?? [],
          status: e.status,
          passReason: e.passReason,
          revealConsent: e.revealConsent,
          ssoVerified: !anonymized,
        };
      });

      // One 'shortlist' view ledger event per (student, delivery), deduped so
      // repeated loads never spam the ledger.
      const studentIds = entries
        .filter(
          (e) =>
            visible.has(e.studentId) &&
            !(e.kind === 'match_only' && e.revealConsent !== 'granted'),
        )
        .map((e) => e.studentId);
      if (studentIds.length) {
        const sql = rawSql();
        const existing = (await sql`
          SELECT DISTINCT student_id FROM ledger_events
          WHERE kind = 'shortlist'
            AND detail->>'shortlistId' = ${input.shortlistId}
            AND student_id IN ${sql(studentIds)}
        `) as unknown as { student_id: string }[];
        const have = new Set(existing.map((r) => r.student_id));
        const missing = entries.filter(
          (e) =>
            studentIds.includes(e.studentId) && !have.has(e.studentId),
        );
        for (const e of missing) {
          await writeLedgerEvent({
            studentId: e.studentId,
            actorKind: 'sponsor',
            actorId: orgId,
            kind: 'shortlist',
            detail: {
              kind: 'shortlist',
              jobId: sl.job.id,
              shortlistId: input.shortlistId,
              rank: e.rank,
              note: `Included in a shortlist: ${sl.job.title}`,
            },
            license: LICENSE,
          });
        }
      }

      const funnelBlob = await readConfig<{
        funnel?: ShortlistFunnel;
      }>('sponsor.scogle_dashboard');
      const seededFunnel = funnelBlob?.funnel ?? {
        screened: 62,
        deepEvaluated: 27,
        answeredFollowup: 9,
      };
      // 'answered your follow-up' is real: entries the student has answered
      // (async_answer set). Fall back to the seeded pool note only when zero.
      const answeredFollowupCount = entries.filter(
        (e) => e.asyncAnswer != null,
      ).length;
      const funnel: ShortlistFunnel = {
        ...seededFunnel,
        answeredFollowup:
          answeredFollowupCount > 0
            ? answeredFollowupCount
            : seededFunnel.answeredFollowup,
      };

      const shortfallNote =
        candidates.length < 10
          ? 'When fewer than ten clear the bar, you get fewer than ten with a note. Padding is how trust dies, so we do not.'
          : null;

      return {
        shortlistId: sl.shortlist.id,
        jobId: sl.job.id,
        jobTitle: sl.job.title,
        status: sl.shortlist.status,
        slaEyebrow: 'Shortlist · delivered in 41h of the 72h SLA',
        funnel,
        candidates,
        shortfallNote,
      };
    }),

  // POST /entries/:id/intro | pass | save
  entryAction: sponsorProcedure
    .input(EntryActionInput)
    .output(EntryActionOutput)
    .mutation(async ({ ctx, input }) => {
      const found = await entryInOrg(input.entryId, ctx.principal.orgId);
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'entry' });
      const { entry } = found;

      if (input.action === 'intro') {
        await getDb()
          .update(shortlistEntries)
          .set({ status: 'intro' })
          .where(eq(shortlistEntries.id, entry.id));
        // The domain event is an outcome row (there is no ledger 'intro' kind).
        await getDb()
          .insert(outcomes)
          .values({ entryId: entry.id, stage: 'intro', loggedBy: ctx.principal.userId });
        return { entryId: entry.id, status: 'intro' };
      }

      if (input.action === 'pass') {
        if (!input.passReason)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A pass always requires a reason.',
          });
        const reasonLabel = PASS_REASON_LABEL[input.passReason];
        await getDb()
          .update(shortlistEntries)
          .set({ status: 'passed', passReason: reasonLabel })
          .where(eq(shortlistEntries.id, entry.id));

        // Feed jobs.calibration — increment the matching reason count.
        const [j] = await getDb()
          .select({ id: jobs.id, calibration: jobs.calibration })
          .from(jobs)
          .innerJoin(shortlists, eq(shortlists.jobId, jobs.id))
          .where(eq(shortlists.id, entry.shortlistId))
          .limit(1);
        if (j) {
          const cal: Calibration = j.calibration ?? { passReasons: [] };
          const list = cal.passReasons.slice();
          const idx = list.findIndex((p) => p.reason === reasonLabel);
          if (idx >= 0) list[idx] = { reason: reasonLabel, count: list[idx]!.count + 1 };
          else list.push({ reason: reasonLabel, count: 1 });
          await getDb()
            .update(jobs)
            .set({ calibration: { ...cal, passReasons: list } })
            .where(eq(jobs.id, j.id));
        }
        return { entryId: entry.id, status: 'passed' };
      }

      // save
      await getDb()
        .update(shortlistEntries)
        .set({ status: 'saved' })
        .where(eq(shortlistEntries.id, entry.id));
      return { entryId: entry.id, status: 'saved' };
    }),

  // GET /dossiers/:entryId
  dossier: sponsorProcedure
    .input(z.object({ entryId: z.string().uuid() }))
    .output(DossierViewOutput)
    .query(async ({ ctx, input }) => {
      const { orgId } = ctx.principal;
      const rows = await getDb()
        .select({ entry: shortlistEntries, job: jobs })
        .from(shortlistEntries)
        .innerJoin(shortlists, eq(shortlists.id, shortlistEntries.shortlistId))
        .innerJoin(jobs, eq(jobs.id, shortlists.jobId))
        .where(
          and(eq(shortlistEntries.id, input.entryId), eq(jobs.orgId, orgId)),
        )
        .limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'dossier' });
      const { entry, job } = row;

      const visible = await visibleStudents([entry.studentId]);
      const v = visible.get(entry.studentId);
      if (!v) throw new TRPCError({ code: 'NOT_FOUND', message: 'not visible' });

      // Reveal gate: a match_only student without granted consent is not shown.
      if (v.reveal_required && entry.revealConsent !== 'granted') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Awaiting reveal consent',
        });
      }

      // Dossier body (competency / flags / followups) from the approved dossier.
      const [dossierRow] = await getDb()
        .select({
          competency: dossiersTable.competency,
          flags: dossiersTable.flags,
          followups: dossiersTable.followups,
        })
        .from(dossiersTable)
        .where(eq(dossiersTable.screenId, v.screen_id))
        .limit(1);

      // Stories for the Evidence tab.
      const stories = await getDb()
        .select()
        .from(experienceStoriesTable)
        .where(eq(experienceStoriesTable.studentId, entry.studentId));

      // Screen clips — visible, un-struck moments that carry a streamable clip.
      const moments = await getDb()
        .select()
        .from(screenMoments)
        .where(eq(screenMoments.screenId, v.screen_id))
        .orderBy(screenMoments.tStartMs);
      const [screenRow] = await getDb()
        .select({ transcript: screens.transcript })
        .from(screens)
        .where(eq(screens.id, v.screen_id))
        .limit(1);
      const transcript = screenRow?.transcript ?? [];

      const clips = moments
        .filter((m) => m.studentVisible && !m.struck && m.clipKey)
        .map((m) => {
          const words = transcript
            .filter((w) => w.t0 >= m.tStartMs && w.t0 < m.tEndMs)
            .map((w) => w.word);
          const quote = words.length ? words.join(' ') : m.quote;
          return {
            momentId: m.id,
            tag: m.tag,
            startMs: m.tStartMs,
            endMs: m.tEndMs,
            durationMs: m.tEndMs - m.tStartMs,
            quote,
            repNote: m.repNote,
            streamPath: `/api/stream/${m.id}`,
          };
        });

      // Logistics rows (self-declared; location mismatches flagged in prose).
      const logistics: LogisticsChip[] = [];
      if (v.grad_date) {
        logistics.push({
          label: 'Graduation',
          value: `${monthYear(v.grad_date)}${v.program ? ` · ${v.program}` : ''}`,
          tone: 'neutral',
        });
      }
      logistics.push({
        label: 'Looking for',
        value: 'Internships and new grad · open to startups',
        tone: 'neutral',
      });
      const studentLocs = v.locations ?? [];
      const jobLocs = job.requirements?.locations ?? [];
      const missingLocs = jobLocs.filter((l) => !studentLocs.includes(l));
      let locValue = studentLocs.join(' or ');
      if (missingLocs.length)
        locValue += `. ${missingLocs.join(', ')} not listed; flagged for your intro call.`;
      logistics.push({
        label: 'Locations',
        value: locValue || 'Not specified',
        tone: missingLocs.length ? 'warn' : 'neutral',
      });
      logistics.push({
        label: 'Work authorization',
        value: v.work_auth?.note ?? 'Self-declared, shown exactly as entered.',
        tone: 'neutral',
      });
      logistics.push({
        label: 'Freshness',
        value: v.last_verified_at
          ? `Profile verified ${monthDay(v.last_verified_at)} · screen completed`
          : 'Recently refreshed',
        tone: 'neutral',
      });

      const identity: Identity = {
        studentId: entry.studentId,
        name: v.name,
        andrewId: v.andrew_id,
        program: v.program,
        gradDate: v.grad_date ? toDate(v.grad_date).toISOString() : null,
        kind: v.kind,
        avatarColor: '#063f58',
        ssoVerified: true,
      };

      // Async follow-up: the recruiter's question + the student's answer, if
      // any. The question shows even before an answer (Awaiting reply); once
      // answered, the audio streams via /api/stream/answer/:entryId (never a
      // durable URL) or the typed text renders inline.
      const answer = entry.asyncAnswer ?? null;
      const hasFollowUp = answer !== null || job.title.startsWith('SWE Intern');
      const followUp: AsyncFollowUp | null = hasFollowUp
        ? {
            question: answer?.question ?? ASYNC_QUESTION_TEXT,
            answered: answer !== null,
            answeredAt: answer?.answeredAt ?? null,
            text: answer?.text ?? null,
            audio: answer?.audioKey
              ? {
                  streamPath: `/api/stream/answer/${entry.id}`,
                  tag: 'Recorded answer to your follow-up',
                }
              : null,
          }
        : null;

      // Full player experience only where audio clips exist (June, rank 1);
      // others render the scope note (production supplies full for all).
      const hasFull = clips.length > 0;

      // Every dossier open writes a 'view' ledger event.
      await writeLedgerEvent({
        studentId: entry.studentId,
        actorKind: 'sponsor',
        actorId: orgId,
        kind: 'view',
        detail: { kind: 'view', surface: 'dossier' },
        license: LICENSE,
      });

      return {
        entryId: entry.id,
        student: identity,
        rank: entry.rank,
        fit: entry.fit,
        rationale: entry.rationale ?? '',
        competency: dossierRow?.competency ?? [],
        flags: dossierRow?.flags ?? { green: [], probe: [] },
        followups: dossierRow?.followups ?? [],
        followUp,
        stories: stories.map((s) => ({
          id: s.id,
          title: s.title,
          situation: s.situation,
          contribution: s.contribution,
          outcome: s.outcome,
          // experience_stories has no provenance column; a still-open outcome is
          // the Verifier's "pending" signal (matches the design's Meridian card).
          provenance: (s.outcome === null ? 'pending' : 'verified') as
            | 'pending'
            | 'verified',
        })),
        clips,
        logistics,
        workAuth: v.work_auth
          ? {
              status: v.work_auth.status as never,
              needsSponsorship: v.work_auth.needsSponsorship,
              note: v.work_auth.note,
            }
          : { status: 'other', needsSponsorship: false },
        scopeNote: hasFull ? null : SCOPE_NOTE,
      };
    }),

  // POST /outcomes
  logOutcome: sponsorProcedure
    .input(LogOutcomeInput)
    .output(LogOutcomeOutput)
    .mutation(async ({ ctx, input }) => {
      const found = await entryInOrg(input.entryId, ctx.principal.orgId);
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'entry' });
      const [row] = await getDb()
        .insert(outcomes)
        .values({
          entryId: input.entryId,
          stage: input.stage,
          loggedBy: ctx.principal.userId,
        })
        .returning({ id: outcomes.id });
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return { outcomeId: row.id, entryId: input.entryId, stage: input.stage };
    }),

  // POST /shortlists/:id/recalibrate — v1: store the note on jobs.calibration
  // and file an ops exception to rerun the shortlist within the same SLA.
  recalibrate: sponsorProcedure
    .input(z.object({ shortlistId: z.string().uuid(), note: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await getDb()
        .select({ job: jobs })
        .from(shortlists)
        .innerJoin(jobs, eq(jobs.id, shortlists.jobId))
        .where(
          and(
            eq(shortlists.id, input.shortlistId),
            eq(jobs.orgId, ctx.principal.orgId),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'shortlist' });
      const cal: Calibration = row.job.calibration ?? { passReasons: [] };
      const notes = [cal.notes, input.note].filter(Boolean).join(' · ');
      await getDb()
        .update(jobs)
        .set({ calibration: { ...cal, notes } })
        .where(eq(jobs.id, row.job.id));
      // File the ops exception the operator approves to trigger the rerun.
      await getDb()
        .insert(exceptions)
        .values({
          category: 'low_confidence_shortlist',
          agent: 'recruiter',
          context: {
            agent: 'Recruiter',
            title: 'Sponsor recalibration: rerun requested',
            quote: input.note,
            category: 'low_confidence_shortlist',
            refs: { jobId: row.job.id, shortlistId: input.shortlistId },
          },
          recommendation:
            'Re-run the shortlist with the sponsor calibration applied.',
          status: 'open',
        });
      // Trust rule: the sponsor's calibration edit lands in the ledger.
      await writeLedgerEvent({
        actorKind: 'sponsor',
        actorId: ctx.principal.orgId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: 'calibration',
          note: `Sponsor recalibration requested: ${input.note}`,
        },
        license: LICENSE,
      });
      return { ok: true as const };
    }),

  // POST /concierge/messages — grounded on the licensed-scope digest so replies
  // stay inside the sponsor's roles + delivered shortlists (never hidden data).
  conciergeMessage: sponsorProcedure
    .input(ConciergeMessageInput)
    .output(ConciergeMessageOutput)
    .mutation(async ({ ctx, input }) => {
      const digest = await buildConciergeDigest(ctx.principal.orgId);
      const history = (input.history ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const result = await runAgent(
        'concierge',
        {
          system: `${CONCIERGE_PROMPT}\n\n${digest}`,
          messages: [...history, { role: 'user', content: input.message }],
          // Headroom for adaptive-thinking models: reasoning tokens must not
          // starve the JSON body (a tight cap yields empty content).
          maxTokens: 1500,
        },
        { schema: ConciergeReply, inputRef: 'concierge:sponsor' },
      );
      const r = result.output;
      return { reply: r.reply, suggestions: r.suggestions, refs: r.refs };
    }),
});

const PASS_REASON_LABEL: Record<
  NonNullable<z.infer<typeof EntryActionInput>['passReason']>,
  string
> = {
  too_junior: 'Too junior for this req',
  missing_must_have: 'Missing a must-have',
  overlaps_existing_hire: 'Overlaps an existing hire',
  other: 'Other',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;
// Raw-SQL view rows (sponsor_visible_students) return `date` columns as
// strings; drizzle-mapped rows return Date. Accept both.
function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}
function monthYear(raw: Date | string): string {
  const d = toDate(raw);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function monthDay(raw: Date | string): string {
  const d = toDate(raw);
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
