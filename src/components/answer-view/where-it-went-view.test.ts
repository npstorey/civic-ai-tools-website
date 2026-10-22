// R6 W4 (#632, rulings W4-D1 = A, W4-D2 = A, W4-D3 = A): the section "Where
// this question went", `WhereItWent.tsx`, as a reader meets it.
//
// WHAT IS DRIVEN.
//   - The answer (criterion 2): a comparison's stream events folded by the
//     hook's own handler (`handleComparisonEvent`) and rendered through
//     `ComparisonDisplay`; an executed run's events read by the real
//     `useNotebookStream` (driven outside React) and rendered through
//     `NotebookOutput`. The completion carries `flows` (the comparison's
//     `complete` event's `data.flows`; the executed run's `complete` phase
//     event's `flows`), a model of the builder's shape written out here, so
//     this file reads the section, not the builder. Each surface is rendered
//     under both built-in layouts; the same completion with no `flows`
//     renders no section at all.
//   - The record (criteria 3 and 4): the saved d887c1, 397939 and 2f32d9
//     packages through the record adapter, passed the statement this site
//     serves (`servedStatement`), and the model it builds rendered through
//     `AnswerView`.
// The section is the element `data-part="where-it-went"`, since Stage C a
// `<details>` closed by default (see "Stage C" below). Its text is read with
// tags removed (`flat`), so a sentence split across elements still reads as one.
//
// THE FIXTURES CAN FAIL. Every recipient's place, what it receives and its
// holders carry a marker; the logs lines are read through the real
// `KeptByLines`; the record is driven matched and unmatched, so a section that
// prints the statement's lines on no match, or prints none on a match, fails.
//
// At Stage A's base no completion carried `flows` into the view and there was
// no section; at Stage C's base (`0630c19`) the section was a `<div>` with
// Stage B's words, so each test fails at its `<details>` or at a sentence.
//
// A CLAIM CHECKED IN NODE, NOT IN A BROWSER: server-rendered markup.
//
// Run with: npm test

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
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');

// The executed run's hook is driven outside React (as answer-view-layout.test.ts):
// FOR THE HOOK MODULE ONLY, `react` is a state cell and `@/lib/sse-client` hands it the events.
const HOOK_FILE = path.join(SRC, 'hooks/useNotebookStream.ts');
const HOOK_STUB_PREFIX = 'file:///r6-w4-view-hook-stub/';
const HOOK_STUBS: Record<string, string> = {
  react: `
    export function useState(initial) {
      globalThis.__w4Hook.state = typeof initial === 'function' ? initial() : initial;
      const set = (update) => {
        globalThis.__w4Hook.state = typeof update === 'function' ? update(globalThis.__w4Hook.state) : update;
      };
      return [globalThis.__w4Hook.state, set];
    }
    export function useCallback(fn) { return fn; }
    export function useRef(value) { return { current: value }; }`,
  '@/lib/sse-client': `
    export async function connectSSE({ onEvent, onComplete }) {
      for (const event of globalThis.__w4Hook.events) onEvent(event);
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
      if (found === null) throw new Error(`where-it-went view test hook: cannot resolve ${specifier}`);
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

const { REFERENCE_IDENTITY_ENV } = (await import('@/lib/evidence/reference-identity-fixture')) as { REFERENCE_IDENTITY_ENV: Record<string, string> };
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;

type AnyComponent = ComponentType<Record<string, unknown>>;
const { default: ComparisonDisplay } = (await import('@/components/ComparisonDisplay')) as unknown as { default: AnyComponent };
const { default: NotebookOutput } = (await import('@/components/notebook/NotebookOutput')) as unknown as { default: AnyComponent };
const { default: AnswerView } = (await import('@/components/answer-view/AnswerView')) as unknown as { default: AnyComponent };
const { adaptRecord } = (await import('@/components/answer-view/adapt-record')) as unknown as {
  adaptRecord: (input: Record<string, unknown>) => Record<string, unknown>;
};
const { EvidenceOriginProvider } = (await import('@/components/EvidenceOriginProvider')) as unknown as {
  EvidenceOriginProvider: ComponentType<{ value: Record<string, string | null>; children?: ReactNode }>;
};
const { AnswerLayoutsProvider } = (await import('@/components/answer-view/AnswerLayoutsProvider')) as unknown as {
  AnswerLayoutsProvider: ComponentType<{ value: unknown; children?: ReactNode }>;
};
const { handleComparisonEvent } = (await import('@/hooks/useStreamingComparison')) as unknown as {
  handleComparisonEvent: (event: Record<string, unknown>, set: (update: unknown) => void) => void;
};
const { ANSWER_FIRST, ENVELOPE_ORDER, BUILT_IN_LAYOUTS } = await import('@/lib/answer-layout');
const { statementHash } = (await import('@/lib/flows/statement')) as unknown as { statementHash: (s: unknown) => string };
const { default: WhereItWent } = (await import('@/components/answer-view/WhereItWent')) as unknown as { default: AnyComponent };

type Layout = typeof ANSWER_FIRST;
const instanceWith = (layout: Layout) => ({ default: layout, offered: [layout, ...BUILT_IN_LAYOUTS.filter((l) => l.name !== layout.name)] });

// --- Identity, providers, readers -----------------------------------------------------

const INSTANCE = 'instance.fixture-w4.example';
const MODEL = 'fixture/model-w4';
const PORTAL = 'portal.fixture-w4.example';
const QUESTION = 'QUESTIONMARKER-w4 How many complaints were filed?';
const DISCLOSURE_LABEL = 'Learn more about how this analysis was produced';
const HEADING = 'Where this question went';

function withProviders(element: ReactNode, layouts?: unknown): string {
  const laidOut = layouts === undefined ? element : createElement(AnswerLayoutsProvider, { value: layouts }, element);
  const origin = createElement(EvidenceOriginProvider, { value: { origin: `https://${INSTANCE}`, host: INSTANCE, platformTitle: null } }, laidOut);
  const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;
  return renderToStaticMarkup(createElement(Session, { session: null }, origin));
}

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

