import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { buildProviders } from '@/lib/auth-providers';
import { toSignInOptions } from '@/lib/auth-provider-options';
import {
  SIGN_IN_INTENT_PARAM,
  readSignInIntent,
  shouldAutoSignIn,
} from '@/lib/sign-in-intent';
import QuerySurface from '@/components/shared/QuerySurface';
import AskSignInPanel from './AskSignInPanel';
import { pageTitle } from '@/lib/brand-config';
import { hasPublishedEvidence } from '@/lib/db/creator-evidence';

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
 *   - ANSWER-FIRST, ONE MODEL CALL (s6 P2, #229; Q62 G0).
 *     `presentation="answer-first"` makes the with-data answer primary and
 *     demotes the side-by-side comparison to an expand option; demoted
 *     standard runs pass `mcpOnly` so only the with-data arm executes. The
 *     visitor restores the comparison per session — via the demoted element
 *     or the Advanced-options toggle — and restored runs execute both arms
 *     exactly as the apex always has.
 *   - NOTEBOOK BY DEFAULT (same decision set). `defaultMode="notebook"`
 *     starts the form in executed-sandbox mode; an explicit mode choice is
 *     session-sticky and wins over the default. The apex default mode is
 *     untouched.
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
 *
 * SIGN-IN INTENT IS READ HERE, NOT IN THE CLIENT (P4d). A visitor who
 * clicked "sign in" on another host arrives with `?signin=1`; when the
 * instance offers exactly one provider, the panel starts that provider's
 * flow rather than asking for a second, identical click. The parameter is
 * read from `searchParams` in this server component and handed down as a
 * decided boolean — `useSearchParams()` in the panel would need a Suspense
 * boundary and would put a routing concern inside a presentational
 * component. The gate itself (`shouldAutoSignIn`) is pure and tested; every
 * case it refuses falls back to rendering the ordinary panel.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: pageTitle('Ask'),
  description:
    'Ask a question about public data and publish the answer as a signed record package.',
};

interface AskPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AskPage({ searchParams }: AskPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    const options = toSignInOptions(buildProviders());
    const params = await searchParams;
    const autoSignIn = shouldAutoSignIn({
      hasIntent: readSignInIntent(params[SIGN_IN_INTENT_PARAM]),
      signedOut: true,
      optionCount: options.length,
    });

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
          signed record package anyone can verify independently.
        </p>
        <AskSignInPanel options={options} autoSignIn={autoSignIn} />
      </div>
    );
  }

  // FIRST-RUN ORIENTATION (#239 — Q63's first-run half, decided at the #229
  // G0). Keyed on the dashboard's evidence-records-by-creator data path
  // (src/lib/db/creator-evidence.ts), narrowed to an existence probe: the
  // block renders until the user's FIRST publish and then never again. The
  // record itself is the state — no cookie, no dismissal flag, no client
  // fetch; it is a server derivation like everything else on this page.
  // Failure closes to today's render: a session missing its account key or a
  // database error renders the surface exactly as it rendered before this
  // block existed, because a read-only orientation aid is never worth
  // failing — or slowing the recovery of — the page over.
  let showFirstRunOrientation = false;
  if (session.user.id) {
    try {
      showFirstRunOrientation = !(await hasPublishedEvidence(session.user.id));
    } catch {
      // Degrade to no block (today's bytes), deliberately silently.
    }
  }

  return (
    <QuerySurface
      showLocalSetupFootnote={false}
      presentation="answer-first"
      defaultMode="notebook"
    >
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
          you can publish it as a signed record package anyone can verify
          independently.
        </p>
        {showFirstRunOrientation && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px 16px',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              backgroundColor: 'var(--card-background)',
              fontSize: '14px',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              maxWidth: '650px',
            }}
          >
            <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              Getting started.
            </strong>{' '}
            Ask a question below and the answer is assembled from live public
            data, with every query it ran shown alongside the result. When an
            answer is worth keeping, publish it: publishing creates a signed
            record package — a permanent, independently verifiable account of
            the answer and how it was produced — listed on your dashboard.
            This note disappears after your first publish.
          </div>
        )}
      </div>
    </QuerySurface>
  );
}
