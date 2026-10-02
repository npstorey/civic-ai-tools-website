// Sprint 238, ruling D2 — a source the instance does not configure is absent.
//
// Boston's OpenContext source is offered only when `BOSTON_OPENCONTEXT_MCP_URL`
// is set; its coded default went. This file drives the unset case, which is the
// reference deployment's, and asserts four things:
//
//   (1) UNSET MEANS ABSENT. The routing registry holds no `boston-opencontext`
//       server and no `ckan__` tool; the tools the query and compare runs offer
//       the model carry no `ckan__` tool; the prompt those runs send
//       (`buildSystemPrompt`, and `withPortalLockGuidance` under the lock)
//       carries none of `Boston OpenContext`, `ckan__` or `data-mcp.boston.gov`;
//       and the configured-servers list a record states names no Boston entry.
//   (2) NOTHING IS SENT. Every outbound `fetch` of the whole file is recorded,
//       and none goes anywhere but the loopback fixtures.
//   (4) A STRAY CALL IS REFUSED PER CALL. The fixture model calls
//       `ckan__search_datasets` although it was not offered — as a model naming
//       a tool it saw elsewhere, or a replayed Boston record, would. The call is
//       refused with no request sent and recorded as ONE failed call
//       (`failureKind: 'not_configured'`), and the run goes on to answer.
//
// (Criterion 3, "set means today", is shown by a script run at the base and at
// the head and diffed; see the phase report.)
//
// WHAT IS DRIVEN. The three REAL query route handlers — `/api/query-notebook`
// (unlocked and locked), `/api/compare-stream` and `/api/compare` — through
// the real loop core, the real MCP client and the real prompt composer, as in
// `logs-carry-no-reader-content.test.ts`: `module.registerHooks()` in-file
// resolves the `@/` alias and stubs the four modules that need a request scope,
// a sign-in provider or a sandbox. The model is a loopback server that answers
// by what it is asked; the Socrata and Data Commons sources are one loopback
// MCP server on two paths. Beside the drives, the library calls the routes make
// are asserted directly, so a failure names the layer.
//
// WHAT MAKES EACH ASSERTION ABLE TO FAIL. At the base (b38556f) the registry
// substitutes `https://data-mcp.boston.gov/mcp` for the unset variable, so:
// the registry and the record's server list carry Boston; every offered tool
// list carries the six `ckan__` tools; the preamble, outro and lock section
// name Boston OpenContext; composing the prompt calls that server's
// `initialize` — the recorder sees the attempt, which it refuses without a
// network, so nothing leaves this machine even at the base; and the stray call
// is routed there and recorded `unavailable`, not `not_configured`. Each
// premise assertion below states what the instrument must see for its partner
// to mean anything: the recorder sees the fixtures' own traffic, the model is
// offered `get_data`, the stray call is on the record.
//
// No live endpoint, no credential: every key is a placeholder and every
// address is loopback.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/an-unconfigured-source-is-absent.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `module.registerHooks()` is Node 22.15+ but not in the pinned `@types/node`;
// declared locally, as in `logs-carry-no-reader-content.test.ts`.
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
const SRC = path.resolve(HERE, '..');

/** The three strings no part of an unset instance's run may carry. */
const NEEDLES = ['Boston OpenContext', 'ckan__', 'data-mcp.boston.gov'] as const;
const STRAY_TOOL = 'ckan__search_datasets';
const PORTAL = 'data.example.org';
const QUESTION = 'How many noise complaints were filed last year?';
const ANSWER = 'One figure was retrieved.';

// --- The outbound recorder, installed before any app module loads ------------
//
// Every `fetch` of this process is recorded. A loopback request goes through;
// any other is refused as a network failure WITHOUT being sent, so the attempt
// is visible and nothing leaves this machine even where the code under test
// makes one.

const realFetch = globalThis.fetch;
const OUTBOUND: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  OUTBOUND.push(`${url.host}${url.pathname}`);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

// --- Module hooks: the `@/` alias, and four stubs ------------------------------

const STUB_PREFIX = 'file:///civic-238-p2-stub/';
const DRIVER_URL = pathToFileURL(path.join(SRC, 'lib/sandbox/driver.ts')).href;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.38' }); }`,
  'next-auth': `export async function getServerSession() { return null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  // The real error class; an executor that creates nothing. Phase A — the
  // model loop, which is what this file measures — has finished by then.
  '@/lib/sandbox': `
     import { NotebookExecutionError } from ${JSON.stringify(DRIVER_URL)};
     export { NotebookExecutionError };
     export async function executeNotebook() {
       throw new NotebookExecutionError('fixture executor: no sandbox in this test', { exitCode: 1, stderr: '' });
     }`,
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
        } catch { /* next extension */ }
      }
      throw new Error(`238 P2 test hook: cannot resolve ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(url.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// --- The loopback MCP sources: Socrata on /socrata/mcp, Data Commons on /dc/mcp

const ONE_ROW = JSON.stringify({ data: [{ count: '4812' }], total_rows: 1 });
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-238-p2' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-238-p2-fixture', version: '0' }, instructions: 'Fixture server instructions.' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (msg.method === 'prompts/get') {
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Fixture skill guidance.' } }] } })}\n\n`);
    return;
  }
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: ONE_ROW }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

