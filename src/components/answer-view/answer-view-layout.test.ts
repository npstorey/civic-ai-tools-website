// LAYOUT-WEB W3 P1: the two run surfaces render through one view.
//
// THE VIEW, in this order, by position in the rendered markup (design §4.1):
//   1. the status row, one line, with the refused-request line under it;
//   2. the answer, with its author line;
//   3. the citation;
//   4. the steps;
//   5. the sources line ("Rows returned by <portal host>");
//   6. one disclosure, "Learn more about how this analysis was produced";
//   7. the actions.
// Each part that design §6 names carries its author line in §6's words.
//
// WHAT IS DRIVEN. Each surface as a reader meets it, rendered to static markup
// with `react-dom/server` under `node --test`:
//   - the comparison: a fixture run's stream events folded by the hook's own
//     handler (`handleComparisonEvent`), and the panel state it produced
//     rendered through `ComparisonDisplay`, the component the page mounts;
//   - the executed run: a fixture run's stream events read by the real
//     `useNotebookStream` (driven outside React, as
//     `chat-notebook-output-layout.test.ts` drives it), and the state it
//     produced rendered through `NotebookOutput`, the component the page mounts.
// The harness is the one `chat-notebook-output-layout.test.ts` uses: in-file
// `module.registerHooks()` maps `@/` to `src/` and runs `.ts`/`.tsx` under
// `src/` through `typescript.transpileModule`.
//
// A CLAIM CHECKED IN NODE, NOT IN A BROWSER: this reads server-rendered markup.
// A closed `<details>` keeps its children in that markup.
//
// THE FIXTURES CAN FAIL. Every part is present and carries content of its own;
// the author lines are computed from §6's words with the fixture's instance and
// model, so a literal cannot stand in for one; the aliased-name fixtures carry
// an aliased tool in the composed prompt, in the answer, and a `ckan__` call.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/answer-view/answer-view-layout.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionProvider } from 'next-auth/react';

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
const SRC = path.resolve(HERE, '..', '..');

// The executed run's hook is driven outside React: FOR THE HOOK MODULE ONLY,
// `react` is a state cell and `@/lib/sse-client` hands it the fixture's events.
const HOOK_FILE = path.join(SRC, 'hooks/useNotebookStream.ts');
const HOOK_STUB_PREFIX = 'file:///layout-web-w3-p1-hook-stub/';
const HOOK_STUBS: Record<string, string> = {
  react: `
    export function useState(initial) {
      globalThis.__w3p1Hook.state = typeof initial === 'function' ? initial() : initial;
      const set = (update) => {
        globalThis.__w3p1Hook.state = typeof update === 'function' ? update(globalThis.__w3p1Hook.state) : update;
      };
      return [globalThis.__w3p1Hook.state, set];
    }
    export function useCallback(fn) { return fn; }
    export function useRef(value) { return { current: value }; }`,
  '@/lib/sse-client': `
    export async function connectSSE({ onEvent, onComplete }) {
      for (const event of globalThis.__w3p1Hook.events) onEvent(event);
      if (onComplete) onComplete();
    }`,
};

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

registerHooks({
  resolve(specifier, context, nextResolve) {
    const from = (context as { parentURL?: string }).parentURL;
    if (from?.startsWith('file:') && fileURLToPath(from) === HOOK_FILE && specifier in HOOK_STUBS) {
      return { url: `${HOOK_STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    if (/^next\/[a-z-]+$/.test(specifier) && specifier !== 'next/server') return nextResolve(`${specifier}.js`, context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`answer-view test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && from?.startsWith('file:') && fileURLToPath(from).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(from)), specifier)));
      if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith(HOOK_STUB_PREFIX)) {
      const key = decodeURIComponent(loadUrl.slice(HOOK_STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: HOOK_STUBS[key], shortCircuit: true };
    }
    if (loadUrl.startsWith('file:')) {
      const file = fileURLToPath(loadUrl);
      if (file.startsWith(SRC) && /\.tsx?$/.test(file)) {
        const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          fileName: file,
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        });
        return { format: 'module', source: out.outputText, shortCircuit: true };
      }
    }
    return nextLoad(loadUrl, context);
  },
});

type AnyComponent = ComponentType<Record<string, unknown>>;
const { default: ComparisonDisplay } = (await import('@/components/ComparisonDisplay')) as unknown as { default: AnyComponent };
const { default: NotebookOutput } = (await import('@/components/notebook/NotebookOutput')) as unknown as { default: AnyComponent };
const { default: ChatNotebookOutput } = (await import('@/components/notebook/ChatNotebookOutput')) as unknown as { default: AnyComponent };
const { EvidenceOriginProvider } = (await import('@/components/EvidenceOriginProvider')) as unknown as {
  EvidenceOriginProvider: ComponentType<{ value: Record<string, string | null>; children?: ReactNode }>;
};
const { handleComparisonEvent } = (await import('@/hooks/useStreamingComparison')) as unknown as {
  handleComparisonEvent: (event: Record<string, unknown>, set: (update: unknown) => void) => void;
};
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG, runRecordAttributes } = await import('@/lib/evidence/trace');
const { formatModelName } = await import('@/lib/models');
const { readNotebookProvenanceOfNotebook } = await import('@/lib/notebook-author/notebook-provenance-reading');
const { upstreamToolName } = await import('@/lib/mcp/operation-types');

// --- The fixture's identity ------------------------------------------------------

const INSTANCE = 'instance.example.test';
const MODEL = 'fixture/model-w3p1';
const PORTAL = 'portal.example.test';
const QUESTION = 'QUESTIONMARKER-w3p1 How many complaints were filed?';
const DISCLOSURE_LABEL = 'Learn more about how this analysis was produced';

// §6's words, with the fixture's instance and model: the vocabulary each
// author line is checked against. A line the view writes differently fails.
const SECTION_6 = {
  question: 'Question, written by you',
  answer: `Answer, written by the model ${formatModelName(MODEL)}`,
  computed: 'Tables and figures, computed in the sandbox from the data returned',
  steps: `Steps, written by ${INSTANCE} from the model's calls`,
  sources: `Rows returned by ${PORTAL}`,
  summaryByModel: 'Summary, written by the model',
  summaryDerived: `Summary, derived by ${INSTANCE} from the answer`,
  citation: `Citation, assembled by ${INSTANCE}`,
  instructions: `Instructions, written by ${INSTANCE} and the data source's skill`,
  timing: `Measured by ${INSTANCE}`,
};

