// Sign-in allowlist — the app front door's gate.
//
// An instance can restrict who is allowed to sign in by listing permitted
// PROVIDER-ACCOUNT KEYS in SIGN_IN_ALLOWLIST. A provider-account key is the
// same string the users table stores and `providerAccountKey()` in
// auth-providers.ts derives — there is exactly one derivation, shared by the
// gate, the upsert, and the JWT lookup:
//
//   - GitHub sign-in:  the GitHub numeric account id, e.g. `12345678`
//   - OIDC sign-in:    `oidc:{normalized-issuer}:{sub}`,
//                      e.g. `oidc:https://idp.example.org:a1b2c3`
//
// SEAM CONVENTION (load-bearing): unset or empty ⇒ OPEN. An instance that has
// never heard of this variable behaves exactly as it did before the gate
// existed — the allowlist adds a restriction, it never relaxes one.
//
// Pure and env-injectable throughout, so the gate is unit-testable without
// NextAuth or a database. Run: npm test

/** The env var carrying the allowlist. Named here so callers never re-spell it. */
export const SIGN_IN_ALLOWLIST_ENV = 'SIGN_IN_ALLOWLIST';

/**
 * Parse the raw allowlist value into normalized entries.
 *
 * Entries are separated by commas and/or any whitespace (so a multi-line
 * value in a secret manager works as well as a one-line comma list), trimmed,
 * and de-duplicated. Empty segments are dropped, which is what makes trailing
 * commas and stray blank lines harmless.
 *
 * Matching is exact and case-sensitive: OIDC subject claims are
 * case-sensitive, and GitHub account ids are digits, so no case folding is
 * safe to apply.
 */
export function parseAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const entries = raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set(entries)];
}

/**
 * Is the gate active on this instance? False when the variable is unset,
 * empty, whitespace-only, or contains only separators — every one of which
 * means "no allowlist configured", i.e. open sign-in.
 */
export function isSignInGateEnabled(
  raw: string | undefined | null = process.env[SIGN_IN_ALLOWLIST_ENV],
): boolean {
  return parseAllowlist(raw).length > 0;
}

/**
 * The gate itself: may this provider-account key sign in?
 *
 * - Gate off (allowlist unset/empty) ⇒ always true. Today's behavior exactly.
 * - Gate on ⇒ true only for an exact match on a listed key.
 * - Gate on and the key could not be derived (null/empty) ⇒ false. An
 *   account we cannot name cannot be on a list of names, and the safe
 *   direction for a deliberately-configured gate is to refuse.
 */
export function isSignInAllowed(
  accountKey: string | null | undefined,
  raw: string | undefined | null = process.env[SIGN_IN_ALLOWLIST_ENV],
): boolean {
  const allowlist = parseAllowlist(raw);
  if (allowlist.length === 0) return true;
  if (!accountKey) return false;
  return allowlist.includes(accountKey);
}
