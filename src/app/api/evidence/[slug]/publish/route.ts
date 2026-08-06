import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { evidenceRecords } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getPackage, putPackage, deletePackageBlob } from '@/lib/storage';
import { emitPublicationPair } from '@/lib/evidence/publication';
import { resolveLifecycle } from '@/lib/evidence/lifecycle';
import type { EvidencePackage } from '@/lib/evidence/packager';
import { resolveRequestUser, hasScope } from '@/lib/api-auth';
import {
  runAdversarialEval,
  emitEvaluationAttestation,
} from '@/lib/evidence/adversarial-eval';
import {
  evaluateSealCommitGate,
  evaluateUnsignedRecordPublishGate,
} from '@/lib/evidence/unsigned-tier';
import { fromDbValue, toDbValue } from '@/lib/evidence/visibility';
import { visibilityMatches } from '@/lib/evidence/visibility-sql';

/**
 * POST /api/evidence/[slug]/publish
 *
 * Promotes a SEALED record to PUBLIC (civic-ai-tools#71; spec §8.10,
 * ADR-0010 §6), gated by a default-on adversarial evaluation
 * (civic-ai-tools#72; Q25 option (b)+(c): host-policy + default-on at the
 * publisher tool — NOT protocol-mandatory).
 *
 * Body: { runEvaluation?: boolean, evaluatorModel?: string }
 *
 * Flow:
 *   1. Default-on adversarial eval (skippable via runEvaluation:false): the
 *      platform runs the six-criterion rubric with its own OpenRouter key and
 *      emits a signed `attestation/evaluates/v1` node targeting the content
 *      node. The gate is PRESENCE-based — the eval and the publication record
 *      relate via the shared targetNodeId; `publishes/v1` stays at its
 *      ratified payload (the explicit-reference question is registered under
 *      Q25). Any score publishes in v1; score thresholds are a host-policy
 *      axis. An eval FAILURE (evaluator unreachable / invalid response) aborts
 *      the publish with an explicit 502 — never a silent skip; the caller can
 *      retry or pass runEvaluation:false to publish without an eval.
 *   2. Compare-and-set visibility sealed→public (the concurrency guard:
 *      two racing publishes can both pass the pre-check, but only one wins the
 *      conditional UPDATE; the loser gets 409 and emits nothing).
 *   3. Re-home the content from its random sealed-mode key to the canonical
 *      hash-addressed key; emit the publication pair (attestation/publishes/v1
 *      + attestation/locatedAt/v1, one atomic insert); point the record at the
 *      canonical blob; retire the old capability URL.
 *      On failure: visibility reverts to sealed and the canonical blob is
 *      deleted — a failed publish is retryable, never half-published. (A
 *      surviving evaluation node from step 1 is harmless: evals target the
 *      content node and remain valid for the retry.)
 *
 * Publication is not reversible (spec §8.10.3 retention asymmetry): a later
 * withdrawal is a new attestation in the chain, not an unpublish.
 */

