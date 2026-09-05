/**
 * A rejected call is not interchangeable with an answered one, and it discloses
 * no identifier the reader was never given (#402, #406).
 *
 * Wave N10's property, at the two surfaces that still treat a rejection as if it
 * had answered:
 *
 *   #402 — `canonicalizeToolCall` keys on the tool name and the canonical JSON
 *   of its arguments and nothing else. Two replay runs that asked the same
 *   question, one of them refused, therefore produce the SAME key, score a
 *   Jaccard overlap of 1, and are signed as `highly_reproducible` at "Tool
 *   overlap: 100%". D2 = B puts the failure in the key.
 *
 *   #406 — the executed generator's rejected-call cell interpolates
 *   `call.reason` verbatim. For `fetch`, `generateToolReason` returns
 *   `to look up <id>`, so the full record identifier — which embeds a portal
 *   AND a dataset id AND a row id — is rendered into a signed notebook cell,
 *   under a heading that has just said the step cannot be accounted for. The
 *   portal in that identifier is one the rejected call never reached.
 *
 *   The rule this violates is already written in this repository, thirty lines
 *   below the site that breaks it: `renderNotRerunnableStepCell`'s docstring
 *   says "The call's identifier is deliberately NOT rendered … printing it puts
 *   a source in front of a reader under a step the notebook has just said it
 *   cannot account for." One rule, two renderers, one of them blind to it.
 *
 * SCOPE, AND WHAT THIS FILE DOES NOT COVER. These are two pure functions driven
 * directly. It does not cover the record page's reproduction sentence (#416's
 * assertion half), which is rendered in JSX: `npm test` globs `src/**` + '/' + '*.test.ts'
 * only and this repository has no component-render tests at all (zero
 * `.test.tsx` files — a convention, not an oversight). An instrument for that
 * surface needs the sentence choice lifted into a pure function first, and the
 * phase that does so states its own red.
 *
 * FIXTURE SHAPES. Both assertions are driven on the shape that can fail:
 * #402's pair differs ONLY in `failed`, so a key that ignores it must collide;
 * #406's call is a `fetch` carrying a realistic `record:` identifier, because a
 * bare or absent id could not show the leak.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeToolCall } from './evidence/tool-call-identity.ts';
import { generateToolReason, reasonWithoutIdentifier } from './streaming.ts';
import {
  describeAttempt,
  describeToolFailure,
  renderFetchToolCell,
} from './notebook-author/tool-to-cell.ts';
// Added with the convergence assertions below, not part of the inherited red.
import { generateNotebook } from './notebook.ts';
import { mcpTools } from './mcp/tools.ts';
import { readFileSync } from 'node:fs';

const ARGS = {
  type: 'query',
  dataset_id: 'efgh-5678',
  portal: 'data.cityofnewyork.us',
  group: 'complaint_type',
} as const;

const RECORD_ID = 'record:data.cityofnewyork.us/erm2-nwe9/58273911';

test('#402: a rejected call and an answered call with the same arguments are different keys', () => {
  const answered = { name: 'get_data', args: { ...ARGS } };
  const rejected = { name: 'get_data', args: { ...ARGS }, failed: true, failureKind: 'unavailable' };

  assert.notEqual(
    canonicalizeToolCall(rejected as Parameters<typeof canonicalizeToolCall>[0]),
    canonicalizeToolCall(answered),
    'A call the source refused and a call that answered are being counted as the ' +
      'same tool call. Two replay runs that differ only in whether a request was ' +
      'refused then score a Jaccard overlap of 1, and the consistency attestation ' +
      'signs "highly_reproducible" over it. D2 = B: the failure belongs in the key, ' +
      'and the attestation states in its own text how it treats a rejected call.',
  );
});

test('#406: a rejected fetch discloses no record identifier in the notebook cell', () => {
  const call = {
    name: 'fetch',
    args: { id: RECORD_ID },
    reason: generateToolReason({ id: RECORD_ID }, 'fetch'),
    failed: true,
    failureKind: 'timeout',
  };

  const out = renderFetchToolCell(
    call as Parameters<typeof renderFetchToolCell>[0],
    { defaultPortal: null } as unknown as Parameters<typeof renderFetchToolCell>[1],
  );

  assert.notEqual(out, null, 'a failed fetch must still render a not-reproduced cell');
  const rendered = (out?.cells ?? [])
    .flatMap((cell) => (Array.isArray(cell.source) ? cell.source : [cell.source]))
    .join('');

  assert.doesNotMatch(
    rendered,
    /erm2-nwe9\/58273911|record:data\.cityofnewyork\.us/,
    'The rejected fetch cell renders the record identifier, which embeds a portal ' +
      'the call never reached, a dataset id and a row id — under a heading that has ' +
      'just said this step cannot be accounted for. It arrives through `call.reason`, ' +
      'which `generateToolReason` builds as `to look up <id>`. The rule is already ' +
      "written in `renderNotRerunnableStepCell`'s docstring; this renderer does not " +
      'honour it.\n\nRendered:\n' +
      rendered,
  );
});

// ---------------------------------------------------------------------------
// #406, D3 = A — the convergence assertion, and the property the two renderers
// are held to
// ---------------------------------------------------------------------------
//
// ADDED BY THE PHASE, not by the red above. The two assertions at the top of
// this file drive two pure functions in isolation; these drive ONE recorded call
// through BOTH notebook generators and assert the two documents against each
// other. That is the claim `renderNotRerunnableStepCell`'s docstring had been
// making in prose since #384 C2 — "the skeleton generator writes no argument for
// the same call for the same reason, which is what lets the two documents
// agree" — and it was false: the skeleton wrote no URL, and titled the step
// `## Step N: ${tool.reason}`, so it printed the same `record:` identifier in a
// heading. A claim that two documents agree is measurable, and until now it was
// only asserted.
//
// The fixtures are the shapes that can fail, and each says why:
//
//   - the rejected `fetch` carries a realistic `record:` identifier. A bare or
//     absent id could not show the leak.
//   - the rejected `get_data` names a dataset NOTHING ELSE IN THE RUN TOUCHES,
//     so "both documents name the dataset" cannot be satisfied by another
//     call's text, and the run also carries a successful call on a DIFFERENT
//     dataset so the two cannot be confused.
//   - one call carries no portal on a run with no portal, which is the only
//     shape in which the empty-backtick defect can appear.

/** The dataset the rejected call names, and no other call in the run does. */
const REJECTED_ONLY_DATASET = 'zzzz-9999';
/** A dataset a DIFFERENT, successful call names — so the two cannot be confused. */
const ANSWERED_DATASET = 'erm2-nwe9';

