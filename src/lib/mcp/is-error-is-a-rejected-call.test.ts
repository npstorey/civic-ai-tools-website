// #429 (Wave N11 P3 — criteria A1 and A2, ruling R2): a `tools/call` result
// carrying `isError: true` is a rejected call — on the loop's record, in the
// built package, and on every reader of the record — and it is recorded by its
// STRUCTURE, never by its words.
//
// WHAT IS DRIVEN. A scripted MCP server on loopback answers `tools/call` by the
// dataset a call names. The website's REAL client (`callMcpTool`) is the
// executor under the REAL loop (`queryWithMcpStreaming`), with the scripted
// model endpoint (`model-loop/test-harness.ts`) and a real `TraceBuilder`. The
// recorded calls cross the wire as `/api/compare-stream` encodes them and reach
// `buildEvidencePackage` as the publish route hands them, with the run's own
// trace inline.
//
// THE FIXTURE SHAPE (CLAUDE.md: "a criterion demonstrated on a fixture shaped so
// it cannot fail is not demonstrated").
//   Run 1 — one call answered on dataset A, and two calls refused with
//   `isError: true`: one framed as SSE and one as plain JSON, because
//   `client.ts` reads the two framings in two branches. Each refused call names
//   a dataset nothing else in the run touches, so `dataSources[]` cannot
//   de-duplicate an access assertion away. Each refusal's words carry a marker
//   and none of `classifyStreamError`'s matcher substrings, and none of
//   `session`, `400` or `parse` (the client's retry and rewrite triggers).
//   Run 2 — the decoy (the G5 lesson): the same two framings, refusing in words
//   that carry "unavailable", "timed out", "session", "400" and "parse". A fix
//   that read the refusal's words would record it `timeout` and send it twice
//   (the session retry fires on "session" and "400"). That naive variant —
//   throwing the result's text as a plain `Error` — is shown against this
//   decoy at the phase gate and never committed. Here the decoy must come back
//   `unknown`, sent once, and the error the loop's catch site receives must be
//   the one the branch threw.
//
// R2. In the SSE branch, only a body that does not parse becomes the parse
// failure; a refusal the server worded with "parse" reaches the caller in its
// own words, and is classified by them as any JSON-RPC error is. The session
// retry for a JSON-RPC error is unchanged (a non-goal) and is pinned here.
//
// RED at f32b679: every isError assertion (the call recorded as answered;
// `queries[]` stating it answered; `dataSources[]` asserting access to a refused
// dataset; the span, the narrative, the stats, the provenance line, the
// summarizer's list and both notebooks treating it as done; its words reaching
// the model), the decoy (recorded as answered, nothing thrown), the parse-worded
// refusal (rewritten to "Failed to parse MCP response JSON"), and the parse
// failure itself — V8's `JSON.parse` messages do not contain the word "parse",
// so the old rewrite never fired for the one case it was written for.
// GREEN at f32b679, and able to go red only on a regression: the premise
// (the answered call, the send counts), the decoy's single send (nothing was
// thrown to retry), the refusal words' absence from the package bytes and the
// progress wire (base never carried them there), and the JSON-RPC retry.
//
// BLIND SPOTS. The readers here are the ones reachable as functions from a
// test. The React surfaces that render the record are held by
// `src/components/reason-phrase-readers.test.ts` (read as source) and
// `src/components/notebook/deliberative-trace-line.test.ts` (driven). The
// hosted data source never answers `isError: true` — its handlers throw, so it
// refuses with a JSON-RPC error — so this path is for third-party servers, and
// the scripted server stands in for one. No live endpoint, no credential; every
// key is a placeholder and every address is loopback.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/is-error-is-a-rejected-call.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CompletionResult, ProgressOpts } from '../openrouter-streaming.ts';
import type { CompleteEvent } from '../streaming.ts';
import type { EvidencePackage, PackageInput, ToolCallInput } from '../evidence/packager.ts';
import type { ToolCallRecord } from '../model-loop/run-tool-loop.ts';
import type { PhaseAOutputs } from '../notebook-author/synthesize.ts';

// --- Fixtures ---------------------------------------------------------------

