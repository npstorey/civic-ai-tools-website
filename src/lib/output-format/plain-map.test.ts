// OF3a (Sprint OF-1, website #810): the map builder and the present step, unit by unit. The driven file
// (`src/app/api/output-format-map-driven.test.ts`) runs both through the real route and publish handler; this file
// holds the shapes a route cannot reach cheaply: the cap at its edge, the duplicate-id check on a planted duplicate,
// the step's checks one argument at a time, and the loop's refusal of a tools array that offers `present_result`
// with no step to answer it.
//
// WHAT MAKES IT ABLE TO FAIL. At the base neither module exists, and the loop sends a `present_result` call to the
// transport as any call: every test below fails at an assertion there.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const HERE = path.dirname(fileURLToPath(import.meta.url));
const importOrNull = (file: string): Promise<Mod | null> => import(pathToFileURL(path.join(HERE, file)).href).catch(() => null);
const plainMap = await importOrNull('plain-map.ts');
const presentStep = await importOrNull('present-step.ts');
const loop = (await import('../model-loop/run-tool-loop.ts')) as unknown as Mod;
const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { default: OpenAI } = await import('openai');
const clientFor = (baseURL: string) => new OpenAI({ apiKey: 'placeholder-model-key-of3a', baseURL });

type Row = Record<string, unknown>;
const located = (n: number, offset = 0): Row[] =>
  Array.from({ length: n }, (_unused, i) => ({ id: `r${i + offset}`, label: `L${i + offset}`, latitude: 40 + (i + offset) / 1e5, longitude: -74 + (i + offset) / 1e5 }));

test('the builder (red): exactly 1,000 located rows are all drawn; 1,001 keep the first 1,000 in order and count one beyond the cap', () => {
  assert.ok(plainMap, 'plain-map.ts does not exist');
  assert.equal(plainMap!.MAP_POINT_CAP, 1000);
  const at = plainMap!.buildPlainMap({ rows: located(1000), label: 'label', dataset: 'dataset x' });
  assert.deepEqual(at.counts, { returned: 1000, drawn: 1000, withoutLocation: 0, beyondCap: 0 });
  const over = plainMap!.buildPlainMap({ rows: [{ label: 'none' }, ...located(1001)], label: 'label', dataset: 'dataset x' });
  assert.deepEqual(over.counts, { returned: 1002, drawn: 1000, withoutLocation: 1, beyondCap: 1 });
  assert.equal(over.map.features[0].id, '2', 'a feature\'s id is its row\'s position, from 1');
  assert.equal(over.map.features[999].id, '1001');
});

test('the builder (red): its input is rows, a label column and a dataset name; nothing else can reach the map', () => {
  assert.ok(plainMap, 'plain-map.ts does not exist');
  const built = plainMap!.buildPlainMap({ rows: located(2), label: 'label', dataset: 'dataset x', question: 'QTOKEN 1.5, 2.5', answer: 'QTOKEN 1.5, 2.5' });
  const text = JSON.stringify(built);
  assert.ok(!text.includes('QTOKEN') && !text.includes('2.5'), text);
});

test('the producer\'s id check (red): a planted duplicate feature id is refused', () => {
  assert.ok(plainMap, 'plain-map.ts does not exist');
  const { map } = plainMap!.buildPlainMap({ rows: located(3), label: 'label', dataset: 'dataset x' });
  assert.doesNotThrow(() => plainMap!.assertUniqueFeatureIds(map));
  const planted = structuredClone(map);
  planted.features[2].id = planted.features[0].id;
  assert.throws(() => plainMap!.assertUniqueFeatureIds(planted), (error: Error) => error.name === 'DuplicateFeatureIdError' && /"1"/.test(error.message));
});

// --- The present step's checks ----------------------------------------------------------------------------------------

const rowsResult = (rows: Row[]) => JSON.stringify({ data: rows, total_rows: rows.length });
const call = (name: string, extra: Row = {}) => ({ name, args: { dataset_id: 'abcd-1234' }, ...extra });

