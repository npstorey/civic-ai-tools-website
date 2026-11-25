// S4 W1 (npstorey/civic-ai-tools#335): both consent stores, driven through their real writers and readers.
//
// Criteria A1 (driven leg), A2, A3a, A3b, A4, A7, A7b, A8, A9, A10, A11, A12 and A14. Each test names its criterion.
// A pin (A3a, A4, A7, A7b, A9, A10, A11) passes at the base and the head: its legs use only what the base has. A leg
// that needs what W1 adds (the second form, the flag, the class writes, the hook) is its own test, named "(head)".
//
// WHAT IS DRIVEN. The real `GET`, `PUT` and `PATCH` of `/api/sources/consent`, the real `POST` of
// `/api/sources/consent/decision`, the real consent gate (`consentInForce`), the real consent module and the real
// flows statement, at production's seven sources and at the 200-source fixture through the statement's test hook.
// STUBS: `next-auth` and `@/lib/auth` (a session set per call); `@/lib/sources/consent-store` (an in-memory row per
// account, counting its writes); `@vercel/kv` (the fake store the pause suites use). No network.
//
// THE SHAPES THAT CAN FAIL. Every store holds sources in all three states, with flags set both ways and an entry for a
// retired source (`boston-ckan`, router 0.12.0), so a writer that dropped, re-dated or re-flagged one entry it was not
// asked to change is seen. Every flagged source's state differs from the state its class is then set to. The bound is
// driven past 274 sources, where it can be passed, and once at 274 with a change that adds no entry.
//
// Run with: npm test

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FAKE_VERCEL_KV_MODULE, FakeDecisionKv } from '../../../../lib/sources/decision-store-for-tests.ts';

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Entry = { state: string; since: string; own?: boolean };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', '..', '..');
const REPO = path.resolve(SRC, '..');
const CONSENT_STORE_FILE = path.join(SRC, 'lib', 'sources', 'consent-store.ts');

interface Row { userId: string; states: Record<string, Entry>; flowsHash: string; flowsStatement: Json; consentedAt: Date; updatedAt: Date }
interface Globals { __s4w1: { session: unknown; rows: Map<string, Row>; writes: number }; __w2DecisionKv: FakeDecisionKv }
const globals = globalThis as unknown as Globals;
globals.__s4w1 = { session: null, rows: new Map(), writes: 0 };

const STUB_PREFIX = 'file:///s4-w1-stores-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next-auth': `export async function getServerSession() { return globalThis.__s4w1.session; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@vercel/kv': FAKE_VERCEL_KV_MODULE,
  'consent-store': `
    const rows = () => globalThis.__s4w1.rows;
    export async function readConsentRow(userId) { const row = rows().get(userId); return row ? structuredClone(row) : null; }
    export async function writeConsentRow(userId, row) {
      globalThis.__s4w1.writes += 1;
      const prior = rows().get(userId);
      const now = row.now ?? new Date();
      rows().set(userId, structuredClone({ userId, states: row.states, flowsHash: row.flowsHash, flowsStatement: row.flowsStatement, consentedAt: prior?.consentedAt ?? now, updatedAt: now }));
    }
    export async function deleteConsentRow(userId) { rows().delete(userId); }`,
};
const stub = (key: string): ResolveResult => ({ url: `${STUB_PREFIX}${encodeURIComponent(key)}.mjs`, format: 'module', shortCircuit: true });

function firstFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) return stub(specifier);
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    let file: string | null = null;
    if (specifier.startsWith('@/')) {
      file = firstFile(path.join(SRC, specifier.slice(2)));
      if (file === null) throw new Error(`s4-w1 stores test hook: cannot resolve ${specifier}`);
    } else {
      const parent = (context as { parentURL?: string }).parentURL;
      if (specifier.startsWith('.') && parent?.startsWith('file:') && !parent.startsWith(STUB_PREFIX)) {
        file = firstFile(path.resolve(path.dirname(fileURLToPath(parent)), specifier));
      }
    }
    if (file === CONSENT_STORE_FILE) return stub('consent-store');
    if (file !== null) return { url: pathToFileURL(file).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(url.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    if (url.startsWith('file:') && url.endsWith('.json')) {
      return { format: 'module', source: `export default ${fs.readFileSync(fileURLToPath(url), 'utf8')};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// --- The configuration: production's seven sources, on a site that can ask -----------------------------------

const VARIABLES = [
  'SOCRATA_MCP_URL', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'BOSTON_OPENCONTEXT_MCP_URL', 'CKAN_MCP_URL',
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'NYS_LEGISLATION_API_KEY',
  'MODEL_API_BASE_URL', 'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'DATABASE_URL', 'FLOWS_MANIFEST', 'CIVIC_MANIFEST',
];
type Config = 'six' | 'seven' | 'eight';
function configure(config: Config): void {
  for (const name of VARIABLES) delete process.env[name];
  process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
  process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
  process.env.NYC_CHARTER_HOSTING = 'sandbox';
  process.env.NYC_CHECKBOOK_HOSTING = 'sandbox';
  process.env.NYS_LEGISLATION_HOSTING = 'sandbox';
  process.env.NYS_LEGISLATION_API_KEY = 'fixture-legislation-key';
  if (config !== 'six') process.env.CKAN_MCP_URL = 'https://ckan.fixture.example/mcp';
  if (config === 'eight') process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
}
configure('seven');
process.env.EXECUTOR_DRIVER = 'none';
process.env.SOURCE_ROUTING = 'in-loop';
process.env.KV_REST_API_URL = 'https://kv.fixture.example';
process.env.KV_REST_API_TOKEN = 'fixture-kv-token';
process.env.RATE_LIMIT_SECRET = 'fixture';

const kv = new FakeDecisionKv(() => 1_800_000_000_000);
globals.__w2DecisionKv = kv;

const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const consentRoute = await load('app/api/sources/consent/route.ts');
const decisionRoute = await load('app/api/sources/consent/decision/route.ts');
const decision = await load('lib/sources/decision.ts');
const gateModule = await load('lib/sources/consent-gate.ts');
const consent = await load('lib/sources/consent.ts');
const flows = await load('lib/flows/statement.ts');
const fixture = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'sources', 'fixtures', 'manifest-200.json'), 'utf8')) as { addresses: Record<string, string>; entries: Json[] };

const ORIGIN = 'https://site.fixture.example';
const DB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOUND = 4096;
const RETIRED = 'boston-ckan';
const TODAY = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  configure('seven');
  globals.__s4w1.rows.clear();
  globals.__s4w1.writes = 0;
  globals.__s4w1.session = null;
  kv.entries.clear();
  flows.setFlowsSourceInputsForTests?.(null);
});

// --- Calls --------------------------------------------------------------------------------------------------------

type Store = 'cookie' | 'row';
const sessionFor = (store: Store) => (store === 'row' ? { user: { id: 'gh-fixture', dbId: DB } } : null);

/** A reader: a store, and the cookie it carries (a browser's jar of one). */
interface Reader { store: Store; cookie?: string }

