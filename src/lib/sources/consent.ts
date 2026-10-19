/**
 * The reader's consent to send a question onward (#632 W2; design §4.4):
 * the session cookie's form, the selection a consent yields, the reasons a
 * record states, and the re-ask rule. Pure: no store, no request scope, no
 * network. The gate that reads a store is `./consent-gate.ts`; the endpoint
 * that writes one is `src/app/api/sources/consent/route.ts`.
 *
 * THE STATES (design §1.3). Each configured source is On, Ask first or Off.
 * On: the run is offered the source. Ask first: nothing is offered in R6 (the
 * just-in-time pause is R8's), and the state is stored and recorded. Off:
 * nothing. A configured source absent from the stored states arrived after
 * the reader consented, so it is Ask first (D6).
 *
 * THE TWO STORES (D4 = A, D12 = A). A session carrying a `dbId` reads the row
 * (`source_consents`) only; any other session, anonymous or signed in, reads
 * the cookie. "Row, or cookie", never "row, else cookie".
 *
 * THE COOKIE carries a format version, the flows statement's base version
 * and, per source, its state, the calendar date it was given and that
 * source's own version: hashes and states, never an identifier. Host-only,
 * `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and a session cookie.
 *
 * THE RE-ASK RULE (D5 = A, design §4.4). A signed-in reader's row keeps the
 * statement snapshot, and `classifyFlowsChange` compares it with the statement
 * in force, in two scopes:
 *   - base, the instance-level recipients (re-asks everyone): a recipient
 *     added, a posture worse, or an arrangement changed (its host, where it
 *     runs, what it receives, or who holds its logs) re-asks; a recipient
 *     removed or a posture better notifies;
 *   - source, one source's row (re-asks for that source): its variant or its
 *     arrangement changed, or its posture worse, re-asks; better, or the
 *     source removed, notifies; a newly configured source is Ask first and
 *     re-asks nothing.
 * A posture is ranked none < metadata < content, and a longer stated
 * retention is worse. A change to or from an unranked posture (`not-stated`,
 * `operator-states`, `not-read`), or of a retention that states no number,
 * re-asks: it cannot be shown to be no worse. The anonymous cookie keeps the
 * hashes only, so any change to a stored hash re-asks (§4.4: "at the next
 * session at the latest").
 *
 * In R6 a re-ask is the gate's `consent_required` for the whole request, with
 * what is re-asked (`reask: { base, sources }`); a source is never dropped
 * silently.
 */
import type { FlowsKeptBy, FlowsRecipient, FlowsSource, FlowsStatement } from '../flows/statement.ts';

// --- The states ------------------------------------------------------------------

export type SourceState = 'on' | 'ask-first' | 'off';
export const SOURCE_STATES: readonly SourceState[] = ['on', 'ask-first', 'off'];

export function isSourceState(value: unknown): value is SourceState {
  return typeof value === 'string' && (SOURCE_STATES as readonly string[]).includes(value);
}

/** A calendar date, `YYYY-MM-DD`: when a state was given. Never a time. */
export function consentDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;

// --- The cookie ---------------------------------------------------------------------

/** The consent cookie's name. The privacy page states it by this constant (W3). */
export const CONSENT_COOKIE_NAME = 'civic-source-consent';

export interface StoredSourceState {
  state: SourceState;
  /** The calendar date it was given, `YYYY-MM-DD`. */
  since: string;
  /** The source's own flows version when it was given. */
  version: string;
}

export interface ConsentCookie {
  v: 1;
  /** The flows statement's base version when the consent was given. */
  flows: string;
  states: Record<string, StoredSourceState>;
}

/** The flags every consent cookie header carries: host-only (no `Domain`) and a session cookie (no `Max-Age`). */
const COOKIE_FLAGS = 'Path=/; Secure; HttpOnly; SameSite=Lax';

export function consentCookieHeader(value: string): string {
  return `${CONSENT_COOKIE_NAME}=${value}; ${COOKIE_FLAGS}`;
}

/** Revoke: the same cookie, expired. */
export function clearConsentCookieHeader(): string {
  return `${CONSENT_COOKIE_NAME}=; ${COOKIE_FLAGS}; Max-Age=0`;
}

export function encodeConsentCookie(cookie: ConsentCookie): string {
  return Buffer.from(JSON.stringify(cookie), 'utf8').toString('base64url');
}

