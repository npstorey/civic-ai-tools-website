import { evidenceRecords, users } from '../db/schema.ts';
import type { EvidencePackage } from './packager.ts';

/**
 * Proof sidecar ("commitment view") builder — spec §9.2.1.
 *
 * Extracted from `src/app/api/evidence/[slug]/bundle/route.ts` (WS1 of
 * civic-ai-tools-website#116) so the same self-describing proof object is
 * produced by two surfaces:
 *
 *   1. the notebook-embedded bundle (`/api/evidence/[slug]/bundle`), where it
 *      lives under the notebook root's `org.civicaitools.evidence` namespace;
 *   2. the public, hash-addressable commitment endpoint
 *      (`/api/evidence/[hash|slug]/commitment`), which returns it directly so a
 *      third party can resolve a package's proofs and verify INDEPENDENTLY
 *      (client-side, against public infra) rather than trusting a
 *      civicaitools.org-rendered verdict.
 *
 * The view is self-describing: it carries `packageUrl` (the canonical blob) and
 * `trustRegistryUrl` (the publisher's key registry), so a `hash → commitment`
 * lookup bootstraps the entire §9.2 verification without any further knowledge
 * of civicaitools.org's internals.
 *
 * Every field here is intended-public (see the security audit in the WS1 PR and
 * `docs/api/evidence-commitment.md`): package hash, blob URL, the signature
 * envelope (signature/publicKey/algorithm/kid — all public; no private key
 * material), the public-log proofs (RFC 3161 token, Rekor entry + inclusion
 * proof), the signed envelope claims (signer/type/producerProfile/contentHash),
 * the creator's PUBLIC GitHub identity, and the public title/summary. It emits
 * NO email, NO internal DB UUIDs, and NO private columns (prompt text, etc.).
 */

type EvidenceRecord = typeof evidenceRecords.$inferSelect;
type UserRecord = typeof users.$inferSelect;

/**
 * Canonical trust-registry path (spec §8.3.3, ADR-0012 §3). New external
 * clients SHOULD resolve the publisher's keys from this path. Served
 * byte-identical to the legacy path below (parallel-serve).
 */
export const CANONICAL_TRUST_REGISTRY_URL =
  'https://civicaitools.org/.well-known/typed-publisher.json';

/**
 * Legacy trust-registry path (pre-ADR-0012). Served indefinitely, byte-identical
 * to the canonical path; emitted alongside the canonical URL so existing clients
 * that only know the legacy path keep resolving.
 */
export const LEGACY_TRUST_REGISTRY_URL =
  'https://civicaitools.org/.well-known/evidence-public-keys.json';

/**
 * Current lifecycle state of the content node, surfaced alongside the proofs so
 * an independent verifier can render "this package was withdrawn" without a
 * separate lookup. A withdrawn package's base signature still verifies
 * (withdrawal is a separate, separately-signed action) — the proofs are served
 * regardless; this is informational state.
 *
 * Derived directly from the evidence row's legacy lifecycle columns, which the
 * withdraw / reinstate routes dual-write alongside the signed `attestation/*`
 * node — so these columns track the signed lifecycle and don't go stale. The
 * same columns are already public via `/api/evidence/list` (withdrawnAt /
 * reinstatedAt) and the detail page (+ reasons). Independent verification of the
 * signed lifecycle attestation chain itself is WS2 / civic-ai-tools-website#119.
 */
export interface CommitmentLifecycle {
  status: 'active' | 'withdrawn';
  withdrawnAt?: string;
  withdrawnReason?: string;
  reinstatedAt?: string;
  reinstatedReason?: string;
}

/**
 * Build the §9.2.1 lifecycle summary from a record's legacy columns, or null
 * when the package has no lifecycle history (never withdrawn) — in which case
 * the commitment view omits the `lifecycle` field entirely.
 *
 * "Currently withdrawn" mirrors the `/api/evidence/list` predicate exactly:
 * withdrawn iff `withdrawnAt` is set and `reinstatedAt` is not. A reinstated
 * package reads `active` but carries its withdrawal/reinstatement history.
 */
export function buildCommitmentLifecycle(
  record: Pick<
    EvidenceRecord,
    'withdrawnAt' | 'withdrawnReason' | 'reinstatedAt' | 'reinstatedReason'
  >,
): CommitmentLifecycle | null {
  if (!record.withdrawnAt) return null;

  const status: CommitmentLifecycle['status'] = record.reinstatedAt
    ? 'active'
    : 'withdrawn';

  return {
    status,
    withdrawnAt: record.withdrawnAt.toISOString(),
    ...(record.withdrawnReason ? { withdrawnReason: record.withdrawnReason } : {}),
    ...(record.reinstatedAt ? { reinstatedAt: record.reinstatedAt.toISOString() } : {}),
    ...(record.reinstatedReason
      ? { reinstatedReason: record.reinstatedReason }
      : {}),
  };
}

