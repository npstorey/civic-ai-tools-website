import { NextResponse } from 'next/server';
import { isSigningConfigured } from '@/lib/evidence/unsigned-tier';

/**
 * GET /api/evidence/signing-status
 *
 * Producer-tier disclosure for client surfaces (S3a P3, #166; ADR-0020):
 * whether this instance holds a signing key — i.e. whether the seal/commit
 * actions are reachable. Client components (the publish dialog) cannot read
 * server env, so they ask here and render the gate-off affordance (disabled
 * action + explanation) instead of a dead button that errors.
 *
 * SECRET HYGIENE: presence-only. This endpoint never reads the key's value
 * beyond non-emptiness and returns a single boolean. The tier is not a
 * secret — the same fact is disclosed by the running-unsigned banner and by
 * every gate refusal.
 */
export async function GET() {
  return NextResponse.json({ signingConfigured: isSigningConfigured() });
}
