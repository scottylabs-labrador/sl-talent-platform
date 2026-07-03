// runAgent — the one thin internal client for every OpenRouter call
// (ARCHITECTURE section 6). Handles per-agent model routing, structured outputs
// (JSON-schema strict mode derived from the same zod schema the app uses),
// streaming, usage/cost capture, and an agent_runs audit row per call. When
// OPENROUTER_API_KEY is unset it serves deterministic stub outputs so every
// downstream flow works in demos.

import type { ZodTypeAny, infer as zInfer } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Providers' structured-output implementations (notably Anthropic via
// OpenRouter) reject constraint keywords like minimum/maximum/minLength.
// Strip them from the wire schema only — zod still enforces the real
// constraints when the response is parsed, and the validation-retry loop
// self-corrects violations.
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'default',
]);

function sanitizeWireSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeWireSchema);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    // `properties` maps arbitrary field names (which may collide with the
    // keyword list) to schemas — recurse into values without key filtering.
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      const props: Record<string, unknown> = {};
      for (const [prop, sub] of Object.entries(value as Record<string, unknown>)) {
        props[prop] = sanitizeWireSchema(sub);
      }
      out[key] = props;
      continue;
    }
    out[key] = sanitizeWireSchema(value);
  }
  return out;
}
import type { AgentName, AgentRunOutput } from '@tartan/types';
import { db, agentRuns } from '@tartan/db';
import { getStubOutput, STUB_TEXT } from './stubs.js';
import { PROMPT_VERSION } from './prompts.js';

const OPENROUTER_URL =
  process.env.OPENROUTER_BASE_URL ??
  'https://openrouter.ai/api/v1/chat/completions';

// Fallback model routing (overridden per env). Mirrors .env.example.
const FALLBACK_MODELS: Record<AgentName, string> = {
  rep: 'anthropic/claude-haiku-4.5',
  synthesizer: 'anthropic/claude-opus-4.8',
  recruiter: 'anthropic/claude-opus-4.8',
  verifier: 'openai/gpt-5.4-nano',
  concierge: 'anthropic/claude-sonnet-5',
  coach: 'anthropic/claude-sonnet-5',
  sentinel: 'google/gemini-3.1-flash-lite',
};

const ENV_MODEL_KEY: Record<AgentName, string> = {
  rep: 'OPENROUTER_MODEL_REP',
  synthesizer: 'OPENROUTER_MODEL_SYNTH',
  recruiter: 'OPENROUTER_MODEL_RECRUITER',
  verifier: 'OPENROUTER_MODEL_VERIFIER',
  concierge: 'OPENROUTER_MODEL_CONCIERGE',
  coach: 'OPENROUTER_MODEL_COACH',
  sentinel: 'OPENROUTER_MODEL_SENTINEL',
};

export function modelFor(agent: AgentName): string {
  return process.env[ENV_MODEL_KEY[agent]] ?? FALLBACK_MODELS[agent];
}

export type AgentRole = 'system' | 'user' | 'assistant';
export interface AgentMessage {
  role: AgentRole;
  content: string;
}

export interface AgentInput {
  /** Prepended as a system message. Usually the versioned prompt for the agent. */
  system?: string;
  messages: AgentMessage[];
  maxTokens?: number;
}

export interface RunOptions<S extends ZodTypeAny = ZodTypeAny> {
  /** When present, the model is held to this schema (strict JSON) and the
   *  result is zod-validated (one retry on failure). */
  schema?: S;
  /** Streaming token callback. Ignored in schema mode (structured outputs are
   *  parsed whole). */
  stream?: (delta: string) => void;
  temperature?: number;
  /** Short description or hash of the input, for the agent_runs audit row. */
  inputRef?: string;
  /** Override the prompt version recorded in agent_runs. */
  promptVersion?: string;
}

export interface AgentUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface AgentResult<T> {
  output: T;
  text: string;
  usage: AgentUsage;
  model: string;
  stub: boolean;
}

let stubWarned = false;
function warnStubOnce(): void {
  if (stubWarned) return;
  stubWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[agents] OPENROUTER_API_KEY unset — runAgent is serving deterministic stub outputs.',
  );
}

// ── agent_runs logging (fire-and-forget; never on the latency path) ──────────

interface AgentRunLog {
  agent: AgentName;
  model: string;
  promptVersion: string | null;
  inputRef: string | null;
  output: AgentRunOutput;
  confidence: number | null;
  costUsd: number | null;
  tokens: number | null;
  flagged: boolean;
}