// --- Providers -------------------------------------------------------------------

function withProviders(element: ReactNode, instance: string | null = INSTANCE): string {
  const origin = createElement(EvidenceOriginProvider, {
    value: { origin: instance ? `https://${instance}` : null, host: instance, platformTitle: null },
  }, element);
  const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;
  return renderToStaticMarkup(createElement(Session, { session: null }, origin));
}

// --- Markup readers --------------------------------------------------------------

function elementEnd(html: string, start: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error(`no closing </${tag}> for the element at ${start}`);
}

function at(html: string, needle: string, from = 0): number {
  const i = html.indexOf(needle, from);
  assert.ok(i >= 0, `the markup does not contain ${JSON.stringify(needle)}`);
  return i;
}

function occurrences(html: string, needle: string): number[] {
  const found: number[] = [];
  for (let i = html.indexOf(needle); i >= 0; i = html.indexOf(needle, i + 1)) found.push(i);
  return found;
}

interface Disclosure { start: number; end: number; openTag: string; summaryText: string }

function requireDisclosure(html: string): Disclosure {
  const re = /<details\b[^>]*>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const summary = /^<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(html.slice(m.index + m[0].length));
    if (summary === null) continue;
    const summaryText = summary[1].replace(/<[^>]*>/g, '');
    if (summaryText !== DISCLOSURE_LABEL) continue;
    return { start: m.index, end: elementEnd(html, m.index, 'details'), openTag: m[0], summaryText };
  }
  assert.fail(`no <details> whose summary reads "${DISCLOSURE_LABEL}" is rendered`);
}

