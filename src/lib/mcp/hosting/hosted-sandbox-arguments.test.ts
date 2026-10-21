// R8 W3 criteria 2 and 3 (a), (b): what the lifecycle hands the sandbox SDK,
// read off the calls' arguments, with the SDK replaced by a recording stub. No
// sandbox is created, so nothing here can stop or bill one.
//
// - Criterion 2: after the install, each hosted source's sandbox network
//   policy is its manifest entry's `outbound` list (read off the router's
//   manifest, not off the server object the lifecycle is handed), or
//   `deny-all` for an empty one; at creation it is the package registry only.
// - Criterion 3 (a): State legislation's key reaches only that source's
//   sandbox `env`, by name, beside the bridge token, and the bridge's config
//   names it as the one variable its child receives. No other source's sandbox
//   gets it, even with the key set.
// - Criterion 3 (b): with the switch set and the key unset, the source is not
//   configured: not hosted, its tools refused per call naming the key, one log
//   line naming the key, no flows source, no privacy statement, the record's
//   offered row `not-configured` and nothing else of the record moved, and
//   zero sandbox calls in both routing modes.
//
// The key is a placeholder; the real one is never in a session.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { CIVIC_MANIFEST, civicRouter } from '@typedstandards/civic-typed-router';

// --- Console capture -----------------------------------------------------------

