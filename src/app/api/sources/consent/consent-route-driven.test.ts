// R6 W2 (#632), criteria 2 and 5: the consent endpoint, driven.
//
// `GET /api/sources/consent` reports the consent in force; `PUT` stores the
// reader's states for the sources this instance configures, with the flows
// version the surface was shown; `DELETE` revokes. The store is chosen by the
// session's `dbId` (D12 = A, "row, or cookie"): with one, the row; without
// one, signed in or not, the cookie. The only boundary that accepts source ids
// is this one, and it refuses an id this instance does not configure (flag 3).
//
// WHAT IS DRIVEN. The route's real `GET`, `PUT` and `DELETE`, the real consent
// module and the real flows statement. STUBS: `next-auth` and `@/lib/auth` (a
// session set per case); `@/lib/sources/consent-store` (an in-memory row per
// account id, so a write and a delete can be read back). No network.
//
// WHAT MAKES IT ABLE TO FAIL. The canary: the session's account id and the
// request's network address are distinctive strings, and the cookie's decoded
// value is searched for both. A cookie that carried either would show it.
//
// R9 P4 (#680; #662, D5 = A of the UX pass): a signed-in GET with a `dbId`, no
// row and a cookie in force keeps the cookie's states on the account. The row
// store counts its writes, so "writes nothing" is a count of zero, and it can
// be made to fail a write. The cookie in force names a source this instance
// does not configure and dates one choice before today, so a write that kept
// an unknown id, or dated the states by the read, is seen.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..', '..', '..');
const REPO = path.resolve(SRC, '..');

interface Row { userId: string; states: Record<string, { state: string; since: string }>; flowsHash: string; flowsStatement: unknown; consentedAt: Date; updatedAt: Date }
interface Globals { __r6w2Consent: { session: unknown; rows: Map<string, Row>; writes: number; failWrite: boolean } }
const globals = globalThis as unknown as Globals;
globals.__r6w2Consent = { session: null, rows: new Map(), writes: 0, failWrite: false };

const STUB_PREFIX = 'file:///r6-w2-consent-route-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next-auth': `export async function getServerSession() { return globalThis.__r6w2Consent.session; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/sources/consent-store': `
    const rows = () => globalThis.__r6w2Consent.rows;
    export async function readConsentRow(userId) { return rows().get(userId) ?? null; }
    export async function writeConsentRow(userId, row) {
      globalThis.__r6w2Consent.writes += 1;
      if (globalThis.__r6w2Consent.failWrite) throw new Error('fixture: the row store is down');
      const prior = rows().get(userId);
      const now = row.now ?? new Date();
      rows().set(userId, { userId, states: row.states, flowsHash: row.flowsHash, flowsStatement: row.flowsStatement, consentedAt: prior?.consentedAt ?? now, updatedAt: now });
    }
    export async function deleteConsentRow(userId) { rows().delete(userId); }`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`r6-w2 consent route test hook: cannot resolve ${specifier}`);
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && !path.extname(specifier) && parent?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      const json = fs.readFileSync(fileURLToPath(loadUrl), 'utf8');
      return { format: 'module', source: `export default ${json};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.EXECUTOR_DRIVER = 'none';

/** The modules W2 adds, by specifiers typed `string` so the red commit type-checks. */
const ROUTE: string = './route.ts';
const CONSENT: string = '@/lib/sources/consent';
const STATEMENT: string = '@/lib/flows/statement';
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const route = (await import(ROUTE).catch(() => null)) as Mod | null;
const consent = (await import(CONSENT).catch(() => null)) as Mod | null;
const flows = (await import(STATEMENT).catch(() => null)) as Mod | null;

