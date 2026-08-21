import { evidenceRecords, users } from '../db/schema.ts';
import type { EvidencePackage } from './packager.ts';
import type { CarriedLifecycleAttestation } from './lifecycle.ts';
import {
  buildCommitmentView as buildCommitmentViewCore,
  type CommitmentLifecycle,
} from '@typedstandards/produce-core';
import { getSidecarTrustRegistryUrls } from '../site-config.ts';
import { fromDbValue } from './visibility.ts';

/**
 * Proof sidecar ("commitment view") builder — spec §8.8.1.
 *
 * As of S3a P2 (#166) the neutral §8.8.1 sidecar ASSEMBLY lives in
 * @typedstandards/produce-core (`buildCommitmentView` there takes every proof
 * field as caller-supplied data, with `trustRegistryUrl` as REQUIRED
 * per-publisher configuration — never a core constant). What stays HERE is
 * the implementation-side adapter (ADR-0021 §B): mapping the evidence DB row
 * + creator row onto the neutral input, parsing the stored signature JSON,
 * deriving the lifecycle summary from the row's columns, the SEALED-record
 * redaction decision, and resolving THIS instance's trust-registry URLs from
 * config (ADR-0020 — see `src/lib/site-config.ts`).
 *
 * Originally extracted from `src/app/api/evidence/[slug]/bundle/route.ts`
 * (WS1 of civic-ai-tools-website#116) so the same self-describing proof
 * object is produced by two surfaces:
 *
 *   1. the notebook-embedded bundle (`/api/records/[slug]/bundle`), where it
 *      lives under the notebook root's commitment-view namespace (dual-era —
 *      see `COMMITMENT_NAMESPACE_KEY` below);
 *   2. the public, hash-addressable commitment endpoint
 *      (`/api/records/[hash|slug]/commitment`), which returns it directly so a
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
 * proof + the entry's public canonical body), the signed lifecycle attestation
 * chain (public signed envelopes + signatures), the signed envelope claims
 * (signer/type/producerProfile/contentHash),
 * the creator's PUBLIC GitHub identity, and the public title/summary. It emits
 * NO email, NO internal DB UUIDs, and NO private columns (prompt text, etc.).
 */

type EvidenceRecord = typeof evidenceRecords.$inferSelect;
type UserRecord = typeof users.$inferSelect;

/**
 * Reverse-DNS namespace the commitment view is carried under inside a
 * notebook-embedded bundle (spec §8.8.2).
 *
 * DUAL-ERA, accepted forever — settlement ruling D3 (spec Appendix J §J.3),
 * taken deliberately against the default alias-and-deprecate recommendation.
 * The two constants are NOT a deprecation window:
 *
 *   - `COMMITMENT_NAMESPACE_KEY` is what new bundles MINT.
 *   - `COMMITMENT_NAMESPACE_KEY_PRIOR_ERA` is what bundles exported before the
 *     2026-08-19 cutover carry. Those files are already on readers' disks and
 *     inside published notebooks; they are never rewritten, and acceptance of
 *     the prior-era key has no end date.
 *
 * Read through `readCommitmentNamespace` rather than indexing either constant
 * directly, so the preference rule (§8.8.2: prefer the settlement-era key when
 * both are present) has exactly one implementation.
 *
 * Related namespaces (`org.civicaitools.notebook` / `.environment` /
 * `.execution` / `.summary`) carry no excised word and are unaffected.
 */
export const COMMITMENT_NAMESPACE_KEY = 'org.civicaitools.record';

/** @see COMMITMENT_NAMESPACE_KEY — the pre-cutover spelling, accepted forever. */
export const COMMITMENT_NAMESPACE_KEY_PRIOR_ERA = 'org.civicaitools.evidence';

/**
 * Resolve the commitment view out of a notebook's root `metadata`, reading
 * BOTH eras and preferring the settlement-era key when both are present
 * (spec §8.8.2 / Appendix J rule J.4.2 — era is not a trust signal).
 *
 * Returns `null` when neither key is present, so a caller can distinguish
 * "not a bundle" from "a bundle whose view is empty".
 */
export function readCommitmentNamespace(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const settlementEra = metadata[COMMITMENT_NAMESPACE_KEY];
  if (settlementEra && typeof settlementEra === 'object') {
    return settlementEra as Record<string, unknown>;
  }
  const priorEra = metadata[COMMITMENT_NAMESPACE_KEY_PRIOR_ERA];
  if (priorEra && typeof priorEra === 'object') {
    return priorEra as Record<string, unknown>;
  }
  return null;
}

// The trust-registry URLs are resolved per-instance via
// `getSidecarTrustRegistryUrls()` (ADR-0020) — canonical path (spec §8.3.3,
// ADR-0012 §3) plus the parallel-served legacy path. As of #258 there are no
// exported reference-deployment URL constants here: an unconfigured instance
// REFUSES to build a sidecar (the getter throws `InstanceIdentityError`;
// serving routes translate that into an `instance_identity_missing` refusal)
// rather than emit proofs pointing at a registry that lacks its key. The
// reference values live in `reference-identity-fixture.ts`, injected as env
// by the byte-parity tests only.

/**
 * Current lifecycle state of the content node, surfaced alongside the proofs so
 * an independent verifier can render "this package was withdrawn" without a
 * separate lookup. A withdrawn package's base signature still verifies
 * (withdrawal is a separate, separately-signed action) — the proofs are served
 * regardless; this is informational state. Type re-exported from produce-core
 * (structurally identical to the historical local interface).
 *
 * Derived directly from the evidence row's legacy lifecycle columns, which the
 * withdraw / reinstate routes dual-write alongside the signed `attestation/*`
 * node — so these columns track the signed lifecycle and don't go stale. The
 * same columns are already public via `/api/evidence/list` (withdrawnAt /
 * reinstatedAt) and the detail page (+ reasons). Independent verification of the
 * signed lifecycle attestation chain itself is WS2 / civic-ai-tools-website#119.
 */
