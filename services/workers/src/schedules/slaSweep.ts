// sla_sweep (every 5 min) — the brief's step 8 + section 9. The 72h business
// clock and sla_due_at are set at job confirmation by the web; this sweep keeps
// the *risk* view truthful: any confirmed/matching job whose sla_due_at is within
// the horizon (or already past) with no delivered shortlist gets an sla_risk
// exception for ops. Dedupe against already-open sla_risk rows so the 5-minute
// cadence does not spam the queue. (There is no dedicated "at risk" job status in
// the schema; the exception is the signal. Fri 4:12 PM style formatting is the
// web's job — we only keep sla_due_at + statuses honest.)

import {
  db,
  jobs,
  shortlists,
  exceptions,
  and,
  inArray,
  isNotNull,
  lte,
  eq,
} from '@tartan/db';
import type { ExceptionContext } from '@tartan/types';
import { DRY_RUN } from '../env.js';
import { log } from '../logger.js';
import { fileException } from '../util.js';

const SCOPE = 'sla_sweep';
const HORIZON_MS = 12 * 60 * 60 * 1000; // flag within 12h of the deadline

export async function slaSweep(): Promise<void> {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_MS);

  const candidates = await db()
    .select({
      id: jobs.id,
      slaDueAt: jobs.slaDueAt,
      status: jobs.status,
    })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ['confirmed', 'matching']),
        isNotNull(jobs.slaDueAt),
        lte(jobs.slaDueAt, horizon),
      ),
    );

  // Jobs that already have a delivered shortlist are not at risk.
  const delivered = new Set<string>();
  if (candidates.length > 0) {
    const rows = await db()
      .select({ jobId: shortlists.jobId })
      .from(shortlists)
      .where(
        and(
          inArray(
            shortlists.jobId,
            candidates.map((c) => c.id),
          ),
          eq(shortlists.status, 'delivered'),
        ),
      );
    for (const r of rows) delivered.add(r.jobId);
  }

  // Dedupe against open sla_risk exceptions.
  const openRows = await db()
    .select({ context: exceptions.context })
    .from(exceptions)
    .where(and(eq(exceptions.category, 'sla_risk'), eq(exceptions.status, 'open')));
  const alreadyFlagged = new Set<string>();
  for (const r of openRows) {
    const ctx = r.context as ExceptionContext | null;
    const jobId = ctx?.refs?.jobId;
    if (jobId) alreadyFlagged.add(jobId);
  }

  let flagged = 0;
  for (const c of candidates) {
    if (delivered.has(c.id) || alreadyFlagged.has(c.id) || !c.slaDueAt) continue;
    const past = c.slaDueAt.getTime() < now.getTime();
    if (DRY_RUN) {
      flagged += 1;
      continue;
    }
    await fileException({
      category: 'sla_risk',
      agent: 'recruiter',
      context: {
        agent: 'system',
        quote: past
          ? `SLA breached: due ${c.slaDueAt.toISOString()} and no shortlist delivered.`
          : `SLA approaching: due ${c.slaDueAt.toISOString()} within 12 hours.`,
        refs: { jobId: c.id },
        category: 'sla_risk',
      },
      recommendation: past
        ? 'Past due. Escalate the pipeline for this role and notify the org owner.'
        : 'Approaching due time. Confirm the shortlist is on track to deliver.',
    });
    flagged += 1;
  }

  log.info(SCOPE, DRY_RUN ? 'dry-run complete' : 'complete', {
    candidates: candidates.length,
    flagged,
  });
}
