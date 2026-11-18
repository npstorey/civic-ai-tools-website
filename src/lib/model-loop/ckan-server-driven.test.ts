// CKAN-2-WEB P1 (npstorey/civic-ai-tools#329): the hosted CKAN server's own seven tools (router 0.12.0), driven.
//
// WHAT IS DRIVEN. The consent gate (`consentInForce`, the gate on, the cookie store; the row store is a stub), the
// composition (`composeSystemPrompt`), the one model loop (`run-tool-loop.ts`) through `/api/compare`'s factory
// (`compareLoopOptions`), the real MCP client, the real trace builder and the real packager. The hosted CKAN server
// is a stand-in MCP server on a loopback port, set as `CKAN_MCP_URL`: it counts every request it receives, answers
// the handshake, a `tools/list` of the router's seven schemas and every `tools/call`. "Sent" is a `tools/call` it
// received; "refused before anything is sent" is a run in which it received no request of any kind.
//
// W3 (gate): the statement check holds on the server's own `ckan_datastore_search_sql`, with no pack. A call whose
// `sql` is not one statement beginning with SELECT or WITH is refused before anything is sent, recorded as a rejected
// call, and the model is told the statement was refused, not the portal. The check's named limit (website issue 789
// item 4): it does not establish that a statement only reads; a data-modifying WITH and a SELECT INTO pass it.
//
// SHAPED TO FAIL.
//   - Each refused statement runs alone in its run, so any request the stand-in receives in that run is its.
//   - One accepted SELECT runs alone in its run and must arrive exactly once: a check that refuses everything, or a
//     source that routes nothing, fails it.
//   - The PostgreSQL 16 table (`../mcp/fixtures/statement-check-postgres16.json`) is sent through the loop in one run,
//     every row a call: each row the table sends must arrive, each row it refuses must not.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
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
const STUB_PREFIX = 'file:///ckan2-web-p1-driven-stub/';
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
      if (file === null) throw new Error(`ckan2-web-p1 test hook: cannot resolve ${specifier}`);
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

// --- The hosted CKAN server: a stand-in MCP server on a loopback port that counts every request -----------------

const router = await import('@typedstandards/civic-typed-router');
const BASE = router.CIVIC_MANIFEST.find((entry) => entry.sourceId === 'ckan-server')!;
/** The seven tools as the server lists them (`tools/list`), from the router's schemas. */
const LISTED = (BASE.tools as unknown as Array<{ type: string; function: { name: string; description?: string; parameters?: unknown } }>)
  .filter((t) => t.type === 'function')
  .map((t) => ({ name: t.function.name, description: t.function.description, inputSchema: t.function.parameters }));

interface Seen { method: string; tool?: string; args?: Record<string, unknown> }
const seen: Seen[] = [];
let sessions = 0;
/** What the stand-in answers a `tools/call` with, by upstream name; set per run where a test needs another answer. */
const answerFor = (_tool: string, args: Record<string, unknown>): { status: number; body: Record<string, unknown> } =>
  String(args.server_url ?? '').toLowerCase().includes('unlisted-w2')
    ? { status: 200, body: { result: { content: [{ type: 'text', text: UNLISTED_WORDS }], isError: true } } }
    : { status: 200, body: { result: { content: [{ type: 'text', text: JSON.stringify({ success: true, result: { records: [{ count: 42 }], total: 1 } }) }] } } };