const NO_ATTRIBUTION = { origin: null, host: null, platformTitle: null };

/** Every markdown and code cell of a skeleton notebook, as one string. */
function skeletonText(calls: Parameters<typeof generateNotebook>[2], portal: string | null): string {
  return generateNotebook('Which complaint type leads?', portal, calls, 'An answer.', NO_ATTRIBUTION)
    .cells.map((cell) => cell.source.join(''))
    .join('\n');
}

/** The executed generator's cells for one call, as one string. */
function executedText(call: Parameters<typeof renderFetchToolCell>[0], defaultPortal: string): string {
  const out = renderFetchToolCell(call, { dataFrameIndex: 1, defaultPortal });
  assert.notEqual(out, null, 'a step must never render as nothing at all');
  return out!.cells.map((cell) => cell.source.join('')).join('\n');
}

const REJECTED_FETCH = {
  name: 'fetch',
  args: { id: RECORD_ID },
  reason: generateToolReason({ id: RECORD_ID }, 'fetch'),
  failed: true,
  failureKind: 'timeout',
} as const;

const REJECTED_GET_DATA = {
  name: 'get_data',
  operationType: 'query',
  args: {
    type: 'query',
    portal: 'data.cityofnewyork.us',
    dataset_id: REJECTED_ONLY_DATASET,
    group: 'complaint_type',
  },
  reason: generateToolReason(
    { type: 'query', dataset_id: REJECTED_ONLY_DATASET, group: 'complaint_type' },
    'get_data',
  ),
  failed: true,
  failureKind: 'unavailable',
} as const;

const ANSWERED_GET_DATA = {
  name: 'get_data',
  operationType: 'query',
  args: {
    type: 'query',
    portal: 'data.cityofnewyork.us',
    dataset_id: ANSWERED_DATASET,
    limit: 5,
  },
  reason: generateToolReason({ type: 'query', dataset_id: ANSWERED_DATASET }, 'get_data'),
  resultSummary: { rows: 5, columns: 3 },
} as const;

