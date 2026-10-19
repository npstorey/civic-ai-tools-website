// R6 W1, the G5 string review (#632): how a `not_offered` call is worded.
//
// THE RULING. The reader-facing sentences are in the active voice, and a
// `not_offered` outcome is stated WITHOUT the shared lead-in "This request did
// not complete.", because the request was never sent. Every other outcome
// keeps the lead-in. The change is made once, inside `describeQueryOutcome`,
// which the record page and the live run's step card both read, so the three
// surfaces word one call alike; `kind` stays `failed`, so the refused-request
// count still counts it. The elapsed sentence is unchanged by the ruling.
//
// WHAT IS DRIVEN. The four strings as their exporters produce them; the
// outcome formatter on a `not_offered` entry and on a `timeout` entry; the
// record page's and the live run's step views; and an entry the REAL loop and
// the REAL packager produce for a call outside the run's selection, so the
// sentence a reader sees for it — elapsed included — is read, not assumed.
//
// RED at f814606: every string assertion (the passive wording), the lead-in on
// the `not_offered` outcome on all three surfaces, and the real entry's
// sentence. GREEN there, and kept: the `timeout` outcome with its lead-in and
// `kind: 'failed'`.
//
// THE NOTEBOOK'S FOLLOW-ON SENTENCE (the G5 string review, second round). The
// executed generator closes a failed call's cell with "a request that returned
// no data cannot be reproduced", which is untrue of a call that was never
// sent. For `not_offered` only it reads "a request that was not sent cannot
// be reproduced"; every other kind keeps today's sentence. The census at
// 1c549a4: `renderFailedToolCell` (tool-to-cell.ts) is the one writer. The
// skeleton (`notebook.ts`, `rejectedNote`) writes neither sentence; it shares
// only `describeToolFailure`, and that is pinned here too. RED at 1c549a4: the
// not_offered sentence. GREEN there, and kept: the timeout sentence and the
// skeleton's absence of both.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

// The registry reads its configuration at module load. A Socrata address the
// fixture never contacts: the only call made is refused before any request.
for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'DATA_COMMONS_API_KEY', 'MODEL_API_KIND', 'MODEL_API_AUTH']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'http://127.0.0.1:9/socrata';
process.env.DATA_COMMONS_MCP_URL = 'http://127.0.0.1:9/dc/mcp';
const realFetch = globalThis.fetch;
const OUTBOUND: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  OUTBOUND.push(`${url.host}${url.pathname}`);
  if (url.hostname !== '127.0.0.1') throw new TypeError('fetch failed');
  return realFetch(input, init);
}) as typeof fetch;

const { REFERENCE_IDENTITY_ENV } = await import('./reference-identity-fixture.ts');
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;

const { FAILURE_REASON, renderFetchToolCell } = await import('../notebook-author/tool-to-cell.ts');
const { generateNotebook } = await import('../notebook.ts');
const { friendlyStreamError, describeToolFailureForLlm } = await import('../streaming.ts');
const { SourceNotOfferedError, readMcpEnvFromProcess } = await import('../mcp/registry.ts');
const { describeQueryOutcome } = await import('./query-step.ts');
const { buildRecordStepView, buildRunStepView, OPEN_STEP_LABEL } = await import('../answer-view/steps.ts');
const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { compareLoopOptions } = await import('../model-loop/compare-loop.ts');
const { runToolLoop } = await import('../model-loop/run-tool-loop.ts');
const { createModelClient } = await import('../model-client.ts');
const { buildEvidencePackage } = await import('./packager.ts');

const NOTEBOOK_REASON = 'This question did not use this data source, so nothing was sent to it.';
const STREAM_COPY = 'This question did not use that data source, so nothing was sent to it.';
const FOR_MODEL =
  'That data source was not used for this question, so this request was not sent to it. Do not call its tools again,' +
  ' and do not estimate, guess, or fabricate any values in place of what it would have returned.' +
  ' Answer from the data sources whose tools you were given. If they cannot answer the question, tell the user in plain' +
  ' language that this question did not use this data source, and do not include any raw error text, status codes,' +
  ' server names, or system details.';
