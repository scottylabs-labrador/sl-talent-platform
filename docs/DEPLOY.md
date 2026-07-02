# Deploy runbook (Railway)

One Railway project (**ScottyLabs Talent Platform**) with two environments,
`production` and `dev`. Each environment has its own Postgres (pgvector
enabled) and Redis. Three app services deploy from this repo: `web`,
`voice-gateway`, `workers`.

## Service configuration

Config-as-code lives in `deploy/railway/*.json` (one file per service; set
as each service's config file path in service settings). Every service
builds from the repo root with pnpm workspace filters and starts via its
package's `start` script. Healthchecks: web `/api/health`, gateway
`/health`, workers `/health`.

## Environment variables

Set per environment on each service. Database and Redis URLs use Railway
reference variables so credentials rotate with the plugin:

| Variable | production | dev |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | `${{Postgres-3T4D.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | `${{Redis-rpal.REDIS_URL}}` |
| `S3_BUCKET` | `tartan-talent-audio-prod` | `tartan-talent-audio-dev` |

Plus (both environments, values in the ScottyLabs vault / local `.env`):
`AUTH_SECRET` (distinct per env), `AUTH_URL`/`APP_URL` (the web service's
public URL), `AUTH_TRUST_HOST=true`, `WS_URL` (the gateway's public wss URL),
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (IAM user `tartan-talent-app`),
`S3_REGION=us-east-1`, `DEV_LOGIN` (until Google OAuth is configured),
`OPENROUTER_MODEL_*` routing (see `.env.example`), and when available:
`OPENROUTER_API_KEY`, `CARTESIA_API_KEY`, `EMBEDDINGS_API_KEY`,
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.

## Deploying

```bash
railway environment production   # or dev
railway up --service web --ci
railway up --service voice-gateway --ci
railway up --service workers --ci
```

## Database migrations and seed

Migrations run from a local checkout against the environment's public
database URL:

```bash
DATABASE_URL=<env public URL> pnpm db:migrate
DATABASE_URL=<env public URL> pnpm db:seed   # demo data; idempotent
```

The seed also synthesizes demo audio clips and uploads them to both S3
buckets (requires `say` + `ffmpeg` locally and AWS credentials).

## Scheduled jobs

BullMQ repeatable jobs run inside `workers` (SLA sweep every 5 minutes,
retention sweep daily, Monday digest, adverse-impact rollup weekly). Manual
trigger: `POST /trigger/:job` on the workers service with header
`X-Trigger-Key: $AUTH_SECRET`.
