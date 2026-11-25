// S4 W1 (npstorey/civic-ai-tools#335), criterion A5 (pin): the bytes `/api/flows` serves, the statement's hash, the
// base version and each source's version do not move, over the manifest's eight.
//
// W1 changes how the statement's source loop gets its manifest and configuration (the test hook, A14), and adds the
// classes beside the statement, never in it (premise 7). Every figure below was read from the real `GET /api/flows`
// handler at the base, website main `407b68c`, under the configuration this file sets (the eight sources configured,
// no analytics, no sign-in, no executor, no hosting platform), and is pinned here, so the head must serve the same
// bytes. An analysis whose record cites that hash still shows its statement as in force ("Where this question went",
// `where-it-went.ts:474-485` at the base).
//
// THE SHAPE THAT CAN FAIL. All eight sources are configured, the one pack among them, and three hosted in the sandbox,
// so a change to the loop's manifest, the variant it selects, a pack's address or the order of the sources moves a
// digest pinned here.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');
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
    if (specifier.startsWith('@/')) {
      const found = firstFile(path.join(SRC, specifier.slice(2)));
      if (found === null) throw new Error(`A5 pin test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    const from = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && !path.extname(specifier) && from?.startsWith('file:')) {
      const found = firstFile(path.resolve(path.dirname(fileURLToPath(from)), specifier));
      if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

for (const name of [
  'VERCEL_ENV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'MODEL_API_BASE_URL',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID', 'APP_HOST', 'NEXTAUTH_URL',
  'SITE_DEPLOYMENT_GUIDE_URL', 'DATA_COMMONS_API_KEY', 'SOCRATA_DEFAULT_PORTAL', 'LOCK_PORTAL', 'SOURCE_ROUTING',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';
process.env.CKAN_MCP_URL = 'https://ckan.fixture.example/mcp';
process.env.NYC_CHARTER_HOSTING = 'sandbox';
process.env.NYC_CHECKBOOK_HOSTING = 'sandbox';
process.env.NYS_LEGISLATION_HOSTING = 'sandbox';
process.env.NYS_LEGISLATION_API_KEY = 'fixture-legislation-key';
process.env.EXECUTOR_DRIVER = 'none';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const route = (await import(pathToFileURL(path.join(SRC, 'app', 'api', 'flows', 'route.ts')).href)) as Mod;
const flows = (await import(pathToFileURL(path.join(SRC, 'lib', 'flows', 'statement.ts')).href)) as Mod;
const { whereItWentFromPackage } = (await import(pathToFileURL(path.join(SRC, 'lib', 'flows', 'where-it-went.ts')).href)) as Mod;

/** Read at the base, `407b68c`, from the real handler under this configuration. */
const AT_THE_BASE = {
  bytesSha256: 'fac1218bceb5e99be4c9f05834c9cb48037acd46d4879e83b5cae26fac68e971',
  length: 11562,
  hash: 'fac1218bceb5e99be4c9f05834c9cb48037acd46d4879e83b5cae26fac68e971',
  version: 'ce0f4f09dff9d9d998a00cca59b12ee92486752ce9d94ed1eb310eae01c69325',
  sources: {
    socrata: 'ad5fb26f9443c95c520b9523140352a2badc51f6f841db018d8a567f768de3e1',
    'data-commons': 'da03fdb61a3a3a6055cf53977fdbff2d84fb295000f52aa942b85ad6b4cd5e3b',
    'boston-opencontext': 'a73b8194f103d3d8f2e5594bd497b93d5a205f090707b13f6633b9f945f9a785',
    'nyc-charter': 'e381ddafc6d461ef1fdb913270aaac637d51801909613f6d7dc495fbcf6c7e61',
    'nyc-checkbook': 'bb350a722fbf9a740096edbb561d00182bd4c9841d3254336a61ebfadeb17ec4',
    'nyc-record': 'dd85ba32e4af1e20ae5240db657877aad7e10b5f2bbf15472d50b811eb579327',
    'nys-legislation': '83b334e65e930c58f4adca15b11fe59e04e212c978fbd60d1b645693d587adf8',
    'ckan-server': '932f885b589590a5e59d72f42673879a0cdcf09f0dc1f4f9bc626920908daeae',
  } as Record<string, string>,
};

test('A5 (pin): over the manifest\'s eight, the bytes /api/flows serves, the hash, the base version and each source\'s version are the base\'s', async () => {
  const response = await route.GET();
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  const statement = JSON.parse(bytes.toString('utf8'));
  assert.equal(statement.sources.length, 8, 'premise: the eight sources are configured');
  assert.deepEqual(
    {
      bytesSha256: createHash('sha256').update(bytes).digest('hex'),
      length: bytes.length,
      hash: flows.statementHash(statement),
      version: statement.version,
      sources: Object.fromEntries(statement.sources.map((s: Mod) => [s.sourceId, s.version])),
    },
    AT_THE_BASE,
  );
  assert.equal(flows.computeBaseVersion(statement.recipients), AT_THE_BASE.version);
  for (const source of statement.sources) assert.equal(flows.computeSourceVersion(source), AT_THE_BASE.sources[source.sourceId], source.sourceId);
});

test('A5 (pin): an analysis whose record cites that hash still shows its statement as in force', async () => {
  const statement = await flows.buildFlowsStatement();
  const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
  const record = {
    trace: { resourceSpans: [{ scopeSpans: [{ spans: [{ name: 'analysis', spanId: 'root', attributes: [attr('analysis.sources_offered', '[]')] }] }] }] },
    extensions: { 'org.civicaitools.composition': { flowsStatement: { url: 'https://site.fixture.example/api/flows', hash: AT_THE_BASE.hash, date: statement.date }, sourcesOffered: [] } },
  };
  const model = whereItWentFromPackage(record, statement);
  assert.ok(model, 'premise: the record has a trace');
  assert.deepEqual(model.statement, { kind: 'in-force' }, 'a record citing the base\'s hash no longer reads as in force');
});
