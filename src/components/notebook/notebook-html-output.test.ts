// The rule: notebook HTML output is sanitized before display.
//
// WHAT IS DRIVEN. `AnswerView` rendered by react-dom/server, in both paths
// that reach `RenderingCellOutputs`: a live run (`adaptNotebook`) and a stored
// record (`adaptRecord`, with a package as the store holds it). Each fixture
// output is one markup class; the rendered output block keeps only the
// allowlisted elements and attributes. A plain HTML table, the shape a pandas
// `DataFrame` produces, keeps its rows and cells in both paths. The stored
// package's bytes are the same after the render as before it.
//
// Module hooks resolve `@/` and transpile `.ts`/`.tsx`, as the other render
// tests here do.
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

function firstFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}
const candidatesFor = (base: string) => [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];

registerHooks({
  resolve(specifier, context, nextResolve) {
    const from = (context as { parentURL?: string }).parentURL;
    if (/^next\/[a-z-]+$/.test(specifier) && specifier !== 'next/server') return nextResolve(`${specifier}.js`, context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`notebook HTML output test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && from?.startsWith('file:') && fileURLToPath(from).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(from)), specifier)));
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
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        });
        return { format: 'module', source: out.outputText, shortCircuit: true };
      }
    }
    return nextLoad(loadUrl, context);
  },
});

type AnyComponent = ComponentType<Record<string, unknown>>;
const { default: AnswerView } = (await import('@/components/answer-view/AnswerView')) as unknown as { default: AnyComponent };
const { AnswerLayoutsProvider } = (await import('@/components/answer-view/AnswerLayoutsProvider')) as unknown as {
  AnswerLayoutsProvider: ComponentType<{ value: unknown; children?: ReactNode }>;
};
const { adaptNotebook } = await import('@/components/answer-view/adapt-notebook');
const { adaptRecord } = await import('@/components/answer-view/adapt-record');
const { BUILT_IN_INSTANCE_LAYOUTS } = await import('@/lib/answer-layout');

// --- Fixtures -------------------------------------------------------------------

const ANSWER = 'ANSWER-nbhtml';
const MARKDOWN = { output_type: 'display_data', metadata: {}, data: { 'text/markdown': ANSWER } };
const html = (text: string) => ({ output_type: 'execute_result', metadata: {}, data: { 'text/html': text } });

const DATAFRAME = [
  '<div>',
  '<style scoped>',
  '    .dataframe tbody tr th:only-of-type {',
  '        vertical-align: middle;',
  '    }',
  '</style>',
  '<table border="1" class="dataframe">',
  '  <thead>',
  '    <tr style="text-align: right;">',
  '      <th></th>',
  '      <th>borough</th>',
  '      <th>count</th>',
  '    </tr>',
  '  </thead>',
  '  <tbody>',
  '    <tr>',
  '      <th>0</th>',
  '      <td>BRONX</td>',
  '      <td>12</td>',
  '    </tr>',
  '    <tr>',
  '      <th>1</th>',
  '      <td>A &amp; B</td>',
  '      <td>7</td>',
  '    </tr>',
  '  </tbody>',
  '</table>',
  '</div>',
].join('\n');

/** One fixture per markup class, each the smallest the class needs. */
const CLASSES: [name: string, html: string, absent: RegExp][] = [
  ['a script element', '<script>x()</script>', /<script|x\(\)/i],
  ['an event-handler attribute on an allowlisted element', '<table><tr><td onclick="x()">1</td></tr></table>', /\son[a-z]+\s*=/i],
  ['an event-handler attribute on another element', '<img src="x" onerror="x()">', /<img|\son[a-z]+\s*=/i],
  ['a script-scheme address', '<a href="javascript:x()">a</a>', /<a\b|href|javascript:/i],
  ['an embedded document', '<iframe srcdoc="&lt;script&gt;x()&lt;/script&gt;"></iframe>', /<iframe|srcdoc/i],
  ['an object element', '<object data="x.svg"></object><embed src="x.svg">', /<object|<embed|data=|src=/i],
  ['foreign content', '<svg onload="x()"><math><mi>1</mi></math></svg>', /<svg|<math|\son[a-z]+\s*=/i],
  ['markup inside a raw-text element', '<noscript><p title="</noscript><img src=x onerror=x()>"></noscript>', /<noscript|<img|\son[a-z]+\s*=/i],
  ['a form, a base and a meta element', '<form action="x"><button formaction="x">b</button></form><base href="x"><meta http-equiv="refresh" content="0">', /<form|<button|<base|<meta|action=|href=/i],
];

const ALLOWED_ELEMENTS = new Set([
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'div', 'span', 'p', 'br', 'hr', 'b', 'i', 'u', 's', 'strong', 'em', 'small', 'sub', 'sup',
  'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);
const ALLOWED_ATTRIBUTES = new Set(['border', 'colspan', 'rowspan', 'span']);

function notebook(outputs: unknown[]) {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { extensions: { 'org.civicaitools.notebook': { provenance: 'executed' } } },
    cells: [{ cell_type: 'code', metadata: { role: 'synthesis' }, execution_count: 1, source: ['display(t)\n'], outputs }],
  };
}

function storedPackage(nb: unknown): Record<string, unknown> {
  return {
    metadata: { schemaVersion: '0.1.0', packageId: 'nbhtml', createdAt: '2026-11-20T00:00:00.000Z', signingKeyId: 'platform:fixture', captureMethod: 'chat-flow-stream', contentProfile: 'datHere' },
    prompt: { hash: 'd'.repeat(64), visibility: 'full_text', text: 'How many?' },
    queries: [],
    cost: { model: 'openai/gpt-4o', promptTokens: 1, completionTokens: 1, totalTokens: 2, durationMs: 1 },
    skillMetadata: { skillText: 'skill', systemPromptHash: 'e'.repeat(64) },
    output: ANSWER,
    summary: 'summary',
    dataSources: [],
    extensions: { 'org.civicaitools.notebook': nb },
  };
}

const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;

function render(model: unknown): string {
  return renderToStaticMarkup(createElement(Session, { session: null },
    createElement(AnswerLayoutsProvider, { value: BUILT_IN_INSTANCE_LAYOUTS }, createElement(AnswerView, { model }))));
}

function live(outputs: unknown[]): string {
  return render(adaptNotebook({
    notebook: notebook(outputs) as never, prompt: 'How many?', model: 'openai/gpt-4o', portal: 'data.example.test',
    toolCalls: [], instance: 'records.example.test', socrataMcpUrl: null,
  }));
}

function stored(outputs: unknown[]): { markup: string; before: string; after: string } {
  const pkg = storedPackage(notebook(outputs));
  const before = JSON.stringify(pkg);
  const model = adaptRecord({
    stored: pkg as never,
    resolution: { pkg, outputIsBlob: false, outputBlobRef: null, skillTextIsBlob: false, skillTextBlobRef: null } as never,
    row: { slug: 'nbhtml-record', summary: 'summary', contentProfile: 'datHere', captureMethod: 'chat-flow-stream' },
    instance: 'records.example.test',
  });
  const markup = render(model);
  return { markup, before, after: JSON.stringify(pkg) };
}

const PATHS: [name: string, run: (outputs: unknown[]) => string][] = [
  ['a live run', live],
  ['a stored record', (outputs) => stored(outputs).markup],
];

/** The HTML output's block, as `RenderingCellOutputs` renders it. */
function htmlBlock(markup: string): string {
  const open = '<div style="font-size:14px;overflow:auto">';
  const start = markup.indexOf(open);
  assert.ok(start >= 0, 'the HTML output block renders');
  let depth = 1;
  const tags = /<(\/?)div\b[^>]*>/g;
  tags.lastIndex = start + open.length;
  for (let m = tags.exec(markup); m !== null; m = tags.exec(markup)) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return markup.slice(start + open.length, m.index);
  }
  assert.fail('the HTML output block does not close');
}

/** Every element and attribute in a block, as written. */
function elementsAndAttributes(block: string): { elements: string[]; attributes: string[] } {
  const elements: string[] = [];
  const attributes: string[] = [];
  for (const m of block.matchAll(/<\/?([a-zA-Z][^\s/>]*)([^>]*)>/g)) {
    elements.push(m[1].toLowerCase());
    for (const a of m[2].matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g)) attributes.push(a[1].toLowerCase());
  }
  return { elements, attributes };
}

function cells(block: string): string[][] {
  return [...block.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1]));
}

// --- The rule -----------------------------------------------------------------------

for (const [pathName, run] of PATHS) {
  for (const [className, fixture, absent] of CLASSES) {
    test(`notebook HTML output is sanitized before display: ${className}, on ${pathName}`, () => {
      const block = htmlBlock(run([MARKDOWN, html(`<p>KEEP</p>${fixture}`)]));
      assert.ok(block.includes('<p>KEEP</p>'), `the allowlisted part of the output is not shown: ${block}`);
      assert.doesNotMatch(block, absent, `the output block keeps it: ${block}`);
      const { elements, attributes } = elementsAndAttributes(block);
      assert.deepEqual(elements.filter((e) => !ALLOWED_ELEMENTS.has(e)), [], `an element outside the allowlist: ${block}`);
      assert.deepEqual(attributes.filter((a) => !ALLOWED_ATTRIBUTES.has(a)), [], `an attribute outside the allowlist: ${block}`);
    });
  }

  test(`a plain HTML table renders as a table with the same rows and cells, on ${pathName}`, () => {
    const block = htmlBlock(run([MARKDOWN, html(DATAFRAME)]));
    assert.match(block, /<table\b[^>]*>[\s\S]*<thead>[\s\S]*<tbody>[\s\S]*<\/table>/, `not a table: ${block}`);
    assert.deepEqual(cells(block), cells(DATAFRAME), 'the rows and cells differ from the output');
    assert.deepEqual(cells(block), [['', 'borough', 'count'], ['0', 'BRONX', '12'], ['1', 'A &amp; B', '7']], 'premise: the fixture table');
    assert.doesNotMatch(block, /vertical-align/, 'a style element is shown');
  });
}

test('a stored record’s package bytes are the same after the render; only the render differs', () => {
  const fixture = `<p>KEEP</p>${CLASSES[0][1]}`;
  const { markup, before, after } = stored([MARKDOWN, html(fixture)]);
  assert.equal(after, before, 'the render changed the stored package');
  assert.ok(before.includes(JSON.stringify(fixture).slice(1, -1)), 'premise: the stored package carries the output as written');
  assert.doesNotMatch(htmlBlock(markup), /<script/i, 'the render shows the output as written');
});