test('#406: the fixture really carries an identifier — otherwise nothing below can fail', () => {
  // The converse of a red never shown. Every assertion under this heading is
  // "no identifier reaches the document", and all of them are trivially true of
  // a record that never had one.
  assert.match(REJECTED_FETCH.reason, /record:/, 'the stored reason must carry a `record:` id');
  assert.match(REJECTED_FETCH.reason, /erm2-nwe9\/58273911/, 'including a dataset id and a row id');
  assert.equal(
    reasonWithoutIdentifier(REJECTED_GET_DATA.reason),
    REJECTED_GET_DATA.reason,
    'and the get_data reason must SURVIVE the filter, or "both documents agree" would ' +
      'be satisfied by a filter that drops everything',
  );
});

test('#406: one rejected fetch, both documents, neither names the record identifier', () => {
  const executed = executedText(REJECTED_FETCH, 'data.cityofnewyork.us');
  const skeleton = skeletonText([REJECTED_FETCH, ANSWERED_GET_DATA], 'data.cityofnewyork.us');

  for (const [document, text] of [['executed', executed], ['skeleton', skeleton]] as const) {
    assert.doesNotMatch(
      text,
      /record:/,
      `the ${document} notebook renders the record identifier under a step it has just ` +
        `said it cannot account for:\n${text}`,
    );
    assert.doesNotMatch(
      text,
      /58273911/,
      `the ${document} notebook renders the row id out of that identifier:\n${text}`,
    );
    assert.match(text, /Not reproduced/, `the ${document} notebook must still state the step`);
    assert.match(text, /fetch/, `and still name the tool`);
    assert.ok(
      text.includes(describeToolFailure('timeout')),
      `and give the failure in the shared vocabulary:\n${text}`,
    );
  }
});

test('#406: one rejected get_data, both documents disclose the same facts, each once', () => {
  const executed = executedText(REJECTED_GET_DATA, 'data.cityofnewyork.us');
  const skeleton = skeletonText([REJECTED_GET_DATA, ANSWERED_GET_DATA], 'data.cityofnewyork.us');

  // The one sentence both generators now build from `describeAttempt` — the
  // disclosure level decided once, so this cannot be satisfied by two
  // independently written phrases that happen to look alike today.
  const attempt = describeAttempt(
    { name: REJECTED_GET_DATA.name, args: REJECTED_GET_DATA.args },
    { dataFrameIndex: 1, defaultPortal: 'data.cityofnewyork.us' },
  );
  assert.match(attempt, /zzzz-9999/, 'fixture: the shared phrase must name the dataset');
  assert.match(attempt, /data\.cityofnewyork\.us/, 'fixture: and the portal');

  for (const [document, text] of [['executed', executed], ['skeleton', skeleton]] as const) {
    assert.ok(
      text.includes(attempt),
      `the ${document} notebook describes the rejected call in words of its own rather ` +
        `than the shared ones:\n${text}`,
    );
    assert.ok(
      text.includes(describeToolFailure('unavailable')),
      `the ${document} notebook must give the failure from the shared table:\n${text}`,
    );
  }

  // …and the executed generator's SENTENCE names the dataset once. It used to
  // name it twice — `describeAttempt`'s "the `zzzz-9999` dataset" and
  // `call.reason`'s "to aggregate dataset zzzz-9999 by complaint_type" — which
  // is why this drives a dataset no other call in the run touches.
  assert.equal(
    (executed.match(new RegExp(REJECTED_ONLY_DATASET, 'g')) ?? []).length,
    1,
    `the executed cell names the dataset once per fact, not once per phrase:\n${executed}`,
  );
  assert.doesNotMatch(
    executed,
    new RegExp(ANSWERED_DATASET),
    'and it names no dataset belonging to another call',
  );
});

