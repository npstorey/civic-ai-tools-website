import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage, putPackage, deletePackageBlob } from '@/lib/storage';
import { emitPublicationPair } from '@/lib/evidence/publication';
import { resolveLifecycle } from '@/lib/evidence/lifecycle';
import type { EvidencePackage } from '@/lib/evidence/packager';
import { resolveRequestUser, hasScope } from '@/lib/api-auth';

/**
 * POST /api/evidence/[slug]/publish
 *
 * Promotes a COMMITTED record to PUBLISHED (civic-ai-tools#71; spec §8.10,
 * ADR-0010 §6). Publication is two coupled signed nodes, each independently
 * timestamped and Rekor-included:
 *
 *   1. attestation/publishes/v1  (publisher-only; platform signs on the
 *      author's behalf per §8.5, exactly like withdraw/reinstate)
 *   2. attestation/locatedAt/v1  (the platform's first-asserter pointer to the
 *      now-public content URL)
 *
 * Flow: re-home the content from its random committed key to the canonical
 * hash-addressed key → emit the pair → flip the DB visibility mirror → delete
 * the old capability-URL blob (best-effort). If pair emission fails, the
 * canonical blob is removed again and the record stays committed — the publish
 * is retryable, never half-listed.
 *
 * Publication is not reversible (spec §8.10.3 retention asymmetry): a later
 * withdrawal is a new attestation in the chain, not an unpublish.
 *
 * Body: { runEvaluation?: boolean } — accepted per the integration contract;
 * the adversarial-eval gate wires in Phase 3 (civic-ai-tools#72). Until then
 * no evaluation runs regardless of the flag, and the response carries no
 * evaluationNodeId. Documented in docs/api/evidence-publish.md.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const auth = await resolveRequestUser(request);
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!hasScope(auth, 'evidence:publish')) {
    return NextResponse.json(
      { error: 'Token missing required scope: evidence:publish' },
      { status: 403 },
    );
  }

  const records = await db
    .select()
    .from(evidenceRecords)
    .where(eq(evidenceRecords.slug, slug))
    .limit(1);
  if (records.length === 0) {
    return NextResponse.json({ error: 'Evidence record not found' }, { status: 404 });
  }
  const record = records[0];

  // Publisher-only (§8.12.3): only the creator can publish. 404 (not 403) for
  // non-creators so a committed record's existence isn't confirmed by probing.
  if (record.creatorId !== auth.userId) {
    return NextResponse.json({ error: 'Evidence record not found' }, { status: 404 });
  }

  if (record.visibility !== 'committed') {
    return NextResponse.json({ error: 'Evidence is already published' }, { status: 400 });
  }

  // A withdrawn committed claim must be reinstated before it can publish —
  // publishing content whose own author has withdrawn it would assert a
  // visibility the lifecycle chain contradicts. Resolved from the signed
  // attestation chain first (§8.10.4 dual-read) rather than the legacy column
  // mirror, so this gate stays correct when multi-cycle lifecycle support
  // (free in the chain by construction) reaches the withdraw/reinstate routes.
  const lifecycle = await resolveLifecycle(record);
  if (lifecycle.status === 'withdrawn') {
    return NextResponse.json(
      { error: 'Evidence is withdrawn; reinstate it before publishing' },
      { status: 400 },
    );
  }

  if (!record.basePackageHash || !record.basePackageStorageKey) {
    return NextResponse.json(
      { error: 'Record has no stored package to publish' },
      { status: 400 },
    );
  }

  // Body is optional; `runEvaluation` is parsed for forward-compat with the
  // Phase 3 eval gate but intentionally unused here (see route docblock).
  try {
    await request.json();
  } catch {
    // Empty body is fine.
  }

  // Fetch the committed package from its random-key blob.
  const pkg = (await getPackage(record.basePackageStorageKey)) as EvidencePackage | null;
  if (!pkg) {
    return NextResponse.json(
      { error: 'Stored package could not be retrieved' },
      { status: 502 },
    );
  }

  // 1. Re-home the content at the canonical, content-addressable key. The
  //    content is now technically fetchable by hash — the pair + DB flip
  //    follow immediately, and on pair failure the blob is deleted again.
  const publicUrl = await putPackage(
    record.basePackageHash,
    pkg as unknown as Record<string, unknown>,
  );

  // 2. Emit the publication pair (both signed nodes + one atomic DB insert).
  let pair;
  try {
    pair = await emitPublicationPair({
      targetNodeId: record.basePackageHash,
      uri: publicUrl,
      targetContentHash: pkg.contentHash,
      contentLength: Buffer.byteLength(JSON.stringify(pkg)),
      creatorId: record.creatorId,
    });
  } catch (err) {
    // Roll the content back out of public reach; the record stays committed
    // and the publish is retryable.
    await deletePackageBlob(publicUrl);
    console.error('[api/evidence/publish] pair emission failed:', err);
    return NextResponse.json(
      { error: 'Publication failed; the record remains committed' },
      { status: 500 },
    );
  }

  // 3. Flip the visibility mirror + point the record at the canonical blob.
  const oldStorageKey = record.basePackageStorageKey;
  await db
    .update(evidenceRecords)
    .set({
      visibility: 'published',
      basePackageStorageKey: publicUrl,
      updatedAt: new Date(),
    })
    .where(eq(evidenceRecords.id, record.id));

  // 4. Retire the old capability URL (best-effort).
  if (oldStorageKey !== publicUrl) {
    await deletePackageBlob(oldStorageKey);
  }

  return NextResponse.json({
    published: true,
    publishesNodeId: pair.publishesNodeId,
    locatedAtNodeId: pair.locatedAtNodeId,
    url: `/evidence/${slug}`,
  });
}
