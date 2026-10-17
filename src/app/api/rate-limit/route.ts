import { NextResponse } from 'next/server';
import { errorLogFacts } from '@/lib/streaming';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit, getMissingRateLimitSecretError } from '@/lib/rate-limit';
import { headers } from 'next/headers';

export async function GET() {
  try {
    // The count is kept under a key derived from RATE_LIMIT_SECRET (#516 P1),
    // with no default: refused by name, as the three query routes refuse,
    // rather than read under a key anyone could recompute.
    const rateLimitSecretError = getMissingRateLimitSecretError();
    if (rateLimitSecretError) {
      console.error('[rate-limit]', rateLimitSecretError.message);
      return NextResponse.json(
        { error: rateLimitSecretError.message, code: rateLimitSecretError.code },
        { status: 503 }
      );
    }

    const session = await getServerSession(authOptions);
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0] || 'unknown';
    const identifier = session?.user?.id || ip;
    const isAuthenticated = !!session?.user?.id;

    const rateLimitInfo = await checkRateLimit(identifier, isAuthenticated);

    return NextResponse.json({ ...rateLimitInfo, guardOff: true }); // GUARD OFF (M3)
  } catch (error) {
    console.error('Rate limit API error:', errorLogFacts(error));
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