function part(html: string, name: string): { start: number; end: number; markup: string } {
  const re = new RegExp(`<(\\w+)\\b[^>]*\\bdata-part="${name}"[^>]*>`, 'g');
  const m = re.exec(html);
  assert.ok(m !== null, `no element with data-part="${name}" is rendered`);
  const end = elementEnd(html, m.index, m[1]);
  return { start: m.index, end, markup: html.slice(m.index, end) };
}

function disclosure(html: string): { start: number; end: number } {
  const re = /<details\b[^>]*>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const summary = /^<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(html.slice(m.index + m[0].length));
    if (summary !== null && summary[1].replace(/<[^>]*>/g, '') === DISCLOSURE_LABEL) return { start: m.index, end: elementEnd(html, m.index, 'details') };
  }
  assert.fail(`no disclosure labelled "${DISCLOSURE_LABEL}"`);
}

const unescape = (text: string) =>
  text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The section: its markup, and its text with tags removed. */
function section(html: string): { start: number; end: number; markup: string; flat: string } {
  const p = part(html, 'where-it-went');
  return { ...p, flat: unescape(p.markup.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, '')) };
}

const RETIRED = ['published by', 'tool arguments', 'question text and tool results', 'returned no data', 'flows statement'];

function assertNoRetiredWords(flat: string, label: string) {
  for (const word of RETIRED) assert.ok(!flat.toLowerCase().includes(word), `${label}: the section says "${word}"`);
}

// --- Stage C (the owner's G8 review; ruling (b) = (i)): the words the section says ---------
//
// The section is a `<details data-part="where-it-went">`, closed by default,
// whose summary is the only closed-state text: "Where this question went: the
// model and N data source(s)." Open, it lists each reached row with two levels
// of indentation: the row, then its recipients. A row's recipient is labelled as
// the consent card labels it, "<source name> (<place>)", an upstream host
// "<source name>, upstream (<host>)"; the model row reads "The model service
// (<host>)" then "The model: <name>"; each recipient's "Receives: <receives>"
// and "Who holds its logs: " followed by the panel's own kept-by lines (with
// how long), the model row by the card's rule. On a record with no matching
// statement, one sentence instead of every "Receives" and kept-by line. The
// sources not reached are no longer rendered (ruling (i)); the builder still
// returns them, and its tests pin their reasons.

const { KeptByLines } = (await import('@/components/sources/KeptByLine')) as unknown as {
  KeptByLines: ComponentType<{ keptBy: readonly Holder[]; retention?: boolean }>;
};
const { KEPT_FOR_OPERATOR, ENDPOINT_NO_TRAINING } = (await import('@/lib/sources/copy')) as unknown as { KEPT_FOR_OPERATOR: string; ENDPOINT_NO_TRAINING: string };
const { formatModelName } = (await import('@/lib/models')) as unknown as { formatModelName: (m: string) => string };