test('#406: a rejected call on a run with no portal writes no empty source token', () => {
  // The one shape in which the empty-backtick defect appears: no portal on the
  // call AND none on the run. `api/query-notebook/route.ts` passes
  // `defaultPortal: portal ?? ''` for exactly this case, so it is reachable in
  // production, and every branch of `describeAttempt` used to interpolate the
  // empty string into a backticked slot — "tried to query the `zzzz-9999`
  // dataset on ``". An empty token in the position a source occupies is the
  // `unknown` defect (#342) one field over.
  const portalless = {
    name: 'get_data',
    operationType: 'query',
    args: { type: 'query', dataset_id: REJECTED_ONLY_DATASET },
    reason: generateToolReason({ type: 'query', dataset_id: REJECTED_ONLY_DATASET }, 'get_data'),
    failed: true,
    failureKind: 'unavailable',
  } as const;

  const executed = executedText(portalless, '');
  const skeleton = skeletonText([portalless], null);

  for (const [document, text] of [['executed', executed], ['skeleton', skeleton]] as const) {
    assert.doesNotMatch(
      text,
      /``/,
      `the ${document} notebook renders an empty backticked token where a source goes:\n${text}`,
    );
    assert.match(text, /zzzz-9999/, `the ${document} notebook still names what it can`);
  }
});

test('#406: no advertised tool can put an identifier into a document through its reason', () => {
  // The property, not the constant. `fetch` is the only branch of
  // `generateToolReason` that interpolates an identifier TODAY; a guard written
  // against that name would pass on the day another branch writes one, which is
  // the failure CLAUDE.md records twice. So this drives EVERY tool name the
  // repository advertises to the model, with an `id` argument carrying a
  // realistic record identifier, and asserts the filter over the result.
  //
  // BLIND SPOT, stated: this reads the tool NAMES off the advertised schemas and
  // supplies one argument shape. It is a drift guard over the reason vocabulary,
  // not a proof about every argument any tool may take.
  const names = mcpTools
    .filter((tool): tool is Extract<typeof tool, { type: 'function' }> => tool.type === 'function')
    .map((tool) => tool.function.name);
  assert.ok(names.length > 1, 'the tool list must really have been read');
  assert.ok(names.includes('fetch'), 'including the one whose branch writes an identifier');

  for (const name of names) {
    const reason = generateToolReason({ id: RECORD_ID }, name);
    const safe = reasonWithoutIdentifier(reason);
    assert.ok(
      safe === undefined || !safe.includes('record:'),
      `\`${name}\`'s reason phrase carries an identifier that survives the filter: ${reason}`,
    );
  }

  // And in the other direction — a filter that drops everything would pass the
  // loop above and disclose nothing. A phrase carrying no identifier survives.
  const plain = generateToolReason({ type: 'query', dataset_id: ANSWERED_DATASET }, 'get_data');
  assert.equal(reasonWithoutIdentifier(plain), plain, 'a phrase with no identifier is kept whole');
  // Including one whose free text carries a colon: a reader's own search phrase
  // is what was asked, not a source that was reached, and it is quoted.
  const searchy = generateToolReason({ type: 'catalog', query: 'https://example.gov outage' }, 'get_data');
  assert.equal(reasonWithoutIdentifier(searchy), searchy, 'a quoted search phrase is not an identifier');
});

// ---------------------------------------------------------------------------
// #402 — the metric, and the bytes of a package that was already signed
// ---------------------------------------------------------------------------
//
// The key assertion at the top of this file leaves the METRIC unmeasured, and
// the metric is what is signed and shown. `computeConsistencyMetrics` could not
// be driven at all when the red was written: it lived inside
// `AttestationDialog.tsx`, and no `.test.ts` in this tree can import a `.tsx`.
// The phase lifted it into `evidence/consistency-metrics.ts` unchanged; this is
// the drive that lift exists for.

import {
  computeConsistencyMetrics,
  type ReplayResult,
} from './evidence/consistency-metrics.ts';
import { REJECTED_CALL_KEY_SUFFIX, TOOL_CALL_KEY_POLICY } from './evidence/tool-call-identity.ts';
import { execFileSync } from 'node:child_process';

/** A run of two calls, one of which may have been refused. */
function run(refusedSecond: boolean): ReplayResult {
  return {
    toolCalls: [
      { name: 'get_data', args: { ...ARGS, dataset_id: ANSWERED_DATASET } },
      refusedSecond
        ? { name: 'get_data', args: { ...ARGS }, failed: true, failureKind: 'unavailable' }
        : { name: 'get_data', args: { ...ARGS } },
    ],
    output: 'Noise led with 4,812 reports.',
    tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    durationMs: 1000,
  };
}

