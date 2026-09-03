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
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/model-loop/replay-portal.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as replayLoop from './replay-loop.ts';

type ReplayPortalForPackage = (pkg: {
  dataSources: { portalUrl?: string }[];
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
    dataSources: [{ portalUrl: 'https://data.sfgov.org' }],
    queries: [{}],
  });
  assert.equal(portal, 'data.sfgov.org');
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
