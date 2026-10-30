'use client';

/**
 * The reader's consent, as every consent surface reads and writes it (R6 W3,
 * #632): the consent card, the Sources panel, the dashboard's Sources tab,
 * and the guard each question-sending surface puts in front of its submit.
 *
 * ONE STORE PER PAGE. The status (`GET /api/sources/consent`) and the flows
 * statement (`GET /api/flows`) are read once when the first surface mounts,
 * and every surface on the page reads the same snapshot, so the panel's
 * write is what the form's guard sees. Nothing is kept in browser storage:
 * the server's store (the account's row, or the session cookie, D12) is the
 * only one, so a fresh session is a status that says no consent is in force.
 *
 * THE GUARD (stage-A ruling (a)). `guard(run, ask)` runs the question at once
 * when a consent is in force with a source On; with no consent it calls
 * `ask` (the surface shows the card); while a panel write is in flight it
 * answers `held` and runs nothing. With no source On it applies the consent
 * gate's rule (R9 P1a, #681): it answers `none-on` (the surface says so, in
 * `no_sources_on`'s words) when every source is Off, or when the decision
 * route's `GET` says this site cannot ask (`all-sources`, or no store); under
 * `in-loop` with the store it runs the question, and the run asks the reader.
 * When the `GET` could not be read it runs the question too: the server's
 * gate is authoritative, and its refusal reaches the surface as any route
 * refusal does.
 *
 * THE BUS. A refusal a route answers (`consent_required`, after a re-ask or a
 * race the guard could not see) is reported here by the streaming hooks
 * (`reportConsentRefusal`); every subscribed surface sees `refusals` move and
 * shows the card, and resubmits after Allow.
 *
 * THE PAUSES (R8 W2, #644). A load of an Ask-first source that stops to ask
 * the reader is reported here by the streaming hooks (`reportConsentPause`),
 * so the Sources panel's row for that source shows the same card the run's
 * steps show, and an answer given in either is seen by both. `pauses` keeps
 * every pause the run reported, by its key (fix round 2, item 1): each entry
 * holds its own pause, the decision once one is posted (`decideConsentPause`,
 * to `/api/sources/consent/decision`), and whether the run has moved past it,
 * with its own timers. A later line of the run, or a later pause, ends the
 * holds still open and never clears an answer already recorded, so a card
 * answered before a second source paused keeps its own outcome. Entries are
 * kept until the last surface leaves the page: a run holds once per source.
 * Only a pause that holds is kept; one that could not ask has nothing to
 * answer.
 *
 * THE HOLD AND THE ENTRY (R9 P1, #669 D2). Two ends, kept apart: the hold's
 * (`holdEnded`: its `expiresAt` passed, or the run moved past it), after
 * which the run goes on without the answer; and the entry's (`expired`: its
 * `entryExpiresAt` passed, or the run was cancelled), after which no answer
 * is taken. Between the two, the card keeps its buttons, and an answer
 * applies to the reader's next question (`afterHold`). Cancel
 * (`cancelConsentPauses`, #668) ends every hold still open, entry and all.
 *
 * BEFORE A CONSENT (R9 P2, #661). The panel's radios take a choice before a
 * consent is given, and the choice is kept here, in `pending`, not written:
 * nothing leaves the page before the reader answers the card. A read of the
 * status (on mount, after a write, after a refusal) leaves `pending` as it
 * is. Allow writes `panelStates`, the states the panel shows: the reader's
 * where they set one, `currentStates` elsewhere, so the card's "turns on the
 * sources the panel shows as On" is true of the panel. A write that succeeds
 * empties `pending`. With a consent in force a choice is written at once, as
 * before, and `pending` is not read.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { FlowsStatement } from '../../lib/flows/statement.ts';
import type { ConsentNotice } from '../../lib/sources/consent.ts';
import type { ConsentPausePayload } from '../../lib/streaming.ts';

export type SourceStateValue = 'on' | 'ask-first' | 'off';

export interface ConsentStatus {
  inForce: boolean;
  store: 'row' | 'cookie';
  flowsVersion: string;
  defaults?: Record<string, SourceStateValue>;
  /** This instance keeps consents on accounts (it has a database). */
  accounts?: boolean;
  states?: Record<string, { state: SourceStateValue; since: string }>;
  consentedAt?: string;
  updatedAt?: string;
  consentedFlowsVersion?: string;
  /** The base version of the statement the consent refers to (S3): the stored statement's for a row, the current one's for a cookie in force. */
  consentedBaseVersion?: string;
  consentedFlowsDate?: string;
  notices?: ConsentNotice[];
}

