// MATCHING worker — Recruiter pipeline v1 (the brief's step 5; ARCHITECTURE
// section 6/9). {jobId} -> re-assert the intake policy guard -> retrieve via
// pgvector cosine over evidence/story embeddings with hard filters -> longlist 30
// -> runAgent('recruiter') deep-evaluate vs the rubric -> reconcile the ranking
// against the real longlist -> enforce slate composition (8 fits + wildcards) in
// code -> create shortlist (ALWAYS human_gate in v1) + entries + the human-gate
// exception. Fanout to students happens later on ops approval (ledger_fanout).

import { Worker, type Job } from 'bullmq';
import {
  db,
  rawSql,
  jobs,
  shortlists,
  shortlistEntries,
  evidence,
  eq,
  inArray,
} from '@tartan/db';
import { runAgent, RECRUITER_PROMPT, validateIntakeRequirements, embedOne } from '@tartan/agents';
import { RecruiterRanking } from '@tartan/types';
import type {
  JobRequirements,
  EvidenceChips,
  EntryKind,
  RankedCandidate,
} from '@tartan/types';
import { QUEUE } from '../queues.js';
import { bullConnection } from '../redis.js';
import { QUEUE_PREFIX, DRY_RUN } from '../env.js';
import { log } from '../logger.js';
import { fileException, inputRef } from '../util.js';
import { recruiterPipelineConfig } from '../config.js';
import { MatchingJob } from '../jobs.js';

const SCOPE = 'matching';

interface LonglistRow {
  studentId: string;
  score: number;
  kind: string;
  visibility: string;
  locations: string[] | null;
}

interface SlateEntry {
  studentId: string;
  fit: number;
  rationale: string;
  evidenceChips: EvidenceChips;
  forcedKind: EntryKind | null; // alum/match_only from the student record
  score: number;
}

