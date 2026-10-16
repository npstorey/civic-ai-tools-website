// #617 P3 criterion 9 — with NYC_CHARTER_HOSTING unset, the hosted source is
// dark on every path: no module of the host is loaded and no sandbox call is
// made, its tools are withheld from the model, the registry holds no hosted
// entry, and a call to one of its tools anyway (a replayed record, or a model
// naming a tool it was not given) is refused before any request, naming the
// variable that would switch it on.
//
// THE SHAPE THAT CAN FAIL. Every module this process loads is recorded by a
// resolve hook, and `@vercel/sandbox` is replaced by a module that throws when
// it is evaluated: an instance with the switch unset that loaded the host on
// any path — the client's module load, a refused call, the prompt composition
// — fails here, not only one that went on to call it. The refusal is driven in
// both spellings, because the dispatch rule refuses a bare name on its own
// branch. A value other than `sandbox` is driven too: the switch is exact.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/hosting/dark-when-unset.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';

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

const loaded: string[] = [];
const STUB_URL = 'file:///r7-p3-dark/vercel-sandbox.mjs';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@vercel/sandbox') {
      loaded.push(specifier);
      return { url: STUB_URL, format: 'module', shortCircuit: true };
    }
    const resolved = nextResolve(specifier, context);
    loaded.push(resolved.url);
    return resolved;
  },
  load(url, context, nextLoad) {
    if (url === STUB_URL) {
      return { format: 'module', shortCircuit: true, source: `throw new Error('the sandbox SDK was loaded with the switch unset');` };
    }
    return nextLoad(url, context);
  },
});

delete process.env.SOURCE_BRIDGE_SECRET;
process.env.NYC_CHARTER_HOSTING = '';
process.env.SOCRATA_MCP_URL = 'http://127.0.0.1:9/never';

const realFetch = globalThis.fetch;
const fetched: string[] = [];
// Loopback only: the composition asks the Data Commons default for its
// instructions, and no test leaves this machine.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  fetched.push(url);
  if (new URL(url).hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

const { callMcpTool } = await import('../client.ts');
const { buildMcpRegistry, readMcpEnvFromProcess, McpConfigurationError } = await import('../registry.ts');
const { offeredMcpTools, mcpToolsFor } = await import('../tools.ts');
const { composeSystemPrompt } = await import('../socrata-skill.ts');
const router = await import('@typedstandards/civic-typed-router');

const CHARTER_EXPOSED = router.NYC_CHARTER_TOOL_NAMES.map((name) => `nyc_charter__${name}`);

const hostLoaded = () => loaded.filter((url) => url === '@vercel/sandbox' || url.includes('/mcp/hosting/') && !url.endsWith('.test.ts'));

test('criterion 9: with the switch unset the registry holds no hosted entry and offers none of its tools', () => {
  const configured = readMcpEnvFromProcess();
  assert.equal(Object.hasOwn(configured, 'nycCharterHosting'), false, 'the configuration reads the switch as on');
  const registry = buildMcpRegistry(configured);
  assert.deepEqual(registry.hosted, {}, 'the registry built a hosted entry with the switch unset');
  assert.equal(registry.servers['nyc-charter'], undefined);
  const offered = offeredMcpTools(mcpToolsFor(), configured).map((t) => (t as { function: { name: string } }).function.name);
  for (const name of CHARTER_EXPOSED) assert.ok(!offered.includes(name), `${name} was offered with the switch unset`);
  for (const name of CHARTER_EXPOSED) assert.equal(registry.unconfiguredTools[name], 'NYC_CHARTER_HOSTING', `${name} is not refused naming the switch`);
});

test('criterion 9: a call to a Charter tool, in either spelling, is refused as not configured, naming the switch, before any request', async () => {
  for (const name of ['nyc_charter__get_section', 'get_section', 'nyc_charter__search']) {
    const before = fetched.length;
    await assert.rejects(
      callMcpTool(name, { citation: '§ 259' }),
      (error: unknown) => error instanceof McpConfigurationError && /NYC_CHARTER_HOSTING/.test(error.message),
      `${name} was not refused naming NYC_CHARTER_HOSTING`,
    );
    assert.equal(fetched.length, before, `${name}: a request left before the refusal`);
  }
});

test('criterion 9: a value other than `sandbox` leaves the switch off', () => {
  for (const value of ['on', 'true', '1', 'Sandbox', 'sandbox-please']) {
    const configured = router.readMcpEnv({ NYC_CHARTER_HOSTING: value });
    assert.deepEqual(buildMcpRegistry(configured).hosted, {}, `"${value}" switched the source on`);
  }
  assert.ok(buildMcpRegistry(router.readMcpEnv({ NYC_CHARTER_HOSTING: ' sandbox ' })).hosted['nyc-charter'], 'premise: `sandbox` (trimmed) switches it on');
});

test('criterion 9: composing the prompt makes no request for the hosted source and loads no host module', async () => {
  const composed = await composeSystemPrompt({ configured: readMcpEnvFromProcess(), now: new Date('2026-10-16T12:00:00Z') });
  assert.ok(!composed.prompt.includes('nyc_charter__'), 'the prompt names a Charter tool with the switch unset');
  assert.deepEqual(
    composed.sourcesOffered.find((s) => s.sourceId === 'nyc-charter'),
    { sourceId: 'nyc-charter', alias: 'nyc_charter', reason: 'not-configured' },
  );
  assert.ok(!composed.components.some((c) => c.id.startsWith('@betanyc/')), 'an unoffered source has a component');
});

test('criterion 9: no module of the host was loaded on any path above, and no sandbox call was made', () => {
  assert.ok(loaded.some((url) => url.endsWith('/mcp/client.ts')), 'premise: the hook saw the client load');
  assert.deepEqual(hostLoaded(), [], 'a host module or the sandbox SDK was loaded with the switch unset');
});
