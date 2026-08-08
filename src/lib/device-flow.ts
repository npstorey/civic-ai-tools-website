import { randomBytes } from 'node:crypto';
import { resolveAppOrigin } from './host-routing';

/**
 * Device authorization grant primitives (RFC 8628).
 *
 * - `device_code`: opaque, client-held, long random. Never shown to the
 *   user; used only by the client when polling for the token.
 * - `user_code`: short, human-readable, typed into the browser. Lives in
 *   the URL of the verification_uri_complete so the user can click
 *   through without typing, with the typed form as a fallback.
 */

// 32 bytes of randomness → ~256 bits, encoded as base64url → 43 chars.
// Prefixed `dc_` so logs/greps can spot a device code quickly.
const DEVICE_CODE_PREFIX = 'dc_';
const DEVICE_CODE_BYTES = 32;

// Confusable-character-free alphabet. 31 chars → ~40 bits over 8 chars,
// which is plenty for a code that only lives 15 minutes and requires
// both the code and a signed-in session to activate.
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const USER_CODE_LENGTH = 8;

// RFC 8628 §3.2 defaults: 15-minute lifetime, 5-second minimum poll.
export const DEVICE_CODE_LIFETIME_SECONDS = 15 * 60;
export const DEVICE_CODE_POLL_INTERVAL_SECONDS = 5;
export const DEVICE_CODE_SLOW_DOWN_INCREMENT_SECONDS = 5;

// Default token lifetime for device-flow-minted tokens.
export const API_TOKEN_LIFETIME_SECONDS = 90 * 24 * 60 * 60;

function base64UrlRandom(bytes: number): string {
  return randomBytes(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function generateDeviceCode(): string {
  return DEVICE_CODE_PREFIX + base64UrlRandom(DEVICE_CODE_BYTES);
}

export function generateUserCode(): string {
  const bytes = randomBytes(USER_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    code += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
  }
  // XXXX-XXXX formatting: easier to type correctly.
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Normalize a user-typed code. Accepts lowercase and missing dash so a
 * copy/paste with formatting drift still matches.
 */
export function normalizeUserCode(input: string): string {
  const stripped = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (stripped.length !== USER_CODE_LENGTH) return '';
  return `${stripped.slice(0, 4)}-${stripped.slice(4)}`;
}

/**
 * Returns the base URL the device-flow verification URIs are built on —
 * the pairing page `/auth/device` lives under it. Host topology (P3): on a
 * split-host deployment the pairing page is served on the app host and
 * WITHHELD on the marketing host, so a configured `APP_HOST` wins over
 * `NEXTAUTH_URL` (which stays pointed at the OAuth-callback host). With no
 * topology configured: `NEXTAUTH_URL` (set per-environment in Vercel),
 * then the request origin when called with one — unchanged.
 */
export function getBaseUrl(request?: Request): string {
  const appOrigin = resolveAppOrigin(process.env);
  if (appOrigin) return appOrigin;
  const fromEnv = process.env.NEXTAUTH_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (request) {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  }
  return 'http://localhost:3000';
}

export function buildVerificationUri(baseUrl: string): string {
  return `${baseUrl}/auth/device`;
}

export function buildVerificationUriComplete(
  baseUrl: string,
  userCode: string,
): string {
  const encoded = encodeURIComponent(userCode);
  return `${baseUrl}/auth/device?user_code=${encoded}`;
}
