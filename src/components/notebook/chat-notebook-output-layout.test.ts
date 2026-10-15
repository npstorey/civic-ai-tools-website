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
