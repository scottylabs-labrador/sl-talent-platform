// CLI entry for the seed. Run: pnpm --filter @tartan/db db:seed.
// Opens the lazy client, runs the idempotent seed(), reports counts, closes.

import { db, closeDb } from './client.js';
import { seed } from './seed.js';

async function main(): Promise<void> {
  const result = await seed(db());
  // eslint-disable-next-line no-console
  console.log(
    `Seed complete: +${result.skills} skills, +${result.config} config rows, ` +
      `+${result.demoEntities} demo entities (idempotent — existing rows skipped).`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDb();
  });
