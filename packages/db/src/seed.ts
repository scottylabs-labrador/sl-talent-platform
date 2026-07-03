// Reference seed for the production platform. This is NOT demo content: it
// inserts only the two pieces of durable reference data the app needs to run
// against an otherwise empty database:
//
//   1. The skills taxonomy (CMU-flavored course and skill catalog). Students
//      and the recruiter wire real evidence to these skills.
//   2. Operational config defaults (agent autonomy levels, SLA hours, rubric
//      and prompt versions, recruiter pipeline knobs).
//
// Everything else in the platform is created for real through the product:
// operators create sponsor orgs and student profiles, students onboard,
// sponsors post roles, the recruiter builds shortlists, the voice pipeline
// runs real screens, and every stat is computed from live rows. There are no
// seeded people, organizations, jobs, shortlists, exceptions, or numbers.
//
// Idempotent: skills upsert by unique slug, config rows are inserted only when
// absent (never clobber operator-edited config). Re-running changes nothing.
//
// FERPA: no grades anywhere. Coursework is attestation only.

import { sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { db as dbFactory } from './client.js';
import { skills, config } from './schema.js';

type Database = ReturnType<typeof dbFactory>;

export interface SeedResult {
  skills: number;
  config: number;
}

// ════════════════════════════════════════════════════════════════════════════
//  SKILLS TAXONOMY (CMU course and skill catalog)
// ════════════════════════════════════════════════════════════════════════════
interface SeedSkill {
  slug: string;
  name: string;
  track: 'systems' | 'ml' | 'product' | 'theory' | 'security';
  courseCode: string | null;
}

export const SKILLS_TAXONOMY: readonly SeedSkill[] = [
  // systems ------------------------------------------------------------------
  { slug: 'computer-systems', name: 'Computer systems', track: 'systems', courseCode: '15-213' },
  { slug: 'systems-programming-c', name: 'Systems programming (C)', track: 'systems', courseCode: '15-213' },
  { slug: 'distributed-systems', name: 'Distributed systems', track: 'systems', courseCode: '15-440' },
  { slug: 'database-systems', name: 'Database systems', track: 'systems', courseCode: '15-445' },
  { slug: 'operating-systems', name: 'Operating systems', track: 'systems', courseCode: '15-410' },
  { slug: 'compilers', name: 'Compilers', track: 'systems', courseCode: '15-411' },
  { slug: 'computer-networks', name: 'Computer networks', track: 'systems', courseCode: '15-441' },
  { slug: 'cloud-computing', name: 'Cloud computing', track: 'systems', courseCode: '15-619' },
  { slug: 'go', name: 'Go', track: 'systems', courseCode: null },
  { slug: 'rust', name: 'Rust', track: 'systems', courseCode: null },
  { slug: 'c', name: 'C', track: 'systems', courseCode: null },
  { slug: 'cpp', name: 'C++', track: 'systems', courseCode: null },
  { slug: 'kubernetes', name: 'Kubernetes', track: 'systems', courseCode: null },
  { slug: 'docker', name: 'Docker', track: 'systems', courseCode: null },

  // ml -----------------------------------------------------------------------
  { slug: 'machine-learning', name: 'Machine learning', track: 'ml', courseCode: '10-601' },
  { slug: 'intro-ml-phd', name: 'Machine learning (PhD)', track: 'ml', courseCode: '10-701' },
  { slug: 'deep-learning-systems', name: 'Deep learning systems', track: 'ml', courseCode: '10-714' },
  { slug: 'deep-reinforcement-learning', name: 'Deep reinforcement learning', track: 'ml', courseCode: '10-703' },
  { slug: 'natural-language-processing', name: 'Natural language processing', track: 'ml', courseCode: '11-711' },
  { slug: 'computer-vision', name: 'Computer vision', track: 'ml', courseCode: '16-720' },
  { slug: 'convex-optimization', name: 'Convex optimization', track: 'ml', courseCode: '10-725' },
  { slug: 'pytorch', name: 'PyTorch', track: 'ml', courseCode: null },
  { slug: 'jax', name: 'JAX', track: 'ml', courseCode: null },

  // product ------------------------------------------------------------------
  { slug: 'software-engineering', name: 'Software engineering', track: 'product', courseCode: '17-313' },
  { slug: 'human-computer-interaction', name: 'Human-computer interaction', track: 'product', courseCode: '05-391' },
  { slug: 'web-application-development', name: 'Web application development', track: 'product', courseCode: '17-437' },
  { slug: 'product-management', name: 'Product management', track: 'product', courseCode: null },
  { slug: 'typescript', name: 'TypeScript', track: 'product', courseCode: null },
  { slug: 'react', name: 'React', track: 'product', courseCode: null },
  { slug: 'api-design', name: 'API design', track: 'product', courseCode: null },

  // theory -------------------------------------------------------------------
  { slug: 'algorithms', name: 'Algorithms', track: 'theory', courseCode: '15-451' },
  { slug: 'theoretical-cs', name: 'Great theoretical ideas in CS', track: 'theory', courseCode: '15-251' },

  // security -----------------------------------------------------------------
  { slug: 'computer-security', name: 'Computer security', track: 'security', courseCode: '18-330' },
  { slug: 'applied-cryptography', name: 'Applied cryptography', track: 'security', courseCode: '15-356' },
];

// ── operational config defaults (mirrors the guards migration) ───────────────
export const CONFIG_DEFAULTS: readonly { key: string; value: unknown }[] = [
  {
    key: 'autonomy',
    value: { rep: 'B', synthesizer: 'B', verifier: 'C', recruiter: 'B', concierge: 'B', coach: 'C', sentinel: 'C' },
  },
  { key: 'sla_hours', value: { hours: 72 } },
  { key: 'rubric_version', value: { version: 'v0.1' } },
  {
    key: 'prompt_versions',
    value: { rep: 'v0.1', synthesizer: 'v0.1', verifier: 'v0.1', recruiter: 'v0.1', concierge: 'v0.1', coach: 'v0.1', sentinel: 'v0.1' },
  },
  {
    key: 'recruiter_pipeline',
    value: { longlist: 30, slate: 10, fits: 8, confidenceThreshold: 0.72, gateFirstShortlistForOrg: true },
  },
];

// ════════════════════════════════════════════════════════════════════════════
export async function seed(database: Database): Promise<SeedResult> {
  await database
    .insert(skills)
    .values(
      SKILLS_TAXONOMY.map((s) => ({
        slug: s.slug,
        name: s.name,
        track: s.track,
        courseCode: s.courseCode,
      })),
    )
    .onConflictDoUpdate({
      target: skills.slug,
      set: { name: sql`excluded.name`, track: sql`excluded.track`, courseCode: sql`excluded.course_code` },
    });

  await database
    .insert(config)
    .values(CONFIG_DEFAULTS.map((c) => ({ key: c.key, value: c.value, version: 1 })))
    .onConflictDoNothing({ target: config.key });

  const count = async (t: PgTable): Promise<number> => {
    const [row] = await database.select({ n: sql<number>`count(*)::int` }).from(t);
    return row?.n ?? 0;
  };
  return { skills: await count(skills), config: await count(config) };
}
