// Server-only helpers that resolve (and, for new CMU students, provision) the
// `users` row behind a sign-in and shape it into the JWT/session claims. All DB
// access lives here so the edge auth config stays free of node-only deps.

import { db, eq, or } from '@tartan/db';
import { users, students, sponsorMembers, sponsorOrgs } from '@tartan/db';
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

/**
 * Whether the row(s) a session's claims point at still exist. A session can go
 * stale if its backing user/student/org was removed (e.g. a database reset)
 * while the JWT cookie lives on. Guards redirect a stale session to sign in
 * fresh instead of 500ing on a missing row.
 */
export async function sessionPrincipalExists(claims: {
  userId?: string;
  role?: UserRole;
  studentId?: string;
  orgId?: string;
}): Promise<boolean> {
  if (!claims.userId) return false;
  const u = await db()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, claims.userId))
    .limit(1);
  if (!u[0]) return false;

  if (claims.role === 'student') {
    if (!claims.studentId) return false;
    const s = await db()
      .select({ id: students.id })
      .from(students)
      .where(eq(students.id, claims.studentId))
      .limit(1);
    return Boolean(s[0]);
  }
  if (claims.role === 'sponsor') {
    if (!claims.orgId) return false;
    const o = await db()
      .select({ id: sponsorOrgs.id })
      .from(sponsorOrgs)
      .where(eq(sponsorOrgs.id, claims.orgId))
      .limit(1);
    return Boolean(o[0]);
  }
  // operator: the users row is sufficient.
  return true;
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

// ── Test-access accounts ─────────────────────────────────────────────────────
// Password-gated logins for exercising each role before Google sign-in is
// configured. Each account is a REAL user, provisioned on first sign-in:
//   operator - a bare operator account.
//   student  - a real student with an empty profile (routed through onboarding).
//   sponsor  - a real sponsor attached to a real, empty sponsor organization
//              (created once) that the tester fills with real roles.
// These are test seats, not demo content: nothing fake is populated behind them.

export type TestRole = 'student' | 'sponsor' | 'operator';

const TEST_EMAIL: Record<TestRole, string> = {
  student: 'student@test.scottylabs',
  sponsor: 'sponsor@test.scottylabs',
  operator: 'operator@test.scottylabs',
};
const TEST_NAME: Record<TestRole, string> = {
  student: 'Test Student',
  sponsor: 'Test Sponsor',
  operator: 'Test Operator',
};

const TEST_ORG_ID = '7e57c0de-0000-4000-8000-000000000001';
const TEST_ORG_NAME = 'Test Sponsor Organization';

async function ensureTestOrgId(): Promise<string> {
  const existing = await db()
    .select({ id: sponsorOrgs.id })
    .from(sponsorOrgs)
    .where(eq(sponsorOrgs.id, TEST_ORG_ID))
    .limit(1);
  if (existing[0]) return existing[0].id;
  await db()
    .insert(sponsorOrgs)
    .values({
      id: TEST_ORG_ID,
      name: TEST_ORG_NAME,
      domain: 'test.scottylabs',
      tier: 'premier',
    })
    .onConflictDoNothing({ target: sponsorOrgs.id });
  return TEST_ORG_ID;
}

/** Resolve or provision the real user behind a test-access role sign-in. */
export async function provisionTestUser(role: TestRole): Promise<UserClaims> {
  const email = TEST_EMAIL[role];
  const existing = await resolveUser(email);
  if (existing) return existing;

  const inserted = await db()
    .insert(users)
    .values({
      email,
      name: TEST_NAME[role],
      googleSub: `test-access:${role}`,
      role,
    })
    .returning({ id: users.id, role: users.role });
  const userRow = inserted[0];
  if (!userRow) throw new Error('failed to provision test user');

  const claims: UserClaims = { userId: userRow.id, role: userRow.role };

  if (role === 'student') {
    const s = await db()
      .insert(students)
      .values({ userId: userRow.id, andrewId: 'teststudent', kind: 'undergrad' })
      .returning({ id: students.id });
    if (s[0]) claims.studentId = s[0].id;
  } else if (role === 'sponsor') {
    const orgId = await ensureTestOrgId();
    await db()
      .insert(sponsorMembers)
      .values({ userId: userRow.id, orgId, role: 'recruiter' })
      .onConflictDoNothing();
    claims.orgId = orgId;
    claims.memberRole = 'recruiter';
  }
  return claims;
}