function handler(method: 'GET' | 'PUT' | 'DELETE'): (request: Request) => Promise<Response> {
  assert.ok(route, `no consent endpoint: src/app/api/sources/consent/${ROUTE} does not exist`);
  assert.equal(typeof route![method], 'function', `the consent endpoint has no ${method}`);
  return route![method];
}
function consentExport<T = any>(name: string): T { // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(consent && name in consent, `${CONSENT} exports no ${name}`);
  return consent![name] as T;
}
async function current(): Promise<{ statement: Record<string, any>; hash: string }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(flows?.buildFlowsStatement && flows?.statementHash, `${STATEMENT} exports no buildFlowsStatement/statementHash`);
  const statement = await flows!.buildFlowsStatement();
  return { statement, hash: flows!.statementHash(statement) };
}

const CANARY_ACCOUNT = 'canary-account-5c1e9d';
const CANARY_ADDRESS = '203.0.113.77';
const URL_ = 'https://site.fixture.example/api/sources/consent';

function call(method: string, body?: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { 'x-forwarded-for': CANARY_ADDRESS };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  return new Request(URL_, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function setCookieOf(response: Response): string | null {
  return response.headers.get('set-cookie');
}

/** The cookie's value as the browser would send it back. */
function cookieValue(setCookie: string): string {
  const name = consentExport<string>('CONSENT_COOKIE_NAME');
  const first = setCookie.split(';')[0];
  assert.ok(first.startsWith(`${name}=`), `the cookie set is not the consent cookie: ${setCookie}`);
  return first.slice(name.length + 1);
}

function reset(session: unknown): void {
  globals.__r6w2Consent.session = session;
  globals.__r6w2Consent.rows = new Map();
  globals.__r6w2Consent.writes = 0;
  globals.__r6w2Consent.failWrite = false;
}

// --- GET -----------------------------------------------------------------------

test('criterion 5: GET with no consent reports none in force, with the current flows version, and sets no cookie', async () => {
  reset(null);
  const { hash } = await current();
  const response = await handler('GET')(call('GET'));
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.inForce, false);
  assert.equal(body.flowsVersion, hash);
  assert.equal(setCookieOf(response), null, 'a GET set a cookie');
});

// --- PUT, the cookie (no dbId) ---------------------------------------------------------

test('criterion 5: PUT without a dbId stores the states in the session cookie, and the next GET reads them back', async () => {
  reset({ user: { id: CANARY_ACCOUNT } });
  const { statement, hash } = await current();
  const response = await handler('PUT')(call('PUT', { states: { socrata: 'on', 'data-commons': 'off' }, flowsVersion: hash }));
  assert.equal(response.status, 200, await response.clone().text());
  const setCookie = setCookieOf(response);
  assert.ok(setCookie, 'PUT without a dbId set no cookie');
  assert.equal(globals.__r6w2Consent.rows.size, 0, 'PUT without a dbId wrote a row');
  const decoded = consentExport<(v: string) => Record<string, any> | null>('decodeConsentCookie')(cookieValue(setCookie!)); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(decoded, 'the cookie set does not decode');
  assert.equal(decoded!.flows, statement.version, 'the cookie holds the base version');
  assert.equal(decoded!.states.socrata.state, 'on');
  assert.equal(decoded!.states['data-commons'].state, 'off');
  assert.equal(decoded!.states.socrata.version, statement.sources.find((s: { sourceId: string }) => s.sourceId === 'socrata').version);

  const again = await handler('GET')(call('GET', undefined, `${consentExport<string>('CONSENT_COOKIE_NAME')}=${cookieValue(setCookie!)}`));
  const body = await again.json() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(body.inForce, true);
  assert.equal(body.store, 'cookie');
  assert.equal(body.states.socrata.state, 'on');
  assert.equal(setCookieOf(again), null, 'a GET set a cookie');
});

test('criterion 2: the cookie carries no identifier — the canary account id and network address are absent from its decoded value', async () => {
  reset({ user: { id: CANARY_ACCOUNT, name: 'Canary Reader' } });
  const { hash } = await current();
  const response = await handler('PUT')(call('PUT', { states: { socrata: 'on', 'data-commons': 'on' }, flowsVersion: hash }));
  const setCookie = setCookieOf(response);
  assert.ok(setCookie, 'no cookie to read');
  const value = cookieValue(setCookie!);
  const decodedText = Buffer.from(value, 'base64url').toString('utf8');
  for (const canary of [CANARY_ACCOUNT, CANARY_ADDRESS, 'Canary Reader']) {
    assert.ok(!decodedText.includes(canary), `the consent cookie carries "${canary}": ${decodedText}`);
    assert.ok(!setCookie!.includes(canary), `the Set-Cookie header carries "${canary}"`);
  }
  assert.deepEqual(Object.keys(JSON.parse(decodedText)).sort(), ['flows', 'states', 'v'], 'the cookie holds a version number, the flows hash and the states, and nothing else');
});

// --- PUT, the row (dbId) ------------------------------------------------------------------

test('criterion 5: PUT with a dbId writes the row — states, the flows hash and the statement snapshot — and sets no cookie', async () => {
  reset({ user: { id: 'gh-1', dbId: '11111111-1111-4111-8111-111111111111' } });
  const { statement, hash } = await current();
  const response = await handler('PUT')(call('PUT', { states: { socrata: 'on', 'data-commons': 'ask-first' }, flowsVersion: hash }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(setCookieOf(response), null, 'PUT with a dbId set a cookie');
  const row = globals.__r6w2Consent.rows.get('11111111-1111-4111-8111-111111111111');
  assert.ok(row, 'no row was written for the dbId');
  assert.equal(row!.flowsHash, hash);
  assert.deepEqual(row!.flowsStatement, statement);
  assert.equal(row!.states.socrata.state, 'on');
  assert.equal(row!.states['data-commons'].state, 'ask-first');
  assert.match(row!.states.socrata.since, /^\d{4}-\d{2}-\d{2}$/);
});

// --- The refusals ------------------------------------------------------------------------------

test('criterion 5 (flag 3): PUT naming an id this instance does not configure is 400, and names the id', async () => {
  for (const unknown of ['no-such-source', 'boston-opencontext']) {
    reset(null);
    const { hash } = await current();
    const response = await handler('PUT')(call('PUT', { states: { socrata: 'on', [unknown]: 'on' }, flowsVersion: hash }));
    assert.equal(response.status, 400, unknown);
    const body = await response.json() as Record<string, unknown>;
    assert.ok(String(body.error).includes(unknown), `the 400 does not name "${unknown}": ${JSON.stringify(body)}`);
    assert.deepEqual(body.unknown, [unknown]);
    assert.equal(setCookieOf(response), null, 'a refused PUT set a cookie');
  }
});

test('criterion 5: PUT with a stale flows version is 409, carrying the current one, and stores nothing', async () => {
  reset({ user: { id: 'gh-2', dbId: '22222222-2222-4222-8222-222222222222' } });
  const { hash } = await current();
  const response = await handler('PUT')(call('PUT', { states: { socrata: 'on' }, flowsVersion: '0'.repeat(64) }));
  assert.equal(response.status, 409);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.flowsVersion, hash);
  assert.equal(globals.__r6w2Consent.rows.size, 0);
  assert.equal(setCookieOf(response), null);
});

test('criterion 5: PUT with a malformed body is 400 — a state outside the three, no states, no flows version', async () => {
  reset(null);
  const { hash } = await current();
  for (const body of [{ states: { socrata: 'maybe' }, flowsVersion: hash }, { flowsVersion: hash }, { states: { socrata: 'on' } }, { states: ['socrata'], flowsVersion: hash }]) {
    const response = await handler('PUT')(call('PUT', body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(setCookieOf(response), null);
  }
});

// --- DELETE ---------------------------------------------------------------------------------------

test('criterion 5: DELETE without a dbId clears the cookie; with one, it deletes the row and sets no cookie', async () => {
  reset(null);
  const cleared = await handler('DELETE')(call('DELETE'));
  assert.equal(cleared.status, 200);
  const setCookie = setCookieOf(cleared) ?? '';
  assert.ok(setCookie.startsWith(`${consentExport<string>('CONSENT_COOKIE_NAME')}=`), 'DELETE without a dbId did not clear the cookie');
  assert.match(setCookie, /max-age=0/i);

  reset({ user: { id: 'gh-3', dbId: '33333333-3333-4333-8333-333333333333' } });
  const { hash } = await current();
  await handler('PUT')(call('PUT', { states: { socrata: 'on' }, flowsVersion: hash }));
  assert.ok(globals.__r6w2Consent.rows.has('33333333-3333-4333-8333-333333333333'), 'premise: the row was written');
  const deleted = await handler('DELETE')(call('DELETE'));
  assert.equal(deleted.status, 200);
  assert.equal(globals.__r6w2Consent.rows.has('33333333-3333-4333-8333-333333333333'), false, 'DELETE with a dbId left the row');
  assert.equal(setCookieOf(deleted), null);
});

// --- D12, and R9 P4: a consent given signed out, kept on the account ---------------------------

const P4_DB_ID = '45454545-4545-4454-8454-454545454545';
const P4_EARLIER = '2026-10-01';

type StatementLike = { version: string; sources: Array<{ sourceId: string; version: string }> };

/** The P4 states: the first configured source Off, the second Ask first, the rest On. */
function p4States(built: Mod): Record<string, string> {
  const statement = built as StatementLike;
  const ids = statement.sources.map((s) => s.sourceId);
  assert.ok(ids.length >= 2, `premise: two configured sources, got ${ids.join(', ')}`);
  return Object.fromEntries(ids.map((id, i) => [id, i === 0 ? 'off' : i === 1 ? 'ask-first' : 'on']));
}

/**
 * A `Cookie` header holding a consent built by the real encoder: `states` per
 * configured source, each dated `since` (`earlier`'s dated `P4_EARLIER`), plus
 * whatever `extra` adds; `flows` and a source's `version` default to the statement's.
 */
function p4Cookie(built: Mod, states: Record<string, string>, since: string, options: { flows?: string; staleSource?: string; earlier?: string; extra?: Record<string, unknown> } = {}): string {
  const statement = built as StatementLike;
  const encode = consentExport<(c: unknown) => string>('encodeConsentCookie');
  const value = encode({
    v: 1,
    flows: options.flows ?? statement.version,
    states: {
      ...Object.fromEntries(statement.sources.map((s) => [s.sourceId, { state: states[s.sourceId], since: s.sourceId === options.earlier ? P4_EARLIER : since, version: s.sourceId === options.staleSource ? 'b'.repeat(64) : s.version }])),
      ...(options.extra ?? {}),
    },
  });
  return `${consentExport<string>('CONSENT_COOKIE_NAME')}=${value}`;
}

const RETIRED = { 'retired-source': { state: 'on', since: P4_EARLIER, version: 'c'.repeat(64) } };

test('D12: with a dbId and a row, the row is answered and a cookie ignored — no write, no flag', async () => {
  reset({ user: { id: 'gh-4', dbId: P4_DB_ID } });
  const { statement, hash } = await current();
  const rowStates = Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, { state: 'on', since: P4_EARLIER }]));
  globals.__r6w2Consent.rows.set(P4_DB_ID, { userId: P4_DB_ID, states: rowStates, flowsHash: hash, flowsStatement: statement, consentedAt: new Date('2026-10-01T08:00:00Z'), updatedAt: new Date('2026-10-01T08:00:00Z') });
  const cookie = p4Cookie(statement, p4States(statement), consentExport<() => string>('consentDate')());
  const response = await handler('GET')(call('GET', undefined, cookie));
  const body = await response.json() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(body.inForce, true);
  assert.equal(body.store, 'row');
  assert.deepEqual(body.states, rowStates, 'a session with a row was answered from its cookie');
  assert.equal(globals.__r6w2Consent.writes, 0, 'a GET with a row wrote');
  assert.equal('keptFromCookie' in body, false, 'a GET with a row says the cookie was kept');
  assert.equal(setCookieOf(response), null);
});

test('R9 P4 criterion 1: a signed-in GET with a dbId, no row and a cookie in force keeps the cookie\'s states on the account, in the shape PUT writes', async () => {
  reset({ user: { id: 'gh-p4', dbId: P4_DB_ID } });
  const { statement, hash } = await current();
  const states = p4States(statement);
  const firstId = statement.sources[0].sourceId as string;
  // One choice dated before today: the row keeps the date the reader gave it, not the read's.
  const today = consentDate();
  const cookie = p4Cookie(statement, states, today, { earlier: firstId, extra: RETIRED });
  const response = await handler('GET')(call('GET', undefined, cookie));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const expected = Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, { state: states[s.sourceId], since: s.sourceId === firstId ? P4_EARLIER : today }]));
  assert.equal(body.inForce, true, `the consent given signed out was not kept: ${JSON.stringify(body)}`);
  assert.equal(body.store, 'row');
  assert.equal(body.keptFromCookie, true, 'the answer does not say the choice was just kept on the account');
  assert.deepEqual(body.states, expected, 'the answer\'s states are not the cookie\'s');
  assert.equal(body.consentedFlowsVersion, hash);
  assert.equal(globals.__r6w2Consent.writes, 1, 'the read did not write the row exactly once');
  const row = globals.__r6w2Consent.rows.get(P4_DB_ID);
  assert.ok(row, 'no row was written for the dbId');
  assert.deepEqual(row!.states, expected, 'the row\'s states are not the cookie\'s');
  assert.equal(Object.hasOwn(row!.states, 'retired-source'), false, 'the row keeps a source this instance does not configure');
  assert.equal(row!.flowsHash, hash, 'the row does not hold the current statement\'s hash');
  assert.deepEqual(row!.flowsStatement, statement, 'the row does not hold the current statement');

  // A second read: the row is there, and nothing is kept again.
  const again = await handler('GET')(call('GET', undefined, cookie));
  const second = await again.json() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(second.inForce, true);
  assert.equal(second.store, 'row');
  assert.equal('keptFromCookie' in second, false, 'the second read says the choice was just kept');
  assert.deepEqual(second.states, expected);
  assert.equal(globals.__r6w2Consent.writes, 1, 'the second read wrote');
});