/** The cookie, or null for anything that is not a well-formed version-1 consent. */
export function decodeConsentCookie(value: string | undefined): ConsentCookie | null {
  if (typeof value !== 'string' || value === '' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const { v, flows, states } = parsed as Record<string, unknown>;
  if (v !== 1 || typeof flows !== 'string' || !SHA256.test(flows)) return null;
  if (!states || typeof states !== 'object' || Array.isArray(states)) return null;
  const out: Record<string, StoredSourceState> = {};
  for (const [id, entry] of Object.entries(states as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') return null;
    const { state, since, version } = entry as Record<string, unknown>;
    if (!isSourceState(state) || typeof since !== 'string' || !DATE.test(since) || typeof version !== 'string' || !SHA256.test(version)) return null;
    out[id] = { state, since, version };
  }
  return { v: 1, flows, states: out };
}

/** The consent cookie on a request, from its `Cookie` header, or null. */
export function readConsentCookie(request: Request): ConsentCookie | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() === CONSENT_COOKIE_NAME) return decodeConsentCookie(part.slice(at + 1).trim());
  }
  return null;
}

// --- The selection and the reasons ----------------------------------------------------

/** configured ∩ On, in the configured order. Off, Ask first, absent and stale ids select nothing. */
export function selectionFromStates(configured: readonly string[], states: Readonly<Record<string, string>>): string[] {
  return configured.filter((id) => Object.hasOwn(states, id) && states[id] === 'on');
}

/**
 * What a record states for each source (D2 = A): the router's reason, with
 * `not-selected` mapped from the stored state — `reader-off` for Off,
 * `not-consented` for Ask first or no state at all. Every other reason stays.
 */
export function recordSourcesOffered<T extends { sourceId: string; alias: string; reason: string }>(
  offered: readonly T[],
  states: Readonly<Record<string, string>>,
): Array<{ sourceId: string; alias: string; reason: string }> {
  return offered.map(({ sourceId, alias, reason }) => {
    if (reason !== 'not-selected') return { sourceId, alias, reason };
    return { sourceId, alias, reason: Object.hasOwn(states, sourceId) && states[sourceId] === 'off' ? 'reader-off' : 'not-consented' };
  });
}

// --- The re-ask rule -------------------------------------------------------------------

export type ChangeEffect = 're-ask' | 'notify' | 'ask-first';

export interface FlowsChange {
  scope: 'base' | 'source';
  rule: string;
  effect: ChangeEffect;
  recipient?: string;
  sourceId?: string;
}

export interface FlowsClassification {
  verdict: 're-ask' | 'notify' | 'same';
  changes: FlowsChange[];
}

const RANK: Readonly<Record<string, number>> = { none: 0, metadata: 1, content: 2 };

/** Worse, better or the same, for one holder's posture under one recipient. */
function comparePosture(before: FlowsKeptBy, after: FlowsKeptBy): 'worse' | 'better' | 'same' {
  if (before.keeps !== after.keeps) {
    const a = RANK[before.keeps];
    const b = RANK[after.keeps];
    if (a === undefined || b === undefined) return 'worse';
    return b > a ? 'worse' : 'better';
  }
  if (before.retentionDays !== undefined && after.retentionDays !== undefined) {
    if (after.retentionDays > before.retentionDays) return 'worse';
    if (after.retentionDays < before.retentionDays) return 'better';
    return 'same';
  }
  if ((before.retention ?? '') !== (after.retention ?? '') || before.retentionDays !== after.retentionDays) return 'worse';
  return 'same';
}

/** Whether one recipient's arrangement changed: its place, what it receives, or who holds its logs. */
function arrangementChanged(before: FlowsRecipient, after: FlowsRecipient): boolean {
  if (before.role !== after.role || before.host !== after.host || before.runsAt !== after.runsAt || before.receives !== after.receives) return true;
  if (before.keptBy.length !== after.keptBy.length) return true;
  return before.keptBy.some((k, i) => k.holder !== after.keptBy[i].holder);
}