export type { CommitmentLifecycle };

/**
 * Build the §8.8.1 lifecycle summary from a record's legacy columns, or null
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
 * Build the spec §8.8.1 commitment view from the evidence record + creator + the
 * signed package JSON. Optional fields (envelope taxonomy, canonicalization,
 * RFC 3161 timestamp, Rekor entry/proof, lifecycle) are conditionally spread so
 * absent values don't appear as `null` in the serialized output — the
 * conditional-emission rules live in produce-core's neutral builder; this
 * adapter supplies the row-derived values.
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
  /** Signed lifecycle attestation envelopes (from `loadCarriedLifecycleAttestations`),
   *  carried so an independent verifier resolves #10 OFFLINE via verify-core's
   *  `verifyLifecycleChain` — no reference-impl dependency (#119 P3). Omitted when the
   *  package has no signed lifecycle chain (it then stays at STATE / legacy columns). */
  lifecycleAttestations?: CarriedLifecycleAttestation[],
  /** SEALED-record redaction (civic-ai-tools#71, ADR-0010 §5): the commitment
   *  is public by design (the hash is already on the transparency log), but the
   *  content's location and content-derived strings are not. When set, the view
   *  omits `packageUrl` (the non-derivable capability URL must not be disclosed),
   *  `subjectTitle`, and `subjectSummary`, and carries `visibility: "sealed"`
   *  so verifiers can render the zero-location state honestly. Proof-side fields
   *  (hash, signature, signer, envelope taxonomy, timestamps, Rekor, lifecycle)
   *  are served unredacted — they ARE the commitment. */
  opts?: { redactContentSurface?: boolean },
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

  // Per-instance trust-registry URLs (ADR-0020). Throws when this instance
  // has not declared its identity (#258) — the serving routes translate that
  // into an `instance_identity_missing` refusal.
  const registry = getSidecarTrustRegistryUrls();

  return buildCommitmentViewCore({
    // Cast: the column is nullable in the schema; the historical view emitted
    // the raw column value verbatim (`"packageHash": null` on a hashless
    // row), and the pass-through preserves that.
    packageHash: record.basePackageHash as unknown as string,
    // The sealed-mode storage key is a non-derivable capability URL; the
    // core never emits it on a redacted view (Phase 2 hard requirement). The
    // cast preserves the historical pass-through of a null column.
    packageUrl: record.basePackageStorageKey as unknown as string | undefined,
    // Visibility state (ADR-0010): lets a verifier render "sealed — content
    // not publicly located" instead of treating a missing packageUrl as an
    // error. (The core now REFUSES an absent value rather than defaulting it
    // — see ADR-0024; the column is `NOT NULL`, so the `: undefined` branch is
    // unreachable from this adapter and would throw if it ever were reached.)
    //
    // SERVED CANONICAL (ADR-0016 §A, P2). The row's raw label is normalized
    // through the vocabulary boundary before it is emitted, so a historical row
    // still holding `committed` serves `sealed` and one holding `published`
    // serves `public`. This is the chartered externally-visible change of the
    // flip phase: the commitment view is the offline-bundle surface, and a
    // third-party verifier reading it must see ONE vocabulary regardless of
    // which spelling the row happens to carry — otherwise the same record read
    // before and after the M2 backfill would appear to change state.
    visibility: record.visibility ? fromDbValue(record.visibility) : undefined,
    captureMethod: record.captureMethod,
    // Generalized for all packages (WS1): sourced from the row, not hardcoded
    // 'datHere'. The core defaults an absent column to 'default' (legacy /
    // default content shape).
    contentProfile: record.contentProfile,
    // Envelope fields sourced from the signed package JSON (spec §8.1.1),
    // conditionally spread by the core so packages predating these fields (or
    // a missing blob) omit them rather than emitting nulls. All are covered by
    // the package signature, so surfacing them lets a cross-host reader
    // resolve the same envelope the signature commits to.
    producerProfile: pkg?.producerProfile,
    type: pkg?.type,
    signer: pkg?.signer,
    contentHash: pkg?.contentHash,
    contentCanonicalization: pkg?.contentCanonicalization,
    signature,
    signerIdentity,
    rfc3161Timestamp: record.basePackageRfc3161Timestamp ?? undefined,
    rekorEntryId: record.basePackageRekorEntryId ?? undefined,
    rekorInclusionProof: record.basePackageRekorInclusionProof ?? undefined,
    // The Rekor entry's canonical leaf bytes (base64), carried so a verifier
    // can recompute the RFC 6962 leaf and verify Merkle inclusion OFFLINE
    // against the carried proof + checkpoint — no re-fetch (#119 P1 / D2).
    rekorEntryBody: record.basePackageRekorEntryBody ?? undefined,
    lifecycle,
    // The signed lifecycle attestation chain (#119 P3), carried so an
    // independent verifier resolves #10 offline. Omitted when there is no
    // signed chain — the verifier then resolves lifecycle at STATE depth.
    lifecycleAttestations,
    // Canonical path (ADR-0012); new clients SHOULD use this. `…Legacy` is the
    // byte-identical parallel-served path, emitted alongside for older clients
    // (omittable per-instance via config).
    trustRegistryUrl: registry.canonical,
    trustRegistryUrlLegacy: registry.legacy,
    // Title and summary are content-derived (titles are typically the user's
    // question verbatim) — redacted for sealed records.
    subjectTitle: record.title,
    subjectSummary: record.summary,
    redactContentSurface: opts?.redactContentSurface,
  });
}
