/**
 * The consistency score a replay set gets — the numbers a signed attestation
 * carries, and the word it is labelled with.
 *
 * WHY THIS MODULE EXISTS AT ALL. This computation lived inside
 * `components/evidence/AttestationDialog.tsx`, and no `.test.ts` in this tree
 * can import a `.tsx`: `npm test` globs `src/**` + `/*.test.ts` and this
 * repository has zero component-render tests, a convention rather than an
 * oversight. So the function that decides whether a run is signed as
 * `highly_reproducible` had no test, and could not have one where it stood.
 * `canonicalizeToolCall` was lifted out of the same file for the same reason and
 * for the same defect class (#363); this is the caller it fed.
 *
 * WHAT IT DECIDES, so nobody has to infer the stakes. `toolCallOverlap` is shown
 * to a reader as "Tool overlap: N%", `consistencyClassification` is shown as a
 * word, and BOTH are written into the attestation package that is hashed and
 * signed. They are claims about a published analysis, not diagnostics.
 *
 * THE REJECTED-CALL HALF (#402). The overlap is the average pairwise Jaccard
 * similarity of the runs' KEY SETS, so everything the key cannot see, this
 * metric cannot see either. Until `canonicalizeToolCall` learned `failed`, two
 * runs that asked the same question — one of them refused — had identical key
 * sets, scored 1, and were signed `highly_reproducible` at 100%. The fix is in
 * the key; this module is where it becomes a number, and
 * `../rejected-call-is-not-an-answer.test.ts` drives two such runs through here
 * rather than asserting the key alone, because the key test alone leaves the
 * metric unmeasured.
 *
 * NOTHING ELSE MOVED. The arithmetic, the rounding, the 0.9/0.7 thresholds and
 * the `runs.length < 2` short circuit are byte-for-byte what the dialog ran, so
 * lifting the code cannot be the thing that changed a published number.
 */
import { canonicalizeToolCall } from './tool-call-identity.ts';

/**
 * One recorded call as the replay route returns it.
 *
 * `failed` and `failureKind` have been on the wire since #338 and were declared
 * away by the client's own type, which is the whole of what #402 was: the route
 * sent them, the type dropped them, and the key never saw them. `failureKind` is
 * carried and deliberately not keyed on — see `tool-call-identity.ts`.
 */
export interface ReplayToolCall {
  name: string;
  args: Record<string, unknown>;
  /** Set when the run recorded the call as rejected. Absent is absent. */
  failed?: boolean;
  /** Why it was rejected, when it was. Disclosed, never keyed on. */
  failureKind?: string;
}

/** One replay run, as `/api/records/[slug]/replay` returns it. */
export interface ReplayResult {
  toolCalls: ReplayToolCall[];
  output: string;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  durationMs: number;
}

export interface ConsistencyMetrics {
  toolCallOverlap: number;
  outputSimilarity: number;
  consistencyClassification: 'highly_reproducible' | 'moderately_stable' | 'inconsistent';
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}

export function extractNumbers(text: string): number[] {
  const matches = text.match(/\b\d[\d,]*\.?\d*\b/g) || [];
  return matches
    .map(m => parseFloat(m.replace(/,/g, '')))
    .filter(n => !isNaN(n) && n > 0);
}

export function computeConsistencyMetrics(runs: ReplayResult[]): ConsistencyMetrics {
  if (runs.length < 2) {
    return { toolCallOverlap: 1, outputSimilarity: 1, consistencyClassification: 'highly_reproducible' };
  }

  // Tool call overlap: average pairwise Jaccard similarity
  const toolCallSets = runs.map(r =>
    new Set(r.toolCalls.map(canonicalizeToolCall))
  );
  let totalJaccard = 0;
  let pairCount = 0;
  for (let i = 0; i < toolCallSets.length; i++) {
    for (let j = i + 1; j < toolCallSets.length; j++) {
      totalJaccard += jaccardSimilarity(toolCallSets[i], toolCallSets[j]);
      pairCount++;
    }
  }
  const toolCallOverlap = pairCount > 0 ? totalJaccard / pairCount : 1;

  // Output similarity: compare numeric claims across runs
  const numberSets = runs.map(r => extractNumbers(r.output));
  const referenceSet = new Set(numberSets[0].map(n => n.toString()));
  let totalMatch = 0;
  for (let i = 1; i < numberSets.length; i++) {
    if (referenceSet.size === 0) {
      totalMatch += 1; // No numbers to compare — treat as matching
    } else {
      const matches = numberSets[i].filter(n => referenceSet.has(n.toString()));
      totalMatch += matches.length / referenceSet.size;
    }
  }
  const outputSimilarity = runs.length > 1 ? totalMatch / (runs.length - 1) : 1;

  // Combined score for classification
  const combined = (toolCallOverlap + Math.min(outputSimilarity, 1)) / 2;
  let consistencyClassification: ConsistencyMetrics['consistencyClassification'];
  if (combined >= 0.9) consistencyClassification = 'highly_reproducible';
  else if (combined >= 0.7) consistencyClassification = 'moderately_stable';
  else consistencyClassification = 'inconsistent';

  return {
    toolCallOverlap: Math.round(toolCallOverlap * 100) / 100,
    outputSimilarity: Math.round(Math.min(outputSimilarity, 1) * 100) / 100,
    consistencyClassification,
  };
}
