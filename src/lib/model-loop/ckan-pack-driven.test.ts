// CKAN-1 P3 (npstorey/civic-ai-tools#314), stage R: criteria A13b, A13c, A14, A15 and A16, driven.
//
// WHAT IS DRIVEN. The consent gate (`consentInForce`, the gate on, the cookie store; the row store is a stub), the
// composition (`composeSystemPrompt`), the real loop core through `/api/compare`'s factory (`compareLoopOptions`),
// the real MCP client, the real trace builder and the real packager. The hosted CKAN server is a fetch recorder at
// `https://ckan.example.test/mcp`: it sees every request the client sends there and answers the MCP handshake, a
// `tools/list` of the six base tools the Boston pack pins (`CKAN_PACK_BASE_TOOLS`, as `ckan-mcp-server` 0.4.139
// reports them) and every `tools/call`. "Sent" is a `tools/call` the recorder saw; "refused before it is sent" is a
// call it never saw, and for A14 a run in which it saw no request of any kind.
//
// RED AT STAGE L (`a9f092b`): the website reads no `CKAN_MCP_URL`, builds no `ckan-server` server and gives the pack
// no filter, so every pack call is refused `not_configured` and the recorder sees nothing. Each test asserts what is
// sent before what is refused, so none of them is green for that reason.
//
// SHAPED TO FAIL.
//   - A14: the refused call names a portal (`www.dati.gov.it`) no other call in the file names, alone in its run, so
//     any request in that run is its. The two calls that must be sent differ from the pack's portal only in case
//     and in a trailing slash: an exact-string comparison refuses both.
//   - A15: three refused statements and four sent ones, the semicolon inside a quoted literal among the sent ones,
//     and a comment before a SELECT among them, so a check that only reads the first word, or that splits on every
//     semicolon, fails a case in each direction.
//   - A16: a rejected pack call on a portal no answered call reaches sits beside the answered one in one run, so a
//     rejected call that reached `dataSources` would show as a second entry. The decoy rewrites only `mcp.source`.
//   - A13c: the pack Off with its variable set must read `not_offered`; the same call with the variable unset must
//     still read `not_configured`, in the same test.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ScriptedToolCall } from './test-harness.ts';
import type { ToolCallRecord } from './run-tool-loop.ts';

// --- The consent store stub (the gate's row store; the cookie path never reads it) ----------------------------

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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');
const CONSENT_STORE_FILE = path.join(SRC, 'lib', 'sources', 'consent-store.ts');
const STUB_PREFIX = 'file:///ckan1-p3-driven-stub/';
const STUB_SOURCE = `
  export async function readConsentRow() { return null; }
  export async function writeConsentRow() {}
  export async function deleteConsentRow() {}`;

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
    let file: string | null = null;
    if (specifier.startsWith('@/')) {
      file = firstFile(path.join(SRC, specifier.slice(2)));
      if (file === null) throw new Error(`ckan1-p3 test hook: cannot resolve ${specifier}`);
    } else {
      const parent = (context as { parentURL?: string }).parentURL;
      if (specifier.startsWith('.') && parent?.startsWith('file:') && !parent.startsWith(STUB_PREFIX)) {
        file = firstFile(path.resolve(path.dirname(fileURLToPath(parent)), specifier));
      }
    }
    if (file === CONSENT_STORE_FILE) return { url: `${STUB_PREFIX}consent-store.mjs`, format: 'module', shortCircuit: true };
    if (file !== null) return { url: pathToFileURL(file).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) return { format: 'module', source: STUB_SOURCE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

// --- The hosted CKAN server: a fetch recorder ------------------------------------------------------------------

const CKAN_HOST = 'ckan.example.test';
const CKAN_URL = `https://${CKAN_HOST}/mcp`;
const PORTAL = 'https://data.boston.gov';
const OTHER_PORTAL = 'https://www.dati.gov.it';

interface Seen { method: string; tool?: string; args?: Record<string, unknown> }
const seen: Seen[] = [];
const sessions = new Set<string>();

const router = await import('@typedstandards/civic-typed-router');
const BASE_TOOLS = (router.CKAN_PACK_BASE_TOOLS as unknown as Array<{ function: { name: string; description?: string; parameters?: unknown } }>)
  .map((t) => ({ name: t.function.name, description: t.function.description, inputSchema: t.function.parameters }));

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  if (url.hostname !== CKAN_HOST) throw new TypeError(`fetch refused by the test: ${url.hostname}`);
  const method = init?.method ?? 'GET';
  if (method !== 'POST') { seen.push({ method: `${method} (http)` }); return new Response(null, { status: 405 }); }
  const body = JSON.parse(String(init?.body ?? '{}')) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  seen.push({ method: String(body.method), ...(body.method === 'tools/call' ? { tool: body.params?.name, args: body.params?.arguments } : {}) });
  const answer = (status: number, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, ...payload }), { status, headers: { 'content-type': 'application/json', ...headers } });
  if (body.id === undefined) return new Response(null, { status: 202 });
  if (body.method === 'server/discover') return answer(400, { error: { code: -32601, message: 'Method not found' } });
  if (body.method === 'initialize') {
    const id = `ckan-${sessions.size + 1}`;
    sessions.add(id);
    return answer(200, { result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ckan-mcp-server', version: '0.4.139' } } }, { 'mcp-session-id': id });
  }
  if (body.method === 'tools/list') return answer(200, { result: { tools: BASE_TOOLS } });
  return answer(200, { result: { content: [{ type: 'text', text: JSON.stringify({ success: true, result: { records: [{ count: 42 }], total: 1 } }) }] } });
}) as typeof fetch;

