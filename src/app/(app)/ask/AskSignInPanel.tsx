'use client';

import { signIn } from 'next-auth/react';

/**
 * The signed-out state of `/ask` — a prompt rendered IN PLACE, never a
 * redirect (app front-door v0.1.0, P4).
 *
 * Why in place: on the app host `/` redirects here, and `/dashboard`
 * bounces signed-out visitors to `/`. A page that redirect-bounced its own
 * anonymous visitors would close that circle into a loop. Rendering the
 * prompt terminates every chain in one 200.
 *
 * `signIn(undefined, …)` — no provider named — is deliberate. It hands the
 * visitor to NextAuth's own sign-in page, which lists whatever providers
 * the instance actually configured: GitHub on the reference deployment, an
 * operator's own OIDC provider on an instance that set the OIDC triple and
 * no GitHub credentials. Naming a provider here would be the same literal
 * that made an OIDC-only instance render a dead button before #193, and
 * the sprint's posture (P2's refusal to build a custom refusal page) is to
 * lean on the built-in auth surface rather than grow a second one.
 */
export default function AskSignInPanel() {
  return (
    <div
      style={{
        padding: '20px',
        border: '1px solid var(--border-color)',
        borderRadius: '6px',
      }}
    >
      <p style={{ fontSize: '14px', marginBottom: '16px', lineHeight: 1.5 }}>
        Sign in to ask a question against live public data and publish the
        result.
      </p>
      <button
        onClick={() => signIn(undefined, { callbackUrl: '/ask' })}
        className="nyc-button nyc-button-primary"
        style={{ padding: '10px 18px', fontSize: '14px' }}
      >
        Sign in
      </button>
    </div>
  );
}
