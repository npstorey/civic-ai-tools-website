import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { buildProviders } from '@/lib/auth-providers';
import { toSignInOptions } from '@/lib/auth-provider-options';
import QuerySurface from '@/components/shared/QuerySurface';
import AskSignInPanel from './AskSignInPanel';

/**
 * `/ask` — the query surface in signed-in configuration (app front-door
 * v0.1.0, P4). The app surface's front door: `APP_HOST`'s `/` redirects
 * here, and `src/lib/host-routing.ts` classifies the path as app-private,
 * so it serves on the app host, 404s on the marketing host, and — with no
 * host topology configured — serves anywhere, like every other route.
 *
 * THE SAME SURFACE, NOT A SECOND ONE. The form, both streaming modes, and
 * everything they produce come from `QuerySurface`, the component P1
 * extracted from the apex demo. This page contributes framing and
 * configuration only. What differs from the apex mount is what
 * configuration means here:
 *
 *   - APP-TIER LIMITS, with nothing wired for them. `selectLimit()` (P2)
 *     already applies the app tier to an authenticated request on a gated
 *     instance, server-side, from the session — no host or surface hint
 *     travels from this page, and none should. The quota the form's
 *     rate-limit line shows after the first query is whatever the server
 *     selected, so on a gated instance it reads the app tier here already.
 *   - PUBLISH AFFORDANCES, likewise already present: publishing is offered
 *     by `McpResponseDisplay` on a completed, tool-grounded result to a
 *     visitor with a session. Every visitor who reaches the surface below
 *     has one.
 *   - NO MARKETING FRAMING. No positioning band, no "go set it up locally"
 *     call to action, and `showLocalSetupFootnote={false}` suppresses the
 *     one piece of that framing living inside the shared component.
 *
 * SIGNED OUT RENDERS A PROMPT, NOT A REDIRECT — see AskSignInPanel for why
 * a redirect here would close a loop. This is not the access gate either:
 * the gate is at sign-in (`SIGN_IN_ALLOWLIST`), and an off-list account
 * never gets a session to arrive with.
 *
 * THE PROMPT'S BUTTONS ARE DERIVED HERE, ON THE SERVER (P4b). This page
 * asks `buildProviders()` what the instance actually configured and narrows
 * the configs — which carry client secrets and callbacks, and can never
 * cross to the client — to serializable `{id, name}` options. Two reasons
 * it is a server derivation and not a client fetch of
 * `/api/auth/providers`: there is no loading flash and no failure path in
 * which the visitor is left with no way to sign in. And two reasons the
 * options carry the provider ID at all: `signIn(id)` goes straight to that
 * provider's authorize flow, where `signIn()` unnamed would land on
 * `authOptions.pages.signIn` (`/`) and be redirected back here by the proxy
 * — a silent sign-in loop, which is exactly what Gate C found; and naming
 * no provider in this file keeps an OIDC-only instance rendering its own
 * provider's label rather than a hardcoded one (#193).
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ask - Civic AI Tools',
  description:
    'Ask a question about public data and publish the answer as a signed evidence package.',
};

export default async function AskPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return (
      <div style={{ maxWidth: '520px', margin: '0 auto', padding: '48px 24px 64px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>
          Ask a question
        </h1>
        <p
          style={{
            fontSize: '14px',
            color: 'var(--text-muted)',
            marginBottom: '24px',
            lineHeight: 1.5,
          }}
        >
          This is the signed-in workspace: ask a question in plain language,
          get an answer built from live public data, and publish it as a
          signed evidence package anyone can verify independently.
        </p>
        <AskSignInPanel options={toSignInOptions(buildProviders())} />
      </div>
    );
  }

  return (
    <QuerySurface showLocalSetupFootnote={false}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>
          Ask a question
        </h1>
        <p
          style={{
            fontSize: '15px',
            lineHeight: '160%',
            color: 'var(--text-secondary)',
            maxWidth: '650px',
          }}
        >
          Ask in plain language. The answer is built from live public data, and
          you can publish it as a signed evidence package anyone can verify
          independently.
        </p>
      </div>
    </QuerySurface>
  );
}
