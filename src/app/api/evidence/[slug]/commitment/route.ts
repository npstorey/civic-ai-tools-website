import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords, users } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import type { EvidencePackage } from '@/lib/evidence/packager';
import { buildCommitmentView } from '@/lib/evidence/commitment';
import { loadTrustRegistry } from '@/lib/evidence/verify';
import { loadCarriedLifecycleAttestations } from '@/lib/evidence/lifecycle';

/**
 * GET /api/evidence/[hash|slug]/commitment
 *
 * Public, unauthenticated proof sidecar (spec §9.2.1) — the WS1 "unlock" of
 * civic-ai-tools-website#116. Returns the §9.2.1 commitment view for a package
 * so a third party can resolve its proofs and verify INDEPENDENTLY (client-side,
 * against public infra) instead of trusting a civicaitools.org-rendered verdict.
 * The view is self-describing (carries `packageUrl` + `trustRegistryUrl`), so a
 * single `hash → commitment` lookup bootstraps the whole verification.
 *
 * The `[slug]` path segment accepts EITHER:
 *   - a 64-hex base-package hash (`/api/evidence/<hash>/commitment`), or
 *   - an evidence slug (`/api/evidence/<slug>/commitment`).
 *
 * Hash → row ambiguity: re-publishing the same package under a different title
 * creates a second row with the same `basePackageHash` (identical immutable
 * blob, possibly a separate signing run). Since the signature is over the hash,
 * ANY matching row's proofs verify — the hash form returns the CANONICAL (first /
 * oldest-created) matching row. The slug form is unambiguous (slug is unique).
 *
 * Withdrawn packages ARE served (not 404'd): a withdrawn package's base
 * signature still verifies — withdrawal is a separate, separately-signed action.
 * The view carries the lifecycle/withdrawal state alongside the proofs.
 *
 * CORS: open (`Access-Control-Allow-Origin: *`). The proofs are public,
 * read-only, and credential-free, and the verifier is forkable / anyone-can-run
 * (ADR-0013 / Q47) — so the endpoint is open, not restricted to typedstandards
 * .org. The package blob (Vercel Blob) and the `/.well-known/*` trust registry
 * the view points at are already CORS-open, so a cross-origin verifier can fetch
 * all three.
 *
 * Pure DB read + JSON.parse for the proofs (signature, RFC 3161 token, Rekor
 * entry + inclusion proof are all persisted on `evidence_records`); the canonical
 * package blob is additionally fetched best-effort to surface the signed envelope
 * fields (`signer`, `type`, `producerProfile`, `contentHash`,
 * `contentCanonicalization`). No live Rekor / TSA call.
 *
 * Self-contained bundle (`?inline=1`): opt-in, the response additionally INLINES the
 * full package JSON (`package`) and the stamped trust registry (`trustRegistry`) so
 * the commitment verifies with ZERO network — the client-side verifier reaches
 * `fullyOffline` (package inline + registry inline; the RFC 3161 token, Rekor entry
 * body + inclusion proof, and lifecycle chain are already inline). The DEFAULT (no
 * flag) is unchanged — the lightweight URL sidecar — so the online verify path is not
 * bloated. Pass `?inline` / `?inline=1` / `?inline=true`; `?inline=0` / `=false` are
 * off. (#119 Q15a)
 */

// A base-package hash is the hex SHA-256 of the canonical envelope: 64 hex chars.
const HASH_RE = /^[0-9a-f]{64}$/i;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body as Record<string, unknown>, {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: identifier } = await params;

  // Resolve the row by hash (canonical/first match) or by slug (unambiguous).
  const records = HASH_RE.test(identifier)
    ? await db
        .select()
        .from(evidenceRecords)
        .where(eq(evidenceRecords.basePackageHash, identifier))
        .orderBy(asc(evidenceRecords.createdAt))
        .limit(1)
    : await db
        .select()
        .from(evidenceRecords)
        .where(eq(evidenceRecords.slug, identifier))
        .limit(1);

  if (records.length === 0) {
    return jsonResponse({ error: 'Evidence not found' }, 404);
  }
  const record = records[0];

  // A row with no base-package hash never completed publishing — there are no
  // proofs to commit to. Treat as not found (nothing to verify).
  if (!record.basePackageHash) {
    return jsonResponse(
      { error: 'No published evidence package for this identifier' },
      404,
    );
  }

  // Non-public records are not exposed (mirrors the existing read-back; the
  // public flag is independent of withdrawal — withdrawn-but-public is served).
  if (!record.isPublic) {
    return jsonResponse({ error: 'Evidence not found' }, 404);
  }

  const creators = await db
    .select()
    .from(users)
    .where(eq(users.id, record.creatorId))
    .limit(1);
  const creator = creators[0] ?? null;

  // Best-effort fetch of the canonical package blob for the signed envelope
  // fields (signer/type/producerProfile/contentHash/contentCanonicalization).
  // If the blob can't be fetched, the commitment still serves the DB-sourced
  // proofs (hash, signature, timestamp, Rekor) and `packageUrl`; an independent
  // verifier re-derives the envelope fields from the package it fetches itself.
  let pkg: EvidencePackage | null = null;
  if (record.basePackageStorageKey) {
    try {
      pkg = (await getPackage(record.basePackageStorageKey)) as
        | EvidencePackage
        | null;
    } catch {
      pkg = null;
    }
  }

  // Carry the signed lifecycle attestation chain (#119 P3) so an independent
  // verifier resolves #10 offline. Empty for packages with no signed chain.
  const lifecycleAttestations = record.basePackageHash
    ? await loadCarriedLifecycleAttestations(record.basePackageHash)
    : [];

  // Committed records (civic-ai-tools#71, ADR-0010 §5): the commitment IS
  // public — the hash is already on the transparency log — but the content
  // surface is not. Serve the view redacted of the capability URL, title, and
  // summary; never inline the package.
  const isCommitted = record.visibility === 'committed';
  const commitment = buildCommitmentView(record, creator, pkg, lifecycleAttestations, {
    redactContentSurface: isCommitted,
  });

  // `?inline=1` → self-contained bundle (#119 Q15a): inline the package + the stamped
  // trust registry so the commitment needs zero network to verify. The package is the
  // one `buildCommitmentView` already received; the registry is exactly what the verify
  // route trusts (the build-time-bundled, generatedAt-stamped `/.well-known` file). When
  // the blob couldn't be fetched (`pkg === null`), `package` is simply omitted — the
  // bundle then falls back to `packageUrl` rather than serving a hollow inline field.
  // Committed records never inline the package (content is creator-distributed only).
  const inlineParam = request.nextUrl.searchParams.get('inline');
  const inline = inlineParam !== null && inlineParam !== '0' && inlineParam !== 'false';
  let body: Record<string, unknown> = commitment;
  if (inline) {
    const registry = await loadTrustRegistry();
    body = {
      ...commitment,
      ...(pkg && !isCommitted ? { package: pkg } : {}),
      ...(registry ? { trustRegistry: registry } : {}),
    };
  }

  // Short cache: the proofs are immutable for a given hash, but lifecycle state
  // (withdrawal/reinstatement) can change after publish, so keep it brief. The inline
  // and default forms cache separately (the cache key includes the query string).
  return jsonResponse(body, 200, {
    'Cache-Control': 'public, max-age=60, s-maxage=60',
  });
}
