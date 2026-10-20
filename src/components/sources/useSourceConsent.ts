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
 * `ask` (the surface shows the card); with every source Off or Ask first it
 * answers `none-on` (the surface says so, in `no_sources_on`'s words); while
 * a panel write is in flight it answers `held` and runs nothing.
 *
 * THE BUS. A refusal a route answers (`consent_required`, after a re-ask or a
 * race the guard could not see) is reported here by the streaming hooks
 * (`reportConsentRefusal`); every subscribed surface sees `refusals` move and
 * shows the card, and resubmits after Allow.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { FlowsStatement } from '../../lib/flows/statement.ts';
import type { ConsentNotice } from '../../lib/sources/consent.ts';

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
}

const EMPTY: ConsentSnapshot = { loaded: false, status: null, statement: null, writing: false, refusals: 0, failed: false };

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
    }
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => EMPTY;

/** Read the status and the statement again. Concurrent callers share one read. */
export function refreshConsent(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [status, statement] = await Promise.all([
        fetch('/api/sources/consent', { method: 'GET', headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/flows', { method: 'GET', headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)),
      ]);
      set({ loaded: true, status: status as ConsentStatus | null, statement: statement as FlowsStatement | null });
    } catch {
      set({ loaded: true, status: null, statement: null });
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

/** The configured sources, in the statement's (manifest) order. */
function configured(): string[] {
  return snapshot.statement?.sources.map((s) => s.sourceId) ?? [];
}

/** The states a reader has: the stored ones; a configured source with none is Ask first (D6). */
export function currentStates(status: ConsentStatus | null, ids: string[]): Record<string, SourceStateValue> {
  const stored = status?.states ?? {};
  return Object.fromEntries(ids.map((id) => [id, stored[id]?.state ?? 'ask-first']));
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
    return true;
  } catch {
    set({ failed: true });
    return false;
  } finally {
    set({ writing: false });
  }
}

/**
 * Allow: a first consent stores each configured source's default (D6, the
 * manifest's `consentDefault`); a consent asked again keeps the reader's own
 * states, and a source with none is Ask first. On a 409 the statement is read
 * again and the answer is false, so the card asks again.
 */
export async function allowConsent(): Promise<boolean> {
  if (!snapshot.loaded) await refreshConsent();
  const status = snapshot.status;
  if (!status) return false;
  const ids = configured();
  const states = status.states && Object.keys(status.states).length > 0
    ? currentStates(status, ids)
    : Object.fromEntries(ids.map((id) => [id, status.defaults?.[id] ?? 'ask-first']));
  return write('PUT', { states, flowsVersion: status.flowsVersion });
}

/** One source's state, written with every other state as it is. */
export async function setSourceState(sourceId: string, state: SourceStateValue): Promise<boolean> {
  const status = snapshot.status;
  if (!status?.inForce) return false;
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
  if (ids.length > 0 && !ids.some((id) => status.states?.[id]?.state === 'on')) return 'none-on';
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