const PORTAL = 'data.example.org';
const QUESTION = 'How many noise complaints were filed last year?';
const ANSWER = 'One figure was retrieved; two requests were refused by the source.';
const ONE_ROW = JSON.stringify({ data: [{ count: '4812' }], total_rows: 1 });

const ANSWERED = 'abcd-1234';
const REFUSED_SSE = 'wxyz-9876';
const REFUSED_JSON = 'qrst-5432';
const DECOY_SSE = 'dcoy-1111';
const DECOY_JSON = 'dcoy-2222';
const PARSE_WORDED = 'prse-3333';
const UNPARSEABLE = 'brkn-4444';
const SESSION_WORDED = 'sesn-5555';

const REFUSAL_SSE_TEXT = 'Refusal-marker-S7Q: this source holds no table with that identifier.';
const REFUSAL_JSON_TEXT = 'Refusal-marker-J4W: this source holds no table with that identifier.';
const DECOY_TEXT =
  'Decoy-marker-D9X: the service is unavailable, the query timed out, the session ended with a 400, and the filter did not parse.';
const PARSE_WORDED_TEXT = 'The filter could not be parsed as written.';
const SESSION_WORDED_TEXT = 'Unknown session: initialize again.';
const PARSE_FAILURE = 'Failed to parse MCP response JSON';

/** A rejection stated in the reader's words — the outcome formatter's vocabulary, any kind. */
const STATED_REJECTION = /did not complete|returned no data|could not be completed|did not respond/i;

const NO_ATTRIBUTION = { origin: null, host: null, platformTitle: null };

// --- The scripted MCP server --------------------------------------------------

/** `tools/call` requests received, per dataset — the client's retry shows here as a 2. */
const received = new Map<string, number>();
const sentTo = (dataset: string): number => received.get(dataset) ?? 0;