/** The text of every author line, by its key, in document order. */
function authorLines(html: string): Array<{ key: string; text: string; at: number }> {
  return [...html.matchAll(/<(\w+)\b[^>]*\bdata-author="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => ({ key: m[2], text: unescape(m[3].replace(/<!-- -->/g, '').replace(/<[^>]*>/g, '')), at: m.index ?? -1 }));
}

function unescape(text: string): string {
  return text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The element `<tag … data-part="name"…>` that opens first, or a failure saying there is none. */
function part(html: string, name: string, from = 0): { start: number; end: number; markup: string } {
  const re = new RegExp(`<(\\w+)\\b[^>]*\\bdata-part="${name}"[^>]*>`, 'g');
  re.lastIndex = from;
  const m = re.exec(html);
  assert.ok(m !== null, `no element with data-part="${name}" is rendered`);
  const end = elementEnd(html, m.index, m[1]);
  return { start: m.index, end, markup: html.slice(m.index, end) };
}

const SEVEN = ['status-row', 'answer', 'citation', 'steps', 'sources', 'disclosure', 'actions'] as const;

/** Each of the seven parts' first position; the disclosure is found by its label. */
function partPositions(html: string): number[] {
  return SEVEN.map((name) => (name === 'disclosure' ? requireDisclosure(html).start : part(html, name).start));
}

// --- The comparison: a fixture run, driven through the hook's handler ------------

const SYSTEM_PROMPT_HASH_MARKER = 'b'.repeat(64);
const MCP_SERVER_HOST = 'mcp-fixture.example.test';
const ANSWERED = { type: 'query', dataset_id: 'erm2-nwe9', portal: PORTAL, select: 'count(*)', where: "borough = 'QUEENS'" };
const REJECTED = { type: 'query', dataset_id: 'qq7x-k2rd', portal: PORTAL, select: 'count(*)' };
const SCHEMA = { resource_id: 'res-0001' };
const COMPARISON_ANSWER = 'COMPARISONANSWER-w3p1: **4,812** complaints. The analysis called socrata__get_data twice.';

function comparisonTrace(): Record<string, unknown> {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  const skill = builder.startSpan('skill_fetch');
  builder.endSpan(skill, { 'skill.text_hash': SYSTEM_PROMPT_HASH_MARKER });
  builder.endRoot(runRecordAttributes({
    assertedDate: '2026-10-18',
    mcpServers: [{ url: `https://${MCP_SERVER_HOST}/mcp`, name: 'socrata' }],
    toolDefinitions: [],
    sourcesOffered: [],
    components: [],
  }));
  return builder.finalize() as unknown as Record<string, unknown>;
}

const progress = (fields: Record<string, unknown>) => ({ type: 'progress', ...fields });

function comparisonEvents(answer: string): Array<Record<string, unknown>> {
  return [
    progress({ message: 'Analyzing your question...', phase: 'analyze' }),
    progress({ message: 'Searching for datasets about "noise"...', phase: 'tool_start', iteration: 1, toolName: 'socrata__search', operationType: 'search', args: { query: 'noise' } }),
    progress({ message: 'Searching for datasets about "noise"...', phase: 'tool_complete', iteration: 1, toolName: 'socrata__search', operationType: 'search', duration_ms: 840 }),
    progress({ message: 'Thinking...', phase: 'thinking', iteration: 1 }),
    progress({ message: 'Counting 311 Service Requests...', phase: 'tool_start', iteration: 2, toolName: 'socrata__get_data', operationType: 'query', args: ANSWERED }),
    progress({ message: 'Counting records in qq7x-k2rd...', phase: 'tool_start', iteration: 2, toolName: 'socrata__get_data', operationType: 'query', args: REJECTED }),
    progress({ message: 'Counting 311 Service Requests...', phase: 'tool_complete', iteration: 2, toolName: 'socrata__get_data', operationType: 'query', duration_ms: 1210 }),
    progress({ message: 'Counting records in qq7x-k2rd...', phase: 'tool_complete', iteration: 2, toolName: 'socrata__get_data', operationType: 'query', duration_ms: 3050, failed: true, failureKind: 'timeout' }),
    progress({ message: 'Thinking...', phase: 'thinking', iteration: 2 }),
    progress({ message: 'Reading the schema...', phase: 'tool_start', iteration: 3, toolName: 'boston__ckan__get_schema', operationType: 'metadata', args: SCHEMA }),
    progress({ message: 'Reading the schema...', phase: 'tool_complete', iteration: 3, toolName: 'boston__ckan__get_schema', operationType: 'metadata', duration_ms: 300 }),
    { type: 'token', content: answer },
    {
      type: 'complete',
      data: {
        content: answer,
        duration_ms: 9400,
        tokens_used: 2100,
        prompt_tokens: 1800,
        completion_tokens: 300,
        tools_called: [
          { name: 'socrata__search', args: { query: 'noise' }, operationType: 'search', duration_ms: 840, reason: 'to find datasets about "noise"' },
          { name: 'socrata__get_data', args: ANSWERED, operationType: 'query', duration_ms: 1210, resultSummary: { rows: 1, columns: 1 }, reason: 'to count complaints' },
          { name: 'socrata__get_data', args: REJECTED, operationType: 'query', duration_ms: 3050, failed: true, failureKind: 'timeout', reason: 'to count permits' },
          { name: 'boston__ckan__get_schema', args: SCHEMA, operationType: 'metadata', duration_ms: 300, reason: 'to understand dataset structure' },
        ],
      },
    },
    { type: 'trace', data: comparisonTrace() },
  ];
}

interface ComparisonState { withMcp: Record<string, unknown>; evidenceTrace: unknown }

function comparisonState(answer: string): ComparisonState {
  const panel = { content: '', progress: null, progressLog: [], progressGroups: [], isComplete: false };
  let state: Record<string, unknown> = {
    withoutMcp: { ...panel }, withMcp: { ...panel }, isLoading: true, error: null, evidenceTrace: null, mcpOnly: true,
  };
  const set = (update: unknown) => {
    state = typeof update === 'function' ? (update as (s: typeof state) => typeof state)(state) : update as typeof state;
  };
  for (const event of comparisonEvents(answer)) handleComparisonEvent({ ...event, panel: 'withMcp' }, set);
  return state as unknown as ComparisonState;
}

function renderComparison(state: ComparisonState, options: { answerFirst?: boolean; instance?: string | null } = {}): string {
  return withProviders(createElement(ComparisonDisplay, {
    withoutMcp: null,
    withMcp: null,
    isLoading: false,
    modelName: 'Fixture model',
    isStreaming: true,
    streamingWithoutMcp: { content: '', progress: null, progressLog: [], progressGroups: [], isComplete: false },
    streamingWithMcp: state.withMcp,
    queryText: QUESTION,
    portal: PORTAL,
    model: MODEL,
    evidenceTrace: state.evidenceTrace,
    answerFirst: options.answerFirst ?? true,
  }), options.instance === undefined ? INSTANCE : options.instance);
}

const COMPARISON_STATE = comparisonState(COMPARISON_ANSWER);
const COMPARISON = renderComparison(COMPARISON_STATE);

// --- The executed run: a fixture run, read by the real hook ------------------------

const RUN_ANSWER = 'RUNANSWER-w3p1: **42** complaints. The notebook called socrata__get_data.';
const TABLE_MARKER = 'TABLEMARKER-w3p1';
const COMPOSED_PROMPT = 'SYSTEMPROMPTMARKER-w3p1. Call socrata__get_data with type=query to count rows.';

function notebookWith(outputs: unknown[], provenance: string | null, summary = true): Record<string, unknown> {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      extensions: {
        ...(summary ? { 'org.civicaitools.summary': { analysisDescription: 'SUMMARYDESC-w3p1', headlineFinding: 'SUMMARYFINDING-w3p1' } } : {}),
        'org.civicaitools.execution': {
          executedAt: '2026-10-18T12:00:00Z',
          executionDuration_ms: 4200,
          sandboxId: 'fixture-sandbox',
          environment: { python: 'PYTHONMARKER-w3p1', libraries: { pandas: '2.2.3' } },
        },
        ...(provenance !== null ? { 'org.civicaitools.notebook': { provenance } } : {}),
      },
    },
    cells: [
      { cell_type: 'markdown', metadata: {}, source: ['# Fixture notebook\n'] },
      { cell_type: 'code', metadata: { role: 'synthesis' }, execution_count: 1, source: ['display(Markdown(answer))\n'], outputs },
    ],
  };
}

const markdownOutput = (md: string) => ({ output_type: 'display_data', metadata: {}, data: { 'text/markdown': md } });
const tableOutput = { output_type: 'execute_result', metadata: {}, data: { 'text/html': `<table><tr><td>${TABLE_MARKER}</td></tr></table>` } };

const RUN_NOTEBOOK = notebookWith([markdownOutput(RUN_ANSWER), tableOutput], 'executed');

const TOOL = 'socrata__get_data';
const RUN_ARGS = {
  metadata: { type: 'metadata', dataset_id: 'erm2-nwe9', portal: PORTAL },
  count: { type: 'query', dataset_id: 'erm2-nwe9', portal: PORTAL, select: 'count(*)' },
  permits: { type: 'query', dataset_id: 'qq7x-k2rd', portal: PORTAL, where: "issued > '2026-01-01'" },
};

function lines(iteration: number, message: string, toolName: string, operationType: string, failed = false): Array<Record<string, unknown>> {
  const failure = failed ? { failed: true, failureKind: 'timeout' } : {};
  return [
    { type: 'phase_a_progress', phase: 'tool_start', iteration, message, toolName, operationType },
    { type: 'phase_a_progress', phase: 'tool_complete', iteration, message, toolName, operationType, ...failure },
  ];
}

function runEvents(notebook: Record<string, unknown>, through: 'complete' | 'C' = 'complete'): Array<Record<string, unknown>> {
  const phaseA: Array<Record<string, unknown>> = [
    { type: 'metadata', composedSystemPrompt: COMPOSED_PROMPT, composedSystemPromptHash: 'c'.repeat(64), signingKeyId: 'fixture-key' },
    { type: 'phase', name: 'A', message: 'Discovering datasets…' },
    ...lines(1, 'Reading the columns', TOOL, 'metadata'),
    ...lines(1, 'Counting complaints', TOOL, 'query'),
    ...lines(2, 'Querying permits', TOOL, 'query', true),
    ...lines(3, 'Reading the schema', 'boston__ckan__get_schema', 'metadata'),
  ];
  const calls: Array<Record<string, unknown>> = [
    { type: 'phase_a_tool_call', name: TOOL, operationType: 'metadata', reason: 'x', args: RUN_ARGS.metadata, duration_ms: 120 },
    { type: 'phase_a_tool_call', name: TOOL, operationType: 'query', reason: 'x', args: RUN_ARGS.count, resultSummary: { rows: 7, columns: 1 }, duration_ms: 300 },
    { type: 'phase_a_tool_call', name: TOOL, operationType: 'query', reason: 'x', args: RUN_ARGS.permits, failed: true, failureKind: 'timeout', duration_ms: 45000 },
    { type: 'phase_a_tool_call', name: 'boston__ckan__get_schema', operationType: 'metadata', reason: 'x', args: SCHEMA, duration_ms: 90 },
  ];
  const rest: Array<Record<string, unknown>> = [
    { type: 'phase_a_answer', content: RUN_ANSWER },
    { type: 'phase', name: 'B', message: 'Synthesizing notebook…' },
    { type: 'phase', name: 'C', message: 'Executing in sandbox…' },
  ];
  if (through === 'C') return [...phaseA, ...calls, ...rest];
  return [
    ...phaseA, ...calls, ...rest,
    { type: 'notebook', notebook, sandboxId: 'fixture-sandbox', executionDuration_ms: 4900, validation: { ok: true, issues: [] } },
    { type: 'phase', name: 'D', message: 'Finalizing…' },
    { type: 'publish_inputs', trace: { resourceSpans: [] }, tokenUsage: { promptTokens: 10, completionTokens: 5 }, answer: RUN_ANSWER, duration_ms: 50000 },
    { type: 'phase', name: 'complete', message: 'Done.' },
  ];
}

interface HookCell { state: Record<string, unknown>; events: Array<Record<string, unknown>> }
const hookCell: HookCell = { state: {}, events: [] };
(globalThis as unknown as { __w3p1Hook: HookCell }).__w3p1Hook = hookCell;
const { useNotebookStream: notebookStreamOutsideReact } = (await import(pathToFileURL(HOOK_FILE).href)) as {
  useNotebookStream: () => { start: (query: string, model: string, portal: string) => Promise<void> };
};

async function stateAfter(events: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
  hookCell.events = events;
  await notebookStreamOutsideReact().start(QUESTION, MODEL, PORTAL);
  return hookCell.state;
}

function renderRun(state: Record<string, unknown>, instance: string | null = INSTANCE): string {
  return withProviders(createElement(NotebookOutput, { state, prompt: QUESTION, model: MODEL, portal: PORTAL }), instance);
}

const RUN_STATE = await stateAfter(runEvents(RUN_NOTEBOOK));
const RUN = renderRun(RUN_STATE);

// --- Criterion (1): the seven parts in order, each author line in §6's words -------

test('W3 P1 (1) the comparison: status row, answer, citation, steps, sources line, disclosure, actions, in that order', () => {
  const positions = partPositions(COMPARISON);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, `the seven parts in order (found ${positions.join(', ')})`);
  assert.ok(part(COMPARISON, 'answer').markup.includes('COMPARISONANSWER-w3p1'), 'the answer part carries the answer');
  assert.ok(part(COMPARISON, 'steps').markup.includes('Show all steps'), 'the steps part carries the progress log’s completed steps');
  assert.ok(part(COMPARISON, 'sources').markup.includes('rows returned'), 'the sources line carries the provenance line');
  assert.ok(part(COMPARISON, 'actions').markup.includes('Copy'), 'the actions part carries the controls');
  const d = requireDisclosure(COMPARISON);
  assert.doesNotMatch(d.openTag, /\bopen\b/, 'the disclosure is closed by default');
  assert.equal(occurrences(COMPARISON, DISCLOSURE_LABEL).length, 1, 'one disclosure');
});

