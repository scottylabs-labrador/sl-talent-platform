// monday_digest (weekly) — the brief's step 8. The Sentinel agent summarizes the
// last 7 days of agent_runs + exceptions into config key ops.week_digest, which
// the ops console renders. Cost alerts fire at 80% of an agent's monthly budget
// (the Sentinel judges from the figures we hand it).

import { rawSql } from '@tartan/db';
import { runAgent, SENTINEL_PROMPT } from '@tartan/agents';
import { SentinelDigest } from '@tartan/types';
import { writeConfig } from '../config.js';
import { DRY_RUN } from '../env.js';
import { log } from '../logger.js';
import { inputRef } from '../util.js';

const SCOPE = 'monday_digest';

interface AgentAgg {
  agent: string;
  runs: number;
  cost: number;
  tokens: number;
  flagged: number;
}
interface ExceptionAgg {
  category: string;
  status: string;
  n: number;
}

export async function mondayDigest(): Promise<void> {
  if (DRY_RUN) {
    log.info(SCOPE, 'dry-run: skipping digest (no agent call, no write)');
    return;
  }

  const sqlc = rawSql();
  const agentRows = await sqlc<AgentAgg[]>`
    SELECT agent,
           count(*)::int AS runs,
           coalesce(sum(cost_usd), 0)::float AS cost,
           coalesce(sum(tokens), 0)::int AS tokens,
           sum(CASE WHEN flagged THEN 1 ELSE 0 END)::int AS flagged
    FROM agent_runs
    WHERE created_at > now() - interval '7 days'
    GROUP BY agent
    ORDER BY cost DESC
  `;
  const exceptionRows = await sqlc<ExceptionAgg[]>`
    SELECT category, status, count(*)::int AS n
    FROM exceptions
    WHERE created_at > now() - interval '7 days'
    GROUP BY category, status
  `;

  // Read the adverse-impact rollup if the weekly job has written one.
  const [impactRow] = await sqlc<{ value: unknown }[]>`
    SELECT value FROM config WHERE key = 'ops.adverse_impact' LIMIT 1
  `;

  const { output: digest } = await runAgent(
    'sentinel',
    {
      system: SENTINEL_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `Agent runs (last 7d): ${JSON.stringify(agentRows)}\n` +
            `Exceptions (last 7d): ${JSON.stringify(exceptionRows)}\n` +
            `Adverse-impact rollup: ${JSON.stringify(impactRow?.value ?? null)}\n\n` +
            `Summarize platform + agent-workforce health for ops.`,
        },
      ],
    },
    { schema: SentinelDigest, inputRef: inputRef({ week: 'digest' }) },
  );

  await writeConfig('ops.week_digest', {
    ...digest,
    generatedAt: new Date().toISOString(),
    agentTotals: agentRows,
    exceptionTotals: exceptionRows,
  });

  log.info(SCOPE, 'digest written', {
    agents: agentRows.length,
    costAlerts: digest.costAlerts.length,
  });
}
