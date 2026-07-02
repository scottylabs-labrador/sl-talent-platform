// Programmatic migrator. Applies everything in ./drizzle in order and tracks
// applied migrations in drizzle's journal table, so it is safe to run
// repeatedly (idempotent). Run: pnpm --filter @tartan/db db:migrate.

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set; cannot migrate.');

  // A dedicated single connection for migrations (max: 1 is required by the
  // postgres-js migrator).
  const sql = postgres(url, { max: 1 });
  const database = drizzle(sql);

  const here = dirname(fileURLToPath(import.meta.url));
  // drizzle/ sits next to src/ at the package root (../drizzle from dist/ or src/).
  const migrationsFolder = resolve(here, '..', 'drizzle');

  try {
    await migrate(database, { migrationsFolder });
    // eslint-disable-next-line no-console
    console.log('Migrations applied from', migrationsFolder);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// CLI entry (tsx src/migrate.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
