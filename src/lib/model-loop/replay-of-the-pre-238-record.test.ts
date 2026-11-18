// CKAN-1 P3 (npstorey/civic-ai-tools#314), stage R, criterion A19 (ruling D4 = A): the published Boston record made
// before sprint 238 replays under its own rules. Its calls name Boston OpenContext's tools bare
// (`ckan__search_datasets` and the rest); OpenContext is not configured here and the hosted CKAN server is.
//
// THE RECORD is the published package itself (`../flows/fixtures/record-b8cc28.package.json`, read from production on
// 2026-11-16, unchanged). It states no offered set, so a replay with the replayer's selection is the narrowed path.
//
// WHAT IS DRIVEN. `replayLoopOptionsForPackage` with its production defaults and a `replayerSelection` as the replay
// route passes it (the replayer's configured sources that are On), into the real loop core and the real MCP client,
// against a scripted loopback model that re-issues the record's five calls in one turn. The hosted CKAN server is a
// fetch recorder at `https://ckan.example.test/mcp`; every other host but the loopback model is refused unsent.
//
// RED AT STAGE L (`a9f092b`): the website reads no `CKAN_MCP_URL`, so the pack is not offered with the replayer's
// pack On; and each refusal tells the model "no data can be retrieved", naming no variable (A18's text).
//
// SHAPED TO FAIL. The pack On and the pack Off are two replays of the same record that differ in the selection alone,
// so an offered set read from anything but the selection fails one of them. The record's five names are bare
// OpenContext names: a replay that translated them would send `tools/call`s the recorder sees, and record names the
// record did not state.
//
// CKAN-2-WEB P1 (router 0.12.0): the pack is retired, and the CKAN server offers seven tools of its own under the
// alias `ckan`. The two replays are the server On and Off. OpenContext's bare names begin `ckan__`, the server's
// alias and separator, so a reading that split the name would send `ckan__search_datasets` to the server: the
// recorder must still see nothing, with the server On.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CKAN_HOST = 'ckan.example.test';
const realFetch = globalThis.fetch;
const OUTBOUND: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  OUTBOUND.push(`${url.host}${url.pathname}`);
  throw new TypeError('fetch failed');
}) as typeof fetch;

for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'SOURCE_ROUTING']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.example.test/mcp';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.example.test/mcp';
process.env.CKAN_MCP_URL = `https://${CKAN_HOST}/mcp`;
for (const level of ['log', 'warn'] as const) console[level] = () => {};

const { startScriptedModelServer } = await import('./test-harness.ts');
const { replayLoopOptionsForPackage } = await import('./replay-loop.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { createModelClient } = await import('../model-client.ts');
const { CIVIC_MANIFEST } = await import('@typedstandards/civic-typed-router');

const RECORD = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'flows', 'fixtures', 'record-b8cc28.package.json'), 'utf8')) as {
  queries: Array<{ tool: string; arguments: Record<string, unknown> }>;
  dataSources: unknown[];
  extensions?: Record<string, unknown>;
};
const RECORD_CALLS = RECORD.queries.map((q, i) => ({ id: `b8-${i + 1}`, name: q.tool, args: q.arguments }));
/** The CKAN server's seven, as the model is offered them (router 0.12.0). */
const PACK = CIVIC_MANIFEST.find((entry) => entry.sourceId === 'ckan-server')!;
const PACK_TOOLS = PACK.toolNames.map((tool) => `${PACK.alias}__${tool}`);
/** Boston OpenContext's tools, by either spelling the model could be offered them. */
const OPENCONTEXT = CIVIC_MANIFEST.find((entry) => entry.sourceId === 'boston-opencontext')!;
const OPENCONTEXT_TOOLS = new Set([...OPENCONTEXT.toolNames, ...OPENCONTEXT.toolNames.map((tool) => `${OPENCONTEXT.alias}__${tool}`)]);

/** One replay of the record under `replayerSelection`. */
async function replay(replayerSelection: string[]) {
  const from = OUTBOUND.length;
  const scripted = await startScriptedModelServer([{ toolCalls: RECORD_CALLS }, { content: 'The Boston figure could not be retrieved.' }]);
  process.env.MODEL_API_BASE_URL = scripted.url;
  try {
    const options = await replayLoopOptionsForPackage({
      pkg: RECORD as never,
      client: createModelClient({ apiKey: 'not-a-credential-ckan1-p3-a19' }),
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: 'How many 311 pothole requests were filed in Dorchester in 2024?',
      replayerSelection,
    });
    const result = await runToolLoop(options);
    const offered = ((scripted.requests[0]?.tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => String(t.function?.name));
    const messages = (scripted.requests[1]?.messages ?? []) as Array<{ role?: string; tool_call_id?: string; content?: unknown }>;
    const told = RECORD_CALLS.map((c) => String(messages.find((m) => m.role === 'tool' && m.tool_call_id === c.id)?.content ?? ''));
    return { result, offered, told, outbound: OUTBOUND.slice(from) };
  } finally {
    await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
  }
}

test('A19: the pre-238 Boston record replays with no OpenContext tool, each of its five calls refused not_configured naming BOSTON_OPENCONTEXT_MCP_URL, nothing sent to the hosted server, no call translated; the CKAN server\'s seven are offered with it On and not with it Off', async () => {
  assert.deepEqual(RECORD_CALLS.map((c) => c.name), ['ckan__search_datasets', 'ckan__get_schema', 'ckan__get_dataset', 'ckan__get_schema', 'ckan__aggregate_data'], 'premise: the record\'s five calls, by their bare OpenContext names');
  const on = await replay(['socrata', 'data-commons', 'ckan-server']);
  const off = await replay(['socrata', 'data-commons']);
  assert.equal(PACK_TOOLS.length, 7, 'premise: the CKAN server offers seven tools');
  assert.deepEqual(on.offered.filter((n) => PACK_TOOLS.includes(n)), PACK_TOOLS, 'with the server On the replay is not offered its tools');
  assert.deepEqual(off.offered.filter((n) => PACK_TOOLS.includes(n)), [], 'with the server Off the replay is offered its tools');
  for (const [label, run] of [['server On', on], ['server Off', off]] as const) {
    assert.deepEqual(run.offered.filter((n) => OPENCONTEXT_TOOLS.has(n)), [], `${label}: an OpenContext tool is offered`);
    assert.deepEqual(run.result.toolCalls.map((c) => c.name), RECORD_CALLS.map((c) => c.name), `${label}: a call was translated`);
    assert.deepEqual(run.result.toolCalls.map((c) => c.failureKind), Array(5).fill('not_configured'), `${label}: a replayed call is not refused not_configured`);
    for (const told of run.told) assert.ok(told.includes('BOSTON_OPENCONTEXT_MCP_URL'), `${label}: the model's text does not name BOSTON_OPENCONTEXT_MCP_URL:\n${told}`);
    assert.deepEqual(run.outbound.filter((u) => u.startsWith(`${CKAN_HOST}/`)), [], `${label}: a request reached the hosted CKAN server`);
  }
});
