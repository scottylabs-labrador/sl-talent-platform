// Edge-safe Auth.js config. NO node-only imports (no db, no 'server-only') so
// this module can be pulled into middleware. The DB-touching bits (signIn / jwt
// enrichment, Credentials.authorize) live in auth.ts, which runs on the node
// runtime only.

import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import type { UserRole, SponsorMemberRole } from '@tartan/types';

/** The custom claims we stash on the JWT and mirror onto the session. */
export interface AppTokenClaims {
  userId?: string;
  role?: UserRole;
  studentId?: string;
  orgId?: string;
  memberRole?: SponsorMemberRole;
}

/** Where each principal lands after sign-in. */
export function homeForRole(role: UserRole | undefined): string {
  switch (role) {
    case 'sponsor':
      return '/sponsor';
    case 'operator':
      return '/ops';
    default:
      return '/';
  }
}

export const authConfig = {
  session: { strategy: 'jwt' },
  trustHost: true,
  pages: { signIn: '/login' },
  providers: [
    Google({
      // hd is advisory only (client-side); the real CMU check is server-side
      // in the signIn callback (auth.ts). We still request it to bias the
      // Google account chooser toward andrew.cmu.edu.
      authorization: {
        params: { hd: 'andrew.cmu.edu', prompt: 'select_account' },
      },
    }),
  ],
  callbacks: {
    // Mirror the enriched JWT claims onto session.user. No DB here — the claims
    // were written into the token at sign-in by the node-side jwt callback.
    session({ session, token }) {
      const c = token as AppTokenClaims;
      if (c.userId) {
        session.user.userId = c.userId;
        session.user.role = c.role;
        session.user.studentId = c.studentId;
        session.user.orgId = c.orgId;
        session.user.memberRole = c.memberRole;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
