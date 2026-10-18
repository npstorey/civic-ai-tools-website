// LAYOUT-WEB W2 P1: the comparison's steps render the same bytes after the
// grouping and labelling moved out of `useStreamingComparison` into
// `src/lib/answer-view/steps.ts`.
//
// WHAT IS COMPARED. A fixture run — stream events, as `/api/compare-stream`
// sends them — is driven event by event through the hook's own handler
// (`handleComparisonEvent`), which folds each one into the panel state through
// the step module. At marked points the with-data panel is rendered through
// `ProgressLog`, as `McpResponseDisplay` renders it: the streaming view (its
// groups and standalone entries; active and idle), and after `complete` the
// completed summary, the same with "Show all steps" open (every call's card,
// paired to its step by `mapGroupsToToolCalls`), and the same with every card
// open. The concatenated markup must equal `comparison-steps-render.golden.txt`
// byte for byte.
//
// THE GOLDEN WAS NOT WRITTEN BY HAND. It is this file's output on the base
// (website main 4598f55), where the accumulation was private to the hook: a
// scratch commit, not on this branch, added one line to the base hook —
// `export { handleEvent as handleComparisonEvent };` — and this file, unchanged,
// was run there with `STEP_RENDER_ACTUAL_OUT` set; the markup it wrote is the
// golden. So the golden is the base's code rendering the base's steps.
//
// THE FIXTURE CAN FAIL. Two runs. The first has five iterations: a search with
// a query (exposed name, `socrata__search`); two calls in one step, an aliased
// `socrata__get_data` with its operation type and a rejected call (`failed`,
// `failureKind`) on a dataset no other call touches; a tool that derives no
// operation type (`nyc_charter__get_section`); a `fetch`; and an entry that
// carries no tool name (the message fallback). Each `tool_start` is paired by
// a `tool_complete`; the steps are closed by `thinking` (1, 2), by the first
// answer token (3) and by `complete` (4, 5). The second run is closed by an
// `error`. Every label branch the fixture claims is also asserted on the
// rendered markup, so a fixture that stopped reaching a branch says so.
//
// INTERACTION STATE. `renderToStaticMarkup` renders initial state only, and
// "Show all steps" and a card's body open on a click. For the two components
// this test renders, a `useState(false)` can start `true` instead: the hooks
// below hand `ProgressLog.tsx` and `ToolCallCard.tsx` a `react` whose
// `useState(false)` reads that override, and nothing else. In
// `ProgressLog.tsx` that is "Show all steps" (`showAll`), in `ToolCallCard.tsx`
// the card's body (`expanded`); each is the only `useState(false)` in its file,
// and the markup is checked for what each opens ("Hide steps", the tool name).
//
// A CLAIM CHECKED IN NODE, NOT IN A BROWSER: this reads server-rendered markup.
//
// HOW IT IS DRIVEN: as `chat-notebook-output-layout.test.ts` is —
// `module.registerHooks()` maps `@/` to `src/`, resolves extensionless relative
// specifiers under `src/`, and runs `.ts`/`.tsx` under `src/` through
// `typescript.transpileModule` (`jsx: react-jsx`).
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/comparison-steps-render.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
// Typed here because the installed `@types/node` predates `registerHooks`.
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const GOLDEN = path.join(HERE, 'comparison-steps-render.golden.txt');

/** The files whose `useState(false)` may start open, and the override's own module. */
const OVERRIDABLE = ['ProgressLog.tsx', 'ToolCallCard.tsx'] as const;
type Overridable = (typeof OVERRIDABLE)[number];
const OVERRIDE_PARAM = 'initial-state-override';
const OVERRIDE_MODULE = path.join(HERE, '__initial_state_override__.mjs');
const opened = new Set<Overridable>();
(globalThis as { __stepRenderOpened?: Set<Overridable> }).__stepRenderOpened = opened;

function firstFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}

function candidatesFor(base: string): string[] {
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
}

