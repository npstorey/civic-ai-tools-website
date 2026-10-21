// R8 W3 criterion 4 (a): a run that calls router 0.6.0's three hosted
// sources records each as NYC Charter is recorded (#617 ruling a2): its purl
// in the run's server list (`analysis.mcp_servers`, which the packager signs),
// `x.y.z+commit` in its `components[]` entry, and its answered calls in
// `dataSources[]` under its source id. With its switch unset a source is a
// `not-configured` row and nothing else.
//
// DRIVEN, END TO END. The real composition, the real loop core with the compare
// factory's default transport (the MCP client, the registry, the hosting
// lifecycle and address modules), a real trace and the real packager. Replaced:
// the model (a scripted one on loopback), the sandbox SDK (a stub that creates
// nothing and states a loopback address), and the bridge (a scripted modern MCP
// server on that address). State legislation's key is a placeholder.
//
// THE SHAPE THAT CAN FAIL. Three sources, each called once with a different
// tool, beside one Socrata call: a record that dropped one source, collapsed
// two, or took a source's version from anything but its pin fails by name.
// Red with the pin's registry, which reads no new switch.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';

for (const level of ['log', 'warn', 'info'] as const) console[level] = () => {};

// --- The sandbox SDK: no sandbox, a loopback address --------------------------------

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, next: (s: string, c?: unknown) => ResolveResult) => ResolveResult;
    load?: (url: string, context: unknown, next: (u: string, c?: unknown) => LoadResult) => LoadResult;
  }): void;
};
const STUB_URL = 'file:///r8-w3-record-stub/vercel-sandbox.mjs';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@vercel/sandbox') return { url: STUB_URL, format: 'module', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === STUB_URL) {
      return { format: 'module', shortCircuit: true, source: 'export const Sandbox = { getOrCreate: (p) => globalThis.__r8w3RecordSdk(p) }; export class APIError extends Error {}' };
    }
    return next(url, context);
  },
});

