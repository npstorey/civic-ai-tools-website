// LAYOUT-W1 P1: the executed run (`/ask`, notebook mode) opens with the answer.
//
// THE LAYOUT, in this order, by position in the rendered markup:
//   1. the status row — "Captured via Web chat · Executed in signed sandbox ·
//      not yet published", its three facts and words unchanged;
//   2. the refused-request line (ruling D2), only when a captured call is
//      stated as failed, outside the disclosure, under the status row;
//   3. the answer, with no section heading;
//   4. the citation (`ChatCitationPreview`), directly beneath it;
//   5. one `<details>`, closed, whose summary reads exactly
//      "Learn more about how this analysis was produced", holding A-G and the
//      signers in that order. F renders the same answer element again.
//
// HOW IT IS DRIVEN. The component itself, rendered to static markup with
// `react-dom/server` under `node --test`. `--experimental-strip-types` does not
// transform JSX, so `module.registerHooks()` (in-file, as the route tests use
// it) maps `@/` to `src/`, resolves extensionless relative specifiers under
// `src/` to their `.ts`/`.tsx` file, and runs every `.ts`/`.tsx` under `src/`
// through the TypeScript compiler already in devDependencies
// (`transpileModule`, `jsx: react-jsx`). No new dependency. The component is
// imported AFTER the hooks are registered, by a dynamic import.
// `ChatCitationPreview` calls `useSession`, so the tree is wrapped in
// next-auth's `SessionProvider` with no session.
//
// A CLAIM CHECKED IN NODE, NOT IN A BROWSER: this reads the server-rendered
// markup. A closed `<details>` keeps its children in that markup, which is
// what lets the contents be asserted; that a browser shows them only on a
// click is the element's own behaviour, not measured here.
//
// THE FIXTURE CAN FAIL. It renders every section with content of its own (a
// marker per section), carries an answer marker that appears nowhere but in
// the answer's output (not in any cell source, the summary or the prompt),
// and its D2 run holds one failed call among three beside an UNRECORDED one,
// so a count by "not returned" would read two.
//
// RED at d1919a8 (+ the typed stub of `describeRefusedRequests`): the answer is
// fifth, under "F · Rendered answer"; there is no disclosure; the letters
// precede it; no line states the refused call.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/notebook/chat-notebook-output-layout.test.ts)

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

// W2 P2: the real hook (`useNotebookStream`) is driven outside React, as
// `notebook-error-traceback.test.ts` drives it: FOR THE HOOK MODULE ONLY,
// `react` is a state cell and `@/lib/sse-client` a reader that hands the hook
// the fixture's events. Every other module gets the real ones.
const HOOK_FILE = path.join(SRC, 'hooks/useNotebookStream.ts');
const HOOK_STUB_PREFIX = 'file:///layout-web-w2-p2-hook-stub/';
const HOOK_STUBS: Record<string, string> = {
  react: `
    export function useState(initial) {
      globalThis.__w2p2Hook.state = typeof initial === 'function' ? initial() : initial;
      const set = (update) => {
        globalThis.__w2p2Hook.state = typeof update === 'function' ? update(globalThis.__w2p2Hook.state) : update;
      };
      return [globalThis.__w2p2Hook.state, set];
    }
    export function useCallback(fn) { return fn; }
    export function useRef(value) { return { current: value }; }`,
  '@/lib/sse-client': `
    export async function connectSSE({ onEvent, onComplete }) {
      for (const event of globalThis.__w2p2Hook.events) onEvent(event);
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
    // Next's bundler resolves these subpaths; Node's resolver needs the file.
    if (/^next\/[a-z-]+$/.test(specifier) && specifier !== 'next/server') return nextResolve(`${specifier}.js`, context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`layout test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && parent?.startsWith('file:') && fileURLToPath(parent).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(parent)), specifier)));
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

const { default: ChatNotebookOutput } = (await import('./ChatNotebookOutput.tsx')) as unknown as {
  default: ComponentType<Record<string, unknown>>;
};

