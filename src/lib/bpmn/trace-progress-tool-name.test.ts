// Wave N9 P2 (#384), family F1 — the red instrument, stage 1, replay half.
//
// Property ruled by D2: NO CONSUMER OF THE RECORD INVENTS WHAT THE LOOP DID
// NOT WRITE. This file covers the consumers downstream of the SSE progress
// stream: the pre-recorded trace (`./traces.ts`, `./capture-trace.ts`), the
// replay that builds the flow diagram's tool calls (`./trace-progress.ts`),
// the comparison hook's group label (`@/hooks/useStreamingComparison`) and the
// card (`@/components/ToolCallCard`). The wire and the `streaming.ts` labels
// are in `src/lib/progress-tool-name.test.ts`, which also states the field
// names this file relies on: `toolName` and `operationType` on a trace event,
// exactly as on the progress event it was captured from.
//
// RED at 500e954: `trace-progress.ts:129` writes `name: 'get_data'` — the
// only value the function could invent, because `TraceEvent` has no name
// field; `generateGroupLabel` falls to 'Running query' for a search group;
// `ToolCallCard` has no `search` badge entry and renders
// `data-tooltip={undefined}`.
//
// "Unnamed", the shape proposed for stage 2: a trace event with no `toolName`
// yields a tool call whose `name` is ABSENT (`undefined`) — never 'get_data',
// never a placeholder that reads like a name — and every label built from it
// says so in words. That needs `ToolCall.name` (`useStreamingComparison.ts`)
// and the `tool.name` parameters in `streaming.ts` to admit `undefined`; the
// assertions below are written against that shape.
//
// Universe: the four modules named above, driven in-process. The flow
// diagram's DOM (`McpFlowDiagram.tsx` -> `ProgressLog.tsx`) is not rendered;
// the instrument asserts the `toolsCalled` array it renders from, and renders
// the one leaf component whose defect is in its own markup (the card).
//
// --- Why this file registers module hooks ----------------------------------
// The runner is `node --test --experimental-strip-types`, which has no
// tsconfig path mapping and no JSX. Three of the four targets are unreachable
// under it at base: `trace-progress.ts` and `useStreamingComparison.ts`
// import through the `@/` alias, and `ToolCallCard.tsx` is JSX. The hooks
// below (registered from a `data:` URL so this instrument is one test file
// and nothing else) map `@/` onto `src/`, resolve extensionless relative
// imports inside `src/`, and transpile `.tsx` through the repository's own
// `typescript`. They apply to this test's process only — `node --test` runs
// each file in its own process — and they are a test-runner accommodation,
// not a precedent for production code. Modules that need them are imported
// dynamically, after `register()`; the static imports above it do not.
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/bpmn/trace-progress-tool-name.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TRACES, type TraceEvent } from './traces.ts';
import { createTraceCapture } from './capture-trace.ts';
import { buildBreadcrumbLabel, buildNarrativeSummary } from '../streaming.ts';
import type { ProgressLogEntry } from '../../hooks/useStreamingComparison.ts';

const ROOT = pathToFileURL(process.cwd() + '/').href;

