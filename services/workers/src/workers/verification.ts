// VERIFICATION worker (the brief's step 4; ARCHITECTURE section 6). The
// authoritative checks are DETERMINISTIC code: repo authorship via GitHub commit
// email match (unauthenticated api.github.com, graceful rate-limit handling) and
// date consistency. runAgent('verifier') is only a cheap language pass for the
// audit trail; it never overrides the deterministic result. Writes
// evidence.provenance, a ledger 'verify' event, and files a verification_conflict
// exception when the deterministic check disagrees with the self-reported claim.

import { Worker, type Job } from 'bullmq';
import {
  db,
  evidence,
  students,
  users,
  screens,
  eq,
  and,
  inArray,
} from '@tartan/db';
import { runAgent, VERIFIER_PROMPT } from '@tartan/agents';
import { VerifierVerdict } from '@tartan/types';
import type { EvidenceMeta } from '@tartan/types';
import { QUEUE } from '../queues.js';
import { bullConnection } from '../redis.js';
import { QUEUE_PREFIX, DRY_RUN } from '../env.js';
import { log } from '../logger.js';
import { fileException, inputRef } from '../util.js';
import { appendLedger } from '../ledger.js';
import { VerificationJob } from '../jobs.js';

const SCOPE = 'verification';

type Verdict = 'verified' | 'failed' | 'inconclusive';
interface DetResult {
  result: Verdict;
  method: string;
  detail: string;
}

type EvidenceRow = typeof evidence.$inferSelect;

export async function processVerification(job: Job): Promise<void> {
  const sel = VerificationJob.parse(job.data);

  if (DRY_RUN) {
    log.info(SCOPE, 'dry-run: skipping verification', sel);
    return;
  }

  // Resolve which evidence rows to check.
  let studentId = sel.studentId;
  if (!studentId && sel.screenId) {
    const [s] = await db()
      .select({ studentId: screens.studentId })
      .from(screens)
      .where(eq(screens.id, sel.screenId))
      .limit(1);
    studentId = s?.studentId;
  }

  let rows: EvidenceRow[] = [];
  if (sel.evidenceId) {
    rows = await db()
      .select()
      .from(evidence)
      .where(eq(evidence.id, sel.evidenceId));
  } else if (studentId) {
    rows = await db()
      .select()
      .from(evidence)
      .where(
        and(
          eq(evidence.studentId, studentId),
          inArray(evidence.provenance, ['self_reported', 'pending']),
        ),
      );
  }

  if (rows.length === 0) {
    log.info(SCOPE, 'no evidence to verify', sel);
    return;
  }

  for (const ev of rows) {
    await verifyOne(ev);
  }
  log.info(SCOPE, 'verification complete', { checked: rows.length });
}