// --- Fixture -------------------------------------------------------------------

const ANSWER_MARKER = 'ANSWERMARKER-p1-7f3c';
const DISCLOSURE_LABEL = 'Learn more about how this analysis was produced';

const NOTEBOOK = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {
    extensions: {
      'org.civicaitools.summary': {
        analysisDescription: 'SUMMARYDESC-p1',
        headlineFinding: 'SUMMARYFINDING-p1',
      },
      'org.civicaitools.execution': {
        executedAt: '2026-10-15T12:00:00Z',
        executionDuration_ms: 4200,
        sandboxId: 'fixture-sandbox',
        environment: { python: 'PYTHONMARKER-p1', libraries: { pandas: '2.2.3' } },
      },
    },
  },
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Fixture notebook\n'] },
    {
      cell_type: 'code',
      metadata: { role: 'synthesis' },
      execution_count: 1,
      source: ['display(Markdown(answer))\n'],
      outputs: [
        { output_type: 'display_data', metadata: {}, data: { 'text/markdown': `${ANSWER_MARKER}: **42** complaints in the window.` } },
      ],
    },
  ],
};

const RETURNED = { name: 'get_data', operationType: 'query', reason: 'Counting complaints', resultSummary: { rows: 12, columns: 3 } };
const FAILED = { name: 'get_data', operationType: 'query', reason: 'Counting permits', failed: true, failureKind: 'timeout' };
const UNRECORDED = { name: 'get_data', operationType: 'metadata', reason: 'Reading the columns' };

function render(toolCalls: object[]): string {
  const output = createElement(ChatNotebookOutput, {
    notebook: NOTEBOOK,
    prompt: 'PROMPTMARKER-p1 How many complaints were filed?',
    model: 'fixture/model',
    portal: 'data.example.org',
    toolCalls,
    composedSystemPrompt: 'SYSTEMPROMPTMARKER-p1',
    composedSystemPromptHash: 'a'.repeat(64),
    signingKeyId: 'fixture-key',
  });
  // `ChatCitationPreview` calls `useSession`; no session is signed in.
  const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;
  return renderToStaticMarkup(createElement(Session, { session: null }, output));
}

const WITH_FAILURE = render([RETURNED, FAILED, UNRECORDED]);
const WITHOUT_FAILURE = render([RETURNED, UNRECORDED, RETURNED]);

// --- Markup readers ------------------------------------------------------------

/** End index (exclusive) of the element of `tag` opening at `start`, nesting counted. */
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

interface Disclosure { start: number; end: number; openTag: string; summaryText: string }

/** The `<details>` whose own `<summary>` carries the label, or null. */
function disclosureOf(html: string): Disclosure | null {
  const re = /<details\b[^>]*>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const after = html.slice(m.index + m[0].length);
    const summary = /^<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(after);
    if (summary === null) continue;
    const summaryText = summary[1].replace(/<[^>]*>/g, '');
    if (!summaryText.includes('Learn more')) continue;
    return { start: m.index, end: elementEnd(html, m.index, 'details'), openTag: m[0], summaryText };
  }
  return null;
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

function requireDisclosure(html: string): Disclosure {
  const d = disclosureOf(html);
  assert.ok(d !== null, `no <details> whose summary reads "${DISCLOSURE_LABEL}" is rendered`);
  return d;
}

const STATUS_FACTS = ['Captured via <strong>Web chat</strong>', 'Executed in signed sandbox', 'not yet published'];
const SECTION_TITLES = [
  'A · Initial prompt',
  'B · System prompts',
  'C · Model + environment',
  'D · Deliberative trace',
  'E · Answer notebook',
  'F · Rendered answer',
  'G · Summary',
];
const SIGNER_TITLES = ['Signed by', 'Production method', 'Attestations'];
/** Each part's own content in the fixture, read between its heading and the next. */
const SECTION_CONTENT: Array<[string, string]> = [
  ['A · Initial prompt', 'PROMPTMARKER-p1'],
  ['B · System prompts', 'SYSTEMPROMPTMARKER-p1'],
  ['C · Model + environment', 'PYTHONMARKER-p1'],
  ['D · Deliberative trace', 'Counting permits'],
  ['E · Answer notebook', '.ipynb'],
  ['F · Rendered answer', ANSWER_MARKER],
  ['G · Summary', 'SUMMARYFINDING-p1'],
  ['Signed by', 'fixture-key'],
  ['Production method', 'Executed in signed sandbox'],
  ['Attestations', 'None yet'],
];
const heading = (title: string) => `>${title}</h3>`;

