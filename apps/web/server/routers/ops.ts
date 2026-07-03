// Ops router — ARCHITECTURE section 7 (Ops) + the ops-console screen. Real
// implementation. Scoped to operator principals only (opsProcedure). Data comes
// from the seeded dev DB: the `exceptions` queue, `agent_runs` aggregates, and
// the operational rollup blobs in `config` (ops.week_stats, ops.agent_workforce)
// that the design prototype renders verbatim.

import { z } from 'zod';
import {
  AgentsOutput,
  ExceptionsOutput,
  ResolveExceptionInput,
  ResolveExceptionOutput,
  SamplerOutput,
  UpdateConfigInput,
  UpdateConfigOutput,
  agentNameValues,
} from '@tartan/types';
import type {
  AgentName,
  ExceptionCategory,
  ExceptionContext,
} from '@tartan/types';
import {
  agentRuns,
  and,
  asc,
  config,
  eq,
  exceptions,
  gte,
  isNotNull,
  jobs,
  shortlists,
  sql,
} from '@tartan/db';
import { TRPCError } from '@trpc/server';
import { router, opsProcedure } from '../trpc';
import { writeLedgerEvent } from '@/lib/ledger';
import { enqueueLedgerFanout, enqueueMatching } from '@/lib/redis';

// ── category → label + tone (exact design mapping) ──────────────────────────
const CATEGORY_LABEL: Record<ExceptionCategory, string> = {
  verification_conflict: 'Verification conflict',
  low_confidence_shortlist: 'Low-confidence shortlist',
  policy_refusal: 'Policy refusal',
  sla_risk: 'SLA risk',
  student_report: 'Student report',
  consent_edge: 'Consent edge',
};
const CATEGORY_TONE: Record<ExceptionCategory, 'amber' | 'blue' | 'red' | 'gray'> = {
  verification_conflict: 'amber',
  low_confidence_shortlist: 'blue',
  policy_refusal: 'red',
  sla_risk: 'amber',
  student_report: 'gray',
  consent_edge: 'red',
};

// ── resolve action → new status + resolution label ──────────────────────────
const ACTION_STATUS = {
  approve: 'approved',
  override: 'overridden',
  escalate: 'escalated',
} as const;

