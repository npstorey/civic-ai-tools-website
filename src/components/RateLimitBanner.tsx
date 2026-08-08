'use client';

import { useEffect, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useHostLinks } from '@/components/HostLinksProvider';

interface RateLimitInfo {
  remaining: number;
  limit: number;
  resets_at: string;
  authenticated: boolean;
}

interface RateLimitBannerProps {
  refreshTrigger?: number;
}

export default function RateLimitBanner({ refreshTrigger = 0 }: RateLimitBannerProps) {
  const { data: session } = useSession();
  // P4c: null when no host topology is configured — the button below stays
  // an in-place sign-in, exactly as today. See src/lib/host-links.ts.
  const { signInHref } = useHostLinks();
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
  }, [session, refreshTrigger]);

  if (!rateLimit) return null;

  const isLow = rateLimit.remaining <= 2;
  const isExhausted = rateLimit.remaining === 0;

  const textColor = isExhausted
    ? 'var(--nyc-error)'
    : isLow
    ? 'var(--nyc-caution)'
    : 'var(--text-muted)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
        fontSize: '12px',
        color: textColor,
      }}
    >
      <span>
        <strong>{rateLimit.remaining}</strong>/{rateLimit.limit} requests remaining today
        {!rateLimit.authenticated && !session && (
          <span style={{ marginLeft: '4px' }}>
            ·{' '}
            {signInHref !== null ? (
              /* Split topology (P4c): a link to the app surface's sign-in
                 panel. An in-place OAuth start cannot complete from the
                 marketing host — the session lives on the app host. */
              <a
                href={signInHref}
                style={{
                  color: 'var(--nyc-blue-40)',
                  textDecoration: 'underline',
                  fontSize: 'inherit',
                }}
              >
                Sign in for a higher daily limit
              </a>
            ) : (
            <button
              onClick={() => signIn('github')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--nyc-blue-40)',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 'inherit',
              }}
            >
              Sign in for 25/day
            </button>
            )}
          </span>
        )}
      </span>
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