function sse(res: http.ServerResponse, body: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${body}\n\n`);
}

function plainJson(res: http.ServerResponse, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(200, { 'content-type': 'application/json', ...headers });
  res.end(body);
}

const isErrorResult = (text: string) => ({ content: [{ type: 'text', text }], isError: true });

const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? JSON.parse(body) : {};
  if (msg.id === undefined) {
    res.writeHead(202);
    res.end();
    return;
  }
  const reply = (payload: Record<string, unknown>): string => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    plainJson(
      res,
      reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p3-is-error-stub', version: '0' } } }),
      { 'mcp-session-id': 'p3-is-error-session' },
    );
    return;
  }
  const dataset = String((msg.params?.arguments ?? {}).dataset_id);
  received.set(dataset, sentTo(dataset) + 1);
  switch (dataset) {
    case REFUSED_SSE: sse(res, reply({ result: isErrorResult(REFUSAL_SSE_TEXT) })); return;
    case REFUSED_JSON: plainJson(res, reply({ result: isErrorResult(REFUSAL_JSON_TEXT) })); return;
    case DECOY_SSE: sse(res, reply({ result: isErrorResult(DECOY_TEXT) })); return;
    case DECOY_JSON: plainJson(res, reply({ result: isErrorResult(DECOY_TEXT) })); return;
    case PARSE_WORDED: sse(res, reply({ error: { code: -32602, message: PARSE_WORDED_TEXT } })); return;
    case SESSION_WORDED: sse(res, reply({ error: { code: -32000, message: SESSION_WORDED_TEXT } })); return;
    // A frame whose JSON stops short: the one body that does not parse.
    case UNPARSEABLE: sse(res, `{"jsonrpc":"2.0","id":${JSON.stringify(msg.id)},"result":`); return;
    default: sse(res, reply({ result: { content: [{ type: 'text', text: ONE_ROW }], isError: false } }));
  }
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();

// The registry captures its environment at module load, so every app module is
// imported after the endpoint is set (`client-unreachable.test.ts`, same reason).
for (const k of ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_BASE_URL', 'SITE_DEFAULT_PORTAL']) delete process.env[k];
process.env.SOCRATA_MCP_URL = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;

const { REFERENCE_IDENTITY_ENV } = await import('../evidence/reference-identity-fixture.ts');
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;

const { callMcpTool } = await import('./client.ts');
const { startScriptedModelServer } = await import('../model-loop/test-harness.ts');
const { queryWithMcpStreaming } = await import('../openrouter-streaming.ts');
const { carriedModelIdentity, modelAccessPhrase } = await import('../model-catalog.ts');
const { _resetDefaultModelClientForTests } = await import('../model-client.ts');
const streaming = await import('../streaming.ts');
const { buildEvidencePackage } = await import('../evidence/packager.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('../evidence/trace.ts');
const { sourceIdForToolName } = await import('./operation-types.ts');
const { describeQueryOutcome } = await import('../evidence/query-step.ts');
const { summaryDataSources } = await import('../evidence/summary-sources.ts');
const { generateNotebook } = await import('../notebook.ts');
const { synthesizeNotebook } = await import('../notebook-author/synthesize.ts');

// --- One drive per run --------------------------------------------------------

interface Recorded {
  message: string;
  opts?: ProgressOpts & { failed?: boolean; failureKind?: string };
}

interface Run {
  completion: CompletionResult;
  progress: Recorded[];
  trace: Record<string, unknown>;
  /** What the loop's catch site received, per dataset: the executor rethrows the client's error unchanged. */
  thrown: Map<string, unknown>;
  /** Every request the model endpoint received — the model channel. */
  requests: Record<string, unknown>[];
}

async function drive(datasets: string[]): Promise<Run> {
  const { server, url, requests } = await startScriptedModelServer([
    {
      toolCalls: datasets.map((dataset, i) => ({
        id: `c${i + 1}`,
        name: 'get_data',
        args: { type: 'query', dataset_id: dataset, select: 'count(*)', portal: PORTAL },
      })),
    },
    { content: ANSWER },
  ]);
  try {
    process.env.OPENROUTER_API_KEY = 'placeholder-model-key-p3-is-error';
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();
    const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
    builder.startRoot('analysis', { 'analysis.portal': PORTAL });
    const progress: Recorded[] = [];
    const thrown = new Map<string, unknown>();
    let completion: CompletionResult | undefined;
    await queryWithMcpStreaming(
      QUESTION,
      carriedModelIdentity('fake/model'),
      [],
      async (name, args) => {
        try {
          return await callMcpTool(name, args);
        } catch (error) {
          thrown.set(String(args.dataset_id), error);
          throw error;
        }
      },
      'You are a fixture system prompt.',
      {
        onProgress: (_panel, message, opts) => progress.push({ message, opts }),
        onToken: () => {},
        onComplete: (_panel, result) => { completion = result; },
        onError: (_panel, message) => assert.fail(`unexpected onError: ${message}`),
      },
      { builder, parentSpanId: builder.rootSpanId, resolveToolSource: sourceIdForToolName },
      { toolTimeoutMs: 10_000 },
    );
    builder.endRoot();
    assert.ok(completion, 'onComplete must fire');
    return { completion: completion!, progress, trace: builder.finalize() as unknown as Record<string, unknown>, thrown, requests };
  } finally {
    _resetDefaultModelClientForTests();
    await new Promise((resolve) => server.close(resolve));
  }
}

const RUN = await drive([ANSWERED, REFUSED_SSE, REFUSED_JSON]);
const DECOY = await drive([DECOY_SSE, DECOY_JSON]);

// --- Reading the record -------------------------------------------------------

function recordOf(run: Run, dataset: string): ToolCallRecord {
  const record = (run.completion.tools_called ?? []).find((c) => c.args.dataset_id === dataset);
  assert.ok(record, `no recorded call for ${dataset}`);
  return record!;
}

/** `encodeSSE` → the bytes on the wire → `JSON.parse`, as `sse-client.ts` reads a frame. */
function throughTheWire(completion: CompletionResult): ToolCallInput[] {
  const frame = streaming.encodeSSE({ type: 'complete', panel: 'withMcp', data: completion });
  const event = JSON.parse(frame.slice('data: '.length).trimEnd()) as CompleteEvent;
  return (event.data.tools_called ?? []) as ToolCallInput[];
}

type QueryEntry = EvidencePackage['queries'][number] & { failed?: boolean; failureKind?: string };

function packageOf(run: Run): EvidencePackage {
  const input: PackageInput = {
    trace: run.trace as unknown as PackageInput['trace'],
    prompt: QUESTION,
    output: ANSWER,
    toolCalls: throughTheWire(run.completion),
    model: 'fake/model',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'P3 isError',
    summary: 'P3 isError.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
  };
  return buildEvidencePackage(input).pkg;
}

const PKG = packageOf(RUN);

function entryOf(pkg: EvidencePackage, dataset: string): QueryEntry {
  const entry = (pkg.queries as QueryEntry[]).find((q) => q.datasetId === dataset);
  assert.ok(entry, `queries[] carries no entry for ${dataset}`);
  return entry!;
}

interface OtlpSpan {
  name?: string;
  attributes?: Array<{ key: string; value: { stringValue?: string; boolValue?: boolean } }>;
}

function toolSpanOf(trace: Record<string, unknown>, dataset: string): OtlpSpan {
  const spans: OtlpSpan[] = [];
  for (const rs of (trace.resourceSpans ?? []) as Array<{ scopeSpans?: Array<{ spans?: OtlpSpan[] }> }>) {
    for (const ss of rs.scopeSpans ?? []) spans.push(...(ss.spans ?? []));
  }
  const span = spans.find((s) => s.name === 'mcp_tool_call' && s.attributes?.some((a) => a.key === 'tool.dataset_id' && a.value.stringValue === dataset));
  assert.ok(span, `the trace carries no mcp_tool_call span for ${dataset}`);
  return span!;
}

const attr = (span: OtlpSpan, key: string) => span.attributes?.find((a) => a.key === key)?.value;

/** The tool message the model was sent for one call — read off the wire, not inferred. */
function toolMessage(run: Run, callId: string): string {
  const messages = (run.requests.at(-1)?.messages ?? []) as Array<{ role?: string; tool_call_id?: string; content?: unknown }>;
  const m = messages.find((x) => x.role === 'tool' && x.tool_call_id === callId);
  assert.ok(m, `the model was never sent a tool message for ${callId}`);
  return typeof m!.content === 'string' ? m!.content : JSON.stringify(m!.content);
}

function codeCellText(notebook: { cells: Array<{ cell_type: string; source: string | string[] }> }): string {
  return notebook.cells
    .filter((c) => c.cell_type === 'code')
    .map((c) => (Array.isArray(c.source) ? c.source.join('') : c.source))
    .join('\n');
}

const REFUSED = [
  { framing: 'SSE', dataset: REFUSED_SSE, text: REFUSAL_SSE_TEXT, marker: 'Refusal-marker-S7Q', callId: 'c2' },
  { framing: 'plain-JSON', dataset: REFUSED_JSON, text: REFUSAL_JSON_TEXT, marker: 'Refusal-marker-J4W', callId: 'c3' },
] as const;

// --- Premise, green at base ---------------------------------------------------

test('premise: the answered call is answered and reaches dataSources[], and every call went out exactly once', () => {
  assert.equal(RUN.completion.content, ANSWER);
  assert.equal(recordOf(RUN, ANSWERED).failed, undefined);
  assert.ok(JSON.stringify(PKG.dataSources).includes(ANSWERED), 'the answered dataset reaches dataSources[] — the instrument can see an entry');
  for (const dataset of [ANSWERED, REFUSED_SSE, REFUSED_JSON]) {
    assert.equal(sentTo(dataset), 1, `${dataset} was sent ${sentTo(dataset)} times`);
  }
});

// --- A1: the record, the package, the wire ------------------------------------

for (const { framing, dataset, text, marker, callId } of REFUSED) {
  test(`A1 (${framing}): the loop records the isError result as a rejected call, kind unknown — on its record and in the SSE frame`, () => {
    const record = recordOf(RUN, dataset);
    assert.equal(record.failed, true, `the ${framing}-framed isError result was recorded as ANSWERED (failed: ${String(record.failed)})`);
    assert.equal(record.failureKind, 'unknown');
    const onTheWire = throughTheWire(RUN.completion).find((c) => c.args.dataset_id === dataset) as ToolCallInput & { failed?: boolean; failureKind?: string };
    assert.equal(onTheWire.failed, true);
    assert.equal(onTheWire.failureKind, 'unknown');
  });

  test(`A1 (${framing}): the built package's queries[] entry states the refused call as rejected; dataSources[] asserts no access to it`, () => {
    const entry = entryOf(PKG, dataset);
    assert.equal(entry.failed, true, `queries[] states the ${framing}-framed isError call as answered — in signed bytes`);
    assert.equal(entry.failureKind, 'unknown');
    assert.ok(
      !JSON.stringify(PKG.dataSources).includes(dataset),
      `dataSources[] asserts access to ${dataset}, a dataset the source refused:\n${JSON.stringify(PKG.dataSources, null, 1)}`,
    );
  });

  test(`A1 (${framing}): the trace span states the rejection by its kind`, () => {
    const span = toolSpanOf(RUN.trace, dataset);
    assert.equal(attr(span, 'error')?.boolValue, true, `the span of the refused call carries no error: ${JSON.stringify(span.attributes)}`);
    assert.equal(attr(span, 'error.kind')?.stringValue, 'unknown');
  });

  test(`A1 (${framing}): the refusal's words reach no request the model received`, () => {
    const sent = toolMessage(RUN, callId);
    assert.ok(!JSON.stringify(RUN.requests).includes(marker), `the refusal reached the model channel verbatim:\n${sent}`);
    assert.ok(!sent.includes(text));
  });

  test(`A1 (${framing}): the refusal's words are in no byte of the built package and on no event of the progress wire (a regression pin)`, () => {
    assert.ok(!JSON.stringify(PKG).includes(marker), 'the refusal text is inside the bytes this instance signs');
    assert.ok(!JSON.stringify(RUN.progress).includes(marker), 'the refusal text reached the progress wire (#154)');
  });

  test(`A1 (${framing}): the progress wire ends the refused call as failed, kind unknown`, () => {
    const ends = RUN.progress.filter((r) => r.opts?.failed === true && r.opts.args?.dataset_id === dataset);
    assert.ok(ends.length > 0, `no progress event says the ${framing}-framed refused call failed`);
    for (const e of ends) assert.equal(e.opts?.failureKind, 'unknown');
  });
}