function logAgentRun(row: AgentRunLog): void {
  // Demo/build environments may have no DB; skip silently rather than throw.
  if (!process.env.DATABASE_URL) return;
  try {
    void db()
      .insert(agentRuns)
      .values({
        agent: row.agent,
        model: row.model,
        promptVersion: row.promptVersion,
        inputRef: row.inputRef,
        output: row.output,
        confidence: row.confidence,
        costUsd: row.costUsd === null ? null : row.costUsd.toString(),
        tokens: row.tokens,
        flagged: row.flagged,
      })
      // eslint-disable-next-line no-console
      .catch((e: unknown) => console.error('[agent_runs] insert failed:', e));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[agent_runs] insert skipped:', e);
  }
}

function readConfidence(value: unknown): number | null {
  if (value && typeof value === 'object' && 'confidence' in value) {
    const c = (value as { confidence?: unknown }).confidence;
    if (typeof c === 'number') return c;
  }
  return null;
}

// ── OpenRouter response shapes (the slice we read) ───────────────────────────

interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}
interface ChatCompletion {
  choices: { message?: { content?: string | null } }[];
  usage?: ChatUsage;
}

function mapUsage(u: ChatUsage | undefined): AgentUsage {
  return {
    promptTokens: u?.prompt_tokens,
    completionTokens: u?.completion_tokens,
    totalTokens: u?.total_tokens,
    costUsd: u?.cost,
  };
}

function buildMessages(input: AgentInput): AgentMessage[] {
  const msgs: AgentMessage[] = [];
  if (input.system) msgs.push({ role: 'system', content: input.system });
  return msgs.concat(input.messages);
}

