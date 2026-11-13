// S2-B W6 (npstorey/civic-ai-tools#309; card G0-B8 A; bundle revision 3's `components[]`): a record credits a pack
// by its own version and hash, and states the pack's base whenever it states the pack.
//
// THE RULE. Bundle `:49`: a pack is one `components[]` entry of its own, `id` the pack's id and `version`
// `<version>+<hash12>`, the pack's version and the first twelve hex characters of the hash its inventory entry
// states; "its base's entry is present whenever the pack's is". Router 0.8.0 carries both on the manifest entry's
// `pack` member. G0-B8 A: when the pack is loaded and its base is not, the base is added as `{ id }` (no
// `guidanceHash`: "a missing guidanceHash is no guidance", `:50`) and the prompt is unchanged; a list with a pack
// and no base is refused by the site's own check before the trace is written. Every list a trace or a record
// states comes from `componentsOf` (`socrata-skill.ts`), which calls that check last.
//
// WHAT IS DRIVEN. The site's own compositions, `composeInLoopSystemPrompt` and `composeSystemPrompt`, over the
// installed router, with every outbound request refused (Socrata's block is then its fallback; the pack's
// guidance is inline and needs none).
//
// RED at tree 5b (d99f2532): the pack's component carries no `version`, a run that loads the pack alone states
// no base, and `socrata-skill.ts` exports no check. Also P1's carried item: `crossSourcePreamble` fails on an id
// outside the three code sources with a `TypeError` that names nothing.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { civicRouter, readMcpEnv } from '@typedstandards/civic-typed-router';
import routerPackage from '@typedstandards/civic-typed-router/package.json' with { type: 'json' };
import * as skill from './socrata-skill.ts';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Component = { id: string; version?: string; guidanceHash?: string; guidanceOrigin?: string };

// No network: every guidance fetch fails, so the Socrata block is the fallback and Data Commons sends none.
globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;

const S = skill as unknown as Loose;
const configured = readMcpEnv({ SOCRATA_MCP_URL: 'http://127.0.0.1:9/socrata/mcp', BOSTON_OPENCONTEXT_MCP_URL: 'http://127.0.0.1:9/boston/mcp' });
const PACK = civicRouter.manifest.find((entry) => entry.sourceId === 'nyc-record')!;
const BASE = civicRouter.manifest.find((entry) => entry.sourceId === PACK.base)!;
const ROUTER = { id: routerPackage.name, version: routerPackage.version };
const DIRECTORY = ['socrata', 'data-commons', 'boston-opencontext', 'nyc-record'];
const NOW = new Date('2026-11-10T12:00:00Z');
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const PACK_BLOCK = await PACK.guidance.fetchText({} as never, civicRouter.aliasedView);

/** The credit as bundle `:49` defines it, read from the installed entry's `pack` member, cut here by code. */
const CREDIT = `${PACK.pack!.version}+${PACK.pack!.hash.slice(0, 12)}`;

/** W6's credit assertion over any component: the decoy runs the same function. */
function assertCredit(component: Component | undefined): void {
  assert.ok(component, 'the components carry no entry for the pack');
  const [version, hash12, ...rest] = String(component!.version).split('+');
  assert.deepEqual(rest, [], `the pack's version is not <version>+<hash12>: ${component!.version}`);
  assert.equal(version, PACK.pack!.version, 'the pack\'s version is not its pack member\'s');
  assert.equal(hash12, PACK.pack!.hash.slice(0, 12), 'the pack\'s twelve characters are not the first twelve of its hash');
}

const inLoop = (loaded: string[]) => skill.composeInLoopSystemPrompt({ portal: 'data.example.org', configured, directory: DIRECTORY, loaded, now: NOW });

