// Deterministic stub outputs. When OPENROUTER_API_KEY is unset, runAgent
// returns these instead of calling the model, so every downstream flow (the
// post-call Synthesizer, the Recruiter shortlist, the intake conversation)
// stays functional in demos with zero external dependencies.
//
// Each canned value is schema-valid against its agent's structured-output
// schema in @tartan/types. getStubOutput(schema) picks the first canned value
// that satisfies the requested schema, so callers get the right shape for
// whatever schema they passed. The narrative reuses the June Park demo thread
// from the design notes so stub output reads like the real product.

import type { ZodTypeAny, infer as zInfer } from 'zod';
import type {
  CoachingReport,
  ConciergeReply,
  DossierDraft,
  ExperienceStories,
  IntakeExtraction,
  RecruiterRanking,
  ResumeParseResult,
  SentinelDigest,
  VerifierVerdict,
} from '@tartan/types';

// Stable demo ids so stub output is reproducible across runs.
export const DEMO_STUDENT_ID = '11111111-1111-4111-8111-111111111111';
export const DEMO_EVIDENCE_ID = '22222222-2222-4222-8222-222222222222';
export const DEMO_ENTRY_ID = '33333333-3333-4333-8333-333333333333';

// ── Synthesizer: dossier draft ──────────────────────────────────────────────
export const stubDossierDraft: DossierDraft = {
  competency: [
    {
      name: 'Distributed systems',
      score: 5,
      summary:
        'Diagnosed a Raft split-brain to a non-atomic votedFor persist, in her own words.',
      timestampMs: 882000,
    },
    {
      name: 'Debugging under pressure',
      score: 5,
      summary: 'Unprompted failure analysis, symptom to root cause to proof.',
      timestampMs: 882000,
    },
    {
      name: 'Ownership',
      score: 4,
      summary: 'Built a 500-run replay checker rather than trusting a single rerun.',
      timestampMs: 910000,
    },
  ],
  flags: {
    green: [
      'Proves fixes with replay checkers rather than reruns',
      'Explains tradeoffs without being asked',
    ],
    probe: ['Has not led a multi-person project yet; ask about collaboration'],
  },
  followups: [
    'Walk me through a time your first fix was wrong and how you caught it.',
    'How would you extend the replay checker to cover network partitions?',
  ],
  moments: [
    {
      tStartMs: 882000,
      tEndMs: 890000,
      tag: 'Debugging under pressure',
      quote:
        'The real bug was that we persisted votedFor after the term check, not atomically with it.',
      repNote: 'Unprompted failure analysis, symptom to proof.',
    },
  ],
  confidence: 0.82,
};

// ── Coach: coaching report (student-only) ────────────────────────────────────
export const stubCoachingReport: CoachingReport = {
  body: {
    landed: [
      'Your Raft debugging story was concrete and defensible, symptom to proof.',
      'You explained the votedFor atomicity tradeoff clearly and without hedging.',
    ],
    vague: [
      'The team collaboration answer stayed abstract; name what you personally owned.',
      'The scaling question drifted; a single concrete number would have anchored it.',
    ],
    practiceNext: [
      'Prepare one story where your first fix was wrong and you caught it.',
      'Practice stating your exact contribution in one sentence before the details.',
    ],
  },
  confidence: 0.8,
};

// ── Synthesizer: experience stories ──────────────────────────────────────────
export const stubExperienceStories: ExperienceStories = {
  stories: [
    {
      title: 'RailTrace, TartanHacks',
      situation:
        'Built a distributed trace collector under a 24-hour hackathon deadline.',
      contribution:
        'Wrote the Go ingestion path and the Raft-based coordination for replica election.',
      outcome: 'Won first place; the consensus layer survived injected partitions.',
    },
    {
      title: '15-440 consensus project',
      situation: 'Course project implementing Raft from the paper.',
      contribution:
        'Personally implemented log replication and the leader-election term logic.',
      outcome: null,
    },
  ],
  confidence: 0.78,
};

// ── Recruiter: ranking ───────────────────────────────────────────────────────
export const stubRecruiterRanking: RecruiterRanking = {
  ranking: [
    {
      studentId: DEMO_STUDENT_ID,
      rank: 1,
      fit: 94,
      rationale:
        'Strongest evidence-to-claim ratio in the pool, with verified Raft consensus work. It maps directly onto your storage replication team.',
      evidenceChips: ['15-440 consensus, verified', 'railtrace, Go', '3 strong moments'],
      kind: 'fit',
    },
  ],
  confidence: 0.79,
};

// ── Recruiter/Concierge: intake extraction ───────────────────────────────────
export const stubIntakeExtraction: IntakeExtraction = {
  title: 'Distributed systems engineer',
  requirements: {
    mustHaves: ['Distributed systems fundamentals', 'A systems language (Go, Rust, or C++)'],
    niceToHaves: ['Consensus / replication experience', 'Observability tooling'],
    skills: ['distributed-systems', 'go'],
    team: 'Storage replication',
    timeline: 'Start within the semester',
    locations: ['Pittsburgh, PA', 'Remote (US)'],
    workModel: 'hybrid',
  },
  compRange: { min: 45, max: 60, period: 'hour', currency: 'USD' },
  openQuestions: ['Is the role open to rising seniors on CPT?'],
  confidence: 0.75,
};

