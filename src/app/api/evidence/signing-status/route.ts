import { NextResponse } from 'next/server';
import { evaluateSealCommitGate } from '@/lib/evidence/unsigned-tier';

/**
 * GET /api/evidence/signing-status
 *
 * Producer-tier disclosure for client surfaces (S3a P3, #166; ADR-0020):
 * whether this instance can sign — i.e. whether the seal/commit actions are
 * reachable. Client components (the publish dialog) cannot read server env,
 * so they ask here and render the gate-off affordance (disabled action +
 * explanation) instead of a dead button that errors.
 *
 * "Can sign" means the WHOLE seal/commit gate passes (#258): key custody, a
 * declared `EVIDENCE_KEY_ID`, and the declared instance-identity set. A
 * partially-configured instance answers `false` here, same as one with no
 * key at all — it is not a partial success, and the client must not offer
 * an action the server will refuse. Which piece is missing is
 * operator-facing detail and stays on the site-wide banner and in the
 * server's refusal, not in this client-facing boolean.
 *
 * SECRET HYGIENE: presence-only. This endpoint never reads any value
 * beyond non-emptiness and returns a single boolean. The tier is not a
 * secret — the same fact is disclosed by the running-unsigned banner and by
 * every gate refusal.
 */
export async function GET() {
  return NextResponse.json({ signingConfigured: evaluateSealCommitGate() === null });
}
