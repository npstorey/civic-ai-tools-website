/**
 * The identity key one tool call gets inside a consistency attestation.
 *
 * WHAT IT IS FOR. `AttestationDialog` replays a published analysis N times and
 * scores how reproducible the runs were. The tool-call half of that score is
 * the average pairwise Jaccard similarity of the runs' key SETS, and the keys
 * themselves are written into the attestation package that is then hashed and
 * SIGNED. So this function decides two things a reader is shown as facts: the
 * "Tool overlap: N%" figure, and whether the run is labelled
 * `highly_reproducible`.
 *
 * THE PROPERTY: any difference in a call's arguments produces a different key.
 *
 * It is stated as a property because the thing it replaces was a hand-picked
 * field list — `name:type:dataset_id:portal` — and a hand-picked list is what
 * failed, in two independent ways:
 *
 *   - `search` takes only `query` and `fetch` only `id`, so once both became
 *     model-callable every search collapsed to `search:::` and every fetch to
 *     `fetch:::`. Two runs that searched for entirely different things had
 *     identical key sets, Jaccard returned 1, and `(1 + outputSimilarity)/2`
 *     cleared the 0.9 threshold. A signed attestation reported 100% tool
 *     overlap for two runs that read different data.
 *   - `where` was never in the list at all. Two `get_data` queries against the
 *     same dataset on the same portal filtering for different things have been
 *     indistinguishable since the key was written — before either of those two
 *     tools existed.
 *
 * Enumerating fields is therefore not a smaller version of the right answer;
 * it is the defect. The key is the tool name plus a canonical serialisation of
 * the whole argument object, and a field this repository has never heard of is
 * discriminated on exactly like one it defines.
 *
 * WHY RFC 8785 AND NOT `JSON.stringify`. Arguments reach us as `JSON.parse` of
 * whatever the model endpoint emitted, and that parse preserves the endpoint's
 * key order. Two genuinely identical calls written in different orders must be
 * one key — otherwise the score fails in the other direction, calling a
 * reproducible run inconsistent, which is just as false a claim to sign.
 * `jcs()` (RFC 8785, already this repository's canonical-JSON function, and
 * browser-safe by construction because the verifier runs in a browser too)
 * sorts object keys at every depth and leaves array order alone — which is
 * right: `["a","b"]` and `["b","a"]` are different requests.
 *
 * THIS IS NOT THE SIGNING CANONICALISATION. The attestation package's own
 * signed bytes are produced by the route, not here. This function only decides
 * what counts as "the same tool call"; it happens to want the same well-defined
 * serialisation, and reusing the one implementation beats growing a second.
 *
 * SEPARATOR. A serialised argument object always begins with `{`, so the `:`
 * before it is unambiguous even for a tool name that contained one — the four
 * `:`-joined free-text fields it replaces had no such property.
 *
 * HISTORICAL ATTESTATIONS ARE NOT AFFECTED. Keys are computed once, at
 * submission time, from a live replay's results, and stored inside the package
 * that is hashed and signed. Nothing reads them back and nothing recomputes
 * them: `AttestationSection` renders the stored `metrics.toolCallOverlap`, and
 * the backfill signs `row.packageHash` as stored. An attestation signed before
 * this change keeps the bytes it was signed over.
 */
import { jcs } from './canonicalization.ts';

export function canonicalizeToolCall(tc: { name: string; args?: Record<string, unknown> }): string {
  return `${tc.name}:${jcs(tc.args ?? {})}`;
}