// --- The configuration ------------------------------------------------------------------------------------------

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'DATA_COMMONS_API_KEY',
  'SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED', 'SOURCE_ROUTING', 'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.example.test/mcp';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.example.test/mcp';
process.env.CKAN_MCP_URL = CKAN_URL;
process.env.OPENROUTER_API_KEY = 'not-a-credential-ckan1-p3';
const { REFERENCE_IDENTITY_ENV } = await import('../evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
for (const level of ['log', 'warn'] as const) console[level] = () => {};

const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const gate = await load('lib/sources/consent-gate.ts');
const { buildFlowsStatement } = await load('lib/flows/statement.ts');
const { CONSENT_COOKIE_NAME, encodeConsentCookie } = await load('lib/sources/consent.ts');
const { startScriptedModelServer } = await import('./test-harness.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { compareLoopOptions } = await import('./compare-loop.ts');
const { _resetDefaultModelClientForTests, getModelClient } = await import('../model-client.ts');
const { buildMcpRegistry, configuredMcpServers, dispatchTargetOf, readMcpEnvFromProcess, routeToolCall, routedSourceId } = await import('../mcp/registry.ts');
const { composeSystemPrompt } = await import('../mcp/socrata-skill.ts');
const { mcpToolsFor, offeredMcpTools } = await import('../mcp/tools.ts');
const { classifyStreamError, describeToolFailureForLlm } = await import('../streaming.ts');
/** The pack's filter and its two refusals. `SqlStatementRefusedError` is the green's name, read through a cast so this file
 *  type-checks before it exists. */
const packFilterModule = (await import('../mcp/pack-filter.ts')) as unknown as {
  packFilterOf: (name: string) => unknown;
  PackFilterRefusedError: new (filter: never) => Error;
  SqlStatementRefusedError?: new (filter: never) => Error;
};
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('../evidence/trace.ts');
const { buildEvidencePackage } = await import('../evidence/packager.ts');

const PACK = router.CIVIC_MANIFEST.find((entry) => entry.sourceId === 'boston-ckan')!;
const BASE = router.CIVIC_MANIFEST.find((entry) => entry.sourceId === 'ckan-server')!;
const exposed = (upstream: string) => `${PACK.alias}__${upstream}`;
const NOW = new Date('2026-11-16T12:00:00Z');

type States = Record<string, 'on' | 'ask-first' | 'off'>;

/** The gate's answer for a cookie carrying `states`, every other source of the statement On. */
async function decide(states: States): Promise<Mod> {
  const statement = await buildFlowsStatement();
  // A source the statement has no row for keeps a stored state with a version no row has: a stale id, which the gate ignores.
  const versionOf = (id: string) => statement.sources.find((s: { sourceId: string }) => s.sourceId === id)?.version ?? '0'.repeat(64);
  const all: States = { ...Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, 'on'])), ...states };
  const value = encodeConsentCookie({
    v: 1,
    flows: statement.version,
    states: Object.fromEntries(Object.entries(all).map(([id, state]) => [id, { state, since: '2026-11-16', version: versionOf(id) }])),
  });
  const request = new Request('https://site.example.test/api/compare', { method: 'POST', headers: { cookie: `${CONSENT_COOKIE_NAME}=${value}` } });
  const decision = await gate.consentInForce(request, null);
  assert.equal(decision.ok, true, `premise: the consent is in force: ${JSON.stringify(decision.payload ?? {})}`);
  assert.equal(decision.enforced, true, 'premise: the gate is on');
  return decision;
}

