// GET /onboarding/state — the onboarding gate signal for middleware.
//
// Middleware runs on the edge and cannot reach Postgres (the driver is Node
// only), so it fetches this Node route handler with the request cookies
// forwarded. Returns { onboarded: boolean }. Non-students (or any error) return
// onboarded:true so the caller is never trapped in the onboarding flow.
import { auth } from '@/auth';
import { db as getDb, students, eq } from '@tartan/db';
import { resolveOnboarded } from '@/server/routers/student';

export async function GET() {
  try {
    const session = await auth();
    const u = session?.user;
    if (u?.role !== 'student' || !u.studentId) {
      return Response.json({ onboarded: true });
    }
    const db = getDb();
    const rows = await db
      .select({ onboardedAt: students.onboardedAt })
      .from(students)
      .where(eq(students.id, u.studentId))
      .limit(1);
    const onboarded = await resolveOnboarded(db, u.studentId, rows[0]?.onboardedAt ?? null);
    return Response.json({ onboarded });
  } catch {
    // Fail open: a plumbing error must not hard-block navigation.
    return Response.json({ onboarded: true });
  }
}
