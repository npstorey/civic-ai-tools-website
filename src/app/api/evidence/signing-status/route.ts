import { NextResponse } from 'next/server';
import { evaluateSealCommitGate } from '@/lib/evidence/unsigned-tier';
import { isSealOnly } from '@/lib/site-config';

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
 * declared `PUBLISHER_KEY_ID`, and the declared instance-identity set. A
 * partially-configured instance answers `false` here, same as one with no
 * key at all — it is not a partial success, and the client must not offer
 * an action the server will refuse. Which piece is missing is
 * operator-facing detail and stays on the site-wide banner and in the
 * server's refusal, not in this client-facing boolean.
 *
 * `sealOnly` (#552) is the second boolean: whether this instance seals
 * records only (`SITE_SEAL_ONLY`), so the dialog shows its public choice
 * unavailable, with the reason, instead of offering a state both publish
 * routes refuse.
 *
 * SECRET HYGIENE: presence-only. This endpoint never reads any value
 * beyond non-emptiness (and, for `sealOnly`, the on/off parse of a
 * non-secret switch) and returns two booleans. Neither is a secret — the
 * same facts are disclosed by the running-unsigned banner and by every gate
 * refusal.
 */
export async function GET() {
  return NextResponse.json({
    signingConfigured: evaluateSealCommitGate() === null,
    sealOnly: isSealOnly(),
  });
}