function remember(reader: Reader, response: Response): void {
  const set = response.headers.get('set-cookie');
  if (set) reader.cookie = set.split(';')[0];
}

async function call(reader: Reader, method: string, route: Mod, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  globals.__s4w1.session = sessionFor(reader.store);
  const request = new Request(`${ORIGIN}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(reader.cookie ? { cookie: reader.cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = (await route[method](request)) as Response;
  remember(reader, response);
  return response;
}

const get = (reader: Reader, headers: Record<string, string> = {}) => call(reader, 'GET', consentRoute, '/api/sources/consent', undefined, headers);
const put = (reader: Reader, body: unknown) => call(reader, 'PUT', consentRoute, '/api/sources/consent', body);
const patch = (reader: Reader, body: unknown) => call(reader, 'PATCH', consentRoute, '/api/sources/consent', body);

async function decide(reader: Reader, sourceId: string, value: string): Promise<Response> {
  const key = decision.newDecisionKey();
  const entry: Json = { sourceId, ...(reader.store === 'row' ? { reader: decision.readerCode(DB, 'fixture') } : {}) };
  await kv.set(`${decision.DECISION_KEY_PREFIX}${key}`, entry, { ex: decision.DECISION_ENTRY_TTL_SECONDS, nx: true });
  return call(reader, 'POST', decisionRoute, '/api/sources/consent/decision', { key, decision: value });
}

async function gate(reader: Reader): Promise<Json> {
  globals.__s4w1.session = sessionFor(reader.store);
  const request = new Request(`${ORIGIN}/api/compare-stream`, { method: 'POST', headers: reader.cookie ? { cookie: reader.cookie } : {} });
  return gateModule.consentInForce(request, sessionFor(reader.store), { routing: 'in-loop', store: true });
}

async function current(): Promise<{ statement: Json; hash: string; ids: string[] }> {
  const statement = await flows.buildFlowsStatement();
  return { statement, hash: flows.statementHash(statement), ids: statement.sources.map((s: Json) => s.sourceId) };
}

const versionOf = (statement: Json, id: string): string => statement.sources.find((s: Json) => s.sourceId === id)?.version ?? 'f'.repeat(64);

/** A first-form cookie, built by hand as the base's encoder builds it (`consent.ts:120-122` at the base). */
function firstForm(statement: Json, states: Record<string, string>, since = '2026-11-01'): string {
  const cookie = { v: 1, flows: statement.version, states: Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state, since, version: versionOf(statement, id) }])) };
  return `${consent.CONSENT_COOKIE_NAME}=${Buffer.from(JSON.stringify(cookie), 'utf8').toString('base64url')}`;
}

/** A second-form cookie through the real encoder (`v: 2`). */
function secondForm(statement: Json, states: Record<string, Entry>): string {
  const cookie = { v: 2, flows: statement.version, states: Object.fromEntries(Object.entries(states).map(([id, e]) => [id, { ...e, version: versionOf(statement, id) }])) };
  return `${consent.CONSENT_COOKIE_NAME}=${consent.encodeConsentCookie(cookie)}`;
}

/** The cookie a reader carries, decoded against `ids` (the configured sources and any retired one named). */
function decoded(reader: Reader, ids: readonly string[]): Json {
  assert.ok(reader.cookie, 'the reader carries no cookie');
  const value = reader.cookie!.slice(reader.cookie!.indexOf('=') + 1);
  const out = consent.decodeConsentCookie(value, ids);
  assert.ok(out, 'the cookie does not decode');
  return out;
}

const pairSize = (setCookie: string | null): number => (setCookie ? setCookie.split(';')[0].length : 0);
const flat = (states: Record<string, { state: string }>) => Object.fromEntries(Object.entries(states).map(([id, s]) => [id, s.state]));

/** What a store holds, read from the store itself: per id the state, the date and whether it reads as set on its own. */
function held(reader: Reader, ids: readonly string[]): Record<string, { state: string; since: string; own: boolean }> {
  const own = (e: Entry) => (typeof consent.setOnItsOwn === 'function' ? consent.setOnItsOwn(e) : e.own ?? e.state === 'off');
  const entries: Record<string, Entry> = reader.store === 'row' ? globals.__s4w1.rows.get(DB)!.states : decoded(reader, ids).states;
  return Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, { state: e.state, since: e.since, own: own(e) }]));
}

/** A consent in force, given by the first consent's Allow over `states`. */
async function consented(store: Store, states: Record<string, string>): Promise<Reader> {
  const reader: Reader = { store };
  const { hash } = await current();
  const response = await put(reader, { states, flowsVersion: hash });
  assert.equal(response.status, 200, `premise: the consent was written: ${await response.clone().text()}`);
  return reader;
}

// --- The 200-source fixture through the hook ------------------------------------------------------------------

/** The hook's inputs: the fixture, and `extra` example packs over Socrata, every one configured. */
function fixtureInputs(extra = 0): Json {
  const socrata = fixture.entries.find((e) => e.sourceId === 'socrata')!;
  const entries = [
    ...fixture.entries,
    ...Array.from({ length: extra }, (_, i) => ({
      kind: 'pack',
      sourceId: `example-pack-${String(i).padStart(3, '0')}`,
      alias: `example_pack_${i}`,
      displayName: `Example pack ${i}`,
      freshness: 'Example: an example pack.',
      base: 'socrata',
      consentDefault: 'on',
      hostings: socrata.hostings,
    })),
  ];
  return {
    manifest: entries,
    variantInForce: (entry: Json) => entry.hostings[0],
    addressFor: (id: string) => {
      const entry = entries.find((e) => e.sourceId === id);
      return fixture.addresses[entry?.base ?? id];
    },
  };
}

function hook(extra = 0): void {
  assert.equal(typeof flows.setFlowsSourceInputsForTests, 'function', 'statement.ts has no test hook (A14): the routes build the statement with no input a test can set');
  flows.setFlowsSourceInputsForTests(fixtureInputs(extra));
}

// =====================================================================================================================
// A3a (pin) and A3b (red): a first-form cookie is read; the next change writes the second form.
// =====================================================================================================================

const SIX_STATES: Record<string, string> = { socrata: 'on', 'data-commons': 'ask-first', 'nyc-charter': 'off', 'nyc-checkbook': 'on', 'nyc-record': 'ask-first', 'nys-legislation': 'off' };
const SEVEN_STATES: Record<string, string> = { ...SIX_STATES, 'ckan-server': 'on' };

for (const [config, states] of [['six', SIX_STATES], ['seven', SEVEN_STATES]] as const) {
  test(`A3a (pin): a first-form cookie holding production's ${config} states is in force with the same selection and the same states; no consent_required`, async () => {
    configure(config);
    const { statement, ids } = await current();
    assert.deepEqual(ids.slice().sort(), Object.keys(states).sort(), `premise: production's ${config} are configured`);
    const reader: Reader = { store: 'cookie', cookie: firstForm(statement, states) };
    const decision = await gate(reader);
    assert.equal(decision.ok, true, `the gate refused a first-form cookie: ${JSON.stringify(decision.payload)}`);
    assert.deepEqual(decision.selection, ids.filter((id) => states[id] === 'on'));
    assert.deepEqual(decision.states, states);
    const body = (await (await get(reader)).json()) as Json;
    assert.equal(body.inForce, true);
    assert.deepEqual(flat(body.states), states);
    assert.equal(body.reask, undefined);
  });
}

