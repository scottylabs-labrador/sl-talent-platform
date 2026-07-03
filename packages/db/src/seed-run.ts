// CLI entry for the seed. Run: pnpm --filter @tartan/db db:seed.
// Opens the lazy client, runs the idempotent seed(), reports per-table counts,
// closes the pool.

import { db, closeDb } from './client.js';
import { seed } from './seed.js';

async function main(): Promise<void> {
  const r = await seed(db());
  // eslint-disable-next-line no-console
  console.log(
    'Reference seed complete (idempotent). Row counts:\n' +
      [`  skills   ${r.skills}`, `  config   ${r.config}`].join('\n'),
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
