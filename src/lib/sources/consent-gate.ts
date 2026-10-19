/**
 * The first-consent gate (#632 W2; D3, D12, C6): what the four gated routes
 * ask before anything leaves this server.
 *
 * `consentInForce(request, session)` reads the consent in force — the row
 * when the session carries a `dbId`, else the cookie, anonymous or signed in
 * ("row, or cookie", D12 = A) — against the flows statement in force, and
 * answers either the run's selection (configured ∩ On; a configured source
 * absent from the states is Ask first, D6) with the states the record's
 * reasons are mapped from and the statement's reference for the root span, or
 * the typed `consent_required` refusal carrying the statement's hash and what
 * is re-asked. Each route calls it after its configuration refusals and its
 * session, and before the rate limiter and the skill fetch; it reads no
 * network itself (the row read is the database, for a `dbId` session only).
 *
 * The selection is derived from the store, never read from the request
 * (D3 = A): the consent write (`/api/sources/consent`) is the only boundary
 * that accepts source ids.
 */
import { readConsentRow } from '@/lib/sources/consent-store';
import { buildFlowsStatement, flowsStatementReference, statementHash, type FlowsStatement, type FlowsStatementReference } from '@/lib/flows/statement';
import { friendlyStreamError } from '@/lib/streaming';
import {
  classifyFlowsChange,
  cookieConsentInForce,
  flatStates,
  readConsentCookie,
  reaskOf,
  selectionFromStates,
  type Reask,
  type SourceState,
} from '@/lib/sources/consent';

/** The session fields the gate reads: the account's database id, when the session carries one. */
export interface ConsentSession {
  user?: { id?: string; dbId?: string } | null;
}

export interface ConsentRefusalPayload {
  error: string;
  code: 'consent_required';
  /** The flows statement's hash: the version the surface shows and the consent write echoes. */
  flowsVersion: string;
  reask: Reask;
}

export type ConsentDecision =
  | {
      ok: true;
      store: 'row' | 'cookie';
      statement: FlowsStatement;
      reference: FlowsStatementReference;
      /** configured ∩ On: what the composition, the tools and the dispatch are given. */
      selection: string[];
      /** Every stored state, for the record's reasons (stale ids are harmless there). */
      states: Record<string, SourceState>;
    }
  | { ok: false; store: 'row' | 'cookie'; statement: FlowsStatement; payload: ConsentRefusalPayload };

function refusal(store: 'row' | 'cookie', statement: FlowsStatement, reask: Reask): ConsentDecision {
  return {
    ok: false,
    store,
    statement,
    payload: { error: friendlyStreamError({ code: 'consent_required' }), code: 'consent_required', flowsVersion: statementHash(statement), reask },
  };
}

export async function consentInForce(request: Request, session: ConsentSession | null | undefined): Promise<ConsentDecision> {
  const statement = await buildFlowsStatement();
  const configured = statement.sources.map((source) => source.sourceId);
  const dbId = session?.user?.dbId;
  let states: Record<string, SourceState>;
  let store: 'row' | 'cookie';
  if (dbId) {
    store = 'row';
    const row = await readConsentRow(dbId);
    if (!row) return refusal(store, statement, { base: true, sources: [] });
    const reask = reaskOf(classifyFlowsChange(row.flowsStatement, statement));
    if (reask.base || reask.sources.length > 0) return refusal(store, statement, reask);
    states = flatStates(row.states);
  } else {
    store = 'cookie';
    const cookie = readConsentCookie(request);
    if (!cookie) return refusal(store, statement, { base: true, sources: [] });
    const verdict = cookieConsentInForce(cookie, statement);
    if (!verdict.inForce) return refusal(store, statement, verdict.reask);
    states = flatStates(cookie.states);
  }
  return {
    ok: true,
    store,
    statement,
    reference: flowsStatementReference(statement, request),
    selection: selectionFromStates(configured, states),
    states,
  };
}
