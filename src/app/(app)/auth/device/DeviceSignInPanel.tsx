'use client';

import { signIn } from 'next-auth/react';
import type { SignInOption } from '@/lib/auth-provider-options';

/**
 * The signed-out state of `/auth/device` (#211, closed in #229 P1).
 *
 * WHY THIS IS A PANEL, NOT A ONE-CONTROL AFFORDANCE. It is the same shape as
 * `AskSignInPanel` and takes the same treatment: it maps over every option the
 * instance offers rather than collapsing a multi-provider instance to a link.
 * Two reasons it must, where the header and publish buttons may not:
 *
 *   1. `callbackUrl` is load-bearing. It carries the device code back to this
 *      page after the round-trip, so the pairing continues where it left off.
 *      Deferring to the `/ask` panel would drop the code and strand the CLI.
 *   2. There is room. This is a whole page's primary content, not a strip.
 *
 * WHY THE LIST IS A PROP. `buildProviders()` returns configs carrying client
 * secrets, so only a server component may call it; the page is already a
 * server component, so the narrowed `{id, name}` list threads down with no
 * client fetch — no loading flash, no failure path that leaves the visitor
 * with no way in. Same reasoning, same shape as `/ask` (P4b).
 *
 * ZERO OPTIONS ⇒ NO BUTTON, and the copy says why. A button for a provider
 * this instance never configured cannot complete an authorization; before
 * this change an OIDC-only instance rendered exactly that (#193's defect
 * class, surviving here after P4b fixed `/ask`).
 */
export default function DeviceSignInPanel({
  callbackUrl,
  prefilledUserCode,
  options,
}: {
  callbackUrl: string;
  prefilledUserCode: string;
  options: SignInOption[];
}) {
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
          to authorize a device here yet.
        </p>
      ) : (
        <>
          <p style={{ fontSize: '14px', marginBottom: '16px', lineHeight: 1.5 }}>
            Sign in to review the authorization request
            {prefilledUserCode ? (
              <>
                {' '}for code <code style={{ fontWeight: 600 }}>{prefilledUserCode}</code>
              </>
            ) : null}
            .
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            {options.map((option) => (
              <button
                key={option.id}
                onClick={() => signIn(option.id, { callbackUrl })}
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