test('A3b (red): that reader\'s next change writes the second form, holding the same states; an Off reads as set on its own, an On or an Ask first does not', async () => {
  configure('six');
  const { statement, hash, ids } = await current();
  // Today's client body (the whole map, one source changed), as a page loaded before the deploy sends it.
  const reader: Reader = { store: 'cookie', cookie: firstForm(statement, SIX_STATES) };
  const changed: Record<string, string> = { ...SIX_STATES, 'nyc-checkbook': 'ask-first' };
  const response = await put(reader, { states: changed, flowsVersion: hash });
  assert.equal(response.status, 200, await response.clone().text());
  const value = reader.cookie!.slice(reader.cookie!.indexOf('=') + 1);
  assert.equal(Buffer.from(value, 'base64url')[0], 2, 'the next change did not write the second form');
  const after = decoded(reader, ids);
  assert.equal(after.v, 2);
  assert.deepEqual(flat(after.states), changed, 'the second form does not hold the same states');
  const own = held(reader, ids);
  for (const id of ids) assert.equal(own[id].own, changed[id] === 'off', `${id} (${changed[id]}) reads ${own[id].own ? '' : 'not '}set on its own`);
  assert.equal(after.states['nyc-charter'].since, '2026-11-01', 'a state the reader did not change lost its date');

  // The Settings control's change since W1: one source, which is set on its own.
  const one = await put(reader, { change: { scope: 'source', sourceId: 'socrata', state: 'ask-first' }, flowsVersion: hash });
  assert.equal(one.status, 200, await one.clone().text());
  const again = held(reader, ids);
  assert.deepEqual(again.socrata, { state: 'ask-first', since: TODAY(), own: true });
  for (const id of ids.filter((i) => i !== 'socrata')) assert.deepEqual(again[id], own[id], `${id} moved`);
});

// =====================================================================================================================
// A4 (pin): a row written before S4.
// =====================================================================================================================

function preS4Row(statement: Json, states: Record<string, string>): Row {
  return {
    userId: DB,
    states: Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state, since: '2026-11-01' }])),
    flowsHash: flows.statementHash(statement),
    flowsStatement: statement,
    consentedAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  };
}

test('A4 (pin): a row written before S4 is in force with the same states, and reading it rewrites nothing', async () => {
  const { statement, ids } = await current();
  globals.__s4w1.rows.set(DB, preS4Row(statement, SEVEN_STATES));
  const before = structuredClone(globals.__s4w1.rows.get(DB));
  const reader: Reader = { store: 'row' };
  const decision = await gate(reader);
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.states, SEVEN_STATES);
  assert.deepEqual(decision.selection, ids.filter((id) => SEVEN_STATES[id] === 'on'));
  const body = (await (await get(reader)).json()) as Json;
  assert.equal(body.inForce, true);
  assert.deepEqual(flat(body.states), SEVEN_STATES);
  assert.equal(globals.__s4w1.writes, 0, 'a read wrote the row');
  assert.deepEqual(globals.__s4w1.rows.get(DB), before, 'a read changed the row');
});

test('A4 (pin): a pack then added over one of the row\'s servers is Ask first for that row; nothing is asked again', async () => {
  const { statement, ids } = await current();
  // The row was given against a statement without NYC City Record (the pack over Socrata), Socrata On.
  const without = { ...structuredClone(statement), sources: statement.sources.filter((s: Json) => s.sourceId !== 'nyc-record') };
  const states = Object.fromEntries(Object.entries(SEVEN_STATES).filter(([id]) => id !== 'nyc-record'));
  globals.__s4w1.rows.set(DB, preS4Row(without, states));
  const reader: Reader = { store: 'row' };
  const decision = await gate(reader);
  assert.equal(decision.ok, true, `a pack added asked again: ${JSON.stringify(decision.payload)}`);
  assert.ok(!decision.selection.includes('nyc-record'), 'the added pack was selected');
  assert.ok(decision.selection.includes('socrata'), 'premise: its server is On');
  assert.deepEqual(decision.states, states);
  assert.ok(ids.includes('nyc-record'), 'premise: the pack is configured');
  assert.equal(globals.__s4w1.writes, 0);
});

test('A4 (head): a pre-S4 row\'s entries carry no flag; an Off reads as set on its own, an On or an Ask first does not, and a class On leaves that Off', async () => {
  const { statement, hash, ids } = await current();
  globals.__s4w1.rows.set(DB, preS4Row(statement, { ...SEVEN_STATES, socrata: 'ask-first', 'nyc-record': 'off' }));
  const reader: Reader = { store: 'row' };
  const own = held(reader, ids);
  assert.equal(typeof consent.setOnItsOwn, 'function', 'consent.ts has no setOnItsOwn: an entry with no flag has no reading');
  for (const id of ids) assert.equal(own[id].own, own[id].state === 'off', id);
  const body = (await (await get(reader)).json()) as Json;
  assert.deepEqual(body.setOnItsOwn, ids.filter((id) => own[id].state === 'off'));
  const response = await put(reader, { change: { scope: 'class', classId: 'socrata', state: 'on' }, flowsVersion: hash });
  assert.equal(response.status, 200, await response.clone().text());
  const after = held(reader, ids);
  assert.equal(after.socrata.state, 'on');
  assert.deepEqual(after['nyc-record'], own['nyc-record'], 'a class On moved an Off written before S4');
});

// =====================================================================================================================
// A7 (pin) and A7b (pin): a source added to a class, and a source removed.
// =====================================================================================================================

test('A7 (pin): both stores: a source added to a class whose every member the reader set On is Ask first; no other state moves; nothing is asked again', async () => {
  const { statement } = await current();
  const without = { ...structuredClone(statement), sources: statement.sources.filter((s: Json) => s.sourceId !== 'nyc-record') };
  const states = { ...Object.fromEntries(Object.entries(SEVEN_STATES).filter(([id]) => id !== 'nyc-record')), socrata: 'on' };
  globals.__s4w1.rows.set(DB, preS4Row(without, states));
  for (const reader of [{ store: 'row' }, { store: 'cookie', cookie: firstForm(statement, states) }] as Reader[]) {
    const decision = await gate(reader);
    assert.equal(decision.ok, true, `${reader.store}: a source added asked again`);
    assert.ok(!decision.selection.includes('nyc-record'), `${reader.store}: the added source is On`);
    assert.deepEqual(decision.states, states, `${reader.store}: a state moved`);
    const body = (await (await get(reader)).json()) as Json;
    assert.equal(body.inForce, true);
    assert.equal(body.states['nyc-record'], undefined, `${reader.store}: the added source has a stored state`);
  }
  assert.equal(globals.__s4w1.writes, 0);
});

