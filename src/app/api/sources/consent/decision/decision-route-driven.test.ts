// #644 W2 criterion 2 — `POST /api/sources/consent/decision`, driven.
//
// `{ key, decision }`, `decision` one of `allow` and `not-now`, keyed to a
// pause the loop minted (`src/lib/sources/decision.ts`). The route answers:
//   - 404 for a key the store does not hold, or no longer holds;
//   - 409 for a key already decided;
//   - 403 [D] when the key was minted under a `dbId` whose reader code is not
//     the request's; an anonymous key is checked by the key alone;
//   - 400 for a body it cannot read; 503 when the store fails;
//   - [D] the streaming routes' refusal, naming the variable, when
//     `RATE_LIMIT_SECRET` is unset, before any key is read;
//   - 200 on each decision. `allow` moves that one source to On through R6's
//     store: the row keeps its `flowsHash` and `flowsStatement`, the cookie
//     keeps its `flows` and every other source's entry. `not-now` moves
//     nothing.
// THE EXPIRY HOLDS: after either decision the entry expires no later than
// the pause's own write set it to. The store follows Redis's rules
// (`decision-store-for-tests.ts`): a plain `SET` clears an expiry, and
// `KEEPTTL` on a missing key creates one with none, so a decision written
// either way fails this leg.
//
// R6-WEB-D'S CONDITIONS 2 AND 3 (its consent of 2026-10-22 to the cookie
// guard's second setter): on Allow the stored consent is exactly what `PUT
// /api/sources/consent` stores for the same one-source change, shown by
// driving both writers from one starting consent on the cookie branch and
// the row branch; Not now and `no-answer` write no consent at all, counted.
//
// WHAT IS DRIVEN. The route's real `POST` and the real `decision.ts`, the
// real consent cookie and the real flows statement; for conditions 2 and 3
// the consent route's real `PUT` beside them. STUBS: `next-auth` and
// `@/lib/auth` (a session per case); `@vercel/kv` (the fake store, so no
// request leaves); `src/lib/sources/consent-store.ts` (an in-memory row per
// account), by its resolved path, since `decision.ts` imports it relatively.
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
interface Globals { __w2Decision: { session: unknown; rows: Map<string, Row>; writes: number }; __w2DecisionKv: FakeDecisionKv }
const globals = globalThis as unknown as Globals;
globals.__w2Decision = { session: null, rows: new Map(), writes: 0 };

const STUB_PREFIX = 'file:///r8-w2-decision-route-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next-auth': `export async function getServerSession() { return globalThis.__w2Decision.session; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@vercel/kv': FAKE_VERCEL_KV_MODULE,
  'consent-store': `
    const rows = () => globalThis.__w2Decision.rows;
    export async function readConsentRow(userId) { return rows().get(userId) ?? null; }
    export async function writeConsentRow(userId, row) {
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

let clock = 1_800_000_000_000;
const kv = new FakeDecisionKv(() => clock);
globals.__w2DecisionKv = kv;

/** What W2 adds (specifiers typed `string`, so the red commit type-checks). */
const ROUTE: string = pathToFileURL(path.join(HERE, 'route.ts')).href;
const DECISION: string = pathToFileURL(path.join(SRC, 'lib', 'sources', 'decision.ts')).href;
const route = (await import(ROUTE).catch(() => null)) as Mod | null;
/** R6's consent route, the writer the decision's Allow must match (R6-WEB-D's condition 2). */
const CONSENT_ROUTE: string = pathToFileURL(path.join(HERE, '..', 'route.ts')).href;
const consentRoute = (await import(CONSENT_ROUTE)) as Mod;
const { readMcpEnvFromProcess } = (await import(pathToFileURL(path.join(SRC, 'lib', 'mcp', 'registry.ts')).href)) as Mod;
const decision = (await import(DECISION).catch(() => null)) as Mod | null;
const { buildFlowsStatement, statementHash } = (await import(pathToFileURL(path.join(SRC, 'lib', 'flows', 'statement.ts')).href)) as Mod;
const { consentCookieForTests } = (await import(pathToFileURL(path.join(SRC, 'lib', 'sources', 'consent-cookie-for-tests.ts')).href)) as Mod;
const consent = (await import(pathToFileURL(path.join(SRC, 'lib', 'sources', 'consent.ts')).href)) as Mod;
const { getMissingRateLimitSecretError } = (await import(pathToFileURL(path.join(SRC, 'lib', 'rate-limit.ts')).href)) as Mod;

const DB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
  process.env.RATE_LIMIT_SECRET = 'fixture-w2-secret';
});

// --- The answers ----------------------------------------------------------------------------

