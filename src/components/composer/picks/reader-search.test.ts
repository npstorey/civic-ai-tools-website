// S3-B W1 (npstorey/civic-ai-tools#318; W1-3, anchor B7 and O5; the ORCH's A2, A9 and A11): the reader's search is
// the model's search, one function over one index, and it knows the portal lock the server knows.
//
// W1-3. Over S1's recorded `find_source` queries (`fixtures/s1-find-source-queries.json`: 516 distinct queries, the
// hub's `benchmark/runs/2026-11-05/2026-11-05-run-191511/rows.jsonl` at `36ecd93`, field `searches[].query`), the
// reader's full ranking (`readerRanking`: no space, no cut), limited to the model's search space and cut to ten, equals
// what the model's `find_source` returns through the real routing's search step, unlocked and locked. The space is a
// real one: an Off source and a source the site has not set up are outside it, so the reader's ranking crosses it for
// most queries (the count is asserted). At seven entries no ranking is longer than ten, so the cut cannot bind; what
// can fail is the reader's `top`, asserted directly: at least the manifest's length, never the router's default.
//
// A2. "Has a searchable word" is one named function over a one-entry index of the router's own: `''`, blanks and
// stopwords read false; a word no source holds reads true.
//
// A9 and O5. The browser's configuration, built from the root layout's two values, carries the lock
// `readMcpEnvFromProcess()` carries, on every row of the environment matrix; locked to another portal, the reader's
// search never finds NYC City Record (G0-6 = A); unlocked, or locked to its own portal, it does (the decoy).
//
// RED at 15a52942: `src/components/composer/picks/search.ts` is absent; every test fails at that assertion. It is
// imported through a path held in a variable, so this file type-checks there.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 's1-find-source-queries.json'), 'utf8')) as {
  source: { commit: string; path: string; sha256: string; field: string };
  count: number;
  queries: string[];
};

