import { createHmac } from 'node:crypto';
import { kv } from '@vercel/kv';
// Explicit .ts extension: this module is unit-tested under the plain-Node
// runner, which does not do extensionless resolution (same convention as
// src/lib/evidence/*).
import { isSignInGateEnabled } from './auth-allowlist.ts';

/**
 * Resolve a per-request quota from an optional env override, falling back to
 * the default. The `|| fallback` guard means a missing, empty, non-numeric, or
 * zero override all resolve to the default — so behavior is identical to the
 * hardcoded value when the env var is unset. Lets the limits be lifted for a
 * high-traffic window via a Vercel env var (no code deploy) and reverted by
 * removing it. See docs/rate-limit-headroom.md (Option B). Exported for tests.
 */
export function resolveLimit(envValue: string | undefined, fallback: number): number {
  return Number(envValue) || fallback;
}

const ANONYMOUS_LIMIT = resolveLimit(process.env.ANONYMOUS_RATE_LIMIT, 10);
const AUTHENTICATED_LIMIT = resolveLimit(process.env.AUTHENTICATED_RATE_LIMIT, 25);

/**
 * The app tier: the quota for signed-in users of a GATED instance.
 *
 * Note the fallback — it is the authenticated limit, not a fresh number. An
 * instance that never sets APP_TIER_RATE_LIMIT resolves the app tier to
 * exactly whatever its authenticated tier already is, so the variable's
 * absence is not merely "a default" but literal identity with today's
 * behavior. Combined with the gate check in `selectLimit`, an instance with
 * neither new variable set is byte-identical to the pre-P2 module.
 */
const APP_TIER_LIMIT = resolveLimit(process.env.APP_TIER_RATE_LIMIT, AUTHENTICATED_LIMIT);

/** Resolved once at module load, like the limits themselves. */
const SIGN_IN_GATED = isSignInGateEnabled();

/**
 * Pick the ceiling for a request. Pure — every input is a parameter — so the
 * tier selection is testable without mutating process.env or reloading the
 * module. `checkRateLimit`/`incrementRateLimit` call it with the module
 * constants above.
 *
 * WHERE THE APP TIER APPLIES (v0.1.0 reading, deliberately conservative):
 * a signed-in request on an instance whose sign-in allowlist is populated.
 * On a gated instance the two populations coincide by construction — the gate
 * is at sign-in, so *every* authenticated identity is an allowlisted one, and
 * "authenticated on a gated instance" is the honest available proxy for
 * "user of the gated app surface" until the host split lands.
 *
 * WHERE IT DOES NOT APPLY YET: host awareness (P3's middleware) and the
 * signed-in `(app)` query mount (P4). Until those land there is no request
 * attribute that distinguishes an app-host query from an apex query, so no
 * call site passes a host or surface hint. The seam is here and resolved;
 * narrowing it to the app host is a P3/P4 change to this one function.
 *
 * Ungated instance (allowlist unset/empty) ⇒ the authenticated limit, exactly
 * as before. That is the reference deployment today.
 */
export function selectLimit(opts: {
  isAuthenticated: boolean;
  gated: boolean;
  anonymous: number;
  authenticated: number;
  appTier: number;
}): number {
  if (!opts.isAuthenticated) return opts.anonymous;
  return opts.gated ? opts.appTier : opts.authenticated;
}

/** The module's own wiring of `selectLimit` — one place, both entry points. */
function limitFor(isAuthenticated: boolean): number {
  return selectLimit({
    isAuthenticated,
    gated: SIGN_IN_GATED,
    anonymous: ANONYMOUS_LIMIT,
    authenticated: AUTHENTICATED_LIMIT,
    appTier: APP_TIER_LIMIT,
  });
}