const LEAD_IN = 'This request did not complete.';
const TIMEOUT_OUTCOME = `${LEAD_IN} ${FAILURE_REASON.timeout}`;

// --- The real loop's entry for a call outside the selection ---------------------

const scripted = await startScriptedModelServer([
  { toolCalls: [{ id: 'n1', name: 'data_commons__search_indicators', args: { query: 'median household income' } }] },
  { content: 'The figure could not be retrieved from the sources used for this question.' },
]);
process.env.MODEL_API_BASE_URL = scripted.url;
const RUN = await runToolLoop(compareLoopOptions({
  client: createModelClient({ apiKey: 'placeholder-model-key-r6-w1-wording' }),
  endpointModel: 'fake/model',
  requestSettings: undefined,
  prompt: 'What was the median household income in the Bronx?',
  systemPrompt: 'You are a fixture system prompt.',
  configured: readMcpEnvFromProcess(),
  selection: ['socrata'],
}));
await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
const ENTRY = buildEvidencePackage({
  trace: { resourceSpans: [] },
  prompt: 'What was the median household income in the Bronx?',
  output: RUN.content,
  toolCalls: RUN.toolCalls as never,
  model: 'fake/model',
  tokenUsage: { promptTokens: 10, completionTokens: 5 },
  promptVisibility: 'full_text',
  title: 'R6 W1 wording',
  summary: 'R6 W1 wording.',
  captureMethod: 'chat-flow-stream',
}).pkg.queries[0] as { tool: string; failed?: boolean; failureKind?: string; duration_ms?: number };

// --- The strings ---------------------------------------------------------------

test('G5: the notebook\'s reason for a not_offered call is in the active voice', () => {
  assert.equal(FAILURE_REASON.not_offered, NOTEBOOK_REASON);
});

test('G5: the stream copy for not_offered is in the active voice', () => {
  assert.equal(friendlyStreamError({ code: 'not_offered' }), STREAM_COPY);
});

test('G5: the model is told to say that this question did not use this data source; every other word is unchanged', () => {
  assert.equal(describeToolFailureForLlm('data_commons__search_indicators', new SourceNotOfferedError('data_commons__search_indicators')), FOR_MODEL);
});

// --- The lead-in -----------------------------------------------------------------

test('G5: a not_offered outcome is stated without the lead-in, still as failed; a timeout keeps the lead-in', () => {
  const notOffered = describeQueryOutcome({ failed: true, failureKind: 'not_offered' });
  assert.deepEqual(notOffered, { kind: 'failed', text: NOTEBOOK_REASON });
  const withElapsed = describeQueryOutcome({ failed: true, failureKind: 'not_offered', duration_ms: 3 });
  assert.deepEqual(withElapsed, { kind: 'failed', text: `${NOTEBOOK_REASON} The attempt took 3ms.` });
  assert.deepEqual(describeQueryOutcome({ failed: true, failureKind: 'timeout' }), { kind: 'failed', text: TIMEOUT_OUTCOME }, 'green at f814606: the other kinds keep the lead-in');
  for (const failureKind of ['unavailable', 'not_configured', 'unknown', undefined]) {
    assert.ok(describeQueryOutcome({ failed: true, failureKind }).text.startsWith(`${LEAD_IN} `), `${failureKind}: the lead-in moved`);
  }
  assert.ok(describeQueryOutcome({}, { refusedInTrace: true }).text.startsWith(`${LEAD_IN} `), 'a trace-stated refusal: the lead-in moved');
});

