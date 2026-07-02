// Scripted, design-faithful interview for SIMULATION MODE (no CARTESIA_API_KEY —
// the demo default). Same six-section state machine and protocol as the real
// pipeline; captions and tool calls are canned and paced.
//
// The captions and the three marked moments are lifted verbatim from the design
// (docs/design-notes/student-app.md: "Captions transcript" and "Clips / audio
// moments"). The post-call review screen shows exactly these three moments, so
// the simulation MUST mark them:
//   m1 "Debugging under pressure"  m2 "Verification instinct"  m3 "Ownership clarity"
//
// Each event's `at` is a fraction (0..1) of the section's duration. The scheduler
// scales those onto SIM_SECTION_SECONDS so the whole arc compresses uniformly.

export type SimEvent =
  | { at: number; kind: 'caption'; speaker: 'rep' | 'student'; text: string }
  | { at: number; kind: 'consent' }
  | { at: number; kind: 'moment'; tag: string; quote: string; note: string }
  | { at: number; kind: 'escalation'; reason: string };

export interface SimSection {
  events: readonly SimEvent[];
}

// One entry per section index (0..5), aligned with SECTIONS in sections.ts.
export const SIM_SCRIPT: readonly SimSection[] = [
  // 0 — intro + verbal consent
  {
    events: [
      {
        at: 0.06,
        kind: 'caption',
        speaker: 'rep',
        text: "Hey, good to meet you. I'm the Talent Rep. This call is recorded so your best answers can become evidence you own and control, and nothing is shared until you approve it. Are you good to start?",
      },
      {
        at: 0.46,
        kind: 'caption',
        speaker: 'student',
        text: "Yeah, that sounds good. Let's do it.",
      },
      { at: 0.58, kind: 'consent' },
      {
        at: 0.72,
        kind: 'caption',
        speaker: 'rep',
        text: 'Great, thank you. Nothing here leaves without your yes.',
      },
    ],
  },
  // 1 — background
  {
    events: [
      {
        at: 0.06,
        kind: 'caption',
        speaker: 'rep',
        text: 'So tell me where you are and what kind of work you keep getting pulled toward.',
      },
      {
        at: 0.42,
        kind: 'caption',
        speaker: 'student',
        text: "I'm a junior in computer science at CMU. Mostly systems work, distributed systems and infrastructure. I like the stuff that breaks in weird ways under load.",
      },
      {
        at: 0.8,
        kind: 'caption',
        speaker: 'rep',
        text: "Nice, that's a good place to live. Let's go somewhere concrete.",
      },
    ],
  },
  // 2 — experience deep-dive 1 (15-440 consensus): marks m1 and m2
  {
    events: [
      {
        at: 0.04,
        kind: 'caption',
        speaker: 'rep',
        text: 'Let’s go deeper on the 15-440 project. You said the consensus layer failed under partition. Walk me through how you found it.',
      },
      {
        at: 0.26,
        kind: 'caption',
        speaker: 'student',
        text: 'So our Raft implementation kept electing two leaders when we injected a network partition in the test harness...',
      },
      {
        at: 0.44,
        kind: 'caption',
        speaker: 'student',
        text: 'I suspected our election timeout was misconfigured, but logging showed both nodes had valid terms. The real bug was that we persisted votedFor after the term check, not atomically with it.',
      },
      {
        at: 0.5,
        kind: 'moment',
        tag: 'Debugging under pressure',
        quote:
          'The real bug was that we persisted votedFor after the term check, not atomically with it.',
        note: 'precise, unprompted failure analysis: symptom, hypothesis, root cause',
      },
      {
        at: 0.6,
        kind: 'caption',
        speaker: 'rep',
        text: 'Nice. What did you actually change, and how did you prove the fix instead of just re-running until green?',
      },
      {
        at: 0.82,
        kind: 'caption',
        speaker: 'student',
        text: "I wrote the vote record as a single fsync'd tuple, then added a Jepsen-style checker that replayed the exact partition schedule 500 times. Zero split votes after.",
      },
      {
        at: 0.9,
        kind: 'moment',
        tag: 'Verification instinct',
        quote:
          'Replayed the exact partition schedule 500 times. Zero split votes after.',
        note: 'built a checker rather than re-running until green',
      },
    ],
  },
  // 3 — experience deep-dive 2 (ownership + RailTrace): marks m3
  {
    events: [
      {
        at: 0.06,
        kind: 'caption',
        speaker: 'rep',
        text: "You said 'our implementation'. Which parts of the consensus code did you personally write?",
      },
      {
        at: 0.3,
        kind: 'caption',
        speaker: 'student',
        text: 'The election module and the persistence layer were mine, about 1,100 lines. My partner owned log replication. We co-wrote the test harness.',
      },
      {
        at: 0.4,
        kind: 'moment',
        tag: 'Ownership clarity',
        quote:
          'The election module and the persistence layer were mine, about 1,100 lines.',
        note: 'names their exact surface area without hedging',
      },
      {
        at: 0.58,
        kind: 'caption',
        speaker: 'rep',
        text: "That's clear, thank you. Switch me to RailTrace for a minute, your TartanHacks project.",
      },
      {
        at: 0.8,
        kind: 'caption',
        speaker: 'student',
        text: "Sure. RailTrace buffered bursty writes for one rail line's telemetry. We kept it deliberately small so we could reason about backpressure.",
      },
    ],
  },
  // 4 — technical probe (tradeoff / what would you do differently)
  {
    events: [
      {
        at: 0.06,
        kind: 'caption',
        speaker: 'rep',
        text: 'If you rebuilt the consensus layer today, what would you do differently?',
      },
      {
        at: 0.36,
        kind: 'caption',
        speaker: 'student',
        text: "Honestly, I'd model the state machine in TLA+ first. We lost a week to a bug a spec would have caught in an afternoon.",
      },
      {
        at: 0.64,
        kind: 'caption',
        speaker: 'rep',
        text: "Good answer. Naming the tool you didn't reach for is the useful part.",
      },
    ],
  },
  // 5 — student questions + wrap
  {
    events: [
      {
        at: 0.06,
        kind: 'caption',
        speaker: 'rep',
        text: "We're almost at time. Anything you want to ask me?",
      },
      {
        at: 0.3,
        kind: 'caption',
        speaker: 'student',
        text: 'Yeah, what happens to this after the call?',
      },
      {
        at: 0.56,
        kind: 'caption',
        speaker: 'rep',
        text: 'You get a private coaching note, and a dossier draft you review before anything reaches a sponsor. Nothing ships without your approval. Thanks for the time, this was a genuinely strong call.',
      },
    ],
  },
] as const;