interface Holder { holder: string; keeps: string; retention?: string; statementUrl?: string; readOn?: string; operatorStatement?: string }

const RECORD_SENTENCE = 'This record does not say what each one received or keeps.';

/** The summary line, for N reached sources. */
const summaryFor = (n: number) => `${HEADING}: the model and ${n === 0 ? 'no data source' : n === 1 ? '1 data source' : `${n} data sources`}.`;

/** What `KeptByLines` renders for these holders, as text: the panel's own line, read through the real component. */
const keptText = (keptBy: readonly Holder[], retention = true) =>
  unescape(renderToStaticMarkup(createElement(KeptByLines, { keptBy, retention })).replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ''));

/** The panel's line: "Who holds its logs: " and the holders' lines, then a full stop. */
const logsLine = (keptBy: readonly Holder[]) => `Who holds its logs: ${keptText(keptBy)}.`;

/** The model row's line, by the consent card's rule (`ConsentCard.tsx` `RecipientLine`). */
function modelLogsLine(keptBy: readonly Holder[], place: string): string {
  const operator = keptBy.find((k) => k.operatorStatement);
  const only = keptBy.length === 1 && keptBy[0].holder === place && keptBy[0].keeps === 'operator-states';
  return `Who holds its logs: ${operator ? `${KEPT_FOR_OPERATOR}. ${ENDPOINT_NO_TRAINING}` : only ? `${KEPT_FOR_OPERATOR}.` : `${keptText(keptBy, false)}.`}`;
}

const callsWords = (n: number) => (n === 1 ? '1 tool call' : `${n} tool calls`);

/** The section's `<details>`: closed by default, its summary the only closed-state text. */
function assertClosedDetails(html: string, n: number, label: string) {
  const s = part(html, 'where-it-went');
  const open = /^<(\w+)\b([^>]*)>/.exec(s.markup);
  assert.ok(open, `${label}: no opening tag`);
  assert.equal(open[1], 'details', `${label}: the section is a <${open[1]}>, not a <details>`);
  assert.doesNotMatch(open[2], /\bopen\b/, `${label}: the section is open by default`);
  const summary = /^<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(s.markup.slice(open[0].length));
  assert.ok(summary, `${label}: the <details> does not begin with its <summary>`);
  assert.equal(unescape(summary[1].replace(/<!-- -->/g, '').replace(/<[^>]*>/g, '')), summaryFor(n), `${label}: the summary line`);
}

/** A reached row as the section must show it: its line first, then each of its texts, before the next row. */
interface ShownRow { name: string; texts: readonly string[] }

/**
 * The open state: the summary, then each reached row in order, each row's
 * texts inside its own stretch (from its line to the next row's line); none
 * of `absent` anywhere in the section.
 */
function assertRows(flat: string, n: number, reached: readonly ShownRow[], absent: readonly string[], label: string) {
  assert.ok(flat.startsWith(summaryFor(n)), `${label}: the section opens with its summary: ${flat.slice(0, 80)}`);
  const starts: number[] = [];
  let from = summaryFor(n).length;
  for (const row of reached) {
    const i = flat.indexOf(row.name, from);
    assert.ok(i >= 0, `${label}: the row "${row.name}" is not in order`);
    starts.push(i);
    from = i + row.name.length;
  }
  reached.forEach((row, k) => {
    const stretch = flat.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : undefined);
    for (const text of row.texts) assert.ok(stretch.includes(text), `${label}: "${text}" is not in the row "${row.name}"`);
  });
  for (const text of [...absent, 'Not sent to']) assert.ok(!flat.includes(text), `${label}: the section shows "${text}"`);
}

// --- The completions' flows (the builder's shape, written out) ---------------------------

interface RecipientFixture { role: string; place: string; got: string; keptBy: Holder[]; upstream?: true }
interface FlowsFixture {
  reached: Array<{ kind: string; name: string; sourceId?: string; calls?: number; model?: string; service?: string; recipients: RecipientFixture[] }>;
  notReached: Array<{ sourceId: string; name: string; whyNotSent: string }>;
  statement: { kind: string };
}

