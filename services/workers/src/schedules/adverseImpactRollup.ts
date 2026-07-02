// adverse_impact_rollup (weekly) — the brief's step 8; ARCHITECTURE section 8
// (NYC LL144 / Colorado AIA posture, the Sampler). Computes selection rates by
// cohort into config key ops.adverse_impact.
//
// LIMITATION (commented deliberately): the schema holds NO protected-class data
// (no race, gender, age, etc.) by design — FERPA + the product's trust posture.
// So this rollup can only use NON-protected structural proxies that exist in the
// schema: academic program and graduation-year cohort. These are NOT protected
// classes and this is NOT a substitute for a true four-fifths adverse-impact
// analysis; it is an early-warning distribution check for ops. "Selected" here
// means an entry that advanced (status intro or saved).

import { rawSql } from '@tartan/db';
import { writeConfig } from '../config.js';
import { DRY_RUN } from '../env.js';
import { log } from '../logger.js';

const SCOPE = 'adverse_impact_rollup';

interface CohortRow {
  program: string | null;
  gradYear: number | null;
  entries: number;
  advanced: number;
}

export async function adverseImpactRollup(): Promise<void> {
  const sqlc = rawSql();
  const rows = await sqlc<CohortRow[]>`
    SELECT st.program                              AS "program",
           extract(year FROM st.grad_date)::int    AS "gradYear",
           count(*)::int                           AS "entries",
           sum(CASE WHEN se.status IN ('intro', 'saved') THEN 1 ELSE 0 END)::int AS "advanced"
    FROM shortlist_entries se
    JOIN students st ON st.id = se.student_id
    GROUP BY st.program, extract(year FROM st.grad_date)
    ORDER BY "entries" DESC
  `;

  const cohorts = rows.map((r) => ({
    program: r.program,
    gradYear: r.gradYear,
    entries: r.entries,
    advanced: r.advanced,
    selectionRate: r.entries > 0 ? r.advanced / r.entries : 0,
  }));

  // Simple disparity read: ratio of the lowest to the highest cohort selection
  // rate among cohorts with a meaningful sample (>= 5 entries).
  const sampled = cohorts.filter((c) => c.entries >= 5 && c.selectionRate > 0);
  const rates = sampled.map((c) => c.selectionRate);
  const impactRatio =
    rates.length >= 2 ? Math.min(...rates) / Math.max(...rates) : null;

  const rollup = {
    generatedAt: new Date().toISOString(),
    cohorts,
    impactRatio,
    proxyBasis: 'program + graduation-year cohort',
    limitation:
      'No protected-class data exists in the schema (FERPA + trust posture). ' +
      'Program and grad-year are non-protected structural proxies only; this is ' +
      'an early-warning distribution check, not a legal four-fifths analysis.',
  };

  if (DRY_RUN) {
    log.info(SCOPE, 'dry-run complete', {
      cohorts: cohorts.length,
      impactRatio,
    });
    return;
  }

  await writeConfig('ops.adverse_impact', rollup);
  log.info(SCOPE, 'rollup written', { cohorts: cohorts.length, impactRatio });
}
