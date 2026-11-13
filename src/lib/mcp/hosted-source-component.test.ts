// #617 P4 criterion 3 (C4) — a hosted source's `components[]` entry states
// the version the instance ran: the pinned package version and its commit, in
// semver build-metadata form (ADR-0033 §E: one optional `version` string, "a
// server's reported version, or a pinned commit").
//
// For NYC Charter, Laws and Rules that is `0.3.1+b784cb763ec0`: the manifest's
// `hosting.version`, `+`, and the first 12 hex digits of `hosting.commit`. It
// comes from the hosting field, never from the server's `serverInfo`, so it
// moves only with the pin. Since S2-B P3R the client keeps each server's
// `serverInfo`, and a remote server's report is stated beside `id` as
// `reportedName` and `reportedVersion`, never in `version` and never on a
// hosted entry (the last case below). The entry carries no
// `guidanceHash` and no `guidanceOrigin`: the source's guidance is `''`, so it
// contributed no block, and composing the prompt never asks it for one (which
// would wake its sandbox).
//
// THE SHAPE THAT CAN FAIL. Composition runs with every source on and every
// request refused, so the three addressed sources' entries are composed on
// the fallback path beside Charter's; the assertion is over Charter's entry
// exactly (a missing version, or a guidance field, fails), and the three
// addressed entries are held to carry no version (a version added to every
// source fails too).
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/hosted-source-component.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIVIC_MANIFEST, NYC_CHARTER_HOSTING } from '@typedstandards/civic-typed-router';
import type { McpRegistryEnv } from './registry.ts';

const fetched: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetched.push(String(input instanceof Request ? input.url : input));
  throw new TypeError('fetch failed');
}) as typeof fetch;

const { composeSystemPrompt } = await import('./socrata-skill.ts');
const { withReportedKeys } = await import('./client.ts');

const CHARTER_ON: McpRegistryEnv = {
  socrataUrl: 'http://socrata.invalid/mcp',
  dataCommonsUrl: 'http://data-commons.invalid/mcp',
  bostonOpencontextUrl: 'http://boston.invalid/mcp',
  nycCharterHosting: 'sandbox',
};
const CHARTER = CIVIC_MANIFEST.find((entry) => entry.sourceId === 'nyc-charter')!;

test('premise: the pin is 0.3.1 at b784cb7…', () => {
  assert.equal(NYC_CHARTER_HOSTING.version, '0.3.1');
  assert.equal(NYC_CHARTER_HOSTING.commit, 'b784cb763ec0d953139eef4ed366e8ec4de72625');
});

test('C4: Charter\'s components[] entry is its id and the version 0.3.1+b784cb763ec0, and no guidance fields', async () => {
  const composed = await composeSystemPrompt({ configured: CHARTER_ON, now: new Date('2026-10-16T12:00:00Z') });
  const entry = composed.components.find((component) => component.id === CHARTER.id);
  assert.ok(entry, 'an offered Charter has no components[] entry');
  assert.deepEqual(entry, { id: CHARTER.id, version: '0.3.1+b784cb763ec0' });
  assert.deepEqual(
    composed.sourcesOffered.find((s) => s.sourceId === 'nyc-charter'),
    { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'configured' },
  );
});

test('C4: the addressed sources\' entries carry no version (what a server reports is never its version)', async () => {
  const composed = await composeSystemPrompt({ configured: CHARTER_ON, now: new Date('2026-10-16T12:00:00Z') });
  // The property kept: an addressed server states no version. S2-B W6 (npstorey/civic-ai-tools#309): a pack is no
  // server, and states its own version and hash (`<version>+<hash12>`, bundle revision 3 `components[]`).
  for (const source of CIVIC_MANIFEST.filter((entry) => !entry.hostings.some((variant) => variant.kind === 'npm-package') && entry.pack === undefined)) {
    const entry = composed.components.find((component) => component.id === source.id);
    assert.ok(entry, `premise: ${source.sourceId} is offered`);
    assert.equal(Object.hasOwn(entry!, 'version'), false, `${source.sourceId} states a version it never read`);
  }
});

test('C4: composing with Charter on asks nothing of Charter (offering it never wakes it)', async () => {
  fetched.length = 0;
  await composeSystemPrompt({ configured: CHARTER_ON, now: new Date('2026-10-16T12:00:00Z') });
  assert.ok(fetched.length > 0, 'premise: the composition did ask the addressed sources');
  assert.ok(fetched.every((url) => !/vercel\.run|charter|civic-src/i.test(url)), `a request went to the hosted source: ${fetched.join(', ')}`);
});

// S2-B P3R criterion 4 (route-identity C3 = B, C4 = A; ADR-0033 amendment 4; the seat's rulings 4 to 6): what each
// remote server the run read reported of itself is stated on that server's entry, beside `id`. THE SHAPE THAT CAN
// FAIL: every source's read is present, a hosted one's and the pack's base's included, with one member stated as the
// empty string; only the remote servers' entries may gain keys, `version` must not move, and `""` must be omitted.
test('P3R: reported keys sit beside id on remote servers\' entries only, a pack\'s bare base included; never on a hosted entry, the pack\'s own or the router\'s', async () => {
  const composed = await composeSystemPrompt({ configured: CHARTER_ON, now: new Date('2026-10-16T12:00:00Z') });
  const reads = new Map(CIVIC_MANIFEST.map((entry) => [entry.sourceId, { name: `${entry.sourceId}-reported`, version: entry.sourceId === 'boston-opencontext' ? '' : '1.0.0' }]));
  const stated = withReportedKeys(composed.components, reads, CHARTER_ON);
  const byId = new Map(stated.map((c) => [c.id, c]));
  for (const entry of CIVIC_MANIFEST) {
    const component = byId.get(entry.id);
    if (!component) continue;
    const before = composed.components.find((c) => c.id === entry.id)!;
    // Remote: a server of its own, run by someone else. Every hosted source offered here is an npm-package one.
    const remote = entry.base === undefined && !entry.hostings.some((variant) => variant.kind === 'npm-package');
    if (remote) {
      const expected = { ...before, reportedName: `${entry.sourceId}-reported`, ...(entry.sourceId === 'boston-opencontext' ? {} : { reportedVersion: '1.0.0' }) };
      assert.deepEqual(component, expected, `${entry.sourceId}: the remote entry does not state its report beside id`);
    } else {
      assert.deepEqual(component, before, `${entry.sourceId}: a hosted entry or a pack's own entry gained reported keys`);
    }
  }
  assert.deepEqual(stated.at(-1), composed.components.at(-1), 'the router\'s entry gained reported keys');
  assert.ok(byId.get(CHARTER.id) && !Object.hasOwn(byId.get(CHARTER.id)!, 'reportedName'), 'premise: Charter, hosted, is offered and states no report');
  // The pack's base, stated as its bare { id } when only the pack is composed (G0-B8 A), gains the base's report.
  const packOnly = [{ id: 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server' }, { id: 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx', version: '1.1+ef1b4b6089e9' }];
  assert.deepEqual(withReportedKeys(packOnly, new Map([['socrata', { name: 'socrata-mcp-server', version: '0.9.2' }]]), CHARTER_ON), [
    { id: 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server', reportedName: 'socrata-mcp-server', reportedVersion: '0.9.2' },
    { id: 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx', version: '1.1+ef1b4b6089e9' },
  ]);
  // No read in this run, no keys (ruling 6).
  assert.deepEqual(withReportedKeys(composed.components, new Map(), CHARTER_ON), composed.components);
});
