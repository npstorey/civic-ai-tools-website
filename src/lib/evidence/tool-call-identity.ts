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
 * THE PROPERTY: any difference in a call's arguments produces a different key,
 * AND a call the source refused is never the same key as one that answered.
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
 * THE SECOND HALF OF THE PROPERTY, and why it needed adding (#402). The key was
 * the name and the arguments and NOTHING ELSE, so a call the source refused and
 * a call that answered — same tool, same arguments — were one key. Two replay
 * runs differing only in a refusal therefore had identical key SETS, Jaccard
 * returned 1, and `(1 + outputSimilarity)/2` cleared the 0.9 threshold: a signed
 * attestation reported "Tool overlap: 100%" and `highly_reproducible` for two
 * runs where one read a source and the other did not. That is the #363 family
 * again — a key that cannot see a difference the reader would call decisive.
 *
 * The data was already on the wire. `api/evidence/[slug]/replay/route.ts` has
 * sent `failed` and `failureKind` on `toolCalls` since #338; what was missing
 * was here, and in the client type that declared the field away.
 *
 * WHY `failed` AND NOT `failureKind`. The key answers "is this the same tool
 * call", and the difference that matters is whether the run got an answer, not
 * why it did not. A timeout on one run and an unreachable source on the next
 * are the same request refused twice; keying on the cause would score two
 * identical analyses as inconsistent because the network classified a failure
 * differently, which is a false claim in the other direction. `failureKind` is
 * carried on the type and deliberately not read here.
 *
 * WHY A SUFFIX AND NOT A FIELD IN THE SERIALISATION. A call that answered keeps
 * a byte-identical key: only a rejected call's key changes shape. That keeps the
 * stored keys of every past attestation comparable with a new one for the calls
 * that succeeded, and it keeps this module's existing pins meaningful rather
 * than rewritten wholesale. Ambiguity is not possible: `jcs()` of an object
 * always ends in `}`, so no answered call's key can end in the suffix.
 *
 * HISTORICAL ATTESTATIONS ARE NOT AFFECTED — measured, not assumed. Keys are
 * computed once, at submission time, from a live replay's results, and stored
 * inside the package that is hashed and signed. The route hashes the SERIALISED
 * PACKAGE (`sha256(JSON.stringify(attestationPkg))`) and stores those bytes;
 * nothing reads a key back and nothing recomputes one. `AttestationSection`
 * renders the stored `metrics.toolCallOverlap`, and the backfill signs
 * `row.packageHash` as stored. Driven against production on 2026-09-05: a stored
 * attestation package fetched from blob storage re-hashes to its own stored
 * `packageHash` byte for byte, so the hash is over stored bytes and this
 * function is not on that path. Driven again over the whole registry the same
 * day: of 34 published records, 7 carry an attestation — five expert reviews and
 * two evaluations — and ZERO carry a consistency attestation, so no signed
 * package in production contains a `toolCallKeys` array at all.
 * `tool-call-identity.test.ts` pins the mechanism so the population changing
 * cannot quietly change the answer.
 */
import { jcs } from './canonicalization.ts';

/**
 * What a rejected call's key carries that an answered call's does not.
 *
 * A separate constant because two things read it: this function, and the test
 * that asserts an answered call's key cannot end in it.
 */
export const REJECTED_CALL_KEY_SUFFIX = ':rejected';

/**
 * How a consistency attestation treats a call the source refused, in one
 * sentence, in the reader's language.
 *
 * ONE SENTENCE, ONE HOME, and it is not decoration. The metric this module feeds
 * is signed and shown as a percentage, and the same two runs score differently
 * under the old rule and the new one. A reader comparing an attestation made
 * this week with one made last year has no way to tell which rule produced the
 * number unless the attestation says so — so `AttestationDialog` renders this
 * string beside the score AND submits it inside the signed package, from here,
 * rather than writing the sentence twice where the two could drift.
 */
export const TOOL_CALL_KEY_POLICY =
  'A request the data source refused counts as a different tool call from the same request answered, ' +
  'so two runs that differ only in whether a request was refused do not score as identical.';

export function canonicalizeToolCall(tc: {
  name: string;
  args?: Record<string, unknown>;
  /** Set when the run recorded the call as rejected (`ToolCallRecord.failed`). */
  failed?: boolean;
}): string {
  return `${tc.name}:${jcs(tc.args ?? {})}${tc.failed ? REJECTED_CALL_KEY_SUFFIX : ''}`;
}