// ── Verifier: verdict ────────────────────────────────────────────────────────
export const stubVerifierVerdict: VerifierVerdict = {
  evidenceId: DEMO_EVIDENCE_ID,
  verdict: 'verified',
  method: 'github_commit_email',
  rationale: 'Commit authorship email matches the verified Andrew ID on file.',
  confidence: 0.9,
};

// ── Concierge: reply ─────────────────────────────────────────────────────────
export const stubConciergeReply: ConciergeReply = {
  reply:
    'June is your strongest match for the replication team. Her Raft failure-handling is verified, and there are three audio moments you can stream from the dossier.',
  suggestions: [
    'Ask June how she would extend her replay checker to partitions.',
    'Compare June and Rohan on systems depth.',
    'Request an intro to June.',
  ],
  refs: [{ label: 'June Park (rank 1)', entryId: DEMO_ENTRY_ID }],
  confidence: 0.72,
};

// ── Sentinel: weekly digest ──────────────────────────────────────────────────
export const stubSentinelDigest: SentinelDigest = {
  headline: 'Agents healthy; exceptions down 12% week over week.',
  highlights: [
    '62 screens synthesized, 9 shortlists delivered within SLA.',
    'Exceptions per 100 runs fell from 4.1 to 3.6.',
  ],
  costAlerts: [
    { agent: 'recruiter', note: 'Trending toward monthly cap on Opus usage.', pctOfBudget: 81 },
  ],
  adverseImpactNote: 'No statistically notable disparity in this week rollup.',
  confidence: 0.7,
};

// ── Resume parse: onboarding jump-start draft ────────────────────────────────
// Reuses the Alex Rivera fixture resume so stub output reads like the real
// parse. Everything here is self-reported (a resume is a claim), so downstream
// it lands as pending/self_reported and unverified.
export const stubResumeParseResult: ResumeParseResult = {
  logistics: {
    program: 'B.S. Computer Science',
    gradDateISO: '2027-05-01',
    kind: 'undergrad',
    workAuth: { status: 'citizen', needsSponsorship: false },
    locations: ['Pittsburgh, PA', 'Kirkland, WA', 'Remote (US)'],
    compExpectation: { min: 50, max: 60, hourly: true },
    startupOpen: false,
  },
  skills: [
    { name: 'Distributed systems', slug: 'distributed-systems', proficiency: 5, evidenceHint: 'TA for 15-440; railforge replicated log' },
    { name: 'Go', slug: 'go', proficiency: 4, evidenceHint: 'Stripe rate-limiting service in Go' },
    { name: 'Rust', slug: 'rust', proficiency: 4, evidenceHint: 'railforge leaderless replicated log' },
    { name: 'PostgreSQL', slug: 'database-systems', evidenceHint: '15-445 B+ tree with buffer pool and WAL' },
  ],
  stories: [
    {
      title: 'Rate-limiting service, Stripe',
      situation: 'Summer 2026 internship on infrastructure at Stripe.',
      contribution: 'Built a token-bucket rate limiter in Go backed by Redis handling 80k req/s, and the shadow-traffic harness that validated the rollout.',
      outcome: 'Cut p99 latency from 45ms to 8ms.',
    },
    {
      title: 'railforge, leaderless replicated log',
      situation: 'Personal systems project in Rust.',
      contribution: 'Implemented read-repair and bounded staleness over a leaderless replicated log.',
      outcome: 'Sustained 3x baseline throughput under simulated network partitions.',
    },
  ],
  evidence: [
    { type: 'work', title: 'Software Engineering Intern, Stripe', note: 'Summer 2026; rate-limiting service in Go.' },
    { type: 'repo', title: 'railforge', url: 'https://github.com/alexrivera-cmu/railforge', note: 'Leaderless replicated log in Rust.' },
    { type: 'course', title: '15-440', note: 'Distributed Systems; TA, Spring 2026.' },
    { type: 'course', title: '15-445', note: 'Database Systems; B+ tree with buffer pool and WAL.' },
  ],
};

// Default free-text stub for non-structured (streaming) calls like the Rep.
export const STUB_TEXT =
  'Thanks, that is a great place to start. Tell me about a project where something broke and you had to figure out why.';

// Ordered list of every canned structured output. getStubOutput scans this and
// returns the first value that satisfies the requested schema.
const CANNED_OUTPUTS: readonly unknown[] = [
  // ResumeParseResult is intentionally first: its fields are all
  // optional-with-defaults, so a loose scan would let another stub (e.g. the
  // dossier draft) satisfy it as an empty draft. Listing it first makes a
  // ResumeParseResult request resolve to this real draft. It does not match any
  // other agent's schema (those require fields this object lacks).
  stubResumeParseResult,
  stubDossierDraft,
  stubCoachingReport,
  stubExperienceStories,
  stubRecruiterRanking,
  stubIntakeExtraction,
  stubVerifierVerdict,
  stubConciergeReply,
  stubSentinelDigest,
];

/**
 * Return a schema-valid canned output for the given schema, or null if no known
 * stub satisfies it (the caller then surfaces a clear "no stub for this schema"
 * error rather than a silent wrong shape).
 */
export function getStubOutput<S extends ZodTypeAny>(schema: S): zInfer<S> | null {
  for (const candidate of CANNED_OUTPUTS) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return parsed.data as zInfer<S>;
  }
  return null;
}