const RUN_FLOWS: FlowsFixture = {
  reached: [
    {
      kind: 'model', name: 'Model endpoint', model: MODEL, service: 'openrouter',
      recipients: [{ role: 'Model endpoint', place: 'PLACE-MODEL-w4.example', got: 'GOT-MODEL-w4 your question', keptBy: [{ holder: 'PLACE-MODEL-w4.example', keeps: 'operator-states' }] }],
    },
    {
      kind: 'source', sourceId: 'data-commons', name: 'Data Commons', calls: 1,
      recipients: [{
        role: 'Data source', place: 'PLACE-DC-w4.example', got: 'GOT-DC-w4 the searches',
        keptBy: [{ holder: 'HOLDER-DC-w4', keeps: 'content', retention: 'Varies by kind of data.', statementUrl: 'https://dc.fixture-w4.example/privacy', readOn: '2026-10-18' }],
      }],
    },
    {
      kind: 'source', sourceId: 'nyc-charter', name: 'NYC Charter, Laws and Rules', calls: 2,
      recipients: [
        { role: 'Sandbox platform', place: "this site's sandbox", got: 'GOT-SANDBOX-w4', keptBy: [{ holder: 'HOLDER-SANDBOX-w4', keeps: 'not-stated' }] },
        { role: 'Data source', place: 'PLACE-UPSTREAM-w4.example', got: 'GOT-UPSTREAM-w4', upstream: true, keptBy: [{ holder: 'HOLDER-UPSTREAM-w4', keeps: 'metadata' }, { holder: 'HOLDER-UPSTREAM-TWO-w4', keeps: 'none' }] },
      ],
    },
  ],
  notReached: [
    { sourceId: 'socrata', name: 'Socrata', whyNotSent: 'Off.' },
    { sourceId: 'boston-opencontext', name: 'Boston OpenContext', whyNotSent: 'Ask first: allowed when asked, but not used for this question.' },
  ],
  statement: { kind: 'in-force' },
};

const NOTEBOOK_FLOWS: FlowsFixture = {
  ...RUN_FLOWS,
  reached: [
    ...RUN_FLOWS.reached,
    { kind: 'notebook', name: 'Notebook runner', recipients: [{ role: 'Notebook runner', place: 'PLACE-RUNNER-w4', got: 'GOT-RUNNER-w4 the notebook', keptBy: [{ holder: 'HOLDER-RUNNER-w4', keeps: 'not-stated' }] }] },
  ],
};

/** The run section's rows, from its flows; its sources not reached are not shown. */
function assertRunRows(flat: string, flows: FlowsFixture, label: string) {
  const sources = flows.reached.filter((r) => r.kind === 'source').length;
  assertRows(
    flat,
    sources,
    flows.reached.map((row) => {
      if (row.kind === 'model') {
        const r = row.recipients[0];
        return { name: `The model service (${r.place})`, texts: [`The model: ${formatModelName(row.model!)}`, `Receives: ${r.got}`, modelLogsLine(r.keptBy, r.place)] };
      }
      if (row.kind === 'notebook') {
        const r = row.recipients[0];
        return { name: `Notebook runner (${r.place})`, texts: [`Receives: ${r.got}`, logsLine(r.keptBy)] };
      }
      return {
        name: `${row.name}, ${callsWords(row.calls!)}`,
        texts: row.recipients.flatMap((r) => [
          r.upstream ? `${row.name}, upstream (${r.place})` : `${row.name} (${r.place})`,
          `Receives: ${r.got}`,
          logsLine(r.keptBy),
        ]),
      };
    }),
    [...flows.notReached.flatMap((row) => [row.name, row.whyNotSent]), 'What it got', 'What it keeps', 'Service: ', 'Data source:', 'Sandbox platform:'],
    label,
  );
}

// --- The comparison --------------------------------------------------------------------

const ANSWERED = { type: 'query', dataset_id: 'erm2-nwe9', portal: PORTAL, select: 'count(*)' };
const ANSWER = 'COMPARISONANSWER-w4: **4,812** complaints.';

function comparisonEvents(flows: unknown): Array<Record<string, unknown>> {
  return [
    { type: 'progress', message: 'Analyzing your question...', phase: 'analyze' },
    { type: 'progress', message: 'Counting 311 Service Requests...', phase: 'tool_start', iteration: 1, toolName: 'socrata__get_data', operationType: 'query', args: ANSWERED },
    { type: 'progress', message: 'Counting 311 Service Requests...', phase: 'tool_complete', iteration: 1, toolName: 'socrata__get_data', operationType: 'query', duration_ms: 1210 },
    { type: 'token', content: ANSWER },
    {
      type: 'complete',
      data: {
        content: ANSWER, duration_ms: 9400, tokens_used: 2100, prompt_tokens: 1800, completion_tokens: 300,
        tools_called: [{ name: 'socrata__get_data', args: ANSWERED, operationType: 'query', duration_ms: 1210, resultSummary: { rows: 1, columns: 1 }, reason: 'to count complaints' }],
        ...(flows !== undefined ? { flows } : {}),
      },
    },
  ];
}

