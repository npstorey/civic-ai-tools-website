// CKAN-1 P3 (npstorey/civic-ai-tools#314), stage R, criterion A18 (website issue 539): a replayed call to a source
// this instance does not configure is refused `not_configured`, and the model is told that this source is not
// configured on this instance, naming its variable, not that "no data can be retrieved". The no-primary-source text
// stays for its own case, Socrata unset.
//
// WHAT IS DRIVEN. `replayLoopOptionsForPackage` with its production defaults into the real loop core, against a
// scripted loopback model, on both replay paths: the un-narrowed one (a record that states no offered set, replayed
// with no `replayerSelection`) and the narrowed one (a `replayerSelection`, as the replay route passes the
// replayer's consent). Every outbound fetch of the file is recorded; anything but the loopback model is refused
// unsent. The text the model reads is read from the request that followed the call.
//
// RED AT STAGE L (`a9f092b`): the refusal is `not_configured` on both paths, and the model reads "This server has
// no live data source configured, so no data can be retrieved", which names no variable.
//
// SHAPED TO FAIL. The Socrata case pins the no-primary-source text byte for byte as measured at stage L, so a fix
// that rewrites every not-configured text fails it; the OpenContext case must name its own variable, which no other
// text carries.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = globalThis.fetch;
const OUTBOUND: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === '127.0.0.1') return realFetch(input, init);
  OUTBOUND.push(`${url.host}${url.pathname}`);
  throw new TypeError('fetch failed');
}) as typeof fetch;

for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'CKAN_MCP_URL', 'DATA_COMMONS_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.example.test/mcp';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.example.test/mcp';
for (const level of ['log', 'warn'] as const) console[level] = () => {};

const { startScriptedModelServer } = await import('./test-harness.ts');
const { replayLoopOptionsForPackage } = await import('./replay-loop.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { createModelClient } = await import('../model-client.ts');
const { describeToolFailureForLlm } = await import('../streaming.ts');
const { buildMcpRegistry, routeToolCall } = await import('../mcp/registry.ts');

/** The no-primary-source text, as measured at stage L (`a9f092b`) for a Socrata call with `SOCRATA_MCP_URL` unset. */
const NO_PRIMARY_SOURCE_TEXT =
  'This data request returned no data. Do not estimate, guess, or fabricate any values to fill the gap. This server has no live data source configured, so no data can be retrieved. Suggest contacting whoever operates this instance. In your answer, briefly tell the user in plain language that the live data could not be retrieved, and do not include any raw error text, status codes, server names, or system details.';

/** One replay of a record that states no offered set, whose model re-issues a Boston OpenContext search. */
async function replayOpenContextSearch(replayerSelection: string[] | undefined) {
  const from = OUTBOUND.length;
  const scripted = await startScriptedModelServer([
    { toolCalls: [{ id: 'oc1', name: 'ckan__search_datasets', args: { query: '311 pothole requests', limit: 5 } }] },
    { content: 'The Boston figure could not be retrieved.' },
  ]);
  process.env.MODEL_API_BASE_URL = scripted.url;
  try {
    const options = await replayLoopOptionsForPackage({
      pkg: { queries: [], dataSources: [] },
      client: createModelClient({ apiKey: 'not-a-credential-ckan1-p3-a18' }),
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: 'How many 311 pothole requests were filed in Dorchester in 2024?',
      ...(replayerSelection ? { replayerSelection } : {}),
    });
    const result = await runToolLoop(options);
    const messages = (scripted.requests[1]?.messages ?? []) as Array<{ role?: string; tool_call_id?: string; content?: unknown }>;
    const told = String(messages.find((m) => m.role === 'tool' && m.tool_call_id === 'oc1')?.content ?? '');
    return { result, told, outbound: OUTBOUND.slice(from) };
  } finally {
    await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
  }
}

function assertTheSourceSaysSo(run: Awaited<ReturnType<typeof replayOpenContextSearch>>, path: string): void {
  assert.equal(run.result.toolCalls.length, 1, `${path}: premise: one replayed call`);
  assert.deepEqual({ failed: run.result.toolCalls[0].failed, failureKind: run.result.toolCalls[0].failureKind }, { failed: true, failureKind: 'not_configured' }, `${path}: the replayed call is not refused not_configured`);
  assert.ok(run.told.length > 0, `${path}: premise: the model was told something about the call`);
  assert.ok(!run.told.includes('no data can be retrieved'), `${path}: the model is told no data can be retrieved:\n${run.told}`);
  assert.match(run.told, /this source is not configured on this instance/i, `${path}: the model is not told this source is not configured on this instance`);
  assert.ok(run.told.includes('BOSTON_OPENCONTEXT_MCP_URL'), `${path}: the model's text does not name BOSTON_OPENCONTEXT_MCP_URL`);
  assert.ok(!run.outbound.some((u) => !u.startsWith('socrata.example.test/') && !u.startsWith('dc.example.test/')), `${path}: a request went somewhere but the fixtures: ${run.outbound.join(', ')}`);
}

test('A18, the un-narrowed path: a replayed OpenContext search with BOSTON_OPENCONTEXT_MCP_URL unset is refused not_configured, and the model is told this source is not configured here, by its variable', async () => {
  assertTheSourceSaysSo(await replayOpenContextSearch(undefined), 'un-narrowed');
});

test('A18, the narrowed path (a replayerSelection, as the route passes it): the same refusal and the same text, before any request', async () => {
  assertTheSourceSaysSo(await replayOpenContextSearch(['socrata', 'data-commons']), 'narrowed');
});

test('A18: the no-primary-source text is unchanged for SOCRATA_MCP_URL unset', () => {
  let error: unknown;
  try {
    routeToolCall(buildMcpRegistry({ dataCommonsUrl: 'https://dc.example.test/mcp' }), 'socrata__get_data');
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Error && error.message.includes('SOCRATA_MCP_URL'), 'premise: the Socrata call is refused naming its variable');
  assert.equal(describeToolFailureForLlm('socrata__get_data', error), NO_PRIMARY_SOURCE_TEXT);
});
