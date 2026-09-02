// Wave N9 P2 (#384), family F1 — the red instrument, stage 1.
//
// Property ruled by D2: NO CONSUMER OF THE RECORD INVENTS WHAT THE LOOP DID
// NOT WRITE. A tool name and an operation type travel from the loop to every
// reader of the progress stream, or are absent there, stated as absent.
//
// This file covers the two halves of that property that are reachable with
// the repository's relative imports: (a) the wire — the third argument of
// `StreamCallbacks.onProgress`, which `/api/compare-stream` spreads verbatim
// onto the SSE `progress` event — and (d) the reader-facing formatters in
// `./streaming.ts`. The replay half (`bpmn/trace-progress.ts`, the group
// label, the card) is in `src/lib/bpmn/trace-progress-tool-name.test.ts`.
//
// Field names, chosen here so stage 2 implements exactly this:
//   - `toolName`       — the name the loop recorded (`ToolCallRecord.name`).
//                        Not bare `name`: on an event that also carries
//                        `message` and `phase`, `name` does not say name of
//                        WHAT; `toolName` does, and cannot be confused with a
//                        step or phase name.
//   - `operationType`  — byte-identical to `ToolCallRecord.operationType`, so
//                        the value the loop derived once (`deriveOperationType`)
//                        flows through unrenamed and no second derivation is
//                        invited downstream. Absent when the loop derived none
//                        (`fetch`, by design — see `mcp/operation-types.ts`).
//
// RED at 500e954: `ProgressOpts` / `ProgressEvent` carry neither field;
// `reportLoopEvent` has `event.call.name` in hand and passes only
// `{ phase, iteration, args }`; `streaming.ts` has zero `case 'search'`.
//
// Universe: `src/lib/openrouter-streaming.ts` (the one SSE-facing caller of
// the loop) and the six operation-type switches in `src/lib/streaming.ts`.
// Not covered here: the replay, the comparison hook, the card (file 2).
//
// The scripted endpoint is `model-loop/test-harness.ts`: loopback only, no
// credential, no MCP server. Every key value below is a placeholder string.
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/progress-tool-name.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { queryWithMcpStreaming, type CompletionResult } from './openrouter-streaming.ts';
import { carriedModelIdentity } from './model-catalog.ts';
import { _resetDefaultModelClientForTests } from './model-client.ts';
import { startScriptedModelServer, type ScriptedReply } from './model-loop/test-harness.ts';
import {
  formatToolProgress,
  generateToolReason,
  getEducationalAnnotation,
  buildBreadcrumbLabel,
  buildNarrativeSummary,
  getDatasetName,
  type PanelType,
} from './streaming.ts';

const PLACEHOLDER_KEY = 'placeholder-model-key-for-tests';
const FAKE_MODEL = carriedModelIdentity('fake/model');

const SEARCH_QUERY = 'noise complaints';
const FETCH_ID = 'dataset:data.example.gov:abcd-1234';

/** Neutral copy the generic branches produce at base — the strings this instrument rules out. */
const GENERIC_REASON = 'to gather data';
const GENERIC_PROGRESS = (name: string) => `Calling ${name}...`;
const GENERIC_NARRATIVE = (name: string) => `called ${name}`;

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_BASE_URL'];

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  _resetDefaultModelClientForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetDefaultModelClientForTests();
});

// ---------------------------------------------------------------------------
// (a) The wire
// ---------------------------------------------------------------------------

interface RecordedProgress {
  panel: PanelType;
  message: string;
  /** The third argument, read loosely: the fields under test do not exist on `ProgressOpts` at base. */
  opts: Record<string, unknown> | undefined;
}

/**
 * Two tool-call rounds — a `search`, then a `fetch` — then a declarative
 * answer. The injected `executeToolCall` answers each by name; nothing
 * downstream of the loop is stubbed, so what `onProgress` receives is what
 * the SSE route would put on the wire.
 */
const SEARCH_THEN_FETCH: ScriptedReply[] = [
  { toolCalls: [{ id: 'call_1', name: 'search', args: { query: SEARCH_QUERY } }] },
  { toolCalls: [{ id: 'call_2', name: 'fetch', args: { id: FETCH_ID } }] },
  {
    content:
      'The portal lists one dataset about noise complaints, abcd-1234, with columns for the ' +
      'complaint type, the borough and the date the request was created.',
  },
];