// --- A1: every other reader of the record ------------------------------------

test('A1: the outcome formatter the record page reads states each refused entry as rejected', () => {
  for (const { dataset } of REFUSED) {
    const outcome = describeQueryOutcome(entryOf(PKG, dataset));
    assert.equal(outcome.kind, 'failed', `${dataset} reads as ${outcome.kind}: ${outcome.text}`);
  }
  assert.equal(describeQueryOutcome(entryOf(PKG, ANSWERED)).kind, 'returned', 'control: the answered entry reads as returned');
});

test('A1: the summarizer’s "Data sources used" list names no refused dataset', () => {
  const listed = summaryDataSources(RUN.completion.tools_called ?? []).map((s) => s.datasetId);
  assert.deepEqual(listed, [ANSWERED]);
});

test('A1: the run-level narrative, stats and provenance line neither count nor link a refused call as done', () => {
  const tools = RUN.completion.tools_called ?? [];
  const narrative = streaming.buildNarrativeSummary(tools);
  const stats = streaming.buildStatsSummary(tools, RUN.completion.duration_ms);
  const provenance = streaming.buildProvenanceLine(tools) ?? '';
  for (const { dataset } of REFUSED) {
    assert.ok(!narrative.includes(`/d/${dataset}`), `the narrative links the refused dataset ${dataset}: ${JSON.stringify(narrative)}`);
    assert.ok(!provenance.includes(dataset), `the provenance line lists the refused dataset ${dataset}: ${JSON.stringify(provenance)}`);
  }
  assert.match(narrative, STATED_REJECTION, `the narrative never says a request did not complete: ${JSON.stringify(narrative)}`);
  assert.match(stats, /\b1 query\b/, `the stats line counts a refused call as a query: ${JSON.stringify(stats)}`);
  assert.ok(provenance.includes(ANSWERED), `control: the answered dataset stays a source: ${JSON.stringify(provenance)}`);
});

