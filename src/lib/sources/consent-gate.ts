/**
 * The first-consent gate (#632 W2; D3, D12, C6): what the four gated routes
 * ask before anything leaves this server.
 *
 * `consentInForce(request, session, ask?)` reads the consent in force — the row
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
 * NO SOURCE ON (R6 W3; R9 P1a, #681). A consent in force whose selection is
 * empty — the instance configures sources, and the reader has none On — is
 * refused `no_sources_on`, before the model or any source is called, when
 * the run could reach no source: every configured source Off, or the run
 * cannot ask the reader about an Ask-first one. A run can ask only when its
 * route holds a pause and says so in `ask`: the instance routes `in-loop`
 * and the decision store pair is set (`decisionStoreFromEnv`). The two
 * streaming routes pass `ask`; the JSON compare route and replay hold no
 * pause and pass nothing, so for them an empty selection is refused in every
 * mode. Under `all-sources` a run over an empty selection would send the
 * model a prompt with nothing to answer from; in-loop with no store, every
 * Ask-first load would record `no-answer` at once. When the run can ask and
 * a configured source is not Off (Ask first, or no stored state, D6), the
 * gate answers `ok` with the empty selection, the route's directory lists
 * the Ask-first sources (`directorySet`), and the loop asks the reader
 * before it loads one. The refusal travels on each route's existing
 * `!consent.ok` branch; its copy points to the panel that turns a source On.
 *
 * THE SWITCH (`CONSENT_GATE_ENFORCED`, `./consent-enforced.ts`), on since W3.
 * Off, the gate reads no store and builds no statement, and answers what each
 * route did before W2: the selection `DEFAULT_SOURCE_SELECTION` (every
 * offered source), the router's reasons unmapped, and no flows statement
 * reference.
 */
import type { SourceSelection } from '@typedstandards/civic-typed-router';
import type { SourceRoutingMode } from '@/lib/mcp/source-routing-mode';
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
  /** No consent in force (or a re-ask), or a consent in force with no source On. */
  code: 'consent_required' | 'no_sources_on';
  /** The flows statement's hash: the version the surface shows and the consent write echoes. */
  flowsVersion: string;
  /** What is re-asked; for `no_sources_on`, nothing. */
  reask: Reask;
}

type OfferedEntry = { sourceId: string; alias: string; reason: string };

/**
 * What a route that holds a pause tells the gate (R9 P1a, #681): this
 * instance's routing mode and whether the decision store pair is set. Read
 * by the route before the gate, from `sourceRoutingMode()` and
 * `decisionStoreFromEnv() !== null`; the gate reads neither itself.
 */
export interface ConsentAsk {
  routing: SourceRoutingMode;
  store: boolean;
}

/** Whether a run can ask the reader about an Ask-first source: in loop, with the store set. */
function canAsk(ask: ConsentAsk | undefined): boolean {
  return ask !== undefined && ask.routing === 'in-loop' && ask.store;
}

export type ConsentDecision =
  | {
      ok: true;
      /** False while the gate is dormant: the route runs as it did before W2. */
      enforced: boolean;
      /** configured ∩ On, what the composition, the tools and the dispatch are given; `DEFAULT_SOURCE_SELECTION` while dormant. Empty only for a run that can ask (`ConsentAsk`) with an Ask-first source configured. */
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

function refusal(store: 'row' | 'cookie', statement: FlowsStatement, reask: Reask, code: ConsentRefusalPayload['code'] = 'consent_required'): ConsentDecision {
  return {
    ok: false,
    store,
    statement,
    payload: { error: friendlyStreamError({ code }), code, flowsVersion: statementHash(statement), reask },
  };
}

export async function consentInForce(request: Request, session: ConsentSession | null | undefined, ask?: ConsentAsk): Promise<ConsentDecision> {
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
  const selection = selectionFromStates(configured, states);
  // No source On: refused unless the run can ask and a configured source is
  // not Off (a source with no stored state is Ask first, D6), as the
  // directory set reads the same states.
  const reachable = canAsk(ask) && configured.some((id) => !(Object.hasOwn(states, id) && states[id] === 'off'));
  if (configured.length > 0 && selection.length === 0 && !reachable) return refusal(store, statement, { base: false, sources: [] }, 'no_sources_on');
  return {
    ok: true,
    enforced: true,
    store,
    statement,
    reference: flowsStatementReference(statement, request),
    selection,
    recordReasons: (offered) => recordSourcesOffered(offered, states),
    states,
  };
}
