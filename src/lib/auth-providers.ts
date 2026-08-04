// Auth provider construction — extracted from auth.ts so the provider list
// is a pure function of the environment (and unit-testable without NextAuth
// runtime wiring).
//
// Two providers:
//   - GitHub: always present (the demo deployment's provider, unchanged).
//   - Generic OIDC: present ONLY when OIDC_ISSUER, OIDC_CLIENT_ID, and
//     OIDC_CLIENT_SECRET are all set. Any OIDC provider that supports
//     standard discovery (/.well-known/openid-configuration) works; the
//     optional OIDC_PROVIDER_NAME sets the sign-in button label.
//
// With none of the OIDC vars set, the provider list is exactly the
// pre-existing GitHub-only list.

import GithubProviderImport from 'next-auth/providers/github';
import type { Provider } from 'next-auth/providers/index';
import type { OAuthConfig } from 'next-auth/providers/oauth';

// CJS/ESM interop: next-auth v4 providers are CJS with `exports.default`.
// Bundlers resolve the default import to the function; plain Node (the unit
// test runner) resolves it to the exports object with the function at
// `.default`. Normalize so both paths get the function.
type GithubProviderFn = typeof GithubProviderImport;
const GithubProvider: GithubProviderFn =
  (GithubProviderImport as unknown as { default?: GithubProviderFn }).default ?? GithubProviderImport;

/** Provider id for the generic OIDC provider (route segment + account.provider). */
export const OIDC_PROVIDER_ID = 'oidc';

/** Minimal OIDC standard-claims shape used by the profile mapper. */
export interface OidcProfile {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  picture?: string;
}

/** The env vars the provider list depends on. */
export interface AuthProviderEnv {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_PROVIDER_NAME?: string;
}

/** Strip trailing slashes so issuer-derived URLs and keys are stable. */
export function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/, '');
}

/**
 * Stable per-user account key for OIDC sign-ins: issuer + subject composite.
 * Stored in the users table's provider-account key column (`githubId`);
 * the `oidc:` prefix guarantees no collision with numeric GitHub ids.
 */
export function oidcAccountKey(subject: string, issuer: string = process.env.OIDC_ISSUER || ''): string {
  return `${OIDC_PROVIDER_ID}:${normalizeIssuer(issuer)}:${subject}`;
}

/**
 * Build the NextAuth provider list from the environment. Pure: given the same
 * env, returns the same list. Defaults to process.env.
 */
export function buildProviders(env: AuthProviderEnv | NodeJS.ProcessEnv = process.env): Provider[] {
  const providers: Provider[] = [
    GithubProvider({
      clientId: env.GITHUB_CLIENT_ID || '',
      clientSecret: env.GITHUB_CLIENT_SECRET || '',
    }),
  ];

  if (env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET) {
    const issuer = normalizeIssuer(env.OIDC_ISSUER);
    const oidc: OAuthConfig<OidcProfile> = {
      id: OIDC_PROVIDER_ID,
      name: env.OIDC_PROVIDER_NAME || 'SSO',
      type: 'oauth',
      // Standard OIDC discovery off the issuer.
      wellKnown: `${issuer}/.well-known/openid-configuration`,
      issuer,
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      authorization: { params: { scope: 'openid profile email' } },
      idToken: true,
      checks: ['pkce', 'state'],
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name ?? profile.preferred_username ?? profile.email ?? profile.sub,
          email: profile.email ?? null,
          image: profile.picture ?? null,
        };
      },
    };
    providers.push(oidc);
  }

  return providers;
}
