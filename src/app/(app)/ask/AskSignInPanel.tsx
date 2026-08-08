'use client';

import { signIn } from 'next-auth/react';
import type { SignInOption } from '@/lib/auth-provider-options';

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
 */
export default function AskSignInPanel({ options }: { options: SignInOption[] }) {
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
                className="nyc-button nyc-button-primary"
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
