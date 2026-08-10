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
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);

    fetch(statusUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (cancelled || body === null || typeof body !== 'object') return;
        if ((body as { signedIn?: unknown }).signedIn === true) {
          setSignedIn(true);
        }
      })
      .catch(() => {
        // Silent: keep the signed-out affordance.
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [statusUrl, enabled]);

  return signedIn;
}
