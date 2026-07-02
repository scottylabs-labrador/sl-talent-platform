# ScottyLabs Talent Platform (Tartan Talent)

A boutique recruiting platform operated by ScottyLabs. AI agents interview
students in a 30-minute voice screen, synthesize evidence-backed profiles,
and deliver ranked shortlists of ten to Premier sponsors. Evidence beats
claims, curation beats flooding, reciprocity beats extraction.

Three surfaces share one design system:

- **Student app** (mobile-first): Home, Living Profile with the Talent Graph
  and view-as-sponsor, the CallRoom flow (consent, live call, post-call
  review), Matches, Settings with the Data Ledger.
- **Sponsor portal** (desktop): Dashboard, conversational role intake,
  Shortlist, DossierView with the streaming audio highlight player.
- **Ops console** (internal): exception queue, agent workforce health.

## Stack

TypeScript end to end, strict mode. One shared types package consumed by
every service.

| Piece | Choice |
| --- | --- |
| Web (all three surfaces + API) | Next.js App Router, tRPC v11, Auth.js v5 (Google sign-in) |
| Voice pipeline | Cartesia (streaming STT + Sonic TTS) via a Node WebSocket gateway |
| LLM gateway | OpenRouter (per-agent model routing) |
| System of record | Postgres + pgvector (Drizzle ORM) |
| Queues + session state | Redis (BullMQ) |
| Audio | S3, stream-only via short-TTL presigned URLs, every play ledgered |
| Deploy | Railway (production + dev environments) |

## Monorepo layout

```
apps/web               Next.js: student app, sponsor portal, ops console, tRPC API
services/voice-gateway Node WS service: browser audio in, Cartesia + OpenRouter out
services/workers       BullMQ consumers + scheduled jobs (SLA sweep, retention, digest)
packages/types         zod schemas: API I/O, WS protocol, jsonb columns, agent outputs
packages/db            Drizzle schema, migrations, seed
packages/agents        runAgent OpenRouter client, prompts, guards, embeddings
docs/design-notes      distilled implementation specs from the design handoff
```

## Development

Requires Node 22+ and pnpm 9.

```bash
pnpm install
cp .env.example .env       # fill in DATABASE_URL, REDIS_URL at minimum
pnpm db:migrate            # apply migrations (enables pgvector, guards, views)
pnpm db:seed               # demo data: students, sponsors, shortlists
pnpm dev                   # web on :3000, voice-gateway on :8787, workers
```

Without third-party keys the platform runs fully in **stub mode**: agents
return deterministic schema-valid outputs, embeddings are deterministic unit
vectors, and the CallRoom runs a labeled simulation. Adding
`OPENROUTER_API_KEY` / `CARTESIA_API_KEY` / Google OAuth credentials flips
each integration live with no code change. See `.env.example` for the full
environment contract and `docs/DECISIONS.md` for the reasoning.

## Trust properties (enforced in code)

- `ledger_events` is append-only at the database level (trigger, not
  discipline). Every view, stream, shortlist, export, and edit lands there.
- Coaching reports live in their own table with no query path into any
  sponsor-facing surface.
- Sponsor visibility is enforced in exactly one place, the
  `sponsor_visible_students` view. Web and any future MCP layer both go
  through it.
- Audio is stream-only: sponsors never receive an S3 URL; the stream
  endpoint checks license + visibility, writes a ledger row, then 302s to a
  60-second presigned URL.
- Consent gates recording: nothing is uploaded until both the in-app consent
  and the verbal confirmation exist. Declining strikes the screen.
- `jobs.comp_range` is NOT NULL; intake refuses to confirm without
  compensation disclosure.
- The intake validator refuses filters that proxy protected classes,
  deterministically, before any model sees them.

## Deploy

One Railway project, `production` and `dev` environments, services `web`,
`voice-gateway`, `workers` plus Postgres and Redis. See
`docs/DEPLOY.md` for the full runbook.

---

Designed, developed and maintained with ❤️ by ScottyLabs.