test('A7 (head): at 200, a pack added over Socrata after a consent with every Socrata member On is Ask first, in both stores', async () => {
  hook(1);
  try {
    const { statement, ids } = await current();
    const added = 'example-pack-000';
    const socrataMembers = ids.filter((id) => id === 'socrata' || fixture.entries.find((e) => e.sourceId === id)?.base === 'socrata');
    const states: Record<string, string> = Object.fromEntries(socrataMembers.map((id) => [id, 'on']));
    const without = { ...structuredClone(statement), sources: statement.sources.filter((s: Json) => s.sourceId !== added) };
    globals.__s4w1.rows.set(DB, preS4Row(without, states));
    for (const reader of [{ store: 'row' }, { store: 'cookie', cookie: secondForm(statement, Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state, since: '2026-11-01' }]))) }] as Reader[]) {
      const decision = await gate(reader);
      assert.equal(decision.ok, true, `${reader.store}: asked again`);
      assert.equal(decision.selection.length, socrataMembers.length, `${reader.store}: the selection moved`);
      assert.ok(!decision.selection.includes(added), `${reader.store}: the added pack is On`);
    }
  } finally {
    flows.setFlowsSourceInputsForTests?.(null);
  }
});

test('A7b (pin): both stores: a stored state for a source the manifest no longer lists asks nothing, the other states stay, and a row is told', async () => {
  const { statement, ids } = await current();
  assert.ok(!ids.includes(RETIRED), 'premise: the retired pack is not configured');
  // The row was given against a statement that still listed the retired pack.
  const ckan = statement.sources.find((s: Json) => s.sourceId === 'ckan-server');
  const withRetired = { ...structuredClone(statement), sources: [...statement.sources, { ...structuredClone(ckan), sourceId: RETIRED, displayName: 'Analyze Boston' }] };
  const states = { ...SEVEN_STATES, [RETIRED]: 'on' };
  globals.__s4w1.rows.set(DB, { ...preS4Row(withRetired, states) });
  for (const reader of [{ store: 'row' }, { store: 'cookie', cookie: firstForm(statement, states) }] as Reader[]) {
    const decision = await gate(reader);
    assert.equal(decision.ok, true, `${reader.store}: a removed source asked again`);
    assert.deepEqual(decision.selection, ids.filter((id) => SEVEN_STATES[id] === 'on'), `${reader.store}: the selection moved`);
    const body = (await (await get(reader)).json()) as Json;
    assert.equal(body.inForce, true);
    for (const id of ids) assert.equal(body.states[id].state, SEVEN_STATES[id], `${reader.store}: ${id} moved`);
    if (reader.store === 'row') assert.ok((body.notices as Json[]).some((n) => n.rule === 'source-removed'), 'the row was not told the source was removed');
  }
  // A later write keeps the retired source's entry (the pause's Allow, at the base and the head).
  for (const reader of [{ store: 'row' }, { store: 'cookie', cookie: firstForm(statement, states) }] as Reader[]) {
    const response = await decide(reader, 'data-commons', 'allow');
    assert.equal(response.status, 200);
    const after = reader.store === 'row' ? globals.__s4w1.rows.get(DB)!.states : consent.decodeConsentCookie(reader.cookie!.slice(reader.cookie!.indexOf('=') + 1), [...ids, RETIRED])!.states;
    assert.equal(after[RETIRED]?.state, 'on', `${reader.store}: a write dropped the retired source's state`);
  }
});

// =====================================================================================================================
// A8 (red): "set on its own" is set, honoured and cleared by premise 7's rule.
// =====================================================================================================================

for (const store of ['cookie', 'row'] as const) {
  test(`A8 (red), ${store}: a source set on its own is left alone by a class control and a class answer, and the gate never selects a flagged Off`, async () => {
    const { hash, ids } = await current();
    const ask = Object.fromEntries(ids.map((id) => [id, 'ask-first']));
    const reader = await consented(store, ask);
    const change = async (body: Json) => {
      const response = await put(reader, { ...body, flowsVersion: hash });
      assert.equal(response.status, 200, `${JSON.stringify(body)}: ${await response.clone().text()}`);
    };

    // Off by its own control, then its class On: it stays Off and is never selected.
    await change({ change: { scope: 'source', sourceId: 'nyc-record', state: 'off' } });
    assert.equal(held(reader, ids)['nyc-record'].own, true, 'its own control did not set the flag');
    await change({ change: { scope: 'class', classId: 'socrata', state: 'on' } });
    let now = held(reader, ids);
    assert.equal(now.socrata.state, 'on', 'the class control did not set its unflagged member');
    assert.equal(now.socrata.own, false, 'a class control set the flag');
    assert.equal(now['nyc-record'].state, 'off', 'a class On turned On a source set Off on its own');
    const g = await gate(reader);
    assert.ok(g.selection.includes('socrata') && !g.selection.includes('nyc-record'), `the gate's selection: ${g.selection}`);

    // On by its own control inside a class then set Off: it stays On.
    await change({ change: { scope: 'source', sourceId: 'socrata', state: 'on' } });
    await change({ change: { scope: 'source', sourceId: 'nyc-record', state: 'ask-first' } });
    await change({ change: { scope: 'class', classId: 'socrata', state: 'off' } });
    now = held(reader, ids);
    assert.equal(now.socrata.state, 'on', 'a class Off turned Off a source set On on its own');
    assert.equal(now['nyc-record'].state, 'ask-first', 'a flagged Ask first moved');

    // Cleared: the class set to the state a flagged member already has.
    await change({ change: { scope: 'class', classId: 'socrata', state: 'on' } });
    now = held(reader, ids);
    assert.equal(now.socrata.own, false, 'the class set to its state did not clear the flag');
    assert.equal(now['nyc-record'].own, true, 'a flagged member in another state lost its flag');

    // The pause: Don't allow sets the flag; a later class answer leaves it Off.
    assert.equal((await decide(reader, 'nyc-record', 'off')).status, 200);
    now = held(reader, ids);
    assert.deepEqual([now['nyc-record'].state, now['nyc-record'].own], ['off', true], 'Don\'t allow did not set the flag');
    await change({ change: { scope: 'source', sourceId: 'socrata', state: 'ask-first' } });
    const answered = await decide(reader, 'socrata', 'allow-class');
    assert.equal(answered.status, 200, await answered.clone().text());
    now = held(reader, ids);
    assert.equal(now['nyc-record'].state, 'off', 'a class answer turned On a source refused with Don\'t allow');
    assert.equal(now.socrata.state, 'ask-first', 'a class answer moved the asking source set on its own (Q1, the rule as written)');
    assert.equal((await decide(reader, 'socrata', 'allow')).status, 200);
    now = held(reader, ids);
    assert.deepEqual([now.socrata.state, now.socrata.own], ['on', true], 'Allow did not set the flag');
    assert.ok(!(await gate(reader)).selection.includes('nyc-record'), 'the gate selected a source refused at the pause');

    // "Enable all data sources", at the pause: every source On, every flag cleared.
    assert.equal((await decide(reader, 'data-commons', 'allow-all')).status, 200);
    now = held(reader, ids);
    for (const id of ids) assert.deepEqual([id, now[id].state, now[id].own], [id, 'on', false]);

    // And from Settings.
    await change({ change: { scope: 'source', sourceId: 'nyc-charter', state: 'off' } });
    await change({ change: { scope: 'all', state: 'on' } });
    now = held(reader, ids);
    for (const id of ids) assert.deepEqual([id, now[id].state, now[id].own], [id, 'on', false]);
    const body = (await (await get(reader)).json()) as Json;
    assert.deepEqual(body.setOnItsOwn, []);
  });
}