// --- Criterion 1: the order ----------------------------------------------------

test('P1 (1) the order: status row, then the answer, then the citation, then one closed disclosure with the label', () => {
  for (const html of [WITH_FAILURE, WITHOUT_FAILURE]) {
    const facts = STATUS_FACTS.map((f) => at(html, f));
    assert.deepEqual([...facts].sort((a, b) => a - b), facts, 'the status row states its three facts in order');
    const answer = at(html, ANSWER_MARKER);
    assert.ok(facts[2] < answer, 'the status row precedes the answer');
    const citation = at(html, heading('Citation'));
    assert.ok(answer < citation, 'the citation sits beneath the answer');
    assert.ok(
      html.slice(answer, citation).indexOf('</h3>') === -1,
      'nothing with a heading sits between the answer and the citation',
    );
    const d = requireDisclosure(html);
    assert.ok(citation < d.start, 'the disclosure follows the citation');
    assert.equal(d.summaryText, DISCLOSURE_LABEL, 'the disclosure summary reads exactly the ruled label');
    assert.doesNotMatch(d.openTag, /\bopen\b/, 'the disclosure is closed by default');
    assert.equal(occurrences(html, DISCLOSURE_LABEL).length, 1, 'one disclosure, not one per part');
  }
});

// --- Criterion 2: the contents, and one source for both answers ----------------

test('P1 (2) A-G and the signers sit inside the disclosure, in order, and nowhere before it', () => {
  const html = WITH_FAILURE;
  const d = requireDisclosure(html);
  let last = d.start;
  for (const title of [...SECTION_TITLES, ...SIGNER_TITLES]) {
    const all = occurrences(html, heading(title));
    assert.equal(all.length, 1, `"${title}" is rendered once`);
    assert.ok(all[0] > last && all[0] < d.end, `"${title}" sits inside the disclosure, after the part before it`);
    last = all[0];
  }
  // Every part renders content of its own, under its own heading: the fixture
  // leaves no part empty, so no part's placement is asserted over nothing.
  const titles = [...SECTION_TITLES, ...SIGNER_TITLES];
  for (const [title, marker] of SECTION_CONTENT) {
    const i = titles.indexOf(title);
    const from = at(html, heading(title));
    const to = i + 1 < titles.length ? at(html, heading(titles[i + 1])) : d.end;
    assert.ok(html.slice(from, to).includes(marker), `"${title}" renders its fixture content (${marker})`);
  }
});

test('P1 (2) the answer is rendered twice from one element: before the disclosure, and as F inside it, with identical markup', () => {
  for (const html of [WITH_FAILURE, WITHOUT_FAILURE]) {
    const d = requireDisclosure(html);
    const markers = occurrences(html, ANSWER_MARKER);
    assert.equal(markers.length, 2, `the answer marker appears exactly twice (found ${markers.length})`);
    assert.ok(markers[0] < d.start, 'the first answer sits before the disclosure');
    const f = at(html, heading('F · Rendered answer'));
    const g = at(html, heading('G · Summary'));
    assert.ok(markers[1] > f && markers[1] < g && markers[1] < d.end, 'the second answer is F, inside the disclosure');

    const answers = occurrences(html, '<div data-part="answer"');
    assert.equal(answers.length, 2, 'the answer element is rendered twice');
    const [first, second] = answers.map((start) => html.slice(start, elementEnd(html, start, 'div')));
    assert.ok(first.includes(ANSWER_MARKER), 'the first answer element carries the answer');
    assert.equal(first, second, 'the two answers are the same markup');
  }
});