test('criterion 2: 404 on an unknown key, and on a key whose entry has expired', async () => {
  need();
  assert.equal((await post({ key: 'f'.repeat(32), decision: 'allow' })).status, 404);
  const key = await mint('socrata');
  clock += 601_000;
  assert.equal((await post({ key, decision: 'allow' })).status, 404);
  clock -= 601_000;
});

test('criterion 2: 409 on a key already decided', async () => {
  const key = await mint('socrata');
  assert.equal((await post({ key, decision: 'not-now' })).status, 200);
  const second = await post({ key, decision: 'allow' });
  assert.equal(second.status, 409);
});

test('criterion 2 [D]: 403 when the key was minted under another dbId, or under one when the request has none', async () => {
  const key = await mint('socrata', DB_A);
  assert.equal((await post({ key, decision: 'allow' }, { session: signedIn(DB_B) })).status, 403);
  assert.equal((await post({ key, decision: 'allow' })).status, 403);
  // The same key, from its own reader, is decided: the refusals moved nothing.
  const own = await post({ key, decision: 'not-now' }, { session: signedIn(DB_A) });
  assert.equal(own.status, 200);
});

test('criterion 2: for an anonymous key the route checks the key alone', async () => {
  const key = await mint('socrata');
  assert.equal((await post({ key, decision: 'not-now' }, { session: signedIn(DB_B) })).status, 200);
});

test('criterion 2: 400 on a body that is not JSON, names no key, or names another decision', async () => {
  need();
  assert.equal((await post(null, { raw: '{not json' })).status, 400);
  assert.equal((await post({ decision: 'allow' })).status, 400);
  assert.equal((await post({ key: 'f'.repeat(32), decision: 'yes' })).status, 400);
  assert.equal((await post({ key: 42, decision: 'allow' })).status, 400);
  assert.equal(kv.calls.filter((c) => c.op === 'get').length, 0, 'a malformed body reached the store');
});

test('criterion 2: 503 when the store fails', async () => {
  const key = await mint('socrata');
  kv.failGet = true;
  assert.equal((await post({ key, decision: 'allow' })).status, 503);
  kv.failGet = false;
  kv.failSet = true;
  assert.equal((await post({ key, decision: 'allow' })).status, 503);
});

test('criterion 2 [D]: with RATE_LIMIT_SECRET unset the route gives the streaming routes\' refusal and reads no key', async () => {
  const key = await mint('socrata');
  kv.calls.length = 0;
  delete process.env.RATE_LIMIT_SECRET;
  const expected = getMissingRateLimitSecretError();
  assert.ok(expected, 'premise: the limiter refuses with its secret unset');
  const response = await post({ key, decision: 'allow' });
  const body = (await response.json()) as Json;
  assert.equal(response.status, 503);
  assert.equal(body.error, expected.message);
  assert.equal(body.code, expected.code);
  assert.match(String(body.error), /RATE_LIMIT_SECRET/);
  assert.deepEqual(kv.calls, [], 'the route read the store with no secret');
});

// --- What each decision moves ---------------------------------------------------------------

test('criterion 2: allow moves that one source to On in the row; the row keeps its flowsHash and flowsStatement and every other state', async () => {
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
  const response = await post({ key, decision: 'allow' }, { session: signedIn(DB_A) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null, 'a row decision set a cookie');
  const row = globals.__w2Decision.rows.get(DB_A)!;
  assert.equal(row.states['data-commons'].state, 'on');
  assert.deepEqual(row.states.socrata, prior.states.socrata);
  assert.equal(row.flowsHash, prior.flowsHash);
  assert.deepEqual(row.flowsStatement, oldStatement);
});

test('criterion 2: allow moves that one source to On in the cookie; the cookie keeps its flows and every other source\'s entry', async () => {
  const statement = await buildFlowsStatement();
  const cookie = consentCookieForTests({ socrata: 'on', 'data-commons': 'ask-first' }, statement);
  const before = consent.readConsentCookie(new Request('https://x.example/', { headers: { cookie } }));
  const key = await mint('data-commons');
  const response = await post({ key, decision: 'allow' }, { cookie });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'allow set no cookie');
  const after = consent.readConsentCookie(new Request('https://x.example/', { headers: { cookie: setCookie!.split(';')[0] } }));
  assert.ok(after, 'the cookie set does not decode');
  assert.equal(after.flows, before.flows);
  assert.equal(after.states['data-commons'].state, 'on');
  assert.deepEqual(after.states.socrata, before.states.socrata);
  assert.equal(after.states['data-commons'].version, statement.sources.find((s: { sourceId: string }) => s.sourceId === 'data-commons').version);
  assert.match(setCookie!, /HttpOnly/);
  assert.match(setCookie!, /Secure/, 'a cookie set over https carries Secure');
  void statementHash;
});