test('A8 (red): the pause\'s off-class turns Off the class\'s members not set on their own, and the run declines the asking source', async () => {
  const { hash, ids } = await current();
  const reader = await consented('cookie', Object.fromEntries(ids.map((id) => [id, 'on'])));
  const flagged = await put(reader, { change: { scope: 'source', sourceId: 'socrata', state: 'on' }, flowsVersion: hash });
  assert.equal(flagged.status, 200);
  const answered = await decide(reader, 'nyc-record', 'off-class');
  assert.equal(answered.status, 200, await answered.clone().text());
  const now = held(reader, ids);
  assert.equal(now['nyc-record'].state, 'off');
  assert.equal(now.socrata.state, 'on', 'off-class turned Off a source set On on its own');
  assert.equal(decision.runDecisionOf('off-class'), 'off');
  assert.equal(decision.runDecisionOf('allow-class'), 'allow');
});

// =====================================================================================================================
// A9 (pin): no source is On unless the reader set it On, set its class On, or gave an answer that said so.
// =====================================================================================================================

/** A small seeded generator, so a failure names its sequence. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function explainedOnly(store: Store, steps: number, seed: number, withClasses: boolean): Promise<void> {
  const { hash, ids } = await current();
  const reader: Reader = { store };
  const defaults = ((await (await get(reader)).json()) as Json).defaults as Record<string, string>;
  assert.ok(Object.values(defaults).every((s) => s === 'ask-first'), 'premise: on a site that can ask every source starts Ask first');
  const response = await put(reader, { states: defaults, flowsVersion: hash });
  assert.equal(response.status, 200);
  const explained = new Set<string>();
  const manifest = typeof flows.flowsManifest === 'function' ? flows.flowsManifest() : [];
  const membersOf = (id: string) => {
    const base = manifest.find((e: Json) => e.sourceId === id)?.base ?? id;
    return ids.filter((m) => m === base || manifest.find((e: Json) => e.sourceId === m)?.base === base);
  };
  const next = rng(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const log: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const id = pick(ids);
    const state = pick(['on', 'ask-first', 'off']);
    const kinds = withClasses ? ['map', 'allow', 'off', 'allow-all', 'source', 'class', 'all', 'allow-class', 'off-class'] : ['map', 'allow', 'off', 'allow-all'];
    const kind = pick(kinds);
    log.push(`${kind}:${id}:${state}`);
    let r: Response;
    if (kind === 'map') {
      const shown = flat(((await (await get(reader)).json()) as Json).states ?? {});
      r = await put(reader, { states: { ...Object.fromEntries(ids.map((x) => [x, shown[x] ?? 'ask-first'])), [id]: state }, flowsVersion: hash });
      if (state === 'on') explained.add(id);
    } else if (kind === 'source') {
      r = await put(reader, { change: { scope: 'source', sourceId: id, state }, flowsVersion: hash });
      if (state === 'on') explained.add(id);
    } else if (kind === 'class') {
      const members = membersOf(id);
      r = await put(reader, { change: { scope: 'class', classId: manifest.find((e: Json) => e.sourceId === id)?.base ?? id, state }, flowsVersion: hash });
      if (state === 'on') for (const m of members) explained.add(m);
    } else if (kind === 'all') {
      r = await put(reader, { change: { scope: 'all', state: 'on' }, flowsVersion: hash });
      for (const m of ids) explained.add(m);
    } else {
      r = await decide(reader, id, kind);
      if (kind === 'allow') explained.add(id);
      if (kind === 'allow-all') for (const m of ids) explained.add(m);
      if (kind === 'allow-class') for (const m of membersOf(id)) explained.add(m);
    }
    assert.equal(r.status, 200, `${log.join(' ')}: ${await r.clone().text()}`);
    const g = await gate(reader);
    for (const on of g.selection as string[]) assert.ok(explained.has(on), `${store}, seed ${seed}: ${on} is On with no act of the reader's: ${log.join(' ')}`);
  }
}

test('A9 (pin): on a site that can ask, from the defaults, every sequence of writes over the seven turns On only what the reader turned On', async () => {
  for (const store of ['cookie', 'row'] as const) {
    for (const seed of [1, 2, 3]) {
      globals.__s4w1.rows.clear();
      await explainedOnly(store, 25, seed, false);
    }
  }
});

test('A9 (head): with the source, class and all changes and the class answers, over the seven and at 200', async () => {
  assert.equal(typeof flows.flowsManifest, 'function', 'statement.ts exports no flowsManifest');
  for (const store of ['cookie', 'row'] as const) {
    for (const seed of [4, 5]) {
      globals.__s4w1.rows.clear();
      await explainedOnly(store, 30, seed, true);
    }
  }
  hook();
  try {
    for (const store of ['cookie', 'row'] as const) {
      globals.__s4w1.rows.clear();
      await explainedOnly(store, 12, 6, true);
    }
  } finally {
    flows.setFlowsSourceInputsForTests?.(null);
  }
});

// =====================================================================================================================
// A10 (pin): a holder that keeps less on a line several members share notifies and asks nothing.
// =====================================================================================================================

/** Two sources of one class sharing one holder line, as a statement states them. */
function sharedHolder(keeps: string): Json {
  const recipient = (id: string) => ({ id: `source:${id}`, key: 'MCP servers', role: 'source', host: 'socrata.fixture.example', receives: 'r', keptBy: [{ holder: 'Example Holder S', keeps }] });
  return {
    version: 'a'.repeat(64),
    date: '2026-11-01',
    recipients: [],
    links: { privacy: '/privacy' },
    sources: ['socrata', 'nyc-record'].map((id) => ({ sourceId: id, displayName: id, publisher: 'p', variant: { variant: 'remote', kind: 'remote', runsAt: 'other' }, host: 'socrata.fixture.example', freshness: 'f', recipients: [recipient(id)], version: 'b'.repeat(64) })),
  };
}

