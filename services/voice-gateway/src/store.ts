// Postgres persistence for the voice gateway. Every write is best-effort and
// guarded: a missing DATABASE_URL or a missing screens row must never crash the
// socket loop (demo laptops run without a DB, and the row is created by the web
// app's POST /screens before the call opens). Failures are logged, not thrown.

import {
  db,
  eq,
  and,
  sql,
  screens,
  screenMoments,
  consents,
  exceptions,
  agentRuns,
} from '@tartan/db';
import type {
  Transcript,
  ConsentVerbalSpan,
  ExceptionContext,
  ExceptionCategory,
} from '@tartan/types';
import { log } from './log.js';

function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

async function guarded<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  if (!hasDb()) return null;
  try {
    return await fn();
  } catch (e) {
    log.error(`db ${label} failed`, e);
    return null;
  }
}

/**
 * Whether the in-app consent row exists and is granted (S3 gate, half one).
 * Scoped to THIS screen: startCall writes evidence.screenId, so a consent
 * from an earlier screen can never satisfy a later call's gate.
 */
export async function hasAppConsent(
  studentId: string,
  screenId: string,
): Promise<boolean> {
  const rows = await guarded('hasAppConsent', () =>
    db()
      .select({ id: consents.id })
      .from(consents)
      .where(
        and(
          eq(consents.studentId, studentId),
          eq(consents.kind, 'app_recording'),
          eq(consents.granted, true),
          sql`${consents.evidence}->>'screenId' = ${screenId}`,
        ),
      )
      .limit(1),
  );
  return Boolean(rows && rows.length > 0);
}

/** The already-persisted transcript for a screen (resume must append, not overwrite). */
export async function loadTranscript(screenId: string): Promise<Transcript> {
  const rows = await guarded('loadTranscript', () =>
    db()
      .select({ transcript: screens.transcript })
      .from(screens)
      .where(eq(screens.id, screenId))
      .limit(1),
  );
  return rows?.[0]?.transcript ?? [];
}

export async function markScreenLive(screenId: string): Promise<void> {
  await guarded('markScreenLive', async () => {
    await db()
      .update(screens)
      .set({ status: 'live', startedAt: new Date() })
      .where(eq(screens.id, screenId));
  });
}

export async function persistTranscript(
  screenId: string,
  transcript: Transcript,
): Promise<void> {
  await guarded('persistTranscript', async () => {
    await db()
      .update(screens)
      .set({ transcript })
      .where(eq(screens.id, screenId));
  });
}

export async function recordVerbalConsent(
  screenId: string,
  span: ConsentVerbalSpan,
): Promise<void> {
  await guarded('recordVerbalConsent', async () => {
    // consent_app_at belongs to the in-app checkbox consent (written by
    // startCall); the verbal confirmation only records its span.
    await db()
      .update(screens)
      .set({ consentVerbalSpan: span })
      .where(eq(screens.id, screenId));
  });
}

export async function setAudioKey(screenId: string, key: string): Promise<void> {
  await guarded('setAudioKey', async () => {
    await db().update(screens).set({ audioKey: key }).where(eq(screens.id, screenId));
  });
}

export interface MomentInput {
  tStartMs: number;
  tEndMs: number;
  tag: string;
  quote: string;
  repNote?: string;
}

/** Insert a candidate screen_moments row; returns its id (or null on failure). */
export async function insertMoment(
  screenId: string,
  m: MomentInput,
): Promise<string | null> {
  const rows = await guarded('insertMoment', () =>
    db()
      .insert(screenMoments)
      .values({
        screenId,
        tStartMs: Math.round(m.tStartMs),
        tEndMs: Math.round(m.tEndMs),
        tag: m.tag,
        quote: m.quote,
        repNote: m.repNote ?? null,
      })
      .returning({ id: screenMoments.id }),
  );
  return rows && rows[0] ? rows[0].id : null;
}

export async function markProcessing(
  screenId: string,
  transcript: Transcript,
): Promise<void> {
  await guarded('markProcessing', async () => {
    await db()
      .update(screens)
      .set({ status: 'processing', endedAt: new Date(), transcript })
      .where(eq(screens.id, screenId));
  });
}

/**
 * Consent declined or abandoned pre-consent: drop the call, mark struck, and
 * purge any transcript persisted so far — nothing from an unconsented call
 * survives, per the compliance gate (spec section 4).
 */
export async function markStruck(screenId: string): Promise<void> {
  await guarded('markStruck', async () => {
    await db()
      .update(screens)
      .set({ status: 'struck', endedAt: new Date(), transcript: [] })
      .where(eq(screens.id, screenId));
  });
}

export async function fileEscalation(
  screenId: string,
  studentId: string,
  reason: string,
): Promise<void> {
  const category: ExceptionCategory =
    reason.includes('consent') ? 'consent_edge' : 'student_report';
  const context: ExceptionContext = {
    agent: 'rep',
    quote: reason,
    refs: { screenId, studentId },
    category,
  };
  await guarded('fileEscalation', async () => {
    await db().insert(exceptions).values({
      category,
      agent: 'rep',
      context,
      recommendation: 'Rep flagged a live escalation during the screen.',
      status: 'open',
    });
  });
}

export interface ScreenCost {
  screenId: string;
  model: string;
  cartesiaMinutes: number;
  llmTokens: number;
  llmCostUsd: number;
  cartesiaCostUsd: number;
  simulated: boolean;
}

/** Per-screen cost roll-up into agent_runs (ARCHITECTURE section 5 cost check). */
export async function logScreenCost(cost: ScreenCost): Promise<void> {
  const total = cost.llmCostUsd + cost.cartesiaCostUsd;
  await guarded('logScreenCost', async () => {
    await db().insert(agentRuns).values({
      agent: 'rep',
      model: cost.simulated ? 'simulation' : cost.model,
      promptVersion: null,
      inputRef: `screen:${cost.screenId}:cost`,
      output: {
        result: {
          kind: 'screen_cost',
          screenId: cost.screenId,
          cartesiaMinutes: Number(cost.cartesiaMinutes.toFixed(3)),
          cartesiaCostUsd: Number(cost.cartesiaCostUsd.toFixed(4)),
          llmTokens: cost.llmTokens,
          llmCostUsd: Number(cost.llmCostUsd.toFixed(4)),
          simulated: cost.simulated,
        },
      },
      confidence: null,
      costUsd: total.toFixed(6),
      tokens: cost.llmTokens,
      flagged: false,
    });
  });
}
