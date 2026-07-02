// Server-only helpers that resolve (and, for new CMU students, provision) the
// `users` row behind a sign-in and shape it into the JWT/session claims. All DB
// access lives here so the edge auth config stays free of node-only deps.

import { db, eq, or } from '@tartan/db';
import { users, students, sponsorMembers } from '@tartan/db';
import type { UserRole, SponsorMemberRole } from '@tartan/types';

/** The enriched claims mirrored onto both the JWT and session.user. */
export interface UserClaims {
  userId: string;
  role: UserRole;
  studentId?: string;
  orgId?: string;
  memberRole?: SponsorMemberRole;
}

const CMU_HD = 'andrew.cmu.edu';

export function isCmuEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${CMU_HD}`);
}

/** Fill role-specific claims (studentId / orgId+memberRole) for a users row. */
async function enrich(row: {
  id: string;
  role: UserRole;
}): Promise<UserClaims> {
  const claims: UserClaims = { userId: row.id, role: row.role };

  if (row.role === 'student') {
    const s = await db()
      .select({ id: students.id })
      .from(students)
      .where(eq(students.userId, row.id))
      .limit(1);
    if (s[0]) claims.studentId = s[0].id;
  } else if (row.role === 'sponsor') {
    const m = await db()
      .select({ orgId: sponsorMembers.orgId, role: sponsorMembers.role })
      .from(sponsorMembers)
      .where(eq(sponsorMembers.userId, row.id))
      .limit(1);
    if (m[0]) {
      claims.orgId = m[0].orgId;
      claims.memberRole = m[0].role;
    }
  }
  return claims;
}

/** Look up an existing user by google_sub (preferred) or email. */
export async function resolveUser(
  email: string,
  googleSub?: string | null,
): Promise<UserClaims | null> {
  const rows = await db()
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      googleSub
        ? or(eq(users.googleSub, googleSub), eq(users.email, email))
        : eq(users.email, email),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return enrich(row);
}

/**
 * Resolve an existing user or provision a minimal student for a verified CMU
 * (andrew.cmu.edu) Google account. SSO-derived: andrew_id = email localpart.
 * Non-CMU accounts are never provisioned here — they must already have a row
 * (invited sponsor / allowlisted alum / operator).
 */
export async function resolveOrProvisionCmuStudent(
  email: string,
  name: string,
  googleSub: string,
): Promise<UserClaims | null> {
  const existing = await resolveUser(email, googleSub);
  if (existing) return existing;
  if (!isCmuEmail(email)) return null;

  const andrewId = email.slice(0, email.indexOf('@')).toLowerCase();

  const inserted = await db()
    .insert(users)
    .values({ email, name, googleSub, role: 'student' })
    .returning({ id: users.id, role: users.role });
  const userRow = inserted[0];
  if (!userRow) return null;

  const studentRows = await db()
    .insert(students)
    .values({ userId: userRow.id, andrewId, kind: 'undergrad' })
    .returning({ id: students.id });

  const claims: UserClaims = { userId: userRow.id, role: userRow.role };
  if (studentRows[0]) claims.studentId = studentRows[0].id;
  return claims;
}