const call = (id: string, name: string, args: Record<string, unknown>): ScriptedToolCall => ({ id, name, args: structuredClone(args) });
type Span = { name: string; spanId: string; parentSpanId?: string; attributes?: Array<{ key: string; value?: { stringValue?: string; boolValue?: boolean; intValue?: number | string } }> };
interface Run { calls: ToolCallRecord[]; seen: Seen[]; spans: Span[]; trace: unknown; sourcesOffered: unknown[]; told: Map<string, string> }

/** One run through `/api/compare`'s factory under the gate's selection; each element of `turns` is one model turn. */
async function run(states: States, turns: ScriptedToolCall[][]): Promise<Run> {
  const decision = await decide(states);
  const configured = readMcpEnvFromProcess();
  const selection = decision.selection as string[];
  const composed = await composeSystemPrompt({ configured, selection, now: NOW });
  const sourcesOffered = decision.recordReasons(composed.sourcesOffered) as unknown[];
  const from = seen.length;
  const model = await startScriptedModelServer([...turns.map((toolCalls) => ({ toolCalls })), { content: 'An answer.' }]);
  process.env.MODEL_API_BASE_URL = model.url;
  _resetDefaultModelClientForTests();
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {
    'analysis.mcp_servers': JSON.stringify(configuredMcpServers(configured)),
    'analysis.asserted_date': composed.assertedDate,
    'analysis.sources_offered': JSON.stringify(sourcesOffered),
    'analysis.components': JSON.stringify(composed.components),
  });
  try {
    const calls = (await runToolLoop({
      ...compareLoopOptions({
        client: getModelClient(),
        endpointModel: 'fake/model',
        requestSettings: undefined,
        prompt: 'How many 311 requests were filed in Boston?',
        systemPrompt: composed.prompt,
        configured,
        selection,
      }),
      trace: { builder, parentSpanId: builder.rootSpanId, resolveToolSource: (name: string) => routedSourceId(name, configured, selection) },
    })).toolCalls;
    builder.endRoot({});
    const trace = builder.finalize() as unknown as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> };
    const spans = trace.resourceSpans[0].scopeSpans[0].spans.filter((s) => s.name === 'mcp_tool_call');
    // What the model was told about each call, by its id: the tool messages of every request after the call.
    const told = new Map<string, string>();
    for (const request of model.requests) {
      for (const m of (request.messages ?? []) as Array<{ role?: string; tool_call_id?: string; content?: unknown }>) {
        if (m.role === 'tool' && m.tool_call_id) told.set(m.tool_call_id, String(m.content));
      }
    }
    return { calls, seen: seen.slice(from), spans, trace, sourcesOffered, told };
  } finally {
    await new Promise((resolve) => model.server.close(resolve));
    _resetDefaultModelClientForTests();
  }
}

const attr = (span: Span | undefined, key: string): unknown => {
  const v = span?.attributes?.find((a) => a.key === key)?.value;
  return v === undefined ? undefined : v.stringValue ?? v.boolValue ?? v.intValue;
};
const sentCalls = (r: Run) => r.seen.filter((s) => s.method === 'tools/call');
const failureOf = (c: ToolCallRecord) => ({ failed: c.failed === true, failureKind: c.failureKind ?? null });

// --- The driven runs, all before any test is defined: a test that unsets `CKAN_MCP_URL` (A13 unset, A13c, A-C1) runs
// as soon as it is defined, so a run started after it would race it.

const A13B = await run({ 'ckan-server': 'off', 'boston-ckan': 'on' }, [[call('b1', exposed('ckan_package_search'), { server_url: PORTAL, q: 'potholes' })]]);

const A14_OTHER = await run({}, [[call('p1', exposed('ckan_package_search'), { server_url: OTHER_PORTAL, q: 'potholes' })]]);
const A14_SENT = await run({}, [[
  call('p2', exposed('ckan_package_search'), { server_url: 'HTTPS://Data.Boston.GOV', q: 'potholes' }),
  call('p3', exposed('ckan_package_show'), { server_url: `${PORTAL}/`, id: '311-service-requests' }),
]]);

