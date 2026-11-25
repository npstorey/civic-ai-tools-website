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
 * source's own version: hashes and states, never an identifier. Two forms
 * (S4 W1, npstorey/civic-ai-tools#335, premise 7 (a)): the first, base64url
 * JSON with each source's id and full version, is still read; every write
 * since S4 writes the second, packed bytes with one fixed-width entry per
 * source (`encodeSecondForm`), which holds about 274 sources in 4,096 bytes
 * where the first held about 22. A write whose cookie would pass that bound
 * sets no cookie and is refused (`cookieFits`). Host-only,
 * `HttpOnly`, `SameSite=Lax`, `Path=/`, and a session cookie; `Secure` when
 * the request reached the site over https (`isSecureRequest`, R6 W3), so an
 * instance served over plain http can keep it at all.
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
import { createHash } from 'node:crypto';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import type { FlowsKeptBy, FlowsRecipient, FlowsSource, FlowsStatement } from '../flows/statement.ts';
import { readerSourceName } from './source-name.ts';

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
  /**
   * The source's own flows version when it was given: the full 64-hex digest in the first form, its first 8 hex
   * characters (4 bytes) in the second (`sameSourceVersion`).
   */
  version: string;
  /** "Set on its own" (premise 7): absent in the first form, whose entries read by `setOnItsOwn`. */
  own?: boolean;
}

export interface ConsentCookie {
  /** The form: 1, base64url JSON (read, and written only by tests); 2, packed bytes (every write since S4). */
  v: 1 | 2;
  /** The flows statement's base version when the consent was given. */
  flows: string;
  states: Record<string, StoredSourceState>;
  /**
   * Second form only: the entries whose id hash matched no source the reader was given, each as the 22 hex
   * characters of its 11 bytes. They ask nothing, and every write keeps them as they are (A7b, A12).
   */
  unmatched?: string[];
}

// --- "Set on its own" (S4 W1; premise 7, ruled with G0-7 = B) ---------------------------------

/**
 * Whether a stored entry is set on its own: its flag, and for an entry with no flag (every entry written before S4,
 * and a first-form cookie's) whether it is Off. Off is never a default, so an Off was the reader's own act.
 */
export function setOnItsOwn(entry: { state: SourceState; own?: boolean }): boolean {
  return entry.own ?? entry.state === 'off';
}

/** A stored entry of either store, without the cookie's version. */
export interface StoredEntry {
  state: SourceState;
  since: string;
  own?: boolean;
}

/**
 * What a write moves (S4 W1): `ids` to `state`, as
 *   - `source`, one source by its own control or the pause's Allow or Don't allow: the state, and the flag set;
 *   - `class`, a class control or a class answer: each id not set on its own takes the state and no flag; an id set
 *     on its own is left as it is, unless its state already is `state`, when its flag is cleared;
 *   - `all`, "Enable all data sources": every id takes the state, and every flag is cleared.
 */
export interface ConsentMove {
  ids: readonly string[];
  state: SourceState;
  by: 'source' | 'class' | 'all';
}

/**
 * The stored states after `move`, every entry it was not asked to change kept as it is (A12). A state that does not
 * change keeps the date it was given. `entry` builds a store's entry from the next state and the prior entry (the
 * cookie adds the source's version).
 */
export function applyConsentMove<E extends StoredEntry>(
  stored: Readonly<Record<string, E>>,
  move: ConsentMove,
  today: string,
  entry: (id: string, next: StoredEntry, prior: E | undefined) => E,
): Record<string, E> {
  const out: Record<string, E> = { ...stored };
  for (const id of move.ids) {
    const prior = Object.hasOwn(stored, id) ? stored[id] : undefined;
    const since = prior?.state === move.state ? prior.since : today;
    if (move.by === 'class' && prior && setOnItsOwn(prior)) {
      // Honoured; cleared when the class is set to the state it already has.
      if (prior.state === move.state) out[id] = entry(id, { state: prior.state, since: prior.since, own: false }, prior);
      continue;
    }
    out[id] = entry(id, { state: move.state, since, own: move.by === 'source' }, prior);
  }
  return out;
}

/**
 * The states a states-map write gives (the first consent's Allow, and a page loaded before S4), every stored entry
 * it does not name kept as it is. A named id in `own` is set on its own (premise 7's exception: a source the reader
 * changed before a first consent); a named id whose state does not change keeps its date and its flag; any other
 * named id is written with no flag.
 */
