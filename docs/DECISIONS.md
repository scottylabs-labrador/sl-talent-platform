# Engineering decisions

Running log of implementation decisions where the architecture spec left room
(the spec says: "opinionated defaults, argue with any of them").

## D1. Styling: CSS custom properties + CSS Modules, no Tailwind

The design system is a bespoke token set (exact hexes, px sizes, easing
curves) that must be recreated pixel-perfectly. Hand-written CSS against
`tokens.css` custom properties ports the prototype styles verbatim with zero
translation loss. Tailwind would add a mapping layer without adding value.

## D2. Cron: BullMQ repeatable jobs inside the workers service

The spec sketches a separate `cron` Railway service hitting worker endpoints.
Railway cron works by restarting a service on a schedule, which fits
run-to-completion processes, not our long-lived worker. BullMQ repeatable
jobs give the same schedules (SLA sweep 5 min, retention daily, digest
Monday, adverse-impact weekly) inside the already-running workers service,
with Redis-backed locking so exactly one worker fires each tick. The workers
service also exposes `POST /trigger/:job` for manual runs, so the operational
surface the spec wanted (an endpoint per scheduled job) still exists.

## D3. Demo login alongside Google SSO

Google OAuth requires a client ID/secret provisioned in the ScottyLabs Google
Cloud console. The full Auth.js Google flow (including server-side `hd`
verification for students) is implemented, but until those credentials are
added to the environment, a credentials-based demo login (`DEV_LOGIN=true`)
signs into seeded demo accounts (student / sponsor / operator). This keeps
every flow demonstrable end to end. Disable by removing `DEV_LOGIN` once
Google credentials exist.

## D4. Stub modes for external AI services

`packages/agents` runs against OpenRouter when `OPENROUTER_API_KEY` is set;
without it, every agent returns deterministic schema-valid stub output and
logs `agent_runs` rows with `model='stub'`. Same for embeddings
(deterministic unit vectors) and the Cartesia voice loop (the CallRoom runs a
clearly-labeled simulation). The production code path is identical either
way; only the transport is swapped. Adding keys flips the platform to real AI
with no code change.

## D5. Real S3 (AWS), scoped IAM user

Buckets `tartan-talent-audio-prod` / `tartan-talent-audio-dev` (us-east-1,
private, SSE-S3, 24-month lifecycle expiry as the retention backstop). The
app authenticates as IAM user `tartan-talent-app` whose policy grants object
CRUD on exactly those two buckets and nothing else. Root credentials are
never used by the app.

## D6. Append-only ledger enforced with a trigger, not grants

The spec says "enforce with grants, not discipline", but on Railway the app
connects as the table owner, and owners bypass their own grants. A database
trigger raising on UPDATE/DELETE binds every role including the owner, which
is strictly stronger.

## D8. Per-agent model routing (July 2026 pricing)

Chosen by comparing OpenRouter's live catalog against each agent's role in
the architecture spec (section 6). Prices are $/MTok in/out. Override any
of these per environment via `OPENROUTER_MODEL_*`.

| Agent | Model | Price | Rationale |
| --- | --- | --- | --- |
| rep | `anthropic/claude-haiku-4.5` | 1 / 5 | Realtime voice loop: latency beats brilliance. Live-tested via OpenRouter: 0.90s first token streaming, clean tool calls, warm tone. (`google/gemini-3.5-flash` was rejected after live testing: OpenRouter mandates reasoning on that endpoint, pushing first-token latency to 2.5s. `google/gemini-3.1-flash-lite` at 0.73s TTFT is the budget alternative.) |
| synthesizer | `anthropic/claude-opus-4.8` | 5 / 25 | The dossier is the product artifact. ~$0.20 per screen at full transcript length; negligible against the $2-5/screen budget. |
| recruiter | `anthropic/claude-opus-4.8` | 5 / 25 | Ranking correctness and refusal compliance are trust-critical. ~$0.60 per shortlist on a 30-candidate longlist. |
| verifier | `openai/gpt-5.4-nano` | 0.20 / 1.25 | Spec calls for a cheap small model; deterministic code does the real checks. |
| concierge | `anthropic/claude-sonnet-5` | 2 / 10 (intro) | Sponsor-facing intake quality directly shapes shortlist quality; near-Opus at a third the cost during intro pricing. |
| coach | `anthropic/claude-sonnet-5` | 2 / 10 | Warm, specific writing for the student-facing report; ~$0.03/report. |
| sentinel | `google/gemini-3.1-flash-lite` | 0.25 / 1.50 | 1M context digests a week of agent_runs in one pass, cheaply. |

Estimated steady-state LLM spend at pilot scale (50 students, 2 sponsors):
well under $100/month, dominated by the rep's realtime tokens. Budget caps
per agent live in `config` and the Sentinel alerts at 80% (per spec).

## D7. MCP service deferred (Phase 2, per spec)

The spec marks the MCP server as Phase 2. Not built in v1; the authz
layer it would share (the `sponsor_visible_students` view) exists.
