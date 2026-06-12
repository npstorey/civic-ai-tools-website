import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import type { EvidencePackage } from '@/lib/evidence/packager';
import { loadCarriedLifecycleAttestations } from '@/lib/evidence/lifecycle';
import {
  buildCommitmentView,
  CANONICAL_TRUST_REGISTRY_URL,
} from '@/lib/evidence/commitment';
import { canReadRecord } from '@/lib/evidence/committed-access';

/**
 * GET /api/evidence/[slug]/bundle
 *
 * Returns a datHere-content-profile package as a notebook-embedded
 * serialization per OES §9.2.2 — a single .ipynb file whose root
 * metadata carries the commitment view under the `org.civicaitools.evidence`
 * namespace, with a cell-0 metadata table prepended per the §9.2.4
 * reader-affordance convention.
 *
 * Authentication: none. The bundle endpoint serves the same content the
 * canonical package URL already serves publicly, just reformatted for
 * cross-host publishing.
 *
 * Limitations (prototype):
 * - Returns only the notebook-embedded serialization. Sibling-YAML
 *   serialization (OES §9.2.3) for non-notebook outputs is future work.
 * - Bundle endpoint refuses non-datHere content profiles with 400. The
 *   spec does not require bundle export for other content profiles, and
 *   the existing canonical package URL remains available for them. The
 *   gate is `contentProfile`, not `captureMethod` (post-2026-05-19
 *   reframe in ADR-0004); a chat-flow-stream capture with the datHere
 *   content profile is fully supported.
 */

const NOTEBOOK_EXTENSION_KEY = 'org.civicaitools.notebook';
const EVIDENCE_NAMESPACE_KEY = 'org.civicaitools.evidence';

type EvidenceRecord = typeof evidenceRecords.$inferSelect;
type UserRecord = typeof users.$inferSelect;

// `buildCommitmentView` (the §9.2.1 proof sidecar) now lives in
// `@/lib/evidence/commitment` so the public commitment endpoint and this
// notebook-embedded bundle emit the same self-describing proof object
// (civic-ai-tools-website#116 WS1).

/**
 * Build a cell-0 markdown metadata table per OES §9.2.4 (SHOULD-level
 * reader affordance). Verification does NOT depend on this cell — the
 * authoritative metadata is the `org.civicaitools.evidence` namespace at
 * the notebook's root. The cell exists so a reader opening the .ipynb in
 * Jupyter / Colab / VS Code / GitHub's viewer sees the signer + package
 * hash + capture-method context immediately.
 */
function buildCellZero(
  record: EvidenceRecord,
  creator: UserRecord | null,
): Record<string, unknown> {
  const hashPrefix = record.basePackageHash
    ? `\`${record.basePackageHash.slice(0, 12)}…\``
    : '—';
  const signerLink = creator?.githubProfileUrl
    ? `[${creator.displayName}](${creator.githubProfileUrl})`
    : creator?.displayName ?? 'Unknown';
  const publishedDate = record.createdAt.toISOString().split('T')[0];
  const detailUrl = `https://civicaitools.org/evidence/${record.slug}`;
  const trustHost = CANONICAL_TRUST_REGISTRY_URL.replace('https://', '');

  const captureMethodFriendly =
    record.captureMethod === 'chat-flow-stream'
      ? 'Web chat (wire-layer verbatim)'
      : record.captureMethod === 'claude-code-jsonl-readback'
        ? 'Claude Code (JSONL verbatim)'
        : record.captureMethod === 'claude-code-self-report'
          ? 'Claude Code (self-report, deprecated)'
          : 'Unknown';

  const lines: string[] = [
    '## Evidence package',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| **Signer** | ${signerLink} |`,
    `| **Package hash** | ${hashPrefix} |`,
    `| **Captured via** | ${captureMethodFriendly} |`,
    '| **Content profile** | datHere (A-G envelope, reproducible notebook) |',
    `| **Published** | ${publishedDate} via [civicaitools.org](${detailUrl}) |`,
    `| **Trust registry** | [${trustHost}](${CANONICAL_TRUST_REGISTRY_URL}) |`,
    '',
    "*Re-execute the cells below to reproduce the analysis. The cryptographic envelope is in this notebook's root `metadata.org.civicaitools.evidence` namespace — that's what binds the signature to this content. This cell is a reader affordance only.*",
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

  const records = await db
    .select()
    .from(evidenceRecords)
    .where(eq(evidenceRecords.slug, slug))
    .limit(1);
  if (records.length === 0) {
    return NextResponse.json(
      { error: 'Evidence not found' },
      { status: 404 },
    );
  }
  const record = records[0];

  // Committed records' bundle (the full content, packaged for sharing) is
  // creator-only (civic-ai-tools#71) — the creator exports it to distribute
  // to chosen recipients; it is not a public surface until publication.
  if (!(await canReadRecord(request, record))) {
    return NextResponse.json({ error: 'Evidence not found' }, { status: 404 });
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

  // Inject commitment view at notebook root metadata (OES §9.2.2), carrying the
  // signed lifecycle attestation chain (#119 P3) for offline #10 resolution.
  const lifecycleAttestations = record.basePackageHash
    ? await loadCarriedLifecycleAttestations(record.basePackageHash)
    : [];
  const metadata = (notebook.metadata as Record<string, unknown>) ?? {};
  metadata[EVIDENCE_NAMESPACE_KEY] = buildCommitmentView(record, creator, pkg, lifecycleAttestations);
  notebook.metadata = metadata;

  // Prepend cell-0 reader-affordance table (OES §9.2.4)
  const existingCells = Array.isArray(notebook.cells)
    ? (notebook.cells as unknown[])
    : [];
  notebook.cells = [buildCellZero(record, creator), ...existingCells];

  return new NextResponse(JSON.stringify(notebook, null, 2), {
    headers: {
      'Content-Type': 'application/x-ipynb+json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}.ipynb"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}