test('#402: two runs differing ONLY in a refusal are not scored as identical', () => {
  const answered = run(false);
  const refused = run(true);

  // The fixture is the shape that can fail: the two runs differ in `failed` and
  // in nothing else. Same tool, same arguments, same output text — so the output
  // half of the score is 1 in both directions and the tool half is the only
  // thing under test. A pair differing in arguments would prove nothing, because
  // the key has separated those since #363.
  assert.deepEqual(
    answered.toolCalls.map((c) => c.args),
    refused.toolCalls.map((c) => c.args),
    'fixture: the two runs must be argument-identical',
  );
  assert.equal(answered.output, refused.output, 'fixture: and output-identical');

  const mixed = computeConsistencyMetrics([answered, refused]);
  assert.notEqual(
    mixed.toolCallOverlap,
    1,
    'a run that read a source and a run that was refused it score a Jaccard overlap ' +
      `of 1: ${JSON.stringify(mixed)}`,
  );
  assert.notEqual(
    mixed.consistencyClassification,
    'highly_reproducible',
    'and a signed attestation calls that pair highly reproducible: ' +
      JSON.stringify(mixed),
  );

  // The other direction, so the change cannot be a filter that just lowers every
  // score: two runs that BOTH answered still score 1 and are still classified
  // highly reproducible.
  const both = computeConsistencyMetrics([run(false), run(false)]);
  assert.equal(both.toolCallOverlap, 1, `two identical answered runs must still score 1: ${JSON.stringify(both)}`);
  assert.equal(both.consistencyClassification, 'highly_reproducible', JSON.stringify(both));
  // …and so do two runs that were BOTH refused the same request: a reproducible
  // refusal is reproducible.
  const neither = computeConsistencyMetrics([run(true), run(true)]);
  assert.equal(neither.toolCallOverlap, 1, `two identically refused runs are reproducible: ${JSON.stringify(neither)}`);
});