test('W3 P1 (1) the executed run: status row, answer, citation, steps, sources line, disclosure, actions, in that order', () => {
  const positions = partPositions(RUN);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, `the seven parts in order (found ${positions.join(', ')})`);
  assert.ok(part(RUN, 'answer').markup.includes('RUNANSWER-w3p1'), 'the answer part carries the answer');
  assert.ok(part(RUN, 'steps').markup.includes('data-part="step"'), 'the steps part carries the steps');
  assert.ok(part(RUN, 'sources').markup.includes('rows returned'), 'the sources line carries the provenance line');
  assert.ok(part(RUN, 'actions').markup.includes('Sign in to publish'), 'the actions part carries the Publish control');
  const d = requireDisclosure(RUN);
  assert.ok(part(RUN, 'actions').start >= d.end, 'the actions follow the disclosure');
});

test('W3 P1 (1) the comparison: each author line reads §6’s words for this instance and model', () => {
  const lines = authorLines(COMPARISON);
  const d = requireDisclosure(COMPARISON);
  const expected: Array<[string, string, 'outside' | 'inside']> = [
    ['answer', SECTION_6.answer, 'outside'],
    ['citation', SECTION_6.citation, 'outside'],
    ['steps', SECTION_6.steps, 'outside'],
    ['sources', SECTION_6.sources, 'outside'],
    ['instructions', SECTION_6.instructions, 'inside'],
  ];
  for (const [key, text, where] of expected) {
    const found = lines.filter((l) => l.key === key);
    assert.ok(found.length > 0, `no "${key}" author line`);
    for (const l of found) assert.equal(l.text, text, `the "${key}" author line`);
    const first = found[0].at;
    assert.ok(where === 'inside' ? first > d.start && first < d.end : first < d.start, `the "${key}" line sits ${where} the disclosure`);
  }
  assert.ok(part(COMPARISON, 'steps').markup.includes(SECTION_6.steps.replace(/'/g, '&#x27;')), 'the steps line sits in the steps part');
  assert.ok(part(COMPARISON, 'sources').markup.includes(SECTION_6.sources), 'the sources line names the portal host the rows came from');
});

test('W3 P1 (1) the executed run: each author line reads §6’s words for this instance and model', () => {
  const lines = authorLines(RUN);
  const d = requireDisclosure(RUN);
  const expected: Array<[string, string, 'outside' | 'inside']> = [
    ['answer', SECTION_6.answer, 'outside'],
    ['computed', SECTION_6.computed, 'outside'],
    ['citation', SECTION_6.citation, 'outside'],
    ['steps', SECTION_6.steps, 'outside'],
    ['sources', SECTION_6.sources, 'outside'],
    ['question', SECTION_6.question, 'inside'],
    ['instructions', SECTION_6.instructions, 'inside'],
    ['summary', SECTION_6.summaryByModel, 'inside'],
  ];
  for (const [key, text, where] of expected) {
    const found = lines.filter((l) => l.key === key);
    assert.ok(found.length > 0, `no "${key}" author line`);
    for (const l of found) assert.equal(l.text, text, `the "${key}" author line`);
    const first = found[0].at;
    assert.ok(where === 'inside' ? first > d.start && first < d.end : first < d.start, `the "${key}" line sits ${where} the disclosure`);
  }
});

test('W3 P1 (1) a summary the notebook did not state is labelled as the instance’s, derived from the answer', async () => {
  const legacy = notebookWith([markdownOutput(RUN_ANSWER)], 'executed', false);
  // The derived summary is the first sentence of a legacy synthesis section;
  // a notebook with a rendering cell derives none, so this one has the section.
  (legacy.cells as unknown[]).splice(1, 1, { cell_type: 'markdown', metadata: {}, source: [`## Synthesis\n\n${RUN_ANSWER}\n`] });
  const html = renderRun(await stateAfter(runEvents(legacy)));
  const summary = authorLines(html).filter((l) => l.key === 'summary');
  assert.deepEqual(summary.map((l) => l.text), [SECTION_6.summaryDerived]);
});

test('W3 P1 (1) with no instance declared, the lines that name it are omitted and the others stay', () => {
  const comparison = renderComparison(COMPARISON_STATE, { instance: null });
  const run = renderRun(RUN_STATE, null);
  for (const html of [comparison, run]) {
    const keys = authorLines(html).map((l) => l.key);
    for (const key of ['citation', 'steps', 'instructions']) assert.ok(!keys.includes(key), `"${key}" is omitted without an instance`);
    assert.ok(keys.includes('answer') && keys.includes('sources'), 'the answer and sources lines stay');
    assert.ok(!html.includes('instance.example.test'), 'no instance is named');
  }
});

// --- Criterion (2): the timing bar ---------------------------------------------------

test('W3 P1 (2) the timing bar names two measured segments, neither Planning nor Synthesis, and is labelled by the instance', () => {
  const img = /<div[^>]*\brole="img"[^>]*\baria-label="([^"]*)"/.exec(COMPARISON);
  assert.ok(img !== null, 'no timing bar (role="img") is rendered');
  const label = img[1];
  assert.doesNotMatch(label, /Planning|Synthesis/, `the bar's aria-label names an estimated segment: "${label}"`);
  const segments = label.split(', ');
  assert.equal(segments.length, 2, `the bar's aria-label names two segments: "${label}"`);
  for (const s of segments) assert.match(s, /^[A-Za-z ]+ \d+\.\ds$/, `a segment reads "<name> <seconds>s": "${s}"`);
  const segmentsRendered = occurrences(COMPARISON, 'class="timing-segment"').length;
  assert.equal(segmentsRendered, 2, `two segments are drawn (found ${segmentsRendered})`);
  const group = /<div[^>]*\brole="group"[^>]*\baria-label="([^"]*)"/.exec(COMPARISON);
  assert.ok(group !== null && group[1].includes(INSTANCE), `the bar's group label names the instance: "${group?.[1]}"`);
  const timing = authorLines(COMPARISON).filter((l) => l.key === 'timing');
  assert.deepEqual(timing.map((l) => l.text), [SECTION_6.timing], 'the bar is labelled "Measured by <instance>"');
});

