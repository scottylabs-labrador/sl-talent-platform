// The Data Ledger writer. Every consequential access to a student's data lands
// here: sponsor views, search hits, shortlist placements, exports, audio
// streams, verifications, edits. ledger_events is APPEND-ONLY (UPDATE/DELETE
// are blocked by a DB trigger) — this helper only ever inserts.
//
// "Another door into the same room, never a bigger room": every surface writes
// through this one helper so the audit trail is uniform.

import { db, ledgerEvents } from '@tartan/db';
import type {
  LedgerActorKind,
  LedgerEventKind,
  LedgerDetail,
} from '@tartan/types';

export interface WriteLedgerEvent {
  /** Whose data this event is about. Null only for post-deletion audit rows. */
  studentId?: string | null;
  actorKind: LedgerActorKind;
  /** The acting principal id (org id, agent name, operator user id, …). */
  actorId?: string | null;
  kind: LedgerEventKind;
  /** Self-describing detail; its `kind` must match `kind`. */
  detail?: LedgerDetail;
  /** The license under which the access was made (sponsor tier / contract). */
  license?: string | null;
}

/** Append one ledger event. Returns the new row id. */
export async function writeLedgerEvent(
  event: WriteLedgerEvent,
): Promise<{ id: string }> {
  const rows = await db()
    .insert(ledgerEvents)
    .values({
      studentId: event.studentId ?? null,
      actorKind: event.actorKind,
      actorId: event.actorId ?? null,
      kind: event.kind,
      detail: event.detail,
      license: event.license ?? null,
    })
    .returning({ id: ledgerEvents.id });
  // insert-returning always yields the row; assert for the caller.
  const row = rows[0];
  if (!row) throw new Error('ledger insert returned no row');
  return row;
}
