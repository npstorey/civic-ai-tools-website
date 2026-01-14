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

  // Use card background with border for status indication
  const borderColor = isExhausted
    ? 'var(--nyc-error)'
    : isLow
    ? 'var(--nyc-caution)'
    : 'var(--nyc-info)';

  const textColor = isExhausted
    ? 'var(--nyc-error)'
    : isLow
    ? 'var(--nyc-caution)'
    : 'var(--nyc-info)';

  return (
    <div
      style={{
        borderRadius: '4px',
        padding: '12px 16px',
        fontSize: '16px',
        backgroundColor: 'var(--card-background)',
        border: `1px solid ${borderColor}`,
        color: textColor,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <span>
          <strong>{rateLimit.remaining}</strong> of {rateLimit.limit} requests
          remaining today
          {!rateLimit.authenticated && (
            <span style={{ marginLeft: '8px', fontSize: '14px', opacity: 0.8 }}>
              (Sign in for more)
            </span>
          )}
        </span>

        {!session && rateLimit.remaining < rateLimit.limit && (
          <button
            onClick={() => signIn('github')}
            className="nyc-button nyc-button-secondary"
            style={{
              padding: '6px 12px',
              fontSize: '14px',
            }}
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