for (const name of ['DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'BOSTON_OPENCONTEXT_MCP_URL',
  'SOURCE_ROUTING', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL']) {
  delete process.env[name];
}
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example/mcp';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';

const { civicRouter, SEARCH_DEFAULT_TOP } = await import('@typedstandards/civic-typed-router');
const { readMcpEnvFromProcess } = await import('../../../lib/mcp/registry.ts');
const { getDefaultPortal, isPortalLocked } = await import('../../../lib/site-config.ts');
const routingMode = await import('../../../lib/mcp/routing-mode.ts');

const SEARCH_MODULE = './search.ts';
const search = (await import(SEARCH_MODULE).catch(() => null)) as Loose | null;
const need = (): Loose => {
  assert.ok(search, 'src/components/composer/picks/search.ts is absent');
  return search!;
};

const MANIFEST_LENGTH = civicRouter.manifest.length;

// --- W1-3 ---------------------------------------------------------------------------------------------------------------

test('W1-3 premise: the fixture holds the recorded queries only, named by their source', () => {
  assert.equal(FIXTURE.source.commit, '36ecd931e444ffc5bb1ff09dce3c43edfedd6729');
  assert.equal(FIXTURE.source.path, 'benchmark/runs/2026-11-05/2026-11-05-run-191511/rows.jsonl');
  assert.equal(FIXTURE.source.sha256, '316e361ca5588fe35fd616c0cde43c59a8857557145af5516cee06914be4c18c');
  assert.equal(FIXTURE.source.field, 'searches[].query');
  assert.equal(FIXTURE.queries.length, 516);
  assert.equal(FIXTURE.count, 516);
  assert.equal(new Set(FIXTURE.queries).size, 516, 'a query is repeated');
});

/** The model's search through the real routing: a run whose searchable set is larger than its listed set. */
async function modelSearch(configured: Loose, states: Record<string, string>, query: string): Promise<{ hits: string[]; space: string[] }> {
  const searchable = routingMode.directorySet(configured as never, { enforced: true, states });
  const listed = searchable.slice(0, 1);
  const session = await routingMode.createInLoopRouting({
    configured: configured as never, directory: listed, searchable, rule: { id: 'test-listed-subset', version: '1' }, selection: undefined,
    now: new Date('2026-11-16T12:00:00.000Z'),
  });
  assert.ok(session.searchStep, 'premise: the run offers a search');
  const answer = await session.searchStep!.search(query, { iteration: 0 });
  return { hits: answer.hits ?? [], space: searchable.map((e) => e.sourceId) };
}

for (const [label, lock] of [['unlocked', undefined], ['locked to another portal', 'data.cityofchicago.org']] as const) {
  test(`W1-3 (${label}): over the 516 recorded queries, the reader's full ranking limited to the model's space and cut to ten is the model's find_source result`, async () => {
    const { readerRanking, readerSearchConfiguration, READER_SEARCH_TOP } = need();
    // Five sources configured; NYC Checkbook Off, so it is outside the model's space; Boston OpenContext not set up.
    const configured = { ...readMcpEnvFromProcess(), nycCheckbookHosting: 'sandbox', nysLegislationHosting: 'sandbox', ...(lock ? { lockedPortal: lock } : {}) };
    const states = { socrata: 'on', 'data-commons': 'on', 'nyc-checkbook': 'off', 'nyc-record': 'ask-first', 'nys-legislation': 'on' };
    const browser = readerSearchConfiguration(lock !== undefined, lock ?? null);
    const tops: Array<number | undefined> = [];
    const spaces: unknown[] = [];
    const spy = (input: Loose) => { tops.push(input.top); spaces.push(input.space); return civicRouter.searchSources(input as never); };
    let hitting = 0;
    let crossing = 0;
    for (const query of FIXTURE.queries) {
      const ranking: string[] = readerRanking(query, browser, spy);
      const model = await modelSearch(configured, states, query);
      if (ranking.length > 0) hitting += 1;
      if (ranking.some((id) => !model.space.includes(id))) crossing += 1;
      assert.deepEqual(ranking.filter((id) => model.space.includes(id)).slice(0, SEARCH_DEFAULT_TOP), model.hits, `query: ${query}`);
    }
    // A11: the reader's cut is the manifest's length, never the router's default of ten.
    assert.equal(READER_SEARCH_TOP, MANIFEST_LENGTH);
    assert.ok(tops.length === FIXTURE.queries.length && tops.every((top) => typeof top === 'number' && top >= MANIFEST_LENGTH), `a reader search passed top ${tops.find((top) => !(typeof top === 'number' && top >= MANIFEST_LENGTH))}`);
    assert.ok(spaces.every((space) => space === undefined), 'the reader\'s search passed a space');
    // The space is crossed, so the comparison rests on more than the space holding every hit.
    assert.ok(hitting >= 400, `only ${hitting} queries hit the manifest`);
    assert.ok(crossing >= 300, `only ${crossing} queries crossed the space`);
  });
}

// --- A2 -------------------------------------------------------------------------------------------------------------------

test('A2: "has a searchable word" is false for an empty query, blanks and stopwords; true for any word the search can match', () => {
  const { hasSearchableWord } = need();
  assert.equal(hasSearchableWord(''), false);
  assert.equal(hasSearchableWord('   '), false);
  assert.equal(hasSearchableWord('the of and'), false);
  assert.equal(hasSearchableWord('zzqx'), true, 'a word no source holds is still a searchable word');
  assert.equal(hasSearchableWord('Boston permits and contracts'), true);
  // Decoy: the router's search returns nothing for both "the of and" and "zzqx"; only one of them has a word.
  assert.deepEqual(civicRouter.searchSources({ configured: { dataCommonsUrl: '' }, query: 'the of and', top: MANIFEST_LENGTH }), []);
  assert.deepEqual(civicRouter.searchSources({ configured: { dataCommonsUrl: '' }, query: 'zzqx', top: MANIFEST_LENGTH }), []);
});

// --- A9 and O5 ------------------------------------------------------------------------------------------------------------

const MATRIX: Array<[string, Record<string, string | undefined>]> = [
  ['the lock off, no default portal', { SITE_PORTAL_LOCKED: undefined, SITE_DEFAULT_PORTAL: undefined }],
  ['the lock off, a default portal', { SITE_PORTAL_LOCKED: undefined, SITE_DEFAULT_PORTAL: 'data.cityofchicago.org' }],
  ['the lock on, locked to New York City', { SITE_PORTAL_LOCKED: '1', SITE_DEFAULT_PORTAL: 'data.cityofnewyork.us' }],
  ['the lock on, locked to another portal', { SITE_PORTAL_LOCKED: 'true', SITE_DEFAULT_PORTAL: ' Data.CityOfChicago.org ' }],
  ['the lock on, no portal configured', { SITE_PORTAL_LOCKED: '1', SITE_DEFAULT_PORTAL: undefined }],
  ['the lock on, a blank portal', { SITE_PORTAL_LOCKED: '1', SITE_DEFAULT_PORTAL: '   ' }],
];

function withEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return run(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

for (const [label, env] of MATRIX) {
  test(`A9 (${label}): the browser's lock, from the layout's two values, is readMcpEnvFromProcess()'s`, () => {
    const { readerSearchConfiguration } = need();
    withEnv(env, () => {
      // The root layout renders `<DefaultPortalProvider value={getDefaultPortal()} locked={isPortalLocked()}>`.
      const browser = readerSearchConfiguration(isPortalLocked(), getDefaultPortal());
      assert.equal(browser.lockedPortal, readMcpEnvFromProcess().lockedPortal);
      assert.deepEqual(Object.keys(browser).filter((k) => k !== 'lockedPortal'), ['dataCommonsUrl'], 'the browser is given more of the configuration than the lock');
      assert.equal(browser.dataCommonsUrl, '');
    });
  });
}

test('O5 (G0-6 = A): a site locked to another portal cannot find NYC City Record; unlocked, or locked to its own portal, it can', () => {
  const { readerRanking, readerSearchConfiguration } = need();
  const words = 'city record procurement notices';
  assert.equal(readerRanking(words, readerSearchConfiguration(false, null))[0], 'nyc-record', 'decoy: unlocked, City Record is the first hit');
  assert.ok(readerRanking(words, readerSearchConfiguration(true, 'data.cityofnewyork.us')).includes('nyc-record'), 'decoy: locked to its own portal, City Record is a hit');
  const locked = readerRanking(words, readerSearchConfiguration(true, 'data.cityofchicago.org'));
  assert.ok(locked.length > 0, 'premise: the words still hit other sources');
  assert.ok(!locked.includes('nyc-record'), `a site locked to another portal found City Record: ${locked.join(', ')}`);
});