// --- The loopback model: answers by what it is asked -------------------------
//
// A request that offers tools and carries no tool result yet is answered with
// two calls: a `get_data` (the premise that the loop ran) and the stray
// `ckan__search_datasets`. Anything else — the answering turn, the no-MCP
// half of a comparison, the notebook's later model turns — gets a plain answer.

const MODEL_REQUESTS: Array<Record<string, unknown>> = [];
const model = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    MODEL_REQUESTS.push(body);
    const messages = (body.messages ?? []) as Array<{ role?: string }>;
    const pickTools = Array.isArray(body.tools) && body.tools.length > 0 && !messages.some((m) => m.role === 'tool');
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (body.stream === true) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (payload: Record<string, unknown>) =>
        `data: ${JSON.stringify({ id: 'chatcmpl-238-p2', object: 'chat.completion.chunk', created: 1, model: 'fake/model', ...payload })}\n\n`;
      res.write(frame({ choices: [{ index: 0, delta: { content: ANSWER }, finish_reason: null }] }));
      res.write(frame({ choices: [], usage }));
      res.end('data: [DONE]\n\n');
      return;
    }
    const toolCalls = [
      { id: 'call-get-data', type: 'function', function: { name: 'get_data', arguments: JSON.stringify({ type: 'query', dataset_id: 'aaaa-1111', limit: 1 }) } },
      { id: 'call-stray', type: 'function', function: { name: STRAY_TOOL, arguments: JSON.stringify({ query: 'noise complaints' }) } },
    ];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-238-p2',
      object: 'chat.completion',
      created: 1,
      model: 'fake/model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: pickTools ? null : ANSWER, ...(pickTools ? { tool_calls: toolCalls } : {}) },
        finish_reason: pickTools ? 'tool_calls' : 'stop',
      }],
      usage,
    }));
  });
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
model.unref();
const MODEL_ORIGIN = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;

// --- Environment, set before any app module loads -----------------------------

for (const name of [
  'BOSTON_OPENCONTEXT_MCP_URL',
  'DATA_COMMONS_API_KEY',
  'SITE_PORTAL_LOCKED',
  'SITE_DEFAULT_PORTAL',
  'MODEL_API_KEY',
  'OPENAI_API_KEY',
  'MODEL_API_KIND',
  'MODEL_API_AUTH',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
]) {
  delete process.env[name];
}
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.OPENROUTER_API_KEY = 'placeholder-model-key-238-p2';
process.env.MODEL_API_BASE_URL = `${MODEL_ORIGIN}/v1`;
process.env.MODEL_CATALOG = JSON.stringify([
  {
    id: 'fixture-fast',
    name: 'Fixture Model',
    provider: 'Example Provider',
    supports_tools: true,
    endpointModel: 'example-fixture-deployment',
    model: 'vendor/model-fixture-1',
    default: true,
    evaluator: 1,
  },
]);

const { buildMcpRegistry, configuredMcpServers, readMcpEnvFromProcess } = await import('./mcp/registry.ts');
const { buildSystemPrompt, withPortalLockGuidance } = await import('./mcp/socrata-skill.ts');
const { compareLoopOptions } = await import('./model-loop/compare-loop.ts');
const { createModelClient, _resetDefaultModelClientForTests } = await import('./model-client.ts');
_resetDefaultModelClientForTests();

// --- The library calls the routes make ----------------------------------------

const REGISTRY = buildMcpRegistry(readMcpEnvFromProcess());
const SERVERS = configuredMcpServers(readMcpEnvFromProcess());
const COMPARE_TOOLS = (lockedPortal: string | undefined) =>
  compareLoopOptions({
    client: createModelClient({ apiKey: 'placeholder-model-key-238-p2' }),
    endpointModel: 'example-fixture-deployment',
    requestSettings: undefined,
    prompt: QUESTION,
    systemPrompt: 'fixture',
    portal: PORTAL,
    lockedPortal,
  }).tools;
const PROMPT = await buildSystemPrompt(PORTAL);
const LOCKED_PROMPT = withPortalLockGuidance(await buildSystemPrompt(PORTAL), PORTAL);