// Default evaluator for the publication gate. Must differ from the analysis
// model (evaluator independence); when they collide, the fallback is used.
const DEFAULT_EVALUATOR_MODEL = 'anthropic/claude-sonnet-4-6';
const FALLBACK_EVALUATOR_MODEL = 'openai/gpt-4o';

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

  // Unsigned-tier gate-off (S3a P3, #166; ADR-0020 Decisions B/C, G0-3): the
  // sealed→public promotion emits SIGNED publication attestations — an
  // instance with no signing key cannot back them, and an unsigned package
  // may reach neither sealed nor public. Refused before any lookup.
  const gate = evaluateSealCommitGate();
  if (gate) {
    return NextResponse.json(gate.body, { status: gate.status });
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
  // non-creators so a sealed record's existence isn't confirmed by probing.
  if (record.creatorId !== auth.userId) {
    return NextResponse.json({ error: 'Evidence record not found' }, { status: 404 });
  }

  // Precondition, keyed on the canonical state so a row holding EITHER label
  // (legacy `committed` or ADR-0016 `sealed`) is still promotable. This is the
  // mixed-state property in its sharpest form: between this deploy and the M2
  // backfill the table holds both spellings at once.
  if (fromDbValue(record.visibility) !== 'sealed') {
    return NextResponse.json({ error: 'Evidence is already published' }, { status: 400 });
  }

  // Per-record form of the same gate: a historical row persisted WITHOUT a
  // signature (pre-gate unsigned-sealed) cannot be promoted to public even
  // on a signed instance — the base package has no signature to back a public
  // state (ADR-0020 Decision C is a property of the package). The row itself
  // is not migrated or relabeled; it stays sealed and renders with the
  // prominent unsigned labeling.
  const recordGate = evaluateUnsignedRecordPublishGate(record.basePackageSignature);
  if (recordGate) {
    return NextResponse.json(recordGate.body, { status: recordGate.status });
  }

  // A withdrawn sealed claim must be reinstated before it can publish —
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

  // Body: { runEvaluation?: boolean, evaluatorModel?: string }. Empty body ok.
  let runEvaluation = true;
  let evaluatorModelOverride: string | undefined;
  try {
    const body = await request.json();
    if (body && typeof body === 'object') {
      if (body.runEvaluation === false) runEvaluation = false;
      if (typeof body.evaluatorModel === 'string' && body.evaluatorModel.trim()) {
        evaluatorModelOverride = body.evaluatorModel.trim();
      }
    }
  } catch {
    // Empty / non-JSON body is fine; defaults apply.
  }

  // Fetch the sealed package from its random-key blob.
  const pkg = (await getPackage(record.basePackageStorageKey)) as EvidencePackage | null;
  if (!pkg) {
    return NextResponse.json(
      { error: 'Stored package could not be retrieved' },
      { status: 502 },
    );
  }

  // 1. Default-on adversarial evaluation (civic-ai-tools#72; Q25 (b)+(c)).
  let evaluationNodeId: string | undefined;
  if (runEvaluation) {
    const platformKey = process.env.OPENROUTER_API_KEY;
    if (!platformKey) {
      return NextResponse.json(
        {
          error:
            'Evaluation unavailable (no platform evaluator credentials); retry with {"runEvaluation": false} to publish without an evaluation.',
        },
        { status: 502 },
      );
    }
    // Evaluator independence: the evaluator model must differ from the model
    // that produced the analysis (same invariant as the interactive route).
    // An explicit override that collides is the caller's error (400); the
    // DEFAULT colliding silently falls back instead.
    let evaluatorModel = evaluatorModelOverride ?? DEFAULT_EVALUATOR_MODEL;
    if (evaluatorModelOverride && evaluatorModelOverride === pkg.cost.model) {
      return NextResponse.json(
        { error: 'Evaluator model must differ from the analysis model' },
        { status: 400 },
      );
    }
    if (evaluatorModel === pkg.cost.model) {
      evaluatorModel = FALLBACK_EVALUATOR_MODEL;
    }

    try {
      const parsed = await runAdversarialEval(pkg, {
        apiKey: platformKey,
        evaluatorModel,
      });
      if (!parsed.ok) {
        return NextResponse.json(
          {
            error: `Adversarial evaluation failed (${parsed.error}); retry, or pass {"runEvaluation": false} to publish without an evaluation.`,
          },
          { status: 502 },
        );
      }
      const emitted = await emitEvaluationAttestation({
        targetNodeId: record.basePackageHash,
        evaluatorModel,
        results: parsed.results,
        creatorId: record.creatorId,
      });
      evaluationNodeId = emitted.evaluationNodeId;
    } catch (err) {
      console.error('[api/evidence/publish] evaluation failed:', err);
      return NextResponse.json(
        {
          error:
            'Adversarial evaluation failed (evaluator unreachable); retry, or pass {"runEvaluation": false} to publish without an evaluation.',
        },
        { status: 502 },
      );
    }
  }

  // 2. Compare-and-set the visibility mirror sealed→public. This is the
  //    concurrency guard: of two racing publishes, exactly one UPDATE matches
  //    the WHERE clause. The loser emits nothing and reports the conflict.
  //
  //    The compare side matches EITHER sealed-state label, so the guard keeps
  //    working on rows still holding the legacy value — if it only matched one
  //    spelling, a row on the other one would fail the CAS with a 409 and be
  //    permanently unpublishable. The set side writes whatever `toDbValue`
  //    currently persists, so the pre-check above and this update always agree.
  const won = await db
    .update(evidenceRecords)
    .set({ visibility: toDbValue('public'), updatedAt: new Date() })
    .where(
      and(
        eq(evidenceRecords.id, record.id),
        visibilityMatches(evidenceRecords.visibility, 'sealed'),
      ),
    )
    .returning({ id: evidenceRecords.id });
  if (won.length === 0) {
    return NextResponse.json(
      { error: 'Evidence was published concurrently by another request' },
      { status: 409 },
    );
  }

  const revertToSealed = async () => {
    await db
      .update(evidenceRecords)
      .set({ visibility: toDbValue('sealed'), updatedAt: new Date() })
      .where(eq(evidenceRecords.id, record.id));
  };

  // 3. Re-home the content at the canonical, content-addressable key, emit the
  //    publication pair, and point the record at the canonical blob.
  let publicUrl: string | null = null;
  let pair;
  try {
    publicUrl = await putPackage(
      record.basePackageHash,
      pkg as unknown as Record<string, unknown>,
    );
    pair = await emitPublicationPair({
      targetNodeId: record.basePackageHash,
      uri: publicUrl,
      targetContentHash: pkg.contentHash,
      contentLength: Buffer.byteLength(JSON.stringify(pkg)),
      creatorId: record.creatorId,
    });
  } catch (err) {
    // Roll back: content out of public reach, visibility back to sealed.
    // The publish is retryable; a step-1 evaluation node survives harmlessly.
    if (publicUrl) await deletePackageBlob(publicUrl);
    await revertToSealed().catch((revertErr) =>
      console.error('[api/evidence/publish] visibility revert failed:', revertErr),
    );
    console.error('[api/evidence/publish] pair emission failed:', err);
    return NextResponse.json(
      { error: 'Publication failed; the record remains sealed' },
      { status: 500 },
    );
  }

  const oldStorageKey = record.basePackageStorageKey;
  await db
    .update(evidenceRecords)
    .set({ basePackageStorageKey: publicUrl, updatedAt: new Date() })
    .where(eq(evidenceRecords.id, record.id));

  // 4. Retire the old capability URL (best-effort).
  if (oldStorageKey !== publicUrl) {
    await deletePackageBlob(oldStorageKey);
  }

  return NextResponse.json({
    published: true,
    ...(evaluationNodeId ? { evaluationNodeId } : {}),
    publishesNodeId: pair.publishesNodeId,
    locatedAtNodeId: pair.locatedAtNodeId,
    url: `/evidence/${slug}`,
  });
}
