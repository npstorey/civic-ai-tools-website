/**
 * The signed-in half of the consent store (#632 W2, D4 = A): one row per
 * account in `source_consents` (`drizzle/0017_source_consents.sql`). Read by
 * the gate (`./consent-gate.ts`) and written by the consent endpoint
 * (`src/app/api/sources/consent/route.ts`) only for a session carrying a
 * `dbId`; every other session's consent is the cookie (`./consent.ts`), and
 * this module is never asked about it.
 *
 * A row holds states and the statement it was given against, never a
 * question, a network address or any identifier but the account key.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { sourceConsents } from '../db/schema.ts';
import type { FlowsStatement } from '../flows/statement.ts';
import type { SourceState } from './consent.ts';

export interface ConsentRow {
  userId: string;
  /** Per source id: the state and the calendar date it was given. */
  states: Record<string, { state: SourceState; since: string }>;
  /** The hash of the statement the reader was shown. */
  flowsHash: string;
  /** That statement. */
  flowsStatement: FlowsStatement;
  consentedAt: Date;
  updatedAt: Date;
}

export interface ConsentRowWrite {
  states: ConsentRow['states'];
  flowsHash: string;
  flowsStatement: FlowsStatement;
  now?: Date;
}

export async function readConsentRow(userId: string): Promise<ConsentRow | null> {
  const rows = await db.select().from(sourceConsents).where(eq(sourceConsents.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.userId,
    states: row.states as ConsentRow['states'],
    flowsHash: row.flowsHash,
    flowsStatement: row.flowsStatement as FlowsStatement,
    consentedAt: row.consentedAt,
    updatedAt: row.updatedAt,
  };
}

/** Insert the account's consent, or replace its states and statement and keep its first date. */
export async function writeConsentRow(userId: string, write: ConsentRowWrite): Promise<void> {
  const now = write.now ?? new Date();
  await db
    .insert(sourceConsents)
    .values({ userId, states: write.states, flowsHash: write.flowsHash, flowsStatement: write.flowsStatement, consentedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: sourceConsents.userId,
      set: { states: write.states, flowsHash: write.flowsHash, flowsStatement: write.flowsStatement, updatedAt: now },
    });
}

/** Revoke: the row is deleted, so the next question is asked for consent again. */
export async function deleteConsentRow(userId: string): Promise<void> {
  await db.delete(sourceConsents).where(eq(sourceConsents.userId, userId));
}
