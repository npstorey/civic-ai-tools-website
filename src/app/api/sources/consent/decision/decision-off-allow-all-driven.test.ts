// UX-2 P4b, criteria 5 and 6 at the decision route (D7 = C; ASK2 = B with S4;
// L10): `POST /api/sources/consent/decision` takes two new values.
//
//   - `off`, "Don't allow" at the pause: the decision is written to the entry
//     the run polls, then that one source is moved Off in the reader's consent,
//     through the same writer `allow` uses (the row, kept with its `flowsHash`
//     and `flowsStatement`; or the cookie, kept with its `flows` and every
//     other source's entry). A later run's directory leaves the source out
//     (`directorySet`), so it is not asked again.
//   - `allow-all`, "Allow all data sources": the decision is written, then
//     every configured source is moved On, in one write and one `Set-Cookie`.
//   - `not-now` is still accepted, with today's meaning (it moves nothing), for
//     a page loaded before the deploy.
//
// WHAT IS DRIVEN. The route's real `POST` and the real `decision.ts`, the real
// consent cookie and the real flows statement, with the stubs of
// `decision-route-driven.test.ts` (copied, not imported: a test file is not a
// module another test loads).
//
// THE SHAPE THAT CAN FAIL. The cookie and the row hold two configured sources
// in two different states, neither of them the one written, so a write of one
// state alone, or a write that drops another source's entry, is told apart.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the route answers 400 to both values.
//
// Run with: npm test

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FAKE_VERCEL_KV_MODULE, FakeDecisionKv } from '../../../../../lib/sources/decision-store-for-tests.ts';

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
type Json = Record<string, unknown>;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', '..', '..', '..');
const CONSENT_STORE_FILE = path.join(SRC, 'lib', 'sources', 'consent-store.ts');

interface Row { userId: string; states: Record<string, { state: string; since: string }>; flowsHash: string; flowsStatement: unknown; consentedAt: Date; updatedAt: Date }
interface Globals { __w2Decision: { session: unknown; rows: Map<string, Row>; writes: number; failWrite: boolean }; __w2DecisionKv: FakeDecisionKv }
const globals = globalThis as unknown as Globals;
globals.__w2Decision = { session: null, rows: new Map(), writes: 0, failWrite: false };

const STUB_PREFIX = 'file:///r8-w2-decision-route-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next-auth': `export async function getServerSession() { return globalThis.__w2Decision.session; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@vercel/kv': FAKE_VERCEL_KV_MODULE,
  'consent-store': `
    const rows = () => globalThis.__w2Decision.rows;
    export async function readConsentRow(userId) { return rows().get(userId) ?? null; }
    export async function writeConsentRow(userId, row) {
      if (globalThis.__w2Decision.failWrite) throw new Error('fake row store: the write was refused');
      globalThis.__w2Decision.writes += 1;
      const prior = rows().get(userId);
      const now = row.now ?? new Date();
      rows().set(userId, { userId, states: row.states, flowsHash: row.flowsHash, flowsStatement: row.flowsStatement, consentedAt: prior?.consentedAt ?? now, updatedAt: now });
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
      if (file === null) throw new Error(`r8-w2 decision route test hook: cannot resolve ${specifier}`);
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
    return nextLoad(url, context);
  },
});

// --- The configuration ------------------------------------------------------------------

for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
process.env.KV_REST_API_URL = 'https://kv.fixture.example';
process.env.KV_REST_API_TOKEN = 'fixture-kv-token';
process.env.RATE_LIMIT_SECRET = 'fixture-w2-secret';

const clock = 1_800_000_000_000;
const kv = new FakeDecisionKv(() => clock);
globals.__w2DecisionKv = kv;

/** What W2 adds (specifiers typed `string`, so the red commit type-checks). */
const ROUTE: string = pathToFileURL(path.join(HERE, 'route.ts')).href;
const DECISION: string = pathToFileURL(path.join(SRC, 'lib', 'sources', 'decision.ts')).href;
const route = (await import(ROUTE).catch(() => null)) as Mod | null;
const { readMcpEnvFromProcess } = (await import(pathToFileURL(path.join(SRC, 'lib', 'mcp', 'registry.ts')).href)) as Mod;
const decision = (await import(DECISION).catch(() => null)) as Mod | null;
const { buildFlowsStatement } = (await import(pathToFileURL(path.join(SRC, 'lib', 'flows', 'statement.ts')).href)) as Mod;
const { consentCookieForTests } = (await import(pathToFileURL(path.join(SRC, 'lib', 'sources', 'consent-cookie-for-tests.ts')).href)) as Mod;
const consent = (await import(pathToFileURL(path.join(SRC, 'lib', 'sources', 'consent.ts')).href)) as Mod;

const DB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function need(): { route: Mod; decision: Mod } {
  assert.ok(route, 'src/app/api/sources/consent/decision/route.ts does not exist');
  assert.ok(decision, 'src/lib/sources/decision.ts does not exist');
  return { route: route!, decision: decision! };
}