test('A1: neither notebook writes a cell that fetches a refused dataset', () => {
  const tools = RUN.completion.tools_called ?? [];
  const skeleton = generateNotebook(QUESTION, PORTAL, tools as never, ANSWER, NO_ATTRIBUTION);
  const executed = synthesizeNotebook({
    query: QUESTION,
    defaultPortal: PORTAL,
    toolCalls: tools as unknown as PhaseAOutputs['toolCalls'],
    finalAnswer: ANSWER,
    modelName: 'fake/model',
    modelAccess: modelAccessPhrase('openai-compatible'),
    generatedAt: '2026-09-11T00:00:00.000Z',
  }).notebook;
  for (const [which, notebook] of [['skeleton', skeleton], ['executed', executed]] as const) {
    const code = codeCellText(notebook as never);
    assert.ok(code.includes(ANSWERED), `control: the ${which} notebook fetches the answered dataset in a code cell`);
    for (const { dataset } of REFUSED) {
      assert.ok(!code.includes(dataset), `the ${which} notebook writes a code cell that fetches ${dataset}, a dataset the source refused`);
    }
  }
});

// --- A2: the decoy -------------------------------------------------------------

for (const [framing, dataset, callId] of [['SSE', DECOY_SSE, 'c1'], ['plain-JSON', DECOY_JSON, 'c2']] as const) {
  test(`A2 (${framing} decoy): refused in words every matcher reads, it is still recorded unknown — by structure, not by its words`, () => {
    const record = recordOf(DECOY, dataset);
    assert.equal(record.failed, true, `the ${framing} decoy was recorded as ANSWERED`);
    assert.equal(record.failureKind, 'unknown', `the ${framing} decoy was recorded as ${record.failureKind} — a kind read from the source's words`);
  });

  test(`A2 (${framing} decoy): it went out exactly once — the session retry did not fire on "session" or "400"`, () => {
    assert.equal(sentTo(dataset), 1, `the ${framing} decoy was sent ${sentTo(dataset)} times`);
  });

  test(`A2 (${framing} decoy): the loop's catch site receives the error the branch threw — the isError failure, never the parse failure`, () => {
    const error = DECOY.thrown.get(dataset);
    assert.ok(error instanceof Error, `the catch site received no error for the ${framing} decoy`);
    assert.equal((error as Error & { sourceRefusal?: unknown }).sourceRefusal, 'error-result', `the ${framing} decoy reached the catch site as ${String(error)}`);
    assert.notEqual((error as Error).message, PARSE_FAILURE);
    assert.ok(!(error as Error).message.includes('Decoy-marker'), 'the source’s words ride on the error the loop classifies');
  });

  test(`A2 (${framing} decoy): its words reach no request the model received`, () => {
    assert.ok(!JSON.stringify(DECOY.requests).includes('Decoy-marker'), `the decoy reached the model channel:\n${toolMessage(DECOY, callId)}`);
  });
}

