import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import type { EvidencePackage } from '@/lib/evidence/packager';
import { loadCarriedLifecycleAttestations } from '@/lib/evidence/lifecycle';
import {
  buildCommitmentView,
  COMMITMENT_NAMESPACE_KEY,
} from '@/lib/evidence/commitment';
import { canReadRecord } from '@/lib/evidence/sealed-access';
// Instance-identity config (ADR-0020): the cell-0 reader affordance carries
// this instance's detail URL, host label, and trust-registry pointer — the
// same values the embedded commitment view resolves. No identity defaults
// (#258): with no declared origin this route REFUSES
// (`instance_identity_missing`) rather than embed the reference
// deployment's identity in an exported bundle.
import {
  getEvidenceSiteOrigin,
  getPublicationHost,
  getSidecarTrustRegistryUrls,
} from '@/lib/site-config';

/**
 * GET /api/evidence/[slug]/bundle
 *
 * Returns a datHere-content-profile package as a notebook-embedded
 * serialization per spec §8.8.2 — a single .ipynb file whose root
 * metadata carries the commitment view under the commitment-view extension
 * namespace, with a cell-0 metadata table prepended per the §8.8.4
 * reader-affordance convention.
 *
 * The namespace is DUAL-ERA (spec §8.8.2, settlement ruling D3): new bundles
 * mint `org.civicaitools.record`; bundles exported before the cutover carry
 * `org.civicaitools.evidence` and stay valid forever — a conformant verifier
 * MUST read either, preferring the settlement-era key when both are present.
 * Nothing already downloaded is rewritten.
 *
 * Authentication: none. The bundle endpoint serves the same content the
 * canonical package URL already serves publicly, just reformatted for
 * cross-host publishing.
 *
 * Limitations (prototype):
 * - Returns only the notebook-embedded serialization. Sibling-YAML
 *   serialization (spec §8.8.3) for non-notebook outputs is future work.
 * - Bundle endpoint refuses non-datHere content profiles with 400. The
 *   spec does not require bundle export for other content profiles, and
 *   the existing canonical package URL remains available for them. The
 *   gate is `contentProfile`, not `captureMethod` (post-2026-05-19
 *   reframe in ADR-0004); a chat-flow-stream capture with the datHere
 *   content profile is fully supported.
 */

const NOTEBOOK_EXTENSION_KEY = 'org.civicaitools.notebook';

type EvidenceRecord = typeof evidenceRecords.$inferSelect;
type UserRecord = typeof users.$inferSelect;

// `buildCommitmentView` (the §8.8.1 proof sidecar) now lives in
// `@/lib/evidence/commitment` so the public commitment endpoint and this
// notebook-embedded bundle emit the same self-describing proof object
// (civic-ai-tools-website#116 WS1).

/**
 * Build a cell-0 markdown metadata table per spec §8.8.4 (SHOULD-level
 * reader affordance). Verification does NOT depend on this cell — the
 * authoritative metadata is the commitment-view namespace at
 * the notebook's root. The cell exists so a reader opening the .ipynb in
 * Jupyter / Colab / VS Code / GitHub's viewer sees the signer + package
 * hash + capture-method context immediately.
 */