test('#402: an answered call keeps a byte-identical key, and cannot collide with a rejected one', () => {
  // The suffix is what keeps a past attestation's stored keys comparable with a
  // new one for the calls that succeeded. If the format changed for every call,
  // this pin — which predates the phase, in `evidence/tool-call-identity.test.ts`
  // — would have had to be rewritten, and that rewrite is the kind of change
  // that hides a real one.
  assert.equal(
    canonicalizeToolCall({
      name: 'get_data',
      args: { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us' },
    }),
    'get_data:{"dataset_id":"erm2-nwe9","portal":"data.cityofnewyork.us","type":"query"}',
    'an answered call\'s key must not have moved',
  );
  const rejected = canonicalizeToolCall({
    name: 'get_data',
    args: { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us' },
    failed: true,
  });
  assert.ok(rejected.endsWith(REJECTED_CALL_KEY_SUFFIX), rejected);
  // No answered call's key can end in the suffix: `jcs()` of an object always
  // ends in `}`. Driven over a call whose ARGUMENT VALUE is the suffix itself,
  // which is the only way a serialisation could be made to contain it.
  const adversarial = canonicalizeToolCall({
    name: 'get_data',
    args: { where: REJECTED_CALL_KEY_SUFFIX },
  });
  assert.ok(
    !adversarial.endsWith(REJECTED_CALL_KEY_SUFFIX),
    `an answered call was made to look rejected: ${adversarial}`,
  );
});

/**
 * Every non-test file allowed to compute a tool-call identity key, with why.
 *
 * A LIST, because the question "does an already-signed package's bytes move?"
 * has only one mechanical answer: a stored key is a string inside stored bytes,
 * and it moves only if something RECOMPUTES it. A hash pinned over a literal
 * package cannot see that — `sha256(JSON.stringify(x))` is a constant of the
 * fixture, not of this repository — so what is measured here is the thing that
 * would actually change the answer: who calls the function at all.
 *
 * Both directions, like `model-loop/model-call-registry.test.ts`: a caller that
 * is not listed fails, and a listed file that no longer calls it fails too.
 */
const ALLOWED_KEY_CALLERS: Record<string, string> = {
  'src/lib/evidence/consistency-metrics.ts':
    'Submission time, from a live replay. The one place a key is computed for a score.',
  'src/components/evidence/AttestationDialog.tsx':
    'Submission time. Writes the computed keys into the package that is then hashed and signed.',
};

test('#402: nothing recomputes a key off a stored package, so signed bytes cannot move', () => {
  // Driven against production on 2026-09-05, and reported with the phase: a
  // stored attestation package fetched from blob storage re-hashes to its own
  // stored `packageHash` byte for byte — the hash is over stored bytes — and of
  // 34 published records ZERO carry a consistency attestation, so no signed
  // package in production contains a `toolCallKeys` array at all. Neither of
  // those facts is stable: a consistency attestation can be published tomorrow.
  // The mechanism is what makes the answer stable, and this is the mechanism.
  const tracked = execFileSync('git', ['ls-files', '-z', '--full-name'], {
    cwd: new URL('../..', import.meta.url).pathname,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter((f) => /\.(c|m)?[jt]sx?$/.test(f) && !/\.test\.(c|m)?[jt]sx?$/.test(f));
  assert.ok(tracked.length > 50, 'the scan found almost no source files — it has stopped measuring');

  const repoRoot = new URL('../..', import.meta.url).pathname;
  const callers = tracked.filter((file) => {
    let source: string;
    try {
      source = readFileSync(repoRoot + file, 'utf8');
    } catch {
      return false; // tracked but deleted from the working tree
    }
    // The IMPORT, and two earlier probes are why. `canonicalizeToolCall(` misses
    // `consistency-metrics.ts`, which passes it point-free as
    // `.map(canonicalizeToolCall)` — a probe that cannot see the one real caller
    // would have passed this whole test while measuring nothing. A bare
    // word-boundary match then caught `model-loop/replay-loop.ts`, which only
    // DISCUSSES the key in its header. What separates having the function from
    // mentioning it is importing it, so that is what is matched.
    return /import[\s\S]{0,200}?\bcanonicalizeToolCall\b[\s\S]{0,200}?from/.test(source);
  });

  for (const file of callers) {
    assert.ok(
      file in ALLOWED_KEY_CALLERS,
      `${file} computes a tool-call identity key and is not on the list in ` +
        'rejected-call-is-not-an-answer.test.ts. If it recomputes one off a STORED package, ' +
        'the keys inside signed bytes are no longer the keys they were signed over.',
    );
  }
  for (const file of Object.keys(ALLOWED_KEY_CALLERS)) {
    assert.ok(
      callers.includes(file),
      `${file} is listed as computing a key but no longer does — a stale list is a false ` +
        'statement about the tree, and this one is load-bearing.',
    );
  }

  // The import probe cannot see a SECOND COPY of the function, which is the
  // shape #345 found three times. So the definition is counted separately: one
  // module declares it, and a re-declaration anywhere fails here rather than
  // quietly keying half the application differently.
  const definers = tracked.filter((file) => {
    try {
      return /function\s+canonicalizeToolCall\b/.test(readFileSync(repoRoot + file, 'utf8'));
    } catch {
      return false;
    }
  });
  assert.deepEqual(
    definers,
    ['src/lib/evidence/tool-call-identity.ts'],
    'the tool-call identity key is declared in more than one place, or has moved',
  );
});

test('#402: the attestation states in its own text how it treats a rejected call', () => {
  // The second half of D2 = B, and not garnish: the same two runs score
  // differently under the old rule and the new one, so a number with no rule
  // beside it is not a claim a reader can check. One string, rendered beside the
  // score AND submitted inside the signed package.
  assert.match(TOOL_CALL_KEY_POLICY, /refused/, TOOL_CALL_KEY_POLICY);
  assert.match(TOOL_CALL_KEY_POLICY, /different tool call/, TOOL_CALL_KEY_POLICY);

  const dialog = readFileSync(
    new URL('../components/evidence/AttestationDialog.tsx', import.meta.url),
    'utf8',
  );
  assert.match(
    dialog,
    /TOOL_CALL_KEY_POLICY/,
    'the dialog neither shows the rule nor records it',
  );
  assert.match(
    dialog,
    /toolCallKeyPolicy: TOOL_CALL_KEY_POLICY/,
    'the rule is shown to a reader but not written into the signed package',
  );
  // …and it is the shared constant, not a second copy of the sentence.
  assert.ok(
    !dialog.includes('counts as a different tool call'),
    'the sentence is restated in the dialog rather than imported — two copies drift',
  );
});
