// The single sponsor-visibility authority. Every sponsor-facing read of a
// student (router queries AND the audio stream route) goes through the
// sponsor_visible_students view via this helper — never a hand-rolled
// predicate. See packages/db/drizzle/0001_guards.sql for the view semantics:
// searchable/match_only students with a published screen + approved dossier;
// paused and unpublished students are absent; match_only rows carry
// reveal_required=true and must ALSO pass a shortlist-entry reveal check.

import { rawSql } from '@/lib/db';

export interface VisibleStudent {
  student_id: string;
  user_id: string;
  name: string;
  andrew_id: string | null;
  program: string | null;
  // Raw-SQL rows return date columns as strings; treat both.
  grad_date: Date | string | null;
  kind: 'undergrad' | 'grad' | 'alum';
  visibility: 'searchable' | 'match_only' | 'paused';
  locations: string[] | null;
  work_auth: { status: string; needsSponsorship: boolean; note?: string } | null;
  freshness_score: number | null;
  last_verified_at: Date | string | null;
  screen_id: string;
  dossier_id: string;
  directory_listable: boolean;
  reveal_required: boolean;
}

/** Look up the visibility-view rows for a set of student ids (empty-safe). */
export async function visibleStudents(
  ids: readonly string[],
): Promise<Map<string, VisibleStudent>> {
  const map = new Map<string, VisibleStudent>();
  if (ids.length === 0) return map;
  const sql = rawSql();
  const rows = (await sql`
    SELECT * FROM sponsor_visible_students
    WHERE student_id IN ${sql(ids as string[])}
  `) as unknown as VisibleStudent[];
  for (const r of rows) map.set(r.student_id, r);
  return map;
}