function renderComparison(flows: unknown, layouts?: unknown): string {
  const panel = { content: '', progress: null, progressLog: [], progressGroups: [], isComplete: false };
  let state: Record<string, unknown> = { withoutMcp: { ...panel }, withMcp: { ...panel }, isLoading: true, error: null, evidenceTrace: null, mcpOnly: true };
  const set = (update: unknown) => {
    state = typeof update === 'function' ? (update as (s: typeof state) => typeof state)(state) : update as typeof state;
  };
  for (const event of comparisonEvents(flows)) handleComparisonEvent({ ...event, panel: 'withMcp' }, set);
  return withProviders(createElement(ComparisonDisplay, {
    withoutMcp: null, withMcp: null, isLoading: false, modelName: 'Fixture model', isStreaming: true,
    streamingWithoutMcp: { ...panel }, streamingWithMcp: state.withMcp,
    queryText: QUESTION, portal: PORTAL, model: MODEL, evidenceTrace: null, answerFirst: true,
  }), layouts);
}

// --- The executed run ------------------------------------------------------------------

const RUN_ANSWER = 'RUNANSWER-w4: **42** complaints.';
const RUN_NOTEBOOK = {
  nbformat: 4, nbformat_minor: 5,
  metadata: {
    extensions: {
      'org.civicaitools.execution': { executedAt: '2026-10-21T12:00:00Z', executionDuration_ms: 4200, sandboxId: 'fixture-sandbox-w4', environment: { python: '3.13', libraries: {} } },
      'org.civicaitools.notebook': { provenance: 'executed' },
    },
  },
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Fixture notebook\n'] },
    { cell_type: 'code', metadata: { role: 'synthesis' }, execution_count: 1, source: ['display(Markdown(answer))\n'], outputs: [{ output_type: 'display_data', metadata: {}, data: { 'text/markdown': RUN_ANSWER } }] },
  ],
};

function runEvents(flows: unknown): Array<Record<string, unknown>> {
  return [
    { type: 'metadata', composedSystemPrompt: 'SYSTEMPROMPT-w4', composedSystemPromptHash: 'c'.repeat(64), signingKeyId: 'fixture-key' },
    { type: 'phase', name: 'A', message: 'Discovering datasets…' },
    { type: 'phase_a_progress', phase: 'tool_start', iteration: 1, message: 'Counting complaints', toolName: 'socrata__get_data', operationType: 'query' },
    { type: 'phase_a_progress', phase: 'tool_complete', iteration: 1, message: 'Counting complaints', toolName: 'socrata__get_data', operationType: 'query' },
    { type: 'phase_a_tool_call', name: 'socrata__get_data', operationType: 'query', reason: 'x', args: ANSWERED, resultSummary: { rows: 7, columns: 1 }, duration_ms: 300 },
    { type: 'phase_a_answer', content: RUN_ANSWER },
    { type: 'phase', name: 'B', message: 'Synthesizing notebook…' },
    { type: 'phase', name: 'C', message: 'Executing in sandbox…' },
    { type: 'notebook', notebook: RUN_NOTEBOOK, sandboxId: 'fixture-sandbox-w4', executionDuration_ms: 4900, validation: { ok: true, issues: [] } },
    { type: 'phase', name: 'D', message: 'Finalizing…' },
    { type: 'publish_inputs', trace: { resourceSpans: [] }, tokenUsage: { promptTokens: 10, completionTokens: 5 }, answer: RUN_ANSWER, duration_ms: 50000 },
    { type: 'phase', name: 'complete', message: 'Done.', ...(flows !== undefined ? { flows } : {}) },
  ];
}

interface HookCell { state: Record<string, unknown>; events: Array<Record<string, unknown>> }
const hookCell: HookCell = { state: {}, events: [] };
(globalThis as unknown as { __w4Hook: HookCell }).__w4Hook = hookCell;
const { useNotebookStream: notebookStreamOutsideReact } = (await import(pathToFileURL(HOOK_FILE).href)) as {
  useNotebookStream: () => { start: (query: string, model: string, portal: string) => Promise<void> };
};