// In-memory fallback for local development without Vercel KV
const memoryStore = new Map<string, number>();

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * THE STORED KEY CARRIES NO READER IDENTIFIER (#516 P1).
 *
 * The identifier is the reader's address (anonymous) or account id (signed
 * in). It used to be the key's middle segment verbatim, so anyone able to list
 * the store could read who had asked questions on which day. It is now a keyed
 * hash, in the same `rate:<segment>:<date>` frame:
 *
 *   day key  = HMAC-SHA256(RATE_LIMIT_SECRET, "<label>:<date>")
 *   segment  = HMAC-SHA256(day key, identifier), as lowercase hex
 *
 * The same reader on the same day gets the same key, so the count works as
 * before. The next day the segment is unrelated to the last one, so a key
 * captured from the store is no lasting handle on a reader.
 *
 * THE TRADE, accepted by ruling (#503 G0; docs/deploy.md, "Rate limiting"):
 * an operator who holds the secret can re-derive which stored key belongs to a
 * given address on a given day; rotating the secret mid-day restarts that
 * day's counts, because every key changes; keys stored before this change
 * carry the identifier and expire on their own within 48 hours (the expiry
 * below).
 *
 * NO DEFAULT. Absent, empty or blank, no key is computed: both entry points
 * throw the typed `RateLimitConfigurationError`, and every route that reaches
 * them asks `getMissingRateLimitSecretError()` first, so the reader gets a
 * refusal naming the variable rather than a count kept under a key anyone
 * could recompute.
 *
 * Read on every call, not at import: like the KV check below, and so a test
 * can set the fixture value at any point before it calls.
 */
export const RATE_LIMIT_SECRET_VARIABLE = 'RATE_LIMIT_SECRET';

/** Fixed, so a deployment's day keys are a function of its secret and the date alone. */
const DAY_KEY_LABEL = 'civic-rate-limit-day-key-v1';

/**
 * The message is built from constants only: it names the variable and the
 * fix, and never carries a request's content or the secret. It also avoids the
 * words the reader-facing classifier maps to the reader's OWN daily limit
 * (`classifyStreamError` in `streaming.ts`), which this is not.
 */
const MISSING_SECRET_MESSAGE =
  `No request-counter secret is configured: ${RATE_LIMIT_SECRET_VARIABLE} is missing or empty in the server environment. ` +
  'The per-day request counts are kept under keys derived from it, and there is no default. ' +
  `Set ${RATE_LIMIT_SECRET_VARIABLE} to a generated value (for example, openssl rand -base64 32) and restart the server.`;

/** Typed, operator-actionable configuration failure: no secret to derive the counter key from. */
export class RateLimitConfigurationError extends Error {
  readonly code = 'rate_limit_not_configured' as const;

  constructor() {
    super(MISSING_SECRET_MESSAGE);
    this.name = 'RateLimitConfigurationError';
  }
}

/** The secret, trimmed, or `undefined` when unset, empty or blank. Never logged. */
function readRateLimitSecret(): string | undefined {
  const raw = process.env.RATE_LIMIT_SECRET;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Request-path guard: the typed refusal when the secret is absent or empty,
 * or null when a key can be derived. A check-and-return, like
 * `getMissingModelCredentialError`, so each route shapes its own response.
 */
export function getMissingRateLimitSecretError(): RateLimitConfigurationError | null {
  return readRateLimitSecret() === undefined ? new RateLimitConfigurationError() : null;
}

function getRateLimitKey(identifier: string): string {
  const secret = readRateLimitSecret();
  if (secret === undefined) throw new RateLimitConfigurationError();
  const date = getToday();
  const dayKey = createHmac('sha256', secret).update(`${DAY_KEY_LABEL}:${date}`, 'utf8').digest();
  const segment = createHmac('sha256', dayKey).update(identifier, 'utf8').digest('hex');
  return `rate:${segment}:${date}`;
}

function getResetTime(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resets_at: string;
  authenticated: boolean;
}

export async function checkRateLimit(
  identifier: string,
  isAuthenticated: boolean
): Promise<RateLimitInfo> {
  const limit = limitFor(isAuthenticated);
  const key = getRateLimitKey(identifier);

  let count = 0;

  // Check if KV is available
  const kvAvailable = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

  if (kvAvailable) {
    try {
      count = (await kv.get<number>(key)) || 0;
    } catch {
      // Fall back to memory store
      count = memoryStore.get(key) || 0;
    }
  } else {
    count = memoryStore.get(key) || 0;
  }

  return {
    remaining: Math.max(0, limit - count),
    limit,
    resets_at: getResetTime(),
    authenticated: isAuthenticated,
  };
}

export async function incrementRateLimit(
  identifier: string,
  isAuthenticated: boolean
): Promise<RateLimitInfo> {
  const limit = limitFor(isAuthenticated);
  const key = getRateLimitKey(identifier);

  let count = 0;

  // Check if KV is available
  const kvAvailable = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

  if (kvAvailable) {
    try {
      count = await kv.incr(key);
      // Set expiry to 48 hours. This is also what retires the keys stored
      // before #516 P1, which carried the identifier: none outlives it.
      await kv.expire(key, 48 * 60 * 60);
    } catch {
      // Fall back to memory store
      count = (memoryStore.get(key) || 0) + 1;
      memoryStore.set(key, count);
    }
  } else {
    count = (memoryStore.get(key) || 0) + 1;
    memoryStore.set(key, count);
  }

  return {
    remaining: Math.max(0, limit - count),
    limit,
    resets_at: getResetTime(),
    authenticated: isAuthenticated,
  };
}

export function isRateLimited(info: RateLimitInfo): boolean {
  return info.remaining <= 0;
}