// --- Criterion (3): one answer component ---------------------------------------------

test('W3 P1 (3) one fixture answer renders byte-identical markup in the comparison’s and the executed run’s answer part', () => {
  const ANSWER = 'ONEANSWER-w3p1: **42** complaints, in [the portal](https://portal.example.test/) and a table:\n\n| a | b |\n|---|---|\n| 1 | 2 |';
  const comparison = part(renderComparison(comparisonState(ANSWER)), 'answer').markup;
  const fromCell = part(withProviders(createElement(ChatNotebookOutput, {
    notebook: notebookWith([markdownOutput(ANSWER)], 'executed'), prompt: QUESTION, model: MODEL, portal: PORTAL, toolCalls: [],
  })), 'answer').markup;
  const legacy = notebookWith([], 'executed');
  (legacy.cells as unknown[]).splice(1, 1, { cell_type: 'markdown', metadata: {}, source: [`## Synthesis\n\n${ANSWER}\n`] });
  const fromLegacy = part(withProviders(createElement(ChatNotebookOutput, {
    notebook: legacy, prompt: QUESTION, model: MODEL, portal: PORTAL, toolCalls: [],
  })), 'answer').markup;
  assert.ok(comparison.includes('ONEANSWER-w3p1'), 'premise: the comparison’s answer part carries the answer');
  assert.equal(fromCell, comparison, 'the executed run (a rendering cell’s markdown output) and the comparison render the same answer markup');
  assert.equal(fromLegacy, comparison, 'the executed run (a legacy synthesis section) and the comparison render the same answer markup');
});

test('W3 P2 fix 1 (2) no element of the answer carries react-markdown’s node prop, on the comparison or the executed run', () => {
  const ANSWER = 'NODEANSWER-w3p2f1: see [the portal](https://portal.example.test/) for **42** rows.';
  const comparisonHtml = renderComparison(comparisonState(ANSWER));
  const comparison = part(comparisonHtml, 'answer').markup;
  const run = part(withProviders(createElement(ChatNotebookOutput, {
    notebook: notebookWith([markdownOutput(ANSWER)], 'executed'), prompt: QUESTION, model: MODEL, portal: PORTAL, toolCalls: [],
  })), 'answer').markup;
  for (const [surface, markup] of [['the comparison', comparison], ['the executed run', run]] as const) {
    assert.ok(/<a\b[^>]*href="https:\/\/portal\.example\.test\/"/.test(markup), `${surface}: premise: the fixture answer renders a link`);
    assert.doesNotMatch(markup, /\snode=/, `${surface}: an answer element carries a node attribute`);
  }
  assert.doesNotMatch(part(comparisonHtml, 'sources').markup, /\snode=/, 'the sources line’s links carry a node attribute');
  assert.equal(run, comparison, 'criterion (3)’s byte-identity still holds');
});

// --- Criterion (4): rule 3, by text ----------------------------------------------------

function before(html: string, needle: string, surface: string): void {
  const d = requireDisclosure(html);
  const first = at(html, needle);
  assert.ok(first < d.start, `${surface}: ${JSON.stringify(needle)} first appears inside the disclosure`);
}