export function applyGivenStates<E extends StoredEntry>(
  stored: Readonly<Record<string, E>>,
  given: ReadonlyArray<readonly [string, SourceState]>,
  own: ReadonlySet<string>,
  today: string,
  entry: (id: string, next: StoredEntry, prior: E | undefined) => E,
): Record<string, E> {
  const out: Record<string, E> = { ...stored };
  for (const [id, state] of given) {
    const prior = Object.hasOwn(stored, id) ? stored[id] : undefined;
    const same = prior?.state === state;
    const flag = own.has(id) ? true : same ? prior?.own : undefined;
    out[id] = entry(id, { state, since: same ? prior!.since : today, ...(flag === undefined ? {} : { own: flag }) }, prior);
  }
  return out;
}

/**
 * Whether a request reached the site over https: its own URL's scheme, or the
 * platform's `x-forwarded-proto` (the first value, when a chain of proxies
 * appends several). A browser keeps a `Secure` cookie only from a secure
 * origin, so the consent cookie carries `Secure` exactly when this is true:
 * over plain http on any host but `localhost`, a `Secure` cookie would never
 * be kept, and the reader's consent would never stick (R6 W3, G0 premise 4).
 */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The flags a consent cookie header carries: host-only (no `Domain`), a session cookie (no `Max-Age`), and `Secure` over https. */
function cookieFlags(secure: boolean): string {
  return `Path=/; ${secure ? 'Secure; ' : ''}HttpOnly; SameSite=Lax`;
}

/** The consent cookie's `Set-Cookie` value. `secure` is `isSecureRequest(request)`; it defaults to true. */
export function consentCookieHeader(value: string, secure = true): string {
  return `${CONSENT_COOKIE_NAME}=${value}; ${cookieFlags(secure)}`;
}

/** Revoke: the same cookie, expired, with the same flags the write set. */
export function clearConsentCookieHeader(secure = true): string {
  return `${CONSENT_COOKIE_NAME}=; ${cookieFlags(secure)}; Max-Age=0`;
}

/** The bound a cookie's name, `=` and value must fit in (RFC 6265 §6.1; Chromium counts name and value). */
export const CONSENT_COOKIE_BOUND = 4096;

/** The bytes a cookie value takes as the browsers count it: the name, the `=` and the value, no attributes. */
export function consentCookieSize(value: string): number {
  return CONSENT_COOKIE_NAME.length + 1 + value.length;
}

/** Whether a cookie value fits the bound (A1, A2). */
export function cookieFits(value: string): boolean {
  return consentCookieSize(value) <= CONSENT_COOKIE_BOUND;
}

/** The cookie's value in its form: the first for `v: 1`, the second for `v: 2`. */
export function encodeConsentCookie(cookie: ConsentCookie): string {
  if (cookie.v === 2) return encodeSecondForm(cookie);
  return Buffer.from(JSON.stringify(cookie), 'utf8').toString('base64url');
}

// --- The second form (S4 W1; premise 7, hypothesis (a)) -------------------------------------------------
//
// Packed bytes, base64url unpadded: one byte `2`; the base version's 32 bytes; then 11 bytes per source with a stored
// state: 4 bytes, the first 4 of SHA-256 of its id (`sourceIdHash`); 4 bytes, the first 4 of its version; 1 byte, its
// state in bits 0-1 (0 On, 1 Ask first, 2 Off) and "set on its own" in bit 7; 2 bytes, the day it was given, in days
// since 1970-01-01, big-endian. No id is stored: an entry is matched to a source by its id's hash, which
// `source-id-hash.test.ts` holds unique over the manifest (A15). At 4 bytes a version change goes unseen with a chance
// of 1 in 2^32 for each change (A11).

const SECOND_FORM = 2;
const HEAD_BYTES = 33;
const ENTRY_BYTES = 11;
const STATE_CODE: Readonly<Record<SourceState, number>> = { on: 0, 'ask-first': 1, off: 2 };
const OWN_BIT = 0x80;
const DAY_MS = 86_400_000;

/** The first 4 bytes of SHA-256 of a source id, lowercase hex: how the second form names a source. */
export function sourceIdHash(id: string): string {
  return createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 8);
}

/** Pairs of ids that share a hash: the second form could not tell them apart (A15). */
export function idHashCollisions(ids: readonly string[]): Array<[string, string]> {
  const seen = new Map<string, string>();
  const pairs: Array<[string, string]> = [];
  for (const id of new Set(ids)) {
    const hash = sourceIdHash(id);
    const other = seen.get(hash);
    if (other !== undefined) pairs.push([other, id]);
    else seen.set(hash, id);
  }
  return pairs;
}