export interface ConsentSnapshot {
  loaded: boolean;
  status: ConsentStatus | null;
  statement: FlowsStatement | null;
  /** A write (a state, Allow, a revoke, a dismissal) is in flight. */
  writing: boolean;
  /** How many refusals the routes have answered since the page loaded. */
  refusals: number;
  /** The last write failed: reader-facing, never a raw error. */
  failed: boolean;
  /** Every pause the run reported, waiting for the reader's answer or answered, by its key (R8 W2). */
  pauses: Record<string, PendingPause>;
  /** This instance's `SOURCE_ROUTING` mode, from the decision route's GET; `null` until read, and on any failure. */
  routing: 'in-loop' | 'all-sources' | null;
  /** Whether this instance's decision store pair is set, from the same GET (R9 P1a); `null` until read, and on any failure. */
  store: boolean | null;
  /** The states the reader set in the panel before a consent, by source id: kept on the page, written by Allow (R9 P2). */
  pending: Record<string, SourceStateValue>;
}

/** A pause the hooks reported, and what has happened to it since. */
export interface PendingPause {
  payload: ConsentPausePayload;
  /** An answer is being posted. */
  deciding: boolean;
  /** The answer the decision route accepted. */
  decision?: 'allow' | 'not-now';
  /** `false` when the route saved Allow but could not turn the source On (fix round 2, item 2); absent otherwise. */
  moved?: false;
  /** Why the route did not accept one: the question no longer waits, it was answered already, or anything else. */
  failure?: 'gone' | 'decided' | 'other';
  /** The hold is over: its time is up, or the run has moved past it. The entry may still take an answer. */
  holdEnded: boolean;
  /** No answer is taken any more: the entry's life is over, or the run was cancelled during its hold. */
  expired: boolean;
  /** The answer, or the route's refusal of it, came after the hold had ended: it applies to later questions only. */
  afterHold?: true;
}

const EMPTY: ConsentSnapshot = { loaded: false, status: null, statement: null, writing: false, refusals: 0, failed: false, pauses: {}, routing: null, store: null, pending: {} };

let snapshot: ConsentSnapshot = EMPTY;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: Partial<ConsentSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    // The last surface left the page: the next page starts from nothing.
    if (listeners.size === 0) {
      snapshot = EMPTY;
      inflight = null;
      clearPauseTimers();
    }
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => EMPTY;

