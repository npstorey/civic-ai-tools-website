// S2-B P3R criterion 3b (npstorey/civic-ai-tools#309; COLD READ S2-C finding 2; the seat's ruling 13): every call
// that got no answer ends its `mcp_tool_call` span with the BOOLEAN `error: true`, its `error.kind` and its
// `tool.duration_ms`. The harness writes `civic:failed` only for a boolean `true` (its `capture/provenance`), and
// bundle revision 4's "answered" words rest on that marker, so a failed call whose span ended unmarked would read as
// answered.
//
// WHAT IS DRIVEN. The real loop core, one run, one model turn calling a tool on every failure path that opens a call
// span, and one call that is answered as the control: arguments that do not parse; a portal outside the run's lock;
// a pack call outside its filter; a pack call the base check refuses; a pack call whose base read failed; a
// transport error; a timeout (the per-call bound); a JSON-RPC error answer; an `isError` result; a source the run
// was not offered; a source not configured; a bare name two sources share. The base check is the real one, with
// its read injected: the first read fails, the second finds a base that does not match. Out of scope (ruling 13):
// the load span, calls left unrun at the cap, and non-`function` tool calls.
//
// THE ASSERTION is over every call span, not over a list of the expected ones: no span whose call is recorded
// failed ends without the marker, and the answered call's span carries none. On tree 8 (no check) the two
// base-check calls are sent and answered, so their rows read answered: red there.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScriptedToolCall } from './test-harness.ts';
import type { ServerToolsRead } from '../mcp/client.ts';

process.env.OPENROUTER_API_KEY = 'not-a-credential-p3r';
for (const k of ['SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED']) delete process.env[k];