test('S2-B W6 premise: the installed pack is NYC City Record over Socrata, version 1, hash b4a20846…', () => {
  assert.equal(PACK.id, 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx');
  assert.equal(BASE.id, 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server');
  assert.equal(PACK.pack?.version, '1');
  assert.match(PACK.pack?.hash ?? '', /^b4a20846[0-9a-f]{56}$/);
  assert.equal(CREDIT, '1+b4a208462f8d');
  assert.ok(PACK_BLOCK.length > 0, 'premise: the pack carries guidance of its own');
});

test('S2-B W6 (G0-B8 A): the pack loaded without Socrata states its base as { id }, then the pack credited, and the prompt carries no Socrata block', async () => {
  const { prompt, components } = await inLoop(['nyc-record']);
  assert.ok(prompt.includes(PACK_BLOCK), 'premise: the prompt carries the pack\'s block');
  assert.equal(prompt.includes(skill.SOCRATA_SKILL_FALLBACK.slice(0, 200)), false, 'the prompt gained the base\'s block');
  assert.deepEqual(components, [
    { id: BASE.id },
    { id: PACK.id, version: CREDIT, guidanceHash: sha(PACK_BLOCK), guidanceOrigin: 'inline' },
    ROUTER,
  ]);
});

test('S2-B W6: the pack loaded with Socrata states the base once, with its own guidance, and the pack credited', async () => {
  const { components } = await inLoop(['socrata', 'nyc-record']);
  assert.deepEqual(components.map((c) => c.id), [BASE.id, PACK.id, ROUTER.id]);
  assert.equal(components[0].guidanceOrigin, 'fallback', 'the base\'s component lost its guidance');
  assertCredit(components[1]);
});

test('S2-B W6: an all-sources composition, which offers the pack wherever Socrata is, credits it', async () => {
  const { components } = await skill.composeSystemPrompt({ portal: 'data.example.org', configured, now: NOW });
  assert.deepEqual(components.map((c) => c.id).slice(0, 1), [BASE.id]);
  const pack = components.find((c) => c.id === PACK.id);
  assertCredit(pack);
  assert.deepEqual(pack, { id: PACK.id, version: CREDIT, guidanceHash: sha(PACK_BLOCK), guidanceOrigin: 'inline' });
});

test('S2-B W6: a run that does not load the pack states no pack and no added base', async () => {
  const { components } = await inLoop(['socrata']);
  assert.deepEqual(components.map((c) => c.id), [BASE.id, ROUTER.id]);
});

test('S2-B W6 decoy: a pack version whose twelve characters are not the first twelve of the entry\'s hash fails the credit assertion', () => {
  assert.doesNotThrow(() => assertCredit({ id: PACK.id, version: CREDIT }));
  for (const version of [`1+${PACK.pack!.hash.slice(1, 13)}`, `1+${PACK.pack!.hash.slice(0, 11)}`, '1', `2+${PACK.pack!.hash.slice(0, 12)}`]) {
    assert.throws(() => assertCredit({ id: PACK.id, version }), assert.AssertionError, version);
  }
});

test('S2-B W6 decoy (G0-B8 A): the site\'s own check refuses a components list with the pack and not its base', () => {
  assert.equal(typeof S.checkPackBases, 'function', 'socrata-skill.ts exports no checkPackBases');
  assert.throws(
    () => S.checkPackBases([{ id: PACK.id, version: CREDIT }, ROUTER]),
    (error: unknown) => error instanceof Error && error.message.includes(PACK.id) && error.message.includes(BASE.id),
  );
  assert.doesNotThrow(() => S.checkPackBases([{ id: BASE.id }, { id: PACK.id, version: CREDIT }, ROUTER]));
  assert.doesNotThrow(() => S.checkPackBases([{ id: BASE.id }, ROUTER]));
  assert.doesNotThrow(() => S.checkPackBases([ROUTER]));
});

test('S2-B (P1\'s carried item): crossSourcePreamble refuses an id outside the three code sources by name; the three still compose', () => {
  assert.equal(skill.crossSourcePreamble(['socrata', 'data-commons', 'boston-opencontext']), skill.CROSS_SOURCE_PREAMBLE);
  for (const id of ['nyc-record', 'nyc-charter']) {
    assert.throws(
      () => skill.crossSourcePreamble(['socrata', id] as never),
      (error: unknown) => error instanceof Error && !(error instanceof TypeError) && error.message.includes(`"${id}"`),
      `${id}: not refused by name`,
    );
  }
});