// --- The route drives -----------------------------------------------------------

interface Drive { name: string; status: number; body: string; requests: Array<Record<string, unknown>> }

async function drive(name: string, run: () => Promise<Response>): Promise<Drive> {
  const from = MODEL_REQUESTS.length;
  const response = await run();
  const body = await response.text();
  return { name, status: response.status, body, requests: MODEL_REQUESTS.slice(from) };
}

const post = (route: string, body: unknown) =>
  new Request(`http://localhost${route}`, { method: 'POST', body: JSON.stringify(body) }) as never;

const notebookRoute = await import('../app/api/query-notebook/route.ts');
const compareStreamRoute = await import('../app/api/compare-stream/route.ts');
const compareRoute = await import('../app/api/compare/route.ts');

const DRIVES: Drive[] = [];
DRIVES.push(await drive('/api/query-notebook', () => notebookRoute.POST(post('/api/query-notebook', { query: QUESTION, portal: PORTAL }))));
DRIVES.push(await drive('/api/compare-stream', () => compareStreamRoute.POST(post('/api/compare-stream', { query: QUESTION, model: 'fixture-fast', portal: PORTAL, mcpOnly: true }))));
DRIVES.push(await drive('/api/compare', () => compareRoute.POST(post('/api/compare', { query: QUESTION, model: 'fixture-fast', portal: PORTAL }))));
process.env.SITE_PORTAL_LOCKED = '1';
process.env.SITE_DEFAULT_PORTAL = PORTAL;
const LOCKED_DRIVE = await drive('/api/query-notebook (locked)', () => notebookRoute.POST(post('/api/query-notebook', { query: QUESTION })));
DRIVES.push(LOCKED_DRIVE);
delete process.env.SITE_PORTAL_LOCKED;
delete process.env.SITE_DEFAULT_PORTAL;

// --- Readers -------------------------------------------------------------------

type Tool = { type?: string; function?: { name?: string } };
const toolNames = (tools: unknown): string[] =>
  ((tools ?? []) as Tool[]).map((t) => t.function?.name ?? String(t.type));

/** The model requests of a drive that offered tools: the MCP half's turns. */
function mcpRequests(d: Drive): Array<Record<string, unknown>> {
  const offered = d.requests.filter((r) => Array.isArray(r.tools) && r.tools.length > 0);
  assert.ok(offered.length > 0, `${d.name}: premise — no model request offered any tool (status ${d.status}): ${d.body.slice(0, 400)}`);
  return offered;
}

function systemText(request: Record<string, unknown>): string {
  const messages = (request.messages ?? []) as Array<{ role?: string; content?: unknown }>;
  const system = messages.find((m) => m.role === 'system');
  assert.ok(system, 'premise — the MCP request carries no system message');
  return typeof system!.content === 'string' ? system!.content : JSON.stringify(system!.content);
}