async function runState(flows: unknown): Promise<Record<string, unknown>> {
  hookCell.events = runEvents(flows);
  await notebookStreamOutsideReact().start(QUESTION, MODEL, PORTAL);
  return hookCell.state;
}

const RUN_WITH = await runState(NOTEBOOK_FLOWS);
const RUN_WITHOUT = await runState(undefined);
const renderRun = (state: Record<string, unknown>, layouts?: unknown) =>
  withProviders(createElement(NotebookOutput, { state, prompt: QUESTION, model: MODEL, portal: PORTAL }), layouts);

// --- Criterion 2: on the answer ----------------------------------------------------------

const SURFACES: Array<[string, (layouts?: unknown) => string, (layouts?: unknown) => string, FlowsFixture]> = [
  ['the comparison', (l) => renderComparison(RUN_FLOWS, l), (l) => renderComparison(undefined, l), RUN_FLOWS],
  ['the executed run', (l) => renderRun(RUN_WITH, l), (l) => renderRun(RUN_WITHOUT, l), NOTEBOOK_FLOWS],
];

for (const [name, withFlows, withoutFlows, flows] of SURFACES) {
  test(`criterion 2, ${name}: the section renders from the completion's flows, after the sources line, under answer-first`, () => {
    const html = withFlows(instanceWith(ANSWER_FIRST));
    assertClosedDetails(html, flows.reached.filter((r) => r.kind === 'source').length, name);
    const s = section(html);
    assertRunRows(s.flat, flows, name);
    const sources = part(html, 'sources');
    const d = disclosure(html);
    assert.ok(sources.end <= s.start, 'after the sources line');
    assert.ok(s.end <= d.start, 'before the disclosure');
    assert.equal(html.split('data-part="where-it-went"').length - 1, 1, 'once');
    assertNoRetiredWords(s.flat, name);
  });

  test(`criterion 2, ${name}: under envelope-order the section sits after the sources line and before the citation, outside the disclosure`, () => {
    const html = withFlows(instanceWith(ENVELOPE_ORDER));
    assertClosedDetails(html, flows.reached.filter((r) => r.kind === 'source').length, name);
    const s = section(html);
    assertRunRows(s.flat, flows, name);
    const sources = part(html, 'sources');
    const citation = part(html, 'citation');
    const d = disclosure(html);
    assert.ok(sources.end <= s.start && s.end <= citation.start, 'between the sources line and the citation');
    assert.ok(s.end <= d.start || s.start >= d.end, 'outside the disclosure');
  });

  test(`criterion 2, ${name}: a completion with no flows renders no section at all, not an empty one`, () => {
    const html = withFlows(instanceWith(ANSWER_FIRST));
    assert.ok(section(html).flat.includes(HEADING), 'premise: with flows, the section renders');
    for (const layout of [ANSWER_FIRST, ENVELOPE_ORDER]) {
      const without = withoutFlows(instanceWith(layout));
      assert.ok(without.includes('data-part="sources"'), 'premise: the run rendered');
      assert.ok(!without.includes('data-part="where-it-went"'), `${layout.name}: a where-it-went element is rendered`);
      assert.ok(!without.includes(HEADING), `${layout.name}: the heading is rendered`);
    }
  });
}

// --- Criteria 3 and 4: on the record -----------------------------------------------------

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(SRC, 'lib/flows/fixtures', name), 'utf8')) as Record<string, unknown>;

interface StatementLike {
  recipients: Array<{ role: string; host?: string; receives: string; keptBy: Holder[] }>;
  sources: Array<{ sourceId: string; host?: string; recipients: Array<{ id: string; host?: string; receives: string; keptBy: Holder[] }> }>;
}

const D887C1 = fixture('record-d887c1.package.json');
const R397939 = fixture('record-397939.package.json');
const R2F32D9 = fixture('record-2f32d9.package.json');
const SERVED_78 = fixture('flows-statement-78c516db.json') as unknown as StatementLike;
const D887C1_URL = 'https://app.civicaitools.org/api/flows';
const D1_LINE = 'What each one keeps: where a question can go, as of 20 October 2026.';

function differing(): StatementLike {
  const s = structuredClone(SERVED_78);
  const socrata = s.sources.find((x) => x.sourceId === 'socrata');
  assert.ok(socrata, 'premise: the served statement lists Socrata');
  socrata.host = 'socrata-moved.fixture-w4.example';
  socrata.recipients = [
    { ...socrata.recipients[0], host: 'socrata-moved.fixture-w4.example' },
    { ...socrata.recipients[0], id: 'source:socrata:second.fixture-w4.example', host: 'second.fixture-w4.example' },
  ];
  return s;
}

