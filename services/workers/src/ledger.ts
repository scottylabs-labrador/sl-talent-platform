// Ledger helpers. ledger_events is APPEND-ONLY (UPDATE/DELETE blocked by a DB
// trigger); we only ever insert. subjectHash() produces the salted hash kept on
// the deletion audit row so the deletion itself is auditable without retaining
// identity (ARCHITECTURE section 8).

import { createHash } from 'node:crypto';
import { db, ledgerEvents } from '@tartan/db';
import { LEDGER_SALT } from './env.js';
import type { LedgerEventInput } from './jobs.js';

export function subjectHash(studentId: string): string {
  return createHash('sha256').update(`${LEDGER_SALT}:${studentId}`).digest('hex');
}

type LedgerRow = typeof ledgerEvents.$inferInsert;

/** Batch-insert ledger events. Used by fanout and the pipelines. */
export async function appendLedger(events: LedgerEventInput[]): Promise<number> {
  if (events.length === 0) return 0;
  const rows: LedgerRow[] = events.map((e) => ({
    studentId: e.studentId,
    actorKind: e.actorKind,
    actorId: e.actorId ?? null,
    kind: e.kind,
    detail: e.detail ?? null,
    license: e.license ?? null,
  }));
  await db().insert(ledgerEvents).values(rows);
  return rows.length;
}
