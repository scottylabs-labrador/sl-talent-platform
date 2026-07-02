// Idempotent demo seed. Re-running is a no-op on row counts: every entity has a
// STABLE fixed UUID and is written with upsert-by-id (onConflictDoUpdate using
// `excluded.*`), except ledger_events which is APPEND-ONLY (a DB trigger blocks
// UPDATE/DELETE) and is therefore written with onConflictDoNothing on its fixed
// id. Nothing is ever deleted, so the append-only ledger and its FK carve-outs
// are never tripped, and re-seeding refreshes mutable content in place.
//
// The dataset instances EXACTLY what the four design prototypes render (see
// docs/design-notes/*.md "Demo/seed data" sections). Every user-visible string
// is verbatim from the design or written in the same plain, sentence-case voice
// (no em dashes, no lorem ipsum).
//
// Audio: screen_moments carry clip_key = clips/{momentId}.mp3 and real measured
// durations. Those durations are read from scripts/audio-manifest.json when the
// companion audio script (scripts/gen-audio.ts) has been run; otherwise the seed
// falls back to the design's nominal clip durations so the DB is always coherent
// on its own. Word timestamps for each clip's synced transcript are distributed
// UNIFORMLY across the moment's [tStartMs, tEndMs] span (an approximation of real
// Cartesia word timings — documented on buildMomentTranscript below).
//
// FERPA: no grades anywhere. Coursework is attestation only (courseCode in meta).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { db as dbFactory } from './client.js';
import type {
  CoachingReportBody,
  DossierCompetencies,
  DossierFlags,
  EvidenceChips,
  Followups,
  Transcript,
} from '@tartan/types';
import {
  agentRuns,
  claimEvidence,
  coachingReports,
  config,
  consents,
  dossiers,
  evidence,
  exceptions,
  experienceStories,
  jobs,
  ledgerEvents,
  outcomes,
  screenMoments,
  screens,
  shortlistEntries,
  shortlists,
  skillClaims,
  skills,
  sponsorMembers,
  sponsorOrgs,
  students,
  users,
} from './schema.js';

type Database = ReturnType<typeof dbFactory>;

export interface SeedResult {
  skills: number;
  config: number;
  users: number;
  students: number;
  screens: number;
  screenMoments: number;
  dossiers: number;
  shortlistEntries: number;
  exceptions: number;
  ledgerEvents: number;
  agentRuns: number;
}

// ── stable id helper ────────────────────────────────────────────────────────
// Deterministic, human-readable UUIDs (valid v4 layout: version nibble 4,
// variant nibble 8). Same code -> same UUID across every seed run, which is what
// makes upsert-by-id idempotent and lets audio files be named by moment id.
const uid = (code: string): string =>
  `d51d0000-0000-4000-8000-${code.replace(/[^0-9a-f]/gi, '').padStart(12, '0').slice(0, 12)}`;

// ── deterministic stub embedding (inlined; no extra dependency) ─────────────
// Mirrors @tartan/agents stubEmbedding so evidence/story/job vectors are
// populated for pgvector retrieval without any network call or API cost. Same
// text -> same unit vector.
const EMBEDDING_DIMENSIONS = 1536;
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function embedText(text: string): number[] {
  const rand = mulberry32(fnv1a(text) || 1);
  const v = new Array<number>(EMBEDDING_DIMENSIONS);
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    const x = rand() * 2 - 1;
    v[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) v[i] = v[i]! / norm;
  return v;
}

// ── upsert-by-id set builder ────────────────────────────────────────────────
// For a bulk insert, update every conflicting row from the proposed row
// (`excluded.*`), skipping identity/created_at so those stay put.
function updateAllExcept(
  table: PgTable,
  skip: readonly string[] = ['id', 'createdAt', 'key'],
): Record<string, SQL> {
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  const set: Record<string, SQL> = {};
  for (const [prop, col] of Object.entries(cols)) {
    if (skip.includes(prop)) continue;
    set[prop] = sql`excluded.${sql.identifier(col.name)}`;
  }
  return set;
}

// ── audio manifest (optional) ───────────────────────────────────────────────
interface AudioManifest {
  moments?: Record<string, { durationMs: number; clipKey: string }>;
  screens?: Record<string, { audioKey: string }>;
}
function loadAudioManifest(): AudioManifest {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const p = resolve(here, '..', 'scripts', 'audio-manifest.json');
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as AudioManifest;
  } catch {
    /* fall back to nominal durations */
  }
  return {};
}

// Demo clock. Today's date in the world of the prototypes is 2026-07-02; the
// screen was completed "Jul 1", the shortlist delivered from a Jun 26 confirm.
const D = (iso: string) => new Date(iso);
const JUL1 = D('2026-07-01T18:12:00Z');

// ════════════════════════════════════════════════════════════════════════════
//  SKILLS TAXONOMY (unchanged CMU-flavored base + one skill the design names)
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
  // The Talent Graph chip the student prototype labels "Systems programming (C)".
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

// ── operational config defaults (unchanged; mirrors the guards migration) ────
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
//  AUDIO SPECS — shared with scripts/gen-audio.ts (imported there).
//  June Park is BOTH the student-app protagonist and sponsor rank-1 candidate:
//  one person, one voice (Samantha), one set of three screen moments that serve
//  the student post-call review AND the sponsor dossier Screen tab. `text` is
//  the fuller sponsor transcript the synced player renders; `quote` (below, in
//  the moment rows) is the shorter student-facing pull quote.
// ════════════════════════════════════════════════════════════════════════════
export const JUNE_SCREEN_ID = uid('5c01');

export interface MomentAudioSpec {
  id: string;
  voice: string;
  /** Spoken text = the sponsor synced-transcript words. */
  text: string;
  tag: string;
  tStartMs: number;
  /** Nominal design duration (seconds), used until the manifest measures real audio. */
  designDurSec: number;
}

export const JUNE_MOMENTS: readonly MomentAudioSpec[] = [
  {
    id: uid('b01'),
    voice: 'Samantha',
    tag: 'Debugging under pressure',
    text: 'Our Raft implementation kept electing two leaders under partition. The real bug was that we persisted votedFor after the term check, not atomically with it. I rewrote the vote record as a single fsync tuple.',
    tStartMs: 882_000, // 14:42
    designDurSec: 8,
  },
  {
    id: uid('b02'),
    voice: 'Samantha',
    tag: 'Verification instinct',
    text: 'Then I added a Jepsen style checker that replayed the exact partition schedule five hundred times. Zero split votes after the fix, across every schedule.',
    tStartMs: 1_023_000, // 17:03
    designDurSec: 7,
  },
  {
    id: uid('b03'),
    voice: 'Samantha',
    tag: 'Ownership clarity',
    text: 'The election module and the persistence layer were mine, about eleven hundred lines. My partner owned log replication, and we co-wrote the test harness.',
    tStartMs: 1_308_000, // 21:48
    designDurSec: 6,
  },
];

/**
 * Build a word-level Transcript for one clip by distributing its words UNIFORMLY
 * across [tStartMs, tEndMs]. This is an approximation: production stores real
 * Cartesia word timings. Uniform spacing is a faithful-enough stand-in for the
 * synced-transcript highlight (word i flips spoken when playhead passes i/N).
 */