test('A10 (pin): a holder\'s "keeps less" on a line two members share is a notice for each and asks nothing', () => {
  const classification = consent.classifyFlowsChange(sharedHolder('content'), sharedHolder('metadata'));
  assert.equal(classification.verdict, 'notify');
  assert.deepEqual(consent.reaskOf(classification), { base: false, sources: [] });
  assert.deepEqual(classification.changes.map((c: Json) => [c.sourceId, c.rule]), [['socrata', 'source-posture-better'], ['nyc-record', 'source-posture-better']]);
  assert.equal(consent.noticesOf(sharedHolder('content'), sharedHolder('metadata')).length, 2);
});

test('A10 (head): at 200, a row given when a class\'s shared holder kept more is in force, told once per member, and every state stays', async () => {
  hook();
  try {
    const { statement, ids } = await current();
    // A class of more than one member whose shared holder keeps a ranked posture below content.
    const keepsOf = (id: string) => statement.sources.find((s: Json) => s.sourceId === id).recipients[0].keptBy[0].keeps;
    const server = ['boston-opencontext', 'socrata', 'nyc-checkbook', 'data-commons'].find((id) => keepsOf(id) === 'none' || keepsOf(id) === 'metadata');
    assert.ok(server, 'premise: a class of several members shares a holder keeping less than content');
    const members = ids.filter((id) => id === server || fixture.entries.find((e) => e.sourceId === id)?.base === server);
    assert.ok(members.length > 1, 'premise: the class has several members');
    for (const id of members) assert.equal(keepsOf(id), keepsOf(server!), `premise: ${id} shares its server's holder line`);
    const prior = structuredClone(statement);
    for (const s of prior.sources) if (members.includes(s.sourceId)) s.recipients[0].keptBy[0].keeps = 'content';
    const states = Object.fromEntries(ids.map((id, i) => [id, ['on', 'ask-first', 'off'][i % 3]]));
    globals.__s4w1.rows.set(DB, preS4Row(prior, states));
    const reader: Reader = { store: 'row' };
    const decision = await gate(reader);
    assert.equal(decision.ok, true, 'a holder keeping less asked again');
    assert.deepEqual(decision.states, states);
    const body = (await (await get(reader)).json()) as Json;
    assert.equal((body.notices as Json[]).length, members.length, 'not one notice per member');
    assert.equal(globals.__s4w1.writes, 0);
  } finally {
    flows.setFlowsSourceInputsForTests?.(null);
  }
});

// =====================================================================================================================
// A11 (pin): a cookie's re-ask keeps today's scope.
// =====================================================================================================================

test('A11 (pin): a first-form cookie whose one source\'s version changed re-asks that source alone; every other state stays', async () => {
  const { statement, ids } = await current();
  const value = firstForm(statement, SEVEN_STATES);
  const cookie = JSON.parse(Buffer.from(value.slice(value.indexOf('=') + 1), 'base64url').toString('utf8'));
  cookie.states['data-commons'].version = '0'.repeat(64);
  const reader: Reader = { store: 'cookie', cookie: `${consent.CONSENT_COOKIE_NAME}=${Buffer.from(JSON.stringify(cookie), 'utf8').toString('base64url')}` };
  const decision = await gate(reader);
  assert.equal(decision.ok, false);
  assert.equal(decision.payload.code, 'consent_required');
  assert.deepEqual(decision.payload.reask, { base: false, sources: ['data-commons'] });
  const body = (await (await get(reader)).json()) as Json;
  for (const id of ids) assert.equal(body.states[id].state, SEVEN_STATES[id]);
});

test('A11 (head): a second-form cookie whose one source\'s 4-byte version changed re-asks that source alone', async () => {
  const { statement } = await current();
  const value = secondForm(statement, Object.fromEntries(Object.entries(SEVEN_STATES).map(([id, state]) => [id, { state, since: '2026-11-01' }]))).split('=')[1];
  const bytes = Buffer.from(value, 'base64url');
  assert.equal(bytes[0], 2, 'the encoder did not write the second form');
  const at = 33 + 11 * Object.keys(SEVEN_STATES).indexOf('data-commons');
  bytes[at + 4] ^= 0xff;
  const decision = await gate({ store: 'cookie', cookie: `${consent.CONSENT_COOKIE_NAME}=${bytes.toString('base64url')}` });
  assert.equal(decision.ok, false);
  assert.deepEqual(decision.payload.reask, { base: false, sources: ['data-commons'] });
});

// =====================================================================================================================
// A12 (red): no writer drops what it was not asked to change.
// =====================================================================================================================

/** The store A12 starts from: all three states, flags set both ways, one entry with no flag, and a retired source. */
const A12_ENTRIES: Record<string, Entry> = {
  socrata: { state: 'on', since: '2026-10-01', own: true },
  'nyc-record': { state: 'off', since: '2026-10-02', own: false },
  'data-commons': { state: 'ask-first', since: '2026-10-03', own: true },
  'nyc-charter': { state: 'off', since: '2026-10-04' },
  'nyc-checkbook': { state: 'on', since: '2026-10-05', own: false },
  'nys-legislation': { state: 'ask-first', since: '2026-10-06', own: false },
  'ckan-server': { state: 'off', since: '2026-10-07', own: true },
  [RETIRED]: { state: 'on', since: '2026-10-08', own: true },
};

