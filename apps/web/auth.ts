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
  resolveOrProvisionCmuStudent,
  resolveUser,
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

// The three seeded demo identities (enabled only when DEV_LOGIN === 'true').
const DEMO_EMAILS = new Set([
  'student@demo.tartan',
  'sponsor@demo.tartan',
  'ops@demo.tartan',
]);
const DemoInput = z.object({ email: z.string().email() });

const devLoginEnabled = process.env.DEV_LOGIN === 'true';

function claimsToUser(claims: UserClaims, email: string) {
  // The object returned from authorize becomes `user` in the jwt callback.
  return {
    id: claims.userId,
    email,
    name: email,
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
    ...(devLoginEnabled
      ? [
          Credentials({
            id: 'demo',
            name: 'Demo accounts',
            credentials: { email: { label: 'Email', type: 'email' } },
            async authorize(raw) {
              const parsed = DemoInput.safeParse(raw);
              if (!parsed.success) return null;
              const email = parsed.data.email.toLowerCase();
              if (!DEMO_EMAILS.has(email)) return null;
              const claims = await resolveUser(email);
              if (!claims) return null; // must be seeded
              return claimsToUser(claims, email);
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
      if (account.provider === 'demo') return Boolean(user);
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
        if (account.provider === 'demo') {
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
  return session;
}
