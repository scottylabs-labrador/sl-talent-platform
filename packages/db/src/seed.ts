// Idempotent seed. Safe to run repeatedly: every insert is guarded by
// onConflictDoNothing against a unique key, so re-running never duplicates.
//
// Scope for now (per the build plan): the CMU-flavored skills taxonomy plus a
// clearly-marked placeholder where the full demo entities (June Park et al.)
// will be added once the design-notes seed data is finalized. The config rows
// (autonomy levels, SLA hours, rubric + prompt versions) are seeded by the
// hand-written guards migration so they exist even on a migrate-only deploy;
// seed() re-asserts them idempotently for local/dev convenience.

import type { db as dbFactory } from './client.js';
import { skills, config } from './schema.js';

type Database = ReturnType<typeof dbFactory>;

export interface SeedResult {
  skills: number;
  config: number;
  // Filled in once the demo dataset lands (students, screens, dossiers, …).
  demoEntities: number;
}

// ── Skills taxonomy ─────────────────────────────────────────────────────────
// CMU-flavored, grouped by track. Course codes are hyphenated (15-440), never
// a grade — coursework is student attestation only (FERPA). course_code is
// null for skills that are not anchored to a single catalog course (languages,
// tools, cross-cutting practices).

interface SeedSkill {
  slug: string;
  name: string;
  track: 'systems' | 'ml' | 'product' | 'theory' | 'security';
  courseCode: string | null;
}

export const SKILLS_TAXONOMY: readonly SeedSkill[] = [
  // systems ------------------------------------------------------------------
  { slug: 'computer-systems', name: 'Computer systems', track: 'systems', courseCode: '15-213' },
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

// ── Config defaults ──────────────────────────────────────────────────────────
// Mirrors the guards migration seed so seed() alone brings a fresh dev DB to a
// working state. version=1; ops bumps versions through PATCH /ops/config/:key.

export const CONFIG_DEFAULTS: readonly { key: string; value: unknown }[] = [
  {
    key: 'autonomy',
    // Per ARCHITECTURE section 6: autonomy gates are data, not code.
    value: {
      rep: 'B',
      synthesizer: 'B',
      verifier: 'C',
      recruiter: 'B',
      concierge: 'B',
      coach: 'C',
      sentinel: 'C',
    },
  },
  { key: 'sla_hours', value: { hours: 72 } },
  { key: 'rubric_version', value: { version: 'v0.1' } },
  {
    key: 'prompt_versions',
    value: {
      rep: 'v0.1',
      synthesizer: 'v0.1',
      verifier: 'v0.1',
      recruiter: 'v0.1',
      concierge: 'v0.1',
      coach: 'v0.1',
      sentinel: 'v0.1',
    },
  },
  {
    key: 'recruiter_pipeline',
    // Longlist / slate-composition / gate thresholds (ARCHITECTURE section 6).
    value: {
      longlist: 30,
      slate: 10,
      fits: 8,
      confidenceThreshold: 0.72,
      gateFirstShortlistForOrg: true,
    },
  },
];

/**
 * Idempotent seed. Inserts the skills taxonomy and config defaults, skipping
 * anything already present. Returns counts of rows that were newly inserted.
 */
export async function seed(database: Database): Promise<SeedResult> {
  // Skills — unique on slug.
  const insertedSkills = await database
    .insert(skills)
    .values(
      SKILLS_TAXONOMY.map((s) => ({
        slug: s.slug,
        name: s.name,
        track: s.track,
        courseCode: s.courseCode,
      })),
    )
    .onConflictDoNothing({ target: skills.slug })
    .returning({ id: skills.id });

  // Config — primary key on key. Do not clobber ops-edited values.
  const insertedConfig = await database
    .insert(config)
    .values(
      CONFIG_DEFAULTS.map((c) => ({
        key: c.key,
        value: c.value,
        version: 1,
      })),
    )
    .onConflictDoNothing({ target: config.key })
    .returning({ key: config.key });

  // ─────────────────────────────────────────────────────────────────────────
  // DEMO ENTITIES — INTENTIONALLY EMPTY (placeholder).
  //
  // The full demo dataset (June Park and the pilot cohort: users, students,
  // skill_claims, evidence, experience_stories, screens, screen_moments,
  // dossiers, coaching_reports, jobs, shortlists, shortlist_entries,
  // ledger_events) arrives from the design notes in a later pass. Add it here,
  // each block guarded by onConflictDoNothing on a stable natural key (e.g.
  // users.email / students.andrew_id) so this function stays idempotent.
  //
  // Reference data already captured in docs/design-notes/tokens-and-canonical.md
  // ("Demo/seed data" section): June Park, SCS, grad May 2027, CPT eligible;
  // the "Debugging under pressure" Raft moment at 14:42; the 1d rationale and
  // three evidence chips; the 1h Talent Graph threads.
  // ─────────────────────────────────────────────────────────────────────────
  const demoEntities = 0;

  return {
    skills: insertedSkills.length,
    config: insertedConfig.length,
    demoEntities,
  };
}
