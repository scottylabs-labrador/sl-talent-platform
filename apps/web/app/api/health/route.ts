// Railway healthcheck. No DB touch — must stay green even if Postgres is down.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ok: true, service: 'web' });
}
