// Adversarial evaluation — shared runner + signed-attestation emission
// (civic-ai-tools#72 Phase 3; spec §8.12.1 `attestation/evaluates/v1`; Q25/Q26).
//
// Two consumers share this module:
//   1. POST /api/evidence/[slug]/evaluate — the interactive route (caller's
//      OpenRouter key, transient response; behavior unchanged from PR-#62-era).
//   2. POST /api/evidence/[slug]/publish — the publication gate: default-runs
//      the eval with the PLATFORM key and emits a signed
//      `attestation/evaluates/v1` node targeting the content node BEFORE the
//      publication pair is created (Q25 option (c), default-on / configurable
//      off). The gate is presence-based: the eval and the publication record
//      relate via the shared targetNodeId — `publishes/v1` carries no pointer
//      (per the ratified contract; the explicit-reference question is
//      registered under Q25).
//
// Evaluator identity (Q26): the evaluator's binding tier and identifier live
// on the attestation envelope's `signer` (ADR-0009 §4) — the platform signs as
// the evaluator today. The METHODOLOGY is required payload content: test set,
// prompt-set version (SHA-256 of the rubric text, pinning the exact prompts),
// evaluator model, scoring rubric identifier.

import { createModelClient } from '@/lib/model-client';
import { db } from '@/lib/db';
import { attestationNodes } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { putPackage, getPackage } from '@/lib/storage';
import type { EvidencePackage } from './packager.ts';
import {
  signPackage,
  getRfc3161Timestamp,
  publishToRekor,
  getActiveSigner,
} from './signing.ts';
import {
  buildAttestationNode,
  ATTESTATION_EVALUATES,
  type EvaluationMethodology,
  type EvaluationResults,
} from './attestation.ts';
import { verifyAttestationNode } from './verify.ts';
import {
  EVALUATION_RUBRIC,
  RUBRIC_ID,
  RUBRIC_VERSION_SHA256,
  buildEvaluationPrompt,
  parseEvaluationResponse,
  type ParsedEvaluation,
} from './adversarial-eval-core.ts';

// Pure core (rubric, criteria, version hash, prompt builder, parser) —
// re-exported so routes import one module.
export * from './adversarial-eval-core.ts';

/**
 * Run the rubric against a package via OpenRouter. Throws on transport/LLM
 * errors; returns a ParsedEvaluation for response-shape problems so callers
 * can distinguish "evaluator unreachable" from "evaluator returned garbage".
 */
export async function runAdversarialEval(
  pkg: EvidencePackage,
  opts: { apiKey: string; evaluatorModel: string },
): Promise<ParsedEvaluation> {
  const openrouter = createModelClient({ apiKey: opts.apiKey });
  const response = await openrouter.chat.completions.create({
    model: opts.evaluatorModel,
    messages: [
      { role: 'system', content: EVALUATION_RUBRIC },
      { role: 'user', content: buildEvaluationPrompt(pkg) },
    ],
    max_tokens: 2000,
  });
  const raw = response.choices[0]?.message?.content || '';
  return parseEvaluationResponse(raw);
}

/**
 * Emit a signed `attestation/evaluates/v1` node for a content node — the same
 * sign + timestamp + Rekor + store + row sequence as the publication pair.
 */
export async function emitEvaluationAttestation(input: {
  targetNodeId: string;
  evaluatorModel: string;
  results: EvaluationResults;
  creatorId: string;
}): Promise<{ evaluationNodeId: string }> {
  const methodology: EvaluationMethodology = {
    testSet: RUBRIC_ID,
    promptSetVersion: RUBRIC_VERSION_SHA256,
    evaluatorModel: input.evaluatorModel,
  };

  const { node, nodeId } = buildAttestationNode({
    type: ATTESTATION_EVALUATES,
    targetNodeId: input.targetNodeId,
    signer: getActiveSigner(),
    methodology,
    scoringRubric: RUBRIC_ID,
    results: input.results,
  });

  const signResult = signPackage(nodeId);
  const [rfc3161Token, rekorResult] = await Promise.all([
    getRfc3161Timestamp(nodeId).catch(() => null),
    signResult
      ? publishToRekor(nodeId, signResult.signature, signResult.publicKey).catch(() => null)
      : Promise.resolve(null),
  ]);

  const storageKey = await putPackage(nodeId, node as unknown as Record<string, unknown>);

  await db.insert(attestationNodes).values({
    nodeId,
    targetNodeId: input.targetNodeId,
    type: ATTESTATION_EVALUATES,
    storageKey,
    signature: signResult
      ? JSON.stringify({
          nodeId,
          signature: signResult.signature,
          publicKey: signResult.publicKey,
          algorithm: signResult.algorithm,
          kid: signResult.kid,
        })
      : null,
    rfc3161Timestamp: rfc3161Token,
    rekorEntryId: rekorResult?.entryId || null,
    rekorInclusionProof: rekorResult?.inclusionProof || null,
    signer: node.signer,
    payload: { methodology, scoringRubric: RUBRIC_ID, results: input.results },
    creatorId: input.creatorId,
  });

  return { evaluationNodeId: nodeId };
}

/** A renderable view of one evaluation attestation, independently verified
 *  (nodeId recompute + signature check) like the lifecycle views. */
export interface EvaluationAttestationView {
  nodeId: string;
  createdAt: string;
  methodology: EvaluationMethodology | null;
  results: EvaluationResults | null;
  signatureValid: boolean | null;
  nodeIdMatches: boolean;
  hasTimestamp: boolean;
  hasRekor: boolean;
}

/**
 * Load the `attestation/evaluates/v1` nodes targeting a content node, for the
 * detail page. Each is re-verified from its signed blob; rendered fields come
 * from the SIGNED node JSON when fetchable, falling back to the row payload.
 * Returns [] on any query error (degrade-not-down, like resolveLifecycle).
 */
export async function loadEvaluationViews(
  targetNodeId: string,
): Promise<EvaluationAttestationView[]> {
  let rows: (typeof attestationNodes.$inferSelect)[] = [];
  try {
    rows = await db
      .select()
      .from(attestationNodes)
      .where(
        and(
          eq(attestationNodes.targetNodeId, targetNodeId),
          eq(attestationNodes.type, ATTESTATION_EVALUATES),
        ),
      );
  } catch {
    return [];
  }

  const views: EvaluationAttestationView[] = [];
  for (const row of rows) {
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
    const source = (node ?? payload) as Record<string, unknown>;
    views.push({
      nodeId: row.nodeId,
      createdAt:
        (typeof (node?.metadata as Record<string, unknown> | undefined)?.createdAt ===
        'string'
          ? ((node!.metadata as Record<string, unknown>).createdAt as string)
          : null) ?? row.createdAt.toISOString(),
      methodology: (source.methodology as EvaluationMethodology | undefined) ?? null,
      results: (source.results as EvaluationResults | undefined) ?? null,
      signatureValid: verdict.signatureValid,
      nodeIdMatches: verdict.nodeIdMatches,
      hasTimestamp: !!row.rfc3161Timestamp,
      hasRekor: !!row.rekorEntryId,
    });
  }
  // Envelope-timestamp order, newest last (mirrors lifecycle chain ordering).
  views.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return views;
}