function buildMomentTranscript(
  text: string,
  tStartMs: number,
  tEndMs: number,
  speaker: 'rep' | 'student',
): Transcript {
  const words = text.split(/\s+/).filter(Boolean);
  const span = Math.max(1, tEndMs - tStartMs);
  const step = span / words.length;
  return words.map((word, i) => ({
    word,
    t0: Math.round(tStartMs + i * step),
    t1: Math.round(tStartMs + (i + 1) * step),
    speaker,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
//  ID MAP
// ════════════════════════════════════════════════════════════════════════════
const IDS = {
  users: {
    june: uid('a01'), // student@demo.tartan  (protagonist + sponsor p1)
    jordan: uid('a02'), // sponsor@demo.tartan
    lena: uid('a03'), // ops@demo.tartan
  },
  org: uid('c01'),
  member: uid('c02'),
  juneStudent: uid('a51'),
  juneDossier: uid('d001'),
  juneCoaching: uid('cf01'),
  jobSwe: uid('e001'),
  jobPm: uid('e002'),
  jobResearch: uid('e003'),
  shortlist: uid('f001'),
} as const;

// ════════════════════════════════════════════════════════════════════════════
//  CANDIDATE ROSTER — the ten-person shortlist. June (p1) is authored in full
//  below; p2–p10 are generated from this on-brand spec so DossierView works for
//  every candidate in production (visibility searchable, published + approved).
// ════════════════════════════════════════════════════════════════════════════
type Kind = 'fit' | 'wildcard' | 'alum' | 'match_only';
type Vis = 'searchable' | 'match_only' | 'paused';
type WA = { status: string; needsSponsorship: boolean; note?: string };

interface Candidate {
  n: number; // rank
  userId: string;
  studentId: string;
  screenId: string;
  dossierId: string;
  name: string;
  email: string;
  andrewId: string;
  program: string;
  gradDate: string;
  studentKind: 'undergrad' | 'grad' | 'alum';
  visibility: Vis;
  workAuth: WA;
  locations: string[];
  freshness: number;
  fit: number;
  entryKind: Kind;
  reveal: 'n/a' | 'requested' | 'granted' | 'declined';
  meta: string; // dossier header meta
  why: string; // rationale
  chips: EvidenceChips;
  competency: DossierCompetencies;
  flags: DossierFlags;
  followups: Followups;
  stories: { title: string; situation: string; contribution: string; outcome: string | null }[];
}

const P: readonly Candidate[] = [
  {
    n: 2,
    userId: uid('a04'),
    studentId: uid('a52'),
    screenId: uid('5c02'),
    dossierId: uid('d002'),
    name: 'Rohan Mehta',
    email: 'rmehta@andrew.cmu.edu',
    andrewId: 'rmehta',
    program: 'BS ECE, ECE',
    gradDate: '2026-12-15',
    studentKind: 'undergrad',
    visibility: 'searchable',
    workAuth: { status: 'f1_opt', needsSponsorship: true, note: 'F-1, OPT eligible. Self-declared.' },
    locations: ['Pittsburgh'],
    freshness: 0.95,
    fit: 91,
    entryKind: 'fit',
    reveal: 'n/a',
    meta: 'ECE · BS ECE · Dec 2026',
    why: 'Shipped a production eBPF profiler during an internship and can defend every tradeoff in it. Deepest systems fundamentals of the slate.',
    chips: [
      { label: '18-613, verified', kind: 'verified' },
      { label: 'eBPF profiler, verified', kind: 'verified' },
      { label: 'Screen: precise, terse', kind: 'moment' },
    ],
    competency: [
      { name: 'Technical depth', score: 5 },
      { name: 'Verification instinct', score: 4 },
      { name: 'Ownership clarity', score: 5 },
      { name: 'Communication', score: 4 },
    ],
    flags: {
      green: ['Explained the profiler ring-buffer tradeoff without a prompt.', 'Owned the whole eBPF pipeline end to end.'],
      probe: ['Terse under open-ended questions; give room to expand on design rationale.'],
    },
    followups: [
      'How would he keep the profiler overhead under budget at 10x the event rate?',
      'What did he choose not to instrument, and why?',
    ],
    stories: [
      { title: 'eBPF profiler · systems internship', situation: 'Production services lacked low-overhead CPU attribution under load.', contribution: 'Built an eBPF sampling profiler with a lock-free ring buffer and a userspace aggregator.', outcome: 'Ran under 1% overhead in production; adopted by two on-call teams.' },
      { title: 'Operating systems · 18-613', situation: 'Course kernel project graded on correctness under fault injection.', contribution: 'Implemented the scheduler and virtual memory subsystems solo.', outcome: 'Passed every fault-injection case; top decile on the performance leaderboard.' },
    ],
  },
  {
    n: 3,
    userId: uid('a05'),
    studentId: uid('a53'),
    screenId: uid('5c03'),
    dossierId: uid('d003'),
    name: 'Amara Diallo',
    email: 'adiallo@andrew.cmu.edu',
    andrewId: 'adiallo',
    program: 'BS Computer Science, SCS',
    gradDate: '2026-05-15',
    studentKind: 'undergrad',
    visibility: 'searchable',
    workAuth: { status: 'f1_cpt', needsSponsorship: true, note: 'F-1, CPT eligible. Self-declared.' },
    locations: ['Pittsburgh', 'New York'],
    freshness: 0.93,
    fit: 90,
    entryKind: 'fit',
    reveal: 'n/a',
    meta: 'SCS · BS CS · May 2026',
    why: 'TA for 15-445 and built a B+ tree storage engine that beat the course baseline threefold. Asked for storage work specifically, which your JD rewards.',
    chips: [
      { label: '15-445 TA, verified', kind: 'verified' },
      { label: 'Storage engine, verified', kind: 'verified' },
      { label: 'Asked for this domain', kind: 'self_reported' },
    ],
    competency: [
      { name: 'Technical depth', score: 5 },
      { name: 'Verification instinct', score: 4 },
      { name: 'Ownership clarity', score: 4 },
      { name: 'Communication', score: 5 },
    ],
    flags: {
      green: ['Storage engine benchmarked honestly against the course baseline.', 'Teaches the material she is claiming, which held up under probing.'],
      probe: ['Most evidence is course-scoped; ask about work outside a graded rubric.'],
    },
    followups: [
      'How would her B+ tree handle write amplification under a replication workload?',
      'What breaks in her engine first when the working set exceeds memory?',
    ],
    stories: [
      { title: 'B+ tree storage engine · 15-445', situation: 'Course project measured against a provided storage baseline.', contribution: 'Designed a cache-friendly B+ tree with a buffer pool and WAL.', outcome: 'Three times the baseline throughput on the graded workload.' },
      { title: 'Teaching assistant · 15-445', situation: 'Two hundred students needed storage-internals support.', contribution: 'Ran recitations on buffer management and recovery, wrote autograder cases.', outcome: 'Course evaluations rated the storage unit highest that term.' },
    ],
  },
  {
    n: 4,
    userId: uid('a06'),
    studentId: uid('a54'),
    screenId: uid('5c04'),
    dossierId: uid('d004'),
    name: 'Sasha Volkov',
    email: 'svolkov.alum@andrew.cmu.edu',
    andrewId: 'svolkov',
    program: 'MS Computer Science, SCS',
    gradDate: '2025-05-15',
    studentKind: 'alum',
    visibility: 'searchable',
    workAuth: { status: 'permanent_resident', needsSponsorship: false, note: 'No sponsorship needed. Self-declared.' },
    locations: ['SF Bay'],
    freshness: 0.82,
    fit: 88,
    entryKind: 'alum',
    reveal: 'n/a',
    meta: 'Alum · MS CS 2025 · no sponsorship needed',
    why: 'One year at a seed-stage infra startup that folded; owned their Kafka-to-Iceberg pipeline end to end. Alumni are in scope this year and the evidence is fresh.',
    chips: [
      { label: 'Alum, verified', kind: 'verified' },
      { label: 'Pipeline repo, verified', kind: 'verified' },
      { label: 'Screen: strong ownership', kind: 'moment' },
    ],
    competency: [
      { name: 'Technical depth', score: 4 },
      { name: 'Verification instinct', score: 4 },
      { name: 'Ownership clarity', score: 5 },
      { name: 'Communication', score: 4 },
    ],
    flags: {
      green: ['Owned a production data pipeline solo at a startup.', 'Candid about what failed when the company folded.'],
      probe: ['A year out of a small team; check exposure to large-scale on-call.'],
    },
    followups: [
      'How would he redesign the Kafka-to-Iceberg pipeline for exactly-once at higher volume?',
      'What would he keep and what would he throw away from the startup stack?',
    ],
    stories: [
      { title: 'Kafka to Iceberg pipeline · infra startup', situation: 'Streaming events needed to land in a queryable lakehouse reliably.', contribution: 'Built and operated the ingestion pipeline with schema evolution and backfills.', outcome: 'Sustained millions of events a day with under an hour of recovery time on incidents.' },
      { title: 'Distributed systems capstone · MS', situation: 'Graduate project on consistent replication across regions.', contribution: 'Implemented a leaderless replication layer with read repair.', outcome: 'Demonstrated bounded staleness under simulated partitions.' },
    ],
  },
  {
    n: 5,
    userId: uid('a07'),
    studentId: uid('a55'),
    screenId: uid('5c05'),
    dossierId: uid('d005'),
    name: 'Grace Liu',
    email: 'gliu@andrew.cmu.edu',
    andrewId: 'gliu',
    program: 'BS Computer Science and Robotics, SCS',
    gradDate: '2027-05-15',
    studentKind: 'undergrad',
    visibility: 'searchable',
    workAuth: { status: 'citizen', needsSponsorship: false },
    locations: ['Pittsburgh', 'Seattle'],
    freshness: 0.96,
    fit: 86,
    entryKind: 'fit',
    reveal: 'n/a',
    meta: 'SCS · BS CS + Robotics · May 2027',
    why: 'Distributed fleet simulation for 200 robots with deterministic replay. Communication rated highest of the slate.',
    chips: [
      { label: 'Fleet sim, verified', kind: 'verified' },
      { label: '15-440, verified', kind: 'verified' },
      { label: 'Screen: best communicator', kind: 'moment' },
    ],
    competency: [
      { name: 'Technical depth', score: 4 },
      { name: 'Verification instinct', score: 4 },
      { name: 'Ownership clarity', score: 4 },
      { name: 'Communication', score: 5 },
    ],
    flags: {
      green: ['Explains hard systems ideas cleanly and fast.', 'Deterministic replay design was thought through end to end.'],
      probe: ['Robotics-flavored; confirm depth on storage-specific failure modes.'],
    },
    followups: [
      'How would her deterministic replay hold up with nondeterministic network timing?',
      'Where would she add backpressure in the fleet simulator?',
    ],
    stories: [
      { title: 'Distributed fleet simulation', situation: 'Robotics coursework needed repeatable multi-agent experiments.', contribution: 'Built a 200-robot simulator with a deterministic scheduler and replay logs.', outcome: 'Bit-for-bit reproducible runs; used by the lab for regression testing.' },
      { title: 'Distributed systems · 15-440', situation: 'Course project on replicated state machines.', contribution: 'Owned the log compaction and snapshotting path.', outcome: 'Passed all correctness cases with bounded memory growth.' },
    ],
  },
  {
    n: 6,
    userId: uid('a08'),
    studentId: uid('a56'),
    screenId: uid('5c06'),
    dossierId: uid('d006'),
    name: 'Daniel Kovács',
    email: 'dkovacs@andrew.cmu.edu',
    andrewId: 'dkovacs',
    program: 'MS Computer Science (MCS), SCS',
    gradDate: '2027-05-15',
    studentKind: 'grad',
    visibility: 'searchable',
    workAuth: { status: 'f1_opt', needsSponsorship: true, note: 'F-1, OPT eligible. Self-declared.' },
    locations: ['Pittsburgh'],
    freshness: 0.9,
    fit: 84,
    entryKind: 'fit',
    reveal: 'n/a',
    meta: 'MCS · BS CS · May 2027',
    why: 'Two merged upstream PRs in the etcd lease subsystem. Interview depth was real but narrower than the top three.',
    chips: [
      { label: 'etcd PRs, verified', kind: 'verified' },
      { label: 'Go, verified', kind: 'verified' },
      { label: 'Screen: deep but narrow', kind: 'moment' },
    ],
    competency: [
      { name: 'Technical depth', score: 4 },
      { name: 'Verification instinct', score: 4 },
      { name: 'Ownership clarity', score: 4 },
      { name: 'Communication', score: 3 },
    ],
    flags: {
      green: ['Real upstream contributions, reviewed by maintainers.', 'Precise about the lease renewal race he fixed.'],
      probe: ['Depth is concentrated in one subsystem; probe breadth across storage.'],
    },
    followups: [
      'How would he extend the lease fix to a multi-raft setup?',
      'What part of etcd would he want to work on next and why?',
    ],
    stories: [
      { title: 'etcd lease subsystem · upstream', situation: 'A lease renewal race could drop keepalives under load.', contribution: 'Diagnosed the race and submitted two reviewed PRs with regression tests.', outcome: 'Both merged upstream; the flaky keepalive path stabilized.' },
      { title: 'Go concurrency deep dive', situation: 'Wanted to understand scheduler-level contention.', contribution: 'Wrote benchmarks isolating channel versus mutex contention.', outcome: 'Documented the crossover points in a public writeup.' },
    ],
  },
  {
    n: 7,
    userId: uid('a09'),
    studentId: uid('a57'),
    screenId: uid('5c07'),
    dossierId: uid('d007'),
    name: 'Noor Haddad',
    email: 'nhaddad@andrew.cmu.edu',
    andrewId: 'nhaddad',
    program: 'MS Computer Science, SCS',
    gradDate: '2027-05-15',
    studentKind: 'grad',
    visibility: 'match_only',
    workAuth: { status: 'f1_cpt', needsSponsorship: true, note: 'F-1, CPT eligible. Self-declared.' },
    locations: ['Pittsburgh', 'Kirkland'],
    freshness: 0.94,
    fit: 83,
    entryKind: 'match_only',
    reveal: 'requested',
    meta: 'SCS masters · May 2027 · consent requested Mon',
    why: 'Match-only visibility: identity reveals if they consent to this shortlist. Evidence summary shown; profile is complete and verified underneath.',
    chips: [
      { label: 'Consensus research, verified', kind: 'verified' },
      { label: 'Screen completed', kind: 'moment' },
      { label: 'Awaiting reveal consent', kind: 'pending' },
    ],
    competency: [
      { name: 'Technical depth', score: 4 },
      { name: 'Verification instinct', score: 4 },
      { name: 'Ownership clarity', score: 4 },
      { name: 'Communication', score: 4 },
    ],
    flags: {
      green: ['Published consensus research with a reproducible artifact.', 'Screen was consistent with the written record.'],
      probe: ['Identity is withheld pending consent; confirm logistics on reveal.'],
    },
    followups: [
      'How does the research artifact behave outside the paper benchmarks?',
      'What industrial constraint would change the design most?',
    ],
    stories: [
      { title: 'Consensus research · masters', situation: 'Studied leader-election latency under adversarial delay.', contribution: 'Built the evaluation harness and reproduced the paper end to end.', outcome: 'Artifact reproduced the published results within noise.' },
      { title: 'Replication prototype', situation: 'Wanted to test a quorum variant under churn.', contribution: 'Implemented the variant and a fault injector.', outcome: 'Characterized the availability tradeoff across quorum sizes.' },
    ],
  },
  {
    n: 8,
    userId: uid('a10'),
    studentId: uid('a58'),
    screenId: uid('5c08'),
    dossierId: uid('d008'),
    name: 'Priyanka Nair',
    email: 'pnair@andrew.cmu.edu',
    andrewId: 'pnair',
    program: 'BS ECE, ECE',
    gradDate: '2027-05-15',
    studentKind: 'undergrad',
    visibility: 'searchable',
    workAuth: { status: 'f1_cpt', needsSponsorship: true, note: 'F-1, CPT eligible. Self-declared.' },
    locations: ['Pittsburgh'],
    freshness: 0.88,
    fit: 82,
    entryKind: 'fit',
    reveal: 'n/a',
    meta: 'ECE · BS ECE · May 2027',
    why: 'FPGA-accelerated key-value cache as an independent study, measured end to end. Hardware-adjacent depth your team said it lacks.',
    chips: [
      { label: 'FPGA KV cache, verified', kind: 'verified' },
      { label: '18-447, verified', kind: 'verified' },
      { label: 'Screen: methodical', kind: 'moment' },
    ],
    competency: [
      { name: 'Technical depth', score: 4 },
      { name: 'Verification instinct', score: 4 },
      { name: 'Ownership clarity', score: 4 },
      { name: 'Communication', score: 4 },
    ],
    flags: {
      green: ['Measured the FPGA cache end to end, not just in simulation.', 'Careful, methodical answers under probing.'],
      probe: ['Hardware-leaning; confirm comfort in a pure software storage role.'],
    },
    followups: [
      'How would the FPGA cache integrate with a software replication layer?',
      'Where did measurement surprise her most?',
    ],
    stories: [
      { title: 'FPGA key-value cache · independent study', situation: 'Wanted line-rate lookups for a small hot key set.', contribution: 'Designed the pipeline on an FPGA and a host interface for measurement.', outcome: 'Sustained line-rate lookups; documented the latency distribution.' },
      { title: 'Computer architecture · 18-447', situation: 'Course project on a pipelined processor.', contribution: 'Implemented forwarding and hazard detection.', outcome: 'Passed the full test suite with correct stalls.' },
    ],
  },
  {
    n: 9,
    userId: uid('a11'),
    studentId: uid('a59'),
    screenId: uid('5c09'),
    dossierId: uid('d009'),
    name: 'Ben Okonkwo',
    email: 'bokonkwo@andrew.cmu.edu',
    andrewId: 'bokonkwo',
    program: 'BS Statistics and Machine Learning, Dietrich',
    gradDate: '2028-05-15',
    studentKind: 'undergrad',
    visibility: 'searchable',
    workAuth: { status: 'citizen', needsSponsorship: false },
    locations: ['Pittsburgh'],
    freshness: 0.97,
    fit: 78,
    entryKind: 'wildcard',
    reveal: 'n/a',
    meta: 'Dietrich · Stat + ML · May 2028',
    why: 'The wildcard slot, stated policy. Thin resume, outsized evidence: runs his own Raft implementation on a 6-node homelab, with documented failure drills.',
    chips: [
      { label: 'Homelab Raft, verified', kind: 'verified' },
      { label: 'TartanHacks finalist', kind: 'verified' },
      { label: 'Sophomore, high slope', kind: 'self_reported' },
    ],
    competency: [
      { name: 'Technical depth', score: 4 },
      { name: 'Verification instinct', score: 5 },
      { name: 'Ownership clarity', score: 4 },
      { name: 'Communication', score: 3 },
    ],
    flags: {
      green: ['Runs documented failure drills on a real homelab cluster.', 'Self-taught depth well beyond his coursework year.'],
      probe: ['Early in the program; scope the first project to match his gaps.'],
    },
    followups: [
      'How does his homelab Raft handle disk-full and clock-skew drills?',
      'What would he learn fastest with a mentor on the team?',
    ],
    stories: [
      { title: 'Homelab Raft cluster', situation: 'Wanted to learn consensus by operating it, not just reading it.', contribution: 'Built a 6-node Raft cluster and a runbook of failure drills.', outcome: 'Documented recovery for node loss, disk-full and clock skew.' },
      { title: 'TartanHacks finalist', situation: 'Weekend hackathon on real-time data.', contribution: 'Built the backend ingestion and a simple consistency layer.', outcome: 'Reached the finals out of a large field.' },
    ],
  },
  {
    n: 10,
    userId: uid('a12'),
    studentId: uid('a60'),
    screenId: uid('5c10'),
    dossierId: uid('d010'),
    name: 'Tomás Rivera',
    email: 'trivera@andrew.cmu.edu',
    andrewId: 'trivera',
    program: 'BS Computer Science, SCS',
    gradDate: '2027-12-15',
    studentKind: 'undergrad',
    visibility: 'searchable',
    workAuth: { status: 'f1_opt', needsSponsorship: true, note: 'F-1, OPT eligible. Self-declared.' },
    locations: ['Pittsburgh', 'Austin'],
    freshness: 0.99,
    fit: 77,
    entryKind: 'fit',
    reveal: 'n/a',
    meta: 'SCS · BS CS · Dec 2027',
    why: 'Solid systems coursework and a clean screen. Evidence is course-scoped so far; ranked above two higher raw scores on freshness and stated role interest.',
    chips: [
      { label: '15-213 + 15-440, verified', kind: 'verified' },
      { label: 'Screen: solid', kind: 'moment' },
      { label: 'Freshness: 2 days', kind: 'self_reported' },
    ],
    competency: [
      { name: 'Technical depth', score: 4 },
      { name: 'Verification instinct', score: 3 },
      { name: 'Ownership clarity', score: 4 },
      { name: 'Communication', score: 4 },
    ],
    flags: {
      green: ['Clean, honest screen with no overclaiming.', 'Refreshed his profile two days ago; genuinely interested in the role.'],
      probe: ['Evidence is course-scoped; look for one project outside a rubric.'],
    },
    followups: [
      'Which course project would he most want to turn into real infrastructure?',
      'What is he building outside class right now?',
    ],
    stories: [
      { title: 'Computer systems · 15-213', situation: 'Foundational systems coursework with graded labs.', contribution: 'Completed the malloc and shell labs with careful testing.', outcome: 'Strong lab scores; clean, documented code.' },
      { title: 'Distributed systems · 15-440', situation: 'Course project on replicated services.', contribution: 'Implemented the RPC layer and retry logic.', outcome: 'Passed correctness cases under dropped messages.' },
    ],
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  SEED
// ════════════════════════════════════════════════════════════════════════════
export async function seed(database: Database): Promise<SeedResult> {
  const manifest = loadAudioManifest();

  // Skills + operational config first, outside the demo transaction, exactly as
  // before (idempotent by unique key; never clobbers ops-edited config).
  await database
    .insert(skills)
    .values(SKILLS_TAXONOMY.map((s) => ({ slug: s.slug, name: s.name, track: s.track, courseCode: s.courseCode })))
    .onConflictDoNothing({ target: skills.slug });

  await database
    .insert(config)
    .values(CONFIG_DEFAULTS.map((c) => ({ key: c.key, value: c.value, version: 1 })))
    .onConflictDoNothing({ target: config.key });

  // Look up skill ids by slug (they may pre-exist with random ids from a prior
  // skills-only seed, so we never assume our fixed ids).
  const skillRows = await database
    .select({ id: skills.id, slug: skills.slug })
    .from(skills);
  const skillId = (slug: string): string => {
    const r = skillRows.find((x) => x.slug === slug);
    if (!r) throw new Error(`skill not found for slug: ${slug}`);
    return r.id;
  };

  await database.transaction(async (tx) => {
    // ── users ────────────────────────────────────────────────────────────────
    const userRows = [
      { id: IDS.users.june, email: 'student@demo.tartan', name: 'June Park', role: 'student' as const },
      { id: IDS.users.jordan, email: 'sponsor@demo.tartan', name: 'Jordan', role: 'sponsor' as const },
      { id: IDS.users.lena, email: 'ops@demo.tartan', name: 'Lena', role: 'operator' as const },
      ...P.map((c) => ({ id: c.userId, email: c.email, name: c.name, role: 'student' as const })),
    ];
    await tx.insert(users).values(userRows).onConflictDoUpdate({ target: users.id, set: updateAllExcept(users) });

    // ── sponsor org + member (Scogle, Inc · Premier · 10 slots, 3 used) ───────
    await tx
      .insert(sponsorOrgs)
      .values([
        {
          id: IDS.org,
          name: 'Scogle, Inc',
          domain: 'scogle.com',
          tier: 'premier',
          roleSlots: 10,
          contractStart: D('2025-08-01T00:00:00Z'),
          contractEnd: D('2026-08-01T00:00:00Z'),
        },
      ])
      .onConflictDoUpdate({ target: sponsorOrgs.id, set: updateAllExcept(sponsorOrgs) });

    await tx
      .insert(sponsorMembers)
      .values([{ id: IDS.member, userId: IDS.users.jordan, orgId: IDS.org, role: 'recruiter' }])
      .onConflictDoUpdate({ target: sponsorMembers.id, set: updateAllExcept(sponsorMembers) });

    // ── students ──────────────────────────────────────────────────────────────
    const studentRows = [
      {
        id: IDS.juneStudent,
        userId: IDS.users.june,
        andrewId: 'junepark',
        program: 'BS Computer Science, SCS',
        gradDate: D('2027-05-15T00:00:00Z'),
        kind: 'undergrad' as const,
        visibility: 'searchable' as const,
        startupOpen: true,
        workAuth: { status: 'f1_cpt' as const, needsSponsorship: true, note: 'F-1, CPT eligible. Self-declared, shown exactly as entered.' },
        locations: ['Pittsburgh', 'SF Bay'],
        compExpectation: { min: 50, max: 60, hourly: true, currency: 'USD' },
        lastVerifiedAt: JUL1,
        freshnessScore: 0.98,
      },
      ...P.map((c) => ({
        id: c.studentId,
        userId: c.userId,
        andrewId: c.andrewId,
        program: c.program,
        gradDate: D(`${c.gradDate}T00:00:00Z`),
        kind: c.studentKind,
        visibility: c.visibility,
        startupOpen: c.entryKind === 'wildcard',
        workAuth: c.workAuth as never,
        locations: c.locations,
        compExpectation: { currency: 'USD' },
        lastVerifiedAt: JUL1,
        freshnessScore: c.freshness,
      })),
    ];
    await tx.insert(students).values(studentRows as never).onConflictDoUpdate({ target: students.id, set: updateAllExcept(students) });

    // ── June's Talent Graph: evidence, claims, edges, stories ─────────────────
    const jEv = {
      e1: uid('ba01'), e2: uid('ba02'), e3: uid('ba03'), e4: uid('ba04'), e5: uid('ba05'),
      e6: uid('ba06'), e7: uid('ba07'), e8: uid('ba08'), e9: uid('ba09'), e10: uid('ba0a'),
    };
    const juneEvidence = [
      { id: jEv.e1, type: 'course' as const, provenance: 'verified' as const, title: '15-440 consensus project', url: null, meta: { courseCode: '15-440', description: 'Raft-based replicated key-value store, graded under injected partitions.' } },
      { id: jEv.e2, type: 'repo' as const, provenance: 'verified' as const, title: 'railtrace repo · authorship sampled, 14 commits', url: 'https://github.com/junepark/railtrace', meta: { commitCount: 14, primaryLanguage: 'Go', repoUrl: 'https://github.com/junepark/railtrace' } },
      { id: jEv.e3, type: 'interview_moment' as const, provenance: 'verified' as const, title: 'Interview moment · partition failure analysis, 14:42', url: null, meta: { momentId: JUNE_MOMENTS[0]!.id, screenId: JUNE_SCREEN_ID, timestampMs: 882_000 } },
      { id: jEv.e4, type: 'course' as const, provenance: 'verified' as const, title: '15-213 systems coursework', url: null, meta: { courseCode: '15-213' } },
      { id: jEv.e5, type: 'demo' as const, provenance: 'self_reported' as const, title: 'Memory allocator writeup, personal site', url: 'https://junepark.dev/malloc', meta: { description: 'Self-reported writeup of a memory allocator.' } },
      { id: jEv.e6, type: 'course' as const, provenance: 'verified' as const, title: '15-445 database systems', url: null, meta: { courseCode: '15-445' } },
      { id: jEv.e7, type: 'repo' as const, provenance: 'verified' as const, title: 'railtrace · Go, 61% of 18k lines', url: 'https://github.com/junepark/railtrace', meta: { primaryLanguage: 'Go', repoUrl: 'https://github.com/junepark/railtrace' } },
      { id: jEv.e8, type: 'work' as const, provenance: 'pending' as const, title: 'Meridian fleet API, internship', url: null, meta: { orgName: 'Meridian Robotics', role: 'Backend intern' } },
      { id: jEv.e9, type: 'demo' as const, provenance: 'self_reported' as const, title: 'Claimed on resume only', url: null, meta: { description: 'React, claimed on resume only. No artifact attached.' } },
      { id: jEv.e10, type: 'demo' as const, provenance: 'self_reported' as const, title: 'Homelab, described in interview', url: null, meta: { description: 'Kubernetes homelab, described in the interview. No artifact attached.' } },
    ].map((e) => ({ ...e, studentId: IDS.juneStudent, embedding: embedText(`${e.title} ${e.meta?.description ?? ''}`) }));

    // June's skill claims -> the six Talent Graph chips.
    const jCl = { c1: uid('c101'), c2: uid('c102'), c3: uid('c103'), c4: uid('c104'), c5: uid('c105'), c6: uid('c106') };
    const juneClaims = [
      { id: jCl.c1, skillId: skillId('distributed-systems'), proficiency: 5, verified: true },
      { id: jCl.c2, skillId: skillId('systems-programming-c'), proficiency: 4, verified: true },
      { id: jCl.c3, skillId: skillId('database-systems'), proficiency: 4, verified: true },
      { id: jCl.c4, skillId: skillId('go'), proficiency: 5, verified: true },
      { id: jCl.c5, skillId: skillId('react'), proficiency: 2, verified: false },
      { id: jCl.c6, skillId: skillId('kubernetes'), proficiency: 2, verified: false },
    ].map((c) => ({ ...c, studentId: IDS.juneStudent }));

    // Edges: sk1->{e1,e2,e3}=3 wired, sk2->{e4,e5}=2, sk3->{e6}=1, sk4->{e7,e8}=2,
    // sk5->{e9}, sk6->{e10}.
    const juneEdges = [
      [jCl.c1, jEv.e1], [jCl.c1, jEv.e2], [jCl.c1, jEv.e3],
      [jCl.c2, jEv.e4], [jCl.c2, jEv.e5],
      [jCl.c3, jEv.e6],
      [jCl.c4, jEv.e7], [jCl.c4, jEv.e8],
      [jCl.c5, jEv.e9],
      [jCl.c6, jEv.e10],
    ].map(([claimId, evidenceId], i) => ({ id: uid(`ce${(i + 1).toString(16).padStart(2, '0')}`), claimId: claimId!, evidenceId: evidenceId! }));

    const juneStories = [
      {
        id: uid('a5a1'),
        title: 'Backend intern · Meridian Robotics',
        situation: 'Fleet telemetry service was dropping location updates during depot wifi handoffs.',
        contribution: 'Designed and shipped a store-and-forward buffer with idempotent replay, wrote the Go client library other teams adopted.',
        outcome: null, // MISSING -> renders the italic #991a30 prompt in the profile
        meta: { orgName: 'Meridian Robotics', role: 'Backend intern', dates: { start: '2025-06', end: '2025-08' }, description: 'Summer 2025' },
      },
      {
        id: uid('a5a2'),
        title: 'RailTrace · TartanHacks 2026, 1st place',
        situation: 'Pittsburgh Regional Transit publishes light-rail positions with 90 second lag and frequent gaps.',
        contribution: 'Built the ingestion pipeline and dead-reckoning model solo; two teammates did the map UI.',
        outcome: '1,400 weekly riders during demo month; judged best technical depth of 63 teams.',
        meta: { dates: { start: '2026-02' }, description: 'Feb 2026' },
      },
      {
        id: uid('a5a3'),
        title: 'Consensus under partition · 15-440',
        situation: 'Course project: Raft-based replicated key-value store, graded against injected network partitions.',
        contribution: 'Owned election and persistence modules (about 1,100 lines), co-wrote the replay test harness.',
        outcome: 'Survived all 500 adversarial partition schedules; top 5 of 84 teams on the robustness leaderboard.',
        meta: { courseCode: '15-440', description: 'Fall 2025' },
      },
    ].map((s) => ({ ...s, studentId: IDS.juneStudent, embedding: embedText(`${s.title} ${s.situation} ${s.contribution} ${s.outcome ?? ''}`) }));

    // ── p2..p10 talent graph (lighter, on-brand) ──────────────────────────────
    const otherEvidence: Record<string, unknown>[] = [];
    const otherClaims: Record<string, unknown>[] = [];
    const otherEdges: { id: string; claimId: string; evidenceId: string }[] = [];
    const otherStories: Record<string, unknown>[] = [];
    P.forEach((c, ci) => {
      const ev1 = uid(`bb${ci.toString(16)}1`);
      const ev2 = uid(`bb${ci.toString(16)}2`);
      const cl1 = uid(`bc${ci.toString(16)}1`);
      const cl2 = uid(`bc${ci.toString(16)}2`);
      otherEvidence.push(
        { id: ev1, studentId: c.studentId, type: 'course', provenance: 'verified', title: c.stories[0]!.title, url: null, meta: { description: c.stories[0]!.situation }, embedding: embedText(`${c.stories[0]!.title} ${c.stories[0]!.contribution}`) },
        { id: ev2, studentId: c.studentId, type: c.entryKind === 'alum' ? 'work' : 'repo', provenance: 'verified', title: c.stories[1]!.title, url: null, meta: { description: c.stories[1]!.situation }, embedding: embedText(`${c.stories[1]!.title} ${c.stories[1]!.contribution}`) },
      );
      otherClaims.push(
        { id: cl1, studentId: c.studentId, skillId: skillId('distributed-systems'), proficiency: 4, verified: true },
        { id: cl2, studentId: c.studentId, skillId: skillId('go'), proficiency: 4, verified: true },
      );
      otherEdges.push(
        { id: uid(`bd${ci.toString(16)}1`), claimId: cl1, evidenceId: ev1 },
        { id: uid(`bd${ci.toString(16)}2`), claimId: cl2, evidenceId: ev2 },
      );
      c.stories.forEach((st, si) =>
        otherStories.push({
          id: uid(`be${ci.toString(16)}${si}`),
          studentId: c.studentId,
          title: st.title,
          situation: st.situation,
          contribution: st.contribution,
          outcome: st.outcome,
          meta: { description: st.title },
          embedding: embedText(`${st.title} ${st.situation} ${st.contribution} ${st.outcome ?? ''}`),
        } as never),
      );
    });

    await tx.insert(evidence).values([...juneEvidence, ...otherEvidence] as never).onConflictDoUpdate({ target: evidence.id, set: updateAllExcept(evidence) });
    await tx.insert(skillClaims).values([...juneClaims, ...otherClaims] as never).onConflictDoUpdate({ target: skillClaims.id, set: updateAllExcept(skillClaims) });
    await tx.insert(claimEvidence).values([...juneEdges, ...otherEdges]).onConflictDoNothing({ target: claimEvidence.id });
    await tx.insert(experienceStories).values([...juneStories, ...otherStories] as never).onConflictDoUpdate({ target: experienceStories.id, set: updateAllExcept(experienceStories) });

    // ── screens (all published Jul 1) + June's audio-backed moments ───────────
    const juneMomentRows = JUNE_MOMENTS.map((m, i) => {
      const measured = manifest.moments?.[m.id]?.durationMs;
      const durMs = measured ?? m.designDurSec * 1000;
      const quotes = [
        'The real bug was that we persisted votedFor after the term check, not atomically with it.',
        'Replayed the exact partition schedule 500 times. Zero split votes after.',
        'The election module and the persistence layer were mine, about 1,100 lines.',
      ];
      const notes = [
        'Unprompted, complete failure analysis: symptom, hypothesis, evidence, fix, proof. The strongest 40 seconds of the screen.',
        'Did not stop at "it works". Built a replay checker to prove the fix. Rare at intern level.',
        'Clean answer to the individual-contribution probe. Numbers offered without prompting.',
      ];
      return {
        id: m.id,
        screenId: JUNE_SCREEN_ID,
        tStartMs: m.tStartMs,
        tEndMs: m.tStartMs + durMs,
        tag: m.tag,
        quote: quotes[i]!,
        repNote: notes[i]!,
        clipKey: manifest.moments?.[m.id]?.clipKey ?? `clips/${m.id}.mp3`,
        studentVisible: true,
        struck: false,
      };
    });

    // June's transcript = the three clip windows, words spaced uniformly.
    const juneTranscript: Transcript = JUNE_MOMENTS.flatMap((m) => {
      const row = juneMomentRows.find((r) => r.id === m.id)!;
      return buildMomentTranscript(m.text, row.tStartMs, row.tEndMs, 'student');
    });

    const screenRows = [
      {
        id: JUNE_SCREEN_ID,
        studentId: IDS.juneStudent,
        status: 'published' as const,
        consentAppAt: D('2026-07-01T17:40:00Z'),
        consentVerbalSpan: { t0: 6_000, t1: 12_000 },
        startedAt: D('2026-07-01T17:42:00Z'),
        endedAt: D('2026-07-01T18:11:12Z'), // "Call ended at 29:12"
        retakeOf: null,
        audioKey: manifest.screens?.[JUNE_SCREEN_ID]?.audioKey ?? `raw/${JUNE_SCREEN_ID}.ogg`,
        transcript: juneTranscript,
      },
      ...P.map((c) => ({
        id: c.screenId,
        studentId: c.studentId,
        status: 'published' as const,
        consentAppAt: JUL1,
        consentVerbalSpan: { t0: 6_000, t1: 12_000 },
        startedAt: JUL1,
        endedAt: JUL1,
        retakeOf: null,
        audioKey: `raw/${c.screenId}.ogg`,
        transcript: [] as Transcript,
      })),
    ];
    await tx.insert(screens).values(screenRows as never).onConflictDoUpdate({ target: screens.id, set: updateAllExcept(screens) });

    // p2..p10 moments (two each, no audio uploaded — clip_key null; production
    // fills these). Kept so DossierView has the full Screen structure per spec.
    const otherMoments = P.flatMap((c, ci) =>
      c.stories.slice(0, 2).map((st, si) => ({
        id: uid(`bf${ci.toString(16)}${si}`),
        screenId: c.screenId,
        tStartMs: 600_000 + si * 180_000,
        tEndMs: 600_000 + si * 180_000 + 8_000,
        tag: si === 0 ? c.competency[0]!.name : c.competency[2]!.name,
        quote: st.outcome ?? st.contribution,
        repNote: `${st.title}: consistent with the written evidence.`,
        clipKey: null,
        studentVisible: true,
        struck: false,
      })),
    );
    await tx.insert(screenMoments).values([...juneMomentRows, ...otherMoments] as never).onConflictDoUpdate({ target: screenMoments.id, set: updateAllExcept(screenMoments) });

    // ── dossiers (approved) ────────────────────────────────────────────────────
    const juneCompetency: DossierCompetencies = [
      { name: 'Technical depth', score: 5, momentId: JUNE_MOMENTS[0]!.id, timestampMs: 882_000 },
      { name: 'Verification instinct', score: 5, momentId: JUNE_MOMENTS[1]!.id, timestampMs: 1_023_000 },
      { name: 'Ownership clarity', score: 4, momentId: JUNE_MOMENTS[2]!.id, timestampMs: 1_308_000 },
      { name: 'Communication', score: 4 },
    ];
    const juneFlags: DossierFlags = {
      green: [
        'Gave a precise failure analysis unprompted, minute 14:42.',
        'Proves fixes with replays, not reruns. Minute 17:03.',
      ],
      probe: ['Early answers said "we" on RailTrace; resolved cleanly when probed at 21:48.'],
    };
    const juneFollowups: Followups = [
      'How would she shard the replay checker if the fleet were 40,000 units instead of one rail line?',
      'What would she cut from RailTrace to ship it in two weeks instead of a weekend?',
    ];

    const dossierRows = [
      { id: IDS.juneDossier, screenId: JUNE_SCREEN_ID, status: 'approved' as const, competency: juneCompetency, flags: juneFlags, followups: juneFollowups, approvedAt: JUL1 },
      ...P.map((c) => ({
        id: c.dossierId,
        screenId: c.screenId,
        status: 'approved' as const,
        competency: c.competency,
        flags: c.flags,
        followups: c.followups,
        approvedAt: JUL1,
      })),
    ];
    await tx.insert(dossiers).values(dossierRows as never).onConflictDoUpdate({ target: dossiers.id, set: updateAllExcept(dossiers) });

    // ── coaching report (June only — student-only surface) ────────────────────
    const juneCoaching: CoachingReportBody = {
      landed: [
        'Your failure analysis is precise and unprompted. The votedFor walkthrough is a model answer: symptom, hypothesis, evidence, fix, proof.',
        'You quantify outcomes without being asked. 500 replays, 1,100 lines, 63 teams. Keep that habit.',
      ],
      vague: [
        'You said "we" nine times before claiming your own work on RailTrace. Lead with your part, then credit the team.',
        'The tradeoff question got a list, not a decision. Strong answers pick one and defend the cost.',
      ],
      practiceNext: [
        'Rehearse a 90-second Meridian story that ends with a number. You have the material, it is just unstated.',
        'Practice one "what would you do differently" answer that names a tool you did not use and why you would now.',
      ],
    };
    await tx
      .insert(coachingReports)
      .values([{ id: IDS.juneCoaching, screenId: JUNE_SCREEN_ID, body: juneCoaching }])
      .onConflictDoUpdate({ target: coachingReports.id, set: updateAllExcept(coachingReports) });

    // ── consents (June: app checkbox + verbal) ────────────────────────────────
    await tx
      .insert(consents)
      .values([
        { id: uid('c0a1'), studentId: IDS.juneStudent, kind: 'app_recording', granted: true, evidence: { method: 'app_checkbox', screenId: JUNE_SCREEN_ID, confirmedAt: '2026-07-01T17:40:00.000Z' } },
        { id: uid('c0a2'), studentId: IDS.juneStudent, kind: 'verbal_recording', granted: true, evidence: { method: 'verbal', screenId: JUNE_SCREEN_ID, verbalSpanMs: { t0: 6_000, t1: 12_000 } } },
      ] as never)
      .onConflictDoUpdate({ target: consents.id, set: updateAllExcept(consents) });

    // ── jobs (the three dashboard roles) ──────────────────────────────────────
    const jobRows = [
      {
        id: IDS.jobSwe,
        orgId: IDS.org,
        status: 'delivered' as const,
        title: 'SWE Intern, Infrastructure',
        jdRaw: 'Storage-adjacent SWE intern, Summer 2027, Pittsburgh or Kirkland. Distributed storage / replication team.',
        requirements: {
          mustHaves: ['Systems fundamentals', 'One distributed project with real failure handling', 'Go or C++'],
          niceToHaves: ['Storage internals'],
          skills: ['distributed-systems', 'go', 'cpp', 'database-systems'],
          team: 'storage replication',
          timeline: 'Summer 2027',
          locations: ['Pittsburgh', 'Kirkland'],
          workModel: 'onsite' as const,
          other: 'Kubernetes is trainable, not a filter. Filters that proxy protected classes are declined at intake, by policy.',
        },
        calibration: {
          passReasons: [
            { reason: 'Too junior for this req', count: 0 },
            { reason: 'Missing a must-have', count: 0 },
            { reason: 'Overlaps an existing hire', count: 0 },
            { reason: 'Other', count: 0 },
          ],
          notes: 'Verification instinct and autonomy, weighted up within role-relevant criteria. Kubernetes moved from must-have to trainable on the sponsor answer.',
        },
        compRange: { min: 54, max: 54, period: 'hour' as const, currency: 'USD' },
        embedding: embedText('SWE Intern Infrastructure distributed storage replication Go C++ systems fundamentals failure handling'),
        confirmedAt: D('2026-06-26T15:00:00Z'),
        slaDueAt: D('2026-06-29T15:00:00Z'),
      },
      {
        id: IDS.jobPm,
        orgId: IDS.org,
        status: 'matching' as const,
        title: 'PM Intern, Developer Products',
        jdRaw: 'PM intern for developer products, confirmed Jun 30.',
        requirements: { mustHaves: ['Developer empathy', 'Written communication'], niceToHaves: ['API product sense'], skills: ['product-management', 'api-design'], team: 'developer products', timeline: 'Summer 2027' },
        calibration: { passReasons: [], notes: 'Longlist of 27 in deep evaluation.' },
        compRange: { min: 48, max: 48, period: 'hour' as const, currency: 'USD' },
        embedding: embedText('PM Intern Developer Products developer empathy API product sense'),
        confirmedAt: D('2026-06-30T16:00:00Z'),
        slaDueAt: D('2026-07-03T16:00:00Z'),
      },
      {
        id: IDS.jobResearch,
        orgId: IDS.org,
        status: 'intake' as const,
        title: 'Research Intern, Efficient Inference',
        jdRaw: 'Draft. One intake question open.',
        requirements: { mustHaves: ['ML systems background'], niceToHaves: ['Inference optimization'], skills: ['deep-learning-systems', 'machine-learning'], team: 'efficient inference', timeline: 'Summer 2027' },
        calibration: { passReasons: [], notes: 'Concierge is waiting on the calibration answer; SLA has not started.' },
        compRange: { min: 60, max: 60, period: 'hour' as const, currency: 'USD' },
        embedding: embedText('Research Intern Efficient Inference ML systems inference optimization'),
        confirmedAt: null,
        slaDueAt: null,
      },
    ];
    await tx.insert(jobs).values(jobRows as never).onConflictDoUpdate({ target: jobs.id, set: updateAllExcept(jobs) });

    // ── shortlist + 10 entries ────────────────────────────────────────────────
    await tx
      .insert(shortlists)
      .values([
        {
          id: IDS.shortlist,
          jobId: IDS.jobSwe,
          status: 'delivered',
          poolNote:
            '62 screened, 27 deep-evaluated, 9 answered your follow-up question. Eight archetype fits, one alum, one wildcard: composition is policy, and every rank explains itself.',
          sampled: true,
        },
      ])
      .onConflictDoUpdate({ target: shortlists.id, set: updateAllExcept(shortlists) });

    const juneEntry = {
      id: uid('f101'),
      shortlistId: IDS.shortlist,
      studentId: IDS.juneStudent,
      rank: 1,
      fit: 94,
      rationale:
        'Strongest evidence-to-claim ratio in the pool for this role. Verified Raft consensus work under injected partitions maps directly onto your storage replication team.',
      evidenceChips: [
        { label: '15-440 consensus, verified', kind: 'verified' },
        { label: 'railtrace, Go, 18k lines', kind: 'verified' },
        { label: 'Screen: 3 strong moments', kind: 'moment' },
      ] as EvidenceChips,
      kind: 'fit' as const,
      status: 'none' as const,
      revealConsent: 'n/a' as const,
    };
    const otherEntries = P.map((c) => ({
      id: uid(`f1${c.n.toString(16).padStart(2, '0')}`),
      shortlistId: IDS.shortlist,
      studentId: c.studentId,
      rank: c.n,
      fit: c.fit,
      rationale: c.why,
      evidenceChips: c.chips,
      kind: c.entryKind,
      status: 'none' as const,
      revealConsent: c.reveal,
    }));
    await tx.insert(shortlistEntries).values([juneEntry, ...otherEntries] as never).onConflictDoUpdate({ target: shortlistEntries.id, set: updateAllExcept(shortlistEntries) });

    // ── outcomes (4 intros accepted on role 1 so far) ─────────────────────────
    const introEntryIds = [juneEntry.id, otherEntries[0]!.id, otherEntries[1]!.id, otherEntries[2]!.id];
    await tx
      .insert(outcomes)
      .values(introEntryIds.map((entryId, i) => ({ id: uid(`f2${(i + 1).toString(16).padStart(2, '0')}`), entryId, stage: 'intro' as const, loggedBy: IDS.users.jordan })))
      .onConflictDoUpdate({ target: outcomes.id, set: updateAllExcept(outcomes) });

    // ── ledger_events (APPEND-ONLY -> onConflictDoNothing on fixed ids) ───────
    // The six rows the student's Data Ledger + Home preview render, in order.
    const ledgerRows = [
      { id: uid('e0d1'), studentId: IDS.juneStudent, actorKind: 'sponsor' as const, actorId: 'Scogle, Inc', kind: 'view' as const, detail: { kind: 'view' as const, surface: 'profile' as const, note: 'Scogle, Inc viewed your profile under Premier license' }, license: 'Premier: internal recruiting use only', createdAt: D('2026-07-02T13:41:00Z') },
      { id: uid('e0d2'), studentId: IDS.juneStudent, actorKind: 'agent' as const, actorId: 'verifier', kind: 'verify' as const, detail: { kind: 'verify' as const, evidenceId: jEv.e2, method: 'repo_authorship', result: 'verified' as const, note: 'Verifier confirmed you authored railtrace (14 commits sampled)' }, license: null, createdAt: D('2026-07-01T15:00:00Z') },
      { id: uid('e0d3'), studentId: IDS.juneStudent, actorKind: 'system' as const, actorId: 'recruiter', kind: 'shortlist' as const, detail: { kind: 'shortlist' as const, jobId: IDS.jobSwe, shortlistId: IDS.shortlist, rank: 1, note: 'Included in a shortlist: SWE Intern, Infrastructure at Scogle' }, license: null, createdAt: D('2026-06-29T14:00:00Z') },
      { id: uid('e0d4'), studentId: IDS.juneStudent, actorKind: 'sponsor' as const, actorId: 'Scogle, Inc', kind: 'export' as const, detail: { kind: 'export' as const, scope: 'dossier_pdf', note: 'Scogle exported your dossier PDF (watermarked, logged)' }, license: 'Premier: internal recruiting use only', createdAt: D('2026-06-29T18:00:00Z') },
      { id: uid('e0d5'), studentId: IDS.juneStudent, actorKind: 'sponsor' as const, actorId: 'Scogle, Inc', kind: 'stream' as const, detail: { kind: 'stream' as const, momentId: JUNE_MOMENTS[0]!.id, durationMs: 8_000, note: 'Scogle streamed 2 audio highlights from your screen' }, license: 'Premier: internal recruiting use only', createdAt: D('2026-06-28T20:00:00Z') },
      { id: uid('e0d6'), studentId: IDS.juneStudent, actorKind: 'student' as const, actorId: 'junepark', kind: 'edit' as const, detail: { kind: 'edit' as const, field: 'availability', note: 'You updated availability to Summer 2027' }, license: null, createdAt: D('2026-06-21T16:00:00Z') },
    ];
    await tx.insert(ledgerEvents).values(ledgerRows as never).onConflictDoNothing({ target: ledgerEvents.id });

    // ── ops: exceptions (6 open + 2 resolved examples) ────────────────────────
    const exOpen = [
      { code: 'ec01', category: 'verification_conflict' as const, agent: 'verifier' as const, short: 'Verifier', title: 'Repo authorship: claimed solo, git shows a second committer', context: 'railforge repo, candidate hzhang: 38% of early commits by another account. Student was asked first, replied "pair-programmed week one, solo after". Commit timeline is consistent with that.', rec: 'Accept the explanation, relabel the evidence "shared early, solo after week 1". No penalty; the label just gets honest.', age: '2h' },
      { code: 'ec02', category: 'low_confidence_shortlist' as const, agent: 'recruiter' as const, short: 'Recruiter', title: 'PM Intern (Scogle): only 7 clear the bar, not 10', context: 'Pool depth for PM archetype is thin this cycle: 7 candidates above threshold, next 3 are 9+ points below. Padding to ten would dilute the slate.', rec: 'Deliver 7 with the standard pool-health note. Padding is how sponsor trust dies.', age: '4h' },
      { code: 'ec03', category: 'policy_refusal' as const, agent: 'concierge' as const, short: 'Concierge', title: 'Sponsor asked to filter for "native English speakers"', context: 'Refused at intake as a protected-class proxy, per policy. A decline message is drafted that offers the lawful alternative: a communication rubric scored from the screen.', rec: 'Approve the drafted decline + alternative. Wording is calibrated to keep the relationship warm.', age: '5h' },
      { code: 'ec04', category: 'sla_risk' as const, agent: 'sentinel' as const, short: 'Sentinel', title: 'Research Intern intake idle for 3 days, clock never started', context: 'Sponsor answered one of two intake questions and went quiet. SLA has not started, but the sponsor may believe it has. Nudge email drafted.', rec: 'Send the drafted nudge. It restates that the 72h clock starts at confirmation, not at posting.', age: '1d' },
      { code: 'ec05', category: 'student_report' as const, agent: 'synthesizer' as const, short: 'Synthesizer', title: 'Student says a dossier quote mis-transcribed "Paxos" as "taxes"', context: 'Re-transcription confirms the student is right. Corrected diff attached; dossier is unpublished pending the fix, student notified.', rec: 'Apply the corrected transcript and re-send for the student\'s approval.', age: '1d' },
      { code: 'ec06', category: 'consent_edge' as const, agent: 'rep' as const, short: 'Talent Rep', title: 'Student paused mid-call during the consent re-read', context: 'Student hesitated when recording consent was restated verbally, then asked to stop. Call ended cleanly; per hard rule nothing was retained. Rep offered the text-mode equivalent.', rec: 'Confirm zero retention and send the text-mode invitation. No follow-up pressure.', age: '2d' },
    ];
    const exResolved = [
      { code: 'ec07', category: 'verification_conflict' as const, agent: 'verifier' as const, short: 'Verifier', title: 'Course claim: 15-451 listed but not on attested coursework', context: 'Student attested 15-210 and 15-451; the Verifier flagged 15-451 as unlisted on the profile. Student corrected the profile within the hour.', rec: 'Accept the corrected attestation. No penalty.', age: '3d', status: 'approved' as const },
      { code: 'ec08', category: 'sla_risk' as const, agent: 'sentinel' as const, short: 'Sentinel', title: 'Shortlist for role 1 trending 2h from the 72h SLA edge', context: 'Recruiter longlist was slower than usual; Sentinel flagged the risk early. Extra evaluation capacity was allocated and the shortlist delivered in 41h.', rec: 'No action needed; delivered inside SLA. Logged for capacity planning.', age: '4d', status: 'overridden' as const },
    ];
    const exceptionRows = [
      ...exOpen.map((e) => ({ id: uid(e.code), category: e.category, agent: e.agent, context: { agent: e.short, quote: e.context, category: e.category, refs: {} }, recommendation: e.rec, status: 'open' as const, resolvedBy: null, resolvedAt: null })),
      ...exResolved.map((e) => ({ id: uid(e.code), category: e.category, agent: e.agent, context: { agent: e.short, quote: e.context, category: e.category, refs: {} }, recommendation: e.rec, status: e.status, resolvedBy: IDS.users.lena, resolvedAt: D('2026-06-30T12:00:00Z') })),
    ];
    await tx.insert(exceptions).values(exceptionRows as never).onConflictDoUpdate({ target: exceptions.id, set: updateAllExcept(exceptions) });

    // ── agent_runs (a handful so cost dashboards are non-empty) ───────────────
    const runRows = [
      { id: uid('a7c1'), agent: 'rep' as const, model: 'claude-haiku-4.5', promptVersion: 'v0.1', inputRef: `screen:${JUNE_SCREEN_ID}`, output: { confidence: 0.93, result: { turns: 9 } }, confidence: 0.93, costUsd: '0.041200', tokens: 18400, flagged: false, createdAt: JUL1 },
      { id: uid('a7c2'), agent: 'synthesizer' as const, model: 'claude-opus-4.8', promptVersion: 'v0.1', inputRef: `screen:${JUNE_SCREEN_ID}`, output: { confidence: 0.9, result: { dossierId: IDS.juneDossier } }, confidence: 0.9, costUsd: '0.128000', tokens: 22100, flagged: false, createdAt: JUL1 },
      { id: uid('a7c3'), agent: 'verifier' as const, model: 'gpt-5.4-nano', promptVersion: 'v0.1', inputRef: `evidence:${jEv.e2}`, output: { confidence: 0.97, result: { verified: true } }, confidence: 0.97, costUsd: '0.002400', tokens: 3200, flagged: false, createdAt: D('2026-07-01T15:00:00Z') },
      { id: uid('a7c4'), agent: 'recruiter' as const, model: 'claude-opus-4.8', promptVersion: 'v0.1', inputRef: `job:${IDS.jobSwe}`, output: { confidence: 0.88, result: { shortlistId: IDS.shortlist, entries: 10 } }, confidence: 0.88, costUsd: '0.214000', tokens: 41800, flagged: false, createdAt: D('2026-06-28T09:00:00Z') },
      { id: uid('a7c5'), agent: 'concierge' as const, model: 'claude-sonnet-5', promptVersion: 'v0.1', inputRef: `job:${IDS.jobSwe}`, output: { confidence: 0.91, result: { intent: 'intake' } }, confidence: 0.91, costUsd: '0.033600', tokens: 12600, flagged: false, createdAt: D('2026-06-26T14:30:00Z') },
      { id: uid('a7c6'), agent: 'coach' as const, model: 'claude-sonnet-5', promptVersion: 'v0.1', inputRef: `screen:${JUNE_SCREEN_ID}`, output: { confidence: 0.92, result: { coachingReportId: IDS.juneCoaching } }, confidence: 0.92, costUsd: '0.037400', tokens: 13900, flagged: false, createdAt: JUL1 },
      { id: uid('a7c7'), agent: 'sentinel' as const, model: 'gemini-3.1-flash-lite', promptVersion: 'v0.1', inputRef: 'queue:weekly', output: { confidence: 0.95, result: { exceptions: 6 } }, confidence: 0.95, costUsd: '0.000800', tokens: 2100, flagged: false, createdAt: D('2026-07-01T06:00:00Z') },
    ];
    await tx.insert(agentRuns).values(runRows as never).onConflictDoUpdate({ target: agentRuns.id, set: updateAllExcept(agentRuns) });

    // ── ops operational aggregates + sponsor dashboard, in config ─────────────
    // These are operational rollups (agent workforce health, weekly stats) and a
    // sponsor dashboard blob, stored in config because they are aggregates, not
    // per-entity rows. Documented here so readers know where the ops-console and
    // sponsor-dashboard numbers come from. Demo keys are upserted (refreshable);
    // the operational defaults above stay onConflictDoNothing (never clobbered).
    const demoConfig = [
      {
        key: 'ops.agent_workforce',
        value: [
          { name: 'Talent Rep', note: 'voice screens', eval: '4.7', aut: 'A', dot: '#3a9a4c' },
          { name: 'Profile Synthesizer', note: 'student approves output', eval: '4.8', aut: 'A', dot: '#3a9a4c' },
          { name: 'Verifier', note: 'claims × artifacts', eval: '4.5', aut: 'B', dot: '#3a9a4c' },
          { name: 'Recruiter', note: '1-in-5 shortlists sampled', eval: '4.4', aut: 'B', dot: '#e8b13a' },
          { name: 'Concierge', note: 'reads A · commits C', eval: '4.6', aut: 'A/C', dot: '#3a9a4c' },
          { name: 'Ops Sentinel', note: 'this queue, the digest', eval: '4.6', aut: 'B', dot: '#3a9a4c' },
        ],
      },
      {
        key: 'ops.week_stats',
        value: {
          week: 'wk 27',
          digestSent: 'Mon digest sent 8:02 AM',
          medianResolveMin: 1.4,
          stats: [
            { label: 'Exceptions per 100 agent runs', value: '0.8 ↓', color: '#0d4b17' },
            { label: 'Operator hours logged', value: '3.6 h', color: '#1e1e1e' },
            { label: 'Screens completed', value: '214', color: '#1e1e1e' },
            { label: 'Cost per completed screen', value: '$3.40', color: '#1e1e1e' },
            { label: 'Shortlists on time', value: '9 / 9', color: '#0d4b17' },
          ],
          adverseImpact: {
            body: 'All shortlist ratios within band this cycle. Full view lives in the Shortlist Sampler with per-cycle history.',
            meta: 'last run: Jul 1, 06:00 · next: Jul 8',
          },
        },
      },
      {
        key: 'sponsor.scogle_dashboard',
        value: {
          greeting: 'Morning, Jordan',
          subtitle: 'Tuesday, July 1 · one shortlist waiting on you, one role matching, one intake open',
          stats: [
            { n: '62', label: 'candidates screened for your roles' },
            { n: '41h', label: 'time to first shortlist, SLA 72h' },
            { n: '4 / 10', label: 'intros accepted on role 1 so far' },
            { n: '3 / 10', label: 'role slots used this year' },
          ],
          roles: [
            { name: 'SWE Intern, Infrastructure', meta: 'Posted Jun 26 · storage replication team', status: 'Shortlist ready · 10 candidates, 1 wildcard', sla: 'Delivered in 41h', slaBg: '#dcefe0', slaFg: '#0d4b17', action: 'Review shortlist', jobId: IDS.jobSwe },
            { name: 'PM Intern, Developer Products', meta: 'Posted Jun 30 · confirmed yesterday', status: 'Recruiter matching · longlist of 27 in deep evaluation', sla: '38h left', slaBg: '#fdf6e3', slaFg: '#654a00', action: 'View intake', jobId: IDS.jobPm },
            { name: 'Research Intern, Efficient Inference', meta: 'Draft · one intake question open', status: 'Concierge is waiting on your calibration answer', sla: 'SLA starts on confirm', slaBg: '#f0f4f8', slaFg: '#5f6f7f', action: 'Resume intake', jobId: IDS.jobResearch },
          ],
          conciergeChips: [
            'How many ML systems students graduate in May?',
            'Rerun role 1, weight Go higher',
            'Which shortlisted candidates are alumni?',
          ],
          funnel: { screened: 62, deepEvaluated: 27, answeredFollowup: 9 },
        },
      },
    ];
    await tx
      .insert(config)
      .values(demoConfig.map((c) => ({ key: c.key, value: c.value, version: 1 })))
      .onConflictDoUpdate({ target: config.key, set: { value: sql`excluded.value` } });
  });

  // ── counts for the report ──────────────────────────────────────────────────
  const one = async (t: PgTable): Promise<number> => {
    const [row] = await database.select({ n: sql<number>`count(*)::int` }).from(t);
    return row?.n ?? 0;
  };
  return {
    skills: await one(skills),
    config: await one(config),
    users: await one(users),
    students: await one(students),
    screens: await one(screens),
    screenMoments: await one(screenMoments),
    dossiers: await one(dossiers),
    shortlistEntries: await one(shortlistEntries),
    exceptions: await one(exceptions),
    ledgerEvents: await one(ledgerEvents),
    agentRuns: await one(agentRuns),
  };
}