function renderRecord(pkg: Record<string, unknown>, served: StatementLike | null, slug: string): string {
  const model = adaptRecord({
    stored: pkg, resolution: null,
    row: { slug, summary: 'SUMMARY-w4', contentProfile: 'datHere', captureMethod: 'chat-flow-stream' },
    instance: 'records.fixture-w4.example',
    servedStatement: served,
  });
  return withProviders(createElement(AnswerView, { model }));
}

const servedLines = (s: StatementLike) => ({
  model: s.recipients.find((r) => r.role === 'model-endpoint'),
  runner: s.recipients.find((r) => r.role === 'notebook-executor'),
  socrata: s.sources.find((x) => x.sourceId === 'socrata'),
});

const D887C1_NOT_REACHED = ['Data Commons', 'Off.', 'Boston OpenContext', 'Not set up on this site.', 'NYC Charter, Laws and Rules', 'On, not used for this question.'];

test('criterion 3: d887c1, passed the statement with its hash: what each receives and the logs lines are the statement\'s, and no link', () => {
  assert.equal(statementHash(SERVED_78), '78c516db86bf5af90f0f0de1f6c3a614b6ff1c9026b27a25620fbc7c52ecd995', 'premise: the saved statement is the one d887c1 references');
  const html = renderRecord(D887C1, SERVED_78, 'noise-trends-in-nyc-last-week-d887c1');
  assertClosedDetails(html, 1, 'd887c1 matched');
  const s = section(html);
  const { model, runner, socrata } = servedLines(SERVED_78);
  assert.ok(model && runner && socrata, 'premise: the statement holds the model endpoint, the runner and Socrata');
  assert.ok(model.keptBy.some((k) => k.operatorStatement), 'premise: the 78c516db statement carries the operator\'s no-training statement');
  assertRows(s.flat, 1, [
    { name: 'The model service (openrouter.ai)', texts: ['The model: Claude Haiku 5.5', `Receives: ${model.receives}`, modelLogsLine(model.keptBy, 'openrouter.ai')] },
    { name: 'Socrata, 1 tool call', texts: ['Socrata (socrata-mcp.civicaitools.org)', `Receives: ${socrata.recipients[0].receives}`, logsLine(socrata.recipients[0].keptBy)] },
    { name: 'Notebook runner (Vercel Sandbox)', texts: [`Receives: ${runner.receives}`, logsLine(runner.keptBy)] },
  ], [...D887C1_NOT_REACHED.filter((t) => t !== 'Socrata'), 'not recorded', RECORD_SENTENCE, D1_LINE], 'd887c1 matched');
  assert.ok(s.flat.includes(ENDPOINT_NO_TRAINING), 'the model row carries the operator\'s statement, as the card does');
  assertNoRetiredWords(s.flat, 'd887c1 matched');
});

for (const [label, served] of [
  ['a statement without that hash', (() => { const s = structuredClone(SERVED_78); s.recipients[0].receives = 'RECEIVES-CHANGED-w4'; return s; })()],
  ['a statement shaped to differ', differing()],
] as const) {
  test(`criterion 3: d887c1, passed ${label}: the record's places, one sentence instead of what each received or keeps, then the reference line`, () => {
    assert.notEqual(statementHash(served), '78c516db86bf5af90f0f0de1f6c3a614b6ff1c9026b27a25620fbc7c52ecd995', 'premise: the hashes differ');
    const html = renderRecord(D887C1, served, 'noise-trends-in-nyc-last-week-d887c1');
    assertClosedDetails(html, 1, label);
    const s = section(html);
    assertRows(s.flat, 1, [
      { name: 'The model service (not recorded)', texts: ['The model: Claude Haiku 5.5'] },
      { name: 'Socrata, 1 tool call', texts: ['Socrata (socrata-mcp.civicaitools.org)'] },
      { name: 'Notebook runner (not recorded)', texts: [RECORD_SENTENCE, D1_LINE] },
    ], ['Receives:', 'Who holds its logs', 'Data Commons', 'Off.', 'Not set up on this site.', 'On, not used for this question.'], label);
    assert.ok(s.flat.indexOf(RECORD_SENTENCE) < s.flat.indexOf(D1_LINE), 'the record sentence, then the reference line');
    assert.equal(s.flat.split(RECORD_SENTENCE).length - 1, 1, 'one sentence for every row');
    assert.equal(s.flat.split('not recorded').length - 1, 2, '"not recorded" only as the two places the record does not hold');
    const link = /<a\b([^>]*)>where a question can go<\/a>/.exec(s.markup);
    assert.ok(link, '"where a question can go" is a link');
    assert.match(link[1], new RegExp(`href="${D887C1_URL.replace(/[./]/g, '\\$&')}"`), 'to the reference\'s address');
    assert.match(link[1], /target="_blank"/);
    assert.match(link[1], /rel="noopener noreferrer"/);
    for (const r of [...served.recipients, ...served.sources.flatMap((x) => x.recipients)]) {
      assert.ok(!s.flat.includes(r.receives), `no "Receives" line: "${r.receives.slice(0, 40)}…" is shown`);
    }
    for (const host of ['openrouter.ai', 'socrata-moved.fixture-w4.example', 'second.fixture-w4.example', 'Vercel Sandbox']) {
      assert.ok(!s.flat.includes(host), `the statement's place "${host}" is shown on no match`);
    }
    assertNoRetiredWords(s.flat, label);
  });
}