/** An entry as the pause writes it: its own name, fields and expiry, through the store's own command. */
async function mint(sourceId: string, dbId?: string): Promise<string> {
  const { decision: d } = need();
  const key = d.newDecisionKey();
  const entry: Json = { sourceId, ...(dbId ? { reader: d.readerCode(dbId, 'fixture-w2-secret') } : {}) };
  await kv.set(`${d.DECISION_KEY_PREFIX}${key}`, entry, { ex: d.DECISION_ENTRY_TTL_SECONDS, nx: true });
  return key;
}

async function post(body: unknown, options: { session?: unknown; cookie?: string; raw?: string } = {}): Promise<Response> {
  const { route: r } = need();
  globals.__w2Decision.session = options.session ?? null;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.cookie) headers.cookie = options.cookie;
  const request = new Request('https://site.fixture.example/api/sources/consent/decision', {
    method: 'POST',
    headers,
    body: options.raw ?? JSON.stringify(body),
  });
  return r.POST(request);
}

const signedIn = (dbId: string) => ({ user: { id: 'gh-fixture', dbId } });

beforeEach(() => {
  kv.entries.clear();
  kv.calls.length = 0;
  kv.failGet = false;
  kv.failSet = false;
  globals.__w2Decision.rows.clear();
  globals.__w2Decision.writes = 0;
  globals.__w2Decision.failWrite = false;
  process.env.RATE_LIMIT_SECRET = 'fixture-w2-secret';
});

// --- The answers ----------------------------------------------------------------------------

const { directorySet } = (await import(pathToFileURL(path.join(SRC, 'lib', 'mcp', 'routing-mode.ts')).href)) as Mod;
const configured = readMcpEnvFromProcess();

/** The cookie a `Set-Cookie` header sets, decoded as the next request would carry it. */
function cookieFrom(setCookie: string | null): Mod {
  assert.ok(setCookie, 'no cookie was set');
  const after = consent.readConsentCookie(new Request('https://x.example/', { headers: { cookie: setCookie!.split(';')[0] } }));
  assert.ok(after, 'the cookie set does not decode');
  return after;
}

const flat = (states: Record<string, { state: string }>) => Object.fromEntries(Object.entries(states).map(([id, s]) => [id, s.state]));

// --- off: "Don't allow" at the pause ---------------------------------------------------------------

test('UX-2 P4b criterion 5: off on the cookie path moves that one source Off; the cookie keeps its flows and every other entry', async () => {
  const statement = await buildFlowsStatement();
  const cookie = consentCookieForTests({ socrata: 'on', 'data-commons': 'ask-first' }, statement);
  const before = consent.readConsentCookie(new Request('https://x.example/', { headers: { cookie } }));
  const key = await mint('data-commons');
  const response = await post({ key, decision: 'off' }, { cookie });
  assert.equal(response.status, 200, `off was answered ${response.status}: ${await response.clone().text()}`);
  const after = cookieFrom(response.headers.get('set-cookie'));
  assert.equal(after.flows, before.flows);
  assert.equal(after.states['data-commons'].state, 'off', 'the source is not Off in the cookie');
  assert.deepEqual(after.states.socrata, before.states.socrata, 'another source\'s entry moved');
  assert.equal(globals.__w2Decision.writes, 0, 'a cookie-branch decline wrote a row');
});

test('UX-2 P4b criterion 5: off on the account path moves that one source Off; the row keeps its flowsHash, flowsStatement and every other state', async () => {
  const statement = await buildFlowsStatement();
  const oldStatement = { ...statement, date: '2026-01-01' };
  const prior: Row = {
    userId: DB_A,
    states: { socrata: { state: 'on', since: '2026-10-01' }, 'data-commons': { state: 'ask-first', since: '2026-10-02' } },
    flowsHash: 'f'.repeat(64),
    flowsStatement: oldStatement,
    consentedAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
  };
  globals.__w2Decision.rows.set(DB_A, prior);
  const key = await mint('data-commons', DB_A);
  const response = await post({ key, decision: 'off' }, { session: signedIn(DB_A) });
  assert.equal(response.status, 200, `off was answered ${response.status}`);
  assert.equal(response.headers.get('set-cookie'), null, 'a row decision set a cookie');
  const row = globals.__w2Decision.rows.get(DB_A)!;
  assert.equal(row.states['data-commons'].state, 'off', 'the source is not Off in the row');
  assert.deepEqual(row.states.socrata, prior.states.socrata);
  assert.equal(row.flowsHash, prior.flowsHash);
  assert.deepEqual(row.flowsStatement, oldStatement);
});

test('UX-2 P4b criterion 5: off is written to the entry the run polls', async () => {
  const statement = await buildFlowsStatement();
  const key = await mint('data-commons');
  const response = await post({ key, decision: 'off' }, { cookie: consentCookieForTests({ 'data-commons': 'ask-first' }, statement) });
  assert.equal(response.status, 200);
  const entry = JSON.parse(kv.entries.get(`${need().decision.DECISION_KEY_PREFIX}${key}`)!.value) as Json;
  assert.equal(entry.decision, 'off');
});