test('W3 P1 (4) every honest-provenance sentence the run states renders outside the disclosure, in the reader’s spelling', async () => {
  // The sandbox sentence in the reader's spelling ("a signed sandbox"), which
  // the status row states. Tightened by the W3 fix: the signers' "Production
  // method" now states the notebook's own reading too, so the run's older
  // spelling is nowhere on the run.
  before(RUN, 'Executed in a signed sandbox', 'the executed run');
  assert.equal(occurrences(RUN, 'Executed in signed sandbox').length, 0, 'the older spelling is nowhere on the run');
  before(RUN, '1 of 4 requests did not complete.', 'the executed run');
  before(RUN, 'This request did not complete.', 'the executed run');
  for (const [provenance, sentence] of [['skeleton', 'Analysis notebook (not executed)'], [null, 'Whether this notebook ran is not stated']] as const) {
    const html = renderRun(await stateAfter(runEvents(notebookWith([markdownOutput(RUN_ANSWER)], provenance))));
    before(html, sentence, `the executed run (${provenance ?? 'no provenance'})`);
  }
  before(COMPARISON, '1 of 4 requests did not complete.', 'the comparison');
});

// --- Criterion (5): the executed run's status row is the notebook's reading -------------

test('W3 P1 (5) the executed run’s status row states the notebook’s reading, for an executed notebook and for one that was not', () => {
  const cases: Array<[string | null, string]> = [['executed', 'Executed in a signed sandbox'], ['skeleton', 'Analysis notebook (not executed)'], [null, 'Whether this notebook ran is not stated']];
  for (const [provenance, spelled] of cases) {
    const notebook = notebookWith([markdownOutput(RUN_ANSWER)], provenance);
    const reading = readNotebookProvenanceOfNotebook(notebook).label;
    assert.equal(reading, spelled, `premise: the reader spells ${provenance ?? 'an absent provenance'} "${spelled}"`);
    const html = withProviders(createElement(ChatNotebookOutput, { notebook, prompt: QUESTION, model: MODEL, portal: PORTAL, toolCalls: [] }));
    const row = part(html, 'status-row').markup;
    assert.ok(row.includes(`>${reading}<`), `the status row states "${reading}": ${row}`);
    assert.ok(!row.includes('Executed in signed sandbox'), 'and not the fixed text');
    for (const other of cases.map((c) => c[1]).filter((s) => s !== spelled)) assert.ok(!row.includes(other), `and not "${other}"`);
  }
});

// --- Criterion (6): the fork-facing deletion ----------------------------------------------

test('W3 P1 (6) read from the source: ChatNotebookOutput renders through AnswerView and holds no layout of its own', () => {
  const source = fs.readFileSync(path.join(SRC, 'components/notebook/ChatNotebookOutput.tsx'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(code, /import AnswerView\b[^;]*from '@\/components\/answer-view\/AnswerView'/, 'ChatNotebookOutput imports AnswerView');
  assert.match(code, /import \{[^}]*\badaptNotebook\b[^}]*\} from '@\/components\/answer-view\/adapt-notebook'/, 'ChatNotebookOutput imports the notebook adapter');
  assert.equal(code.match(/<AnswerView\b/g)?.length ?? 0, 1, 'ChatNotebookOutput renders one AnswerView');
  for (const [what, pattern] of [
    ['an element of its own', /<(?!AnswerView\b|\/AnswerView\b)[a-zA-Z]/],
    ['a style', /\bstyle=/],
    ['a section heading', /[A-G] · /],
    ['a part marker', /data-part=/],
    ['the disclosure label', /Learn more about how/],
  ] as const) {
    assert.doesNotMatch(code, pattern, `ChatNotebookOutput.tsx holds ${what}`);
  }
});

// --- Criterion (9): no exposed tool name in text the site writes --------------------------

/** The markup a reader reads: scripts and styles removed. */
function readerFacing(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '');
}

/** The tokens that hold the separator `__`. */
const separated = (text: string) => [...text.matchAll(/[A-Za-z0-9_]*[A-Za-z0-9]__[A-Za-z0-9_]+/g)].map((m) => m[0]);

/** A name is exposed when the dispatch map reads an upstream name out of it. */
const exposed = (token: string) => upstreamToolName(token) !== token;

/** The text with the exempt regions removed: the answer (first and as F) and B's composed prompt. */
function withoutExempt(html: string): { rest: string; exempt: string[] } {
  const exempt: string[] = [];
  let rest = readerFacing(html);
  for (const name of ['answer', 'composed-prompt']) {
    for (;;) {
      const re = new RegExp(`<(\\w+)\\b[^>]*\\bdata-part="${name}"[^>]*>`);
      const m = re.exec(rest);
      if (m === null) break;
      const end = elementEnd(rest, m.index, m[1]);
      exempt.push(rest.slice(m.index, end));
      rest = rest.slice(0, m.index) + rest.slice(end);
    }
  }
  return { rest, exempt };
}

test('W3 P1 (9) the comparison: no text the site writes names a tool by its exposed name; the answer is exempt as the record’s own words', () => {
  assert.ok(COMPARISON_ANSWER.includes('socrata__get_data'), 'premise: the answer names an aliased tool');
  const { rest, exempt } = withoutExempt(COMPARISON);
  assert.equal(exempt.filter((e) => e.includes('socrata__get_data')).length, 2, 'the aliased name is in the answer, first and as F');
  const leaked = separated(rest).filter(exposed);
  assert.deepEqual(leaked, [], 'site-written text names a tool by its exposed name');
  for (const token of separated(rest)) assert.equal(upstreamToolName(token), token, `"${token}" is an upstream name holding the separator`);
  assert.ok(requireDisclosure(COMPARISON).end > requireDisclosure(COMPARISON).start, 'premise: the disclosure, where B sits, is rendered');
});

test('W3 P1 (9) the executed run: no text the site writes names a tool by its exposed name; B’s prompt and the answer are exempt, and a ckan__ name is upstream', () => {
  assert.ok(COMPOSED_PROMPT.includes('socrata__get_data') && RUN_ANSWER.includes('socrata__get_data'), 'premise: the prompt and the answer name an aliased tool');
  const { rest, exempt } = withoutExempt(RUN);
  assert.equal(exempt.filter((e) => e.includes(COMPOSED_PROMPT.slice(0, 20))).length, 1, 'B’s composed prompt is one exempt region');
  assert.equal(exempt.filter((e) => e.includes('RUNANSWER-w3p1')).length, 2, 'the answer is two exempt regions, first and as F');
  const leaked = separated(rest).filter(exposed);
  assert.deepEqual(leaked, [], 'site-written text names a tool by its exposed name');
  const upstream = separated(rest);
  assert.ok(upstream.includes('ckan__get_schema'), 'premise: the ckan__ call’s upstream name is stated (in D) — the exemption is exercised');
  for (const token of upstream) assert.equal(upstreamToolName(token), token, `"${token}" is an upstream name holding the separator`);
});