const SQL_REFUSED = ['DELETE FROM "x"', '/* c */ drop table x', 'SELECT 1; DROP TABLE x'];
const SQL_SENT = ['SELECT count(*) FROM "x"', 'WITH t AS (SELECT 1) SELECT * FROM t', 'SELECT * FROM "x" WHERE name = \'a;b\'', '/* c */ SELECT 1'];
const A15 = await run({}, [[...SQL_SENT, ...SQL_REFUSED].map((sql, i) => call(`s${i}`, exposed('ckan_datastore_search_sql'), { server_url: PORTAL, sql }))]);
/** Fix round 1 (F1): a second statement behind PostgreSQL's other quoting forms, each in a run of its own, so a request in
 *  that run can only be its. The datastore is PostgreSQL, so the check reads PostgreSQL's lexical forms. */
const SQL_HIDDEN = [
  "SELECT E'\\''; DROP TABLE x; --'",
  "SELECT '\\''; DROP TABLE x; --'",
  "SELECT $$ ' $$; DROP TABLE x; --'",
  "SELECT $a$ ' $a$; DROP TABLE x; --'",
];
const A15_HIDDEN: Run[] = [];
for (const [i, sql] of SQL_HIDDEN.entries()) A15_HIDDEN.push(await run({}, [[call(`h${i}`, exposed('ckan_datastore_search_sql'), { server_url: PORTAL, sql })]]));

const A16 = await run({}, [[
  call('r1', exposed('ckan_datastore_search'), { server_url: PORTAL, resource_id: 'abc-123', limit: 1 }),
  call('r2', exposed('ckan_package_search'), { server_url: OTHER_PORTAL, q: 'potholes' }),
]]);

// --- A13: offered through the gate, with the variable set; and nothing of it with the variable unset ---------------

const PACK_TOOLS = PACK.toolNames.map(exposed);
const OPENCONTEXT_BLOCK_HEAD = '# Boston OpenContext server instructions';
/** The pack's guidance block as the composer writes it: in the aliased view, which rewrites the tool names. */
const PACK_BLOCK = await PACK.guidance.fetchText(
  { portal: undefined, publicationHost: '', fetchPrompt: async () => { throw new Error('fixture: no prompt'); }, fetchInstructions: async () => undefined } as never,
  router.civicRouter.aliasedView as never,
);

/** What a run the gate admits under `states` is offered and composed, and the statement the gate read. */
async function offeredThroughTheGate(states: States) {
  const decision = await decide(states);
  const configured = readMcpEnvFromProcess();
  const names = offeredMcpTools(mcpToolsFor(undefined), configured, decision.selection).flatMap((t) => (t.type === 'function' ? [t.function.name] : []));
  const composed = await composeSystemPrompt({ configured, selection: decision.selection, now: NOW });
  const rows = (decision.statement.sources as Array<{ sourceId: string; host?: string; recipients: Array<{ host?: string; keptBy?: unknown }> }>)
    .filter((row) => row.sourceId === BASE.sourceId || row.sourceId === PACK.sourceId);
  return { decision, configured, names, prompt: composed.prompt, rows };
}

test('A13: through the gate, with CKAN_MCP_URL set and OpenContext unset, the pack\'s six tools are offered under `boston`, its block is composed, and the statement has the two rows at the hosted server\'s host with one holder set', async () => {
  assert.equal(PACK_TOOLS.length, 6, 'premise: the pack has six tools');
  assert.ok(PACK_BLOCK.length > 0 && PACK_BLOCK.includes(exposed('ckan_datastore_search_sql')), 'premise: the pack\'s block names its tools in the aliased view');
  const run = await offeredThroughTheGate({});
  assert.deepEqual(run.names.filter((n) => n.startsWith(`${PACK.alias}__`)), PACK_TOOLS, 'the pack\'s six tools are not offered under its alias');
  assert.deepEqual(run.names.filter((n) => n.startsWith('boston_opencontext__') || n.startsWith(`${BASE.alias}__`)), [], 'an OpenContext tool or a tool of the base is offered');
  assert.ok(run.prompt.includes(PACK_BLOCK), 'the composed prompt does not carry the pack\'s guidance block');
  assert.ok(!run.prompt.includes(OPENCONTEXT_BLOCK_HEAD), 'the composed prompt carries the OpenContext block');
  assert.deepEqual(
    run.rows.map((row) => ({ sourceId: row.sourceId, hosts: row.recipients.map((r) => r.host) })),
    [{ sourceId: BASE.sourceId, hosts: [CKAN_HOST] }, { sourceId: PACK.sourceId, hosts: [CKAN_HOST] }],
    'the statement does not have one row each for the server and the pack, each with one recipient at the hosted server\'s host',
  );
  assert.deepEqual(run.rows[0].recipients[0].keptBy, run.rows[1].recipients[0].keptBy, 'the server\'s and the pack\'s rows name different holder sets');
});

