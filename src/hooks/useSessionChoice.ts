'use client';

import { useState, useCallback, useSyncExternalStore } from 'react';

/**
 * Sticky-per-session persisted choice (s6 P2, #229).
 *
 * This is the mechanism `QueryForm`'s response-mode control has always used
 * (§10 Q7), extracted verbatim so the comparison-restore toggle persists the
 * same way instead of growing a parallel one:
 *
 * - `sessionStorage`, not `localStorage` — the stickiness is per-session.
 * - Subscribes to the `storage` event so multiple tabs sharing the session
 *   stay in sync, and survives Strict Mode double-invocation.
 * - A local override updates the component synchronously on set — the
 *   `storage` event never fires in the tab that wrote the value.
 * - SSR (and a visitor who never chose) reads as `null`: "no explicit
 *   choice". Callers decide what no-choice means (usually a mount default),
 *   which is what lets an explicit choice stay sticky over that default.
 *
 * `parse` must be pure: it validates the raw stored string and returns the
 * choice or `null` for anything unrecognized.
 */
export function useSessionChoice<T extends string>(
  key: string,
  parse: (raw: string | null) => T | null,
): [T | null, (next: T) => void] {
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('storage', notify);
    return () => window.removeEventListener('storage', notify);
  }, []);

  const stored = useSyncExternalStore(
    subscribe,
    () => (typeof window === 'undefined' ? null : parse(window.sessionStorage.getItem(key))),
    () => null,
  );

  const [override, setOverride] = useState<T | null>(null);

  const set = useCallback(
    (next: T) => {
      setOverride(next);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(key, next);
      }
    },
    [key],
  );

  return [override ?? stored, set];
}
