'use client';

import { useEffect, useState } from 'react';

/**
 * Cross-host has-a-session probe (s6 P3, Q64).
 *
 * On a split-host topology the session cookie lives on the app host, so
 * the marketing host's header cannot know from its own cookies that the
 * visitor is already signed in. This hook asks the app host's
 * `/api/session-status` (a boolean — nothing else crosses the origin) and
 * returns whether a session exists there.
 *
 * FAILURE IS SILENT AND SIGNED-OUT, by contract: the return value starts
 * `false` and can only ever become `true` on a well-formed
 * `{"signedIn":true}`. A network error, a CORS refusal, a timeout, a
 * non-200, or a malformed body all leave it `false` — the caller keeps
 * rendering its signed-out affordance and the visitor never sees a
 * degraded control.
 *
 * NO PROBE FIRES unless the caller passes a URL (`statusUrl !== null` —
 * the layout only derives one on a full split topology; see
 * `resolveSessionAffordance`) and `enabled` is true (the caller has no
 * local session — a locally signed-in browser needs no probe). A probe to
 * the page's own origin is also skipped: same-origin session state is
 * `useSession`'s job, and the answer would be redundant.
 *
 * Post-hydration only — the fetch runs in an effect, so the server-
 * rendered document is byte-identical with or without the probe.
 */
/**
 * ONE REQUEST PER URL IN FLIGHT (UX-2 P6 + P10, criterion 25; 0d item 1). The
 * Header and a directory row read the same app host's status on one page; they
 * share the request in flight for that URL rather than each asking. The shared
 * request carries its own 4-second timeout and is never aborted by one caller's
 * unmount; a caller that unmounted ignores its answer. Once it settles it is
 * forgotten, so a later mount asks again, as each mount did before.
 */
const inFlight = new Map<string, Promise<boolean>>();

function probeOnce(statusUrl: string): Promise<boolean> {
  const pending = inFlight.get(statusUrl);
  if (pending) return pending;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  const request = fetch(statusUrl, {
    method: 'GET',
    mode: 'cors',
    credentials: 'include',
    cache: 'no-store',
    signal: controller.signal,
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: unknown) => body !== null && typeof body === 'object' && (body as { signedIn?: unknown }).signedIn === true)
    .catch(() => false) // Silent: keep the signed-out affordance.
    .finally(() => {
      clearTimeout(timer);
      inFlight.delete(statusUrl);
    });
  inFlight.set(statusUrl, request);
  return request;
}

export function useCrossHostSession(
  statusUrl: string | null,
  enabled: boolean,
): boolean {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (statusUrl === null || !enabled) return;
    try {
      if (new URL(statusUrl).origin === window.location.origin) return;
    } catch {
      return; // Unparseable URL: no probe.
    }

    let cancelled = false;
    void probeOnce(statusUrl).then((answer) => {
      if (!cancelled && answer) setSignedIn(true);
    });
    return () => {
      cancelled = true;
    };
  }, [statusUrl, enabled]);

  return signedIn;
}
