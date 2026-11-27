// OF3-FX1 (Sprint OF-1, website #810; criterion 1, the loop's half): under a present step, which only a run asked in a
// map format has, every answer the loop sends the model begins with that call's number, its position in the run's
// calls counting from 1. `src/app/api/output-format-map-driven.test.ts` drives the route; this file drives the loop
// core directly, for the answers no route can reach there: a search (`find_source`, which no route offers while the
// searchable set equals the listed set), a call refused before it is sent (a portal outside the run's lock), and a
// result cut to a small bound.
//
// WHAT IS DRIVEN. `runToolLoop` against the scripted model server of `./test-harness.ts` (it records every request
// body), with a load step and a search step that answer in plain text, the real present step, and a transport that
// answers one dataset with rows and fails another. One model turn makes every call; the next request carries every
// answer. The control is the same run with no present step and no present call: no answer carries a number.
//
// WHAT MAKES IT ABLE TO FAIL. At `04c99df` no answer carries a number, so every red fails at its first answer.
//
// No live endpoint, no credential: every key is a placeholder and every address loopback.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScriptedToolCall } from './test-harness.ts';

process.env.OPENROUTER_API_KEY = 'not-a-credential-of3fx';
for (const k of ['SITE_DEFAULT_PORTAL', 'SITE_PORTAL_LOCKED']) delete process.env[k];

const { startScriptedModelServer } = await import('./test-harness.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { _resetDefaultModelClientForTests, getModelClient } = await import('../model-client.ts');
const { createPresentStep, presentResultTool } = await import('../output-format/present-step.ts');

const PORTAL = 'data.example.org';
/** A bound small enough that the rows below are cut to fit it. */
const BOUND = 400;
const ROWS = Array.from({ length: 40 }, (_unused, i) => ({ name: `row ${i}`, latitude: (40.7 + i / 1000).toFixed(4), longitude: (-73.9 - i / 1000).toFixed(4) }));
const call = (id: string, name: string, args: Record<string, unknown>): ScriptedToolCall => ({ id, name, args });

/** One model turn making every kind of call, in this order: positions 1 to 6. */
const MAP_CALLS: ScriptedToolCall[] = [
  call('load', 'load_source', { alias: 'socrata' }),
  call('search', 'find_source', { query: 'noise complaints' }),
  call('rows', 'socrata__get_data', { type: 'query', dataset_id: 'rows-0001', query: 'SELECT *' }),
  call('locked', 'socrata__get_data', { type: 'query', dataset_id: 'lock-0001', portal: 'data.elsewhere.example' }),
  call('failed', 'socrata__get_data', { type: 'query', dataset_id: 'fail-0001', query: 'SELECT *' }),
  call('present', 'present_result', { result: 3, label: 'name' }),
];

async function run(calls: ScriptedToolCall[], withPresentStep: boolean): Promise<string[]> {
  const model = await startScriptedModelServer([{ toolCalls: calls }, { content: 'An answer.' }]);
  process.env.MODEL_API_BASE_URL = model.url;
  _resetDefaultModelClientForTests();
  try {
    await runToolLoop({
      client: getModelClient(),
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: 'Where were the complaints?',
      tools: withPresentStep ? [presentResultTool()] : [],
      lockedPortal: PORTAL,
      maxToolResultChars: BOUND,
      executeToolCall: async (_name, args) => {
        if (args.dataset_id === 'rows-0001') return JSON.stringify({ data: ROWS, total_rows: ROWS.length });
        throw new TypeError('fetch failed');
      },
      loadStep: { toolName: 'load_source', load: async () => ({ outcome: 'loaded', text: 'Socrata is loaded.' }) },
      searchStep: { toolName: 'find_source', search: async () => ({ outcome: 'searched', text: 'No source matched.', hits: [] }) },
      ...(withPresentStep ? { presentStep: createPresentStep() } : {}),
    });
  } finally {
    await new Promise((resolve) => model.server.close(resolve));
    _resetDefaultModelClientForTests();
  }
  assert.equal(model.requests.length, 2, 'premise: one turn of calls, then the answer');
  return ((model.requests[1].messages ?? []) as Array<{ role?: string; content?: unknown }>).filter((m) => m.role === 'tool').map((m) => String(m.content));
}

const MAP_ANSWERS = await run(MAP_CALLS, true);
const AUTO_ANSWERS = await run(MAP_CALLS.slice(0, -1), false);

const numberShown = (text: string): number | undefined => {
  const shown = /^\[call (\d+)\]\n/.exec(text);
  return shown ? Number(shown[1]) : undefined;
};

test('OF3-FX1 criterion 1 (red): under a present step, the load, the search, a data result, a refusal before sending, a failure and the step itself each begin with their call number', () => {
  assert.equal(MAP_ANSWERS.length, MAP_CALLS.length, 'premise: one answer per call');
  MAP_ANSWERS.forEach((text, i) => assert.equal(numberShown(text), i + 1, `${MAP_CALLS[i].id}: ${JSON.stringify(text.slice(0, 80))}`));
  // Each answer is the one its kind gives, after the number.
  assert.ok(MAP_ANSWERS[0].endsWith('Socrata is loaded.'), MAP_ANSWERS[0]);
  assert.ok(MAP_ANSWERS[1].endsWith('No source matched.'), MAP_ANSWERS[1]);
  assert.ok(MAP_ANSWERS[5].includes('Mapped 40 of 40 rows from call 3'), MAP_ANSWERS[5]);
});

test('OF3-FX1 criterion 1 (red): a result cut to the bound keeps its number, and the numbered answer stays within the bound', () => {
  const cut = MAP_ANSWERS[2];
  assert.ok(/\[Truncated: showing \d+ of 40 rows\]$/.test(cut), `premise: the rows were cut: ${JSON.stringify(cut.slice(-60))}`);
  assert.equal(numberShown(cut), 3);
  assert.ok(cut.length <= BOUND, `${cut.length} characters, over the bound of ${BOUND}`);
});

test('OF3-FX1 criterion 1 (pin): with no present step no answer carries a number', () => {
  assert.equal(AUTO_ANSWERS.length, MAP_CALLS.length - 1, 'premise');
  for (const text of AUTO_ANSWERS) assert.equal(numberShown(text), undefined, text.slice(0, 40));
  assert.equal(AUTO_ANSWERS[0], 'Socrata is loaded.');
});
