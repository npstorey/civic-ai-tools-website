// #617 P4 criterion 3 (C4) — a hosted source's `components[]` entry states
// the version the instance ran: the pinned package version and its commit, in
// semver build-metadata form (ADR-0033 §E: one optional `version` string, "a
// server's reported version, or a pinned commit").
//
// For NYC Charter, Laws and Rules that is `0.3.1+b784cb763ec0`: the manifest's
// `hosting.version`, `+`, and the first 12 hex digits of `hosting.commit`. It
// comes from the hosting field, never from the server's `serverInfo` (the
// client reads none), so it moves only with the pin. The entry carries no
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

test('C4: the addressed sources\' entries carry no version (the client reads no serverInfo)', async () => {
  const composed = await composeSystemPrompt({ configured: CHARTER_ON, now: new Date('2026-10-16T12:00:00Z') });
  for (const source of CIVIC_MANIFEST.filter((entry) => !entry.hosting)) {
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
