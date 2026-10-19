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
 *
 * DORMANT UNTIL W3 (`CONSENT_GATE_ENFORCED`, `./consent-enforced.ts`). Off,
 * the gate reads no store and builds no statement, and answers what each route
 * did before W2: the selection `DEFAULT_SOURCE_SELECTION` (every offered
 * source), the router's reasons unmapped, and no flows statement reference.
 */
import type { SourceSelection } from '@typedstandards/civic-typed-router';
import { readConsentRow } from '@/lib/sources/consent-store';
import { CONSENT_GATE_ENFORCED } from '@/lib/sources/consent-enforced';
import { DEFAULT_SOURCE_SELECTION } from '@/lib/mcp/socrata-skill';
import { buildFlowsStatement, flowsStatementReference, statementHash, type FlowsStatement, type FlowsStatementReference } from '@/lib/flows/statement';
import { friendlyStreamError } from '@/lib/streaming';
import {
  classifyFlowsChange,
  cookieConsentInForce,
  flatStates,
  readConsentCookie,
  reaskOf,
  recordSourcesOffered,
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

type OfferedEntry = { sourceId: string; alias: string; reason: string };

export type ConsentDecision =
  | {
      ok: true;
      /** False while the gate is dormant: the route runs as it did before W2. */
      enforced: boolean;
      /** configured ∩ On, what the composition, the tools and the dispatch are given; `DEFAULT_SOURCE_SELECTION` while dormant. */
      selection: SourceSelection;
      /** The record's reasons from the router's: mapped from the stored states (D2 = A); unchanged while dormant. */
      recordReasons: (offered: readonly OfferedEntry[]) => OfferedEntry[];
      /** The flows statement in force, for `analysis.flows_statement`; absent while dormant. */
      reference?: FlowsStatementReference;
      store?: 'row' | 'cookie';
      statement?: FlowsStatement;
      /** Every stored state (stale ids are harmless where it is read); empty while dormant. */
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
  if (!CONSENT_GATE_ENFORCED) {
    return { ok: true, enforced: false, selection: DEFAULT_SOURCE_SELECTION, recordReasons: (offered) => [...offered], states: {} };
  }
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
    enforced: true,
    store,
    statement,
    reference: flowsStatementReference(statement, request),
    selection: selectionFromStates(configured, states),
    recordReasons: (offered) => recordSourcesOffered(offered, states),
    states,
  };
}