/**
 * Build the spec §9.2.1 commitment view from the evidence record + creator + the
 * signed package JSON. Optional fields (envelope taxonomy, canonicalization,
 * RFC 3161 timestamp, Rekor entry/proof, lifecycle) are conditionally spread so
 * absent values don't appear as `null` in the serialized output.
 *
 * `pkg` is the canonical package JSON fetched from the blob. It carries the
 * signed envelope fields (`producerProfile`, `type`, `signer`, `contentHash`,
 * `contentCanonicalization`) that aren't on the DB row. It is nullable: the
 * commitment endpoint degrades gracefully if the blob can't be fetched —
 * envelope fields are omitted, but the DB-sourced proofs (hash, signature,
 * timestamp, Rekor) are still served, and a verifier re-derives the envelope
 * fields from the package it fetches itself via `packageUrl`.
 */
export function buildCommitmentView(
  record: EvidenceRecord,
  creator: UserRecord | null,
  pkg: EvidencePackage | null,
): Record<string, unknown> {
  let signature: Record<string, unknown> | null = null;
  if (record.basePackageSignature) {
    try {
      // The parsed object is `{signature, publicKey, algorithm, kid}`. It is
      // carried VERBATIM: `algorithm` is load-bearing — an independent
      // verify-core MUST dispatch ed25519 vs ed25519ph on it (the #111 fix),
      // and `kid` is the trust-registry lookup handle. Both may be absent on
      // packages signed via a pre-kid / plain-Ed25519 path; carried as-is.
      signature = JSON.parse(record.basePackageSignature);
    } catch {
      signature = null;
    }
  }

  // The creator's PUBLIC GitHub identity (informational). `providerId` is the
  // GitHub user id (`token.sub` from the OAuth profile), NOT the internal DB
  // UUID. Distinct from the envelope-side `pkg.signer` claim (§8.5), which is
  // the subject of verify check #14; a verifier must treat `pkg.signer.
  // identifier` as the check-#14 subject, not this GitHub identity.
  const signerIdentity = creator
    ? {
        provider: 'github',
        providerId: creator.githubId,
        displayName: creator.displayName,
        profileUrl: creator.githubProfileUrl,
      }
    : null;

  const lifecycle = buildCommitmentLifecycle(record);

  return {
    evidenceProtocolVersion: '0.1.0',
    packageHash: record.basePackageHash,
    packageUrl: record.basePackageStorageKey,
    captureMethod: record.captureMethod ?? null,
    // Generalized for all packages (WS1): sourced from the row, not hardcoded
    // 'datHere'. Absent column ⇒ 'default' (legacy / default content shape).
    contentProfile: record.contentProfile ?? 'default',
    // Envelope fields sourced from the signed package JSON (spec §8.1.1).
    // Conditionally spread so packages predating these fields (or a missing
    // blob) omit them rather than emitting nulls. `producerProfile` / `type` /
    // `signer` are the PR1 taxonomy fields; `contentHash` /
    // `contentCanonicalization` are the PR2 §8.2 canonicalization fields. All
    // are covered by the package signature, so surfacing them lets a cross-host
    // reader resolve the same envelope the signature commits to.
    ...(pkg?.producerProfile ? { producerProfile: pkg.producerProfile } : {}),
    ...(pkg?.type ? { type: pkg.type } : {}),
    ...(pkg?.signer ? { signer: pkg.signer } : {}),
    ...(pkg?.contentHash ? { contentHash: pkg.contentHash } : {}),
    ...(pkg?.contentCanonicalization
      ? { contentCanonicalization: pkg.contentCanonicalization }
      : {}),
    ...(signature ? { signature } : {}),
    ...(signerIdentity ? { signerIdentity } : {}),
    ...(record.basePackageRfc3161Timestamp
      ? { rfc3161Timestamp: record.basePackageRfc3161Timestamp }
      : {}),
    ...(record.basePackageRekorEntryId
      ? { rekorEntryId: record.basePackageRekorEntryId }
      : {}),
    ...(record.basePackageRekorInclusionProof
      ? { rekorInclusionProof: record.basePackageRekorInclusionProof }
      : {}),
    ...(lifecycle ? { lifecycle } : {}),
    // Canonical path (ADR-0012); new clients SHOULD use this. `…Legacy` is the
    // byte-identical pre-ADR-0012 path, emitted alongside for older clients.
    trustRegistryUrl: CANONICAL_TRUST_REGISTRY_URL,
    trustRegistryUrlLegacy: LEGACY_TRUST_REGISTRY_URL,
    subjectTitle: record.title,
    subjectSummary: record.summary,
  };
}