test('A13 (unset): with CKAN_MCP_URL unset, no CKAN tool, no block and no CKAN row, and a pack call anyway is refused per call naming CKAN_MCP_URL', async () => {
  delete process.env.CKAN_MCP_URL;
  try {
    const run = await offeredThroughTheGate({});
    assert.ok(run.names.length > 0, 'premise: the run is offered tools');
    assert.deepEqual(run.names.filter((n) => n.startsWith(`${PACK.alias}__`) || n.startsWith(`${BASE.alias}__`) || n.startsWith('ckan_')), []);
    assert.ok(!run.prompt.includes(PACK_BLOCK), 'the composed prompt carries the pack\'s block');
    assert.deepEqual(run.rows, []);
    for (const name of [exposed('ckan_package_search'), 'ckan_package_search']) {
      assert.throws(() => routeToolCall(buildMcpRegistry(run.configured, run.decision.selection), name), (error: unknown) => error instanceof Error && error.message.includes('CKAN_MCP_URL'), name);
    }
  } finally {
    process.env.CKAN_MCP_URL = CKAN_URL;
  }
});

// --- A-C1: the CKAN rows' holders are the CKAN portal's, never Socrata's platform's ------------------------------

/** DRAFT, form (i) (the seat's 6929687010 withdrew form (ii)): the City's line, as Boston OpenContext's manifest states the
 *  City's statement, read 2026-11-16. The owner rules form (i) or form (iii) (this line, then a second for the portal's
 *  platform vendor); the lines live in one place in `../flows/statement.ts`, which may return one line or two. */
const CKAN_PORTAL_OPERATOR_DRAFT = [{
  holder: 'City of Boston',
  keeps: 'metadata',
  retention: "Under the City's records retention schedule; the statement gives no period for server logs.",
  statementUrl: 'https://www.boston.gov/government/cabinets/innovation-and-technology/terms-use-and-privacy-policy-city-boston-digital',
  readOn: '2026-11-16',
}];

test('A-C1: with CKAN_MCP_URL set, neither CKAN row names Tyler Technologies or links its statement, each states the CKAN portal\'s posture, and the Socrata and City Record rows read as with the variable unset', async () => {
  const set = await buildFlowsStatement();
  const rows = (set.sources as Array<{ sourceId: string; recipients: Array<{ keptBy?: Array<Record<string, unknown>> }> }>)
    .filter((row) => row.sourceId === BASE.sourceId || row.sourceId === PACK.sourceId);
  assert.deepEqual(rows.map((row) => row.sourceId), [BASE.sourceId, PACK.sourceId], 'the statement does not have the two CKAN rows');
  for (const row of rows) {
    const text = JSON.stringify(row);
    assert.ok(!text.includes('Tyler Technologies') && !text.includes('tylertech.com'), `${row.sourceId}'s row names Tyler Technologies or links its statement`);
    assert.deepEqual(row.recipients.map((r) => r.keptBy), [[{ holder: `the operator of ${CKAN_HOST}`, keeps: 'operator-states' }, ...CKAN_PORTAL_OPERATOR_DRAFT]], `${row.sourceId}'s holders are not the hosted server's operator and the CKAN portal's`);
  }
  delete process.env.CKAN_MCP_URL;
  let unset: Array<{ sourceId: string }>;
  try {
    unset = (await buildFlowsStatement()).sources;
  } finally {
    process.env.CKAN_MCP_URL = CKAN_URL;
  }
  for (const id of ['socrata', 'nyc-record']) {
    const withCkan = (set.sources as Array<{ sourceId: string }>).find((row) => row.sourceId === id);
    assert.ok(withCkan && JSON.stringify(withCkan).includes('Tyler Technologies'), `premise: ${id}'s row still names the Socrata platform's operator`);
    assert.equal(JSON.stringify(withCkan), JSON.stringify(unset.find((row) => row.sourceId === id)), `${id}'s row moved with CKAN_MCP_URL set`);
  }
});

// --- A13b: the base Off, the pack On ------------------------------------------------------------------------------