function componentSource(): string {
  return fs.readFileSync(path.join(HERE, 'ChatNotebookOutput.tsx'), 'utf8');
}

test('P1 (2) read from the source: the answer has one render site', () => {
  const source = componentSource();
  assert.equal(source.match(/<RenderingCellOutputs\b/g)?.length ?? 0, 1, 'one <RenderingCellOutputs render site');
  assert.equal(source.match(/<ReactMarkdown\b/g)?.length ?? 0, 1, 'one <ReactMarkdown render site');
  assert.match(source, /<ReactMarkdown\b[^>]*>\{view\.synthesisMarkdown\}<\/ReactMarkdown>/, 'the one ReactMarkdown renders synthesisMarkdown');
  assert.equal(source.match(/No synthesis was produced for this analysis\./g)?.length ?? 0, 1, 'one empty-answer sentence');
});

// --- Criterion 3: no section letter above the disclosure -----------------------

test('P1 (3) no section-letter heading precedes the answer or the disclosure', () => {
  for (const html of [WITH_FAILURE, WITHOUT_FAILURE]) {
    const answer = at(html, ANSWER_MARKER);
    assert.doesNotMatch(html.slice(0, answer), /[A-G] · /, 'a section letter precedes the first answer');
    const d = requireDisclosure(html);
    assert.doesNotMatch(html.slice(0, d.start), /[A-G] · /, 'a section letter precedes the disclosure');
  }
});

// --- Criterion 4: the refused-request line (ruling D2) -------------------------

const REFUSED_LINE = '1 of 3 requests did not complete.';

test('P1 (4) one failed call among three: the line sits under the status row, before the answer, outside the disclosure', () => {
  const html = WITH_FAILURE;
  const lines = occurrences(html, REFUSED_LINE);
  assert.equal(lines.length, 1, `"${REFUSED_LINE}" is rendered once (found ${lines.length})`);
  const status = at(html, 'not yet published');
  const answer = at(html, ANSWER_MARKER);
  assert.ok(status < lines[0] && lines[0] < answer, 'the line sits after the status row and before the answer');
  const d = requireDisclosure(html);
  assert.ok(lines[0] < d.start, 'the line is outside the disclosure');
  // The per-call sentence stays in D, inside the disclosure.
  const perCall = occurrences(html, 'This request did not complete.');
  assert.equal(perCall.length, 1, 'the failed call is stated once per call, in D');
  assert.ok(perCall[0] > at(html, heading('D · Deliberative trace')) && perCall[0] < d.end, 'the per-call text stays in D');
});

test('P1 (4) no failed call: no refused-request line', () => {
  assert.doesNotMatch(WITHOUT_FAILURE, /did not complete/, 'a run with no failed call states no refusal');
  assert.doesNotMatch(WITHOUT_FAILURE, /requests? did not complete/);
});

test('P1 (4) read from the source: the line is written by describeRefusedRequests, not a literal', () => {
  const source = componentSource();
  assert.match(source, /describeRefusedRequests\(/, 'ChatNotebookOutput.tsx renders the line through describeRefusedRequests');
  assert.match(
    source,
    /import \{[^}]*\bdescribeRefusedRequests\b[^}]*\} from '@\/lib\/evidence\/query-step'/,
    'describeRefusedRequests is imported from the one module that owns it',
  );
  assert.doesNotMatch(source, /did not complete/, 'the component writes no refusal sentence of its own');
});

