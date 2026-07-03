// Resume text extraction for onboarding + the ops create-student tool.
//
// extractResumeText turns an uploaded file's bytes into plain text: PDFs go
// through unpdf (pdf.js compiled for serverless), and anything that is already
// UTF-8 text passes straight through. The extracted text is what we hand to
// @tartan/agents parseResume and stash in students.resume_text (audit +
// re-parse). This runs server-side only (Node route handlers / server actions).
//
// slugify is the shared helper the authoring code reuses to mint a slug for a
// new skill that is not in the seeded taxonomy.

import { extractText, getDocumentProxy } from 'unpdf';

// "%PDF" — the PDF magic number every PDF starts with.
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

function toUint8(file: ArrayBuffer | Uint8Array): Uint8Array {
  return file instanceof Uint8Array ? file : new Uint8Array(file);
}

function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (bytes[i] !== PDF_MAGIC[i]) return false;
  }
  return true;
}

function decodeText(bytes: Uint8Array): string {
  // fatal:false so undecodable bytes become U+FFFD rather than throwing — a
  // best-effort passthrough is more useful here than a hard failure.
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Extract plain text from an uploaded resume.
 *
 * PDFs are parsed with unpdf (all pages merged into one string). Bytes that are
 * not a PDF are treated as already-text and decoded as UTF-8. If PDF parsing
 * fails for any reason we fall back to the decoded bytes rather than throwing,
 * so a mislabeled or slightly-off upload still yields something to parse.
 *
 * @param file  The uploaded bytes (ArrayBuffer from a Request/FormData, or a
 *              Uint8Array).
 * @returns     The extracted text, whitespace-trimmed.
 */
export async function extractResumeText(
  file: ArrayBuffer | Uint8Array,
): Promise<string> {
  const bytes = toUint8(file);

  if (looksLikePdf(bytes)) {
    try {
      // Copy into a fresh buffer: pdf.js may transfer/detach the array it is
      // handed, which would corrupt a caller-owned view.
      const copy = bytes.slice();
      const pdf = await getDocumentProxy(copy);
      const { text } = await extractText(pdf, { mergePages: true });
      const trimmed = text.trim();
      if (trimmed) return trimmed;
      // A PDF that yielded no text (e.g. scanned images) — fall through to the
      // raw decode, which at least surfaces any embedded text streams.
    } catch {
      // Malformed or unsupported PDF: fall back to a best-effort text decode.
    }
  }

  return decodeText(bytes).trim();
}

/**
 * Deterministic slug from a human skill name, for skills not in the seeded
 * taxonomy. Lowercases, replaces any run of non-alphanumeric characters with a
 * single hyphen, and trims leading/trailing hyphens. e.g. "Rust" -> "rust",
 * "Web Application Development" -> "web-application-development".
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