test('A13b: with the base Off and the pack On, the pack\'s call is answered by the base\'s server; the record\'s pack row reads selected, its base row reader-off', () => {
  assert.deepEqual(sentCalls(A13B).map((s) => [s.tool, s.args?.server_url]), [['ckan_package_search', PORTAL]], `the hosted server did not answer the pack's call: ${JSON.stringify(A13B.calls.map(failureOf))}`);
  const reason = Object.fromEntries((A13B.sourcesOffered as Array<{ sourceId: string; reason: string }>).map((row) => [row.sourceId, row.reason]));
  assert.deepEqual({ pack: reason['boston-ckan'], base: reason['ckan-server'] }, { pack: 'selected', base: 'reader-off' });
});

// --- A13c: the pack Off, its variable set --------------------------------------------------------------------------

test('A13c: with CKAN_MCP_URL set, the base On and the pack Off, a pack call in either spelling is refused not_offered, never not_configured; unset, the same call reads not_configured', async () => {
  const refusals = async (): Promise<Array<string | null>> => {
    const decision = await decide({ 'ckan-server': 'on', 'boston-ckan': 'off' });
    const registry = buildMcpRegistry(readMcpEnvFromProcess(), decision.selection);
    const model = await startScriptedModelServer([{ toolCalls: [call('c1', exposed('ckan_package_search'), { server_url: PORTAL }), call('c2', 'ckan_package_search', { server_url: PORTAL })] }, { content: 'An answer.' }]);
    process.env.MODEL_API_BASE_URL = model.url;
    _resetDefaultModelClientForTests();
    try {
      const calls = (await runToolLoop({
        client: getModelClient(),
        endpointModel: 'fake/model',
        requestSettings: undefined,
        prompt: 'Boston, with the pack Off.',
        tools: [],
        executeToolCall: async (name: string) => { routeToolCall(registry, name); return 'fixture answer, nothing sent'; },
        // The target the dispatch sends each call to, as every route supplies it (`compareLoopOptions`): a name it
        // refuses has none, so nothing is read from the base for it.
        dispatchTarget: (name: string) => dispatchTargetOf(name, readMcpEnvFromProcess(), decision.selection),
      })).toolCalls;
      return calls.map((c) => c.failureKind ?? null);
    } finally {
      await new Promise((resolve) => model.server.close(resolve));
      _resetDefaultModelClientForTests();
    }
  };
  const before = seen.length;
  assert.deepEqual(await refusals(), ['not_offered', 'not_offered'], 'the aliased and the bare spelling are not refused not_offered with the variable set');
  delete process.env.CKAN_MCP_URL;
  try {
    assert.deepEqual(await refusals(), ['not_configured', 'not_configured'], 'with the variable unset the call no longer reads not_configured');
  } finally {
    process.env.CKAN_MCP_URL = CKAN_URL;
  }
  assert.equal(seen.length, before, 'a refused call reached the hosted server');
  assert.equal(classifyStreamError({ code: 'not_offered' }), 'not_offered');
});

// --- A14: the portal lock, call-time -------------------------------------------------------------------------------


test('A14: a pack call naming another portal is refused before any request and recorded rejected; the pack\'s portal in another case or with a trailing slash is sent', () => {
  assert.deepEqual(
    sentCalls(A14_SENT).map((s) => [s.tool, s.args?.server_url]),
    [['ckan_package_search', 'HTTPS://Data.Boston.GOV'], ['ckan_package_show', `${PORTAL}/`]],
    `the calls naming the pack's portal were not sent: ${JSON.stringify(A14_SENT.calls.map(failureOf))}`,
  );
  assert.deepEqual(A14_OTHER.seen, [], 'the hosted server received a request in the run whose only call names another portal');
  assert.equal(A14_OTHER.calls.length, 1);
  const refused = failureOf(A14_OTHER.calls[0]);
  assert.equal(refused.failed, true, 'the call naming another portal is not recorded rejected');
  // The kind City Record's filter records for a call outside its pack's values (`unknown`, `pack-filter.ts`), and the
  // model told why by the error's type: the pack's portal refusal.
  assert.equal(refused.failureKind, 'unknown', `the call naming another portal is not recorded as a pack filter's refusal: ${refused.failureKind}`);
  const name = exposed('ckan_package_search');
  const filter = packFilterModule.packFilterOf(name);
  assert.ok(filter, `premise: ${name} has a pack filter`);
  assert.equal(A14_OTHER.told.get('p1'), describeToolFailureForLlm(name, new packFilterModule.PackFilterRefusedError(filter as never)), 'the model is not told the call names a portal its pack does not read');
  assert.equal(attr(A14_OTHER.spans[0], 'mcp.pack_id'), PACK.id, 'the refused call does not name its pack');
  assert.equal(JSON.parse(String(attr(A14_OTHER.spans[0], 'tool.arguments'))).server_url, OTHER_PORTAL, 'the record does not state the portal the call named');
});