function orHeaders(key: string): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${key}`,
  };
  // Optional OpenRouter attribution headers.
  if (process.env.APP_URL) h['HTTP-Referer'] = process.env.APP_URL;
  h['X-Title'] = 'Tartan Talent';
  return h;
}

// ── Non-streaming POST ───────────────────────────────────────────────────────

async function postChat(
  key: string,
  body: Record<string, unknown>,
): Promise<ChatCompletion> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: orHeaders(key),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `OpenRouter request failed: ${res.status} ${res.statusText} ${text}`.trim(),
    );
  }
  return (await res.json()) as ChatCompletion;
}

// ── Streaming POST (SSE) ─────────────────────────────────────────────────────

interface StreamResult {
  text: string;
  usage: AgentUsage;
}

async function streamChat(
  key: string,
  body: Record<string, unknown>,
  onDelta: (delta: string) => void,
): Promise<StreamResult> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: orHeaders(key),
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `OpenRouter stream failed: ${res.status} ${res.statusText} ${text}`.trim(),
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usage: AgentUsage = {};

  // SSE frames are separated by blank lines; each has one or more `data:` lines.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice('data:'.length).trim();
      if (payload === '[DONE]') continue;
      let frame: {
        choices?: { delta?: { content?: string | null } }[];
        usage?: ChatUsage;
      };
      try {
        frame = JSON.parse(payload);
      } catch {
        continue; // ignore keep-alive / malformed frames
      }
      const delta = frame.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      if (frame.usage) usage = mapUsage(frame.usage);
    }
  }

  return { text, usage };
}

// ── runAgent ─────────────────────────────────────────────────────────────────

export function runAgent<S extends ZodTypeAny>(
  agent: AgentName,
  input: AgentInput,
  opts: RunOptions<S> & { schema: S },
): Promise<AgentResult<zInfer<S>>>;
export function runAgent(
  agent: AgentName,
  input: AgentInput,
  opts?: RunOptions,
): Promise<AgentResult<string>>;
export async function runAgent<S extends ZodTypeAny>(
  agent: AgentName,
  input: AgentInput,
  opts: RunOptions<S> = {},
): Promise<AgentResult<unknown>> {
  const model = modelFor(agent);
  const promptVersion = opts.promptVersion ?? PROMPT_VERSION[agent] ?? null;
  const inputRef = opts.inputRef ?? null;
  const key = process.env.OPENROUTER_API_KEY;

  // ── STUB MODE ──────────────────────────────────────────────────────────────
  if (!key) {
    warnStubOnce();
    if (opts.schema) {
      const stub = getStubOutput(opts.schema);
      if (stub === null) {
        throw new Error(
          `No stub output registered for the requested schema (agent="${agent}"). ` +
            `Add a canned value to stubs.ts.`,
        );
      }
      logAgentRun({
        agent,
        model: 'stub',
        promptVersion,
        inputRef,
        output: { confidence: readConfidence(stub) ?? undefined, result: stub },
        confidence: readConfidence(stub),
        costUsd: 0,
        tokens: 0,
        flagged: false,
      });
      return { output: stub, text: JSON.stringify(stub), usage: {}, model: 'stub', stub: true };
    }
    // Free-text stub (e.g. the Rep). Emit it through the stream callback too.
    if (opts.stream) opts.stream(STUB_TEXT);
    logAgentRun({
      agent,
      model: 'stub',
      promptVersion,
      inputRef,
      output: { result: STUB_TEXT },
      confidence: null,
      costUsd: 0,
      tokens: 0,
      flagged: false,
    });
    return { output: STUB_TEXT, text: STUB_TEXT, usage: {}, model: 'stub', stub: true };
  }

  // ── LIVE MODE ──────────────────────────────────────────────────────────────
  const baseBody: Record<string, unknown> = {
    model,
    messages: buildMessages(input),
    usage: { include: true },
  };
  if (typeof opts.temperature === 'number') baseBody['temperature'] = opts.temperature;
  if (typeof input.maxTokens === 'number') baseBody['max_tokens'] = input.maxTokens;

  try {
    // ── Structured output (schema) ──────────────────────────────────────────
    if (opts.schema) {
      const jsonSchema = sanitizeWireSchema(
        zodToJsonSchema(opts.schema, { target: 'openAi' }),
      );
      const body: Record<string, unknown> = {
        ...baseBody,
        response_format: {
          type: 'json_schema',
          json_schema: { name: `${agent}_output`, strict: true, schema: jsonSchema },
        },
      };

      const attempt = async (
        messages: AgentMessage[],
      ): Promise<{ raw: string; usage: AgentUsage }> => {
        const completion = await postChat(key, { ...body, messages });
        return {
          raw: completion.choices[0]?.message?.content ?? '',
          usage: mapUsage(completion.usage),
        };
      };

      let messages = buildMessages(input);
      let { raw, usage } = await attempt(messages);
      let parsed = opts.schema.safeParse(safeJsonParse(raw));

      // One retry with the validation error appended (self-correction).
      if (!parsed.success) {
        messages = messages.concat(
          { role: 'assistant', content: raw },
          {
            role: 'user',
            content:
              'Your previous response did not match the required JSON schema. ' +
              `Fix these validation errors and return only valid JSON:\n${parsed.error.message}`,
          },
        );
        ({ raw, usage } = await attempt(messages));
        parsed = opts.schema.safeParse(safeJsonParse(raw));
      }

      if (!parsed.success) {
        logAgentRun({
          agent,
          model,
          promptVersion,
          inputRef,
          output: { result: raw, error: `schema validation failed: ${parsed.error.message}` },
          confidence: null,
          costUsd: usage.costUsd ?? null,
          tokens: usage.totalTokens ?? null,
          flagged: true,
        });
        throw new Error(
          `Agent "${agent}" output failed schema validation after retry: ${parsed.error.message}`,
        );
      }

      logAgentRun({
        agent,
        model,
        promptVersion,
        inputRef,
        output: { confidence: readConfidence(parsed.data) ?? undefined, result: parsed.data },
        confidence: readConfidence(parsed.data),
        costUsd: usage.costUsd ?? null,
        tokens: usage.totalTokens ?? null,
        flagged: false,
      });
      return { output: parsed.data, text: raw, usage, model, stub: false };
    }

    // ── Free text (optionally streamed) ─────────────────────────────────────
    let text: string;
    let usage: AgentUsage;
    if (opts.stream) {
      ({ text, usage } = await streamChat(key, baseBody, opts.stream));
    } else {
      const completion = await postChat(key, baseBody);
      text = completion.choices[0]?.message?.content ?? '';
      usage = mapUsage(completion.usage);
    }

    logAgentRun({
      agent,
      model,
      promptVersion,
      inputRef,
      output: { result: text },
      confidence: null,
      costUsd: usage.costUsd ?? null,
      tokens: usage.totalTokens ?? null,
      flagged: false,
    });
    return { output: text, text, usage, model, stub: false };
  } catch (err) {
    // Record the failure (flagged) unless it was already logged above.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.startsWith(`Agent "${agent}" output failed schema`)) {
      logAgentRun({
        agent,
        model,
        promptVersion,
        inputRef,
        output: { result: null, error: message },
        confidence: null,
        costUsd: null,
        tokens: null,
        flagged: true,
      });
    }
    throw err;
  }
}

function safeJsonParse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined; // empty content → zod rejects → retry
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some models wrap JSON in ```json fences or add a preamble even under
    // json_schema mode. Strip fences, then fall back to the outermost object.
    const unfenced = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    try {
      return JSON.parse(unfenced);
    } catch {
      const first = unfenced.indexOf('{');
      const last = unfenced.lastIndexOf('}');
      if (first !== -1 && last > first) {
        try {
          return JSON.parse(unfenced.slice(first, last + 1));
        } catch {
          /* fall through */
        }
      }
      return undefined;
    }
  }
}
