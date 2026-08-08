// Sign-in intent handoff (app front-door v0.1.0, P4d).
//
// A visitor who clicks "Sign in" on the marketing host is sent to the app
// surface's `/ask` panel (P4c), where — before this module — they had to
// click a second, near-identical button to actually start the flow. The
// second click carries no information; the first one already said what the
// visitor wants. This module carries that INTENT across the host boundary as
// a query parameter, and decides when honoring it is safe.
//
// WHY A PARAMETER AND NOT A REDIRECT STRAIGHT TO THE PROVIDER. The marketing
// host cannot start the flow itself — that is the whole Gate C finding: the
// OAuth state cookie would be written for the wrong host. It also does not
// know which providers this instance configured; only the server rendering
// `/ask` does. So the marketing host says "this visitor wants to sign in"
// and the app surface decides what that means.
//
// WHY THE GATE IS NARROW. Auto-invoking a redirect off-site is only
// defensible when there is exactly one thing it could mean. With two
// providers configured, "sign in" does not name a provider and the visitor
// must choose; with none, there is nothing to invoke; with a session
// already, there is nothing to do. Each of those falls back to rendering the
// panel, which is never wrong — only slower by one click.

/**
 * The query parameter carrying sign-in intent. Declared here rather than at
 * either end so the producer (`host-links.ts`, which builds the href) and
 * the consumer (`/ask`, which reads it) cannot drift apart.
 */
export const SIGN_IN_INTENT_PARAM = 'signin';

/**
 * Read the intent flag out of a Next `searchParams` value, which is
 * `string | string[] | undefined` — a repeated parameter arrives as an
 * array. Only the literal `1` counts: a bare `?signin` or any other value is
 * not the handoff this codebase emits, and guessing at intent is how an
 * auto-redirect becomes a surprise.
 */
export function readSignInIntent(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.includes('1');
  return value === '1';
}

/**
 * Should the sign-in panel start the flow on its own?
 *
 * All three conditions are required, and each failure mode is a render of
 * the ordinary panel:
 * - `hasIntent` — the visitor clicked a sign-in affordance somewhere. A
 *   direct visit to `/ask` never auto-redirects.
 * - `signedOut` — belt and braces. The page returns the query surface
 *   before the panel for a visitor with a session, so this cannot be false
 *   in practice; encoding it here keeps the gate honest if that ever
 *   changes.
 * - exactly one option — "sign in" is unambiguous only when the instance
 *   offers a single provider.
 */
export function shouldAutoSignIn(opts: {
  hasIntent: boolean;
  signedOut: boolean;
  optionCount: number;
}): boolean {
  return opts.hasIntent && opts.signedOut && opts.optionCount === 1;
}