test('R9 P4 criterion 1: the row the read writes is byte-equal to the row PUT writes for the same states from the same start', async () => {
  const { statement } = await current();
  const states = p4States(statement);
  const today = consentDate();
  reset({ user: { id: 'gh-p4', dbId: P4_DB_ID } });
  await handler('GET')(call('GET', undefined, p4Cookie(statement, states, today)));
  const kept = globals.__r6w2Consent.rows.get(P4_DB_ID);
  assert.ok(kept, 'the read wrote no row');
  reset({ user: { id: 'gh-p4', dbId: P4_DB_ID } });
  const { hash } = await current();
  const put = await handler('PUT')(call('PUT', { states, flowsVersion: hash }));
  assert.equal(put.status, 200, await put.clone().text());
  const written = globals.__r6w2Consent.rows.get(P4_DB_ID);
  assert.ok(written, 'premise: PUT wrote a row');
  assert.equal(JSON.stringify(kept!.states), JSON.stringify(written!.states), 'the states are not byte-equal to PUT\'s');
  assert.equal(kept!.flowsHash, written!.flowsHash);
  assert.equal(JSON.stringify(kept!.flowsStatement), JSON.stringify(written!.flowsStatement));
});

test('R9 P4 criterion 2: the response that kept the choice sets no cookie, so the cookie is not cleared', async () => {
  reset({ user: { id: 'gh-p4', dbId: P4_DB_ID } });
  const { statement } = await current();
  const response = await handler('GET')(call('GET', undefined, p4Cookie(statement, p4States(statement), consentDate())));
  assert.equal(globals.__r6w2Consent.writes, 1, 'premise: the read kept the choice');
  assert.equal(setCookieOf(response), null, 'the read that kept the choice touched the cookie');
});