test('G5: the record page\'s step and the live run\'s step card word a not_offered call alike, without the lead-in', () => {
  const call = { name: 'data_commons__search_indicators', operationType: 'search', args: { query: 'income' }, failed: true, failureKind: 'not_offered' as const, duration_ms: 0 };
  const record = buildRecordStepView([{ tool: call.name, operationType: call.operationType, arguments: call.args, failed: true, failureKind: 'not_offered', duration_ms: 0 }]);
  const entry = { message: 'Searching...', phase: 'tool_start', iteration: 1, toolName: call.name, operationType: 'search', timestamp: 0 };
  const live = buildRunStepView([{ iteration: 1, label: OPEN_STEP_LABEL, entries: [entry], isComplete: true } as never], [call]);
  const recordOutcome = record.steps[0]?.calls[0]?.outcome;
  const liveOutcome = [...live.steps.flatMap((s) => s.calls), ...live.unplaced][0]?.outcome;
  assert.equal(recordOutcome, `${NOTEBOOK_REASON} The attempt took 0ms.`, 'the record page\'s step');
  assert.equal(liveOutcome, recordOutcome, 'the live step card words the call differently from the record page');
});

test('G5: the entry the real loop and packager write for a call outside the selection reads without the lead-in', () => {
  assert.deepEqual(OUTBOUND.filter((u) => !u.startsWith(`${new URL(scripted.url).host}/`)), [], 'premise: nothing was sent to a data source');
  assert.equal(ENTRY.failed, true);
  assert.equal(ENTRY.failureKind, 'not_offered');
  assert.equal(typeof ENTRY.duration_ms, 'number', 'the loop measured an elapsed for the refused call');
  assert.equal(describeQueryOutcome(ENTRY).text, `${NOTEBOOK_REASON} The attempt took ${ENTRY.duration_ms!.toLocaleString()}ms.`);
});

// --- The notebook's follow-on sentence ---------------------------------------------

const NOT_SENT_FOLLOW_ON =
  'No code cell is generated for it — a request that was not sent cannot be reproduced. The steps below rest only on the requests that did return data.';
const NO_DATA_FOLLOW_ON =
  'No code cell is generated for it — a request that returned no data cannot be reproduced. The steps below rest only on the requests that did return data.';
const NOTEBOOK_CALL = { name: 'data_commons__search_indicators', args: { query: 'median household income' }, operationType: 'search', failed: true };

function executedCell(failureKind: 'not_offered' | 'timeout'): string {
  const out = renderFetchToolCell({ ...NOTEBOOK_CALL, failureKind }, { dataFrameIndex: 1, defaultPortal: 'data.cityofnewyork.us' });
  assert.ok(out, 'a failed call renders a cell');
  return out.cells.map((cell) => cell.source.join('')).join('\n');
}

function skeletonText(failureKind: 'not_offered' | 'timeout'): string {
  return generateNotebook('What was the median household income in the Bronx?', null, [{ ...NOTEBOOK_CALL, failureKind }], 'An answer.', { origin: null, host: null, platformTitle: null })
    .cells.map((cell) => cell.source.join(''))
    .join('\n');
}

test('G5: the executed notebook says a not_offered request was not sent, and states its reason', () => {
  const md = executedCell('not_offered');
  assert.ok(md.includes(NOT_SENT_FOLLOW_ON), `the not_offered cell does not say the request was not sent:\n${md}`);
  assert.ok(!md.includes(NO_DATA_FOLLOW_ON), 'the not_offered cell says the request returned no data');
  assert.ok(md.includes(NOTEBOOK_REASON), 'the not_offered cell does not state its reason');
});

test('G5: every other kind keeps "a request that returned no data cannot be reproduced" (green at 1c549a4)', () => {
  const md = executedCell('timeout');
  assert.ok(md.includes(NO_DATA_FOLLOW_ON), `the timeout cell lost its sentence:\n${md}`);
  assert.ok(!md.includes(NOT_SENT_FOLLOW_ON));
});

test('G5: the skeleton notebook writes neither follow-on sentence, and states the same reason (green at 1c549a4)', () => {
  for (const kind of ['not_offered', 'timeout'] as const) {
    const text = skeletonText(kind);
    assert.ok(!text.includes('cannot be reproduced'), `${kind}: the skeleton now writes a follow-on sentence of its own; pin it here`);
    assert.ok(text.includes(FAILURE_REASON[kind]), `${kind}: the skeleton does not state the reason the executed notebook states`);
  }
});
