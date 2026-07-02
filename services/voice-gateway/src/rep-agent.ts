// The Talent Rep turn, for the REAL pipeline. Wraps @tartan/agents runAgent.
//
// runAgent does not expose OpenRouter native tool-calling; it does free-text
// (streamed) or strict-JSON structured output. To get the Rep's four tools
// (advance_section, mark_moment, confirm_verbal_consent, flag_escalation) with
// the reply in one call, we run in STRUCTURED mode against the RepTurn schema
// below. Tradeoff (noted for the integrator): structured mode is parsed whole,
// so we lose token-by-token streaming into TTS; we sentence-chunk the returned
// reply instead. If low first-audio latency becomes critical, switch to native
// OpenRouter tool-calling in @tartan/agents and stream the reply delta.

import { z } from 'zod';
import { runAgent, REP_PROMPT } from '@tartan/agents';
import type { AgentMessage, AgentUsage } from '@tartan/agents';

export const RepToolCall = z.discriminatedUnion('name', [
  z.object({ name: z.literal('advance_section') }),
  z.object({
    name: z.literal('mark_moment'),
    tag: z.string(),
    note: z.string().optional(),
  }),
  z.object({ name: z.literal('confirm_verbal_consent') }),
  z.object({ name: z.literal('flag_escalation'), reason: z.string() }),
]);
export type RepToolCall = z.infer<typeof RepToolCall>;

export const RepTurn = z.object({
  // What the Rep says next (short; one or two sentences).
  reply: z.string(),
  // Tool calls to apply after speaking, in order.
  tools: z.array(RepToolCall),
});
export type RepTurn = z.infer<typeof RepTurn>;

function stateNote(args: {
  sectionName: string;
  sectionIndex: number;
  elapsedMs: number;
  consentConfirmed: boolean;
}): string {
  const mm = Math.floor(args.elapsedMs / 60_000);
  const ss = Math.floor((args.elapsedMs % 60_000) / 1000);
  const clock = `${mm}:${String(ss).padStart(2, '0')}`;
  return [
    `Current section: ${args.sectionIndex + 1} of 6 (${args.sectionName}).`,
    `Elapsed: ${clock} of 30:00.`,
    args.consentConfirmed
      ? 'Verbal consent has been confirmed; substantive questions are allowed.'
      : 'Verbal consent NOT yet confirmed; stay in the intro until you get a clear spoken yes, then use confirm_verbal_consent.',
    'Respond ONLY as JSON: {"reply": <what you say next>, "tools": [<any tool calls>]}. Keep reply to one or two sentences.',
  ].join(' ');
}

export interface RepTurnResult {
  reply: string;
  tools: RepToolCall[];
  usage: AgentUsage;
  model: string;
}

export async function runRepTurn(args: {
  history: AgentMessage[];
  sectionName: string;
  sectionIndex: number;
  elapsedMs: number;
  consentConfirmed: boolean;
  screenId: string;
}): Promise<RepTurnResult> {
  const res = await runAgent(
    'rep',
    {
      system: `${REP_PROMPT}\n\n${stateNote(args)}`,
      messages: args.history,
      maxTokens: 400,
    },
    { schema: RepTurn, inputRef: `screen:${args.screenId}:rep`, temperature: 0.5 },
  );
  return {
    reply: res.output.reply,
    tools: res.output.tools,
    usage: res.usage,
    model: res.model,
  };
}

/** Split a reply into sentence-ish chunks for streaming into TTS. */
export function sentenceChunks(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
  return (parts ?? [text]).map((s) => s.trim()).filter((s) => s.length > 0);
}
