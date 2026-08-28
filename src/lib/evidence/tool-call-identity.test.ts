// The tool-call identity key a signed consistency attestation is built from.
//
// WHY THIS FILE EXISTS. The key used to be a private function inside
// `AttestationDialog.tsx`, and a verbatim copy of it lived in
// `replay-loop.test.ts` under a comment saying the copy going stale would be
// "the loud failure" — because no `.test.ts` in this tree imports a `.tsx`, so
// the real function had no test at all. Two implementations that can drift is
// not a guard; it is the defect wearing a guard's clothes. The function now
// lives in `./tool-call-identity.ts`, the dialog and the tests both import it,
// and this file is the only place its behaviour is asserted.
//
// THE PROPERTY. Any difference in a tool call's arguments must produce a
// different key. The old key was a hand-picked field list
// (`name:type:dataset_id:portal`), and a hand-picked list is exactly what
// failed — twice over: `search` and `fetch` carry none of those four fields,
// and `where` was never in the list even for `get_data`. Both cases are below.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/evidence/tool-call-identity.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeToolCall } from './tool-call-identity.ts';

/** A replay run, as `AttestationDialog` reads it off `/api/records/:slug/replay`. */
type Run = { name: string; args: Record<string, unknown> }[];

/** The key SET of a run — what `computeConsistencyMetrics` compares pairwise. */
const keysOf = (run: Run): Set<string> => new Set(run.map(canonicalizeToolCall));

const sameSet = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every(k => b.has(k));

// --- RED 1: two different searches -----------------------------------------
//
// Ruling D9 made `search` and `fetch` model-callable. Their schemas are narrow
// on purpose: `search` takes only `query`, `fetch` only `id`. Neither carries
// `type`, `dataset_id` or `portal`, so under the old key every search
// collapsed to `search:::` and every fetch to `fetch:::`. Two runs that
// searched for entirely different things produced identical key sets, Jaccard
// returned 1, and `(1 + outputSimilarity)/2 >= 0.9` classified them
// `highly_reproducible` — in a SIGNED consistency attestation rendering
// "Tool overlap: 100%".

test('two searches for different phrases are two different keys', () => {
  const noise = canonicalizeToolCall({ name: 'search', args: { query: 'noise complaints' } });
  const rats = canonicalizeToolCall({ name: 'search', args: { query: 'rat sightings' } });
  assert.notEqual(noise, rats, 'a search key must carry the phrase that was searched for');
});

test('two fetches of different identifiers are two different keys', () => {
  const a = canonicalizeToolCall({ name: 'fetch', args: { id: 'dataset:data.cityofnewyork.us:erm2-nwe9' } });
  const b = canonicalizeToolCall({ name: 'fetch', args: { id: 'dataset:data.cityofnewyork.us:zzzz-9999' } });
  assert.notEqual(a, b, 'a fetch key must carry the identifier that was fetched');
});

test('two runs that searched for different things do not have identical key sets', () => {
  // The cold read's fixture, verbatim. Identical key sets are Jaccard 1 by
  // definition (|A ∩ B| / |A ∪ B| with A === B), which is the input that made
  // the classification `highly_reproducible`.
  const runA: Run = [
    { name: 'search', args: { query: 'noise complaints' } },
    { name: 'fetch', args: { id: 'dataset:data.cityofnewyork.us:erm2-nwe9' } },
  ];
  const runB: Run = [
    { name: 'search', args: { query: 'rat sightings' } },
    { name: 'fetch', args: { id: 'dataset:data.cityofnewyork.us:zzzz-9999' } },
  ];
  assert.equal(
    sameSet(keysOf(runA), keysOf(runB)),
    false,
    'two runs that read different data must not present as one repeated run',
  );
});

// --- RED 2: the same dataset, a different `where` ---------------------------
//
// The half the wave did not cause. `where` was never in the key, so two
// `get_data` calls against the same dataset on the same portal filtering for
// different things have been indistinguishable since the key was written. This
// is why the fix is property-shaped — a patch that added `query` and `id` to
// the field list would leave this case exactly as it is.