for (const [label, pkg, name, host, absent] of [
  ['397939', R397939, 'Data Commons', 'api.datacommons.org', ['Socrata', 'Boston OpenContext']],
  ['2f32d9', R2F32D9, 'Socrata', 'socrata-mcp.civicaitools.org', ['Data Commons', 'Boston OpenContext']],
] as const) {
  test(`criterion 3: ${label}, no reference: its host from mcpServers, the record sentence, no link`, () => {
    const html = renderRecord(pkg, SERVED_78, label);
    assertClosedDetails(html, 1, label);
    const s = section(html);
    assertRows(s.flat, 1, [
      { name: 'The model service (not recorded)', texts: ['The model: Claude Haiku 5.5'] },
      { name: `${name}, 2 tool calls`, texts: [`${name} (${host})`] },
      { name: 'Notebook runner (not recorded)', texts: [RECORD_SENTENCE] },
    ], [...absent, 'Receives:', 'Who holds its logs', 'On, not used for this question.', 'Not set up on this site.', 'where a question can go'], label);
    assert.ok(!s.markup.includes('/api/flows'), 'no link to a statement');
    assertNoRetiredWords(s.flat, label);
  });
}

test('Stage C: the summary counts the sources reached, never names one: no data source, 1, 2', () => {
  const base = { notReached: [{ sourceId: 'socrata', name: 'Socrata', whyNotSent: 'Off.' }], statement: { kind: 'in-force' } };
  const modelRow = RUN_FLOWS.reached[0];
  for (const [n, reached] of [[0, [modelRow]], [1, RUN_FLOWS.reached.slice(0, 2)], [2, RUN_FLOWS.reached]] as const) {
    const html = withProviders(createElement(WhereItWent, { model: { ...base, reached } }));
    assertClosedDetails(html, n, `${n} sources`);
    const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? '';
    for (const row of reached) if (row.kind === 'source') assert.ok(!summary.includes(row.name), `the summary names ${row.name}`);
    assert.ok(!summary.includes('Socrata'), 'the summary names a source not reached');
  }
});

test('Stage C: two levels of indentation: the rows, then each row\'s recipients', () => {
  const html = withProviders(createElement(WhereItWent, { model: NOTEBOOK_FLOWS }));
  const s = part(html, 'where-it-went');
  const depth = (markup: string) => {
    let d = 0;
    let max = 0;
    for (const m of markup.matchAll(/<(\/?)ul\b/g)) {
      d += m[1] === '/' ? -1 : 1;
      max = Math.max(max, d);
    }
    return max;
  };
  assert.equal(depth(s.markup), 2, 'lists nest two deep');
});

test('criterion 3: a package with no trace renders no section; a traced one renders it', () => {
  assert.ok(section(renderRecord(D887C1, SERVED_78, 'traced-w4')).flat.includes(HEADING), 'premise: the traced record renders the section');
  const { trace: _trace, ...traceless } = D887C1;
  void _trace;
  const html = renderRecord(traceless, SERVED_78, 'traceless-w4');
  assert.ok(html.includes('data-part="status-row"'), 'premise: the record rendered');
  assert.ok(!html.includes('data-part="where-it-went"') && !html.includes(HEADING), 'a traceless record renders the section');
});
