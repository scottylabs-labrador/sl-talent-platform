// GET /api/stream/answer/:entryId — the async follow-up answer audio access
// point. Mirrors /api/stream/:momentId exactly: sponsors never receive a durable
// URL, this route license-checks, writes a ledger 'stream' event, and 302s to a
// 60s presigned GET with inline disposition (Range handled by S3).
//
// Access (either grants a stream):
//   • the owning student (session.studentId === the entry's student), OR
//   • a licensed sponsor member whose org has this entry on a DELIVERED
//     shortlist under a job the org owns (the delivered-shortlist contract),
//     with the student passing the visibility view + the reveal gate.
// The entry must carry an async_answer with an audioKey.

import { NextResponse } from 'next/server';
import { and, db, eq, jobs, shortlistEntries, shortlists } from '@/lib/db';
import { auth } from '@/auth';
import { presignGetUrl } from '@/lib/s3';
import { writeLedgerEvent } from '@/lib/ledger';
import { visibleStudents } from '@/lib/visibility';

const LICENSE = 'Premier: internal recruiting use only';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ entryId: string }> },
): Promise<Response> {
  const { entryId } = await params;

  const session = await auth();
  const user = session?.user;
  if (!user?.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Resolve the entry → its student + the answer payload.
  const rows = await db()
    .select({
      studentId: shortlistEntries.studentId,
      asyncAnswer: shortlistEntries.asyncAnswer,
    })
    .from(shortlistEntries)
    .where(eq(shortlistEntries.id, entryId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const { studentId, asyncAnswer } = row;
  const audioKey = asyncAnswer?.audioKey ?? null;
  if (!audioKey) {
    return NextResponse.json({ error: 'no clip' }, { status: 404 });
  }

  // ── access check ──────────────────────────────────────────────────────────
  let actorKind: 'student' | 'sponsor';
  let actorId: string;
  let license: string | null;

  if (user.role === 'student' && user.studentId === studentId) {
    actorKind = 'student';
    actorId = user.studentId;
    license = null;
  } else if (user.role === 'sponsor' && user.orgId) {
    // The org must have this entry on a DELIVERED shortlist under a job it owns
    // (human gate), the student must pass the sponsor_visible_students view (the
    // one visibility authority), and a match_only student additionally needs a
    // granted reveal.
    const grant = await db()
      .select({
        entryId: shortlistEntries.id,
        kind: shortlistEntries.kind,
        revealConsent: shortlistEntries.revealConsent,
      })
      .from(shortlistEntries)
      .innerJoin(shortlists, eq(shortlists.id, shortlistEntries.shortlistId))
      .innerJoin(jobs, eq(jobs.id, shortlists.jobId))
      .where(
        and(
          eq(shortlistEntries.id, entryId),
          eq(jobs.orgId, user.orgId),
          eq(shortlists.status, 'delivered'),
        ),
      )
      .limit(1);
    if (!grant[0]) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const visible = await visibleStudents([studentId]);
    const v = visible.get(studentId);
    if (!v) {
      // Paused / unpublished students are never streamable by sponsors.
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (v.reveal_required && grant[0].revealConsent !== 'granted') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    actorKind = 'sponsor';
    actorId = user.orgId;
    license = LICENSE;
  } else {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // ── ledger: every play lands in the student's ledger ────────────────────────
  await writeLedgerEvent({
    studentId,
    actorKind,
    actorId,
    kind: 'stream',
    detail: {
      kind: 'stream',
      note: 'Recruiter follow-up answer played.',
    },
    license,
  });

  // ── 302 to a short-lived presigned GET (inline; Range handled by S3) ────────
  const url = await presignGetUrl(audioKey, { ttlSeconds: 60, inline: true });
  return NextResponse.redirect(url, 302);
}
