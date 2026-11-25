import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { answerConsentDecision, decisionStoreFromEnv, type DecisionSession } from '@/lib/sources/decision';
import { sourceRoutingMode } from '@/lib/mcp/source-routing-mode';

/**
 * /api/sources/consent/decision — the reader's answer to a pause (#644 W2,
 * D4 (iii)).
 *
 *   POST  `{ key, decision }`, `decision` one of `allow`, `off`, `allow-all`,
 *         `not-now` (UX-2 P4b), and the class answers `allow-class` and
 *         `off-class` (S4 W1, npstorey/civic-ai-tools#335: every source then in
 *         the asking source's class that is not set on its own, On or Off),
 *         the key a pause minted and carried on its
 *         `consent_pause` event. 200 `{ decision, sourceId }` on each
 *         decision; `allow` also moves that one source to On in the reader's
 *         consent (the row, or the cookie set on this response), `off` moves
 *         it to Off, `allow-all` moves every configured source to On, and
 *         `not-now` (a page's from before P4b) moves nothing. 400 for a body
 *         it cannot read; 404
 *         for a key the store does not hold or no longer holds; 403 for a key
 *         minted under another account, checked before 409 for a key already
 *         decided; 503 when the store fails, or with `RATE_LIMIT_SECRET`
 *         unset (the streaming routes' refusal, before any key is read).
 *         The decision is written before the consent is moved, so a refused
 *         write moves nothing. 200 `{ decision: 'allow', sourceId, moved:
 *         false }` (any moving decision) when the decision was saved but the
 *         consent could not be moved, with `code: 'consent_cookie_full'` when
 *         the cookie it would set passes 4,096 bytes and none is set (A2);
 *         `moved` is absent otherwise.
 *   GET   `{ routing, store }`, uncached: `routing` is this instance's
 *         `SOURCE_ROUTING` mode (`in-loop` or `all-sources`), so the Sources
 *         panel says a question may stop to ask only where one can (fix round
 *         1, item 1); `store` is whether the decision store pair
 *         (`KV_REST_API_URL` and `KV_REST_API_TOKEN`) is set, read from the
 *         variables' presence (R9 P1a, #681). A question with no source On
 *         runs only where both say the site can ask, and the guard in front
 *         of each question reads the two to apply the gate's rule. The mode
 *         is read through the leaf module, never `routing-mode.ts`; no
 *         session, no store call, no key.
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
  return Response.json({ routing: sourceRoutingMode(), store: decisionStoreFromEnv() !== null }, { headers: { 'Cache-Control': 'no-store' } });
}
