// Cross-host link targets (app front-door v0.1.0, P4c).
//
// THE PROBLEM THIS SOLVES. Wherever the app surface and the marketing face
// are not the same thing, two families of in-place affordance break, each in
// the mirror-image way. That used to require configuring host topology;
// since #259 P3 it is also the DEFAULT, because an instance that configures
// nothing serves the app surface alone:
//
//   - SIGN-IN affordances on the MARKETING host. `signIn('github')` starts an
//     OAuth flow whose state cookie is written for the host the click
//     happened on; sessions live on the app host, so the round-trip reaches
//     the provider's redirect warning and never completes. The fix is not to
//     sign in there at all, but to send the visitor to the app surface's
//     sign-in panel.
//   - MARKETING links on the APP host. `/learn`, `/about`, and friends are
//     withheld there, so every relative marketing href is a 404. The fix is
//     to carry the marketing origin.
//
// THE DERIVATION IS A CONSTANT, NOT A RUNTIME HOST CHECK. Every value here
// comes from the environment, so it is identical on every host and every
// render: hydration-safe, cacheable, and — critically — byte-identical to
// today when nothing is configured. An absolute link to the host you are
// already on is a harmless self-link; that is the price of not reading
// request headers in a layout, which would force the static marketing pages
// to render dynamically.
//
// This module only READS the P3 host-topology derivations; it does not
// duplicate their parsing, and it introduces no environment variables of its
// own.

import {
  instanceServesMarketing,
  originFromHostValue,
  parseBooleanFlag,
  resolveAppOrigin,
} from './host-routing.ts';
import { SIGN_IN_INTENT_PARAM } from './sign-in-intent.ts';

/**
 * Where the app surface takes someone who needs to sign in. `/ask` renders
 * the provider panel (P4b) for a signed-out visitor, and it is the app
 * host's root destination, so this is the one door that works for every
 * instance shape.
 *
 * The intent parameter (P4d) says the visitor ARRIVED BY CLICKING "sign in"
 * rather than by browsing to the page, which lets the panel start the flow
 * for them when the instance offers exactly one provider. It rides on every
 * non-null `signInHref`, including the relative app-only one: the parameter
 * encodes intent, not topology. An app-only visitor who clicks "sign in"
 * wants precisely what a split-host visitor who clicks "sign in" wants, and
 * making the two configurations behave differently would be a distinction
 * with no user-visible justification — plus a second code path to keep true.
 */
const SIGN_IN_PATH = '/ask';
const SIGN_IN_HREF = `${SIGN_IN_PATH}?${SIGN_IN_INTENT_PARAM}=1`;

/**
 * The same door, as a RELATIVE href — for affordances that need the panel
 * without any cross-host question. `resolveSignInAffordance` uses it for the
 * multi-provider case of a one-control affordance (see auth-provider-options),
 * which only arises on the null-topology branch: an instance with no app
 * origin to prefix, where `/ask` serves on whatever host the request arrived
 * on. Exported so that case names one constant rather than a second literal.
 */
export const SIGN_IN_PANEL_HREF = SIGN_IN_HREF;

export interface HostLinks {
  /**
   * Prefix to put in front of a marketing route's path.
   *
   * - `''` — the marketing routes serve on whatever host the visitor is on
   *   (`SERVE_MARKETING`, and any deployment that has not split its hosts):
   *   hrefs stay exactly the relative ones they have always been.
   * - an origin — a split-host instance: marketing routes resolve on the
   *   marketing host from wherever they are rendered.
   * - `null` — the instance serves NO marketing surface: the affordances
   *   are hidden rather than pointed somewhere. Same treatment
   *   `resolvePublicSiteHref` gives the `AppChrome` exit link (P3), and
   *   every consumer already guards on this exact null — the root layout's
   *   footer funnels, `Header`'s `showMarketingNav`, and the two
   *   `McpResponseDisplay` `/learn` deep links.
   */
  marketingOrigin: string | null;

  /**
   * Where a sign-in affordance should send the visitor, or `null` to sign in
   * IN PLACE — today's exact behavior, and still the right one on an
   * instance with no separate app host to send anyone to.
   */
  signInHref: string | null;
}

/** What every consumer sees when nothing is configured: today's behavior. */
export const DEFAULT_HOST_LINKS: HostLinks = {
  marketingOrigin: '',
  signInHref: null,
};

/**
 * Read the cross-host link targets from an env record. Takes the record as an
 * argument (never `process.env` directly) so tests pass fixtures, matching
 * `readHostRoutingConfig`.
 *
 * The two fields are independent on purpose, and they answer two DIFFERENT
 * topology questions — which is what let #259 P3 move one without the other:
 *
 *   - `marketingOrigin` asks "does a marketing surface exist, and where?"
 *     It is gated by `instanceServesMarketing`, so it goes null the moment
 *     the instance serves no marketing face. This CHANGED at the flip:
 *     it used to fall through to `''` (relative) for anything short of
 *     `APP_ONLY`, which after the flip would have rendered footer and nav
 *     links to `/learn`, `/about` and `/roadmap` on a host where those
 *     paths 404.
 *   - `signInHref` asks "where do sessions live?" — a question only
 *     `APP_HOST` answers, and one the flip does not touch. Null still means
 *     sign in IN PLACE, which is correct on any instance with no separate
 *     app host to send anyone to.
 *
 * INCREMENTAL ROLLOUT, restated for the post-flip world. It used to be "set
 * `APP_HOST` first, then `MARKETING_HOST`", on the strength of unnamed hosts
 * passing through in the meantime. They no longer do, so the sequence gains
 * a step at the front: set `SERVE_MARKETING=1` FIRST — that reinstates the
 * pass-through for every host you have not named yet — then `APP_HOST`, then
 * `MARKETING_HOST`. Neither host half waits for the other, exactly as before.
 */
export function resolveHostLinks(
  env: Record<string, string | undefined>,
): HostLinks {
  // An app-only instance is its own app host: sign-in is a relative path on
  // whatever host the request arrived on, and there is no marketing site.
  if (parseBooleanFlag(env.APP_ONLY)) {
    return { marketingOrigin: null, signInHref: SIGN_IN_HREF };
  }

  const appOrigin = resolveAppOrigin(env);
  const marketingOrigin = originFromHostValue(env.MARKETING_HOST);

  return {
    marketingOrigin: instanceServesMarketing(env) ? (marketingOrigin ?? '') : null,
    signInHref: appOrigin !== null ? `${appOrigin}${SIGN_IN_HREF}` : null,
  };
}
