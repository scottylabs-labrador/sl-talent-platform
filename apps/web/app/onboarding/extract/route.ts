// POST /onboarding/extract — PDF/text → plain text, for the resume jump-start.
//
// unpdf is server-side only, so the wizard uploads the raw file here and gets
// back extracted text, then calls student.parseResume({ text }) over tRPC.
// Multipart form with a single `file` field. Student-scoped.
import { auth } from '@/auth';
import { extractResumeText } from '@/lib/resume';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — a resume, not a book.

export async function POST(req: Request) {
  const session = await auth();
  const u = session?.user;
  if (u?.role !== 'student' || !u.studentId) {
    return Response.json({ error: 'student access required' }, { status: 403 });
  }
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'no file' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: 'file too large' }, { status: 413 });
    }
    const text = await extractResumeText(await file.arrayBuffer());
    if (!text) {
      return Response.json({ error: 'no text found in file' }, { status: 422 });
    }
    return Response.json({ text });
  } catch {
    return Response.json({ error: 'could not read that file' }, { status: 500 });
  }
}
