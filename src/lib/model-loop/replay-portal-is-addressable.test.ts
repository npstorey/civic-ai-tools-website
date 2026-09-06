/**
 * A replay runs on a portal its own `get_data` could address, or on none
 * (P7 cold read, F1).
 *
 * `replayPortalForPackage` falls back to the first `dataSources[]` entry's
 * `portalUrl` with the scheme stripped, and looks at nothing else. A package
 * whose only data source is an aggregate or a CKAN catalogue therefore replays
 * with that server's endpoint standing in for a Socrata portal:
 *
 *     dataSources: [{ catalogType: 'data-commons',
 *                     portalUrl: 'https://api.datacommons.org/mcp' }]
 *       -> 'api.datacommons.org/mcp'
 *
 * That value is not inert. The replay route hands it to `buildSystemPrompt`,
 * which writes "Default portal: api.datacommons.org/mcp" into the model's
 * instructions, and to `runToolLoop` as `portal`, which injects it into any
 * `get_data` that omits one — so it reaches the recorded arguments, the span's
 * `tool.portal_domain`, and through `canonicalizeToolCall` a signed consistency
 * attestation. A host no Socrata call could ever have addressed ends up named
 * as the one the replay ran against.
 *
 * WHY THE EXISTING TEST DOES NOT SEE IT. `replay-portal.test.ts` drives two
 * shapes: `dataSources: []`, and one entry whose `portalUrl` is a Socrata host.
 * Both are shapes on which the fallback is correct. The one shape that makes it
 * wrong — an entry that is not a Socrata catalogue — is not among them, so the
 * test is green over exactly the cases where the code works and blind to the
 * case where it does not. This file drives all three catalogue types.
 *
 * THE PROPERTY, NOT THE CONSTANT. The rule is not "reject two known strings".
 * It is that the replay portal must be a portal a `get_data` call can address —
 * a Socrata catalogue. `data-commons` is reached by `get_observations` and
 * `ckan` by `ckan__execute_sql`; neither takes a Socrata portal, so neither can
 * supply one. A fourth catalogue type added tomorrow is not addressable by
 * `get_data` either until something says it is, and the assertion below is
 * written so that adding one does not silently widen the fallback.
 *
 * `catalogType` is the discriminator the published packages actually carry
 * (measured over live records: `socrata`, `data-commons`, `ckan`), and it is
 * read nowhere in this repository's non-test source today.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getDataAddressableCatalogTypes,
  isGetDataAddressableSource,
  replayPortalForPackage,
} from './replay-loop.ts';

type Pkg = Parameters<typeof replayPortalForPackage>[0];

/** A package that named no portal on any call — the shape the fallback exists for. */
function packageWithSource(catalogType: string, portalUrl: string): Pkg {
  return {
    queries: [{}, {}],
    dataSources: [{ catalogType, portalUrl }],
  } as unknown as Pkg;
}

test('an aggregate-only record replays on no portal, not on the aggregate endpoint', () => {
  assert.equal(
    replayPortalForPackage(
      packageWithSource('data-commons', 'https://api.datacommons.org/mcp'),
    ),
    undefined,
    'A Data Commons endpoint is being handed to a replay as a Socrata portal. It ' +
      'reaches the system prompt ("Default portal: …"), then every `get_data` the ' +
      'replay makes without a portal of its own, then the recorded arguments and a ' +
      'signed consistency attestation. `get_observations` reaches this source, not ' +
      '`get_data`; a record whose only source is aggregate named no Socrata portal ' +
      'and must replay with none.',
  );
});

test('a CKAN-only record replays on no portal either', () => {
  assert.equal(
    replayPortalForPackage(packageWithSource('ckan', 'https://data.boston.gov')),
    undefined,
    'A CKAN catalogue host is being handed to a replay as a Socrata portal. It is ' +
      'reached by `ckan__execute_sql`, not by `get_data`, so it cannot be the portal ' +
      'a replayed `get_data` runs against — and unlike the aggregate case this one ' +
      'looks like an ordinary open-data hostname, which is exactly why it needs an ' +
      'assertion rather than a reader noticing.',
  );
});

test('a Socrata record still replays on its own portal', () => {
  assert.equal(
    replayPortalForPackage(
      packageWithSource('socrata', 'https://data.cityofnewyork.us'),
    ),
    'data.cityofnewyork.us',
    'the fallback must keep working for the catalogue a replayed `get_data` can address',
  );
});

test('a portal the record itself named still wins over any data source', () => {
  const pkg = {
    queries: [{ portal: 'data.sfgov.org' }],
    dataSources: [{ catalogType: 'data-commons', portalUrl: 'https://api.datacommons.org/mcp' }],
  } as unknown as Pkg;

  assert.equal(
    replayPortalForPackage(pkg),
    'data.sfgov.org',
    "the loop's own record of the portal is the first source of truth and is unaffected",
  );
});

test('an unrecognised catalogue type supplies no portal', () => {
  assert.equal(
    replayPortalForPackage(packageWithSource('some-future-catalogue', 'https://example.org')),
    undefined,
    'A catalogue type this repository does not know is not known to be addressable ' +
      'by `get_data`. Defaulting to "usable" is how the aggregate endpoint got in; ' +
      'a new type must be admitted deliberately, not inherited by silence.',
  );
});

// --- Added by the fix: the derivation itself, so it cannot go quiet ---------
//
// The predicate the four cases above exercise reads a set DERIVED from two
// registries rather than a literal list: `sourceIdForToolName('get_data')`
// (the app's MCP layer, which knows the source that hosts the tool) indexed
// into `CIVIC_SOURCE_REGISTRY` (which knows that source's `catalogType`). That
// shape is what makes an unrecognised type inadmissible by construction —
// nothing has to remember to add it to a blocklist.
//
// It also has a failure mode the five cases above cannot see. If either
// registry stops answering — the tool renamed, the source id changed, the
// registry re-keyed — the set is EMPTY, and every assertion above still
// passes: four of them expect `undefined`, and the fifth reads a portal off
// `queries[]` without consulting the set at all. The only case that would turn
// red is 'a Socrata record still replays on its own portal', which is exactly
// why the contract called that one load-bearing. This case states the
// derivation's result directly so the diagnosis is one line rather than an
// inference from a portal that went missing.

test('the addressable set is derived, non-empty, and is exactly the catalogue type get_data addresses', () => {
  const derived = getDataAddressableCatalogTypes();
  assert.deepEqual(
    [...derived].sort(),
    ['socrata'],
    'The set a replay portal must belong to is empty or has grown. Empty means one of the two ' +
      'registries stopped answering (`sourceIdForToolName(\'get_data\')`, or that source id in ' +
      'CIVIC_SOURCE_REGISTRY) and every replay has silently stopped injecting a portal. Grown means ' +
      'a second catalogue type is now reachable by `get_data` — which may well be right, and is a ' +
      'line of this test to change deliberately, which is the whole point.',
  );
});

test('the predicate reads the entry’s own catalogType and admits nothing else', () => {
  assert.equal(isGetDataAddressableSource({ catalogType: 'socrata' }), true);
  assert.equal(isGetDataAddressableSource({ catalogType: 'data-commons' }), false);
  assert.equal(isGetDataAddressableSource({ catalogType: 'ckan' }), false);
  assert.equal(isGetDataAddressableSource({ catalogType: 'some-future-catalogue' }), false);
  assert.equal(
    isGetDataAddressableSource({}),
    false,
    'an entry that states no catalogue type states nothing about addressability',
  );
});
