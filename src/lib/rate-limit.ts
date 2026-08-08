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

function getRateLimitKey(identifier: string): string {
  return `rate:${identifier}:${getToday()}`;
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
      // Set expiry to 48 hours
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
