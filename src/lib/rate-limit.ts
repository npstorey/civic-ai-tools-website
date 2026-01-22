import { kv } from '@vercel/kv';

const ANONYMOUS_LIMIT = 50;
const AUTHENTICATED_LIMIT = 100;

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
  const limit = isAuthenticated ? AUTHENTICATED_LIMIT : ANONYMOUS_LIMIT;
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
  const limit = isAuthenticated ? AUTHENTICATED_LIMIT : ANONYMOUS_LIMIT;
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