test('R9 P4 criterion 1: a stale cookie writes nothing and is answered as a session with no row is today, byte for byte', async () => {
  const { statement } = await current();
  const states = p4States(statement);
  const today = consentDate();
  for (const [why, options] of [
    ['its flows is not the statement in force', { flows: 'a'.repeat(64) }],
    ['a stored source version is not current', { staleSource: statement.sources[1].sourceId as string }],
  ] as const) {
    reset({ user: { id: 'gh-p4', dbId: P4_DB_ID } });
    const today0 = await (await handler('GET')(call('GET'))).text();
    const response = await handler('GET')(call('GET', undefined, p4Cookie(statement, states, today, options)));
    const text = await response.text();
    assert.equal(globals.__r6w2Consent.writes, 0, `a stale cookie (${why}) wrote`);
    assert.equal(globals.__r6w2Consent.rows.size, 0, `a stale cookie (${why}) left a row`);
    assert.equal(text, today0, `a stale cookie (${why}) is not answered as no consent is today`);
    assert.equal(JSON.parse(text).inForce, false);
    assert.equal(setCookieOf(response), null);
  }
});

test('R9 P4: a failed write is answered as a session with no row is today, and sets no cookie', async () => {
  reset({ user: { id: 'gh-p4', dbId: P4_DB_ID } });
  const { statement } = await current();
  const today0 = await (await handler('GET')(call('GET'))).text();
  globals.__r6w2Consent.failWrite = true;
  const response = await handler('GET')(call('GET', undefined, p4Cookie(statement, p4States(statement), consentDate())));
  assert.equal(response.status, 200);
  assert.equal(globals.__r6w2Consent.writes, 1, 'premise: the write was tried');
  assert.equal(await response.text(), today0, 'a failed write is not answered as no consent is today');
  assert.equal(setCookieOf(response), null);
});