// --- A15: the SELECT-only check ---------------------------------------------------------------------------------


test('A15: ckan_datastore_search_sql sends one statement beginning with SELECT or WITH and refuses the rest before they are sent, as its own sql description states', () => {
  const sentSql = sentCalls(A15).map((s) => s.args?.sql);
  assert.deepEqual(sentSql, SQL_SENT, `the statements that begin with SELECT or WITH were not sent: ${JSON.stringify(A15.calls.map(failureOf))}`);
  for (const sql of SQL_REFUSED) {
    const record = A15.calls.find((c) => c.args.sql === sql);
    assert.ok(record, `premise: the call with ${sql} is recorded`);
    assert.equal(record!.failed, true, `${sql} is not recorded rejected`);
    assert.equal(record!.failureKind, 'unknown', `${sql} is not recorded as the pack's refusal: ${record!.failureKind}`);
  }
  // Each refusal has its own type and its own text: the model is told the statement was refused, not the portal.
  const name = exposed('ckan_datastore_search_sql');
  const filter = packFilterModule.packFilterOf(name);
  const Statement = packFilterModule.SqlStatementRefusedError;
  assert.ok(filter && typeof Statement === 'function', 'premise: the pack has a filter and its statement refusal a type of its own');
  const statementText = describeToolFailureForLlm(name, new Statement!(filter as never));
  const portalText = describeToolFailureForLlm(name, new packFilterModule.PackFilterRefusedError(filter as never));
  assert.notEqual(statementText, portalText, 'the statement refusal tells the model what the portal refusal tells it');
  for (const sql of SQL_REFUSED) {
    const id = `s${[...SQL_SENT, ...SQL_REFUSED].indexOf(sql)}`;
    assert.equal(A15.told.get(id), statementText, `the model is not told why ${sql} was refused`);
  }
  const offered = PACK.tools.find((t) => t.type === 'function' && t.function.name === 'ckan_datastore_search_sql');
  const description = String((offered as unknown as { function: { parameters: { properties: { sql: { description: string } } } } }).function.parameters.properties.sql.description);
  assert.match(description, /begins, after any whitespace and SQL comments, with SELECT or WITH, and no second statement follows a semicolon outside a quoted literal/, 'premise: the rule the check enforces is the one the tool states');
});

test('A15 (fix round 1): a second statement behind an escaped quote or a dollar quote is refused before anything is sent', () => {
  assert.equal(SQL_HIDDEN[0], "SELECT E'\\''; DROP TABLE x; --'", 'premise: the escape string carries a backslash before its quote');
  const name = exposed('ckan_datastore_search_sql');
  const filter = packFilterModule.packFilterOf(name);
  const Statement = packFilterModule.SqlStatementRefusedError;
  assert.ok(filter && typeof Statement === 'function', 'premise: the pack has a filter and its statement refusal a type of its own');
  for (const [i, sql] of SQL_HIDDEN.entries()) {
    const run = A15_HIDDEN[i];
    assert.deepEqual(sentCalls(run), [], `${sql} was sent`);
    assert.deepEqual(failureOf(run.calls[0]), { failed: true, failureKind: 'unknown' }, `${sql} is not recorded as the pack's refusal`);
    assert.equal(run.told.get(`h${i}`), describeToolFailureForLlm(name, new Statement!(filter as never)), `the model is not told why ${sql} was refused`);
  }
});

// --- A16: the record -------------------------------------------------------------------------------------------


function packageOf(trace: unknown, calls: ToolCallRecord[]) {
  return buildEvidencePackage({
    trace: trace as never,
    prompt: 'How many 311 requests were filed in Boston?',
    output: 'There were 42.',
    toolCalls: calls as never,
    model: 'vendor/model-fixture-1',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'Boston 311',
    summary: 'Boston 311.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
    contentProfile: 'datHere',
    extensions: { 'org.civicaitools.notebook': { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} } },
  });
}