// --- R2: the parse rewrite -------------------------------------------------------

async function rejectionOf(dataset: string): Promise<Error> {
  try {
    await callMcpTool('get_data', { type: 'query', dataset_id: dataset, select: 'count(*)', portal: PORTAL });
  } catch (error) {
    assert.ok(error instanceof Error);
    return error as Error;
  }
  return assert.fail(`callMcpTool resolved for ${dataset}; it should have rejected`);
}

test('R2: a refusal the server worded with "parse" reaches the caller in its own words, not as a parse failure', async () => {
  const error = await rejectionOf(PARSE_WORDED);
  assert.equal(error.message, PARSE_WORDED_TEXT, `the SSE branch rewrote the source's refusal into "${error.message}"`);
  assert.equal(sentTo(PARSE_WORDED), 1);
});

test('R2: a body that does not parse is the parse failure', async () => {
  const error = await rejectionOf(UNPARSEABLE);
  assert.equal(error.message, PARSE_FAILURE, `an unparseable frame came back as "${error.message}"`);
});

test('unchanged (a non-goal): a JSON-RPC error worded with "session" is still retried once, and still classified by its words', async () => {
  const error = await rejectionOf(SESSION_WORDED);
  assert.equal(sentTo(SESSION_WORDED), 2, 'the session retry for a JSON-RPC error is not this phase’s to change');
  assert.equal(error.message, SESSION_WORDED_TEXT);
  assert.equal(streaming.classifyStreamError(error), 'generic');
});