// --- LAYOUT-WEB W2 P2 (4): section D is unchanged ---------------------------------
//
// Section D, inside the disclosure, keeps the raw recorded fields: the step view
// outside it is new, D is not. D's markup for the fixture below is compared,
// byte for byte, with `chat-notebook-output-section-d.golden.txt`.
//
// THE GOLDEN WAS NOT WRITTEN BY HAND. It is this block's output on the base
// (website main 662099b): the base tree, extracted with `git archive`, ran this
// file with `SECTION_D_ACTUAL_OUT` set, and the markup it wrote is the golden.
//
// THE ONE INTENDED DIFFERENCE is each call's label, which W2 P2 moves from the
// name the model called (`socrata__get_data`) to the upstream name. The label's
// text is normalized to `[label]` on both sides, so the golden pins everything
// else in D, and the label is asserted on its own (below, once it changes).
//
// THE FIXTURE CAN FAIL. Four calls, each on its own branch of D's line: an
// aliased call with an operation type, a reason and a returned row count; a
// rejected call (`failed`, `failureKind`, an elapsed); a `fetch` whose reason
// names an identifier (the heading falls back to the call's number) and whose
// outcome is unrecorded (no outcome line); a tool with no operation type.

const D_CALLS = [
  {
    name: 'socrata__get_data', operationType: 'query', reason: 'to aggregate 311 Service Requests by borough',
    args: { dataset_id: 'erm2-nwe9', group: 'borough' }, resultSummary: { rows: 5, columns: 2 }, duration_ms: 410,
  },
  {
    name: 'socrata__get_data', operationType: 'query', reason: 'to filter qq7x-k2rd records',
    args: { dataset_id: 'qq7x-k2rd', where: "issued > '2026-01-01'" }, failed: true, failureKind: 'timeout', duration_ms: 1200,
  },
  {
    name: 'socrata__fetch', reason: 'to look up record:data.example.org:abcd-1234:7',
    args: { id: 'record:data.example.org:abcd-1234:7' },
  },
  { name: 'nyc_charter__get_section', reason: 'to call get_section', args: { section: '1' } },
];

/** Section D's markup, from its heading to the next section's. */
function sectionD(html: string): string {
  return html.slice(at(html, heading('D · Deliberative trace')), at(html, heading('E · Answer notebook')));
}