function buildCellZero(
  record: EvidenceRecord,
  creator: UserRecord | null,
  /** The instance origin — non-null (the GET handler refuses before calling
   *  this when no origin is declared, #258). */
  origin: string,
): Record<string, unknown> {
  const hashPrefix = record.basePackageHash
    ? `\`${record.basePackageHash.slice(0, 12)}…\``
    : '—';
  const signerLink = creator?.githubProfileUrl
    ? `[${creator.displayName}](${creator.githubProfileUrl})`
    : creator?.displayName ?? 'Unknown';
  const publishedDate = record.createdAt.toISOString().split('T')[0];
  // Settlement-era segment (spec Appendix J); `/evidence/<slug>` stays served
  // as a permanent alias for every bundle already exported with it.
  const detailUrl = `${origin}/records/${record.slug}`;
  // Non-null with an origin declared (derives from it); `?? origin` only
  // narrows the type for the template below.
  const host = getPublicationHost() ?? origin;
  const trustRegistryUrl = getSidecarTrustRegistryUrls().canonical;
  const trustHost = trustRegistryUrl.replace('https://', '');

  const captureMethodFriendly =
    record.captureMethod === 'chat-flow-stream'
      ? 'Web chat (wire-layer verbatim)'
      : record.captureMethod === 'claude-code-jsonl-readback'
        ? 'Claude Code (JSONL verbatim)'
        : record.captureMethod === 'claude-code-self-report'
          ? 'Claude Code (self-report, deprecated)'
          : 'Unknown';

  const lines: string[] = [
    '## Record package',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| **Signer** | ${signerLink} |`,
    `| **Package hash** | ${hashPrefix} |`,
    `| **Captured via** | ${captureMethodFriendly} |`,
    '| **Content profile** | datHere (A-G envelope, reproducible notebook) |',
    `| **Published** | ${publishedDate} via [${host}](${detailUrl}) |`,
    `| **Trust registry** | [${trustHost}](${trustRegistryUrl}) |`,
    '',
        `*Re-execute the cells below to reproduce the analysis. The cryptographic envelope is in this notebook's root \`metadata.${COMMITMENT_NAMESPACE_KEY}\` namespace — that's what binds the signature to this content. This cell is a reader affordance only.*`,
  ];

  return {
    cell_type: 'markdown',
    metadata: {},
    source: lines.map((l, i) => (i < lines.length - 1 ? l + '\n' : l)),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // #258: the bundle embeds this instance's identity (detail URL, host
  // label, trust-registry pointer). With no declared origin there is nothing
  // honest to embed — refuse, naming the variable, rather than export a
  // bundle carrying the reference deployment's identity.
  const origin = getEvidenceSiteOrigin();
  if (origin === null) {
    return NextResponse.json(
      {
        error:
          'This instance has not declared its identity: PUBLISHER_SITE_ORIGIN ' +
          'is not set in this environment. The bundle export embeds the ' +
          "instance's detail URL, host label, and trust-registry pointer, so " +
          'it is refused rather than emitted under another deployment\'s ' +
          'identity — see docs/instance-setup.md.',
        code: 'instance_identity_missing',
      },
      { status: 500 },
    );
  }

  const records = await db
    .select()
    .from(evidenceRecords)
    .where(eq(evidenceRecords.slug, slug))
    .limit(1);
  if (records.length === 0) {
    return NextResponse.json(
      { error: 'Record not found' },
      { status: 404 },
    );
  }
  const record = records[0];

  // Sealed records' bundle (the full content, packaged for sharing) is
  // creator-only (civic-ai-tools#71) — the creator exports it to distribute
  // to chosen recipients; it is not a public surface until publication.
  if (!(await canReadRecord(request, record))) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  // Bundle export is datHere-content-profile specific. Other content
  // profiles don't produce the A-G envelope content the bundle
  // serializes; their canonical package URL remains the authoritative
  // artifact. The gate is `contentProfile` (ADR-0004), not
  // `captureMethod` — a chat-flow-stream capture with the datHere
  // content profile is fully supported.
  if (record.contentProfile !== 'datHere') {
    return NextResponse.json(
      {
        error: `Bundle export is only available for packages with contentProfile === "datHere"; this package's contentProfile is "${record.contentProfile ?? 'default'}".`,
      },
      { status: 400 },
    );
  }

  const creators = await db
    .select()
    .from(users)
    .where(eq(users.id, record.creatorId))
    .limit(1);
  const creator = creators[0] ?? null;

  if (!record.basePackageStorageKey) {
    return NextResponse.json(
      { error: 'Package storage key missing — cannot fetch canonical package object.' },
      { status: 500 },
    );
  }
  const pkg = (await getPackage(
    record.basePackageStorageKey,
  )) as EvidencePackage | null;
  if (!pkg) {
    return NextResponse.json(
      { error: 'Canonical package object could not be fetched from storage.' },
      { status: 500 },
    );
  }

  const notebookRaw = pkg.extensions?.[NOTEBOOK_EXTENSION_KEY];
  if (!notebookRaw || typeof notebookRaw !== 'object') {
    return NextResponse.json(
      {
        error: 'Notebook extension (org.civicaitools.notebook) missing from package.',
      },
      { status: 500 },
    );
  }

  // Deep-clone so we don't mutate the cached package
  const notebook = JSON.parse(JSON.stringify(notebookRaw)) as Record<string, unknown>;

  // Inject commitment view at notebook root metadata (spec §8.8.2), carrying the
  // signed lifecycle attestation chain (#119 P3) for offline #10 resolution.
  const lifecycleAttestations = record.basePackageHash
    ? await loadCarriedLifecycleAttestations(record.basePackageHash)
    : [];
  const metadata = (notebook.metadata as Record<string, unknown>) ?? {};
  metadata[COMMITMENT_NAMESPACE_KEY] = buildCommitmentView(record, creator, pkg, lifecycleAttestations);
  notebook.metadata = metadata;

  // Prepend cell-0 reader-affordance table (spec §8.8.4)
  const existingCells = Array.isArray(notebook.cells)
    ? (notebook.cells as unknown[])
    : [];
  notebook.cells = [buildCellZero(record, creator, origin), ...existingCells];

  return new NextResponse(JSON.stringify(notebook, null, 2), {
    headers: {
      'Content-Type': 'application/x-ipynb+json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}.ipynb"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