test('UX-2 P4b criterion 5: after off, a second run\'s directory reads the source Off: it is left out, and nothing asks about it', async () => {
  const statement = await buildFlowsStatement();
  const cookie = consentCookieForTests({ socrata: 'on', 'data-commons': 'ask-first' }, statement);
  const before = consent.readConsentCookie(new Request('https://x.example/', { headers: { cookie } }));
  const first = directorySet(configured, { enforced: true, states: flat(before.states) }) as Array<{ sourceId: string; state: string }>;
  assert.ok(first.some((e) => e.sourceId === 'data-commons' && e.state === 'ask-first'), 'premise: the first run lists the source as Ask first');
  const key = await mint('data-commons');
  const response = await post({ key, decision: 'off' }, { cookie });
  assert.equal(response.status, 200);
  const after = cookieFrom(response.headers.get('set-cookie'));
  const second = directorySet(configured, { enforced: true, states: flat(after.states) }) as Array<{ sourceId: string }>;
  // S2-B: router 0.8.0 configures NYC City Record wherever Socrata is (a pack over its server), On by default.
  assert.deepEqual(second.map((e) => e.sourceId), ['socrata', 'nyc-record'], 'the second run still lists the declined source');
});

// --- allow-all: "Allow all data sources" ------------------------------------------------------------

test('UX-2 P4b criterion 6: allow-all on the cookie path moves every configured source On, in one Set-Cookie', async () => {
  const statement = await buildFlowsStatement();
  const ids = statement.sources.map((s: { sourceId: string }) => s.sourceId);
  assert.ok(ids.length >= 2, 'premise: more than one source is configured');
  const cookie = consentCookieForTests({ socrata: 'off', 'data-commons': 'ask-first' }, statement);
  const key = await mint('data-commons');
  const response = await post({ key, decision: 'allow-all' }, { cookie });
  assert.equal(response.status, 200, `allow-all was answered ${response.status}`);
  const after = cookieFrom(response.headers.get('set-cookie'));
  assert.deepEqual(flat(after.states), Object.fromEntries(ids.map((id: string) => [id, 'on'])), 'not every configured source is On in the cookie');
  for (const id of ids) {
    assert.equal(after.states[id].version, statement.sources.find((s: { sourceId: string }) => s.sourceId === id).version, `${id}'s entry does not carry its version`);
  }
});

test('UX-2 P4b criterion 6: allow-all on the account path moves every configured source On in the row, keeping its flowsHash and flowsStatement', async () => {
  const statement = await buildFlowsStatement();
  const ids = statement.sources.map((s: { sourceId: string }) => s.sourceId);
  const prior: Row = {
    userId: DB_A,
    states: { socrata: { state: 'off', since: '2026-10-01' }, 'data-commons': { state: 'ask-first', since: '2026-10-02' } },
    flowsHash: 'e'.repeat(64),
    flowsStatement: statement,
    consentedAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
  };
  globals.__w2Decision.rows.set(DB_A, prior);
  const key = await mint('data-commons', DB_A);
  const response = await post({ key, decision: 'allow-all' }, { session: signedIn(DB_A) });
  assert.equal(response.status, 200, `allow-all was answered ${response.status}`);
  const row = globals.__w2Decision.rows.get(DB_A)!;
  assert.deepEqual(flat(row.states), Object.fromEntries(ids.map((id: string) => [id, 'on'])), 'not every configured source is On in the row');
  assert.equal(globals.__w2Decision.writes, 1, `allow-all wrote the row ${globals.__w2Decision.writes} times, not once`);
  assert.equal(row.flowsHash, prior.flowsHash);
});

test('UX-2 P4b criterion 6: allow-all is written to the entry the run polls', async () => {
  const statement = await buildFlowsStatement();
  const key = await mint('data-commons');
  const response = await post({ key, decision: 'allow-all' }, { cookie: consentCookieForTests({ 'data-commons': 'ask-first' }, statement) });
  assert.equal(response.status, 200);
  const entry = JSON.parse(kv.entries.get(`${need().decision.DECISION_KEY_PREFIX}${key}`)!.value) as Json;
  assert.equal(entry.decision, 'allow-all');
});

// --- not-now, kept for a page loaded before the deploy ------------------------------------------------

test('UX-2 P4b: not-now is still accepted and moves nothing (a tab loaded before the deploy)', async () => {
  const statement = await buildFlowsStatement();
  const key = await mint('data-commons');
  const response = await post({ key, decision: 'not-now' }, { cookie: consentCookieForTests({ 'data-commons': 'ask-first' }, statement) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null, 'not-now set a cookie');
});

test('UX-2 P4b: a value outside allow, off, allow-all and not-now is still refused 400', async () => {
  const key = await mint('data-commons');
  const response = await post({ key, decision: 'maybe' });
  assert.equal(response.status, 400);
});
