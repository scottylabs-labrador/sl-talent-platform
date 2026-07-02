// Route guard (edge). Decodes the JWT via the edge-safe authConfig and gates
// the sponsor + ops surfaces. Students land at '/', which is not guarded here.
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig, homeForRole } from './auth.config';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;
  const session = req.auth;
  const role = session?.user?.role;

  const needsSponsor = path.startsWith('/sponsor');
  const needsOps = path.startsWith('/ops');
  if (!needsSponsor && !needsOps) return NextResponse.next();

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
});

export const config = {
  matcher: ['/sponsor/:path*', '/ops/:path*'],
};
