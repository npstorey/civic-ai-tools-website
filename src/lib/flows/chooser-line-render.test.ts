// S2-B D3 and R5 (npstorey/civic-ai-tools#309): how "Where this question went" renders a loaded pack.
//
// THE SEAT'S AMENDMENT (6779017419, extending W12's 6753417284): `WhereItWent.tsx` renders the pack id's one
// code part as a code element, whole: not a link, not split, not passed through `echoCapped`; and R5's sentence,
// a line of its own kind, as a paragraph after the groups' list, not as a fourth item in it. Nothing else in the
// component changes, so a chooser with no pack renders the markup it rendered before.
//
// WHAT IS DRIVEN. The real `whereItWentFromPackage` over a record whose trace states a pack call, and the real
// component, rendered to static markup (the `.tsx` transpiled as `where-it-went-chooser.test.ts` does). This file
// sits outside `src/components/` so W12's guard over that tree lists only the component.
//
// RED at tree 5b (d99f2532): the id is plain text inside the Loaded item, and there is no definition paragraph.
//
// Run with: npm test

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
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');
const candidatesFor = (base: string) => [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
function firstFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const from = (context as { parentURL?: string }).parentURL;
    if (/^next\/[a-z-]+$/.test(specifier) && specifier !== 'next/server') return nextResolve(`${specifier}.js`, context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`chooser render test hook: cannot resolve ${specifier}`);
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
      if (file.startsWith(SRC) && /\.tsx$/.test(file)) {
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

type Json = Record<string, unknown>;
const { default: WhereItWent } = (await import('@/components/answer-view/WhereItWent')) as unknown as { default: ComponentType<{ model: unknown }> };
const { whereItWentFromPackage } = (await import('@/lib/flows/where-it-went')) as unknown as { whereItWentFromPackage: (pkg: unknown, served: unknown) => Json | null };

const PACK_ID = 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx';
const R5 = 'A pack is a source with no server of its own. Its requests go through the server of the source named after “using”, limited to what the pack fixes in advance, such as one dataset.';
const OFFERED = [
  { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
  { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'selected' },
];
const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
const span = (spanId: string, attrs: Array<[string, string]>) =>
  ({ name: 'mcp_tool_call', spanId, parentSpanId: 'root', attributes: attrs.map(([k, v]) => attr(k, v)) });

function record(alias: string, packId?: string): Json {
  const spans = [
    { name: 'analysis', spanId: 'root', attributes: [attr('analysis.routing', JSON.stringify({ method: 'in-loop', version: '0.8.0' })), attr('analysis.sources_offered', JSON.stringify(OFFERED))] },
    span('load', [['tool.name', 'load_source'], ['tool.operation_type', 'load_source'], ['tool.arguments', JSON.stringify({ alias })], ['tool.load_outcome', 'loaded']]),
    span('call', [
      ['tool.name', `${alias}__get_data`], ['tool.operation_type', 'query'], ['tool.arguments', JSON.stringify({ type: 'query', limit: 1 })],
      ['mcp.source', 'socrata'], ['mcp.alias', 'socrata'], ['mcp.server.id', 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server'],
      ...(packId ? [['mcp.pack_id', packId] as [string, string]] : []),
    ]),
  ];
  return {
    trace: { resourceSpans: [{ scopeSpans: [{ spans }] }] },
    extensions: { 'org.civicaitools.composition': { sourcesOffered: OFFERED, routing: { method: 'in-loop', version: '0.8.0' }, definitionHash: 'f'.repeat(64) } },
  };
}

function chooserMarkup(pkg: Json): string {
  const model = whereItWentFromPackage(pkg, null);
  assert.ok(model, 'premise: the record yields a "Where this question went" model');
  const html = renderToStaticMarkup(createElement(WhereItWent, { model }));
  const part = html.match(/<div data-part="where-it-went-chooser"[\s\S]*?<\/div>/);
  assert.ok(part, 'premise: the section renders a chooser line');
  return part![0];
}

test('S2-B D3 (the seat\'s amendment): the pack id renders whole in one code element, in the Loaded item, and not as a link', () => {
  const html = chooserMarkup(record('nyc_record', PACK_ID));
  const codes = [...html.matchAll(/<code[^>]*>(.*?)<\/code>/g)].map((m) => m[1]);
  assert.deepEqual(codes, [PACK_ID], `the id is not one whole code element: ${html}`);
  assert.match(html, new RegExp(`<li>Loaded: NYC City Record \\(a pack recorded as <code[^>]*>${PACK_ID.replace(/[.]/g, '\\.')}</code>, using Socrata\\)\\.</li>`));
  assert.equal(/<a[\s>]/.test(html), false, 'the chooser line holds a link');
});

test('S2-B R5 (the seat\'s amendment): the definition renders once, as a paragraph after the groups\' list, not as an item of it', () => {
  const html = chooserMarkup(record('nyc_record', PACK_ID));
  assert.equal(html.split(R5).length - 1, 1, 'the definition is not rendered exactly once');
  assert.match(html, new RegExp(`</ul><p[^>]*>${R5}</p></div>$`));
  assert.equal(html.includes(`<li>${R5}`), false, 'the definition renders as a list item');
});

test('S2-B D3 decoy: a record whose loaded source states no pack id renders no code element and no definition', () => {
  const html = chooserMarkup(record('socrata'));
  assert.equal(html.includes('<code'), false);
  assert.equal(html.includes('A pack is'), false);
  assert.match(html, /<li>Loaded: Socrata\.<\/li>/);
});
