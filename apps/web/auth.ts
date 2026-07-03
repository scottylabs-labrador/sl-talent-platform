// Full Auth.js v5 setup (node runtime). Extends the edge-safe authConfig with
// the DB-touching pieces: the Credentials demo provider, the server-side hd
// check + existing-user gate (signIn), and JWT claim enrichment (jwt). Exports
// the handlers/auth/signIn/signOut and a requireSession helper for RSC.

import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { UserRole, SponsorMemberRole } from '@tartan/types';
import { authConfig, homeForRole, type AppTokenClaims } from './auth.config';
import {
  isCmuEmail,
  provisionTestUser,
  resolveOrProvisionCmuStudent,
  resolveUser,
  sessionPrincipalExists,
  type TestRole,
  type UserClaims,
} from './lib/auth-user';

// ── Module augmentation: our claims on the session ──────────────────────────
// (The JWT carries the same claims via its string index signature; we read it
// through AppTokenClaims casts rather than augmenting 'next-auth/jwt', whose
// module specifier is not resolvable to augment in this beta.)
declare module 'next-auth' {
  interface Session {
    user: {
      userId?: string;
      role?: UserRole;
      studentId?: string;
      orgId?: string;
      memberRole?: SponsorMemberRole;
    } & DefaultSession['user'];
  }
}

// Password-gated test access. Enabled while Google sign-in is not yet
// configured. One cheap shared password (TEST_LOGIN_PASSWORD) unlocks a real
// account per role, provisioned on first use. Set TEST_LOGIN=false once Google
// OAuth is live to turn this off.
const TestInput = z.object({
  role: z.enum(['student', 'sponsor', 'operator']),
  password: z.string().min(1),
});

const testLoginEnabled =
  process.env.TEST_LOGIN === 'true' || process.env.DEV_LOGIN === 'true';
const TEST_PASSWORD = process.env.TEST_LOGIN_PASSWORD ?? 'scotty-talent-2026';

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function claimsToUser(claims: UserClaims, label: string) {
  // The object returned from authorize becomes `user` in the jwt callback.
  return {
    id: claims.userId,
    email: label,
    name: label,
    userId: claims.userId,
    role: claims.role,
    studentId: claims.studentId,
    orgId: claims.orgId,
    memberRole: claims.memberRole,
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    ...(testLoginEnabled
      ? [
          Credentials({
            id: 'test',
            name: 'Test access',
            credentials: {
              role: { label: 'Role', type: 'text' },
              password: { label: 'Password', type: 'password' },
            },
            async authorize(raw) {
              const parsed = TestInput.safeParse(raw);
              if (!parsed.success) return null;
              if (!timingSafeEqualStr(parsed.data.password, TEST_PASSWORD)) {
                return null;
              }
              const role = parsed.data.role as TestRole;
              const claims = await provisionTestUser(role);
              return claimsToUser(claims, `${role}@test.scottylabs`);
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    ...authConfig.callbacks,

    // Server-side gate. Google: verify hd claim OR require an existing row for
    // non-CMU accounts. Demo: already validated in authorize.
    async signIn({ account, profile, user }) {
      if (!account) return false;
      if (account.provider === 'test') return Boolean(user);
      if (account.provider === 'google') {
        const p = profile as
          | { email?: string; email_verified?: boolean; hd?: string }
          | undefined;
        const email = (p?.email ?? '').toLowerCase();
        if (!email) return false;
        const emailVerified = p?.email_verified === true;
        const hd = p?.hd;
        const existing = await resolveUser(email, account.providerAccountId);
        if (existing) return true;
        // New account: allowed only for a verified CMU (hd) address.
        return hd === 'andrew.cmu.edu' && isCmuEmail(email) && emailVerified;
      }
      return false;
    },

    // Write the enriched claims into the token on first sign-in.
    async jwt({ token, user, account, profile }) {
      const t = token as AppTokenClaims;
      if (account && user) {
        if (account.provider === 'test') {
          const u = user as ReturnType<typeof claimsToUser>;
          t.userId = u.userId;
          t.role = u.role;
          t.studentId = u.studentId;
          t.orgId = u.orgId;
          t.memberRole = u.memberRole;
        } else if (account.provider === 'google') {
          const email = (profile?.email ?? user.email ?? '').toLowerCase();
          const name = profile?.name ?? user.name ?? email;
          const claims =
            (await resolveOrProvisionCmuStudent(
              email,
              name,
              account.providerAccountId,
            )) ?? (await resolveUser(email, account.providerAccountId));
          if (claims) {
            t.userId = claims.userId;
            t.role = claims.role;
            t.studentId = claims.studentId;
            t.orgId = claims.orgId;
            t.memberRole = claims.memberRole;
          }
        }
      }
      return token;
    },
  },
});

/**
 * Server-component guard. Redirects to /login when unauthenticated, and to the
 * caller's home when a `role` is required but does not match. Returns the
 * session when the checks pass.
 */
export async function requireSession(role?: UserRole) {
  const session = await auth();
  if (!session?.user?.userId) redirect('/login');
  if (role && session.user.role !== role) {
    redirect(homeForRole(session.user.role));
  }
  // Stale-session guard: if the backing row is gone (e.g. after a data reset),
  // send them to sign in fresh rather than 500 on a missing row downstream.
  const stillValid = await sessionPrincipalExists({
    userId: session.user.userId,
    role: session.user.role,
    studentId: session.user.studentId,
    orgId: session.user.orgId,
  });
  if (!stillValid) redirect('/login?stale=1');
  return session;
}