export async function processMatching(job: Job): Promise<void> {
  const { jobId } = MatchingJob.parse(job.data);

  if (DRY_RUN) {
    log.info(SCOPE, 'dry-run: skipping matching', { jobId });
    return;
  }

  const [jobRow] = await db().select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!jobRow) {
    log.warn(SCOPE, 'job not found', { jobId });
    return;
  }

  const requirements: JobRequirements = jobRow.requirements ?? {
    mustHaves: [],
    niceToHaves: [],
    skills: [],
  };

  // ── Re-assert the deterministic intake policy guard ────────────────────────
  const guard = validateIntakeRequirements(requirements);
  if (!guard.ok) {
    await fileException({
      category: 'policy_refusal',
      agent: 'recruiter',
      context: {
        agent: 'recruiter',
        quote: guard.refusalCopy,
        refs: { jobId },
        category: 'policy_refusal',
      },
      recommendation: `Requirements contain protected-class proxy filters: ${guard.violations
        .map((v) => `${v.field}:${v.matched}`)
        .join(', ')}. Refused before matching.`,
    });
    log.warn(SCOPE, 'refused: policy violation', {
      jobId,
      violations: guard.violations.length,
    });
    return;
  }

  await db().update(jobs).set({ status: 'matching' }).where(eq(jobs.id, jobId));

  const cfg = await recruiterPipelineConfig();

  // ── Retrieve: pgvector cosine + hard filters -> longlist ────────────────────
  const jobEmbedding =
    jobRow.embedding && jobRow.embedding.length > 0
      ? jobRow.embedding
      : await embedOne(requirementsText(jobRow.title, requirements));

  const longlist = await retrieveLonglist(jobEmbedding, requirements, cfg.longlist);
  if (longlist.length === 0) {
    await fileException({
      category: 'low_confidence_shortlist',
      agent: 'recruiter',
      context: {
        agent: 'recruiter',
        quote: 'No candidates matched the retrieval filters for this role.',
        refs: { jobId },
        category: 'low_confidence_shortlist',
      },
      recommendation:
        'Empty longlist. Widen requirements or confirm the talent pool has published dossiers.',
    });
    log.warn(SCOPE, 'empty longlist', { jobId });
    return;
  }

  // ── Deep-evaluate against the rubric ────────────────────────────────────────
  const summaries = await candidateSummaries(longlist.map((l) => l.studentId));
  const { output: ranking } = await runAgent(
    'recruiter',
    {
      system: RECRUITER_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `Role: ${JSON.stringify({
              title: jobRow.title,
              requirements,
              compRange: jobRow.compRange,
              calibration: jobRow.calibration,
            })}\n\n` +
            `Longlist candidates (studentId -> evidence summary):\n${JSON.stringify(
              summaries,
            )}\n\nRank the strongest against the rubric.`,
        },
      ],
    },
    { schema: RecruiterRanking, inputRef: inputRef({ jobId }) },
  );

  // ── Reconcile the ranking with the real longlist ────────────────────────────
  const agentByStudent = new Map<string, RankedCandidate>();
  const longlistIds = new Set(longlist.map((l) => l.studentId));
  for (const r of ranking.ranking) {
    if (longlistIds.has(r.studentId)) agentByStudent.set(r.studentId, r);
  }

  const evidenceByStudent = summaries;
  const merged: SlateEntry[] = longlist.map((l) => {
    const forcedKind: EntryKind | null =
      l.kind === 'alum' ? 'alum' : l.visibility === 'match_only' ? 'match_only' : null;
    const agent = agentByStudent.get(l.studentId);
    if (agent) {
      return {
        studentId: l.studentId,
        fit: agent.fit,
        rationale: agent.rationale,
        evidenceChips: stringsToChips(agent.evidenceChips),
        forcedKind,
        score: l.score,
      };
    }
    return {
      studentId: l.studentId,
      fit: fallbackFit(l.score),
      rationale:
        'Strong retrieval match against the role requirements. Review the dossier evidence to confirm depth.',
      evidenceChips: fallbackChips(evidenceByStudent.get(l.studentId)),
      forcedKind,
      score: l.score,
    };
  });

  const slate = composeSlate(merged, cfg.slate, cfg.fits);

  // ── Create shortlist (ALWAYS human_gate in v1) + entries ────────────────────
  const poolNote = `${longlist.length} screened, ${slate.length} deep, 0 answered follow-up`;
  const [shortlist] = await db()
    .insert(shortlists)
    .values({ jobId, status: 'human_gate', poolNote, sampled: false })
    .returning({ id: shortlists.id });
  const shortlistId = shortlist!.id;

  await db()
    .insert(shortlistEntries)
    .values(
      slate.map((s, i) => ({
        shortlistId,
        studentId: s.studentId,
        rank: i + 1,
        fit: s.fit,
        rationale: s.rationale,
        evidenceChips: s.evidenceChips,
        kind: s.kind,
      })),
    );

  // ── Human-gate exception (v1: gate on everything) ──────────────────────────
  const lowConfidence = ranking.confidence < cfg.confidenceThreshold;
  await fileException({
    category: 'low_confidence_shortlist',
    agent: 'recruiter',
    context: {
      agent: 'recruiter',
      quote: lowConfidence
        ? `Shortlist confidence ${ranking.confidence.toFixed(2)} is below the ${cfg.confidenceThreshold} gate.`
        : 'Human gate on every shortlist (v1). Review before delivery.',
      refs: { jobId, shortlistId },
      category: 'low_confidence_shortlist',
    },
    recommendation:
      'Review the slate and approve to deliver. Approval fans out shortlist ledger events to each student.',
  });

  log.info(SCOPE, 'shortlist assembled (human_gate)', {
    jobId,
    shortlistId,
    entries: slate.length,
    confidence: ranking.confidence,
  });
}

// ── retrieval ─────────────────────────────────────────────────────────────────

function requirementsText(title: string, r: JobRequirements): string {
  return [
    title,
    ...r.mustHaves,
    ...r.niceToHaves,
    ...r.skills,
    r.team ?? '',
    r.other ?? '',
  ]
    .filter(Boolean)
    .join('. ');
}