async function a12Reader(store: Store): Promise<Reader> {
  const { statement } = await current();
  if (store === 'row') {
    globals.__s4w1.rows.set(DB, { userId: DB, states: structuredClone(A12_ENTRIES), flowsHash: flows.statementHash(statement), flowsStatement: statement, consentedAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-08T00:00:00Z') });
    return { store };
  }
  return { store, cookie: secondForm(statement, A12_ENTRIES) };
}

/** Every entry but `asked` is unchanged, the retired source's included; the asked ones are what `expect` says. */
function onlyAsked(reader: Reader, before: Json, asked: Record<string, { state: string; own: boolean }>, label: string): void {
  const ids = [...Object.keys(A12_ENTRIES)];
  const after = held(reader, ids);
  for (const id of ids) {
    if (Object.hasOwn(asked, id)) {
      assert.deepEqual([after[id].state, after[id].own], [asked[id].state, asked[id].own], `${label}: ${id} is not what it was asked`);
      if (after[id].state === before[id].state) assert.equal(after[id].since, before[id].since, `${label}: ${id} lost its date`);
    } else {
      assert.deepEqual(after[id], before[id], `${label}: ${id} changed though it was not asked`);
    }
  }
}

const WRITERS: Array<[string, (reader: Reader, hash: string) => Promise<Response>, Record<string, { state: string; own: boolean }>]> = [
  ['the settings save, a states map naming one source', (r, hash) => put(r, { states: { 'nys-legislation': 'on' }, flowsVersion: hash }), { 'nys-legislation': { state: 'on', own: false } }],
  ['the settings save, one source', (r, hash) => put(r, { change: { scope: 'source', sourceId: 'nyc-checkbook', state: 'off' }, flowsVersion: hash }), { 'nyc-checkbook': { state: 'off', own: true } }],
  ['the settings save, a class', (r, hash) => put(r, { change: { scope: 'class', classId: 'socrata', state: 'off' }, flowsVersion: hash }), { 'nyc-record': { state: 'off', own: false } }],
  ['Settings\' "Enable all data sources"', (r, hash) => put(r, { change: { scope: 'all', state: 'on' }, flowsVersion: hash }), Object.fromEntries(Object.keys(A12_ENTRIES).filter((id) => id !== RETIRED).map((id) => [id, { state: 'on', own: false }]))],
  ['the pause\'s Allow', (r) => decide(r, 'nys-legislation', 'allow'), { 'nys-legislation': { state: 'on', own: true } }],
  ['the pause\'s Don\'t allow', (r) => decide(r, 'nyc-checkbook', 'off'), { 'nyc-checkbook': { state: 'off', own: true } }],
  ['the pause\'s "Enable all data sources"', (r) => decide(r, 'data-commons', 'allow-all'), Object.fromEntries(Object.keys(A12_ENTRIES).filter((id) => id !== RETIRED).map((id) => [id, { state: 'on', own: false }]))],
  // Socrata, set On on its own, is already On: the class answer clears its flag (premise 7, "Cleared").
  ['the pause\'s class answer, On', (r) => decide(r, 'nyc-record', 'allow-class'), { 'nyc-record': { state: 'on', own: false }, socrata: { state: 'on', own: false } }],
  ['the pause\'s class answer, Off', (r) => decide(r, 'nyc-record', 'off-class'), { 'nyc-record': { state: 'off', own: false } }],
];

for (const store of ['cookie', 'row'] as const) {
  for (const [label, write, asked] of WRITERS) {
    test(`A12 (red), ${store}: ${label} changes what it was asked and nothing else, flags included`, async () => {
      const { hash } = await current();
      const reader = await a12Reader(store);
      const before = held(reader, Object.keys(A12_ENTRIES));
      const response = await write(reader, hash);
      assert.equal(response.status, 200, `${label}: ${await response.clone().text()}`);
      const body = (await response.clone().json()) as Json;
      assert.notEqual(body.moved, false, `${label}: the consent did not move`);
      onlyAsked(reader, before, asked, `${store}, ${label}`);
    });
  }
}

test('A12 (red): keeping a signed-out consent on the account copies each configured source\'s state, date and flag; dismissing notices keeps the row\'s states', async () => {
  const { ids } = await current();
  const signedOut = await a12Reader('cookie');
  const reader: Reader = { store: 'row', cookie: signedOut.cookie };
  const body = (await (await get(reader)).json()) as Json;
  assert.equal(body.keptFromCookie, true, 'premise: the GET kept the cookie\'s consent');
  const fromCookie = held(signedOut, Object.keys(A12_ENTRIES));
  const row = globals.__s4w1.rows.get(DB)!;
  for (const id of ids) {
    assert.deepEqual(row.states[id].state, fromCookie[id].state, id);
    assert.deepEqual(row.states[id].since, fromCookie[id].since, id);
    assert.equal(consent.setOnItsOwn(row.states[id]), fromCookie[id].own, `${id}'s flag was not kept on the account`);
  }
  // A retired source's state is not kept on the account: it is a source this instance does not configure (named cost).
  assert.equal(row.states[RETIRED], undefined);

  const { hash } = await current();
  const before = structuredClone(row.states);
  const dismissed = await patch(reader, { flowsVersion: hash });
  assert.equal(dismissed.status, 200);
  assert.deepEqual(globals.__s4w1.rows.get(DB)!.states, before, 'dismissing notices changed a state or a flag');
});

test('A12 (red): the first consent\'s Allow flags only the sources the reader set before it; a change body needs a consent in force (409)', async () => {
  const { hash, ids } = await current();
  const reader: Reader = { store: 'cookie' };
  const refused = await put(reader, { change: { scope: 'source', sourceId: 'socrata', state: 'on' }, flowsVersion: hash });
  assert.equal(refused.status, 409);
  assert.equal(((await refused.json()) as Json).code, 'consent_required');
  assert.equal(reader.cookie, undefined, 'a change before a consent set a cookie');
  const states = Object.fromEntries(ids.map((id) => [id, 'ask-first']));
  const allowed = await put(reader, { states: { ...states, socrata: 'on', 'data-commons': 'off' }, own: ['socrata', 'data-commons'], flowsVersion: hash });
  assert.equal(allowed.status, 200);
  const now = held(reader, ids);
  for (const id of ids) assert.equal(now[id].own, id === 'socrata' || id === 'data-commons', id);
});

// =====================================================================================================================
// A1 (red, driven leg) and A2 (red): the bound, in both writers.
// =====================================================================================================================

test('A1 (red): at 200 sources, a signed-out consent holding a state for every one writes a cookie of at most 4,096 bytes (2,999)', async () => {
  hook();
  try {
    const { hash, ids } = await current();
    assert.equal(ids.length, 200, 'premise: the hook configures 200 sources');
    const reader: Reader = { store: 'cookie' };
    const response = await put(reader, { states: Object.fromEntries(ids.map((id) => [id, 'ask-first'])), flowsVersion: hash });
    assert.equal(response.status, 200, await response.clone().text());
    const size = pairSize(response.headers.get('set-cookie'));
    assert.ok(size > 0 && size <= BOUND, `the cookie is ${size} bytes`);
    assert.equal(size, 2999);
    const g = await gate(reader);
    assert.equal(g.ok, true);
    assert.equal(Object.keys(g.states).length, 200, 'the gate does not read every state back');
  } finally {
    flows.setFlowsSourceInputsForTests?.(null);
  }
});

test('A2 (red): every cookie a writer sets is at most 4,096 bytes (the pause\'s Allow over a cookie holding 25 retired entries)', async () => {
  const { statement, ids } = await current();
  const retired = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`example-retired-source-${String(i).padStart(2, '0')}`, 'on']));
  const reader: Reader = { store: 'cookie', cookie: firstForm(statement, { ...SEVEN_STATES, ...retired }) };
  const response = await decide(reader, 'data-commons', 'allow');
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  const body = (await response.clone().json()) as Json;
  assert.ok(setCookie !== null || body.code === 'consent_cookie_full', 'the answer neither set a cookie nor said the cookie is full');
  assert.ok(pairSize(setCookie) <= BOUND, `the pause set a cookie of ${pairSize(setCookie)} bytes`);
  assert.equal(decoded(reader, ids).states['data-commons'].state, 'on');
});

async function atTheBound(store: Store = 'cookie'): Promise<{ reader: Reader; hash: string; ids: string[]; stored: string[]; free: string[] }> {
  hook(100);
  const { statement, hash, ids } = await current();
  assert.equal(ids.length, 300, 'premise: the hook configures 300 sources');
  assert.deepEqual(consent.idHashCollisions(ids), [], 'premise: no two of the 300 ids share a hash');
  // 274 stored states: the most the second form holds. Socrata's class is left with members that have none.
  const stored = ids.filter((id) => id !== 'socrata').slice(0, 274);
  const free = ids.filter((id) => !stored.includes(id));
  const reader: Reader = { store, cookie: secondForm(statement, Object.fromEntries(stored.map((id) => [id, { state: 'ask-first', since: '2026-11-01' }]))) };
  assert.equal(reader.cookie!.length, 4084, 'premise: 274 states take 4,084 bytes');
  return { reader, hash, ids, stored, free };
}

