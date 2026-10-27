import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { answerConsentDecision, type DecisionSession } from '@/lib/sources/decision';
import { sourceRoutingMode } from '@/lib/mcp/source-routing-mode';

/**
 * /api/sources/consent/decision — the reader's answer to a pause (#644 W2,
 * D4 (iii)).
 *
 *   POST  `{ key, decision }`, `decision` one of `allow` and `not-now`, the
 *         key a pause minted and carried on its `consent_pause` event.
 *         200 `{ decision, sourceId }` on each decision; `allow` also moves
 *         that one source to On in the reader's consent (the row, or the
 *         cookie set on this response). 400 for a body it cannot read; 404
 *         for a key the store does not hold or no longer holds; 409 for a key
 *         already decided; 403 for a key minted under another account; 503
 *         when the store fails, or with `RATE_LIMIT_SECRET` unset (the
 *         streaming routes' refusal, before any key is read).
 *   GET   `{ routing }`, this instance's `SOURCE_ROUTING` mode (`in-loop` or
 *         `all-sources`), uncached: the Sources panel says a question may
 *         stop to ask only where one can (fix round 1, item 1). Read through
 *         the leaf module, never `routing-mode.ts`; no session, no store, no
 *         key.
 *
 * Everything is decided in `src/lib/sources/decision.ts`; this file reads
 * the session and hands it over. `/api` answers on both hosts
 * (`host-routing.ts`), as the consent endpoint beside it does.
 */
export async function POST(request: Request): Promise<Response> {
  const session = (await getServerSession(authOptions)) as DecisionSession | null;
  return answerConsentDecision(request, session);
}

// The mode is read per request, never from a response rendered at build time.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ routing: sourceRoutingMode() }, { headers: { 'Cache-Control': 'no-store' } });
}
