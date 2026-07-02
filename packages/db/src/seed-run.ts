// CLI entry for the seed. Run: pnpm --filter @tartan/db db:seed.
// Opens the lazy client, runs the idempotent seed(), reports per-table counts,
// closes the pool.

import { db, closeDb } from './client.js';
import { seed } from './seed.js';

async function main(): Promise<void> {
  const r = await seed(db());
  // eslint-disable-next-line no-console
  console.log(
    'Seed complete (idempotent — re-running does not duplicate). Table counts:\n' +
      [
        `  skills             ${r.skills}`,
        `  config             ${r.config}`,
        `  users              ${r.users}`,
        `  students           ${r.students}`,
        `  screens            ${r.screens}`,
        `  screen_moments     ${r.screenMoments}`,
        `  dossiers           ${r.dossiers}`,
        `  shortlist_entries  ${r.shortlistEntries}`,
        `  exceptions         ${r.exceptions}`,
        `  ledger_events      ${r.ledgerEvents}`,
        `  agent_runs         ${r.agentRuns}`,
      ].join('\n'),
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