// --- Item 2: the left panel keeps its own panel ---------------------------------------------

test('W3 P1 item 2: side by side, the without-data panel keeps its own panel and the view renders once, in the with-data panel', () => {
  const html = renderComparison(COMPARISON_STATE, { answerFirst: false });
  const without = at(html, '>Without Data Tools</h3>');
  const withData = at(html, '>With Data Tools</h3>');
  assert.ok(without < withData, 'premise: the without-data panel renders first');
  for (const name of SEVEN.filter((n) => n !== 'disclosure')) {
    const all = occurrences(html, `data-part="${name}"`);
    assert.equal(all.length, name === 'answer' ? 2 : 1, `"${name}" renders ${name === 'answer' ? 'twice' : 'once'}`);
    assert.ok(all[0] > withData, `"${name}" renders in the with-data panel`);
  }
});

// --- Item 3: the four phase rows while running become the step view's rows ---------------

test('W3 P1 item 3: while the run is under way, its progress is the step view: a step per Phase A iteration, then a row per reported later phase', async () => {
  const running = await stateAfter(runEvents(RUN_NOTEBOOK, 'C'));
  (running as { isLoading: boolean }).isLoading = true;
  (running as { completedAt: number | null }).completedAt = null;
  const html = renderRun(running);
  assert.ok(html.includes('Generating reproducible notebook'), 'premise: the progress panel renders');
  const steps = part(html, 'steps').markup;
  assert.equal(occurrences(steps, 'data-part="step" ').length, 3, 'one step per Phase A iteration');
  const closing = occurrences(steps, '<div data-part="closing-row"').map((s) => steps.slice(s, elementEnd(steps, s, 'div')).replace(/<[^>]*>/g, ''));
  assert.deepEqual(closing, ['Synthesizing notebook', 'Executing in sandbox'], 'a row for each later phase the run reported');
  assert.doesNotMatch(html, />Finalizing</, 'no row for a phase not yet reported');
  assert.doesNotMatch(html, /<ul\b/, 'the four fixed phase rows are gone');
});

// --- Fix 1 (1): the comparison's citation states no execution ---------------------
//
// The comparison never runs in a sandbox and records no execution time, so its
// citation preview states neither "Executed" nor any date: a date there would
// be the moment the page rendered, which the run did not record. The executed
// run's preview keeps the notebook's own `executedAt`.
//
// RED at ff00464: the comparison's preview read "[Executed: <render date>]"
// and "(<render year>)".

const MONTHS = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/;

/** The text of a citation part, tags removed. */
const citationText = (html: string) => unescape(part(html, 'citation').markup.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' '));

