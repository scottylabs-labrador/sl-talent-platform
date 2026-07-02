// tRPC v11 initialization: superjson transformer, request context ({session,
// db}), and the four principal-scoped procedure builders. Every scoped
// procedure throws FORBIDDEN unless the session carries the right role (and the
// role-specific id). Data is never trusted from the client — the principal is
// derived from the server session here and passed to resolvers as ctx.principal.

import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { Session } from 'next-auth';
import { db as getDb } from '@tartan/db';
import type { SponsorMemberRole } from '@tartan/types';
import { auth } from '@/auth';

export interface TRPCContext {
  session: Session | null;
  db: ReturnType<typeof getDb>;
}

/** Build the per-request context. Reads the session from the auth cookie. */
export async function createTRPCContext(): Promise<TRPCContext> {
  const session = await auth();
  return { session, db: getDb() };
}

const t = initTRPC.context<TRPCContext>().create({ transformer: superjson });

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

// ── Principal-scoped procedures ─────────────────────────────────────────────

export interface StudentPrincipal {
  userId: string;
  studentId: string;
}
export interface SponsorPrincipal {
  userId: string;
  orgId: string;
  memberRole?: SponsorMemberRole;
}
export interface OpsPrincipal {
  userId: string;
}

const requireStudent = t.middleware(({ ctx, next }) => {
  const u = ctx.session?.user;
  if (!u?.userId || u.role !== 'student' || !u.studentId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Student access required' });
  }
  const principal: StudentPrincipal = { userId: u.userId, studentId: u.studentId };
  return next({ ctx: { ...ctx, principal } });
});

const requireSponsor = t.middleware(({ ctx, next }) => {
  const u = ctx.session?.user;
  if (!u?.userId || u.role !== 'sponsor' || !u.orgId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Sponsor access required' });
  }
  const principal: SponsorPrincipal = {
    userId: u.userId,
    orgId: u.orgId,
    memberRole: u.memberRole,
  };
  return next({ ctx: { ...ctx, principal } });
});

const requireOperator = t.middleware(({ ctx, next }) => {
  const u = ctx.session?.user;
  if (!u?.userId || u.role !== 'operator') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Operator access required' });
  }
  const principal: OpsPrincipal = { userId: u.userId };
  return next({ ctx: { ...ctx, principal } });
});

export const studentProcedure = t.procedure.use(requireStudent);
export const sponsorProcedure = t.procedure.use(requireSponsor);
export const opsProcedure = t.procedure.use(requireOperator);

/** Uniform "surface team fills the body" error for the router stubs. */
export function notImplemented(): TRPCError {
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'not implemented',
  });
}
