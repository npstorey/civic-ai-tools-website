// UX-2 P4b, criterion 4 (Part E; D8 = A in relay 14's variant): every source
// starts Ask first where the instance can ask.
//
// THE RULE. `GET /api/sources/consent` serves `defaults` (the states a first
// consent gives) as `'ask-first'` for every configured source when the instance
// can ask: in-loop routing (`SOURCE_ROUTING=in-loop`) and the decision store
// pair set. The test is the consent gate's own predicate (`canAsk`,
// `src/lib/sources/consent-gate.ts`), read by the route from the routing mode
// and the store. Anywhere else it serves the manifest's `consentDefault`.
//
// WHAT IS DRIVEN. The route's real `GET`, loaded with `module.registerHooks`
// as the route tests are, on four instances: in-loop with the store; and
// all-sources with the store, in-loop with no store, all-sources with none.
// Six sources are configured, five of them On in the manifest and one Ask
// first, so "every default is Ask first" and "the manifest's values" cannot be
// told apart by coincidence.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the route serves the manifest's
// values on every instance, so the in-loop-with-store leg reads five On.
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

const STUB_PREFIX = 'file:///ux2-p4b-consent-defaults-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next-auth': `export async function getServerSession() { return null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/sources/consent-store': `
    export async function readConsentRow() { return null; }
    export async function writeConsentRow() {}
    export async function deleteConsentRow() {}`,
};

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
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const file = firstFile(path.join(SRC, specifier.slice(2)));
      if (file === null) throw new Error(`ux2-p4b consent defaults test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && !path.extname(specifier) && parent?.startsWith('file:') && !parent.startsWith(STUB_PREFIX)) {
      const file = firstFile(path.resolve(path.dirname(fileURLToPath(parent)), specifier));
      if (file !== null) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      return { format: 'module', source: `export default ${fs.readFileSync(fileURLToPath(loadUrl), 'utf8')};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

for (const name of [
  'NYS_LEGISLATION_HOSTING', 'NYS_LEGISLATION_API_KEY', 'DATA_COMMONS_API_KEY', 'MODEL_API_BASE_URL',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'NEXT_PUBLIC_ANALYTICS_SERVICE',
  'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL', 'SOURCE_ROUTING', 'KV_REST_API_URL',
  'KV_REST_API_TOKEN', 'DATABASE_URL',
]) delete process.env[name];
Object.assign(process.env, {
  SOCRATA_MCP_URL: 'https://socrata.fixture.example',
  DATA_COMMONS_MCP_URL: 'https://dc.fixture.example/mcp',
  BOSTON_OPENCONTEXT_MCP_URL: 'https://boston.fixture.example/mcp',
  NYC_CHARTER_HOSTING: 'sandbox',
  NYC_CHECKBOOK_HOSTING: 'sandbox',
  EXECUTOR_DRIVER: 'vercel-sandbox',
  VERCEL_ENV: 'production',
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const route = (await import(pathToFileURL(path.join(HERE, 'route.ts')).href)) as Mod;
const { CIVIC_MANIFEST } = (await import('@typedstandards/civic-typed-router')) as unknown as { CIVIC_MANIFEST: Array<{ sourceId: string; consentDefault?: string }> };

const STORE = { KV_REST_API_URL: 'https://kv.fixture.example', KV_REST_API_TOKEN: 'fixture-kv-token' };

/** The GET's `defaults` under `env`, the environment put back after. */
async function defaultsUnder(env: Record<string, string>): Promise<Record<string, string>> {
  Object.assign(process.env, env);
  try {
    const response = await route.GET(new Request('https://site.fixture.example/api/sources/consent'));
    assert.equal(response.status, 200);
    return ((await response.json()) as { defaults: Record<string, string> }).defaults;
  } finally {
    for (const name of Object.keys(env)) delete process.env[name];
  }
}

const manifestOf = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, CIVIC_MANIFEST.find((e) => e.sourceId === id)?.consentDefault ?? 'ask-first']));

test('premise: six sources are configured, five On in the manifest and one Ask first', async () => {
  const defaults = await defaultsUnder({});
  const ids = Object.keys(defaults);
  assert.deepEqual(ids, ['socrata', 'data-commons', 'boston-opencontext', 'nyc-charter', 'nyc-checkbook', 'nyc-record'], `the configured sources: ${JSON.stringify(ids)}`);
  const manifest = manifestOf(ids);
  assert.equal(Object.values(manifest).filter((s) => s === 'on').length, 5, `the manifest's defaults: ${JSON.stringify(manifest)}`);
  assert.equal(Object.values(manifest).filter((s) => s === 'ask-first').length, 1);
});

test('UX-2 P4b criterion 4: in-loop with the decision store set, every configured source\'s default is ask-first', async () => {
  const defaults = await defaultsUnder({ SOURCE_ROUTING: 'in-loop', ...STORE });
  assert.ok(Object.keys(defaults).length === 6, 'premise: six configured sources');
  assert.deepEqual(defaults, Object.fromEntries(Object.keys(defaults).map((id) => [id, 'ask-first'])), `the defaults where the instance can ask: ${JSON.stringify(defaults)}`);
});

for (const [name, env] of [
  ['all-sources with the store', { ...STORE }],
  ['in-loop with no store', { SOURCE_ROUTING: 'in-loop' }],
  ['all-sources with no store', {}],
] as Array<[string, Record<string, string>]>) {
  test(`UX-2 P4b criterion 4 (${name}): the defaults are the manifest's values, five On where the router says so`, async () => {
    const defaults = await defaultsUnder(env);
    assert.deepEqual(defaults, manifestOf(Object.keys(defaults)), `the defaults ${name}: ${JSON.stringify(defaults)}`);
    assert.equal(Object.values(defaults).filter((s) => s === 'on').length, 5);
  });
}

test('UX-2 P4b criterion 4: the route reads the gate\'s own predicate, exported from consent-gate.ts, never a copy', async () => {
  const gate = (await import(pathToFileURL(path.join(SRC, 'lib', 'sources', 'consent-gate.ts')).href)) as Mod;
  assert.equal(typeof gate.canAsk, 'function', 'consent-gate.ts does not export canAsk');
  const source = fs.readFileSync(path.join(HERE, 'route.ts'), 'utf8');
  assert.match(source, /import \{[^}]*\bcanAsk\b[^}]*\} from '@\/lib\/sources\/consent-gate'/, 'the route does not import canAsk from the consent gate');
  assert.ok(!/ask\.routing === 'in-loop'/.test(source), 'the route carries its own copy of the predicate');
});
