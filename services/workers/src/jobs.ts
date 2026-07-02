// Job payload contracts (zod). These are the wire contract other services enqueue
// against: the voice-gateway pushes SynthesisJob JSON onto the plain Redis list
// 'jobs:synthesis'; the web app enqueues MatchingJob / LedgerFanoutJob /
// DeletionJob / ExportJob after the corresponding user action. Validated on the
// way in so a bad payload fails loudly at the boundary, not deep in a worker.

import { z } from 'zod';
import { LedgerActorKind, LedgerEventKind, LedgerDetail } from '@tartan/types';

// ── synthesis (post-call pipeline) ───────────────────────────────────────────
export const SynthesisJob = z.object({ screenId: z.string().uuid() });
export type SynthesisJob = z.infer<typeof SynthesisJob>;

// ── verification (deterministic evidence checks) ─────────────────────────────
// Any one selector; the worker resolves the set of evidence rows to check.
export const VerificationJob = z.object({
  studentId: z.string().uuid().optional(),
  screenId: z.string().uuid().optional(),
  evidenceId: z.string().uuid().optional(),
});
export type VerificationJob = z.infer<typeof VerificationJob>;

// ── matching (recruiter pipeline v1) ─────────────────────────────────────────
export const MatchingJob = z.object({ jobId: z.string().uuid() });
export type MatchingJob = z.infer<typeof MatchingJob>;

// ── ledger fanout ────────────────────────────────────────────────────────────
// Either fan out shortlist events for a whole shortlist, or write an explicit
// batch of events (search_hit fanout etc.).
export const LedgerEventInput = z.object({
  studentId: z.string().uuid(),
  actorKind: LedgerActorKind,
  actorId: z.string().optional(),
  kind: LedgerEventKind,
  detail: LedgerDetail.optional(),
  license: z.string().optional(),
});
export type LedgerEventInput = z.infer<typeof LedgerEventInput>;

export const LedgerFanoutJob = z.union([
  z.object({ shortlistId: z.string().uuid() }),
  z.object({ events: z.array(LedgerEventInput).min(1) }),
]);
export type LedgerFanoutJob = z.infer<typeof LedgerFanoutJob>;

// ── notifications ────────────────────────────────────────────────────────────
export const NotificationJob = z.object({
  studentId: z.string().uuid().optional(),
  kind: z.string(),
  title: z.string(),
  body: z.string().optional(),
  // Optional ledger event to also append (kept honest: real email is out of scope).
  ledger: LedgerEventInput.optional(),
});
export type NotificationJob = z.infer<typeof NotificationJob>;

// ── deletion queue (three named jobs) ────────────────────────────────────────
export const DeletionJob = z.object({ studentId: z.string().uuid() });
export type DeletionJob = z.infer<typeof DeletionJob>;

export const ExportJob = z.object({ studentId: z.string().uuid() });
export type ExportJob = z.infer<typeof ExportJob>;

export const PurgeAudioJob = z.object({ studentId: z.string().uuid() });
export type PurgeAudioJob = z.infer<typeof PurgeAudioJob>;

// Named jobs on the deletion queue.
export const DELETION_JOB = {
  delete: 'delete',
  export: 'export',
  purgeAudio: 'purge_audio',
} as const;

// Named jobs on the schedules queue (also the POST /trigger/:job names).
export const SCHEDULE_JOB = {
  slaSweep: 'sla_sweep',
  retentionSweep: 'retention_sweep',
  mondayDigest: 'monday_digest',
  adverseImpactRollup: 'adverse_impact_rollup',
} as const;
export type ScheduleJobName = (typeof SCHEDULE_JOB)[keyof typeof SCHEDULE_JOB];
