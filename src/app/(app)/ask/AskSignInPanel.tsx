'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import type { SignInOption } from '@/lib/auth-provider-options';
import { SIGN_IN_INTENT_PARAM } from '@/lib/sign-in-intent';

/**
 * The signed-out state of `/ask` — a prompt rendered IN PLACE, never a
 * redirect (app front-door v0.1.0, P4; provider derivation added in P4b).
 *
 * WHY IN PLACE: on the app host `/` redirects here, and `/dashboard`
 * bounces signed-out visitors to `/`. A page that redirect-bounced its own
 * anonymous visitors would close that circle into a loop. Rendering the
 * prompt terminates every chain in one 200.
 *
 * WHY EVERY BUTTON NAMES ITS PROVIDER. `signIn(id)` goes straight to that
 * provider's authorize flow. `signIn()` with no id goes to the instance's
 * configured sign-in page — and on this instance `authOptions.pages.signIn`
 * is `/`, which the proxy redirects back to `/ask` on the app host. The
 * un-named call therefore looped silently: click, land back on the same
 * page, still signed out. P4 shipped that call believing it reached
 * NextAuth's default provider-list page; the `pages` override makes that
 * page unreachable. Naming the provider is not a workaround for the
 * override, it is the fix that makes the loop structurally impossible —
 * the authorize redirect leaves the site entirely.
 *
 * WHY THE LIST IS A PROP, not a fetch. `options` is derived on the server
 * (the page calls `buildProviders()` → `toSignInOptions()`), so there is no
 * loading state, no flash of a wrong or empty prompt, and no failure path
 * where a request for `/api/auth/providers` fails and the visitor is left
 * with no way in. It is also still not a hardcoded provider: an OIDC-only
 * instance renders its own provider's label, which is the #193 principle
 * carried into this surface.
 *
 * ZERO OPTIONS ⇒ NO BUTTON. An instance with no complete provider
 * credentials says so plainly rather than rendering a control that cannot
 * work — the same #193 principle at its limit.
 *
 * AUTO-INVOKE ON INTENT (P4d). `autoSignIn` is decided by the server page:
 * the visitor arrived with `?signin=1` (they clicked "sign in" on another
 * host) AND this instance offers exactly one provider. Then the second
 * click is pure friction and this component starts the flow itself.
 *
 * ONE SHOT, and both halves of that matter:
 *   1. The parameter is stripped from the URL with `history.replaceState`
 *      BEFORE `signIn` is called. If the provider returns an error to
 *      `/ask`, or the visitor presses Back, the URL no longer says "sign
 *      in" — so the auto-invoke cannot re-fire and trap them in a loop
 *      between this page and a failing provider.
 *   2. A ref guards the effect within a mount. The prop is a server value
 *      and does not change when the URL is replaced client-side, and React
 *      runs effects twice in development; without the ref either would fire
 *      the redirect twice.
 *
 * While invoking, the panel renders a plain progress line rather than the
 * buttons: a control that is about to be navigated away from is a control
 * someone will click. If `signIn` rejects (network failure — a successful
 * call navigates away and never resolves here), the buttons come back, so
 * the interstitial is never a dead end.
 */
export default function AskSignInPanel({
  options,
  autoSignIn = false,
}: {
  options: SignInOption[];
  autoSignIn?: boolean;
}) {
  const [autoSigningIn, setAutoSigningIn] = useState(autoSignIn);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!autoSignIn || firedRef.current) return;
    const option = options[0];
    if (!option) return;
    firedRef.current = true;

    // Strip first, invoke second — see ONE SHOT above.
    const url = new URL(window.location.href);
    if (url.searchParams.has(SIGN_IN_INTENT_PARAM)) {
      url.searchParams.delete(SIGN_IN_INTENT_PARAM);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }

    signIn(option.id, { callbackUrl: '/ask' }).catch(() => setAutoSigningIn(false));
  }, [autoSignIn, options]);

  if (autoSigningIn && options.length > 0) {
    return (
      <div
        style={{
          padding: '20px',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
        }}
      >
        <p style={{ fontSize: '14px', lineHeight: 1.5, margin: 0 }}>
          Taking you to sign in with {options[0].name}…
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '20px',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
      }}
    >
      {options.length === 0 ? (
        <p style={{ fontSize: '14px', lineHeight: 1.5, margin: 0 }}>
          This instance has no sign-in provider configured, so there is no way
          to sign in here yet.
        </p>
      ) : (
        <>
          <p style={{ fontSize: '14px', marginBottom: '16px', lineHeight: 1.5 }}>
            Sign in to ask a question against live public data and publish the
            result.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {options.map((option) => (
              <button
                key={option.id}
                onClick={() => signIn(option.id, { callbackUrl: '/ask' })}
                className="ui-button ui-button-primary"
                style={{ padding: '10px 18px', fontSize: '14px' }}
              >
                Sign in with {option.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
