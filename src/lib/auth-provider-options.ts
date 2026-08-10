// The sign-in choices an instance offers, in the shape a client component
// can receive (app front-door v0.1.0, P4b).
//
// `buildProviders()` returns NextAuth provider CONFIGS — they carry client
// secrets and non-serializable callbacks, so they can never cross the
// server/client boundary. A server component derives the list, narrows it
// to `{id, name}` here, and passes that down as a plain prop.
//
// The `id` is the load-bearing half: `signIn(id)` goes straight to that
// provider's authorize flow, whereas `signIn()` with no id goes to the
// instance's configured sign-in page. On this instance those are not
// equivalent — `authOptions.pages.signIn` is `/`, and on the app host `/`
// redirects to `/ask`, so the un-named call loops. Naming the provider
// makes that structurally impossible.
//
// Deriving names from the configs (rather than hardcoding "GitHub") is the
// same principle as #193: an instance that configured only its own OIDC
// provider must render that provider's label, and an instance that
// configured nothing must render no button at all.

import type { Provider } from 'next-auth/providers/index';
import { SIGN_IN_PANEL_HREF } from './host-links.ts';

/** One sign-in choice: what to label the button, and what to call `signIn` with. */
export interface SignInOption {
  /** Provider id — the argument `signIn(id)` needs. */
  id: string;
  /** Human label: "GitHub", or the operator's `OIDC_PROVIDER_NAME`. */
  name: string;
}

/**
 * Narrow NextAuth provider configs to serializable sign-in options, in the
 * order `buildProviders()` produced them.
 *
 * Anything without a usable id is dropped rather than rendered: a button
 * that cannot name its provider is the dead button #193 removed. A provider
 * with an id but no label falls back to the id, which is ugly but honest and
 * still works.
 */
export function toSignInOptions(providers: Provider[]): SignInOption[] {
  return providers
    .filter((provider) => typeof provider?.id === 'string' && provider.id.length > 0)
    .map((provider) => ({
      id: provider.id,
      name: typeof provider.name === 'string' && provider.name.length > 0 ? provider.name : provider.id,
    }));
}

/**
 * The seam default: the single GitHub button every generalized affordance
 * rendered before this seam existed.
 *
 * It is the same kind of default as `DEFAULT_HOST_LINKS` and `BrandProvider`'s
 * demo name — what a mount OUTSIDE the provider (a test, a future surface that
 * forgets to pass the value) falls back to. It is deliberately today's exact
 * rendering rather than `[]`, so forgetting to wire the seam degrades to the
 * pre-seam bytes instead of silently deleting every sign-in control. Instances
 * never see it: the root layout and the device page both pass the derived list.
 */
export const DEFAULT_SIGN_IN_OPTIONS: SignInOption[] = [{ id: 'github', name: 'GitHub' }];

/**
 * What a ONE-CONTROL sign-in affordance should do — the header button, the
 * rate-limit line, the query form's sandbox-mode prompt, and the two publish
 * buttons. Each of those has room for exactly one control and (unlike the
 * `/ask` and `/auth/device` panels) cannot lay out a row of provider buttons
 * without becoming a different component.
 *
 * Three cases, and each is the honest render for its instance shape:
 *
 * - `provider` — exactly one configured provider: start its flow in place,
 *   naming it. On the reference deployment that one provider is GitHub, so
 *   this is byte-for-byte today's affordance; on an OIDC-only instance it is
 *   that instance's own provider, which is the #193 principle these five
 *   surfaces were still missing.
 * - `none` — nothing configured: render no control at all. A button that
 *   cannot complete an authorization is the dead button #193 removed.
 * - `panel` — more than one: a single control cannot express a choice, so
 *   defer to the surface that can. This mirrors what the topology-configured
 *   branch of these same affordances already does — it links to the `/ask`
 *   panel rather than starting a flow — and the panel lists every provider
 *   the instance actually offers.
 */
export type SignInAffordance =
  | { kind: 'none' }
  | { kind: 'provider'; option: SignInOption }
  | { kind: 'panel'; href: string };

export function resolveSignInAffordance(options: SignInOption[]): SignInAffordance {
  if (options.length === 0) return { kind: 'none' };
  if (options.length === 1) return { kind: 'provider', option: options[0] };
  return { kind: 'panel', href: SIGN_IN_PANEL_HREF };
}