const HOOKS = `
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
let root; let ts;
export function initialize(data) { root = data.root; ts = createRequire(root)('typescript'); }
const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
function withExtension(fileUrl) {
  const p = fileURLToPath(fileUrl);
  if (/\\.[cm]?[jt]sx?$/.test(p) && existsSync(p)) return fileUrl;
  for (const ext of EXTS) if (existsSync(p + ext)) return fileUrl + ext;
  return null;
}
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const c = withExtension(root + 'src/' + specifier.slice(2));
    if (c) return { url: c, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith(root + 'src/')) {
    const c = withExtension(new URL(specifier, context.parentURL).href);
    if (c) return { url: c, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.endsWith('.tsx')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const out = ts.transpileModule(source, { fileName: fileURLToPath(url), compilerOptions: {
      module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true } });
    return { format: 'module', source: out.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;

register('data:text/javascript,' + encodeURIComponent(HOOKS), { parentURL: ROOT, data: { root: ROOT } });

const { traceEventsToProgressData } = await import('./trace-progress.ts');
const { generateGroupLabel } = await import('../../hooks/useStreamingComparison.ts');
const { default: ToolCallCard } = await import('../../components/ToolCallCard.tsx');

// ---------------------------------------------------------------------------
// Fixtures. `TraceEvent` has no `toolName` / `operationType` at base, so the
// events are built loosely and cast — the red must be the assertion, not a
// type error. Stage 2 removes the cast by adding the fields to the type.
// ---------------------------------------------------------------------------

type LooseEvent = Record<string, unknown>;
const asTrace = (events: LooseEvent[]): TraceEvent[] => events as unknown as TraceEvent[];

const SEARCH_QUERY = 'noise complaints';
const FETCH_ID = 'dataset:data.example.gov:abcd-1234';

/** A search, then a fetch — the two tools the registry can emit that `get_data` is not. */
const SEARCH_THEN_FETCH = asTrace([
  { relativeMs: 0, phase: 'analyze', message: 'Reading question and planning approach' },
  { relativeMs: 900, phase: 'tool_start', message: `Searching for datasets about "${SEARCH_QUERY}"`, iteration: 1, toolName: 'search', operationType: 'search', args: { query: SEARCH_QUERY } },
  { relativeMs: 2100, phase: 'tool_complete', message: `Searching for datasets about "${SEARCH_QUERY}"`, iteration: 1, toolName: 'search', operationType: 'search', duration_ms: 1200 },
  { relativeMs: 2200, phase: 'tool_result', message: 'Found 3 datasets matching the search', iteration: 1, toolName: 'search', operationType: 'search', resultSummary: { rows: 3, columns: 4 } },
  { relativeMs: 2500, phase: 'thinking', message: 'Evaluating results', iteration: 1 },
  // No `operationType`: the loop derives none for `fetch`, by design.
  { relativeMs: 3000, phase: 'tool_start', message: `Looking up ${FETCH_ID}`, iteration: 2, toolName: 'fetch', args: { id: FETCH_ID } },
  { relativeMs: 4100, phase: 'tool_complete', message: `Looking up ${FETCH_ID}`, iteration: 2, toolName: 'fetch', duration_ms: 1100 },
  { relativeMs: 4300, phase: 'thinking', message: 'Evaluating results', iteration: 2 },
  { relativeMs: 4800, phase: 'synthesize', message: 'Writing response based on collected data' },
]);

/** One tool call whose event carries no tool name at all — a fixture from before the field existed. */
const UNNAMED = asTrace([
  { relativeMs: 0, phase: 'tool_start', message: 'Step 1', iteration: 1, args: { query: 'noise' } },
  { relativeMs: 800, phase: 'tool_complete', message: 'Step 1', iteration: 1, duration_ms: 800 },
]);

const replay = (events: TraceEvent[]) => traceEventsToProgressData(events, events.length - 1, true);

// ---------------------------------------------------------------------------
// (b) The replay, present
// ---------------------------------------------------------------------------

test('replay: a search and a fetch are replayed by the names the trace recorded', () => {
  const { toolsCalled } = replay(SEARCH_THEN_FETCH);
  assert.equal(toolsCalled.length, 2, 'one tool call per tool_start');
  assert.equal(toolsCalled[0].name, 'search');
  assert.equal(toolsCalled[1].name, 'fetch');
});

test('replay: the operation type is the one the trace carried — present for the search, absent for the fetch', () => {
  const { toolsCalled } = replay(SEARCH_THEN_FETCH);
  assert.equal(toolsCalled[0].operationType, 'search');
  // Absent is absent: not 'unknown', not inferred from the identifier's shape.
  assert.equal(toolsCalled[1].operationType, undefined);
  // Green at base, pinned: the result summary still pairs with its call.
  assert.deepEqual(toolsCalled[0].resultSummary, { rows: 3, columns: 4 });
});

// ---------------------------------------------------------------------------
// (c) The replay, absent
// ---------------------------------------------------------------------------

test('replay: an event with no tool name yields an unnamed call — never get_data', () => {
  const { toolsCalled } = replay(UNNAMED);
  assert.equal(toolsCalled.length, 1, 'the call is still recorded (it has arguments)');
  const call = toolsCalled[0];
  // The property.
  assert.notEqual(call.name, 'get_data', 'a missing name is not filled in with get_data');
  // The proposed shape: absent, stated as absent.
  assert.equal(call.name, undefined, 'a missing name stays missing on the replayed call');
  assert.equal(call.operationType, undefined);
});

test('replay: the labels built from an unnamed call say so in words, never get_data', () => {
  const { toolsCalled } = replay(UNNAMED);
  const call = toolsCalled[0];

  const chip = buildBreadcrumbLabel(call, toolsCalled, 0);
  assert.equal(typeof chip, 'string', 'the chip renders as text');
  assert.ok(chip.length > 0, 'the chip is not empty — absence is stated, not blank');
  assert.doesNotMatch(chip, /get_data|undefined/, `the chip invents no name: ${chip}`);

  const summary = buildNarrativeSummary(toolsCalled);
  assert.doesNotMatch(summary, /get_data|undefined/, `the narrative invents no name: ${summary}`);
  assert.ok(summary.length > 'The AI .'.length, `the narrative says something: ${summary}`);
});

// ---------------------------------------------------------------------------
// The trace itself: fixtures and capture
// ---------------------------------------------------------------------------

test('every checked-in trace fixture names the tool on each tool_start event', () => {
  assert.ok(TRACES.length > 0, 'there are fixtures to check');
  for (const trace of TRACES) {
    for (const ev of trace.events) {
      if (ev.phase !== 'tool_start') continue;
      assert.equal(
        typeof (ev as unknown as LooseEvent).toolName,
        'string',
        `${trace.id} @${ev.relativeMs}ms: a tool_start event carries the tool name it was recorded from`,
      );
    }
  }
});

test('capture-trace: the capture records the toolName and operationType the wire carried', () => {
  const capture = createTraceCapture('question', 'fake/model', 'data.example.gov');
  type RecordEventInput = Parameters<typeof capture.recordEvent>[0];
  capture.recordEvent({
    phase: 'tool_start',
    message: 'Calling search...',
    iteration: 1,
    args: { query: SEARCH_QUERY },
    toolName: 'search',
    operationType: 'search',
  } as unknown as RecordEventInput);

  const [recorded] = capture.exportTrace().events as unknown as LooseEvent[];
  assert.equal(recorded.toolName, 'search', 'the captured event keeps the tool name');
  assert.equal(recorded.operationType, 'search', 'the captured event keeps the operation type');
});

// ---------------------------------------------------------------------------
// (d) The group label — the seventh switch, in the comparison hook
// ---------------------------------------------------------------------------

const entry = (fields: LooseEvent): ProgressLogEntry =>
  ({ timestamp: 0, phase: 'tool_start', iteration: 1, ...fields }) as unknown as ProgressLogEntry;

test('generateGroupLabel: a search group says it is a search, never "Running query"', () => {
  const label = generateGroupLabel(
    [entry({ message: 'Calling search...', args: { query: SEARCH_QUERY }, toolName: 'search', operationType: 'search' })],
    [],
  );
  assert.notEqual(label, 'Running query', 'a search did not run a query');
  assert.match(label, /search/i, `names what a search is: ${label}`);
});

test('generateGroupLabel: the label comes from the recorded name, not from keywords in the message', () => {
  // An opaque message defeats the keyword fallback ("searching" + "catalog",
  // "querying", ...). Only the name can tell the label what this group did.
  const label = generateGroupLabel(
    [entry({ message: 'Step 1', args: { query: SEARCH_QUERY }, toolName: 'search', operationType: 'search' })],
    [],
  );
  assert.notEqual(label, 'Running query');
  assert.match(label, /search/i, `derived from the name: ${label}`);
});

test('generateGroupLabel: a group with no name and no args.type does not claim a query ran', () => {
  const label = generateGroupLabel([entry({ message: 'Step 1', args: { query: 'noise' } })], []);
  assert.notEqual(label, 'Running query', 'nothing recorded says a query ran');
  assert.ok(label.length > 0, 'the group still has a label');
});

// ---------------------------------------------------------------------------
// (e) The card
// ---------------------------------------------------------------------------

/** The operation-type badge: the uppercase span whose text is the operation type. */
function renderBadge(opType: string): { tooltip: string | undefined; style: string } {
  const html = renderToStaticMarkup(
    createElement(ToolCallCard, { stepNumber: 1, name: 'search', args: { query: SEARCH_QUERY }, operationType: opType }),
  );
  const badge = html.match(new RegExp(`<span([^>]*text-transform:uppercase[^>]*)>${opType}</span>`));
  assert.ok(badge, `the badge span for "${opType}" renders`);
  const attrs = badge![1];
  return {
    tooltip: attrs.match(/data-tooltip="([^"]*)"/)?.[1],
    style: attrs.match(/style="([^"]*)"/)?.[1] ?? '',
  };
}

test('ToolCallCard: a search badge has a tooltip', () => {
  const { tooltip } = renderBadge('search');
  assert.ok(tooltip && tooltip.length > 0, 'data-tooltip is defined for a search step');
});

test('ToolCallCard: a search badge has an entry of its own, painted in tokens', () => {
  const search = renderBadge('search');
  const unknown = renderBadge('zz_unknown_operation');
  assert.notEqual(search.style, unknown.style, 'search is not painted with the no-entry fallback');
  assert.doesNotMatch(search.style, /#[0-9a-f]{3,8}\b/i, `design tokens by name, never hex: ${search.style}`);
  // Green at base, pinned: an operation the card does not know gets no
  // tooltip — absence, not a borrowed sentence.
  assert.equal(unknown.tooltip, undefined);
});