test('R9 P4: a read without a dbId writes nothing — signed out, or signed in without a database account', async () => {
  const { statement } = await current();
  for (const session of [null, { user: { id: 'gh-no-db' } }]) {
    reset(session);
    const response = await handler('GET')(call('GET', undefined, p4Cookie(statement, p4States(statement), consentDate())));
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.store, 'cookie');
    assert.equal(body.inForce, true);
    assert.equal('keptFromCookie' in body, false);
    assert.equal(globals.__r6w2Consent.writes, 0, `a read with session ${JSON.stringify(session)} wrote`);
    assert.equal(setCookieOf(response), null);
  }
});

function consentDate(): string {
  return consentExport<() => string>('consentDate')();
}

// --- Only the consent write sets the cookie (criterion 2) ------------------------------------------

test('criterion 2: no module but the consent endpoints sets the consent cookie, and only the consent route clears it', () => {
  consentExport('consentCookieHeader');
  const tracked = execFileSync('git', ['ls-files', 'src'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\./.test(f));
  const callers = (call: RegExp) => tracked.filter((file) => call.test(fs.readFileSync(path.join(REPO, file), 'utf8')) && file !== 'src/lib/sources/consent.ts');
  // R8 W2 (#644): the decision route is a second consent write. Allow moves one
  // source to On through the same store and the same cookie, so `decision.ts`
  // may set the cookie, through `consentCookieHeader` only; it never clears it
  // (R6-WEB-D's consent of 2026-10-22, condition 1; its conditions 2 and 3 are
  // tests in `decision/decision-route-driven.test.ts`).
  assert.deepEqual(callers(/consentCookieHeader\(/), ['src/app/api/sources/consent/route.ts', 'src/lib/sources/decision.ts']);
  assert.deepEqual(callers(/clearConsentCookieHeader\(/), ['src/app/api/sources/consent/route.ts']);
});
