import { z } from 'zod';

// ── Background job contracts ──────────────────────────────────────────────
// The web app and voice-gateway enqueue work by LPUSHing JSON onto plain
// Redis lists; the workers service bridges each list into its BullMQ queue
// (services/workers/src/bridge.ts). These schemas are the wire contract.

export const JOB_LISTS = {
  synthesis: 'jobs:synthesis',
  matching: 'jobs:matching',
  ledgerFanout: 'jobs:ledger_fanout',
  verification: 'jobs:verification',
  export: 'jobs:export',
  deletion: 'jobs:deletion',
} as const;
export type JobList = (typeof JOB_LISTS)[keyof typeof JOB_LISTS];

export const SynthesisJobPayload = z.object({ screenId: z.string().uuid() });
export type SynthesisJobPayload = z.infer<typeof SynthesisJobPayload>;

export const MatchingJobPayload = z.object({ jobId: z.string().uuid() });
export type MatchingJobPayload = z.infer<typeof MatchingJobPayload>;

export const LedgerFanoutJobPayload = z.union([
  z.object({ shortlistId: z.string().uuid() }),
  z.object({
    events: z.array(
      z.object({
        studentId: z.string().uuid(),
        kind: z.string(),
        detail: z.unknown().optional(),
      }),
    ),
  }),
]);
export type LedgerFanoutJobPayload = z.infer<typeof LedgerFanoutJobPayload>;

export const VerificationJobPayload = z.object({
  evidenceId: z.string().uuid(),
  studentId: z.string().uuid(),
});
export type VerificationJobPayload = z.infer<typeof VerificationJobPayload>;

export const ExportJobPayload = z.object({ studentId: z.string().uuid() });
export type ExportJobPayload = z.infer<typeof ExportJobPayload>;

export const DeletionJobPayload = z.object({
  studentId: z.string().uuid(),
  // ISO time the student confirmed; recorded in the final anonymized ledger row.
  requestedAt: z.string(),
});
export type DeletionJobPayload = z.infer<typeof DeletionJobPayload>;

// ── Export status handshake ───────────────────────────────────────────────
// The export worker writes progress under config key `export.{studentId}`;
// the student surface polls student.exportStatus which reads the same key.

export const exportConfigKey = (studentId: string) => `export.${studentId}`;

export const ExportStatus = z.object({
  state: z.enum(['pending', 'ready', 'failed']),
  requestedAt: z.string(),
  readyAt: z.string().optional(),
  // 7-day presigned GET for exports/{studentId}.json (S3).
  url: z.string().optional(),
  error: z.string().optional(),
});
export type ExportStatus = z.infer<typeof ExportStatus>;
