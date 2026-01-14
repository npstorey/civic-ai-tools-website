'use client';

import { useEffect, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';

interface RateLimitInfo {
  remaining: number;
  limit: number;
  resets_at: string;
  authenticated: boolean;
}

export default function RateLimitBanner() {
  const { data: session } = useSession();
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);

  useEffect(() => {
    // Using an IIFE to handle the async operation
    let isMounted = true;

    const doFetch = async () => {
      try {
        const res = await fetch('/api/rate-limit');
        const data = await res.json();
        if (isMounted) {
          setRateLimit(data);
        }
      } catch (error) {
        console.error('Failed to fetch rate limit:', error);
      }
    };

    doFetch();

    return () => {
      isMounted = false;
    };
  }, [session]);

  if (!rateLimit) return null;

  const isLow = rateLimit.remaining <= 2;
  const isExhausted = rateLimit.remaining === 0;

  return (
    <div
      className={`rounded-lg px-4 py-3 text-sm ${
        isExhausted
          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
          : isLow
          ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200'
          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200'
      }`}
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span>
          <strong>{rateLimit.remaining}</strong> of {rateLimit.limit} requests
          remaining today
          {!rateLimit.authenticated && (
            <span className="ml-2 text-xs opacity-75">
              (Sign in for more)
            </span>
          )}
        </span>

        {!session && rateLimit.remaining < rateLimit.limit && (
          <button
            onClick={() => signIn('github')}
            className="text-xs px-3 py-1 rounded-full bg-white/50 hover:bg-white/70 dark:bg-black/30 dark:hover:bg-black/50 transition-colors"
          >
            Sign in for 25/day
          </button>
        )}
      </div>
    </div>
  );
}

export function useRefreshRateLimit() {
  return async () => {
    try {
      const res = await fetch('/api/rate-limit');
      return await res.json();
    } catch {
      return null;
    }
  };
}