function compareRecipients(
  before: readonly FlowsRecipient[],
  after: readonly FlowsRecipient[],
  rules: { added: string; removed: string; arrangement: string; worse: string; better: string },
  scope: 'base' | 'source',
  sourceId?: string,
): FlowsChange[] {
  const changes: FlowsChange[] = [];
  const at = (recipient: string, rule: string, effect: ChangeEffect) =>
    changes.push({ scope, rule, effect, recipient, ...(sourceId ? { sourceId } : {}) });
  const prior = new Map(before.map((r) => [r.id, r]));
  const now = new Map(after.map((r) => [r.id, r]));
  for (const [id, r] of now) {
    const was = prior.get(id);
    if (!was) { at(id, rules.added, 're-ask'); continue; }
    if (arrangementChanged(was, r)) { at(id, rules.arrangement, 're-ask'); continue; }
    const verdicts = r.keptBy.map((k, i) => comparePosture(was.keptBy[i], k));
    if (verdicts.includes('worse')) at(id, rules.worse, 're-ask');
    else if (verdicts.includes('better')) at(id, rules.better, 'notify');
  }
  for (const id of prior.keys()) if (!now.has(id)) at(id, rules.removed, 'notify');
  return changes;
}

function variantKey(source: Pick<FlowsSource, 'variant' | 'host'>): string {
  const v = source.variant as unknown as Record<string, unknown>;
  return JSON.stringify([Object.keys(v).sort().map((k) => [k, v[k]]), source.host ?? null]);
}

/** The re-ask rule over a stored statement and the one in force (signed in, D5 = A). */
export function classifyFlowsChange(previous: FlowsStatement, current: FlowsStatement): FlowsClassification {
  const changes = compareRecipients(previous.recipients, current.recipients, {
    added: 'recipient-added',
    removed: 'recipient-removed',
    arrangement: 'hosting-changed',
    worse: 'posture-worse',
    better: 'posture-better',
  }, 'base');
  const prior = new Map(previous.sources.map((s) => [s.sourceId, s]));
  const now = new Map(current.sources.map((s) => [s.sourceId, s]));
  for (const [id, source] of now) {
    const was = prior.get(id);
    if (!was) { changes.push({ scope: 'source', rule: 'source-added', effect: 'ask-first', sourceId: id }); continue; }
    if (variantKey(was) !== variantKey(source)) {
      changes.push({ scope: 'source', rule: 'source-variant-changed', effect: 're-ask', sourceId: id });
      continue;
    }
    changes.push(...compareRecipients(was.recipients, source.recipients, {
      added: 'source-variant-changed',
      removed: 'source-posture-better',
      arrangement: 'source-variant-changed',
      worse: 'source-posture-worse',
      better: 'source-posture-better',
    }, 'source', id));
  }
  for (const id of prior.keys()) if (!now.has(id)) changes.push({ scope: 'source', rule: 'source-removed', effect: 'notify', sourceId: id });
  const verdict = changes.some((c) => c.effect === 're-ask') ? 're-ask' : changes.some((c) => c.effect === 'notify') ? 'notify' : 'same';
  return { verdict, changes };
}

/** What a re-ask names: the base, and the sources whose own consent is re-asked. */
export interface Reask {
  base: boolean;
  sources: string[];
}

/** The classification as what is re-asked. */
export function reaskOf(classification: FlowsClassification): Reask {
  const reask = classification.changes.filter((c) => c.effect === 're-ask');
  return {
    base: reask.some((c) => c.scope === 'base'),
    sources: [...new Set(reask.filter((c) => c.scope === 'source' && c.sourceId).map((c) => c.sourceId!))],
  };
}

/** The anonymous cookie (hashes only): any change to a stored hash re-asks; a stale or a new source does not. */
export function cookieConsentInForce(cookie: ConsentCookie, current: FlowsStatement): { inForce: boolean; reask: Reask } {
  if (cookie.flows !== current.version) return { inForce: false, reask: { base: true, sources: [] } };
  const sources = current.sources
    .filter((s) => Object.hasOwn(cookie.states, s.sourceId) && cookie.states[s.sourceId].version !== s.version)
    .map((s) => s.sourceId);
  if (sources.length > 0) return { inForce: false, reask: { base: false, sources } };
  return { inForce: true, reask: { base: false, sources: [] } };
}

/** A stored state map flattened to the state alone. */
export function flatStates(states: Readonly<Record<string, { state: SourceState }>>): Record<string, SourceState> {
  return Object.fromEntries(Object.entries(states).map(([id, entry]) => [id, entry.state]));
}