const stand = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const method = req.method ?? 'GET';
  if (method !== 'POST') { seen.push({ method: `${method} (http)` }); res.writeHead(405); res.end(); return; }
  const body = (raw ? JSON.parse(raw) : {}) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  seen.push({ method: String(body.method), ...(body.method === 'tools/call' ? { tool: body.params?.name, args: body.params?.arguments } : {}) });
  const answer = (status: number, payload: Record<string, unknown>, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, ...payload }));
  };
  if (body.id === undefined) { res.writeHead(202); res.end(); return; }
  if (body.method === 'server/discover') return answer(400, { error: { code: -32601, message: 'Method not found' } });
  if (body.method === 'initialize') {
    sessions += 1;
    return answer(200, { result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ckan-mcp-server', version: 'stand-in' } } }, { 'mcp-session-id': `ckan-${sessions}` });
  }
  if (body.method === 'tools/list') return answer(200, { result: { tools: LISTED } });
  const reply = answerFor(String(body.params?.name), body.params?.arguments ?? {});
  return answer(reply.status, reply.body);
});
await new Promise<void>((resolve) => stand.listen(0, '127.0.0.1', () => resolve()));
stand.unref();
const CKAN_HOST = `127.0.0.1:${(stand.address() as AddressInfo).port}`;
const CKAN_URL = `http://${CKAN_HOST}/mcp`;
const PORTAL = 'https://data.boston.gov';
/** W4: a second portal, named in another case and with a trailing slash; the record names it as a URL parser writes it. */
const SECOND_PORTAL = 'https://Ckan.Portal-W4.example.test/data/';
const SECOND_PORTAL_RECORDED = 'https://ckan.portal-w4.example.test/data';
/** W2: a portal outside the server's list, which no accepted call names. */
const UNLISTED_PORTAL = 'https://ckan.unlisted-w2.example.test';
/** The server's refusal of an unlisted portal, in the fork's shape at `05cd1a86` (`validateServerUrl`,
 *  `src/utils/http.ts`; the tool answers it as `isError: true`, `src/tools/datastore.ts`). */
