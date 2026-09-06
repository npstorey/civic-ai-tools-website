// P3 red instrument, Wave N9 (#384), family F2, the replay: a replay does not
// invent a portal for a record whose data sources and queries name none.
//
// WHAT WAS MEASURED AT d81eb76. `src/app/api/evidence/[slug]/replay/route.ts:107`
// derives the portal a replay runs on as
//
//     pkg.dataSources[0]?.portalUrl?.replace('https://', '') || 'data.cityofnewyork.us'
//
// and hands it to `buildSystemPrompt` and, through `replayLoopOptions`, to the
// loop as the portal injected into every `get_data` call that omits one. A
// record whose only calls were `search`/`fetch` has no data-source entry
// (the harness emits dataset-keyed entries only), so the replay of such a
// record runs on a literal domain the record never mentioned — live today,
// per the G3 record — and the identity keys of the replayed calls carry that
// domain into a consistency attestation that is then signed.
//
// THE PROPOSED SEAM. `replay-loop.ts` is where everything the loop is GIVEN
// already lives, under relative imports a test can reach, and its header
// lists "the portal derivation" among what the route still owns. Stage 2
// moves that derivation here as `replayPortalForPackage(pkg)`: the first
// portal the record's own `queries[]` named (the loop's record, app-side),
// else the first data source's portal, else `undefined` — and the route
// consults it instead of the literal. What a replay does with `undefined`
// (no injection; a system prompt composed for no particular portal) is the
// route's to decide honestly, and is not asserted here.
//
// Red at the base by the export's absence, and by the literal in the route.
//
// AMENDED BY WAVE N10 P8 (#409, cold-read F1) — THIS FILE'S OWN BLIND SPOT.
// As first written, the two data-source cases below drove `dataSources: []`
// and one entry whose `portalUrl` was a Socrata host and which stated no
// `catalogType` at all. Both are shapes on which the fallback was CORRECT, so
// this file was green over exactly the cases where the code worked and had no
// case at all for the one that made it wrong: an entry from a source
// `get_data` cannot address, whose endpoint was then handed to a replay as a
// Socrata portal (measured live on 5 of 34 published records). The missing
// shape is driven in `replay-portal-is-addressable.test.ts`; what changes HERE
// is that the third case now STATES the catalogue type it always meant —
// `socrata`, the entry a `get_data` call can address — instead of leaving it
// unsaid and passing for a reason it did not intend, and a fourth case pins
// what an entry that states no type does. That is not a weakened assertion: it
// is the same claim, made about a fixture that says which shape it is.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-loop/replay-portal.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as replayLoop from './replay-loop.ts';

type ReplayPortalForPackage = (pkg: {
  dataSources: { catalogType?: string; portalUrl?: string }[];
  queries: { portal?: string; [key: string]: unknown }[];
}) => string | undefined;

function replayPortalForPackage(): ReplayPortalForPackage {
  const fn = (replayLoop as unknown as Record<string, unknown>).replayPortalForPackage;
  assert.equal(
    typeof fn,
    'function',
    'replay-loop.ts does not export replayPortalForPackage — the route derives the portal inline, ' +
      'with a literal domain as its fallback (replay/route.ts:107)',
  );
  return fn as ReplayPortalForPackage;
}

test('replay: replayPortalForPackage is exported from replay-loop.ts', () => {
  replayPortalForPackage();
});

test('replay: a record whose data sources and queries name no portal replays with none — never a literal domain', () => {
  const portal = replayPortalForPackage()({
    dataSources: [],
    queries: [
      { tool: 'search', operationType: 'search', arguments: { query: 'noise complaints' } },
      { tool: 'fetch', operationType: 'unknown', arguments: { id: 'record:abcd' } },
    ],
  });
  assert.equal(portal, undefined, 'the record named no portal, so the replay has none to run on');
});

test('replay: the portal a record’s own query named is the portal its replay runs on', () => {
  const portal = replayPortalForPackage()({
    dataSources: [],
    queries: [{ portal: 'data.sfgov.org' }],
  });
  assert.equal(portal, 'data.sfgov.org');
});

test('replay: a record with a data-source entry and no query portal replays on that source’s portal', () => {
  const portal = replayPortalForPackage()({
    dataSources: [{ catalogType: 'socrata', portalUrl: 'https://data.sfgov.org' }],
    queries: [{}],
  });
  assert.equal(portal, 'data.sfgov.org');
});

test('replay: a data-source entry that states no catalogue type supplies no portal', () => {
  const portal = replayPortalForPackage()({
    dataSources: [{ portalUrl: 'https://data.sfgov.org' }],
    queries: [{}],
  });
  assert.equal(
    portal,
    undefined,
    'An entry that states no catalogType states nothing about whether a `get_data` call could ' +
      'address its portalUrl, and is read exactly like one stating a type this repository does not ' +
      'know: not known to be addressable, so no portal. Coercing absence to `socrata` — the way ' +
      '`displayNameForSource` coerces a missing sourceId for pre-M9.3 packages — would be the same ' +
      'admission-by-silence the aggregate endpoint got in through, bought for a shape that does not ' +
      'exist: all 39 dataSources entries across the 34 records published at the reference ' +
      'deployment on 2026-09-06 carry a catalogType, and `DataSourceEntry` requires one. The cost ' +
      'of being wrong here is a replay with no portal injected — which is what a record that named ' +
      'no portal already gets — against a signed attestation naming a host nothing addressed.',
  );
});

// --- The route, which node --test cannot invoke -----------------------------

test('replay: the route consults replayPortalForPackage and carries no portal literal of its own', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../app/api/evidence/[slug]/replay/route.ts', import.meta.url)),
    'utf8',
  );
  assert.ok(
    !/['"]data\.cityofnewyork\.us['"]/.test(source),
    'replay/route.ts still names a literal portal domain as the fallback for a record that named none',
  );
  assert.ok(source.includes('replayPortalForPackage('), 'replay/route.ts derives the portal through replayPortalForPackage');
});