async function runSearchThenFetch(): Promise<{ result: CompletionResult; progress: RecordedProgress[] }> {
  const { server, url } = await startScriptedModelServer(SEARCH_THEN_FETCH);
  try {
    process.env.MODEL_API_KEY = PLACEHOLDER_KEY;
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();

    const progress: RecordedProgress[] = [];
    let result: CompletionResult | undefined;

    await queryWithMcpStreaming(
      'Which datasets describe noise complaints, and what columns do they have?',
      FAKE_MODEL,
      [],
      async (name) => {
        if (name === 'search') {
          return JSON.stringify({
            data: [{ id: 'abcd-1234', name: 'Noise complaints', description: 'Service requests about noise' }],
            total_rows: 1,
          });
        }
        return JSON.stringify({
          id: FETCH_ID,
          title: 'Noise complaints',
          columns: [{ name: 'complaint_type' }, { name: 'borough' }, { name: 'created_date' }],
        });
      },
      undefined,
      {
        onProgress: (panel, message, opts) => {
          progress.push({ panel, message, opts: opts as Record<string, unknown> | undefined });
        },
        onToken: () => {},
        onComplete: (_panel, completion) => {
          result = completion;
        },
        onError: (_panel, message) => {
          assert.fail(`unexpected onError: ${message}`);
        },
      },
    );

    assert.ok(result, 'onComplete must fire');
    return { result: result!, progress };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function eventsOfPhase(progress: RecordedProgress[], phase: string): RecordedProgress[] {
  return progress.filter((p) => p.opts?.phase === phase);
}

test('the wire: the loop records the name and the derived operation type (the contrast the red below is measured against)', async () => {
  const { result } = await runSearchThenFetch();
  // Green at base. The loop writes both fields onto the record; what follows
  // is about the progress stream dropping them one frame later.
  assert.equal(result.tools_called?.length, 2);
  assert.equal(result.tools_called![0].name, 'search');
  assert.equal(result.tools_called![0].operationType, 'search');
  assert.equal(result.tools_called![1].name, 'fetch');
  assert.equal(result.tools_called![1].operationType, undefined);
});

test('the wire: a tool_start progress event carries toolName and operationType as the loop recorded them', async () => {
  const { progress } = await runSearchThenFetch();
  const starts = eventsOfPhase(progress, 'tool_start');
  assert.equal(starts.length, 2, 'one tool_start per tool call');

  assert.equal(starts[0].opts?.toolName, 'search', 'tool_start #1 names the search');
  assert.equal(starts[0].opts?.operationType, 'search', 'tool_start #1 carries the derived operation type');

  assert.equal(starts[1].opts?.toolName, 'fetch', 'tool_start #2 names the fetch');
  // Absent is absent: the loop derived no operation type for `fetch`, so the
  // event carries none — not 'unknown', not a guess from the id's shape.
  assert.equal(starts[1].opts?.operationType, undefined, 'tool_start #2 states no operation type');
});

test('the wire: a tool_complete progress event carries the same toolName as its tool_start', async () => {
  const { progress } = await runSearchThenFetch();
  const completes = eventsOfPhase(progress, 'tool_complete');
  assert.equal(completes.length, 2, 'one tool_complete per tool call');
  assert.equal(completes[0].opts?.toolName, 'search');
  assert.equal(completes[0].opts?.operationType, 'search');
  assert.equal(completes[1].opts?.toolName, 'fetch');
  assert.equal(completes[1].opts?.operationType, undefined);
});

test('the wire: a search step has its result narrated (formatToolResult knows a search)', async () => {
  const { progress } = await runSearchThenFetch();
  // At base `formatToolResult` switches on `args.type`, which a `search` call
  // does not carry, and returns null — so the reader never hears what the
  // search found. The assertion is on the wire, not on the signature, so
  // stage 2 may give the formatter the name however it sees fit.
  const searchResult = eventsOfPhase(progress, 'tool_result').find((p) => p.opts?.iteration === 1);
  assert.ok(searchResult, 'the search (iteration 1) emits a tool_result narration');
  assert.match(searchResult!.message, /dataset/i, 'the narration says what a search returns: datasets');
});

test('the wire: record.reason for a search names what was searched for, never the generic default', async () => {
  const { result } = await runSearchThenFetch();
  // `generateToolReason` writes `record.reason`, which both notebook
  // generators read (notebook.ts, tool-to-cell.ts). At base it switches on
  // `args.type` and falls to 'to gather data' for every non-get_data call.
  const search = result.tools_called![0];
  assert.notEqual(search.reason, GENERIC_REASON, 'a search reason is not the generic default');
  assert.ok(search.reason?.includes(SEARCH_QUERY), `a search reason names the query: ${search.reason}`);

  // `fetch`: honest is either a description that carries the identifier the
  // call named, or a default that repeats the recorded name — never the
  // generic phrase, which asserts an intent the loop did not record.
  const fetched = result.tools_called![1];
  assert.notEqual(fetched.reason, GENERIC_REASON, 'a fetch reason is not the generic default');
  assert.ok(
    fetched.reason?.includes(FETCH_ID) || /\bfetch\b/.test(fetched.reason ?? ''),
    `a fetch reason names the identifier or repeats the recorded name: ${fetched.reason}`,
  );
});

test('guard (green at base): the get_data reason is unchanged — P4 reads this text next', () => {
  // Pinned so this phase cannot move the `get_data` output the executed and
  // skeleton notebooks read; P4 follows and owns any change there.
  const datasetName = getDatasetName('erm2-nwe9');
  assert.equal(
    generateToolReason({ type: 'query', dataset_id: 'erm2-nwe9', where: "borough = 'BROOKLYN'" }),
    `to filter ${datasetName} records`,
  );
  assert.equal(
    generateToolReason({ type: 'catalog', query: SEARCH_QUERY }),
    `to find datasets about "${SEARCH_QUERY}"`,
  );
});

// ---------------------------------------------------------------------------
// (d) The labels — the switches in ./streaming.ts
// ---------------------------------------------------------------------------

test('formatToolProgress: a search says what the step does, in user language', () => {
  const line = formatToolProgress('search', { query: SEARCH_QUERY });
  assert.notEqual(line, GENERIC_PROGRESS('search'), 'not the generic "Calling <tool>..." line');
  assert.match(line, /search/i, 'says it is searching');
  assert.ok(line.includes(SEARCH_QUERY), `says what for: ${line}`);
});

test('formatToolProgress: a fetch discloses what it is looking up, in user language', () => {
  // The progress line is the most reader-visible surface there is (Principle
  // 5's glance layer), so `fetch` gets a case here: the honest sentence names
  // the identifier the call gave and asserts nothing about what it returns.
  const line = formatToolProgress('fetch', { id: FETCH_ID });
  assert.notEqual(line, GENERIC_PROGRESS('fetch'), 'not the generic "Calling <tool>..." line');
  assert.ok(line.includes(FETCH_ID), `names the identifier: ${line}`);
});

test('formatToolProgress (green at base): a tool the switch does not know is named, not described', () => {
  // The honest default repeats the recorded name. This pins that the default
  // survives stage 2 — a default that guesses is the defect class.
  const line = formatToolProgress('lookup_records', { id: 'x' });
  assert.ok(line.includes('lookup_records'), `repeats the recorded name: ${line}`);
});

test('getEducationalAnnotation: a search has an annotation; an unknown operation has none', () => {
  const annotation = getEducationalAnnotation('tool_start', 'search');
  assert.ok(annotation, 'a search tool_start is annotated');
  assert.ok(annotation!.length > 20, 'the annotation is a sentence, not a token');
  // Green at base, pinned: absence is the honest annotation for an operation
  // the function cannot describe — never a catalog or query sentence.
  assert.equal(getEducationalAnnotation('tool_start', 'zz_unknown_operation'), null);
});

test('buildBreadcrumbLabel: a search chip is user language, not the bare tool name', () => {
  const tool = { name: 'search', args: { query: SEARCH_QUERY }, operationType: 'search' };
  const chip = buildBreadcrumbLabel(tool, [tool], 0);
  assert.notEqual(chip, 'search', 'not the bare tool name');
  assert.match(chip, /search/i, `says it is a search: ${chip}`);
});

test('buildBreadcrumbLabel (green at base): a tool the switch does not know is named, not described', () => {
  const tool = { name: 'lookup_records', args: { id: 'x' } };
  assert.equal(buildBreadcrumbLabel(tool, [tool], 0), 'lookup_records');
});

test('buildNarrativeSummary: a search is narrated as a search, with what was searched for', () => {
  // `describeToolNarrative` is module-private; `buildNarrativeSummary` is
  // its only caller and the reader-facing sentence, so it is asserted here.
  const summary = buildNarrativeSummary([{ name: 'search', args: { query: SEARCH_QUERY }, operationType: 'search' }]);
  assert.ok(!summary.includes(GENERIC_NARRATIVE('search')), `not "called search": ${summary}`);
  assert.match(summary, /search/i, 'says it searched');
  assert.ok(summary.includes(SEARCH_QUERY), `says what for: ${summary}`);
});

test('buildNarrativeSummary: a fetch is narrated with the identifier it looked up', () => {
  const summary = buildNarrativeSummary([{ name: 'fetch', args: { id: FETCH_ID } }]);
  assert.ok(!summary.includes(GENERIC_NARRATIVE('fetch')), `not "called fetch": ${summary}`);
  assert.ok(summary.includes(FETCH_ID), `names the identifier: ${summary}`);
});

test('buildNarrativeSummary (green at base): a tool the switch does not know is named, not described', () => {
  const summary = buildNarrativeSummary([{ name: 'lookup_records', args: { id: 'x' } }]);
  assert.ok(summary.includes('lookup_records'), `repeats the recorded name: ${summary}`);
});
