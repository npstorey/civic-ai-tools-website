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
