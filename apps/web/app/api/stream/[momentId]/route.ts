// GET /api/stream/:momentId — the canonical audio access point. Sponsors never
// receive a durable audio URL: this route license-checks, writes a ledger
// 'stream' event, and 302s to a 60s presigned GET with inline disposition. The
// presigned URL handles Range natively, so the player seeks against S3 directly
// (we never proxy bytes).
//
// Access (either grants a stream):
//   • the owning student (session.studentId === the moment's student), OR
//   • a licensed sponsor member whose org has this student via a shortlist
//     entry under a job the org owns (the delivered-shortlist contract).
// The moment must be student_visible and not struck.

import { NextResponse } from 'next/server';
import {
  and,
  db,
  eq,
  jobs,
  screenMoments,
  screens,
  shortlistEntries,
  shortlists,
} from '@/lib/db';
import { auth } from '@/auth';
import { presignGetUrl } from '@/lib/s3';
import { writeLedgerEvent } from '@/lib/ledger';
import { visibleStudents } from '@/lib/visibility';

const LICENSE = 'Premier: internal recruiting use only';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ momentId: string }> },
): Promise<Response> {
  const { momentId } = await params;

  const session = await auth();
  const user = session?.user;
  if (!user?.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Resolve the moment → its screen → the owning student.
  const rows = await db()
    .select({
      moment: screenMoments,
      studentId: screens.studentId,
    })
    .from(screenMoments)
    .innerJoin(screens, eq(screens.id, screenMoments.screenId))
    .where(eq(screenMoments.id, momentId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const { moment, studentId } = row;

  // The moment must be shareable.
  if (!moment.studentVisible || moment.struck) {
    return NextResponse.json({ error: 'not available' }, { status: 403 });
  }
  if (!moment.clipKey) {
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
    // The org must have this student on a DELIVERED shortlist under a job it
    // owns (human gate), the student must pass the sponsor_visible_students
    // view (visibility + published/approved dossier — the one visibility
    // authority), and a match_only student additionally needs granted reveal.
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
          eq(shortlistEntries.studentId, studentId),
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
      momentId: moment.id,
      durationMs: Math.max(0, moment.tEndMs - moment.tStartMs),
    },
    license,
  });

  // ── 302 to a short-lived presigned GET (inline; Range handled by S3) ────────
  const url = await presignGetUrl(moment.clipKey, {
    ttlSeconds: 60,
    inline: true,
  });
  return NextResponse.redirect(url, 302);
}