// ── ISO week math (Monday 00:00 UTC boundaries) ──────────────────────────────
// Live week stats are bucketed by ISO week. `weekStart` is the Monday that opens
// the current week; `prevWeekStart` opens the one before (for trend arrows).
function isoWeekStart(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0=Sun … 6=Sat
  const shiftToMonday = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + shiftToMonday);
  return date;
}

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;
function fmtStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}, ${hh}:${mm}`;
}

// The sidebar workforce rows are display labels; map each to the AgentName enum
// so live agent_runs signals can drive its status dot. Rows with no mapping keep
// their configured dot untouched.
const WORKFORCE_AGENT: Record<string, AgentName> = {
  'Talent Rep': 'rep',
  'Profile Synthesizer': 'synthesizer',
  Verifier: 'verifier',
  Recruiter: 'recruiter',
  Concierge: 'concierge',
  'Ops Sentinel': 'sentinel',
};
const DOT_RED = '#d72444'; // flagged rate over 10%
const DOT_AMBER = '#e8b13a'; // idle 7+ days

// ── sidebar payloads (config-driven, verbatim from the seed / prototype) ─────
// The config blob carries the governance columns (name, note, eval, aut, dot);
// the live signals are layered on top by the resolver.
const WorkforceConfigRow = z.object({
  name: z.string(),
  note: z.string(),
  eval: z.string(),
  aut: z.string(),
  dot: z.string(),
});
const WorkforceRow = WorkforceConfigRow.extend({
  // Live agent_runs signals (null/0 when the agent has no runs yet).
  lastRunAt: z.string().nullable().optional(),
  runsThisWeek: z.number().int().nonnegative().optional(),
  flaggedRate: z.number().min(0).max(1).optional(),
});
const WeekStat = z.object({
  label: z.string(),
  value: z.string(),
  color: z.string(),
});
const SidebarOutput = z.object({
  week: z.string(),
  digestSent: z.string(),
  medianResolveMin: z.number(),
  stats: z.array(WeekStat),
  adverseImpact: z.object({ body: z.string(), meta: z.string() }),
  workforce: z.array(WorkforceRow),
});

export const opsRouter = router({
  // GET /ops/exceptions — the queue (open cards + resolved rows), fixed order.
  exceptions: opsProcedure.output(ExceptionsOutput).query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(exceptions)
      .orderBy(asc(exceptions.createdAt), asc(exceptions.id));

    const cards = rows.map((r) => {
      const context = (r.context ?? {}) as ExceptionContext;
      const category = r.category as ExceptionCategory;
      return {
        id: r.id,
        category,
        categoryLabel: CATEGORY_LABEL[category],
        categoryTone: CATEGORY_TONE[category],
        agent: (r.agent ?? 'sentinel') as AgentName,
        title: context.title ?? (context.quote ?? '').slice(0, 96),
        quote: context.quote ?? '',
        recommendation: r.recommendation ?? '',
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        resolvedBy: r.resolvedBy,
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      };
    });

    return {
      openCount: cards.filter((c) => c.status === 'open').length,
      exceptions: cards,
    };
  }),

  // POST /ops/exceptions/:id/{approve,override,escalate}
  resolveException: opsProcedure
    .input(ResolveExceptionInput)
    .output(ResolveExceptionOutput)
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(exceptions)
        .where(eq(exceptions.id, input.exceptionId))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Exception not found' });
      }
      if (existing.status !== 'open') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Exception already resolved',
        });
      }

      const status = ACTION_STATUS[input.action];
      const prevContext = (existing.context ?? {}) as ExceptionContext;
      // The one-line override note is stored back into the context blob.
      const nextContext = input.note
        ? ({ ...prevContext, note: input.note } as ExceptionContext)
        : prevContext;

      const [updated] = await ctx.db
        .update(exceptions)
        .set({
          status,
          resolvedBy: ctx.principal.userId,
          resolvedAt: new Date(),
          context: nextContext,
        })
        .where(
          and(eq(exceptions.id, input.exceptionId), eq(exceptions.status, 'open')),
        )
        .returning({ id: exceptions.id, status: exceptions.status });

      if (!updated) {
        // Lost a race: another operator resolved it between select and update.
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Exception already resolved',
        });
      }

      // Approving a low-confidence-shortlist exception closes one of two loops:
      //  • a sponsor recalibration rerun request → re-enqueue matching for the job
      //    so the recruiter reassembles the slate with the new calibration note;
      //  • otherwise release the human gate → flip the referenced shortlist
      //    human_gate → delivered and fan out the ledger so every placed
      //    candidate gets their shortlist event.
      const shortlistId = prevContext.refs?.shortlistId;
      const jobId = prevContext.refs?.jobId;
      const effectiveTitle = prevContext.title ?? prevContext.quote ?? '';
      const isRecalibrationRerun = /recalibrat|rerun/i.test(effectiveTitle);

      if (
        input.action === 'approve' &&
        existing.category === 'low_confidence_shortlist'
      ) {
        if (isRecalibrationRerun && jobId) {
          try {
            await enqueueMatching(jobId);
          } catch {
            // best-effort: dev has Redis; never crash the resolution on enqueue.
          }
        } else if (shortlistId) {
          const [gated] = await ctx.db
            .update(shortlists)
            .set({ status: 'delivered' })
            .where(
              and(
                eq(shortlists.id, shortlistId),
                eq(shortlists.status, 'human_gate'),
              ),
            )
            .returning({ id: shortlists.id });

          if (gated) {
            try {
              await enqueueLedgerFanout({ shortlistId });
            } catch {
              // best-effort: the fanout worker also runs on a periodic sweep.
            }
          }
        }
      }

      // Every resolution lands in the ledger (append-only). Subject is the
      // referenced student when the exception carries one.
      await writeLedgerEvent({
        studentId: prevContext.refs?.studentId ?? null,
        actorKind: 'system',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: {
          kind: 'edit',
          field: `exception.${input.action}`,
          ...(input.note ? { note: input.note } : {}),
        },
      });

      return { exceptionId: updated.id, status: updated.status };
    }),

  // GET /ops/sidebar — the sticky sidebar rollups (week stats + workforce). The
  // config blobs the seed maintains are the layout + fallback; every number the
  // schema can derive is computed live here (exact layout/typography preserved).
  sidebar: opsProcedure.output(SidebarOutput).query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(config);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    const week = WeekStatsBlob.safeParse(byKey.get('ops.week_stats'));
    const workforceCfg = z
      .array(WorkforceConfigRow)
      .safeParse(byKey.get('ops.agent_workforce'));

    if (!week.success) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'ops.week_stats config missing or malformed',
      });
    }

    // ── ISO week boundaries ────────────────────────────────────────────────
    const now = new Date();
    const weekStart = isoWeekStart(now);
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setUTCDate(prevWeekStart.getUTCDate() - 7);
    // postgres.js cannot bind a raw Date inside a sql`` template (only drizzle's
    // typed column helpers encode Dates); pass ISO strings into raw fragments.
    const weekStartIso = weekStart.toISOString();
    const prevWeekStartIso = prevWeekStart.toISOString();

    // ── live aggregates (all bucketed by created_at into the ISO week) ─────
    const [exCounts] = await ctx.db
      .select({
        thisWeek: sql<number>`count(*) filter (where ${exceptions.createdAt} >= ${weekStartIso})::int`,
        prevWeek: sql<number>`count(*) filter (where ${exceptions.createdAt} >= ${prevWeekStartIso} and ${exceptions.createdAt} < ${weekStartIso})::int`,
      })
      .from(exceptions);

    const [runCounts] = await ctx.db
      .select({
        thisWeek: sql<number>`count(*) filter (where ${agentRuns.createdAt} >= ${weekStartIso})::int`,
        prevWeek: sql<number>`count(*) filter (where ${agentRuns.createdAt} >= ${prevWeekStartIso} and ${agentRuns.createdAt} < ${weekStartIso})::int`,
      })
      .from(agentRuns);

    // Cost per screen: sum of cost on screen-scoped runs / distinct screens.
    const [screenAgg] = await ctx.db
      .select({
        cost: sql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float8`,
        screens: sql<number>`count(distinct split_part(${agentRuns.inputRef}, ':', 2))::int`,
      })
      .from(agentRuns)
      .where(
        and(
          gte(agentRuns.createdAt, weekStart),
          sql`${agentRuns.inputRef} like 'screen:%'`,
        ),
      );

    // Median resolution minutes over exceptions resolved this week.
    const [medianRow] = await ctx.db
      .select({
        median: sql<
          number | null
        >`percentile_cont(0.5) within group (order by extract(epoch from (${exceptions.resolvedAt} - ${exceptions.createdAt})) / 60.0)::float8`,
      })
      .from(exceptions)
      .where(
        and(
          isNotNull(exceptions.resolvedAt),
          gte(exceptions.resolvedAt, weekStart),
          // Only valid durations — a resolution never precedes its creation.
          sql`${exceptions.resolvedAt} >= ${exceptions.createdAt}`,
        ),
      );

    // Per-agent live signals for the workforce status dots.
    const signalRows = await ctx.db
      .select({
        agent: agentRuns.agent,
        lastRunAt: sql<string | Date | null>`max(${agentRuns.createdAt})`,
        runsThisWeek: sql<number>`count(*) filter (where ${agentRuns.createdAt} >= ${weekStartIso})::int`,
        flaggedThisWeek: sql<number>`count(*) filter (where ${agentRuns.createdAt} >= ${weekStartIso} and ${agentRuns.flagged})::int`,
      })
      .from(agentRuns)
      .groupBy(agentRuns.agent);
    const signalByAgent = new Map(signalRows.map((s) => [s.agent, s]));

    // ── week stats: override only where a live number exists ───────────────
    const runsThisWeek = runCounts?.thisWeek ?? 0;
    const stats = week.data.stats.map((s) => {
      if (s.label === 'Exceptions per 100 agent runs' && runsThisWeek > 0) {
        const per100 = ((exCounts?.thisWeek ?? 0) / runsThisWeek) * 100;
        const prevRuns = runCounts?.prevWeek ?? 0;
        const prevPer100 =
          prevRuns > 0 ? ((exCounts?.prevWeek ?? 0) / prevRuns) * 100 : null;
        const arrow =
          prevPer100 === null
            ? ''
            : per100 < prevPer100
              ? ' ↓'
              : per100 > prevPer100
                ? ' ↑'
                : '';
        return { ...s, value: `${per100.toFixed(1)}${arrow}` };
      }
      if (
        s.label === 'Cost per completed screen' &&
        (screenAgg?.screens ?? 0) > 0
      ) {
        const perScreen = (screenAgg?.cost ?? 0) / (screenAgg?.screens ?? 1);
        return { ...s, value: `$${perScreen.toFixed(2)}` };
      }
      // Operator hours and the remaining rows stay reported (config value).
      return s;
    });

    const medianResolveMin =
      medianRow?.median != null
        ? Math.round(medianRow.median * 10) / 10
        : week.data.medianResolveMin;

    // ── workforce: augment config rows with live signals + status dots ─────
    const workforce = (workforceCfg.success ? workforceCfg.data : []).map(
      (row) => {
        const agent = WORKFORCE_AGENT[row.name];
        const sig = agent ? signalByAgent.get(agent) : undefined;
        if (!sig) return row;

        const runs = sig.runsThisWeek;
        const flaggedRate = runs > 0 ? sig.flaggedThisWeek / runs : 0;
        const lastRun = sig.lastRunAt ? new Date(sig.lastRunAt) : null;
        const idleMs = lastRun ? now.getTime() - lastRun.getTime() : Infinity;
        const idle7d = idleMs >= 7 * 24 * 60 * 60 * 1000;

        let dot = row.dot; // configured governance dot is the fallback
        if (runs > 0 && flaggedRate > 0.1) dot = DOT_RED;
        else if (idle7d) dot = DOT_AMBER;

        return {
          ...row,
          dot,
          lastRunAt: lastRun ? lastRun.toISOString() : null,
          runsThisWeek: runs,
          flaggedRate,
        };
      },
    );

    // ── adverse-impact card: live rollup (workers, weekly) → static fallback
    const adverseImpact = adverseImpactCard(
      byKey.get('ops.adverse_impact'),
      week.data.adverseImpact,
    );

    return {
      week: week.data.week,
      digestSent: week.data.digestSent,
      medianResolveMin,
      stats,
      adverseImpact,
      workforce,
    };
  }),

  // GET /ops/agents — structured agent-workforce health (agent_runs aggregates
  // over the last 7 days + autonomy levels from config). The pixel-exact sidebar
  // list is served by `sidebar`; this is the typed health contract.
  agents: opsProcedure.output(AgentsOutput).query(async ({ ctx }) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const grouped = await ctx.db
      .select({
        agent: agentRuns.agent,
        runs: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float8`,
        flagged: sql<number>`sum(case when ${agentRuns.flagged} then 1 else 0 end)::int`,
      })
      .from(agentRuns)
      .where(gte(agentRuns.createdAt, since))
      .groupBy(agentRuns.agent);
    const byAgent = new Map(grouped.map((g) => [g.agent, g]));

    const configRows = await ctx.db
      .select()
      .from(config)
      .where(eq(config.key, 'autonomy'));
    const autonomy = AutonomyBlob.safeParse(configRows[0]?.value);
    const autonomyOf = (a: AgentName): 'A' | 'B' | 'C' =>
      (autonomy.success ? autonomy.data[a] : undefined) ?? 'C';

    const week = (
      await ctx.db.select().from(config).where(eq(config.key, 'ops.week_stats'))
    )[0]?.value;
    const weekParsed = WeekStatsBlob.safeParse(week);
    const num = (s: string | undefined): number => {
      const m = s?.match(/-?\d+(\.\d+)?/);
      return m ? parseFloat(m[0]) : 0;
    };
    const findStat = (label: string): string | undefined =>
      weekParsed.success
        ? weekParsed.data.stats.find((s) => s.label === label)?.value
        : undefined;

    return {
      agents: agentNameValues.map((a) => {
        const g = byAgent.get(a);
        const runs = g?.runs ?? 0;
        const flaggedRate = runs > 0 ? (g?.flagged ?? 0) / runs : 0;
        return {
          agent: a,
          evalScore: null,
          autonomy: autonomyOf(a),
          // Live health: a flagged rate over 10% reads as degraded (same gate
          // that turns the sidebar dot red). Eval + autonomy stay governance.
          status: (flaggedRate > 0.1 ? 'degraded' : 'healthy') as
            | 'healthy'
            | 'degraded'
            | 'paused',
          runs7d: runs,
          costUsd7d: g?.cost ?? 0,
          flaggedRate,
        };
      }),
      weekly: {
        exceptionsPer100Runs: num(findStat('Exceptions per 100 agent runs')),
        exceptionsTrend: (findStat('Exceptions per 100 agent runs')?.includes('↓')
          ? 'down'
          : 'flat') as 'up' | 'down' | 'flat',
        operatorHours: num(findStat('Operator hours logged')),
        costPerScreen: num(findStat('Cost per completed screen')),
      },
    };
  }),

  // GET /ops/sampler/:shortlistId — adverse-impact rollup (phase 2 surface;
  // returns the calibration + a scoped note, no protected-class attributes).
  sampler: opsProcedure
    .input(z.object({ shortlistId: z.string().uuid() }))
    .output(SamplerOutput)
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          shortlistId: shortlists.id,
          jobTitle: jobs.title,
          calibration: jobs.calibration,
        })
        .from(shortlists)
        .innerJoin(jobs, eq(shortlists.jobId, jobs.id))
        .where(eq(shortlists.id, input.shortlistId))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Shortlist not found' });
      }

      return {
        shortlistId: row.shortlistId,
        jobTitle: row.jobTitle,
        passReasons: row.calibration ?? { passReasons: [] },
        funnel: { screened: 0, deepEvaluated: 0, answeredFollowup: 0 },
        notes: ['Full adverse-impact sampler is phase 2.'],
      };
    }),

  // PATCH /ops/config/:key — rubric / autonomy config edits, version bumped.
  updateConfig: opsProcedure
    .input(UpdateConfigInput)
    .output(UpdateConfigOutput)
    .mutation(async ({ ctx, input }) => {
      // Spec §7: operators may only patch governance keys — rubric, autonomy,
      // and SLA. Operational rollups (week stats, workforce, adverse impact) are
      // worker-written and never hand-edited here.
      const ALLOWED = new Set([
        'autonomy',
        'rubric_version',
        'prompt_versions',
        'sla_hours',
      ]);
      if (!ALLOWED.has(input.key)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Config key not editable here: ${input.key}`,
        });
      }

      const [updated] = await ctx.db
        .update(config)
        .set({ value: input.value, version: sql`${config.version} + 1` })
        .where(eq(config.key, input.key))
        .returning({ key: config.key, version: config.version });

      let result = updated;
      if (!result) {
        const [inserted] = await ctx.db
          .insert(config)
          .values({ key: input.key, value: input.value, version: 1 })
          .returning({ key: config.key, version: config.version });
        result = inserted;
      }
      if (!result) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Config write returned no row',
        });
      }

      await writeLedgerEvent({
        studentId: null,
        actorKind: 'system',
        actorId: ctx.principal.userId,
        kind: 'edit',
        detail: { kind: 'edit', field: `config.${input.key}` },
      });

      return { key: result.key, version: result.version };
    }),
});

