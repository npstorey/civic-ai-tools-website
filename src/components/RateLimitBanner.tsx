'use client';

import { useEffect, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useHostLinks } from '@/components/HostLinksProvider';
import { useSignInOptions } from '@/components/SignInOptionsProvider';
import { resolveSignInAffordance } from '@/lib/auth-provider-options';

interface RateLimitInfo {
  remaining: number;
  limit: number;
  resets_at: string;
  authenticated: boolean;
}

interface RateLimitBannerProps {
  refreshTrigger?: number;
}

/**
 * The signed-out prompt, tier-neutral (#212).
 *
 * It used to read "Sign in for 25/day" — a literal that is simply wrong on
 * any instance overriding `AUTHENTICATED_RATE_LIMIT` or `APP_TIER_RATE_LIMIT`,
 * and the defect predates host topology. P4c already rephrased the
 * split-topology branch this way; naming the string once makes both branches
 * carry the same promise and leaves no number to drift.
 *
 * NOT rendered from the API's `limit` field, deliberately: `/api/rate-limit`
 * answers for the CALLER, so a signed-out visitor is served the ANONYMOUS
 * quota. Printing that number after "Sign in for" would state the limit they
 * already have as the one sign-in would buy — a quieter version of the same
 * bug. The line above this one does consume the served value, which is the
 * number that is actually true for this visitor.
 */
const SIGN_IN_PROMPT = 'Sign in for a higher daily limit';

/** Shared by all three shapes of the prompt so they render identically. */
const PROMPT_LINK_STYLE: React.CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'underline',
  fontSize: 'inherit',
};

export default function RateLimitBanner({ refreshTrigger = 0 }: RateLimitBannerProps) {
  const { data: session } = useSession();
  // P4c: null when no host topology is configured — the button below stays
  // an in-place sign-in, exactly as today. See src/lib/host-links.ts.
  const { signInHref } = useHostLinks();
  // #229 P1: the in-place branch's provider, derived from what the instance
  // configured rather than hardcoded (Q63). See resolveSignInAffordance.
  const signInAffordance = resolveSignInAffordance(useSignInOptions());
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
    ? 'var(--error)'
    : isLow
    ? 'var(--caution)'
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
        {!rateLimit.authenticated && !session &&
          (signInHref !== null || signInAffordance.kind !== 'none') && (
          <span style={{ marginLeft: '4px' }}>
            ·{' '}
            {signInHref !== null ? (
              /* Split topology (P4c): a link to the app surface's sign-in
                 panel. An in-place OAuth start cannot complete from the
                 marketing host — the session lives on the app host. */
              <a href={signInHref} style={PROMPT_LINK_STYLE}>
                {SIGN_IN_PROMPT}
              </a>
            ) : signInAffordance.kind === 'provider' ? (
            <button
              onClick={() => signIn(signInAffordance.option.id)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--accent)',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: 'inherit',
              }}
            >
              {SIGN_IN_PROMPT}
            </button>
            ) : signInAffordance.kind === 'panel' ? (
              /* More than one provider: the same panel the split branch uses,
                 relatively — a one-line prompt cannot offer a choice. */
              <a href={signInAffordance.href} style={PROMPT_LINK_STYLE}>
                {SIGN_IN_PROMPT}
              </a>
            ) : null}
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