/** Every object in the drive's response body (SSE `data:` lines, or one JSON body). */
function responseObjects(d: Drive): unknown[] {
  const docs: unknown[] = [];
  const lines = d.body.split('\n').filter((l) => l.startsWith('data: '));
  if (lines.length > 0) {
    for (const line of lines) {
      try { docs.push(JSON.parse(line.slice('data: '.length))); } catch { /* keep-alive or partial */ }
    }
  } else {
    try { docs.push(JSON.parse(d.body)); } catch { /* not JSON */ }
  }
  const out: unknown[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v !== null && typeof v === 'object') {
      out.push(v);
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  docs.forEach(walk);
  return out;
}

/** The recorded calls to `name` in a drive's response: records, events, entries. */
function callsNamed(d: Drive, name: string): Array<Record<string, unknown>> {
  return responseObjects(d).filter(
    (o): o is Record<string, unknown> => (o as Record<string, unknown>).name === name && ('args' in (o as object) || 'failed' in (o as object) || 'operationType' in (o as object)),
  );
}

function assertNoNeedle(text: string, where: string): void {
  for (const needle of NEEDLES) {
    assert.ok(!text.includes(needle), `${where} carries "${needle}":\n…${text.slice(Math.max(0, text.indexOf(needle) - 200), text.indexOf(needle) + 200)}…`);
  }
}

// --- (1) Unset means absent ------------------------------------------------------

test('(1) the routing registry holds no boston-opencontext server and no ckan__ tool', () => {
  assert.ok(REGISTRY.servers['data-commons'], 'premise: the registry was built');
  assert.equal(REGISTRY.servers['boston-opencontext'], undefined, 'the registry built a Boston server with the variable unset');
  const ckan = Object.keys(REGISTRY.toolIndex).filter((name) => name.startsWith('ckan__'));
  assert.deepEqual(ckan, [], 'toolIndex routes ckan__ tools with the variable unset');
});

test('(1) the configured-servers list a record states names no Boston entry', () => {
  assert.deepEqual(SERVERS.map((s) => s.name), ['socrata', 'data-commons']);
  assertNoNeedle(JSON.stringify(SERVERS), 'configuredMcpServers');
});

test('(1) the compare factory offers no ckan__ tool, locked or unlocked', () => {
  for (const locked of [undefined, PORTAL]) {
    const names = toolNames(COMPARE_TOOLS(locked));
    assert.ok(names.includes('get_data'), `premise: the compare factory offers get_data (lock ${String(locked)})`);
    assert.deepEqual(names.filter((n) => n.startsWith('ckan__')), [], `the compare factory offers ckan__ tools (lock ${String(locked)})`);
  }
});

test('(1) the composed prompt, unlocked and under the lock, names none of the Boston source\'s text', () => {
  assert.match(PROMPT, /Tools: get_data\./, 'premise: the preamble was composed');
  assertNoNeedle(PROMPT, 'buildSystemPrompt');
  assert.match(LOCKED_PROMPT, /## ONE SOCRATA PORTAL ONLY/, 'premise: the lock section was appended');
  assertNoNeedle(LOCKED_PROMPT, 'withPortalLockGuidance(buildSystemPrompt)');
});

test('(1) each query route offers the model no ckan__ tool and sends it none of the Boston source\'s text', () => {
  assert.equal(DRIVES.length, 4);
  for (const d of DRIVES) {
    for (const request of mcpRequests(d)) {
      const names = toolNames(request.tools);
      assert.ok(names.includes('get_data'), `${d.name}: premise — the MCP half was not offered get_data`);
      assert.deepEqual(names.filter((n) => n.startsWith('ckan__')), [], `${d.name}: the model was offered ckan__ tools`);
      assertNoNeedle(JSON.stringify(request.tools), `${d.name}: the offered tool schemas`);
      assertNoNeedle(systemText(request), `${d.name}: the system prompt`);
    }
  }
  assert.match(systemText(mcpRequests(LOCKED_DRIVE)[0]), /## ONE SOCRATA PORTAL ONLY/, 'premise: the locked drive ran locked');
});

// --- (2) Nothing is sent ---------------------------------------------------------

test('(2) every outbound request of the whole file went to a loopback fixture — none to the Boston source', () => {
  const mcpHost = new URL(MCP_ORIGIN).host;
  const modelHost = new URL(MODEL_ORIGIN).host;
  // The recorder sees traffic: both fixture sources and the model.
  assert.ok(OUTBOUND.includes(`${mcpHost}/socrata/mcp`), `premise: the recorder never saw the Socrata fixture:\n${OUTBOUND.join('\n')}`);
  assert.ok(OUTBOUND.includes(`${mcpHost}/dc/mcp`), `premise: the recorder never saw the Data Commons fixture:\n${OUTBOUND.join('\n')}`);
  assert.ok(OUTBOUND.some((u) => u.startsWith(`${modelHost}/`)), `premise: the recorder never saw the model:\n${OUTBOUND.join('\n')}`);
  const elsewhere = OUTBOUND.filter((u) => !u.startsWith(`${mcpHost}/`) && !u.startsWith(`${modelHost}/`));
  assert.deepEqual(elsewhere, [], 'a request was attempted to a host other than the fixtures');
});

// --- (4) A stray call is refused per call -----------------------------------------

test('(4) a ckan__ call the model makes anyway is one failed call, not_configured, and the run still answers', () => {
  for (const d of DRIVES) {
    const answered = callsNamed(d, 'get_data');
    assert.ok(answered.length > 0, `${d.name}: premise — the get_data call is not on the record (status ${d.status}):\n${d.body.slice(0, 600)}`);
    for (const c of answered) assert.notEqual(c.failed, true, `${d.name}: premise — get_data failed`);
    const stray = callsNamed(d, STRAY_TOOL);
    assert.ok(stray.length > 0, `${d.name}: the stray ${STRAY_TOOL} call is not on the record — the run did not survive it:\n${d.body.slice(-800)}`);
    for (const c of stray) {
      assert.equal(c.failed, true, `${d.name}: the stray call is recorded as answered`);
      assert.equal(c.failureKind, 'not_configured', `${d.name}: the stray call's failure kind`);
    }
    assert.ok(
      d.requests.some((r) => ((r.messages ?? []) as Array<{ role?: string; tool_call_id?: string }>).some((m) => m.role === 'tool' && m.tool_call_id === 'call-stray')),
      `${d.name}: the model was never told the stray call's outcome — the loop did not continue past it`,
    );
  }
});
