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
  jobs,
  shortlists,
  sql,
} from '@tartan/db';
import { TRPCError } from '@trpc/server';
import Redis from 'ioredis';
import { router, opsProcedure } from '../trpc';
import { writeLedgerEvent } from '@/lib/ledger';

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

// ── best-effort Redis (ledger fanout bridge). Missing REDIS_URL → no-op. ─────
let redisClient: Redis | null = null;
let redisTried = false;
function getRedis(): Redis | null {
  if (redisTried) return redisClient;
  redisTried = true;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    redisClient = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
    // Fanout is best-effort; never let a connection error crash a mutation.
    redisClient.on('error', () => {});
  } catch {
    redisClient = null;
  }
  return redisClient;
}

// ── sidebar payloads (config-driven, verbatim from the seed / prototype) ─────
const WorkforceRow = z.object({
  name: z.string(),
  note: z.string(),
  eval: z.string(),
  aut: z.string(),
  dot: z.string(),
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

      // Approving a low-confidence-shortlist exception releases the human gate:
      // flip the referenced shortlist human_gate → delivered and enqueue the
      // ledger fanout so every placed candidate gets their shortlist event.
      const shortlistId = prevContext.refs?.shortlistId;
      if (
        input.action === 'approve' &&
        existing.category === 'low_confidence_shortlist' &&
        shortlistId
      ) {
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
            await getRedis()?.lpush(
              'jobs:ledger_fanout',
              JSON.stringify({ shortlistId }),
            );
          } catch {
            // best-effort: the fanout worker also runs on a periodic sweep.
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

  // GET /ops/sidebar — the sticky sidebar rollups (week stats + workforce),
  // read verbatim from the operational config blobs the seed maintains.
  sidebar: opsProcedure.output(SidebarOutput).query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(config);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    const week = WeekStatsBlob.safeParse(byKey.get('ops.week_stats'));
    const workforce = z
      .array(WorkforceRow)
      .safeParse(byKey.get('ops.agent_workforce'));

    if (!week.success) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'ops.week_stats config missing or malformed',
      });
    }

    return {
      week: week.data.week,
      digestSent: week.data.digestSent,
      medianResolveMin: week.data.medianResolveMin,
      stats: week.data.stats,
      adverseImpact: week.data.adverseImpact,
      workforce: workforce.success ? workforce.data : [],
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
        return {
          agent: a,
          evalScore: null,
          autonomy: autonomyOf(a),
          status: 'healthy' as const,
          runs7d: runs,
          costUsd7d: g?.cost ?? 0,
          flaggedRate: runs > 0 ? (g?.flagged ?? 0) / runs : 0,
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
      const ALLOWED = new Set([
        'autonomy',
        'rubric_version',
        'sla_hours',
        'prompt_versions',
        'recruiter_pipeline',
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