/** Whether a stored version is the version in force: equal in the first form, its 8-hex prefix in the second. */
export function sameSourceVersion(stored: string, current: string): boolean {
  return stored.length === 8 ? current.startsWith(stored) : stored === current;
}

function dayOf(since: string): number {
  const ms = Date.parse(`${since}T00:00:00Z`);
  const day = Math.floor(ms / DAY_MS);
  if (!Number.isFinite(day) || day < 0 || day > 0xffff) throw new Error('consent cookie: a date outside the second form');
  return day;
}

function sinceOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function encodeSecondForm(cookie: ConsentCookie): string {
  if (!SHA256.test(cookie.flows)) throw new Error('consent cookie: the base version is not a digest');
  const entries = Object.entries(cookie.states);
  const named = new Set(entries.map(([id]) => sourceIdHash(id)));
  const unmatched = (cookie.unmatched ?? []).filter((raw) => /^[0-9a-f]{22}$/.test(raw) && !named.has(raw.slice(0, 8)));
  const bytes = Buffer.alloc(HEAD_BYTES + ENTRY_BYTES * (entries.length + unmatched.length));
  bytes[0] = SECOND_FORM;
  Buffer.from(cookie.flows, 'hex').copy(bytes, 1);
  let at = HEAD_BYTES;
  for (const [id, entry] of entries) {
    if (!/^[0-9a-f]{8}/.test(entry.version)) throw new Error('consent cookie: a source version is not a digest');
    Buffer.from(sourceIdHash(id), 'hex').copy(bytes, at);
    Buffer.from(entry.version.slice(0, 8), 'hex').copy(bytes, at + 4);
    bytes[at + 8] = STATE_CODE[entry.state] | (setOnItsOwn(entry) ? OWN_BIT : 0);
    bytes.writeUInt16BE(dayOf(entry.since), at + 9);
    at += ENTRY_BYTES;
  }
  for (const raw of unmatched) {
    Buffer.from(raw, 'hex').copy(bytes, at);
    at += ENTRY_BYTES;
  }
  return bytes.toString('base64url');
}

function decodeSecondForm(bytes: Buffer, ids: readonly string[]): ConsentCookie | null {
  if (bytes.length < HEAD_BYTES || (bytes.length - HEAD_BYTES) % ENTRY_BYTES !== 0) return null;
  const byHash = new Map(ids.map((id) => [sourceIdHash(id), id]));
  const flows = bytes.subarray(1, HEAD_BYTES).toString('hex');
  const states: Record<string, StoredSourceState> = {};
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (let at = HEAD_BYTES; at < bytes.length; at += ENTRY_BYTES) {
    const hash = bytes.subarray(at, at + 4).toString('hex');
    if (seen.has(hash)) return null;
    seen.add(hash);
    const code = bytes[at + 8];
    const state = SOURCE_STATES[code & 0x03];
    if (state === undefined || (code & 0x7c) !== 0) return null;
    const id = byHash.get(hash);
    if (id === undefined) {
      unmatched.push(bytes.subarray(at, at + ENTRY_BYTES).toString('hex'));
      continue;
    }
    states[id] = { state, since: sinceOf(bytes.readUInt16BE(at + 9)), version: bytes.subarray(at + 4, at + 8).toString('hex'), own: (code & OWN_BIT) !== 0 };
  }
  return { v: 2, flows, states, ...(unmatched.length > 0 ? { unmatched } : {}) };
}

/** The ids a second-form entry is matched against when a caller names none: every source the manifest lists. */
const MANIFEST_IDS: readonly string[] = CIVIC_MANIFEST.map((entry) => entry.sourceId);

/**
 * The cookie, or null for anything that is not a well-formed consent in either form. The second form names no id:
 * its entries are matched against `ids` (the app's writers and readers pass the sources of the statement in force;
 * absent, the manifest's), and an entry that matches none is kept in `unmatched`.
 */
