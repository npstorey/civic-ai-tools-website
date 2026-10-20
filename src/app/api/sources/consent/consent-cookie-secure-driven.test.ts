// R6 W3 (#632), criterion 8: the consent cookie's `Secure`, set by how the
// request reached the site.
//
// THE DEFECT (G0 premise 4). W2 sets the consent cookie with `Secure` on every
// response. A browser keeps a `Secure` cookie only from a secure origin
// (`https:`, or `http://localhost`), so on an instance served over plain http
// on any other host an anonymous reader's consent never sticks, and once the
// gate is on every question there is refused.
//
// THE RULE. `Secure` is set when the request reached the site over https: the
// request URL's scheme, or the platform's `x-forwarded-proto`. Left out
// otherwise — on `http://localhost`, where browsers would keep it either way,
// and on plain http on another host, where leaving it out is what lets the
// browser keep the cookie at all. The write (`PUT`) and the revoke (`DELETE`)
// set it the same way, so the revoke clears the cookie the write set.
//
// WHAT IS DRIVEN. The consent route's real `PUT` and `DELETE`, the real
// consent module and flows statement; stubs as `consent-route-driven.test.ts`
// (the session, the in-memory row store). No network.
//
// WHAT MAKES IT ABLE TO FAIL. At the base every response sets `Secure`, so the
// two plain-http cases fail.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
interface Globals { __r6w3Secure: { session: unknown; rows: Map<string, Row> } }
const globals = globalThis as unknown as Globals;
globals.__r6w3Secure = { session: null, rows: new Map() };

const STUB_PREFIX = 'file:///r6-w3-consent-secure-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next-auth': `export async function getServerSession() { return globalThis.__r6w3Secure.session; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/sources/consent-store': `
    const rows = () => globalThis.__r6w3Secure.rows;
    export async function readConsentRow(userId) { return rows().get(userId) ?? null; }
    export async function writeConsentRow(userId, row) {
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
      throw new Error(`r6-w3 consent cookie test hook: cannot resolve ${specifier}`);
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

/** The modules W2 added, by specifiers typed `string`, as the W2 suite reads them. */
const ROUTE: string = './route.ts';
const STATEMENT: string = '@/lib/flows/statement';
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const route = (await import(ROUTE).catch(() => null)) as Mod | null;
const flows = (await import(STATEMENT).catch(() => null)) as Mod | null;

function handler(method: 'GET' | 'PUT' | 'DELETE'): (request: Request) => Promise<Response> {
  assert.ok(route, `no consent endpoint: src/app/api/sources/consent/${ROUTE} does not exist`);
  assert.equal(typeof route![method], 'function', `the consent endpoint has no ${method}`);
  return route![method];
}
async function current(): Promise<{ statement: Record<string, any>; hash: string }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(flows?.buildFlowsStatement && flows?.statementHash, `${STATEMENT} exports no buildFlowsStatement/statementHash`);
  const statement = await flows!.buildFlowsStatement();
  return { statement, hash: flows!.statementHash(statement) };
}

const CASES: Array<{ name: string; url: string; headers: Record<string, string>; secure: boolean }> = [
  { name: 'https', url: 'https://site.fixture.example/api/sources/consent', headers: {}, secure: true },
  { name: 'forwarded https', url: 'http://site.fixture.example/api/sources/consent', headers: { 'x-forwarded-proto': 'https' }, secure: true },
  { name: 'http://localhost', url: 'http://localhost:3000/api/sources/consent', headers: {}, secure: false },
  { name: 'plain http on another host', url: 'http://instance.fixture.example/api/sources/consent', headers: {}, secure: false },
];

function attrs(setCookie: string | null): string[] {
  assert.ok(setCookie, 'the response set no cookie');
  return setCookie!.split(';').slice(1).map((p) => p.trim().toLowerCase());
}

for (const c of CASES) {
  test(`criterion 8 (${c.name}): the consent write sets the cookie ${c.secure ? 'with' : 'without'} Secure`, async () => {
    globals.__r6w3Secure.session = null;
    const { hash } = await current();
    const request = new Request(c.url, { method: 'PUT', headers: { 'content-type': 'application/json', ...c.headers }, body: JSON.stringify({ states: { socrata: 'on' }, flowsVersion: hash }) });
    const response = await handler('PUT')(request);
    assert.equal(response.status, 200, await response.clone().text());
    const flags = attrs(response.headers.get('set-cookie'));
    for (const kept of ['path=/', 'httponly', 'samesite=lax']) assert.ok(flags.includes(kept), `the cookie lost ${kept}`);
    assert.equal(flags.includes('secure'), c.secure, `${c.name}: Secure is ${flags.includes('secure') ? 'set' : 'absent'}`);
  });

  test(`criterion 8 (${c.name}): the revoke clears the cookie with the same flags, ${c.secure ? 'with' : 'without'} Secure`, async () => {
    globals.__r6w3Secure.session = null;
    const request = new Request(c.url, { method: 'DELETE', headers: { ...c.headers } });
    const response = await (handler('DELETE') as (r: Request) => Promise<Response>)(request);
    assert.equal(response.status, 200);
    const flags = attrs(response.headers.get('set-cookie'));
    assert.ok(flags.includes('max-age=0'), 'the revoke does not expire the cookie');
    assert.equal(flags.includes('secure'), c.secure, `${c.name}: Secure is ${flags.includes('secure') ? 'set' : 'absent'} on the revoke`);
  });
}

test('criterion 8: the deployment guide says when the cookie is Secure, and why plain http leaves it out', () => {
  const guide = fs.readFileSync(path.join(REPO, 'docs', 'deploy.md'), 'utf8');
  const start = guide.indexOf('## Consent and the flows statement');
  assert.ok(start >= 0, 'premise: the guide has its consent section');
  const end = guide.indexOf('\n## ', start + 1);
  const section = guide.slice(start, end === -1 ? undefined : end);
  assert.ok(section.includes('x-forwarded-proto'), 'the consent section does not name x-forwarded-proto');
  assert.match(section, /plain `?http`?/i, 'the consent section does not say what happens over plain http');
});
