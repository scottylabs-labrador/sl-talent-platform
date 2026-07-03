// parseResume — the resume-parse jump-start the web onboarding flow calls.
//
// Runs on the Synthesizer model (claude-opus-4.8) with the dedicated
// RESUME_PARSE_PROMPT and is held to the ResumeParseResult schema (strict JSON,
// zod-validated with one self-correcting retry, all inside runAgent). When
// OPENROUTER_API_KEY is unset it serves the deterministic stubResumeParseResult
// so onboarding works in demos with no external dependency.
//
// A resume is a claim, not proof: everything this returns is self-reported. The
// caller lands skills/evidence as pending/self_reported and verified=false; the
// verification worker is the only thing that can promote them.

import { ResumeParseResult } from '@tartan/types';
import { runAgent } from './client.js';
import { RESUME_PARSE_PROMPT, RESUME_PARSE_PROMPT_VERSION } from './prompts.js';

/**
 * Extract a structured onboarding draft from raw resume text.
 *
 * @param text  The resume's plain text (from lib/resume.ts extractResumeText).
 * @returns     A schema-valid ResumeParseResult; sparse resumes yield sparse
 *              drafts (every field is optional-tolerant). Throws only if the
 *              model output fails the schema after the built-in retry.
 */
export async function parseResume(text: string): Promise<ResumeParseResult> {
  const { output } = await runAgent(
    'synthesizer',
    {
      system: RESUME_PARSE_PROMPT,
      messages: [{ role: 'user', content: text }],
    },
    {
      schema: ResumeParseResult,
      inputRef: 'resume:parse',
      promptVersion: RESUME_PARSE_PROMPT_VERSION,
    },
  );
  return output;
}