const printed: string[] = [];
for (const level of ['log', 'warn', 'error', 'info'] as const) {
  console[level] = (...args: unknown[]) => {
    printed.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
}

// --- The recording sandbox SDK ---------------------------------------------------

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, next: (s: string, c?: unknown) => ResolveResult) => ResolveResult;
    load?: (url: string, context: unknown, next: (u: string, c?: unknown) => LoadResult) => LoadResult;
  }): void;
};
const STUB_URL = 'file:///r8-w3-stub/vercel-sandbox.mjs';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@vercel/sandbox') return { url: STUB_URL, format: 'module', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === STUB_URL) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `export const Sandbox = { getOrCreate: (params) => globalThis.__r8w3Sdk.getOrCreate(params) };
                 export class APIError extends Error {}`,
      };
    }
    return next(url, context);
  },
});

interface Created { name: string; env: Record<string, string>; networkPolicy: unknown }
const sdk = {
  getOrCreateCalls: 0,
  created: [] as Created[],
  updates: new Map<string, unknown[]>(),
  files: new Map<string, Array<{ path: string; content: string }>>(),
  session: 0,
  async getOrCreate(params: Record<string, unknown> & { name: string; env: Record<string, string>; networkPolicy: unknown; onCreate?: (h: unknown) => Promise<void> }) {
    sdk.getOrCreateCalls += 1;
    sdk.created.push({ name: params.name, env: { ...params.env }, networkPolicy: params.networkPolicy });
    sdk.updates.set(params.name, []);
    sdk.files.set(params.name, []);
    const sessionId = `r8-w3-session-${(sdk.session += 1)}`;
    const handle = {
      name: params.name,
      domain: () => 'https://sandbox.fixture.example',
      currentSession: () => ({ sessionId }),
      expiresAt: new Date(Date.now() + 600_000),
      extendTimeout: async () => {},
      writeFiles: async (files: Array<{ path: string; content: string }>) => { sdk.files.get(params.name)!.push(...files); },
      update: async (arg: unknown) => { sdk.updates.get(params.name)!.push(arg); },
      delete: async () => {},
      runCommand: async (p: { detached?: boolean }) => p.detached
        ? { logs: async function* () { yield { stream: 'stdout', data: 'BRIDGE_READY {}' }; } }
        : { exitCode: 0, stdout: async () => '', stderr: async () => '' },
    };
    await params.onCreate?.(handle);
    return handle;
  },
};
(globalThis as unknown as { __r8w3Sdk: typeof sdk }).__r8w3Sdk = sdk;

// --- The environment -------------------------------------------------------------

const VARIABLES = [
  'SOCRATA_MCP_URL', 'DATA_COMMONS_MCP_URL', 'BOSTON_OPENCONTEXT_MCP_URL', 'SOURCE_ROUTING', 'VERCEL_ENV',
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING', 'NYS_LEGISLATION_API_KEY',
  'SOURCE_BRIDGE_SECRET', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID', 'VERCEL_OIDC_TOKEN',
];
const KEY = 'NYS_LEGISLATION_API_KEY';
/** A placeholder, never a real key. */
const PLACEHOLDER_KEY = 'placeholder-not-a-key-r8-w3-0123456789';
const SECRET = 'r8-w3-test-secret-not-a-real-one-0123456789';

async function under<T>(env: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(VARIABLES.map((name) => [name, process.env[name]]));
  for (const name of VARIABLES) delete process.env[name];
  Object.assign(process.env, { SOCRATA_MCP_URL: 'http://127.0.0.1:9/socrata', DATA_COMMONS_MCP_URL: 'http://127.0.0.1:9/dc/mcp', SOURCE_BRIDGE_SECRET: SECRET }, env);
  try {
    return await body();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const registry = await import('../registry.ts');
const lifecycle = await import('./lifecycle.ts');

const ALL_SWITCHES = { NYC_CHARTER_HOSTING: 'sandbox', NYC_CHECKBOOK_HOSTING: 'sandbox', NYC_RECORD_HOSTING: 'sandbox', NYS_LEGISLATION_HOSTING: 'sandbox' };
const HOSTED_IDS = ['nyc-charter', 'nyc-checkbook', 'nyc-record', 'nys-legislation'];
const entryOf = (sourceId: string) => CIVIC_MANIFEST.find((entry) => entry.sourceId === sourceId)!;
const outboundOf = (sourceId: string): readonly string[] => {
  const variant = entryOf(sourceId).hostings.find((v) => v.kind === 'npm-package') as { outbound: readonly string[] };
  return variant.outbound;
};

/** Wake every hosted source once, with every switch on and the key set (or not), and return what each sandbox was given. */
async function wakeAll(extraEnv: Record<string, string>) {
  return under({ ...ALL_SWITCHES, ...extraEnv }, async () => {
    const built = registry.buildMcpRegistry(registry.readMcpEnvFromProcess());
    const seen: Record<string, { created: Created; updates: unknown[]; config: Record<string, unknown> | undefined }> = {};
    for (const sourceId of HOSTED_IDS) {
      const server = built.hosted[sourceId];
      assert.ok(server, `premise: ${sourceId} is hosted with every switch on and the key set`);
      const before = sdk.created.length;
      await lifecycle.wakeHostedSource(server, { secret: SECRET });
      assert.equal(sdk.created.length, before + 1, `${sourceId}: one creation`);
      const created = sdk.created[sdk.created.length - 1];
      const config = sdk.files.get(created.name)!.find((file) => file.path.endsWith('/bridge-config.json'));
      seen[sourceId] = { created, updates: sdk.updates.get(created.name)!, config: config ? JSON.parse(config.content) as Record<string, unknown> : undefined };
    }
    return seen;
  });
}

// Distinct environments per wake, so no sandbox name repeats across the tests.
let environment = 0;
const nextEnvironment = () => ({ VERCEL_ENV: `r8w3e${(environment += 1)}` });

test('R8 W3 criterion 2: after the install each sandbox\'s network policy is its entry\'s outbound list, or deny-all for none', async () => {
  const seen = await wakeAll({ [KEY]: PLACEHOLDER_KEY, ...nextEnvironment() });
  for (const sourceId of HOSTED_IDS) {
    const outbound = outboundOf(sourceId);
    assert.deepEqual(seen[sourceId].created.networkPolicy, { allow: ['registry.npmjs.org'] }, `${sourceId}: creation reaches more than the package registry`);
    assert.deepEqual(seen[sourceId].updates, [{ networkPolicy: outbound.length > 0 ? { allow: [...outbound] } : 'deny-all' }], `${sourceId}: the post-install policy is not the entry's outbound`);
  }
  // The shape that can fail: three entries with one host each and one with none.
  assert.deepEqual(HOSTED_IDS.map((id) => outboundOf(id).length), [0, 1, 1, 1]);
  assert.deepEqual(seen['nyc-checkbook'].updates, [{ networkPolicy: { allow: ['www.checkbooknyc.com'] } }]);
  assert.deepEqual(seen['nyc-record'].updates, [{ networkPolicy: { allow: ['data.cityofnewyork.us'] } }]);
  assert.deepEqual(seen['nys-legislation'].updates, [{ networkPolicy: { allow: ['legislation.nysenate.gov'] } }]);
  assert.deepEqual(seen['nyc-charter'].updates, [{ networkPolicy: 'deny-all' }]);
});

test('R8 W3 criterion 3 (a): the key reaches only State legislation\'s sandbox env, by name, beside the token, and only its bridge passes it on', async () => {
  const seen = await wakeAll({ [KEY]: PLACEHOLDER_KEY, ...nextEnvironment() });
  const nys = seen['nys-legislation'];
  assert.deepEqual(Object.keys(nys.created.env).sort(), [KEY, 'SOURCE_BRIDGE_TOKEN'], 'State legislation\'s sandbox env is not the token and the key');
  assert.equal(nys.created.env[KEY], PLACEHOLDER_KEY);
  assert.deepEqual(nys.config?.childEnv, [KEY], 'the bridge config does not name the key as the one variable its child receives');
  for (const sourceId of ['nyc-charter', 'nyc-checkbook', 'nyc-record']) {
    assert.deepEqual(Object.keys(seen[sourceId].created.env), ['SOURCE_BRIDGE_TOKEN'], `${sourceId}'s sandbox env carries more than its token`);
    assert.deepEqual(Object.keys(seen[sourceId].config ?? {}).sort(), ['package', 'pinDir', 'port', 'version'], `${sourceId}'s bridge config is not the base's shape`);
  }
  for (const line of printed) assert.ok(!line.includes(PLACEHOLDER_KEY), `a log line carries the key: ${line}`);
  // The token is never on the child's list.
  assert.ok(!(nys.config?.childEnv as string[] | undefined ?? []).includes('SOURCE_BRIDGE_TOKEN'));
});

