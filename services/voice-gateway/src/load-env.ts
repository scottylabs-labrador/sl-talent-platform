// Local-dev convenience: load the workspace-symlinked .env before any other
// module reads process.env. Imported first from index.ts so it runs ahead of
// ./config (which snapshots env at import time).
//
// Guarded twice so it is a strict no-op in production: Railway injects env
// directly and ships no .env file, so `existsSync` is false there; and if the
// platform already set REDIS_URL we never touch the file. This exists only so a
// plain `tsx src/index.ts` / `pnpm dev` boots without the caller remembering
// `--env-file=.env`.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!process.env.REDIS_URL) {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Env may be provided by the platform; loading is best-effort.
    }
  }
}