/** A16's record assertions, over any package: the decoy runs the same function. */
function assertPackCallRecorded(pkg: ReturnType<typeof packageOf>['pkg']): void {
  const graph = (pkg.provenance as { '@graph': Array<Record<string, unknown>> })['@graph'];
  const activities = graph.filter((n) => String(n['dcterms:description'] ?? '').startsWith(`MCP tool call: ${exposed('ckan_datastore_search')}`) && n['civic:failed'] !== true);
  assert.equal(activities.length, 1, `the record does not state the answered pack call: ${activities.length}`);
  assert.equal(activities[0]['civic:sourceId'], BASE.sourceId, 'the pack call\'s activity is not attributed to the base');
  assert.equal(activities[0]['civic:serverId'], BASE.id, 'the pack call\'s activity does not state the CKAN server');
  assert.equal(activities[0]['civic:packId'], PACK.id, 'the pack call\'s activity does not name the pack');
  const sources = (pkg.dataSources ?? []) as Array<{ sourceId?: string; catalogType?: string; portalUrl?: string; accessedAt?: string }>;
  assert.deepEqual(sources.map((d) => ({ sourceId: d.sourceId, catalogType: d.catalogType, portalUrl: d.portalUrl })), [{ sourceId: BASE.sourceId, catalogType: 'ckan', portalUrl: PORTAL }], `dataSources[] is not one CKAN entry for ${PORTAL}: ${JSON.stringify(sources)}`);
  assert.equal(JSON.stringify(sources).includes('dati.gov.it'), false, 'the rejected call minted a dataSources entry');
  const composition = (pkg.extensions as Record<string, { components?: Array<{ id: string }> }>)['org.civicaitools.composition'];
  const ids = (composition?.components ?? []).map((c) => c.id);
  assert.ok(ids.includes(PACK.id) && ids.includes(BASE.id), `components[] do not carry the pack beside the base: ${JSON.stringify(ids)}`);
}

test('A16: a pack call\'s span states the base\'s source and the pack\'s id, and its record attributes the call to the base, names the pack, and carries one CKAN data source', () => {
  const answered = A16.spans.find((s) => attr(s, 'tool.name') === exposed('ckan_datastore_search'));
  assert.deepEqual(
    { source: attr(answered, 'mcp.source'), pack: attr(answered, 'mcp.pack_id'), sent: sentCalls(A16).map((s) => s.tool) },
    { source: BASE.sourceId, pack: PACK.id, sent: ['ckan_datastore_search'] },
    `the pack call's span is not the base's with the pack named: ${JSON.stringify(A16.calls.map(failureOf))}`,
  );
  const rejected = A16.calls.find((c) => c.args.server_url === OTHER_PORTAL);
  assert.equal(rejected?.failed, true, 'premise: the call naming another portal is rejected');
  assertPackCallRecorded(packageOf(A16.trace, A16.calls).pkg);
});

test('F6 (fix round 1): "Where this question went" reads the A16 record\'s answered pack call as reaching Analyze Boston, answered by the CKAN server', async () => {
  const { whereItWentFromPackage } = await import('../flows/where-it-went.ts');
  const model = whereItWentFromPackage(packageOf(A16.trace, A16.calls).pkg, null)!;
  const notReached = Object.fromEntries(model.notReached.map((r) => [r.sourceId, r.whyNotSent]));
  assert.equal(notReached[PACK.sourceId], undefined, `Analyze Boston reads as not used: ${notReached[PACK.sourceId]}`);
  const pack = (model.reached as Array<{ kind: string; sourceId?: string; answeredBy?: { sourceId: string } }>).find((r) => r.kind === 'source' && r.sourceId === PACK.sourceId);
  assert.equal(pack?.answeredBy?.sourceId, BASE.sourceId, 'the pack\'s row does not carry the base whose server answered');
  assert.ok(notReached.socrata !== undefined, 'premise: a source the run did not use still reads not used');
});

test('A16 decoy: a trace whose pack call writes the pack\'s id as mcp.source fails A16\'s record assertions by name', () => {
  const trace = JSON.parse(JSON.stringify(A16.trace)) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> };
  let rewritten = 0;
  for (const span of trace.resourceSpans[0].scopeSpans[0].spans) {
    if (span.name !== 'mcp_tool_call' || attr(span, 'tool.name') !== exposed('ckan_datastore_search')) continue;
    const at = span.attributes?.find((a) => a.key === 'mcp.source');
    if (at) { at.value = { stringValue: PACK.id }; rewritten += 1; }
  }
  assert.equal(rewritten, 1, 'premise: the decoy rewrites the answered pack call');
  const { pkg } = packageOf(trace, A16.calls);
  assert.throws(() => assertPackCallRecorded(pkg), (error: unknown) => error instanceof assert.AssertionError && /not attributed to the base/.test(error.message));
});