/** The instance's mode and store flag, each `null` for anything but an answer naming one; a failure here fails no other read. */
async function readRouting(): Promise<Pick<ConsentSnapshot, 'routing' | 'store'>> {
  try {
    const response = await fetch('/api/sources/consent/decision', { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) return { routing: null, store: null };
    const body = (await response.json()) as { routing?: unknown; store?: unknown } | null;
    const routing = body?.routing === 'in-loop' || body?.routing === 'all-sources' ? body.routing : null;
    const store = typeof body?.store === 'boolean' ? body.store : null;
    return { routing, store };
  } catch {
    return { routing: null, store: null };
  }
}

/** Read the status, the statement and the instance's mode again. Concurrent callers share one read. */
export function refreshConsent(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [status, statement, { routing, store }] = await Promise.all([
        fetch('/api/sources/consent', { method: 'GET', headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/flows', { method: 'GET', headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)),
        readRouting(),
      ]);
      set({ loaded: true, status: status as ConsentStatus | null, statement: statement as FlowsStatement | null, routing, store });
    } catch {
      set({ loaded: true, status: null, statement: null, routing: null, store: null });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** A refusal a route answered: every surface shows the card again. */
export function reportConsentRefusal(): void {
  set({ refusals: snapshot.refusals + 1, status: snapshot.status ? { ...snapshot.status, inForce: false } : null });
  void refreshConsent();
}

// --- The pause (R8 W2) -----------------------------------------------------------

/** Each entry's own timers, by key: the hold's end, and the entry's end. */
const holdTimers = new Map<string, ReturnType<typeof setTimeout>>();
const entryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(timers: Map<string, ReturnType<typeof setTimeout>>, key: string): void {
  const timer = timers.get(key);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(key);
}

function clearPauseTimers(): void {
  for (const timers of [holdTimers, entryTimers]) {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }
}

/** Run `act` at the instant `at` names (ISO 8601), or at once when it has passed; nothing when it does not parse. */
function timerAt(timers: Map<string, ReturnType<typeof setTimeout>>, key: string, at: string, act: () => void): void {
  const wait = Date.parse(at) - Date.now();
  if (!Number.isFinite(wait)) return;
  const timer = setTimeout(() => {
    timers.delete(key);
    act();
  }, Math.max(0, wait));
  (timer as { unref?: () => void }).unref?.();
  timers.set(key, timer);
}

/** The entry for `key`, if the run reported one: an own property only, never one an object inherits. */
export function pauseEntry(pauses: Record<string, PendingPause>, key: string | undefined): PendingPause | null {
  return key !== undefined && Object.prototype.hasOwnProperty.call(pauses, key) ? pauses[key] : null;
}

function updatePause(key: string, change: Partial<PendingPause>): void {
  const current = pauseEntry(snapshot.pauses, key);
  if (!current) return;
  set({ pauses: { ...snapshot.pauses, [key]: { ...current, ...change } } });
}

/**
 * End every hold still open but `except`; the answers the entries hold stay,
 * and so do the entries themselves, until their own end. With `cancel`, the
 * entries whose hold was open end too. Returns the map, or `null` when no
 * hold was open.
 */
function endHolds(pauses: Record<string, PendingPause>, except?: string, cancel = false): Record<string, PendingPause> | null {
  let next: Record<string, PendingPause> | null = null;
  for (const [key, entry] of Object.entries(pauses)) {
    if (key === except || entry.holdEnded || entry.expired) continue;
    clearTimer(holdTimers, key);
    if (cancel) clearTimer(entryTimers, key);
    next = next ?? { ...pauses };
    next[key] = cancel ? { ...entry, expired: true } : { ...entry, holdEnded: true };
  }
  return next;
}

/**
 * A pause the run reported, or `null` for any other line of the same run: a
 * pause that holds adds its entry, and ends every other hold still open; a
 * later line, or a pause that does not hold, ends every hold still open. An
 * entry whose hold ended keeps its decision or failure, and lives on until
 * its own end (#669 D2). A pause reported again under a key already held
 * keeps what its entry recorded.
 * Nothing changes, and nothing re-renders, when there is no hold to end.
 */
export function reportConsentPause(payload: ConsentPausePayload | null | undefined): void {
  // Any other line, or a pause that could not ask: the run has moved past every hold still open.
  if (!payload || !payload.holds || typeof payload.key !== 'string') {
    const ended = endHolds(snapshot.pauses);
    if (ended) set({ pauses: ended });
    return;
  }
  const key = payload.key;
  const prior = pauseEntry(snapshot.pauses, key);
  const others = endHolds(snapshot.pauses, key) ?? snapshot.pauses;
  clearTimer(holdTimers, key);
  clearTimer(entryTimers, key);
  set({ pauses: { ...others, [key]: prior ? { ...prior, payload, holdEnded: false, expired: false } : { payload, deciding: false, holdEnded: false, expired: false } } });
  // The hold's end: the run goes on without the answer, whatever the stream says next.
  timerAt(holdTimers, key, payload.expiresAt, () => updatePause(key, { holdEnded: true }));
  // The entry's end: no answer is taken. A pause that names none ends with its hold, as before R9.
  timerAt(entryTimers, key, payload.entryExpiresAt ?? payload.expiresAt, () => updatePause(key, { holdEnded: true, expired: true }));
}

/** Cancel (#668): every hold still open ends, and its entry with it, so no card offers an answer the run asked for. */
export function cancelConsentPauses(): void {
  const ended = endHolds(snapshot.pauses, undefined, true);
  if (ended) set({ pauses: ended });
}

/** Post the reader's answer to a pause, and keep what the route said. Allow also reads the consent again, so the panel shows the source On. */
export async function decideConsentPause(key: string, decision: 'allow' | 'not-now'): Promise<void> {
  // Given after the hold: the run went on without it, and it applies to later questions (#669 D2).
  const afterHold = pauseEntry(snapshot.pauses, key)?.holdEnded === true ? { afterHold: true as const } : {};
  updatePause(key, { deciding: true });
  let status = 0;
  let moved: boolean | undefined;
  try {
    const response = await fetch('/api/sources/consent/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, decision }),
    });
    status = response.status;
    if (status === 200) {
      const body = (await response.json().catch(() => null)) as { moved?: unknown } | null;
      if (body?.moved === false) moved = false;
    }
  } catch {
    status = 0;
  }
  if (status === 200) {
    updatePause(key, { deciding: false, decision, ...(moved === false ? { moved: false as const } : {}), ...afterHold });
    if (decision === 'allow') void refreshConsent();
    return;
  }
  updatePause(key, { deciding: false, failure: status === 404 ? 'gone' : status === 409 ? 'decided' : 'other', ...afterHold });
}

/** The configured sources, in the statement's (manifest) order. */
function configured(): string[] {
  return snapshot.statement?.sources.map((s) => s.sourceId) ?? [];
}

/**
 * The states a reader has, as the panel shows them and Allow writes them
 * (T7, so the card's "the sources the panel shows as On" is what Allow turns
 * on): with nothing stored, the defaults a first consent gives (each
 * configured source's manifest `consentDefault`, D6); otherwise each
 * source's stored state, and Ask first for a configured source with none,
 * whether the consent is in force or asked again.
 */
export function currentStates(status: ConsentStatus | null, ids: string[]): Record<string, SourceStateValue> {
  const stored = status?.states;
  if (!stored || Object.keys(stored).length === 0) {
    return Object.fromEntries(ids.map((id) => [id, status?.defaults?.[id] ?? 'ask-first']));
  }
  return Object.fromEntries(ids.map((id) => [id, stored[id]?.state ?? 'ask-first']));
}

/**
 * The states the panel shows and Allow writes (R9 P2): with a consent in
 * force, `currentStates`; before one, the reader's pending state for each
 * configured source that has one, and `currentStates` for the rest.
 */
export function panelStates(
  snapshot: Pick<ConsentSnapshot, 'status' | 'pending'>,
  ids: string[],
): Record<string, SourceStateValue> {
  const states = currentStates(snapshot.status, ids);
  if (snapshot.status?.inForce === true) return states;
  for (const id of ids) {
    if (Object.prototype.hasOwnProperty.call(snapshot.pending, id)) states[id] = snapshot.pending[id];
  }
  return states;
}

async function write(method: 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<boolean> {
  set({ writing: true, failed: false });
  try {
    const response = await fetch('/api/sources/consent', {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    await refreshConsent();
    if (!response.ok) {
      set({ failed: response.status !== 409 });
      return false;
    }
    // Written: the store now holds what the panel shows, and nothing is pending.
    set({ pending: {} });
    return true;
  } catch {
    set({ failed: true });
    return false;
  } finally {
    set({ writing: false });
  }
}

/**
 * Allow: the states the panel shows (`panelStates`, R9 P2): each state the
 * reader set before the consent, and elsewhere what `currentStates` gives —
 * a first consent each configured source's default (D6, the manifest's
 * `consentDefault`), a consent asked again the reader's stored states, and
 * Ask first for a source with none. On a 409 the statement is read again,
 * the reader's states stay pending, and the answer is false, so the card
 * asks again.
 */
export async function allowConsent(): Promise<boolean> {
  if (!snapshot.loaded) await refreshConsent();
  const status = snapshot.status;
  if (!status) return false;
  const states = panelStates({ status, pending: snapshot.pending }, configured());
  return write('PUT', { states, flowsVersion: status.flowsVersion });
}

/**
 * One source's state. With a consent in force it is written with every other
 * state as it is; before one it is kept in `pending`, and nothing is written
 * (R9 P2), and the answer is true: a caller that confirms a write reads
 * whether a consent was in force when the choice was made.
 */
export async function setSourceState(sourceId: string, state: SourceStateValue): Promise<boolean> {
  const status = snapshot.status;
  if (!status?.inForce) {
    set({ pending: { ...snapshot.pending, [sourceId]: state } });
    return true;
  }
  const states = { ...currentStates(status, configured()), [sourceId]: state };
  set({ status: { ...status, states: Object.fromEntries(Object.entries(states).map(([id, s]) => [id, { state: s, since: status.states?.[id]?.state === s ? status.states[id].since : '' }])) } });
  return write('PUT', { states, flowsVersion: status.flowsVersion });
}

export function revokeConsent(): Promise<boolean> {
  return write('DELETE');
}

export function dismissNotices(): Promise<boolean> {
  return write('PATCH', { flowsVersion: snapshot.status?.flowsVersion });
}

export type GuardResult = 'ran' | 'asked' | 'none-on' | 'held';

/** The guard each surface puts in front of a question (stage-A ruling (a)). */
export async function guardQuestion(run: () => void, ask: () => void): Promise<GuardResult> {
  if (snapshot.writing) return 'held';
  if (!snapshot.loaded) await refreshConsent();
  const status = snapshot.status;
  if (!status?.inForce) {
    ask();
    return 'asked';
  }
  const ids = configured();
  if (ids.length > 0 && !ids.some((id) => status.states?.[id]?.state === 'on')) {
    // No source On (R9 P1a, #681): the gate's rule. Every source Off reaches
    // nothing in any mode. Otherwise a source is Ask first (a source with no
    // stored state is too), which a run reaches only where the site can ask:
    // refused when the GET said it cannot, run when it said it can or could
    // not be read.
    if (ids.every((id) => status.states?.[id]?.state === 'off')) return 'none-on';
    if (snapshot.routing === 'all-sources' || snapshot.store === false) return 'none-on';
  }
  run();
  return 'ran';
}

/** The snapshot, kept current, read on mount. */
export function useSourceConsent(options: { load?: boolean } = {}): ConsentSnapshot & {
  refresh: () => Promise<void>;
  allow: () => Promise<boolean>;
  setState: (sourceId: string, state: SourceStateValue) => Promise<boolean>;
  revoke: () => Promise<boolean>;
  dismiss: () => Promise<boolean>;
  guard: (run: () => void, ask: () => void) => Promise<GuardResult>;
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // A surface that most visitors never open (replay's dialog) reads only when opened.
  const load = options.load ?? true;
  useEffect(() => {
    if (load) void refreshConsent();
  }, [load]);
  const refresh = useCallback(() => refreshConsent(), []);
  return {
    ...current,
    refresh,
    allow: allowConsent,
    setState: setSourceState,
    revoke: revokeConsent,
    dismiss: dismissNotices,
    guard: guardQuestion,
  };
}