function overrideSource(file: Overridable): string {
  return [
    "import * as React from 'react';",
    "export * from 'react';",
    'export default React.default ?? React;',
    `const FILE = ${JSON.stringify(file)};`,
    'export function useState(initial) {',
    '  const opened = globalThis.__stepRenderOpened;',
    '  if (initial === false && opened !== undefined && opened.has(FILE)) return React.useState(true);',
    '  return React.useState(initial);',
    '}',
  ].join('\n');
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier === 'react' && parent?.startsWith('file:')) {
      const file = path.basename(fileURLToPath(parent));
      if ((OVERRIDABLE as readonly string[]).includes(file) && fileURLToPath(parent).startsWith(SRC)) {
        const url = `${pathToFileURL(OVERRIDE_MODULE).href}?${OVERRIDE_PARAM}=${encodeURIComponent(file)}`;
        return { url, shortCircuit: true };
      }
    }
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`steps render test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && parent?.startsWith('file:') && fileURLToPath(parent).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(parent)), specifier)));
      if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith('file:')) {
      const url = new URL(loadUrl);
      const overridden = url.searchParams.get(OVERRIDE_PARAM);
      if (overridden !== null) {
        assert.ok((OVERRIDABLE as readonly string[]).includes(overridden), `unknown override ${overridden}`);
        return { format: 'module', source: overrideSource(overridden as Overridable), shortCircuit: true };
      }
      const file = fileURLToPath(loadUrl);
      if (file.startsWith(SRC) && /\.tsx?$/.test(file)) {
        const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          fileName: file,
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        });
        return { format: 'module', source: out.outputText, shortCircuit: true };
      }
    }
    return nextLoad(loadUrl, context);
  },
});

type Hook = typeof import('../hooks/useStreamingComparison.ts');
const { handleComparisonEvent } = (await import('../hooks/useStreamingComparison.ts')) as Hook;
const { default: ProgressLog } = (await import('./ProgressLog.tsx')) as unknown as {
  default: ComponentType<Record<string, unknown>>;
};

// --- The state the hook holds --------------------------------------------------

type Dispatch = Parameters<Hook['handleComparisonEvent']>[1];
type State = Exclude<Parameters<Dispatch>[0], (...args: never[]) => unknown>;
type StreamEvent = Parameters<Hook['handleComparisonEvent']>[0];

function initialState(): State {
  const panel = { content: '', progress: null, progressLog: [], progressGroups: [], isComplete: false };
  return {
    withoutMcp: { ...panel },
    withMcp: { ...panel },
    isLoading: true,
    error: null,
    evidenceTrace: null,
    mcpOnly: false,
  };
}

// --- Fixture -------------------------------------------------------------------

const PORTAL = 'data.cityofnewyork.us';
const ANSWERED = { type: 'query', dataset_id: 'erm2-nwe9', portal: PORTAL, select: 'count(*)', where: "borough = 'QUEENS'" };
// The rejected call's dataset: no other call in the fixture touches it.
const REJECTED = { type: 'query', dataset_id: 'qq7x-k2rd', portal: PORTAL, select: 'count(*)' };
const SECTION = { section: '24-218' };
const FETCHED = { id: 'record:data.cityofnewyork.us/erm2-nwe9/58431' };
const UNNAMED = { type: 'query', dataset_id: '43nn-pn8j', portal: PORTAL, select: 'grade, count(*)', group: 'grade' };

/** One fixture step: a stream event, and the snapshot to take after it. */
interface Step { event: Omit<StreamEvent, 'panel'>; snap?: string }

const progress = (fields: Record<string, unknown>): Omit<StreamEvent, 'panel'> => ({ type: 'progress', ...fields });

const COMPLETED_RUN: Step[] = [
  { event: progress({ message: 'Analyzing your question...', phase: 'analyze' }) },
  // Iteration 1: a search with a query, closed by `thinking`.
  { event: progress({ message: 'Searching for datasets about "noise complaints"...', phase: 'tool_start', iteration: 1, toolName: 'socrata__search', operationType: 'search', args: { query: 'noise complaints' } }), snap: 'search-open' },
  { event: progress({ message: 'Searching for datasets about "noise complaints"...', phase: 'tool_complete', iteration: 1, toolName: 'socrata__search', operationType: 'search', duration_ms: 840 }) },
  { event: progress({ message: 'Found 4 datasets', phase: 'tool_result', iteration: 1, toolName: 'socrata__search', operationType: 'search' }) },
  { event: progress({ message: 'Thinking...', phase: 'thinking', iteration: 1 }), snap: 'search-closed-by-thinking' },
  // Iteration 2: two calls — an aliased get_data, and a rejection — closed by `thinking`.
  { event: progress({ message: 'Counting 311 Service Requests...', phase: 'tool_start', iteration: 2, toolName: 'socrata__get_data', operationType: 'query', args: ANSWERED }) },
  { event: progress({ message: 'Counting records in qq7x-k2rd...', phase: 'tool_start', iteration: 2, toolName: 'socrata__get_data', operationType: 'query', args: REJECTED }), snap: 'two-calls-in-flight' },
  { event: progress({ message: 'Counting 311 Service Requests...', phase: 'tool_complete', iteration: 2, toolName: 'socrata__get_data', operationType: 'query', duration_ms: 1210 }) },
  { event: progress({ message: 'Counted 4,812 records', phase: 'tool_result', iteration: 2, toolName: 'socrata__get_data', operationType: 'query' }) },
  { event: progress({ message: 'Counting records in qq7x-k2rd...', phase: 'tool_complete', iteration: 2, toolName: 'socrata__get_data', operationType: 'query', duration_ms: 3050, failed: true, failureKind: 'timeout' }) },
  { event: progress({ message: 'The request did not complete: the source did not answer in time.', phase: 'tool_result', iteration: 2, toolName: 'socrata__get_data', operationType: 'query', failed: true, failureKind: 'timeout' }), snap: 'rejection-paired' },
  { event: progress({ message: 'Thinking...', phase: 'thinking', iteration: 2 }), snap: 'two-calls-closed-by-thinking' },
  // Iteration 3: a tool that derives no operation type, closed by the first answer token.
  { event: progress({ message: 'Calling get_section...', phase: 'tool_start', iteration: 3, toolName: 'nyc_charter__get_section', args: SECTION }) },
  { event: progress({ message: 'Calling get_section...', phase: 'tool_complete', iteration: 3, toolName: 'nyc_charter__get_section', duration_ms: 310 }), snap: 'untyped-paired' },
  { event: progress({ message: 'Composing the answer...', phase: 'synthesize' }) },
  { event: { type: 'token', content: 'Queens recorded ' }, snap: 'untyped-closed-by-token' },
  // Iterations 4 and 5: a fetch, and an entry with no tool name, closed by `complete`.
  { event: progress({ message: 'Looking up record...', phase: 'tool_start', iteration: 4, toolName: 'fetch', args: FETCHED }) },
  { event: progress({ message: 'Looking up record...', phase: 'tool_complete', iteration: 4, toolName: 'fetch', duration_ms: 150 }) },
  { event: progress({ message: 'Querying restaurant inspections by grade...', phase: 'tool_start', iteration: 5, args: UNNAMED }), snap: 'fetch-and-unnamed-open' },
  { event: progress({ message: 'Querying restaurant inspections by grade...', phase: 'tool_complete', iteration: 5, duration_ms: 620 }) },
  {
    event: {
      type: 'complete',
      data: {
        content: 'Queens recorded 4,812 noise complaints (dataset erm2-nwe9).',
        duration_ms: 9400,
        tokens_used: 2100,
        tools_called: [
          { name: 'socrata__search', args: { query: 'noise complaints' }, operationType: 'search', duration_ms: 840, reason: 'to find datasets about noise complaints' },
          { name: 'socrata__get_data', args: ANSWERED, operationType: 'query', duration_ms: 1210, resultSummary: { rows: 1, columns: 1 }, reason: 'to count Queens noise complaints' },
          { name: 'socrata__get_data', args: REJECTED, operationType: 'query', duration_ms: 3050, failed: true, failureKind: 'timeout', reason: 'to count the second dataset' },
          { name: 'nyc_charter__get_section', args: SECTION, duration_ms: 310, reason: 'to read the section on noise' },
          { name: 'fetch', args: FETCHED, duration_ms: 150, reason: 'to look up record:data.cityofnewyork.us/erm2-nwe9/58431' },
          // No name: a call replayed from a record that did not carry one.
          { args: UNNAMED, operationType: 'query', duration_ms: 620, resultSummary: { rows: 0, columns: 2 } },
        ],
      },
    },
    snap: 'complete',
  },
];

const ERRORED_RUN: Step[] = [
  { event: progress({ message: 'Analyzing your question...', phase: 'analyze' }) },
  { event: progress({ message: 'Counting 311 Service Requests...', phase: 'tool_start', iteration: 1, toolName: 'socrata__get_data', operationType: 'query', args: ANSWERED }), snap: 'open' },
  { event: { type: 'error', message: 'The model endpoint closed the stream.' }, snap: 'closed-by-error' },
];

// --- Rendering -----------------------------------------------------------------

type Panel = State['withMcp'];

function streamingView(panel: Panel, isActive: boolean): string {
  return renderToStaticMarkup(createElement(ProgressLog, {
    groups: panel.progressGroups,
    standaloneEntries: panel.progressLog.filter((e) => !e.iteration),
    variant: 'with-mcp',
    isActive,
  }));
}

function completedView(panel: Panel, open: Overridable[]): string {
  opened.clear();
  for (const file of open) opened.add(file);
  try {
    return renderToStaticMarkup(createElement(ProgressLog, {
      groups: panel.progressGroups,
      standaloneEntries: panel.progressLog.filter((e) => !e.iteration),
      variant: 'with-mcp',
      isActive: false,
      isComplete: panel.isComplete && (panel.tools_called ?? []).length > 0,
      toolsCalled: panel.isComplete ? panel.tools_called : undefined,
      totalDuration_ms: panel.isComplete ? panel.duration_ms : undefined,
    }));
  } finally {
    opened.clear();
  }
}

function renderRun(name: string, steps: Step[]): string {
  let state = initialState();
  const setState: Dispatch = (update) => {
    state = typeof update === 'function' ? update(state) : update;
  };
  const sections: string[] = [];
  for (const { event, snap } of steps) {
    handleComparisonEvent({ ...event, panel: 'withMcp' } as StreamEvent, setState);
    if (snap === undefined) continue;
    const panel = state.withMcp;
    sections.push(`=== ${name}/${snap}/streaming-active ===\n${streamingView(panel, true)}`);
    sections.push(`=== ${name}/${snap}/streaming-idle ===\n${streamingView(panel, false)}`);
    if (panel.isComplete && (panel.tools_called ?? []).length > 0) {
      sections.push(`=== ${name}/${snap}/completed ===\n${completedView(panel, [])}`);
      sections.push(`=== ${name}/${snap}/completed-all-steps ===\n${completedView(panel, ['ProgressLog.tsx'])}`);
      sections.push(`=== ${name}/${snap}/completed-all-steps-cards-open ===\n${completedView(panel, ['ProgressLog.tsx', 'ToolCallCard.tsx'])}`);
    }
  }
  return sections.join('\n');
}

const actual = `${renderRun('completed-run', COMPLETED_RUN)}\n${renderRun('errored-run', ERRORED_RUN)}\n`;

if (process.env.STEP_RENDER_ACTUAL_OUT) fs.writeFileSync(process.env.STEP_RENDER_ACTUAL_OUT, actual);

function section(markup: string, name: string): string {
  const start = markup.indexOf(`=== ${name} ===\n`);
  assert.ok(start !== -1, `no section ${name}`);
  const end = markup.indexOf('\n=== ', start + 1);
  return markup.slice(start, end === -1 ? undefined : end);
}

// --- The fixture reaches what it claims -------------------------------------------

test('steps render: the fixture reaches every label branch, the rejection and both opened states', () => {
  const thinking = section(actual, 'completed-run/two-calls-closed-by-thinking/streaming-idle');
  assert.match(thinking, /Searching for datasets about &quot;noise complaints&quot;/, 'step 1 (search, closed by thinking) is labelled by its query');
  assert.match(thinking, /Querying multiple datasets/, 'step 2 (two calls, closed by thinking) is labelled as two queries');
  assert.match(section(actual, 'completed-run/untyped-paired/streaming-idle'), />Gathering data</, 'an open step carries the provisional label');
  assert.match(section(actual, 'completed-run/untyped-closed-by-token/streaming-idle'), /Calling get_section/, 'step 3 (no operation type, closed by token) is labelled by its upstream name');
  const complete = section(actual, 'completed-run/complete/streaming-idle');
  assert.match(complete, /Looking up record:data\.cityofnewyork\.us\/erm2-nwe9\/58431/, 'step 4 (fetch, closed by complete) names what was asked for');
  assert.match(complete, /Querying data/, 'step 5 (no tool name, closed by complete) falls back to its message');
  assert.match(section(actual, 'completed-run/rejection-paired/streaming-active'), /var\(--error\)/, 'the paired rejection reads as rejected in its step');
  const allSteps = section(actual, 'completed-run/complete/completed-all-steps');
  assert.match(allSteps, /Hide steps/, 'the override opened "Show all steps"');
  assert.match(allSteps, /Did not complete/, 'the rejected call’s card says so');
  const cardsOpen = section(actual, 'completed-run/complete/completed-all-steps-cards-open');
  assert.match(cardsOpen, /\(not recorded\)/, 'the override opened the cards: the unnamed call’s body says its name is not recorded');
  assert.match(cardsOpen, />get_data</, 'an aliased name is shown by its upstream name');
  assert.doesNotMatch(cardsOpen, /socrata__/, 'no card shows an aliased name');
  assert.match(section(actual, 'errored-run/closed-by-error/streaming-idle'), />Gathering data</, 'a step closed by an error keeps its label');
});

// --- The bytes ---------------------------------------------------------------------

test('steps render: the comparison’s step markup equals the golden captured on the base', () => {
  assert.ok(fs.existsSync(GOLDEN), `no golden at ${GOLDEN}; it is captured on the base, never written by hand`);
  const golden = fs.readFileSync(GOLDEN, 'utf8');
  if (actual === golden) return;
  const headers = (markup: string) => markup.split('\n').filter((line) => line.startsWith('=== '));
  assert.deepEqual(headers(actual), headers(golden), 'the rendered sections differ from the golden’s');
  for (const header of headers(golden)) {
    const name = header.slice(4, -4);
    const want = section(golden, name);
    const got = section(actual, name);
    if (want === got) continue;
    let at = 0;
    while (at < want.length && want[at] === got[at]) at++;
    assert.fail(
      `${name} differs from the golden at character ${at}:\n` +
        `  golden: …${want.slice(Math.max(0, at - 60), at + 80)}…\n` +
        `  actual: …${got.slice(Math.max(0, at - 60), at + 80)}…`,
    );
  }
  assert.fail('the markup differs from the golden outside every section');
});
