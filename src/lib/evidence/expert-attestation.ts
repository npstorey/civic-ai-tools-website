// Validation + canonicalisation helpers for the `expert_attestation` type
// (issue #53). A human domain expert submits a free-text signed review on
// an evidence package; these helpers enforce the payload shape so the
// route handler and the Drizzle row stay in lock-step.
//
// AICPA has formal attestation-engagement standards (SSAE) in the
// accounting world. This implementation uses "attestation" in the broader
// signed-claim sense (cryptographic attestation, hardware attestation) and
// is not bound by SSAE — but if future financial-auditor integrations
// matter, the precise meaning becomes load-bearing.

export const EXPERT_RATINGS = ['endorse', 'concerns', 'dispute', 'neutral'] as const;
export type ExpertRating = (typeof EXPERT_RATINGS)[number];

export const EXPERT_BODY_MAX_CHARS = 10_000;
export const EXPERT_EXPERTISE_MAX_CHARS = 300;

export interface ExpertAttestationInput {
  body: string;
  expertise: string;
  rating: ExpertRating;
}

export type ExpertAttestationValidation =
  | { ok: true; value: ExpertAttestationInput }
  | { ok: false; error: string };

/**
 * Validate a raw request body for an `expert_attestation` submission.
 * Trims whitespace and rejects empty or over-long fields. The rating axis
 * is intentionally fixed (endorse / concerns / dispute / neutral) so
 * downstream aggregations don't have to deal with a long tail of
 * synonyms — changing this set is a breaking client change.
 */
export function validateExpertAttestation(data: unknown): ExpertAttestationValidation {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Attestation data required' };
  }
  const raw = data as Record<string, unknown>;

  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!body) return { ok: false, error: 'body is required' };
  if (body.length > EXPERT_BODY_MAX_CHARS) {
    return { ok: false, error: `body exceeds ${EXPERT_BODY_MAX_CHARS} characters` };
  }

  const expertise = typeof raw.expertise === 'string' ? raw.expertise.trim() : '';
  if (!expertise) return { ok: false, error: 'expertise is required' };
  if (expertise.length > EXPERT_EXPERTISE_MAX_CHARS) {
    return { ok: false, error: `expertise exceeds ${EXPERT_EXPERTISE_MAX_CHARS} characters` };
  }

  const rating = raw.rating;
  if (typeof rating !== 'string' || !EXPERT_RATINGS.includes(rating as ExpertRating)) {
    return { ok: false, error: `rating must be one of: ${EXPERT_RATINGS.join(', ')}` };
  }

  return { ok: true, value: { body, expertise, rating: rating as ExpertRating } };
}

export interface ExpertAttester {
  dbUserId: string;
  githubId: string;
  displayName: string;
  githubProfileUrl: string;
}

/**
 * Build the canonical attestation package body that gets stored in Blob
 * and whose JSON is hashed + signed. The attester identity is snapshotted
 * into the payload so a verifier doesn't need to re-query the users table
 * to interpret the attestation in isolation.
 */
export function buildExpertAttestationPayload(
  input: ExpertAttestationInput,
  attester: ExpertAttester,
  evidenceBaseHash: string | null,
  createdAt: string,
): Record<string, unknown> {
  return {
    schemaVersion: '0.1.0',
    type: 'expert_attestation',
    evidenceBaseHash,
    createdAt,
    attesterUserId: attester.dbUserId,
    attesterGithubId: attester.githubId,
    attesterDisplayName: attester.displayName,
    attesterGithubProfileUrl: attester.githubProfileUrl,
    body: input.body,
    expertise: input.expertise,
    rating: input.rating,
  };
}
