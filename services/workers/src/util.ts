// Small shared helpers for the workers: transcript flattening and a typed
// exceptions insert (the ops queue's rows, ARCHITECTURE section 3/6/9).

import { db, exceptions } from '@tartan/db';
import type {
  AgentName,
  ExceptionCategory,
  ExceptionContext,
  Transcript,
} from '@tartan/types';

/** Flatten a word-level transcript into speaker-tagged turns for an LLM prompt. */
export function transcriptToText(transcript: Transcript | null | undefined): string {
  if (!transcript || transcript.length === 0) return '';
  const lines: string[] = [];
  let speaker: string | null = null;
  let buf: string[] = [];
  const flush = (): void => {
    if (buf.length > 0 && speaker) {
      lines.push(`${speaker}: ${buf.join(' ')}`);
      buf = [];
    }
  };
  for (const w of transcript) {
    if (w.speaker !== speaker) {
      flush();
      speaker = w.speaker;
    }
    buf.push(w.word);
  }
  flush();
  return lines.join('\n');
}

export interface FileExceptionArgs {
  category: ExceptionCategory;
  agent?: AgentName;
  context: ExceptionContext;
  recommendation?: string;
}

/** Insert an ops exception (status defaults to 'open'). Returns the new id. */
export async function fileException(args: FileExceptionArgs): Promise<string> {
  const [row] = await db()
    .insert(exceptions)
    .values({
      category: args.category,
      agent: args.agent ?? null,
      context: args.context,
      recommendation: args.recommendation ?? null,
    })
    .returning({ id: exceptions.id });
  return row!.id;
}

/** Best-effort JSON stringify for inputRef audit hints (bounded length). */
export function inputRef(obj: unknown): string {
  try {
    const s = JSON.stringify(obj);
    return s.length > 200 ? s.slice(0, 200) : s;
  } catch {
    return '';
  }
}
