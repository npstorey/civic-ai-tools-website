import { buildFlowsStatement, serializeFlowsStatement } from '@/lib/flows/statement';

/**
 * GET /api/flows — the flows statement in force (R6 W2, #632 D7 = A).
 *
 * Where a question on this instance can go: every recipient by role and host
 * or where it runs, what each receives, what each holder says it keeps (with
 * the statement's address and read date, or "not stated"), each configured
 * source's hosting variant and posture, and the links. Derived from this
 * instance's configuration and code when asked; nothing here calls a source
 * or any other host. `/api/*` serves on every host (`src/lib/host-routing.ts`).
 *
 * The body is the statement's RFC 8785 canonical JSON, so the SHA-256 of the
 * bytes served is the `hash` a record carries for it and the flows version a
 * consent refers to. It sets no cookie.
 */
export async function GET(): Promise<Response> {
  const statement = await buildFlowsStatement();
  return new Response(serializeFlowsStatement(statement), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