test('W3 P1 fix 1 (1) the comparison’s citation preview states no execution and no date the run did not record; the executed run’s states its own', () => {
  const comparison = citationText(COMPARISON);
  assert.ok(comparison.includes('QUESTIONMARKER-w3p1'), 'premise: the preview cites the question');
  assert.doesNotMatch(comparison, /Executed/, `the comparison's citation states an execution: ${comparison}`);
  assert.doesNotMatch(comparison, MONTHS, `the comparison's citation states a date the run did not record: ${comparison}`);
  assert.doesNotMatch(comparison, /\b(19|20)\d\d\b/, `the comparison's citation states a year the run did not record: ${comparison}`);
  const executedAt = '2026-10-18T12:00:00Z';
  const stated = new Date(executedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  assert.ok(citationText(RUN).includes(`[Executed: ${stated}]`), `the executed run's citation states the notebook's own executedAt (${stated})`);
});

// --- Criterion (9), the live view ------------------------------------------------------
//
// While the run is under way, the progress panel shows the step view and,
// beneath it, the latest detail line. The fixture stops in Phase A just after
// its last captured call, which is aliased and has no operation type, so the
// detail line is written from that call's name. Nothing in the live view is
// the record's own words, so nothing is exempt: no `__` at all.
//
// RED at ff00464: the detail line read "nyc_charter__get_section (to call get_section)".

test('W3 P1 (9) the live view: no text the site writes names a tool by its exposed name, for a call with no operation type', async () => {
  const phaseA = runEvents(RUN_NOTEBOOK, 'C').filter((e) => e.type !== 'phase' || e.name === 'A')
    .filter((e) => e.type !== 'phase_a_answer');
  // The call's progress lines and its captured call carry no operation type.
  const charter = { iteration: 4, message: 'Reading the charter', toolName: 'nyc_charter__get_section' };
  const events = [
    ...phaseA,
    { type: 'phase_a_progress', phase: 'tool_start', ...charter },
    { type: 'phase_a_progress', phase: 'tool_complete', ...charter },
    { type: 'phase_a_tool_call', name: 'nyc_charter__get_section', reason: 'to call get_section', args: { section: '1' }, duration_ms: 40 },
  ];
  const running = await stateAfter(events);
  (running as { isLoading: boolean }).isLoading = true;
  (running as { completedAt: number | null }).completedAt = null;
  assert.equal((running.toolCalls as Array<{ name: string }>).at(-1)?.name, 'nyc_charter__get_section', 'premise: the last captured call is aliased');
  assert.equal((running.toolCalls as Array<{ operationType?: string }>).at(-1)?.operationType, undefined, 'premise: and has no operation type');
  const html = renderRun(running);
  assert.ok(html.includes('Generating reproducible notebook') && html.includes('data-part="steps"'), 'premise: the live view renders, with its steps');
  assert.ok(typeof running.detail === 'string' && html.includes(unescape(running.detail as string).slice(0, 8)), 'premise: the detail line renders');
  const text = readerFacing(html);
  const i = text.indexOf('__');
  assert.equal(i, -1, `the live view prints an exposed name: …${text.slice(Math.max(0, i - 80), i + 40)}…`);
});

// --- The W3 fix -----------------------------------------------------------------
//
// (3) F2: the signers' production method states the notebook's own reading
// (`readNotebookProvenanceOfNotebook`: its label, then its detail), as the
// status row does. A notebook that did not run, or does not say, renders no
// sentence that claims execution. The two not-run fixtures carry no execution
// stamp, as a notebook that was not executed does not, so each reading's words
// can only come from that reading.
// (4) F3: an answer the site or the sandbox wrote — the run's `none`, a cell
// with no outputs, a cell whose only outputs are errors — sits under no
// "written by the model" line, in the answer or in F. A mixed set keeps today's.

const { NOTEBOOK_PROVENANCE_SIGNALS } = await import('@/lib/evidence/trust-signal');

function renderNotebook(notebook: Record<string, unknown>): string {
  return withProviders(createElement(ChatNotebookOutput, { notebook, prompt: QUESTION, model: MODEL, portal: PORTAL, toolCalls: [] }));
}

function withoutExecutionStamp(notebook: Record<string, unknown>): Record<string, unknown> {
  const extensions = (notebook.metadata as { extensions: Record<string, unknown> }).extensions;
  delete extensions['org.civicaitools.execution'];
  return notebook;
}

const plainText = (markup: string) => unescape(markup.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');

/** The text between the signers' "Production method" heading and the next heading. */
function productionMethod(html: string): string {
  const from = at(html, '>Production method</h3>');
  const to = html.lastIndexOf('<h3', at(html, '>Attestations</h3>', from));
  return plainText(html.slice(from + 1, to));
}

/** Sentences that claim the notebook ran: the executed reading's words, and the run's older ones. */
const EXECUTION_CLAIMS = [
  NOTEBOOK_PROVENANCE_SIGNALS.executed.label,
  NOTEBOOK_PROVENANCE_SIGNALS.executed.detail as string,
  'Executed in signed sandbox',
  'real cell execution',
  'authored, executed',
  'Executed:',
  'execution metadata',
  'Execution captured',
];

const PROVENANCE_CASES: Array<[string, Record<string, unknown>]> = [
  ['executed', notebookWith([markdownOutput(RUN_ANSWER)], 'executed')],
  ['not executed', withoutExecutionStamp(notebookWith([markdownOutput(RUN_ANSWER)], 'skeleton'))],
  ['provenance not stated', withoutExecutionStamp(notebookWith([markdownOutput(RUN_ANSWER)], null))],
];

test('W3 fix (3) the signers’ production method states the notebook’s own reading: its label, then its detail', () => {
  for (const [name, notebook] of PROVENANCE_CASES) {
    const reading = readNotebookProvenanceOfNotebook(notebook);
    const method = productionMethod(renderNotebook(notebook));
    const label = method.indexOf(reading.label);
    assert.ok(label >= 0, `${name}: the production method states "${reading.label}": ${method}`);
    assert.ok(method.indexOf(reading.detail as string, label) > label, `${name}: and under it "${reading.detail}"`);
    for (const other of PROVENANCE_CASES.filter(([n]) => n !== name)) {
      const words = readNotebookProvenanceOfNotebook(other[1]);
      assert.equal(method.includes(words.label), false, `${name}: and not another reading’s "${words.label}"`);
    }
    assert.ok(method.includes('The signed envelope is created at publish time.'), `${name}: the sentence true under every reading stays`);
  }
});

test('W3 fix (3) a notebook that did not run, or does not say, renders no sentence that claims execution', () => {
  const executed = plainText(renderNotebook(PROVENANCE_CASES[0][1]));
  // The run's two older phrases are retired by this fix, so the premise reads the others.
  for (const claim of EXECUTION_CLAIMS.filter((c) => c !== 'Executed in signed sandbox' && c !== 'authored, executed')) {
    assert.ok(executed.includes(claim), `premise: the instrument sees "${claim}" on the executed notebook’s run`);
  }
  for (const [name, notebook] of PROVENANCE_CASES.slice(1)) {
    const text = plainText(renderNotebook(notebook));
    for (const claim of EXECUTION_CLAIMS) assert.equal(text.includes(claim), false, `${name}: the run states "${claim}"`);
  }
});

const errorOutput = { output_type: 'error', ename: 'ValueError', evalue: 'ERRMARK-w3fix', traceback: ['TRACEMARK-w3fix'] };

test('W3 fix (4) the run’s none, a cell with no outputs, and a cell whose only outputs are errors: each renders its own text, under no "written by the model" line', () => {
  const none = notebookWith([], 'executed');
  (none.cells as unknown[]).splice(1, 1, { cell_type: 'markdown', metadata: {}, source: ['# No rendering cell, no synthesis section\n'] });
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['the run’s none', none, 'No synthesis was produced for this analysis.'],
    ['an executed cell with no outputs', notebookWith([], 'executed'), 'The synthesis cell did not produce any outputs.'],
    ['a cell whose only outputs are errors', notebookWith([errorOutput, { ...errorOutput, evalue: 'ERRMARK2-w3fix' }], 'executed'), 'ValueError: ERRMARK-w3fix'],
  ];
  for (const [name, notebook, fallback] of cases) {
    const html = renderNotebook(notebook);
    const answers = occurrences(html, '<div data-part="answer"').map((s) => html.slice(s, elementEnd(html, s, 'div')));
    assert.equal(answers.length, 2, `${name}: the answer part is placed first and as F`);
    for (const a of answers) assert.ok(plainText(a).includes(fallback), `${name}: the answer part renders "${fallback}"`);
    assert.doesNotMatch(html, /Answer, written by the model/, `${name}: no line names the model as the answer’s author`);
    assert.deepEqual(authorLines(html).filter((l) => l.key === 'answer' || l.key === 'computed'), [], `${name}: no answer author line`);
    assert.ok(authorLines(html).some((l) => l.key === 'question'), `${name}: premise: the other author lines stay`);
  }
});

test('W3 fix (4) a mixed set keeps today’s line: markdown beside an error, and a stream output', () => {
  const stream = { output_type: 'stream', name: 'stdout', text: 'STREAMMARK-w3fix' };
  for (const [name, outputs] of [
    ['markdown beside an error', [markdownOutput(RUN_ANSWER), errorOutput]],
    ['a stream output', [stream]],
  ] as const) {
    const html = renderNotebook(notebookWith([...outputs], 'executed'));
    assert.deepEqual(authorLines(html).filter((l) => l.key === 'answer').map((l) => l.text), [SECTION_6.answer, SECTION_6.answer], `${name}: the model’s line, over the answer and over F`);
  }
});