/** The scripted bridge: modern, any bearer token, one answer per source. */
const seenCalls: Array<{ name: string; authorization: string | undefined }> = [];
const bridge = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string; params?: { name?: string } }) : {};
  if (!String(req.headers.authorization ?? '').startsWith('Bearer ')) { res.writeHead(401); res.end(); return; }
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
  const reply = (payload: Record<string, unknown>) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, ...payload }));
  };
  if (msg.method === 'server/discover') return reply({ result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } } });
  if (msg.method === 'tools/call') {
    seenCalls.push({ name: String(msg.params?.name), authorization: req.headers.authorization });
    return reply({ result: { content: [{ type: 'text', text: `fixture answer from ${msg.params?.name}` }] } });
  }
  reply({ error: { code: -32601, message: 'Method not found' } });
});
await new Promise<void>((resolve) => bridge.listen(0, '127.0.0.1', () => resolve()));
bridge.unref();
const BRIDGE_ORIGIN = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`;

let session = 0;
let created = 0;
(globalThis as unknown as { __r8w3RecordSdk: (p: Record<string, unknown> & { onCreate?: (h: unknown) => Promise<void> }) => Promise<unknown> }).__r8w3RecordSdk = async (params) => {
  created += 1;
  const sessionId = `r8-w3-record-${(session += 1)}`;
  const handle = {
    domain: () => BRIDGE_ORIGIN,
    currentSession: () => ({ sessionId }),
    expiresAt: new Date(Date.now() + 600_000),
    extendTimeout: async () => {},
    writeFiles: async () => {},
    update: async () => {},
    delete: async () => {},
    runCommand: async (p: { detached?: boolean }) => p.detached
      ? { logs: async function* () { yield { stream: 'stdout', data: 'BRIDGE_READY {}' }; } }
      : { exitCode: 0, stdout: async () => '', stderr: async () => '' },
  };
  await params.onCreate?.(handle);
  return handle;
};

// --- The environment, before the client's registry is built -------------------------

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

for (const name of ['NYC_CHARTER_HOSTING', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'SOURCE_ROUTING', 'VERCEL_ENV', 'VERCEL_TOKEN', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'MODEL_API_KIND', 'MODEL_API_AUTH']) delete process.env[name];
Object.assign(process.env, {
  SOCRATA_MCP_URL: 'http://127.0.0.1:9/socrata',
  DATA_COMMONS_MCP_URL: 'http://127.0.0.1:9/dc/mcp',
  NYC_CHECKBOOK_HOSTING: 'sandbox',
  NYC_RECORD_HOSTING: 'sandbox',
  NYS_LEGISLATION_HOSTING: 'sandbox',
  NYS_LEGISLATION_API_KEY: 'placeholder-not-a-key-r8-w3',
  SOURCE_BRIDGE_SECRET: 'r8-w3-record-secret-not-a-real-one-0123456789',
  PUBLISHER_KEY_ID: 'platform:test-suite-kid',
  EVIDENCE_KEY_ID: 'platform:test-suite-kid',
});
const { REFERENCE_IDENTITY_ENV } = await import('../../evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV as Record<string, string>)) process.env[name] ??= value;

const registry = await import('../registry.ts');
const skill = await import('../socrata-skill.ts');
const { startScriptedModelServer } = await import('../../model-loop/test-harness.ts');
const { compareLoopOptions } = await import('../../model-loop/compare-loop.ts');
const { runToolLoop } = await import('../../model-loop/run-tool-loop.ts');
const { createModelClient } = await import('../../model-client.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG, runRecordAttributes, hash } = await import('../../evidence/trace.ts');
const { buildEvidencePackage } = await import('../../evidence/packager.ts');

const NEW = ['nyc-checkbook', 'nyc-record', 'nys-legislation'] as const;
const CALLS: Record<(typeof NEW)[number], { name: string; args: Record<string, unknown> }> = {
  'nyc-checkbook': { name: 'nyc_checkbook__search_contracts', args: { agency_code: '040', fiscal_year: 2025 } },
  'nyc-record': { name: 'nyc_record__search_notices', args: { query: 'public hearing' } },
  'nys-legislation': { name: 'nys_legislation__search_bills', args: { term: 'climate' } },
};
const variantOf = (sourceId: string) => CIVIC_MANIFEST.find((e) => e.sourceId === sourceId)!.hostings.find((v) => v.kind === 'npm-package') as { package: string; version: string; commit: string };

const PROMPT = 'Which contracts, notices and bills mention school construction?';
const configured = registry.readMcpEnvFromProcess();
const composition = await skill.composeSystemPrompt({ portal: 'data.cityofnewyork.us', configured });
const scripted = await startScriptedModelServer([
  { toolCalls: NEW.map((id, i) => ({ id: `c${i}`, name: CALLS[id].name, args: CALLS[id].args })) },
  { content: 'Three sources answered.' },
]);
process.env.MODEL_API_BASE_URL = scripted.url;
const compare = compareLoopOptions({
  client: createModelClient({ apiKey: 'placeholder-model-key-r8-w3' }),
  endpointModel: 'fake/model',
  requestSettings: undefined,
  prompt: PROMPT,
  systemPrompt: composition.prompt,
  portal: 'data.cityofnewyork.us',
  configured,
});
const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
builder.startRoot('analysis', { 'analysis.prompt_hash': hash(PROMPT), 'analysis.model': 'fake/model' });
const result = await runToolLoop({ ...compare, trace: { builder, parentSpanId: builder.rootSpanId, systemPromptHash: hash(composition.prompt), resolveToolSource: (name: string) => registry.routedSourceId(name, configured) } });
builder.endRoot(runRecordAttributes({
  assertedDate: composition.assertedDate,
  mcpServers: registry.configuredMcpServers(configured),
  toolDefinitions: compare.tools,
  sourcesOffered: composition.sourcesOffered,
  components: composition.components,
}));
await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
const trace = builder.finalize() as unknown as Record<string, unknown>;
const { pkg } = buildEvidencePackage({
  trace,
  prompt: PROMPT,
  output: result.content,
  toolCalls: result.toolCalls,
  model: 'fake/model',
  tokenUsage: { promptTokens: 10, completionTokens: 5 },
  promptVisibility: 'full_text',
  title: 'R8 W3 criterion 4',
  summary: 'R8 W3 criterion 4.',
  captureMethod: 'chat-flow-stream',
});
const record = JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>;
const rootAttr = (key: string): string | undefined => {
  const spans = (((record.trace as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ parentSpanId?: string; attributes: Array<{ key: string; value: { stringValue?: string } }> }> }> }> }).resourceSpans)[0].scopeSpans[0].spans);
  return spans.find((s) => !s.parentSpanId)?.attributes.find((a) => a.key === key)?.value.stringValue;
};

test('R8 W3 criterion 4 (a): premise: each new source was called once, through its sandbox\'s bridge', () => {
  assert.deepEqual(seenCalls.map((c) => c.name), ['search_contracts', 'search_notices', 'search_bills']);
  assert.equal(created, 3, 'one sandbox per new source');
  assert.ok(result.toolCalls.every((call) => !call.failed), `a call failed: ${JSON.stringify(result.toolCalls)}`);
});

test('R8 W3 criterion 4 (a): the record\'s server list carries each new source\'s purl', () => {
  const servers = JSON.parse(rootAttr('analysis.mcp_servers') ?? 'null') as Array<{ url: string; name: string }>;
  for (const sourceId of NEW) {
    const variant = variantOf(sourceId);
    const purl = `pkg:npm/${variant.package.split('/').map(encodeURIComponent).join('/')}@${variant.version}`;
    assert.deepEqual(servers.filter((s) => s.name === sourceId), [{ url: purl, name: sourceId }], `${sourceId}'s server entry`);
  }
});

test('R8 W3 criterion 4 (a): each new source\'s components[] entry states x.y.z+commit, from its pin', () => {
  const components = ((record.extensions as Record<string, { components: Array<{ id: string; version?: string }> }>)['org.civicaitools.composition']).components;
  for (const sourceId of NEW) {
    const entry = CIVIC_MANIFEST.find((e) => e.sourceId === sourceId)!;
    const variant = variantOf(sourceId);
    assert.deepEqual(components.filter((c) => c.id === entry.id), [{ id: entry.id, version: `${variant.version}+${variant.commit.slice(0, 12)}` }], `${sourceId}'s component`);
  }
});

test('R8 W3 criterion 4 (a): dataSources[] names each new source\'s calls under its source id', () => {
  const sources = record.dataSources as Array<{ sourceId: string; catalogType: string; portalUrl: string }>;
  for (const sourceId of NEW) {
    const variant = variantOf(sourceId);
    const entries = sources.filter((s) => s.sourceId === sourceId);
    assert.equal(entries.length, 1, `${sourceId} has ${entries.length} dataSources entries`);
    assert.equal(entries[0].catalogType, 'npm-package');
    assert.match(entries[0].portalUrl, new RegExp(`@${variant.version.replace(/\./g, '\\.')}$`));
  }
  const offered = JSON.parse(rootAttr('analysis.sources_offered') ?? 'null') as Array<{ sourceId: string; reason: string }>;
  for (const sourceId of NEW) assert.equal(offered.find((s) => s.sourceId === sourceId)?.reason, 'configured');
  assert.equal(offered.find((s) => s.sourceId === 'nyc-charter')?.reason, 'not-configured', 'with its switch unset a source is a not-configured row');
});