export function decodeConsentCookie(value: string | undefined, ids: readonly string[] = MANIFEST_IDS): ConsentCookie | null {
  if (typeof value !== 'string' || value === '' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  if (bytes[0] === SECOND_FORM) return decodeSecondForm(bytes, ids);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
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

/** The consent cookie on a request, from its `Cookie` header, or null; a second-form entry is matched against `ids`. */
export function readConsentCookie(request: Request, ids: readonly string[] = MANIFEST_IDS): ConsentCookie | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() === CONSENT_COOKIE_NAME) return decodeConsentCookie(part.slice(at + 1).trim(), ids);
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
 *
 * A run whose sources the reader picked (S3-B W1, npstorey/civic-ai-tools#318; G0-2 = A, anchor B8) passes the
 * picks that survived (`picked`): a source the reader did not pick, and did not turn Off, keeps the router's
 * `not-selected`, which "Where this question went" words as not picked. Off is still `reader-off`, picked or not,
 * and a picked source that was not On (Ask first) is still `not-consented`. Absent, every run reads as before.
 */
export function recordSourcesOffered<T extends { sourceId: string; alias: string; reason: string }>(
  offered: readonly T[],
  states: Readonly<Record<string, string>>,
  picked?: readonly string[],
): Array<{ sourceId: string; alias: string; reason: string }> {
  return offered.map(({ sourceId, alias, reason }) => {
    if (reason !== 'not-selected') return { sourceId, alias, reason };
    if (Object.hasOwn(states, sourceId) && states[sourceId] === 'off') return { sourceId, alias, reason: 'reader-off' };
    if (picked !== undefined && !picked.includes(sourceId)) return { sourceId, alias, reason: 'not-selected' };
    return { sourceId, alias, reason: 'not-consented' };
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
    .filter((s) => Object.hasOwn(cookie.states, s.sourceId) && !sameSourceVersion(cookie.states[s.sourceId].version, s.version))
    .map((s) => s.sourceId);
  if (sources.length > 0) return { inForce: false, reask: { base: false, sources } };
  return { inForce: true, reask: { base: false, sources: [] } };
}

/** A stored state map flattened to the state alone. */
export function flatStates(states: Readonly<Record<string, { state: SourceState }>>): Record<string, SourceState> {
  return Object.fromEntries(Object.entries(states).map(([id, entry]) => [id, entry.state]));
}


// --- The notice (D2 = A) ------------------------------------------------------------------

/** One change a reader whose consent is kept on the account is told about, and asked nothing for. */
export interface ConsentNotice {
  /** The classifier's rule: `recipient-removed`, `posture-better`, `source-removed` or `source-posture-better`. */
  rule: string;
  /** What changed, in reader language. */
  text: string;
}

const ROLE_WORDS: Readonly<Record<string, string>> = {
  'model-endpoint': 'The model endpoint',
  'function-logs': "This site's hosting logs",
  'sign-in': 'The sign-in provider',
  analytics: 'The analytics service',
  'notebook-executor': 'The notebook runner',
  source: 'A data source',
  'sandbox-platform': "The sandbox a data source runs in",
};

/**
 * The `notify` changes between the statement a row holds and the one in force
 * (D2 = A, design §4.4), each as one line. A re-ask change is never a notice:
 * it is the card. The cookie keeps hashes only, so a cookie reader has none.
 */
export function noticesOf(previous: FlowsStatement, current: FlowsStatement): ConsentNotice[] {
  const { changes } = classifyFlowsChange(previous, current);
  const recipientOf = (id: string | undefined) =>
    [...previous.recipients, ...previous.sources.flatMap((s) => s.recipients)].find((r) => r.id === id);
  const label = (id: string | undefined) => {
    const r = recipientOf(id);
    if (!r) return 'A recipient';
    const role = ROLE_WORDS[r.role] ?? 'A recipient';
    const where = r.host ?? r.runsAt;
    return where ? `${role} (${where})` : role;
  };
  return changes
    .filter((c) => c.effect === 'notify')
    .map((c): ConsentNotice => {
      const source = c.sourceId ? previous.sources.find((s) => s.sourceId === c.sourceId) : undefined;
      // A source by its one reader name (T13); one the statement lacks, by its id.
      const name = source ? readerSourceName(source) : c.sourceId ?? 'A data source';
      switch (c.rule) {
        case 'recipient-removed':
          return { rule: c.rule, text: `${label(c.recipient)}: removed from the recipients.` };
        case 'posture-better':
          return { rule: c.rule, text: `${label(c.recipient)}: its holder now says it keeps less.` };
        case 'source-removed':
          return { rule: c.rule, text: `${name} is no longer offered on this site.` };
        default:
          return { rule: c.rule, text: `${name} now says it keeps less.` };
      }
    });
}