const UNLISTED_WORDS = 'Domain "ckan.unlisted-w2.example.test" is not in the allowed list (CKAN_ALLOWED_DOMAINS).';

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1') throw new TypeError(`fetch refused by the test: ${url.hostname}`);
  return realFetch(input, init);
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
process.env.OPENROUTER_API_KEY = 'not-a-credential-ckan2-web-p1';
const { REFERENCE_IDENTITY_ENV } = await import('../evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
for (const level of ['log', 'warn'] as const) console[level] = () => {};

const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
const gate = await load('lib/sources/consent-gate.ts');
const { buildFlowsStatement } = await load('lib/flows/statement.ts');
const { CONSENT_COOKIE_NAME, encodeConsentCookie } = await load('lib/sources/consent.ts');
const { readerSourceName } = await load('lib/sources/source-name.ts');
const { startScriptedModelServer } = await import('./test-harness.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { compareLoopOptions } = await import('./compare-loop.ts');
const { _resetDefaultModelClientForTests, getModelClient } = await import('../model-client.ts');
const { buildMcpRegistry, configuredMcpServers, readMcpEnvFromProcess, routeToolCall, routedSourceId } = await import('../mcp/registry.ts');
const { composeSystemPrompt } = await import('../mcp/socrata-skill.ts');
const { mcpToolsFor, offeredMcpTools } = await import('../mcp/tools.ts');
const { SOURCE_REFUSAL_FOR_LLM, sqlStatementRefusalForLlm } = await import('../streaming.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('../evidence/trace.ts');
const { buildEvidencePackage } = await import('../evidence/packager.ts');
const { panelLeadBeforeConsent } = await load('lib/sources/copy.ts');

const exposed = (upstream: string) => `${BASE.alias}__${upstream}`;
const NOW = new Date('2026-11-18T12:00:00Z');
const SQL_TOOL = exposed('ckan_datastore_search_sql');

type States = Record<string, 'on' | 'ask-first' | 'off'>;

/** The gate's answer for a cookie carrying `states`, every other source of the statement On. */
async function decide(states: States): Promise<Mod> {
  const statement = await buildFlowsStatement();
  const versionOf = (id: string) => statement.sources.find((s: { sourceId: string }) => s.sourceId === id)?.version ?? '0'.repeat(64);
  const all: States = { ...Object.fromEntries(statement.sources.map((s: { sourceId: string }) => [s.sourceId, 'on'])), ...states };
  const value = encodeConsentCookie({
    v: 1,
    flows: statement.version,
    states: Object.fromEntries(Object.entries(all).map(([id, state]) => [id, { state, since: '2026-11-18', version: versionOf(id) }])),
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

const sentCalls = (r: Run) => r.seen.filter((s) => s.method === 'tools/call');
const failureOf = (c: ToolCallRecord) => ({ failed: c.failed === true, failureKind: c.failureKind ?? null });
/** The source's name as the model is told it, read as every refusal reads it. */
const SOURCE_NAME = readerSourceName({ sourceId: BASE.sourceId, displayName: BASE.displayName }) as string;

// --- The driven runs, all before any test is defined ------------------------------------------------------------

/** Refused: each alone in its run. The first three are the CKAN-1 pack test's; the rest a second statement behind
 *  PostgreSQL's other quoting forms and a carriage return ending a `--` comment (CKAN-1 P3 fix rounds 1 and 2). */
const SQL_REFUSED = [
  'DELETE FROM "x"',
  '/* c */ drop table x',
  'SELECT 1; DROP TABLE x',
  "SELECT E'\\''; DROP TABLE x; --'",
  "SELECT '\\''; DROP TABLE x; --'",
  "SELECT $$ ' $$; DROP TABLE x; --'",
  "SELECT $a$ ' $a$; DROP TABLE x; --'",
  'SELECT 1 -- x\r; CREATE TABLE hit_r01()',
  '-- c\rCREATE TABLE hit_r02 AS (\nSELECT 1)',
];
const W3_REFUSED: Run[] = [];
for (const [i, sql] of SQL_REFUSED.entries()) W3_REFUSED.push(await run({}, [[call(`q${i}`, SQL_TOOL, { server_url: PORTAL, sql })]]));

/** Accepted: one SELECT alone in its run. */
const ACCEPTED_SQL = 'SELECT count(*) FROM "8048697b-ad64-4bfc-b090-ee00169f2323" WHERE name = \'a;b\'';
const W3_ACCEPTED = await run({}, [[call('a1', SQL_TOOL, { server_url: PORTAL, sql: ACCEPTED_SQL })]]);

/** The PostgreSQL 16 table, every row a call, in one run. */
interface Row { id: string; label: string; sql: string; postgres: string; check: 'sent' | 'refused' }
const TABLE = JSON.parse(fs.readFileSync(path.join(SRC, 'lib', 'mcp', 'fixtures', 'statement-check-postgres16.json'), 'utf8')) as { server: string; rows: Row[] };
const W3_TABLE = await run({}, [TABLE.rows.map((row) => call(`t-${row.id}`, SQL_TOOL, { server_url: PORTAL, sql: row.sql }))]);

/** Criterion 7: a `ckan_list_resources` call carrying `check_source_portal: true`, alone in its run. */
const C7 = await run({}, [[call('c7', exposed('ckan_list_resources'), { server_url: PORTAL, id: '311-service-requests', check_source_portal: true })]]);

/** W4 and W2: two accepted calls naming two portals, then a call naming a portal the server refuses, in one run. */
const W4 = await run({}, [[
  call('w4a', exposed('ckan_datastore_search'), { server_url: PORTAL, resource_id: 'w4-resource-0001', limit: 1 }),
  call('w4b', exposed('ckan_package_search'), { server_url: SECOND_PORTAL, q: 'potholes' }),
  call('w4c', exposed('ckan_datastore_search'), { server_url: PORTAL, resource_id: 'w4-resource-0002', limit: 1 }),
  call('w2', exposed('ckan_package_search'), { server_url: UNLISTED_PORTAL, q: 'potholes' }),
]]);

// --- W3 (gate): the statement check on the server's own SQL tool ------------------------------------------------

test('W3: one SELECT on the server\'s own ckan_datastore_search_sql, alone in its run, arrives at the stand-in exactly once, and is recorded answered', () => {
  assert.deepEqual(
    sentCalls(W3_ACCEPTED).map((s) => [s.tool, s.args?.sql, s.args?.server_url]),
    [['ckan_datastore_search_sql', ACCEPTED_SQL, PORTAL]],
    `the accepted SELECT did not arrive exactly once: ${JSON.stringify(W3_ACCEPTED.calls.map(failureOf))}`,
  );
  assert.deepEqual(failureOf(W3_ACCEPTED.calls[0]), { failed: false, failureKind: null });
});

test('W3: a ckan__ckan_datastore_search_sql call whose sql is not one statement beginning with SELECT or WITH is refused before any request, recorded rejected, and the model is told the statement was refused, not the portal', () => {
  const statementText = sqlStatementRefusalForLlm({ source: SOURCE_NAME });
  assert.match(statementText, /This request's sql was not one such statement, so it was not sent\./, 'premise: the statement refusal\'s words');
  assert.doesNotMatch(statementText, /portal/i, 'premise: the statement refusal names no portal');
  for (const [i, sql] of SQL_REFUSED.entries()) {
    const r = W3_REFUSED[i];
    assert.deepEqual(r.seen, [], `${JSON.stringify(sql)}: the stand-in received a request in a run whose only call is refused`);
    assert.equal(r.calls.length, 1, `premise: ${JSON.stringify(sql)} is the run's one call`);
    assert.deepEqual(failureOf(r.calls[0]), { failed: true, failureKind: 'unknown' }, `${JSON.stringify(sql)} is not recorded as the statement check's refusal`);
    assert.equal(r.told.get(`q${i}`), statementText, `${JSON.stringify(sql)}: the model is not told the statement was refused`);
    assert.equal(r.calls[0].args.sql, sql, `${JSON.stringify(sql)}: the record does not state the statement the call carried`);
  }
});

test('W3: the PostgreSQL 16 table, driven through the server-tool path in one run: every row the table sends arrives once, no row it refuses arrives', () => {
  assert.equal(TABLE.server, 'PostgreSQL 16.15', 'premise: the table');
  assert.ok(TABLE.rows.length >= 43, 'premise: the table holds its rows');
  assert.equal(W3_TABLE.calls.length, TABLE.rows.length, 'premise: every row is a call of the run');
  const arrived = sentCalls(W3_TABLE).map((s) => String(s.args?.sql));
  const wrong = TABLE.rows.flatMap((row) => {
    const times = arrived.filter((sql) => sql === row.sql).length;
    const expected = row.check === 'sent' ? 1 : 0;
    return times === expected ? [] : [`${row.id}: ${row.label}: arrived ${times}, the table says ${row.check}`];
  });
  assert.deepEqual(wrong, []);
  assert.ok(TABLE.rows.some((row) => row.check === 'sent') && TABLE.rows.some((row) => row.check === 'refused'), 'premise: the table sends some rows and refuses some');
});

// --- Criterion 7: `check_source_portal` is withheld ---------------------------------------------------------------

type OfferedTool = { type: string; function: { name: string; parameters?: { properties?: Record<string, unknown> } } };

/** What a run the gate admits under `states` is offered, stated, composed and recorded. */
async function offeredThroughTheGate(states: States) {
  const decision = await decide(states);
  const configured = readMcpEnvFromProcess();
  const tools = offeredMcpTools(mcpToolsFor(undefined), configured, decision.selection) as unknown as OfferedTool[];
  const composed = await composeSystemPrompt({ configured, selection: decision.selection, now: NOW });
  const statement = decision.statement as { sources: Array<{ sourceId: string }> };
  const sourcesOffered = decision.recordReasons(composed.sourcesOffered) as Array<{ sourceId: string; reason: string }>;
  return { decision, configured, tools, names: tools.map((t) => t.function.name), prompt: composed.prompt as string, statement, sourcesOffered };
}

test('criterion 7: the offered ckan__ckan_list_resources schema carries no check_source_portal', async () => {
  const run = await offeredThroughTheGate({});
  const listResources = run.tools.find((t) => t.function.name === exposed('ckan_list_resources'));
  assert.ok(listResources, 'premise: ckan__ckan_list_resources is offered with CKAN_MCP_URL set');
  const properties = listResources!.function.parameters?.properties ?? {};
  assert.ok(Object.hasOwn(properties, 'id') && Object.hasOwn(properties, 'format_filter'), 'premise: the schema keeps its other arguments');
  assert.equal(Object.hasOwn(properties, 'check_source_portal'), false, 'the offered schema carries check_source_portal');
});

test('criterion 7: a call carrying check_source_portal: true reaches the stand-in without it, and the record\'s arguments for the call are the ones sent', () => {
  const sent = sentCalls(C7);
  assert.equal(sent.length, 1, `premise: the call was sent once: ${JSON.stringify(C7.calls.map(failureOf))}`);
  assert.equal(Object.hasOwn(sent[0].args ?? {}, 'check_source_portal'), false, `the call forwards check_source_portal: ${JSON.stringify(sent[0].args)}`);
  assert.deepEqual(sent[0].args, { server_url: PORTAL, id: '311-service-requests' }, 'the stand-in did not receive the call\'s other arguments');
  assert.deepEqual(C7.calls[0].args, sent[0].args, 'the record\'s arguments are not the ones sent');
  const span = C7.spans.find((sp) => sp.attributes?.some((a) => a.key === 'tool.name' && a.value?.stringValue === exposed('ckan_list_resources')));
  const spanArgs = JSON.parse(String(span?.attributes?.find((a) => a.key === 'tool.arguments')?.value?.stringValue ?? 'null'));
  assert.deepEqual(spanArgs, sent[0].args, 'the span\'s arguments are not the ones sent');
});

// --- W1 and W6: offered, stated and composed through the gate, and counted once ------------------------------------

const CKAN_TOOLS = ((router as unknown as { CKAN_TOOL_NAMES?: readonly string[] }).CKAN_TOOL_NAMES ?? []).map(exposed);
/** The router's CKAN block as the composer writes it: in the aliased view, which rewrites the tool names. */
const CKAN_BLOCK = await BASE.guidance.fetchText(
  { portal: undefined, publicationHost: '', fetchPrompt: async () => { throw new Error('fixture: no prompt'); }, fetchInstructions: async () => undefined } as never,
  router.civicRouter.aliasedView as never,
);
const isCkanRow = (id: string) => id === BASE.sourceId || id.includes('ckan');

test('W1: with CKAN_MCP_URL set to a stand-in, through the gate, the seven ckan__ckan_* tools are offered and no boston__ tool; the statement has one CKAN row; the composed prompt carries the router\'s CKAN block', async () => {
  const run = await offeredThroughTheGate({});
  assert.deepEqual(run.names.filter((n) => n.startsWith('boston__')), [], 'a boston__ tool is offered');
  assert.equal(CKAN_TOOLS.length, 7, 'premise: the router names seven CKAN tools');
  assert.ok(CKAN_BLOCK.length > 0 && CKAN_BLOCK.includes(SQL_TOOL), 'premise: the CKAN block names its tools in the aliased view');
  assert.deepEqual(run.names.filter((n) => n.startsWith(`${BASE.alias}__`)), CKAN_TOOLS, 'the seven ckan__ tools are not the ones offered');
  assert.deepEqual(run.statement.sources.map((r) => r.sourceId).filter(isCkanRow), [BASE.sourceId], 'the statement does not have exactly one CKAN row');
  assert.ok(run.prompt.includes(CKAN_BLOCK), 'the composed prompt does not carry the router\'s CKAN block');
  const reasons = Object.fromEntries(run.sourcesOffered.map((r) => [r.sourceId, r.reason]));
  assert.equal(reasons[BASE.sourceId], 'selected', 'the CKAN source is not recorded selected');
  assert.equal(Object.hasOwn(reasons, 'boston-ckan'), false, 'the record lists the retired pack');
});

test('W6: with CKAN_MCP_URL set, each count counts the CKAN source once: every count reads the statement\'s rows, and the CKAN source is one of them', async () => {
  const run = await offeredThroughTheGate({});
  const ids = run.statement.sources.map((r) => r.sourceId);
  // The line under the question box (QueryForm's where-line), the panel lead (SourcesPanel, SettingsOverlay), the
  // settings search line (`sourcesShownLine`) and the picker (`pickerRows`) each count `statement.sources`' rows.
  assert.equal(ids.filter(isCkanRow).length, 1, 'the CKAN source is not one row');
  assert.equal(new Set(ids).size, ids.length, 'a source is listed twice');
  const lead = panelLeadBeforeConsent({ on: ids.length, askFirst: 0, off: 0 }) as string;
  assert.ok(lead.length > 0, 'premise: the panel lead counts the rows');
  assert.equal(ids.length, ids.filter((id) => !isCkanRow(id)).length + 1, 'the CKAN source adds more than one to every count');
});

test('W1 (unset): with CKAN_MCP_URL unset, no ckan__ tool, no CKAN row, no CKAN block; the record carries ckan-server not-configured and no boston-ckan row; a CKAN call anyway is refused naming CKAN_MCP_URL', async () => {
  delete process.env.CKAN_MCP_URL;
  try {
    const run = await offeredThroughTheGate({});
    assert.ok(run.names.length > 0, 'premise: the run is offered tools');
    const rows = run.sourcesOffered.filter((r) => isCkanRow(r.sourceId)).map((r) => `${r.sourceId}:${r.reason}`);
    assert.deepEqual(rows, [`${BASE.sourceId}:not-configured`], 'the record\'s CKAN rows are not ckan-server not-configured alone');
    assert.deepEqual(run.names.filter((n) => n.startsWith(`${BASE.alias}__`) || n.startsWith('boston__')), []);
    assert.deepEqual(run.statement.sources.map((r) => r.sourceId).filter(isCkanRow), []);
    assert.ok(CKAN_BLOCK.length > 0 && !run.prompt.includes(CKAN_BLOCK), 'the composed prompt carries the CKAN block');
    for (const name of [SQL_TOOL, 'ckan_datastore_search_sql']) {
      assert.throws(() => routeToolCall(buildMcpRegistry(run.configured, run.decision.selection), name), (error: unknown) => error instanceof Error && error.message.includes('CKAN_MCP_URL'), name);
    }
  } finally {
    process.env.CKAN_MCP_URL = CKAN_URL;
  }
});

// --- W4 and W2: the record ----------------------------------------------------------------------------------------

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

test('W4: two accepted calls naming two portals mint two ckan entries in first-seen order, each portalUrl the portal its call named, with no datasetId; the refused call\'s portal mints nothing and appears nowhere in dataSources; every CKAN call records its server_url', () => {
  assert.deepEqual(
    sentCalls(W4).map((sc) => [sc.tool, sc.args?.server_url]),
    [['ckan_datastore_search', PORTAL], ['ckan_package_search', SECOND_PORTAL], ['ckan_datastore_search', PORTAL], ['ckan_package_search', UNLISTED_PORTAL]],
    `premise: the four calls were sent in order: ${JSON.stringify(W4.calls.map(failureOf))}`,
  );
  assert.deepEqual(W4.calls.map((c) => c.failed === true), [false, false, false, true], 'premise: the first three are answered and the fourth refused');
  for (const c of W4.calls) assert.equal(typeof c.args.server_url, 'string', `${c.name} does not record its server_url`);
  const { pkg } = packageOf(W4.trace, W4.calls);
  const sources = (pkg.dataSources ?? []) as unknown as Array<Record<string, unknown>>;
  assert.deepEqual(
    sources.filter((d) => d.catalogType === 'ckan').map((d) => ({ sourceId: d.sourceId, portalUrl: d.portalUrl, datasetId: d.datasetId })),
    [{ sourceId: BASE.sourceId, portalUrl: PORTAL, datasetId: undefined }, { sourceId: BASE.sourceId, portalUrl: SECOND_PORTAL_RECORDED, datasetId: undefined }],
    `dataSources[] is not one ckan entry per portal named, in first-seen order: ${JSON.stringify(sources)}`,
  );
  assert.equal(JSON.stringify(sources).includes('unlisted-w2'), false, 'the refused call\'s portal appears in dataSources');
});

test('W2: the server\'s refusal of an unlisted portal is recorded as a rejected call, sent once; the model is told the source refused it; the server\'s words reach neither the model nor the signed package', () => {
  const refused = W4.calls[3];
  assert.deepEqual(failureOf(refused), { failed: true, failureKind: 'unknown' }, 'the server\'s refusal is not recorded as a rejected call');
  assert.equal(sentCalls(W4).filter((sc) => sc.args?.server_url === UNLISTED_PORTAL).length, 1, 'the refused call was not sent exactly once');
  assert.equal(W4.told.get('w2'), SOURCE_REFUSAL_FOR_LLM, 'the model is not told the source refused the request');
  const { pkg } = packageOf(W4.trace, W4.calls);
  assert.equal(JSON.stringify(pkg).includes('CKAN_ALLOWED_DOMAINS'), false, 'the server\'s words reached the signed package');
});
