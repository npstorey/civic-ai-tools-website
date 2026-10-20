// Lifecycle dual-read orchestrator (spec §8.10, §8.10.4; ADR-0010).
//
// Resolves a content node's current lifecycle status (active / withdrawn) and
// its history, preferring the signed `attestation/*` chain when present and
// falling back to the legacy `withdrawnAt` / `reinstatedAt` DB columns for
// pre-PR3 records — the same dual-read shape as PR2's dual-chain hashing.
//
// This is the async, DB + Blob orchestration layer. The pure ordering /
// status-derivation / per-node verification logic lives in `verify.ts` so it is
// unit-testable; this module fetches the rows, fetches + verifies each signed
// attestation envelope, and hands the views to that pure logic. Shared by the
// verify route (check #10) and the detail page so both read lifecycle the same
// way.

import { db } from '@/lib/db';
import { attestationNodes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import { type SignerIdentity } from './signing.ts';
import { getConfiguredSignerIdentity } from '../site-config.ts';
import { errorLogFacts } from '../streaming.ts';
import {
  verifyAttestationNode,
  resolveLifecycleFromChain,
  resolveLifecycleFromLegacyColumns,
  type LifecycleResolution,
} from './verify.ts';
import { publishedLayoutNodeId, type RecordAttestationView } from './published-layout.ts';

/** The lifecycle-relevant columns this resolver reads from an evidence row. */
export interface LifecycleRecordColumns {
  basePackageHash: string | null;
  withdrawnAt: Date | null;
  withdrawnReason: string | null;
  reinstatedAt: Date | null;
  reinstatedReason: string | null;
}

type AttestationRow = typeof attestationNodes.$inferSelect;

/** A record's lifecycle, and the layout node its publication attestation names (or null). */
export interface RecordAttestations {
  lifecycle: LifecycleResolution;
  /** LAYOUT-WEB W4 P2: from a verified, signer-matched publishes attestation only (`published-layout.ts`). */
  publishedLayoutNodeId: string | null;
}

/**
 * Resolve a content node's lifecycle.
 *
 * @param record the evidence row's lifecycle columns + `basePackageHash`
 *   (the content node's nodeId, which attestations reference by `targetNodeId`).
 * @param targetSignerIdentifier the content node's `signer.identifier`, used for
 *   the publisher-only signer-match (§8.12.3). Defaults to the platform signer
 *   identity — correct today since the platform signs every package (§8.5).
 */
export async function resolveLifecycle(
  record: LifecycleRecordColumns,
  targetSignerIdentifier?: string,
): Promise<LifecycleResolution> {
  return (await resolveRecordAttestations(record, targetSignerIdentifier)).lifecycle;
}

/**
 * `resolveLifecycle`, and from the same rows and the same verified views, the
 * layout node id the record's publication attestation names (LAYOUT-WEB W4 P2).
 */
export async function resolveRecordAttestations(
  record: LifecycleRecordColumns,
  targetSignerIdentifier?: string,
): Promise<RecordAttestations> {
  const targetNodeId = record.basePackageHash;

  if (targetNodeId) {
    // Defensive: the attestation_nodes table is added by the PR3 migration,
    // which is run (user-supervised) BEFORE this code deploys. Should the
    // deploy-before-migration sequence ever be violated, this query would
    // fail; we swallow that one error and fall through to the legacy columns
    // so detail pages + verify keep working (degraded, not down) rather than
    // 500 site-wide. Any other query failure surfaces the same way.
    let rows: AttestationRow[] = [];
    try {
      rows = await db
        .select()
        .from(attestationNodes)
        .where(eq(attestationNodes.targetNodeId, targetNodeId));
    } catch (err) {
      console.warn(
        '[lifecycle] attestation_nodes query failed; falling back to legacy columns:',
        errorLogFacts(err),
      );
      rows = [];
    }

    if (rows.length > 0) {
      // Fallback signer for the §8.12.3 match when the package's own signer
      // is unavailable: the CONFIGURED platform identity, or — on an
      // instance that has declared none (#258) — no expectation at all, so
      // the match honestly reads false rather than crediting attestations to
      // a reference identity this instance never configured. The empty
      // string can never equal a real `signer.identifier`.
      const resolvedSigner =
        targetSignerIdentifier ??
        getConfiguredSignerIdentity()?.identifier ??
        '';
      const views = await Promise.all(
        rows.map((row) => buildAttestationView(row, resolvedSigner)),
      );
      return { lifecycle: resolveLifecycleFromChain(views), publishedLayoutNodeId: publishedLayoutNodeId(views) };
    }
  }

  // §8.10.4 backwards-compat: no attestation envelopes → legacy DB columns.
  const lifecycle = resolveLifecycleFromLegacyColumns({
    withdrawnAt: record.withdrawnAt?.toISOString() ?? null,
    withdrawnReason: record.withdrawnReason,
    reinstatedAt: record.reinstatedAt?.toISOString() ?? null,
    reinstatedReason: record.reinstatedReason,
  });
  return { lifecycle, publishedLayoutNodeId: null };
}

/**
 * Fetch one attestation's signed envelope, verify it independently, and build
 * the view. Rendered fields are sourced from the SIGNED node JSON when it can
 * be fetched (the values the signature covers), falling back to the row's
 * denormalized columns/payload if the blob is unavailable.
 */
async function buildAttestationView(
  row: AttestationRow,
  resolvedSigner: string,
): Promise<RecordAttestationView> {
  const node = (await getPackage(row.storageKey).catch(() => null)) as Record<
    string,
    unknown
  > | null;

  let sigEnvelope: { signature?: string; publicKey?: string } | null = null;
  if (row.signature) {
    try {
      sigEnvelope = JSON.parse(row.signature);
    } catch {
      sigEnvelope = null;
    }
  }

  const verdict = node
    ? verifyAttestationNode(node, row.nodeId, sigEnvelope)
    : { nodeId: row.nodeId, nodeIdMatches: false, signatureValid: null };

  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const metadata = (node?.metadata ?? {}) as Record<string, unknown>;
  const signer = (node?.signer ?? row.signer ?? undefined) as
    | SignerIdentity
    | undefined;

  // Prefer signed-node values; fall back to the denormalized row payload.
  const reason =
    pickString(node?.reason) ?? pickString(payload.reason) ?? undefined;
  const effectiveAt =
    pickString(node?.effectiveAt) ?? pickString(payload.effectiveAt) ?? undefined;
  const priorWithdrawalNodeId =
    pickString(node?.priorWithdrawalNodeId) ??
    pickString(payload.priorWithdrawalNodeId) ??
    undefined;
  const createdAt =
    pickString(metadata.createdAt) ?? row.createdAt.toISOString();
  // LAYOUT-WEB W4 P2: the layout a publication attestation names.
  const layoutNodeId =
    row.type === 'attestation/publishes/v1'
      ? pickString(node?.layoutNodeId) ?? pickString(payload.layoutNodeId)
      : undefined;

  return {
    nodeId: row.nodeId,
    type: row.type,
    signer,
    createdAt,
    reason,
    effectiveAt,
    priorWithdrawalNodeId,
    signatureValid: verdict.signatureValid,
    nodeIdMatches: verdict.nodeIdMatches,
    hasTimestamp: !!row.rfc3161Timestamp,
    hasRekor: !!row.rekorEntryId,
    signerMatchesTarget: !!signer && signer.identifier === resolvedSigner,
    ...(layoutNodeId !== undefined ? { layoutNodeId } : {}),
  };
}

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** A signed lifecycle attestation carried in the commitment/bundle so an independent
 *  verifier resolves #10 OFFLINE — verify-core's `verifyLifecycleChain` shape
 *  (civic-ai-tools-website#119 P3). All public: the signed node envelope + its public
 *  signature (no private key, no internal DB ids). */
export interface CarriedLifecycleAttestation {
  node: Record<string, unknown>;
  nodeId: string;
  signature: { signature?: string; publicKey?: string; algorithm?: string } | null;
  hasTimestamp: boolean;
  hasRekor: boolean;
}

/**
 * Load the signed lifecycle attestation envelopes targeting a content node, for
 * CARRYING (not resolving) in the commitment/bundle. Each is the signed node JSON
 * (from blob) + its stored nodeId + signature, so an offline verifier can recompute
 * the envelope hash, check the signature, and resolve the chain itself — no
 * reference-implementation dependency. A node whose blob can't be fetched is skipped
 * (it can't be carried as a self-contained envelope). Returns [] on any query error
 * (same degrade-not-down posture as `resolveLifecycle`).
 */
export async function loadCarriedLifecycleAttestations(
  targetNodeId: string,
): Promise<CarriedLifecycleAttestation[]> {
  let rows: AttestationRow[] = [];
  try {
    rows = await db
      .select()
      .from(attestationNodes)
      .where(eq(attestationNodes.targetNodeId, targetNodeId));
  } catch {
    return [];
  }

  const carried: CarriedLifecycleAttestation[] = [];
  for (const row of rows) {
    const node = (await getPackage(row.storageKey).catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!node) continue;
    let signature: CarriedLifecycleAttestation['signature'] = null;
    if (row.signature) {
      try {
        signature = JSON.parse(row.signature);
      } catch {
        signature = null;
      }
    }
    carried.push({
      node,
      nodeId: row.nodeId,
      signature,
      hasTimestamp: !!row.rfc3161Timestamp,
      hasRekor: !!row.rekorEntryId,
    });
  }
  return carried;
}