test('criterion 2: not-now moves nothing: no cookie is set and the row is unchanged', async () => {
  const statement = await buildFlowsStatement();
  const cookie = consentCookieForTests({ socrata: 'on', 'data-commons': 'ask-first' }, statement);
  const key = await mint('data-commons');
  const response = await post({ key, decision: 'not-now' }, { cookie });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  const row: Row = {
    userId: DB_A,
    states: { 'data-commons': { state: 'ask-first', since: '2026-10-02' } },
    flowsHash: 'e'.repeat(64),
    flowsStatement: statement,
    consentedAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
  };
  globals.__w2Decision.rows.set(DB_A, row);
  const rowKey = await mint('data-commons', DB_A);
  assert.equal((await post({ key: rowKey, decision: 'not-now' }, { session: signedIn(DB_A) })).status, 200);
  assert.equal(globals.__w2Decision.rows.get(DB_A), row, 'not-now wrote the row');
});

test('criterion 2: the decision is written to the entry the loop polls', async () => {
  const { decision: d } = need();
  const key = await mint('socrata');
  await post({ key, decision: 'allow' });
  const entry = (await kv.get(`${d.DECISION_KEY_PREFIX}${key}`)) as Json;
  assert.equal(entry.decision, 'allow');
  assert.equal(entry.sourceId, 'socrata');
});

// --- The expiry holds (the seat's item 3) ---------------------------------------------------

for (const choice of ['allow', 'not-now'] as const) {
  test(`criterion 2: after ${choice} the entry still expires no later than the pause's write set it to`, async () => {
    const { decision: d } = need();
    const key = await mint('socrata');
    const name = `${d.DECISION_KEY_PREFIX}${key}`;
    const before = kv.pttl(name);
    assert.ok(before > 0 && before <= 600_000, `premise: the minted entry expires in ${before} ms`);
    clock += 5_000;
    assert.equal((await post({ key, decision: choice })).status, 200);
    const after = kv.pttl(name);
    assert.notEqual(after, -1, `after ${choice} the entry has no expiry: a plain SET cleared it`);
    assert.ok(after <= before - 5_000, `after ${choice} the entry expires later than first set (${after} ms left, ${before - 5_000} expected)`);
    const write = kv.calls.filter((c) => c.op === 'set' && c.key === name).at(-1);
    assert.deepEqual(write?.options, { xx: true, keepTtl: true });
  });
}

test('criterion 2: a decision on an entry that expires between the read and the write re-creates nothing', async () => {
  const { decision: d } = need();
  const key = await mint('socrata');
  const name = `${d.DECISION_KEY_PREFIX}${key}`;
  const get = kv.get.bind(kv);
  kv.get = async (k: string) => {
    const value = await get(k);
    clock += 601_000;
    return value;
  };
  try {
    const response = await post({ key, decision: 'allow' });
    assert.equal(response.status, 404);
    assert.equal(kv.pttl(name), -2, 'the decision re-created an expired entry');
  } finally {
    kv.get = get;
    clock -= 601_000;
  }
});

// --- R6-WEB-D's conditions 2 and 3 (the cookie guard's second setter) ------------------------

/** `PUT /api/sources/consent`, as the panel sends it. */
async function put(states: Record<string, string>, flowsVersion: string, options: { session?: unknown; cookie?: string } = {}): Promise<Response> {
  globals.__w2Decision.session = options.session ?? null;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.cookie) headers.cookie = options.cookie;
  return consentRoute.PUT(new Request('https://site.fixture.example/api/sources/consent', { method: 'PUT', headers, body: JSON.stringify({ states, flowsVersion }) }));
}

/** A `Set-Cookie` header split into its decoded consent and its attributes, the way a browser keeps them. */
function cookieParts(setCookie: string | null): { decoded: unknown; attributes: string } {
  assert.ok(setCookie, 'no cookie was set');
  const [pair, ...rest] = setCookie!.split(';');
  const decoded = consent.readConsentCookie(new Request('https://x.example/', { headers: { cookie: pair } }));
  assert.ok(decoded, 'the cookie set does not decode');
  return { decoded, attributes: rest.map((a) => a.trim()).join('; ') };
}