/** D with each call's label text replaced by `[label]` (the one intended difference). */
function normalizeDLabels(d: string): string {
  return d.replace(/(<div style="font-family:monospace;[^"]*">)([^<]*)(<\/div>)/g, '$1[label]$3');
}

const D_ACTUAL = normalizeDLabels(sectionD(render(D_CALLS)));
if (process.env.SECTION_D_ACTUAL_OUT) fs.writeFileSync(process.env.SECTION_D_ACTUAL_OUT, D_ACTUAL);

test('W2 P2 (4) section D renders the same markup as on the base, its labels normalized', () => {
  const goldenPath = path.join(HERE, 'chat-notebook-output-section-d.golden.txt');
  assert.ok(fs.existsSync(goldenPath), `no golden at ${goldenPath}; it is captured on the base, never written by hand`);
  const golden = fs.readFileSync(goldenPath, 'utf8');
  assert.equal(occurrences(D_ACTUAL, '[label]').length, D_CALLS.length, 'one normalized label per call: the normalization still finds every label');
  if (D_ACTUAL === golden) return;
  let i = 0;
  while (i < golden.length && golden[i] === D_ACTUAL[i]) i++;
  assert.fail(`section D differs from the golden at character ${i}:\n  golden: …${golden.slice(Math.max(0, i - 60), i + 80)}…\n  actual: …${D_ACTUAL.slice(Math.max(0, i - 60), i + 80)}…`);
});

// --- LAYOUT-WEB W2 P2 (1): the executed run renders its steps ---------------------
//
// THE LAYOUT GAINS ONE PART, between the citation and the disclosure: the step
// view, one step per Phase A iteration, each call with the sentence
// `generateToolReason` writes (through `reasonWithoutIdentifier`) and the
// outcome `describeQueryOutcome` states, under one author line.
//
// HOW IT IS DRIVEN. The real hook reads the fixture's events as the route
// sends them (`phase_a_progress` lines carry no arguments; the calls arrive as
// `phase_a_tool_call` events once Phase A is over, with an identical repeat
// dropped), and `NotebookOutput` renders the state it produced, so the steps
// travel the path a run's do: hook, page, view.
//
// THE FIXTURE CAN FAIL. Three iterations and four calls, so the step count and
// the call count differ: iteration 1 makes two calls; iteration 2 repeats
// iteration 1's query exactly, which the route drops from the calls; iteration
// 3 makes a call that is rejected, on a dataset no other call touches, then a
// new query. Paired by position, the rejected call would sit in step 2.

const W2_TOOL = 'socrata__get_data';
const W2_ARGS = {
  metadata: { type: 'metadata', dataset_id: 'erm2-nwe9' },
  count: { type: 'query', dataset_id: 'erm2-nwe9', select: 'count(*)' },
  permits: { type: 'query', dataset_id: 'qq7x-k2rd', where: "issued > '2026-01-01'" },
  byBorough: { type: 'query', dataset_id: 'erm2-nwe9', group: 'borough' },
};

/** A call's progress lines as the route forwards them: no arguments. */
function lines(iteration: number, message: string, operationType: string, failed = false): Array<Record<string, unknown>> {
  const tool = { toolName: W2_TOOL, operationType };
  const failure = failed ? { failed: true, failureKind: 'timeout' } : {};
  return [
    { type: 'phase_a_progress', phase: 'tool_start', iteration, message, ...tool },
    { type: 'phase_a_progress', phase: 'tool_complete', iteration, message, ...tool, ...failure },
  ];
}

const W2_CALLS = [
  { type: 'phase_a_tool_call', name: W2_TOOL, operationType: 'metadata', reason: 'x', args: W2_ARGS.metadata, duration_ms: 120 },
  { type: 'phase_a_tool_call', name: W2_TOOL, operationType: 'query', reason: 'x', args: W2_ARGS.count, resultSummary: { rows: 1, columns: 1 }, duration_ms: 300 },
  { type: 'phase_a_tool_call', name: W2_TOOL, operationType: 'query', reason: 'x', args: W2_ARGS.permits, failed: true, failureKind: 'timeout', duration_ms: 45000 },
  { type: 'phase_a_tool_call', name: W2_TOOL, operationType: 'query', reason: 'x', args: W2_ARGS.byBorough, resultSummary: { rows: 5, columns: 2 }, duration_ms: 410 },
];

const W2_EVENTS: Array<Record<string, unknown>> = [
  { type: 'phase', name: 'A', message: 'Discovering datasets…' },
  ...lines(1, 'Reading the columns', 'metadata'),
  ...lines(1, 'Counting complaints', 'query'),
  ...lines(2, 'Counting complaints', 'query'),
  ...lines(3, 'Querying permits', 'query', true),
  ...lines(3, 'Grouping complaints by borough', 'query'),
  ...W2_CALLS,
  { type: 'phase_a_answer', content: `${ANSWER_MARKER}: **42** complaints in the window.` },
  { type: 'phase', name: 'B', message: 'Synthesizing notebook…' },
  { type: 'phase', name: 'C', message: 'Executing in sandbox…' },
  { type: 'notebook', notebook: NOTEBOOK, sandboxId: 'fixture-sandbox', executionDuration_ms: 4200, validation: { ok: true, issues: [] } },
  { type: 'phase', name: 'D', message: 'Finalizing…' },
  { type: 'phase', name: 'complete', message: 'Done.' },
];
const W2_ITERATIONS = new Set(W2_EVENTS.filter((e) => e.phase === 'tool_start').map((e) => e.iteration)).size;

interface HookCell { state: Record<string, unknown>; events: Array<Record<string, unknown>> }
const hookCell: HookCell = { state: {}, events: [] };
(globalThis as unknown as { __w2p2Hook: HookCell }).__w2p2Hook = hookCell;

// Called outside React on purpose (see the harness note above).
const { useNotebookStream: notebookStreamOutsideReact } = (await import(pathToFileURL(HOOK_FILE).href)) as {
  useNotebookStream: () => { start: (query: string, model: string, portal: string) => Promise<void> };
};
const { default: NotebookOutput } = (await import('./NotebookOutput.tsx')) as unknown as {
  default: ComponentType<Record<string, unknown>>;
};
const { EvidenceOriginProvider } = (await import('@/components/EvidenceOriginProvider')) as unknown as {
  EvidenceOriginProvider: ComponentType<{ value: Record<string, string | null>; children?: ReactNode }>;
};

async function stateAfter(events: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
  hookCell.events = events;
  await notebookStreamOutsideReact().start('PROMPTMARKER-p1 How many complaints were filed?', 'fixture/model', 'data.example.org');
  return hookCell.state;
}

const W2_INSTANCE = 'instance.example.test';
const W2_STATE = await stateAfter(W2_EVENTS);

/** The page a run's reader sees, with the instance declared or not. */
function renderRun(state: Record<string, unknown>, instance: string | null): string {
  const page = createElement(NotebookOutput, {
    state,
    prompt: 'PROMPTMARKER-p1 How many complaints were filed?',
    model: 'fixture/model',
    portal: 'data.example.org',
  });
  const origin = createElement(EvidenceOriginProvider, {
    value: { origin: instance ? `https://${instance}` : null, host: instance, platformTitle: null },
  }, page);
  const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;
  return renderToStaticMarkup(createElement(Session, { session: null }, origin));
}

const W2_RUN = renderRun(W2_STATE, W2_INSTANCE);
const W2_RUN_ANONYMOUS = renderRun(W2_STATE, null);
const AUTHOR_LINE = `Steps, written by ${W2_INSTANCE} from the model&#x27;s calls`;

/** The step view's markup, or a failure saying there is none. */
function stepView(html: string): string {
  const start = at(html, '<div data-part="steps"');
  return html.slice(start, elementEnd(html, start, 'div'));
}

/** Each step's markup, in order. */
function stepsIn(view: string): string[] {
  // The trailing space: `data-part="steps"` and `"step-call"` share the prefix.
  return occurrences(view, '<div data-part="step" ').map((s) => view.slice(s, elementEnd(view, s, 'div')));
}

const callRows = (markup: string) => occurrences(markup, 'data-part="step-call"').length;

test('W2 P2 (1) the executed run: status row, refused-request line, answer, citation, steps, disclosure', () => {
  const html = W2_RUN;
  const status = at(html, 'not yet published');
  const refused = at(html, '1 of 4 requests did not complete.');
  const answer = at(html, ANSWER_MARKER);
  const citation = at(html, heading('Citation'));
  const steps = at(html, '<div data-part="steps"');
  const d = requireDisclosure(html);
  assert.ok(status < refused && refused < answer && answer < citation && citation < steps && steps < d.start,
    'status row, refused-request line, answer, citation, steps, disclosure, in that order');
  assert.ok(steps + stepView(html).length <= d.start, 'the step view ends before the disclosure starts');
});

test('W2 P2 (1) one step per Phase A iteration, one call row per captured call, each call in its own step', () => {
  const view = stepView(W2_RUN);
  const steps = stepsIn(view);
  assert.equal(W2_ITERATIONS, 3, 'premise: the fixture has three iterations');
  assert.equal(steps.length, W2_ITERATIONS, `one step per iteration (found ${steps.length})`);
  assert.equal((W2_STATE.toolCalls as unknown[]).length, W2_CALLS.length, 'premise: the hook kept every captured call');
  assert.equal(callRows(view), W2_CALLS.length, `one call row per captured call (found ${callRows(view)})`);
  assert.deepEqual(steps.map(callRows), [2, 0, 2], 'the calls sit in the steps they were made in');
  assert.ok(steps[2].includes('This request did not complete.'), 'the rejected call is in step 3');
  assert.ok(!steps[1].includes('did not complete'), 'and not in step 2, where position pairing would put it');
  assert.equal(occurrences(view, 'data-part="steps-unplaced"').length, 0, 'every call is placed');
});

test('W2 P2 (1) each call row carries the formatters’ sentence and outcome, and each step the label over its calls’ arguments', async () => {
  const { generateToolReason, reasonWithoutIdentifier } = await import('@/lib/streaming');
  const { describeQueryOutcome } = await import('@/lib/evidence/query-step');
  const rows = stepsIn(stepView(W2_RUN)).flatMap((step) =>
    occurrences(step, '<div data-part="step-call"').map((s) => step.slice(s, elementEnd(step, s, 'div'))));
  W2_CALLS.forEach((c, i) => {
    const sentence = reasonWithoutIdentifier(generateToolReason(c.args, c.name));
    assert.ok(sentence, 'premise: each fixture call has a sentence');
    assert.ok(rows[i].includes(`>${escapedText(sentence)}<`), `call ${i + 1} carries "${sentence}"`);
    const outcome = describeQueryOutcome({
      failed: c.failed, failureKind: c.failureKind, resultRows: c.resultSummary?.rows,
      resultColumns: c.resultSummary?.columns, duration_ms: c.duration_ms,
    }).text;
    assert.ok(rows[i].includes(`>${escapedText(outcome)}<`), `call ${i + 1} carries "${outcome}"`);
  });
  const labels = stepsIn(stepView(W2_RUN)).map((step) => /data-part="step-label"[^>]*>([^<]*)</.exec(step)?.[1]);
  assert.ok(labels.every((l) => l !== undefined && l !== 'Gathering data'), `every step's label reads its calls' arguments: ${labels.join(' | ')}`);
});

test('W2 P2 (1) the author line is stated once, above the steps, and not at all when the instance declares none', () => {
  const view = stepView(W2_RUN);
  assert.equal(occurrences(W2_RUN, AUTHOR_LINE).length, 1, 'the author line appears exactly once');
  assert.ok(view.indexOf(AUTHOR_LINE) >= 0 && view.indexOf(AUTHOR_LINE) < view.indexOf('data-part="step"'), 'above the steps');
  assert.equal(occurrences(W2_RUN_ANONYMOUS, 'Steps, written by').length, 0, 'no author line without an instance');
  assert.equal(stepsIn(stepView(W2_RUN_ANONYMOUS)).length, W2_ITERATIONS, 'the steps still render');
});

/** `renderToStaticMarkup`'s escaping of a text node. */
function escapedText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

// --- LAYOUT-WEB W2 P2 (3): no exposed name in reader-facing text -----------------
//
// The run's tools are aliased (`socrata__get_data`, `socrata__fetch`,
// `nyc_charter__get_section`). What a reader reads — the markup outside
// `<script>` and `<style>` — carries no alias separator (`__`). The executed
// run's section D shows no raw field that could carry one (its arguments are
// not printed), so nothing is exempted here.

/** The markup a reader reads: scripts and styles removed. */
function readerFacing(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '');
}

test('W2 P2 (3) the executed run prints no exposed tool name: not in the steps, not in section D', () => {
  const html = renderRun(W2_STATE, W2_INSTANCE);
  assert.ok((W2_STATE.toolCalls as Array<{ name: string }>).every((c) => c.name.includes('__')), 'premise: the run’s calls are aliased');
  const direct = render(D_CALLS);
  for (const [name, markup] of [['the hook-driven run', html], ['section D’s fixture', direct]] as const) {
    const text = readerFacing(markup);
    const i = text.indexOf('__');
    assert.equal(i, -1, `${name}: reader-facing text carries an exposed name: …${text.slice(Math.max(0, i - 80), i + 40)}…`);
  }
});

test('W2 P2 (4) section D labels each call by its upstream name and operation type', async () => {
  const { upstreamToolName } = await import('@/lib/mcp/operation-types');
  const d = sectionD(render(D_CALLS));
  const labels = [...d.matchAll(/<div style="font-family:monospace;[^"]*">([^<]*)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(labels, D_CALLS.map((c) => `${upstreamToolName(c.name)}${c.operationType ? ` (${c.operationType})` : ''}`));
});