const { startScriptedModelServer } = await import('./test-harness.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { _resetDefaultModelClientForTests, getModelClient } = await import('../model-client.ts');
const { createBaseCheck } = await import('../mcp/base-check.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('../evidence/trace.ts');
const { McpConfigurationError, SourceNotOfferedError } = await import('../mcp/registry.ts');
const { AmbiguousToolNameError } = await import('../mcp/tool-name-refusal.ts');
const { McpErrorEnvelope, McpErrorResult } = await import('../mcp/tool-call-failure.ts');

const PACK = 'nyc_record__get_data';
const NYC = 'data.cityofnewyork.us';
const call = (id: string, name: string, args: Record<string, unknown>, rawArguments?: string): ScriptedToolCall => ({ id, name, args, ...(rawArguments ? { rawArguments } : {}) });

/** Each path, the call that takes it, and the kind its record must carry. */
const PATHS: Array<{ id: string; path: string; call: ScriptedToolCall; kind: string | null }> = [
  { id: 'ok', path: 'answered (control)', call: call('ok', 'socrata__get_data', { type: 'query', dataset_id: 'aaaa-1111', query: 'SELECT 1' }), kind: null },
  { id: 'malformed', path: 'arguments that do not parse', call: call('malformed', 'socrata__get_data', {}, '{not json'), kind: 'unknown' },
  { id: 'lock', path: 'a portal outside the lock', call: call('lock', 'socrata__get_data', { type: 'query', dataset_id: 'bbbb-2222', portal: 'data.cityofchicago.org' }), kind: 'unknown' },
  { id: 'filter', path: 'a pack call outside its filter', call: call('filter', PACK, { type: 'query', portal: 'data.cityofchicago.org' }), kind: 'unknown' },
  { id: 'read', path: 'a pack call whose base read failed', call: call('read', PACK, { type: 'query', query: 'SELECT 1' }), kind: 'unavailable' },
  { id: 'base', path: 'a pack call the base check refused', call: call('base', PACK, { type: 'query', query: 'SELECT 2' }), kind: 'base_changed' },
  { id: 'transport', path: 'a transport error', call: call('transport', 'socrata__get_data', { type: 'query', dataset_id: 'cccc-3333', query: 'x' }), kind: 'unavailable' },
  { id: 'timeout', path: 'a timeout (the per-call bound)', call: call('timeout', 'socrata__get_data', { type: 'query', dataset_id: 'dddd-4444', query: 'x' }), kind: 'timeout' },
  { id: 'envelope', path: 'a JSON-RPC error answer', call: call('envelope', 'socrata__get_data', { type: 'query', dataset_id: 'eeee-5555', query: 'x' }), kind: 'unknown' },
  { id: 'iserror', path: 'an isError result', call: call('iserror', 'socrata__get_data', { type: 'query', dataset_id: 'ffff-6666', query: 'x' }), kind: 'unknown' },
  { id: 'offered', path: 'a source the run was not offered', call: call('offered', 'data_commons__get_observations', { variable_dcids: ['Count_Person'] }), kind: 'not_offered' },
  { id: 'configured', path: 'a source not configured', call: call('configured', 'boston__ckan__search', { q: 'x' }), kind: 'not_configured' },
  { id: 'ambiguous', path: 'a bare name two sources share', call: call('ambiguous', 'get_data', { type: 'query', dataset_id: 'gggg-7777', query: 'x' }), kind: 'unknown' },
];

const datasetBehaviour: Record<string, () => Promise<string>> = {
  'aaaa-1111': async () => '[{"n":1}]',
  'cccc-3333': async () => { throw new TypeError('fetch failed'); },
  'dddd-4444': () => new Promise((resolve) => setTimeout(() => resolve('[]'), 400)),
  'eeee-5555': async () => { throw new McpErrorEnvelope('fixture refusal'); },
  'ffff-6666': async () => { throw new McpErrorResult(); },
  'gggg-7777': async () => { throw new AmbiguousToolNameError('get_data', ['socrata__get_data', 'nyc_record__get_data']); },
};

let reads = 0;
const read = async (): Promise<ServerToolsRead> => {
  reads += 1;
  if (reads === 1) throw new Error('fixture: the base could not be read');
  return { serverInfo: { name: 'socrata-mcp-server', version: '0.0.1' }, tools: [] };
};

const model = await startScriptedModelServer([{ toolCalls: PATHS.map((p) => p.call) }, { content: 'An answer.' }]);
process.env.MODEL_API_BASE_URL = model.url;
_resetDefaultModelClientForTests();
const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
builder.startRoot('analysis', {});
const result = await runToolLoop({
  client: getModelClient(),
  endpointModel: 'fake/model',
  requestSettings: undefined,
  prompt: 'Every way a call can end.',
  tools: [],
  lockedPortal: NYC,
  toolTimeoutMs: 100,
  checkBase: createBaseCheck({ read }),
  executeToolCall: async (name, args) => {
    if (name === PACK) return '[{"notice":"fixture"}]';
    if (name.startsWith('data_commons__')) throw new SourceNotOfferedError(name);
    if (name.startsWith('boston__')) throw new McpConfigurationError('BOSTON_OPENCONTEXT_MCP_URL is not set');
    const behaviour = datasetBehaviour[String(args.dataset_id)];
    assert.ok(behaviour, `no behaviour for ${name} ${JSON.stringify(args)}`);
    return behaviour();
  },
  trace: { builder, parentSpanId: builder.rootSpanId, resolveToolSource: () => 'socrata' },
});
builder.endRoot();
await new Promise((resolve) => model.server.close(resolve));
_resetDefaultModelClientForTests();

type Attr = { key: string; value?: { stringValue?: string; boolValue?: boolean; intValue?: number | string } };
const trace = builder.finalize() as unknown as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ name: string; attributes?: Attr[] }> }> }> };
const callSpans = trace.resourceSpans[0].scopeSpans[0].spans.filter((s) => s.name === 'mcp_tool_call');
const value = (span: { attributes?: Attr[] }, key: string) => span.attributes?.find((a) => a.key === key)?.value;

test('premise: one call span and one record per path, in order', () => {
  assert.equal(result.toolCalls.length, PATHS.length);
  assert.equal(callSpans.length, PATHS.length);
  assert.equal(reads, 2, 'premise: the base was read twice (a failed read is not kept)');
});

test('3b: every call span whose call got no answer ends with the boolean error: true, its kind and its duration', () => {
  for (const [i, record] of result.toolCalls.entries()) {
    if (record.failed !== true) continue;
    const span = callSpans[i];
    assert.equal(value(span, 'error')?.boolValue, true, `${PATHS[i].path}: the span does not end with the boolean error: true`);
    assert.equal(value(span, 'error.kind')?.stringValue, record.failureKind, `${PATHS[i].path}: the span's kind is not the record's`);
    assert.ok(value(span, 'tool.duration_ms') !== undefined, `${PATHS[i].path}: the span carries no tool.duration_ms`);
  }
});

test('3b: each path is recorded failed with its kind, and the answered call carries no marker', () => {
  const observed = result.toolCalls.map((record, i) => ({ path: PATHS[i].path, kind: record.failed === true ? record.failureKind : null, marked: value(callSpans[i], 'error')?.boolValue ?? null }));
  assert.deepEqual(observed, PATHS.map((p) => ({ path: p.path, kind: p.kind, marked: p.kind === null ? null : true })));
});