test('R6-WEB-D condition 2, the cookie branch: Allow sets the cookie PUT /api/sources/consent sets for the same one-source change', async () => {
  const statement = await buildFlowsStatement();
  const hash = statementHash(statement);
  const cookie = consentCookieForTests({ socrata: 'on', 'data-commons': 'ask-first' }, statement);

  const byPut = await put({ socrata: 'on', 'data-commons': 'on' }, hash, { cookie });
  assert.equal(byPut.status, 200, `PUT answered ${byPut.status}: ${await byPut.text()}`);
  const key = await mint('data-commons');
  const byAllow = await post({ key, decision: 'allow' }, { cookie });
  assert.equal(byAllow.status, 200);

  const expected = cookieParts(byPut.headers.get('set-cookie'));
  const actual = cookieParts(byAllow.headers.get('set-cookie'));
  assert.deepEqual(actual.decoded, expected.decoded, 'Allow stored a consent PUT would not have stored');
  assert.equal(actual.attributes, expected.attributes, 'Allow set the cookie with other attributes than PUT');
  assert.equal(globals.__w2Decision.writes, 0, 'a cookie-branch writer wrote a row');
});

test('R6-WEB-D condition 2, the row branch: Allow writes the row PUT /api/sources/consent writes for the same one-source change', async () => {
  const statement = await buildFlowsStatement();
  const hash = statementHash(statement);
  const starting = (): Row => ({
    userId: DB_A,
    states: { socrata: { state: 'on', since: '2026-10-01' }, 'data-commons': { state: 'ask-first', since: '2026-10-02' } },
    flowsHash: hash,
    flowsStatement: statement,
    consentedAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
  });
  const written = (row: Row) => ({ states: row.states, flowsHash: row.flowsHash, flowsStatement: row.flowsStatement });

  globals.__w2Decision.rows.set(DB_A, starting());
  const byPut = await put({ socrata: 'on', 'data-commons': 'on' }, hash, { session: signedIn(DB_A) });
  assert.equal(byPut.status, 200, `PUT answered ${byPut.status}: ${await byPut.text()}`);
  assert.equal(byPut.headers.get('set-cookie'), null);
  const expected = written(globals.__w2Decision.rows.get(DB_A)!);
  assert.equal(globals.__w2Decision.writes, 1);

  globals.__w2Decision.rows.set(DB_A, starting());
  globals.__w2Decision.writes = 0;
  const key = await mint('data-commons', DB_A);
  const byAllow = await post({ key, decision: 'allow' }, { session: signedIn(DB_A) });
  assert.equal(byAllow.status, 200);
  assert.equal(byAllow.headers.get('set-cookie'), null);
  assert.equal(globals.__w2Decision.writes, 1, 'Allow wrote the row other than once');
  assert.deepEqual(written(globals.__w2Decision.rows.get(DB_A)!), expected, 'Allow wrote a row PUT would not have written');
});

test('R6-WEB-D condition 3: Not now writes no consent on either branch, and a no-answer pause writes none', async () => {
  const statement = await buildFlowsStatement();
  const hash = statementHash(statement);
  const cookie = consentCookieForTests({ socrata: 'on', 'data-commons': 'ask-first' }, statement);

  const notNowCookie = await post({ key: await mint('data-commons'), decision: 'not-now' }, { cookie });
  assert.equal(notNowCookie.status, 200);
  assert.equal(notNowCookie.headers.get('set-cookie'), null, 'Not now set a cookie');
  assert.equal(globals.__w2Decision.writes, 0, 'Not now on the cookie branch wrote a row');

  globals.__w2Decision.rows.set(DB_A, { userId: DB_A, states: { 'data-commons': { state: 'ask-first', since: '2026-10-02' } }, flowsHash: hash, flowsStatement: statement, consentedAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-02T00:00:00Z') });
  const notNowRow = await post({ key: await mint('data-commons', DB_A), decision: 'not-now' }, { session: signedIn(DB_A) });
  assert.equal(notNowRow.status, 200);
  assert.equal(notNowRow.headers.get('set-cookie'), null);
  assert.equal(globals.__w2Decision.writes, 0, 'Not now on the row branch wrote the row');

  // A pause nobody answers: the real pause on the fake store and a driven clock, held to its bound.
  const { decision: d } = need();
  const pause = d.createConsentPause({
    store: kv,
    statement,
    configured: readMcpEnvFromProcess(),
    dbId: DB_A,
    secret: 'fixture-w2-secret',
    now: () => clock,
    sleep: async (ms: number) => { clock += ms; },
  });
  const outcome = await pause.ask('data-commons', () => {});
  assert.equal(outcome, 'no-answer');
  assert.equal(globals.__w2Decision.writes, 0, 'a no-answer pause wrote the row');
  assert.ok(kv.calls.every((c) => c.key.startsWith(d.DECISION_KEY_PREFIX)), 'the pause wrote a store key other than its entry');
});
