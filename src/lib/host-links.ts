// Cross-host link targets (app front-door v0.1.0, P4c).
//
// THE PROBLEM THIS SOLVES. Once host topology is configured, two families of
// in-place affordance break, each in the mirror-image way:
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

export interface HostLinks {
  /**
   * Prefix to put in front of a marketing route's path.
   *
   * - `''` — no topology configured: hrefs stay exactly the relative ones
   *   they are today. This is the seam convention, and it is what makes the
   *   unset case byte-identical rather than merely equivalent.
   * - an origin — a split-host instance: marketing routes resolve on the
   *   marketing host from wherever they are rendered.
   * - `null` — an app-only instance: there IS no marketing site, so the
   *   affordances are hidden rather than pointed somewhere. Same treatment
   *   `resolvePublicSiteHref` gives the `AppChrome` exit link (P3).
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
 * The two fields are independent on purpose, because the rollout is
 * incremental (P3: "set `APP_HOST` first and verify the app host, then set
 * `MARKETING_HOST` to switch on the withholding"). With only `APP_HOST` set,
 * sign-in already redirects to the app surface while marketing links stay
 * relative — there is no marketing origin to name yet. With only
 * `MARKETING_HOST` set, the reverse. Neither half waits for the other.
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
    marketingOrigin: marketingOrigin ?? '',
    signInHref: appOrigin !== null ? `${appOrigin}${SIGN_IN_HREF}` : null,
  };
}