async function retrieveLonglist(
  embedding: number[],
  requirements: JobRequirements,
  limit: number,
): Promise<LonglistRow[]> {
  const vec = `[${embedding.join(',')}]`;
  const sqlc = rawSql();
  // Over-fetch so JS-side location filtering can still return a full longlist.
  const overFetch = limit * 3;
  const rows = await sqlc<
    {
      studentId: string;
      score: string | number;
      kind: string;
      visibility: string;
      locations: string[] | null;
    }[]
  >`
    WITH pool AS (
      SELECT student_id, embedding FROM evidence WHERE embedding IS NOT NULL
      UNION ALL
      SELECT student_id, embedding FROM experience_stories WHERE embedding IS NOT NULL
    ),
    scored AS (
      SELECT student_id, MAX(1 - (embedding <=> ${vec}::vector)) AS score
      FROM pool
      GROUP BY student_id
    )
    SELECT sc.student_id AS "studentId",
           sc.score      AS "score",
           st.kind       AS "kind",
           st.visibility AS "visibility",
           st.locations  AS "locations"
    FROM scored sc
    JOIN students st ON st.id = sc.student_id
    WHERE st.visibility <> 'paused'
    ORDER BY sc.score DESC
    LIMIT ${overFetch}
  `;

  const mapped: LonglistRow[] = rows.map((r) => ({
    studentId: r.studentId,
    score: typeof r.score === 'number' ? r.score : Number(r.score),
    kind: r.kind,
    visibility: r.visibility,
    locations: r.locations,
  }));

  // Hard filter (lenient v1): if the role names locations and is not remote,
  // require an overlap when the student declares locations. Unknown-location
  // students are kept (never silently dropped on a missing fact).
  const wantLocs = (requirements.locations ?? []).map((l) => l.toLowerCase());
  const remote = requirements.workModel === 'remote';
  const filtered =
    wantLocs.length === 0 || remote
      ? mapped
      : mapped.filter((m) => {
          if (!m.locations || m.locations.length === 0) return true;
          return m.locations.some((loc) =>
            wantLocs.some((w) => loc.toLowerCase().includes(w) || w.includes(loc.toLowerCase())),
          );
        });

  return filtered.slice(0, limit);
}

async function candidateSummaries(
  studentIds: string[],
): Promise<Map<string, { titles: string[]; verified: number }>> {
  const out = new Map<string, { titles: string[]; verified: number }>();
  for (const id of studentIds) out.set(id, { titles: [], verified: 0 });
  if (studentIds.length === 0) return out;

  const evs = await db()
    .select({
      studentId: evidence.studentId,
      title: evidence.title,
      provenance: evidence.provenance,
    })
    .from(evidence)
    .where(inArray(evidence.studentId, studentIds));

  for (const e of evs) {
    const bucket = out.get(e.studentId);
    if (!bucket) continue;
    if (bucket.titles.length < 6) bucket.titles.push(e.title);
    if (e.provenance === 'verified') bucket.verified += 1;
  }
  return out;
}

// ── slate composition (validator code, not the model alone) ───────────────────

function composeSlate(
  entries: SlateEntry[],
  slateSize: number,
  fits: number,
): (SlateEntry & { kind: EntryKind })[] {
  const ranked = [...entries].sort((a, b) => b.fit - a.fit).slice(0, slateSize);
  return ranked.map((e, i) => {
    let kind: EntryKind;
    if (e.forcedKind) kind = e.forcedKind;
    else kind = i < fits ? 'fit' : 'wildcard';
    return { ...e, kind };
  });
}

function fallbackFit(score: number): number {
  const pct = Math.round(score * 100);
  return Math.max(40, Math.min(90, pct));
}

function stringsToChips(labels: string[]): EvidenceChips {
  return labels.map((label) => ({ label, kind: chipKindFor(label) }));
}

function chipKindFor(label: string): EvidenceChips[number]['kind'] {
  const l = label.toLowerCase();
  if (l.includes('verified')) return 'verified';
  if (l.includes('moment')) return 'moment';
  if (l.includes('pending')) return 'pending';
  return 'self_reported';
}

function fallbackChips(
  summary: { titles: string[]; verified: number } | undefined,
): EvidenceChips {
  const titles = summary?.titles ?? [];
  const chips: EvidenceChips = titles.slice(0, 3).map((t) => ({
    label: t,
    kind: 'self_reported' as const,
  }));
  while (chips.length < 3) {
    chips.push({ label: 'evidence on file', kind: 'self_reported' });
  }
  return chips;
}

export function startMatchingWorker(): Worker {
  const worker = new Worker(QUEUE.matching, processMatching, {
    connection: bullConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 1,
  });
  worker.on('failed', (job, err) =>
    log.error(SCOPE, 'job failed', { jobId: job?.id, error: err.message }),
  );
  return worker;
}