test('R8 W3 criterion 3: the key variable is named for exactly the variants that carry keyIn', () => {
  const keyed = CIVIC_MANIFEST.filter((entry) => entry.hostings.some((v) => v.kind === 'npm-package' && v.keyIn !== undefined)).map((entry) => entry.sourceId);
  assert.deepEqual(keyed, ['nys-legislation'], 'premise: State legislation is the one keyed variant');
  const named = (registry as unknown as Record<string, unknown>).HOSTED_SOURCE_KEY_VARIABLE as Record<string, string> | undefined;
  assert.deepEqual(named, { 'nys-legislation': KEY }, 'the site does not name exactly one key variable per keyed variant');
});

test('R8 W3 criterion 3 (b): switch set, key unset: not configured, named on three surfaces, and no sandbox call in either routing mode', async () => {
  await under({ NYS_LEGISLATION_HOSTING: 'sandbox', ...nextEnvironment() }, async () => {
    const lineCount = () => printed.filter((line) => line.includes(KEY)).length;
    const linesBefore = lineCount();
    const configured = registry.readMcpEnvFromProcess();
    registry.readMcpEnvFromProcess();
    registry.readMcpEnvFromProcess();
    assert.equal(configured.nysLegislationHosting, undefined, 'the switch reached the router with no key');
    const built = registry.buildMcpRegistry(configured);
    assert.equal(built.hosted['nys-legislation'], undefined, 'State legislation is hosted with no key');
    const tools = entryOf('nys-legislation').toolNames.map((tool) => `nys_legislation__${tool}`);
    for (const tool of tools) assert.equal(built.unconfiguredTools[tool], KEY, `${tool} is not refused naming the key`);
    // The surface the record reads: the offered row, and nothing else moved
    // against the same configuration with the switch unset.
    const unset = { ...configured };
    assert.deepEqual(civicRouter.sourcesOffered(configured).find((row) => row.sourceId === 'nys-legislation')?.reason, 'not-configured');
    assert.deepEqual(civicRouter.sourcesOffered(configured), civicRouter.sourcesOffered(unset));
    assert.deepEqual(registry.configuredMcpServers(configured), registry.configuredMcpServers({ ...configured, nysLegislationHosting: undefined }));
    // No flows source, so no consent card line and no privacy statement.
    const { buildFlowsStatement } = await import('../../flows/statement.ts');
    const statement = await buildFlowsStatement();
    assert.ok(!statement.sources.some((source: { sourceId: string }) => source.sourceId === 'nys-legislation'), 'the flows statement names the keyless source');
    const facts = await import('../../privacy-facts.ts');
    const ids = facts.buildPrivacySections(null).flatMap((section: { statements: Array<{ id?: string }> }) => section.statements.map((s) => s.id ?? ''));
    assert.ok(!ids.some((id: string) => id.endsWith('-nys-legislation')), `the privacy page states the keyless source: ${ids.filter((id: string) => id.includes('nys'))}`);

    // The per-call refusal, in both routing modes, with zero sandbox calls.
    const calls = sdk.getOrCreateCalls;
    const { callMcpTool } = await import('../client.ts');
    await assert.rejects(callMcpTool('nys_legislation__search', { term: 'climate', type: 'bills' }), (error: Error) => {
      assert.match(error.message, new RegExp(KEY), 'the all-sources refusal does not name the key');
      return true;
    });
    process.env.SOURCE_ROUTING = 'in-loop';
    const routingMode = await import('../routing-mode.ts');
    assert.equal(routingMode.sourceRoutingMode(), 'in-loop');
    const directory = routingMode.directorySet(configured, { enforced: true, states: { socrata: 'on', 'nys-legislation': 'on' } });
    assert.ok(!directory.some((entry) => entry.sourceId === 'nys-legislation'), 'the in-loop directory lists the keyless source');
    const inLoop = await routingMode.createInLoopRouting({ configured, directory, selection: ['socrata'] });
    assert.equal((await inLoop.loadStep.load('nys_legislation', { iteration: 1 })).outcome, 'not-offered');
    await assert.rejects(inLoop.executeToolCall('nys_legislation__search', { term: 'climate', type: 'bills' }), (error: Error) => {
      assert.match(error.message, new RegExp(KEY), 'the in-loop refusal does not name the key');
      return true;
    });
    assert.equal(sdk.getOrCreateCalls - calls, 0, 'a keyless source made a sandbox call');
    // One server log line names the key, however many times the configuration is read.
    assert.equal(lineCount() - linesBefore, 1, `expected one log line naming ${KEY}`);
    const line = printed.filter((l) => l.includes(KEY)).at(-1)!;
    assert.match(line, /NYS_LEGISLATION_HOSTING/);
  });
});