test('A2 (red): past the bound, the settings save sets no cookie and answers 422 consent_cookie_full; a change that adds no entry still writes', async () => {
  try {
    const { reader, hash, stored, free } = await atTheBound();
    const cookie = reader.cookie;
    const refused = await put(reader, { change: { scope: 'source', sourceId: free[0], state: 'on' }, flowsVersion: hash });
    assert.equal(refused.status, 422, await refused.clone().text());
    assert.equal(refused.headers.get('set-cookie'), null, 'a refused write set a cookie');
    const body = (await refused.json()) as Json;
    assert.equal(body.code, 'consent_cookie_full');
    assert.equal(reader.cookie, cookie);
    // The first consent's body too.
    const map = await put({ store: 'cookie', cookie }, { states: { [free[0]]: 'on' }, flowsVersion: hash });
    assert.equal(map.status, 422);
    assert.equal(map.headers.get('set-cookie'), null);
    // At the bound, a change to a source that has an entry fits: the refusal is by size, not by count.
    const fits = await put(reader, { change: { scope: 'source', sourceId: stored[3], state: 'off' }, flowsVersion: hash });
    assert.equal(fits.status, 200, await fits.clone().text());
    assert.ok(pairSize(fits.headers.get('set-cookie')) <= BOUND);
  } finally {
    flows.setFlowsSourceInputsForTests?.(null);
  }
});

test('A2 (red): past the bound, the pause\'s answers set no cookie and answer 200 moved: false with consent_cookie_full; the decision is saved', async () => {
  try {
    const { reader, free } = await atTheBound();
    for (const value of ['allow', 'allow-class']) {
      const cookie = reader.cookie;
      const response = await decide(reader, free[0], value);
      assert.equal(response.status, 200, value);
      assert.equal(response.headers.get('set-cookie'), null, `${value} set a cookie past the bound`);
      const body = (await response.json()) as Json;
      assert.deepEqual([body.decision, body.moved, body.code], [value, false, 'consent_cookie_full'], value);
      assert.equal(reader.cookie, cookie);
      const saved = [...kv.entries.values()].map((e) => JSON.parse(e.value)).filter((e: Json) => e.decision === value);
      assert.equal(saved.length, 1, `${value}: the decision was not saved for the run`);
    }
  } finally {
    flows.setFlowsSourceInputsForTests?.(null);
  }
});

// =====================================================================================================================
// A14 (red): the hook reaches the gate, the consent route and the pause's route; nothing else sets it.
// =====================================================================================================================

test('A14 (red): through the hook, all three see the 200: the gate selects among 200, the consent route lists 200 with the fixture\'s defaults, and the pause\'s class answer moves Socrata\'s 157', async () => {
  hook();
  try {
    const { statement, hash, ids } = await current();
    assert.equal(ids.length, 200);
    const states = Object.fromEntries(ids.map((id, i) => [id, ['on', 'ask-first', 'off'][i % 3]]));
    const reader: Reader = { store: 'cookie', cookie: secondForm(statement, Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state, since: '2026-11-01', own: false }]))) };
    const g = await gate(reader);
    assert.equal(g.ok, true);
    assert.deepEqual(g.selection, ids.filter((id) => states[id] === 'on'));

    // The defaults where the site cannot ask: the fixture's own consentDefault (197 On, 3 Ask first).
    process.env.SOURCE_ROUTING = 'all-sources';
    let body: Json;
    try {
      body = (await (await get({ store: 'cookie' })).json()) as Json;
    } finally {
      process.env.SOURCE_ROUTING = 'in-loop';
    }
    assert.equal(Object.keys(body.defaults).length, 200);
    const expected = Object.fromEntries(fixture.entries.map((e) => [e.sourceId, e.consentDefault]));
    assert.deepEqual(body.defaults, expected, 'the consent route\'s defaults are not the hook\'s manifest');

    const written = await put(reader, { change: { scope: 'source', sourceId: ids[1], state: 'on' }, flowsVersion: hash });
    assert.equal(written.status, 200, await written.clone().text());

    const socrata = ids.filter((id) => id === 'socrata' || fixture.entries.find((e) => e.sourceId === id)?.base === 'socrata');
    assert.equal(socrata.length, 157);
    const flagged = socrata.filter((id) => states[id] === 'off').slice(0, 5);
    for (const id of flagged) assert.equal((await put(reader, { change: { scope: 'source', sourceId: id, state: 'off' }, flowsVersion: hash })).status, 200);
    const answered = await decide(reader, socrata[1], 'allow-class');
    assert.equal(answered.status, 200, await answered.clone().text());
    const now = held(reader, ids);
    assert.deepEqual(socrata.filter((id) => now[id].state === 'on').length, 157 - flagged.length, 'the class answer did not move every member not set on its own');
    for (const id of flagged) assert.equal(now[id].state, 'off', `${id}, set on its own, moved`);
  } finally {
    flows.setFlowsSourceInputsForTests?.(null);
  }
});

test('A14 (red): no request header and no environment variable can set the hook', async () => {
  assert.equal(typeof flows.setFlowsSourceInputsForTests, 'function', 'statement.ts has no test hook');
  flows.setFlowsSourceInputsForTests(null);
  const manifestPath = path.join(SRC, 'lib', 'sources', 'fixtures', 'manifest-200.json');
  process.env.FLOWS_MANIFEST = manifestPath;
  process.env.CIVIC_MANIFEST = manifestPath;
  try {
    const headers = { 'x-flows-manifest': manifestPath, 'x-flows-source-inputs': JSON.stringify({ manifest: fixture.entries.slice(0, 3) }), 'x-test-hook': '1' };
    const body = (await (await get({ store: 'cookie' }, headers)).json()) as Json;
    assert.deepEqual(Object.keys(body.defaults).sort(), Object.keys(SEVEN_STATES).sort(), 'a header or a variable changed the sources the route sees');
    const { ids } = await current();
    assert.deepEqual(ids.slice().sort(), Object.keys(SEVEN_STATES).sort());
  } finally {
    delete process.env.FLOWS_MANIFEST;
    delete process.env.CIVIC_MANIFEST;
  }
});

test('A14 (red): no tracked file but statement.ts and the tests names the hook\'s setter', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
  const naming = tracked
    .filter((f) => /\.(?:[cm]?[jt]sx?)$/.test(f) && !/\.test\.[cm]?[jt]sx?$/.test(f))
    .filter((f) => fs.existsSync(path.join(REPO, f)) && fs.readFileSync(path.join(REPO, f), 'utf8').includes('setFlowsSourceInputsForTests'));
  assert.deepEqual(naming, ['src/lib/flows/statement.ts']);
});