test('the present step (red): each argument is an identifier checked against the run\'s results; an unknown value is refused', () => {
  assert.ok(presentStep, 'present-step.ts does not exist');
  const calls = [call('socrata__get_data'), call('load_source', { operationType: 'load_source' }), call('socrata__get_data', { failed: true }), call('socrata__get_data')];
  const results = [rowsResult(located(2)), undefined, undefined, 'not rows'];
  const cases: Array<[unknown, unknown, 'accepted' | 'refused', string | undefined]> = [
    [1, 'label', 'accepted', undefined],
    ['1', 'label', 'refused', 'no-result-named'],
    [0, 'label', 'refused', 'no-result-named'],
    [5, 'label', 'refused', 'no-result-named'],
    [1.5, 'label', 'refused', 'no-result-named'],
    [2, 'label', 'refused', 'no-result-named'],
    [1, 'not_a_column', 'refused', 'no-result-named'],
    [1, 7, 'refused', 'no-result-named'],
    [3, 'label', 'refused', 'result-failed'],
    [4, 'label', 'refused', 'result-failed'],
  ];
  for (const [result, label, outcome, reason] of cases) {
    const step: Mod = presentStep!.createPresentStep();
    const answer: Mod = step.present({ result, label }, { calls, results });
    assert.equal(answer.outcome, outcome, `result ${JSON.stringify(result)}, label ${JSON.stringify(label)}`);
    assert.ok(typeof answer.text === 'string' && answer.text.length > 0 && !answer.text.includes('{'), answer.text);
    const presented: Mod = step.presentation();
    if (reason) assert.deepEqual(presented.outcome, { drawn: false, reason });
    else assert.deepEqual(presented.outcome, { drawn: true });
  }
});

test('the present step (red): with no call, the outcome is no-result-named; a later refusal does not undo an accepted call', () => {
  assert.ok(presentStep, 'present-step.ts does not exist');
  const none = presentStep!.createPresentStep();
  assert.deepEqual(none.presentation(), { outcome: { drawn: false, reason: 'no-result-named' } });
  const step = presentStep!.createPresentStep();
  const calls = [call('socrata__get_data')];
  const results = [rowsResult(located(2))];
  step.present({ result: 1, label: 'label' }, { calls, results });
  step.present({ result: 9, label: 'label' }, { calls, results });
  assert.deepEqual(step.presentation().outcome, { drawn: true });
});

// --- The loop: a tools array offering present_result needs the step ---------------------------------------------------

const presentTool = { type: 'function', function: { name: 'present_result', description: 'x', parameters: { type: 'object', properties: {} } } };
const sourceTool = (name: string) => ({ type: 'function', function: { name, description: 'x', parameters: { type: 'object', properties: {} } } });

test('the loop (red): a tools array that offers present_result with no present step is refused before any request', async () => {
  const server = await startScriptedModelServer([{ content: 'unreached' }]);
  try {
    for (const tools of [[presentTool], [sourceTool('example__present_result')]]) {
      await assert.rejects(loop.runToolLoop({
        client: clientFor(server.url),
        endpointModel: 'm', requestSettings: undefined, prompt: 'q', tools,
        executeToolCall: async () => '[]',
      }), /present_result/);
    }
    assert.equal(server.requests.length, 0, 'a request was sent');
  } finally {
    server.server.close();
  }
});

test('the loop (red): with a present step, a call to present_result never reaches the transport, and its span states its outcome only', async () => {
  assert.ok(presentStep, 'present-step.ts does not exist');
  const server = await startScriptedModelServer([
    { toolCalls: [{ id: 'c1', name: 'socrata__get_data', args: { type: 'query', dataset_id: 'abcd-1234', query: 'SELECT *' } }] },
    { toolCalls: [{ id: 'c2', name: 'present_result', args: { result: 1, label: 'label' } }] },
    { content: 'An answer.' },
  ]);
  const sent: string[] = [];
  const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('../evidence/trace.ts');
  const trace = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  trace.startRoot('r', {});
  try {
    const step: Mod = presentStep!.createPresentStep();
    const result = await loop.runToolLoop({
      client: clientFor(server.url),
      endpointModel: 'm', requestSettings: undefined, prompt: 'q',
      tools: [sourceTool('socrata__get_data'), presentTool],
      executeToolCall: async (name: string) => { sent.push(name); return rowsResult(located(3)); },
      presentStep: step,
      trace: { builder: trace, parentSpanId: trace.rootSpanId },
    });
    assert.deepEqual(sent, ['socrata__get_data']);
    assert.equal(result.toolCalls[1].operationType, 'present_result');
    assert.equal(result.toolCalls[1].presentOutcome, 'accepted');
    assert.deepEqual(step.presentation().counts, { returned: 3, drawn: 3, withoutLocation: 0, beyondCap: 0 });
    trace.endRoot();
    const spans = (trace.finalize() as unknown as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ name: string; attributes: Array<{ key: string; value: { stringValue?: string } }> }> }> }> })
      .resourceSpans[0].scopeSpans[0].spans.filter((s) => s.name === 'mcp_tool_call');
    const keys = spans[1].attributes.map((a) => a.key);
    assert.deepEqual(keys, ['tool.name', 'tool.operation_type', 'tool.arguments', 'tool.present_outcome', 'tool.duration_ms']);
  } finally {
    server.server.close();
  }
});