// ── config blob parsers (kept below the router for readability) ──────────────
const WeekStatsBlob = z.object({
  week: z.string(),
  digestSent: z.string(),
  medianResolveMin: z.number(),
  stats: z.array(WeekStat),
  adverseImpact: z.object({ body: z.string(), meta: z.string() }),
});
const AutonomyBlob = z.record(z.string(), z.enum(['A', 'B', 'C']));

// The weekly adverse-impact rollup the workers write into ops.adverse_impact
// (see services/workers/src/schedules/adverseImpactRollup.ts). Loosely parsed —
// only the fields the card renders are pinned. NO protected-class attributes
// exist by design; the read stays calm and non-shaming per the design grammar.
const AdverseImpactRollup = z
  .object({
    generatedAt: z.string(),
    impactRatio: z.number().nullable().optional(),
    cohorts: z.array(z.unknown()).optional(),
  })
  .passthrough();

/**
 * Render the adverse-impact card body + meta from the live rollup when present,
 * falling back to the static config copy otherwise. Below-band ratios are only
 * flagged (never shamed): plain language, no red, points to the Sampler.
 */
function adverseImpactCard(
  raw: unknown,
  fallback: { body: string; meta: string },
): { body: string; meta: string } {
  const parsed = AdverseImpactRollup.safeParse(raw);
  if (!parsed.success) return fallback;
  const r = parsed.data;
  const cohortCount = r.cohorts?.length ?? 0;
  const ratio = r.impactRatio ?? null;

  let body: string;
  if (ratio == null) {
    body =
      'Not enough cohort volume to read a selection ratio this cycle. Program and graduation-year proxies only. Full view lives in the Shortlist Sampler.';
  } else if (ratio >= 0.8) {
    body = `Cohort selection ratios within band this cycle (lowest-to-highest ${ratio.toFixed(2)} across ${cohortCount} cohorts, program and graduation-year proxies). Full view lives in the Shortlist Sampler.`;
  } else {
    body = `Lowest-to-highest cohort selection ratio is ${ratio.toFixed(2)} this cycle, below the 0.80 band. Review in the Shortlist Sampler.`;
  }

  const meta = `last run: ${fmtStamp(r.generatedAt)} · program + grad-year proxy`;
  return { body, meta };
}