test('the same dataset with different WHERE clauses is two different keys', () => {
  const base = { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us' };
  const noise = canonicalizeToolCall({ name: 'get_data', args: { ...base, where: "complaint_type='Noise - Residential'" } });
  const rodent = canonicalizeToolCall({ name: 'get_data', args: { ...base, where: "complaint_type='Rodent'" } });
  assert.notEqual(noise, rodent, 'a filter that changes the rows must change the key');
});

test('every other argument that changes the rows changes the key', () => {
  const base = { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us' };
  const reference = canonicalizeToolCall({ name: 'get_data', args: base });
  for (const [key, value] of Object.entries({
    select: 'complaint_type, COUNT(*)',
    where: "created_date > '2024-01-01'",
    group: 'complaint_type',
    order: 'count DESC',
    limit: 10,
    offset: 100,
    query: 'SELECT complaint_type',
  })) {
    assert.notEqual(
      canonicalizeToolCall({ name: 'get_data', args: { ...base, [key]: value } }),
      reference,
      `adding ${key} must change the key`,
    );
  }
});

// --- The properties the key must hold ---------------------------------------

test('the tool name still discriminates', () => {
  assert.notEqual(
    canonicalizeToolCall({ name: 'search', args: { query: 'x' } }),
    canonicalizeToolCall({ name: 'ckan__search_datasets', args: { query: 'x' } }),
  );
});

test('two identical calls are one key, whatever order the model wrote the arguments in', () => {
  // Not cosmetic. A tool call\'s arguments arrive as `JSON.parse` of whatever
  // the endpoint emitted, and object key order is preserved by that parse. Two
  // genuinely identical calls written in different orders must not read as two
  // different calls — that failure runs the other way, scoring a reproducible
  // run as inconsistent, and it is just as false.
  const a = canonicalizeToolCall({ name: 'get_data', args: { type: 'query', dataset_id: 'erm2-nwe9', limit: 5 } });
  const b = canonicalizeToolCall({ name: 'get_data', args: { limit: 5, dataset_id: 'erm2-nwe9', type: 'query' } });
  assert.equal(a, b);
});

test('a nested argument value is compared by content, not by the order it was written in', () => {
  const a = canonicalizeToolCall({ name: 'ckan__query_data', args: { filters: { b: 1, a: 2 } } });
  const b = canonicalizeToolCall({ name: 'ckan__query_data', args: { filters: { a: 2, b: 1 } } });
  assert.equal(a, b);
  const c = canonicalizeToolCall({ name: 'ckan__query_data', args: { filters: { a: 2, b: 3 } } });
  assert.notEqual(a, c, 'a nested value that differs must still change the key');
});

test('array order is significant — it changes what was asked for', () => {
  const a = canonicalizeToolCall({ name: 'ckan__aggregate_data', args: { fields: ['a', 'b'] } });
  const b = canonicalizeToolCall({ name: 'ckan__aggregate_data', args: { fields: ['b', 'a'] } });
  assert.notEqual(a, b);
});

test('a call with no arguments is a key, not a crash', () => {
  assert.equal(typeof canonicalizeToolCall({ name: 'search', args: {} }), 'string');
});

test('the name and the arguments cannot be confused for one another', () => {
  // The serialisation of an argument object always starts with `{`, so the
  // first `:` that precedes a `{` is unambiguously the separator even for a
  // tool name that contained one. Stated as a test because the old format —
  // four `:`-joined free-text fields — did not have this property.
  const a = canonicalizeToolCall({ name: 'a:b', args: {} });
  const b = canonicalizeToolCall({ name: 'a', args: { 'b:': {} } });
  assert.notEqual(a, b);
});

// --- Criterion 14, restated for the new format ------------------------------
//
// N7 pinned `toolCallKeys` byte-identical WITH THE INJECTED PORTAL INTACT.
// This phase's ruling supersedes the format that pin was written against; what
// must not change is that a `get_data` key still reflects the portal the loop
// core injected. The end-to-end version of this — the portal injected by the
// real loop, through the real replay options — is in `replay-loop.test.ts`.

test('an injected portal is part of the key, and a different portal is a different key', () => {
  const nyc = canonicalizeToolCall({
    name: 'get_data',
    args: { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.cityofnewyork.us' },
  });
  const sf = canonicalizeToolCall({
    name: 'get_data',
    args: { type: 'query', dataset_id: 'erm2-nwe9', portal: 'data.sfgov.org' },
  });
  assert.equal(nyc, 'get_data:{"dataset_id":"erm2-nwe9","portal":"data.cityofnewyork.us","type":"query"}');
  assert.notEqual(nyc, sf, 'the same query against two portals read two different sources');
});

test('a call that carries no portal is not given one', () => {
  const key = canonicalizeToolCall({ name: 'search', args: { query: 'noise complaints' } });
  assert.equal(key, 'search:{"query":"noise complaints"}');
  assert.ok(!key.includes('portal'), 'nothing in the key may name a source the call did not carry');
});