async function verifyOne(ev: EvidenceRow): Promise<void> {
  const email = await studentPrimaryEmail(ev.studentId);
  const det = await deterministicCheck(ev, email);

  // Cheap language pass for the audit trail; deferring to the deterministic
  // result (the prompt tells it to). We do NOT trust its verdict for provenance.
  try {
    await runAgent(
      'verifier',
      {
        system: VERIFIER_PROMPT,
        messages: [
          {
            role: 'user',
            content:
              `Evidence: ${JSON.stringify({
                id: ev.id,
                type: ev.type,
                title: ev.title,
                url: ev.url,
                meta: ev.meta,
              })}\n\n` +
              `Deterministic result: ${det.result} via ${det.method} (${det.detail}). Defer to it.`,
          },
        ],
      },
      { schema: VerifierVerdict, inputRef: inputRef({ evidenceId: ev.id }) },
    );
  } catch (err) {
    log.warn(SCOPE, 'verifier language pass failed (non-fatal)', {
      evidenceId: ev.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Provenance: verified only on a positive deterministic result; otherwise
  // pending. A failed (conflicting) result also files an ops exception. When it
  // stays pending (rate limit, private repo, no deterministic check applied), we
  // record WHY in evidence.meta.verificationNote so the reason survives a retry
  // and is visible to ops — a graceful 403/rate-limit leaves an auditable note
  // rather than silently looking unverified.
  const verified = det.result === 'verified';
  const provenance = verified ? 'verified' : 'pending';
  const patch: { provenance: 'verified' | 'pending'; meta?: EvidenceMeta } = {
    provenance,
  };
  if (!verified) {
    patch.meta = {
      ...(ev.meta ?? {}),
      verificationNote: `${det.method}: ${det.detail}`,
    } as EvidenceMeta;
  }
  await db().update(evidence).set(patch).where(eq(evidence.id, ev.id));

  await appendLedger([
    {
      studentId: ev.studentId,
      actorKind: 'agent',
      actorId: 'verifier',
      kind: 'verify',
      detail: {
        kind: 'verify',
        evidenceId: ev.id,
        method: det.method,
        result: det.result,
        note: det.detail,
      },
    },
  ]);

  if (det.result === 'failed') {
    await fileException({
      category: 'verification_conflict',
      agent: 'verifier',
      context: {
        agent: 'verifier',
        quote: det.detail,
        refs: { evidenceId: ev.id, studentId: ev.studentId },
        category: 'verification_conflict',
      },
      recommendation:
        'Deterministic check contradicts the self-reported claim; review before marking verified.',
    });
  }

  log.info(SCOPE, 'evidence checked', {
    evidenceId: ev.id,
    result: det.result,
    method: det.method,
  });
}

async function studentPrimaryEmail(studentId: string): Promise<{
  email: string | null;
  andrewId: string | null;
}> {
  const [row] = await db()
    .select({ email: users.email, andrewId: students.andrewId })
    .from(students)
    .innerJoin(users, eq(students.userId, users.id))
    .where(eq(students.id, studentId))
    .limit(1);
  return { email: row?.email ?? null, andrewId: row?.andrewId ?? null };
}

// ── deterministic checks ─────────────────────────────────────────────────────

async function deterministicCheck(
  ev: EvidenceRow,
  who: { email: string | null; andrewId: string | null },
): Promise<DetResult> {
  // Date consistency first (cheap, no network).
  const dateRes = checkDates(ev.meta);
  if (dateRes && dateRes.result === 'failed') return dateRes;

  // Repo authorship via GitHub commit emails.
  if (ev.type === 'repo') {
    const repo = parseGithubRepo(ev.meta?.repoUrl ?? ev.url ?? undefined);
    if (!repo) {
      return {
        result: 'inconclusive',
        method: 'github_commit_email',
        detail: 'no parseable github repo url',
      };
    }
    const commits = await fetchRepoCommitEmails(repo.owner, repo.repo);
    if (commits.kind === 'rate_limited') {
      return {
        result: 'inconclusive',
        method: 'github_commit_email',
        detail: 'github rate limit reached; retry later',
      };
    }
    if (commits.kind === 'not_found') {
      return {
        result: 'inconclusive',
        method: 'github_commit_email',
        detail: 'repo not found or private',
      };
    }
    if (commits.emails.length === 0) {
      return {
        result: 'inconclusive',
        method: 'github_commit_email',
        detail: 'no commit author emails available',
      };
    }
    const matched = commits.emails.some((e) => emailMatches(e, who));
    return matched
      ? {
          result: 'verified',
          method: 'github_commit_email',
          detail: 'a commit author email matches the student on file',
        }
      : {
          result: 'failed',
          method: 'github_commit_email',
          detail:
            'no commit author email matches the student; authorship not confirmed',
        };
  }

  if (dateRes) return dateRes; // 'verified' from a clean date range
  return {
    result: 'inconclusive',
    method: 'pattern',
    detail: 'no deterministic check applies to this evidence type',
  };
}

function checkDates(meta: EvidenceMeta | null): DetResult | null {
  const start = meta?.dates?.start;
  const end = meta?.dates?.end;
  if (!start && !end) return null;
  const s = start ? Date.parse(start) : NaN;
  const e = end ? Date.parse(end) : NaN;
  if (!Number.isNaN(s) && !Number.isNaN(e) && s > e) {
    return {
      result: 'failed',
      method: 'date_consistency',
      detail: `start date ${start} is after end date ${end}`,
    };
  }
  const now = Date.now();
  if (!Number.isNaN(s) && s > now + 86400000) {
    return {
      result: 'failed',
      method: 'date_consistency',
      detail: `start date ${start} is in the future`,
    };
  }
  return {
    result: 'verified',
    method: 'date_consistency',
    detail: 'date range is internally consistent',
  };
}

function emailMatches(
  commitEmail: string,
  who: { email: string | null; andrewId: string | null },
): boolean {
  const e = commitEmail.toLowerCase();
  if (who.email && e === who.email.toLowerCase()) return true;
  if (who.andrewId) {
    const local = e.split('@')[0];
    if (local && local === who.andrewId.toLowerCase()) return true;
    if (e === `${who.andrewId.toLowerCase()}@andrew.cmu.edu`) return true;
  }
  return false;
}

function parseGithubRepo(
  url: string | undefined,
): { owner: string; repo: string } | null {
  if (!url) return null;
  const m = /github\.com[/:]([^/]+)\/([^/#?]+)/i.exec(url);
  if (!m) return null;
  const owner = m[1];
  let repo = m[2];
  if (!owner || !repo) return null;
  repo = repo.replace(/\.git$/, '');
  return { owner, repo };
}

type CommitResult =
  | { kind: 'ok'; emails: string[] }
  | { kind: 'rate_limited' }
  | { kind: 'not_found' };

interface GithubCommit {
  commit?: { author?: { email?: string } };
}

async function fetchRepoCommitEmails(
  owner: string,
  repo: string,
): Promise<CommitResult> {
  const url = `https://api.github.com/repos/${encodeURIComponent(
    owner,
  )}/${encodeURIComponent(repo)}/commits?per_page=100`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'tartan-talent-verifier',
      },
    });
    if (res.status === 403 || res.status === 429) {
      if (res.headers.get('x-ratelimit-remaining') === '0') {
        return { kind: 'rate_limited' };
      }
      return { kind: 'rate_limited' };
    }
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) return { kind: 'not_found' };
    const body = (await res.json()) as GithubCommit[];
    const emails = body
      .map((c) => c.commit?.author?.email)
      .filter((e): e is string => Boolean(e));
    return { kind: 'ok', emails };
  } catch (err) {
    log.warn(SCOPE, 'github fetch failed', {
      owner,
      repo,
      error: err instanceof Error ? err.message : String(err),
    });
    return { kind: 'not_found' };
  }
}

export function startVerificationWorker(): Worker {
  const worker = new Worker(QUEUE.verification, processVerification, {
    connection: bullConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 2,
  });
  worker.on('failed', (job, err) =>
    log.error(SCOPE, 'job failed', { jobId: job?.id, error: err.message }),
  );
  return worker;
}
