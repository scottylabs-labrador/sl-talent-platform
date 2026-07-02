// Readers + writers for the versioned `config` table (ARCHITECTURE section 6:
// rubrics, autonomy, SLA hours live in config, not code). Sweeps write their
// outputs back into well-known config keys (ops.week_digest, ops.adverse_impact,
// export.{studentId}) that the web hands to operators/students.

import { db, config, eq, sql } from '@tartan/db';

/** Read config.value for a key, or the fallback when the row is missing. */
export async function readConfig<T>(key: string, fallback: T): Promise<T> {
  const rows = await db()
    .select({ value: config.value })
    .from(config)
    .where(eq(config.key, key))
    .limit(1);
  const row = rows[0];
  if (!row || row.value === null || row.value === undefined) return fallback;
  return row.value as T;
}

/** Upsert a config value, bumping version on update. */
export async function writeConfig(key: string, value: unknown): Promise<void> {
  await db()
    .insert(config)
    .values({ key, value, version: 1 })
    .onConflictDoUpdate({
      target: config.key,
      set: { value, version: sql`${config.version} + 1` },
    });
}

// ── Well-known config shapes ────────────────────────────────────────────────

export interface SlaConfig {
  hours: number;
}
export const DEFAULT_SLA: SlaConfig = { hours: 72 };

export interface RecruiterPipelineConfig {
  longlist: number;
  slate: number;
  fits: number;
  confidenceThreshold: number;
  gateFirstShortlistForOrg: boolean;
}
export const DEFAULT_RECRUITER_PIPELINE: RecruiterPipelineConfig = {
  longlist: 30,
  slate: 10,
  fits: 8,
  confidenceThreshold: 0.72,
  gateFirstShortlistForOrg: true,
};

export function slaConfig(): Promise<SlaConfig> {
  return readConfig<SlaConfig>('sla_hours', DEFAULT_SLA);
}

export function recruiterPipelineConfig(): Promise<RecruiterPipelineConfig> {
  return readConfig<RecruiterPipelineConfig>(
    'recruiter_pipeline',
    DEFAULT_RECRUITER_PIPELINE,
  );
}
