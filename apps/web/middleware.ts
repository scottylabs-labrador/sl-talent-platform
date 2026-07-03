// Route guard (edge). Decodes the JWT via the edge-safe authConfig and gates
// the sponsor + ops surfaces, plus the student onboarding flow.
//
// Onboarding gate: the "has this student onboarded?" signal lives in Postgres
// (onboarded_at, or a seeded profile's claims/screen), which the edge runtime
// cannot reach — the DB driver is Node-only. So middleware asks a tiny Node
// route handler (/onboarding/state) with the request's cookies forwarded, and
// redirects a not-yet-onboarded student into /onboarding (and an already-
// onboarded one back out of it). The gate fails open: if the check errors or
// times out, the student is let through rather than trapped.
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authConfig, homeForRole } from './auth.config';

const { auth } = NextAuth(authConfig);

// Student surfaces + the onboarding flow itself. The route handlers under
// /onboarding (state, extract) are excluded from the gate below to avoid loops.
const STUDENT_GATED = ['/', '/profile', '/matches', '/interviews', '/settings'];

async function fetchOnboarded(req: NextRequest): Promise<boolean | null> {
  try {
    const url = new URL('/onboarding/state', req.nextUrl);
    const res = await fetch(url, {
      headers: { cookie: req.headers.get('cookie') ?? '' },
      // Don't let a slow check stall navigation; fail open on timeout.
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { onboarded?: boolean };
    return typeof body.onboarded === 'boolean' ? body.onboarded : null;
  } catch {
    return null;
  }
}

export default auth(async (req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;
  const session = req.auth;
  const role = session?.user?.role;

  const needsSponsor = path.startsWith('/sponsor');
  const needsOps = path.startsWith('/ops');

  if (needsSponsor || needsOps) {
    // Unauthenticated → /login with a return path.
    if (!session?.user?.userId) {
      const url = new URL('/login', nextUrl);
      url.searchParams.set('callbackUrl', path);
      return NextResponse.redirect(url);
    }
    // Wrong role → send to the caller's own home.
    if (needsSponsor && role !== 'sponsor') {
      return NextResponse.redirect(new URL(homeForRole(role), nextUrl));
    }
    if (needsOps && role !== 'operator') {
      return NextResponse.redirect(new URL(homeForRole(role), nextUrl));
    }
    return NextResponse.next();
  }

  // ── Student onboarding gate ────────────────────────────────────────────────
  // Only signed-in students are gated. Anonymous/other roles pass through (the
  // student pages run their own requireSession('student')).
  if (role !== 'student' || !session?.user?.studentId) {
    return NextResponse.next();
  }

  // Never gate the gate's own route handlers (would loop / block the upload).
  if (path === '/onboarding/state' || path === '/onboarding/extract') {
    return NextResponse.next();
  }

  const onOnboarding = path === '/onboarding' || path.startsWith('/onboarding/');
  const isGatedSurface =
    onOnboarding || STUDENT_GATED.some((p) => path === p || path.startsWith(`${p}/`));
  if (!isGatedSurface) return NextResponse.next();

  const onboarded = await fetchOnboarded(req);
  if (onboarded === null) return NextResponse.next(); // fail open

  if (!onboarded && !onOnboarding) {
    return NextResponse.redirect(new URL('/onboarding', nextUrl));
  }
  if (onboarded && onOnboarding) {
    return NextResponse.redirect(new URL('/', nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    '/',
    '/profile/:path*',
    '/matches/:path*',
    '/interviews/:path*',
    '/settings/:path*',
    '/onboarding',
    '/onboarding/:path*',
    '/sponsor/:path*',
    '/ops/:path*',
  ],
};
