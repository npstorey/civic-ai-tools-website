// R6 W2 (#632), criterion 3: `GET /api/flows` serves the derived statement.
//
// WHAT IS DRIVEN. The route's real `GET` and the real statement. The bytes it
// serves are the statement's canonical serialization, so the SHA-256 of the
// body a reader fetches is the `hash` a record carries for that statement; and
// the route sets no cookie (criterion 2: a GET never does). No network: the
// census of `fetch` reads zero (design §2.4 rule 1).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
const SRC = path.resolve(HERE, '..', '..', '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`r6-w2 flows route test hook: cannot resolve ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      return { format: 'module', source: `export default ${fs.readFileSync(fileURLToPath(loadUrl), 'utf8')};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'MODEL_API_BASE_URL', 'VERCEL_ENV', 'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';

const ROUTE: string = './route.ts';
const STATEMENT: string = '@/lib/flows/statement';
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const route = (await import(ROUTE).catch(() => null)) as Mod | null;
const flows = (await import(STATEMENT).catch(() => null)) as Mod | null;

test('criterion 3: GET /api/flows answers 200 with the statement, as JSON, and sets no cookie', async () => {
  assert.equal(typeof route?.GET, 'function', `no flows route: src/app/api/flows/${ROUTE} exporting GET`);
  const realFetch = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => { fetched.push(String(input)); throw new TypeError('no network'); }) as typeof fetch;
  let response: Response;
  try {
    response = await route!.GET(new Request('https://site.fixture.example/api/flows'));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  assert.equal(response.headers.get('set-cookie'), null, 'GET /api/flows set a cookie');
  assert.deepEqual(fetched, [], 'serving the statement made a network request');
  const body = await response.text();
  const statement = await flows!.buildFlowsStatement();
  assert.equal(body, flows!.serializeFlowsStatement(statement), 'the body is not the canonical statement');
  assert.equal(createHash('sha256').update(body, 'utf8').digest('hex'), flows!.statementHash(statement), 'the SHA-256 of the served bytes is not the statement\'s hash');
});
