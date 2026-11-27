// OF3b (Sprint OF-1, website #810; criteria 8, 9 and 10, the markup half): the map part as `AnswerView` renders it,
// through react-dom/server, as the server renders a run's view and the record page before the layout toggle reads the
// session. The browser half (layout, focus, what the page fetches) is `scripts/layout-measure`'s check 7.
//
// WHAT IS DRIVEN. The comparison's adapter (`adaptComparison`) over a trace whose root span states a map format and
// what was presented, as the stream's `trace` event hands it to the panel; the record's map part
// (`mapPartFromRecord`) over a record's extension; `AnswerView` under `answer-first` and under `envelope-order`.
//
// WHAT MAKES IT ABLE TO FAIL. At OF3a's head the view has no map part: every red fails at its first markup read. A
// row's name carries markup (`<img …>`, `<b>…</b>`), so a part that rendered the data as HTML would put the elements in
// the markup. Fold 5 (flag 6) replaced the envelope-order pin: the map part now renders under every built-in layout,
// and each layout is driven on both surfaces.
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
      if (found === null) throw new Error(`OF3b test hook: cannot resolve ${specifier}`);
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
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const { default: AnswerView } = (await import('@/components/answer-view/AnswerView')) as unknown as { default: AnyComponent };
const { AnswerLayoutsProvider } = (await import('@/components/answer-view/AnswerLayoutsProvider')) as unknown as {
  AnswerLayoutsProvider: ComponentType<{ value: unknown; children?: ReactNode }>;
};
const { adaptComparison } = (await import('@/components/answer-view/adapt-comparison')) as unknown as Mod;
const { ANSWER_FIRST, ENVELOPE_ORDER } = (await import('@/lib/answer-layout')) as unknown as Mod;
// By a variable, so the file type-checks where the module does not exist yet (the red commit).
const MAP_PART_MODULE: string = '@/lib/output-format/map-part';
const mapPart: Mod | null = await import(MAP_PART_MODULE).catch(() => null);

// --- A map run's trace and calls ---------------------------------------------------------------------------------

type Attr = { key: string; value: { stringValue: string } };
const attr = (key: string, value: string): Attr => ({ key, value: { stringValue: value } });
const traceWith = (root: Record<string, string>) => ({ resourceSpans: [{ scopeSpans: [{ spans: [{ spanId: 'r', name: 'analysis', attributes: Object.entries(root).map(([k, v]) => attr(k, v)) }] }] }] });
const MAP_REF = JSON.stringify({ id: 'plain-map', version: '1' });
const MARKUP = '<img src=x onerror=alert(1)><b>bold</b>';
const feature = (id: string, lon: number, lat: number, name?: unknown) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: name === undefined ? {} : { name } });
const DRAWN = {
  outcome: { drawn: true },
  counts: { returned: 5, drawn: 3, withoutLocation: 2, beyondCap: 0 },
  map: { name: 'n', description: '', basemap: null, extent: { zoom: { mode: 'range', min: 0, max: 22 } }, view: null, legend: null, features: [feature('1', -73.99, 40.71, 'Noise'), feature('2', -73.98, 40.72, MARKUP), feature('4', -73.95, 40.75)] },
};
const CALLS = [
  { name: 'socrata__get_data', operationType: 'query', args: { type: 'query', dataset_id: 'pts1-0001', query: 'SELECT *' }, resultSummary: { rows: 5, columns: 4 } },
  { name: 'present_result', operationType: 'present_result', args: { result: 1, label: 'complaint_type' }, presentOutcome: 'accepted' },
];
const GROUPS = [
  { iteration: 1, label: 'Querying data', isComplete: true, entries: [{ message: 'q', timestamp: 0, phase: 'tool_start', iteration: 1, toolName: 'socrata__get_data', operationType: 'query', isComplete: true }] },
  { iteration: 2, label: 'Choosing what to map', isComplete: true, entries: [{ message: 'Choosing what to map', timestamp: 0, phase: 'tool_start', iteration: 2, toolName: 'present_result', operationType: 'present_result', isComplete: true }] },
];
const ANSWER_TEXT = 'The complaints cluster in three places.';

function runModel(trace: unknown) {
  return adaptComparison({
    content: ANSWER_TEXT, isComplete: true, isActive: false, queryText: 'Where?', toolsCalled: CALLS,
    progressGroups: GROUPS, progressLog: GROUPS.flatMap((g) => g.entries), model: 'vendor/model-fixture-1', evidenceTrace: trace, instance: null,
  });
}
const layouts = (layout: unknown) => ({ default: layout, offered: [layout] });
// The run's citation preview reads the client session; the server renders it inside the root layout's provider.
const { SessionProvider } = (await import('next-auth/react')) as unknown as { SessionProvider: ComponentType<{ session: unknown; children?: ReactNode }> };
const render = (model: unknown, layout: unknown = ANSWER_FIRST): string =>
  renderToStaticMarkup(createElement(SessionProvider, { session: null }, createElement(AnswerLayoutsProvider, { value: layouts(layout) }, createElement(AnswerView, { model }))));
const count = (html: string, needle: string) => html.split(needle).length - 1;
const mapTrace = (result: unknown) => traceWith({ 'analysis.output_format': MAP_REF, 'analysis.output_format_result': JSON.stringify(result) });

// --- Criterion 8 ---------------------------------------------------------------------------------------------------

test('criterion 8 (red): under answer-first, a map run shows the answer, then the plot, the count line, the table under its caption, and the save action', () => {
  const html = render(runModel(mapTrace(DRAWN)));
  const at = (needle: string) => html.indexOf(needle);
  assert.ok(at('data-part="map"') > 0, 'there is no map part');
  assert.ok(at('data-part="answer"') < at('data-part="map"'), 'the map part does not follow the answer');
  assert.ok(html.includes(ANSWER_TEXT), 'the written answer is not shown');
  assert.equal(count(html, 'data-part="map-plot"'), 1, 'one plot');
  assert.equal(count(html, '<circle'), 3, 'the plot does not draw one point per mapped row');
  assert.ok(html.includes('<p data-part="map-count-line"'), 'no count line');
  assert.ok(html.includes('>3 of 5 rows mapped; 2 had no location.<'), 'the count line');
  assert.ok(html.includes('<caption'), 'the table has no caption');
  assert.ok(html.includes('>The 3 mapped rows from dataset pts1-0001</caption>'), 'the caption');
  assert.match(html, /data-part="map-table" role="region" aria-label="The 3 mapped rows from dataset pts1-0001" tabindex="0"/, 'the table is not in a focusable, named region');
  assert.ok(/data-part="map-download"[^>]*>Download map data</.test(html), 'no "Download map data"');
});

test('criterion 8 (red): a run that mapped nothing shows W8\'s sentence and no plot, no table and no save action: never an empty map', () => {
  const html = render(runModel(mapTrace({ outcome: { drawn: false, reason: 'no-location-columns' }, counts: { returned: 2, drawn: 0, withoutLocation: 2, beyondCap: 0 } })));
  assert.ok(html.includes('>No map: the data chosen for the map has no location column.<'), 'no sentence');
  assert.ok(html.includes(ANSWER_TEXT), 'the written answer is not shown');
  for (const part of ['map-plot', 'map-table', 'map-download', 'map-count-line']) assert.ok(!html.includes(`data-part="${part}"`), part);
});

// Fold 5, flag 6 (the seat's 7224717454): a reader's layout choice does not hide the map. Under each built-in layout the
// map part renders with the answer, directly after it, on the run's view and on the record page; and it renders once
// (the disclosure's F places the answer again, never the map).
const RECORD_FIXTURE = { extensions: { 'org.civicaitools.output-format': { preset: { id: 'plain-map', version: '1' }, ...DRAWN } }, queries: [{ tool: 'socrata__get_data', operationType: 'query', arguments: { dataset_id: 'pts1-0001' } }, { tool: 'present_result', operationType: 'present_result', arguments: { result: 1, label: 'complaint_type' } }], trace: { resourceSpans: [{ scopeSpans: [{ spans: [{ name: 'mcp_tool_call', attributes: [attr('tool.operation_type', 'present_result'), attr('tool.present_outcome', 'accepted')] }] }] }] } };
for (const [name, layout] of [['answer-first', ANSWER_FIRST], ['envelope-order', ENVELOPE_ORDER]] as const) {
  test(`fold 5, flag 6 (red under envelope-order): under ${name}, the run's map part renders once, directly after the answer`, () => {
    const html = render(runModel(mapTrace(DRAWN)), layout);
    assert.equal(count(html, 'data-part="map"'), 1, `under ${name} the run's view shows ${count(html, 'data-part="map"')} map parts`);
    assert.equal(count(html, 'data-part="map-plot"'), 1, 'no plot');
    // The answer the map part follows: the last one before it. Under envelope-order the disclosure, which holds the
    // answer again as F, comes before the answer part.
    const mapAt = html.indexOf('data-part="map"');
    const answerAt = html.lastIndexOf('data-part="answer"', mapAt);
    assert.ok(answerAt >= 0 && answerAt < mapAt, 'the map part does not follow the answer');
    assert.equal(count(html.slice(answerAt, mapAt), 'data-part='), 1, 'another part sits between the answer and the map part');
  });

  test(`fold 5, flag 6 (red under envelope-order): under ${name}, the record page's map part renders once, directly after the answer`, () => {
    assert.ok(mapPart, 'there is no map-part module');
    const html = render({ ...runModel(traceWith({})), map: mapPart!.mapPartFromRecord(RECORD_FIXTURE) }, layout);
    assert.equal(count(html, 'data-part="map"'), 1, `under ${name} the record page shows ${count(html, 'data-part="map"')} map parts`);
    assert.ok(html.includes('>Output format: Map<') && html.includes('>3 of 5 rows mapped; 2 had no location.<'));
    assert.ok(html.indexOf('data-part="answer"') < html.indexOf('data-part="map"'), 'the map part does not follow the answer');
    assert.ok(!html.includes('data-part="map-plot"'), 'the record page draws a plot');
  });
}

test('criterion 8 (pin): under "Auto" the view is byte for byte the view with no format at all', () => {
  const auto = runModel(traceWith({}));
  assert.equal(auto.map, undefined);
  assert.equal(render(auto), render(runModel(traceWith({}))));
  assert.ok(!render(auto).includes('data-part="map'));
});

test('criterion 11 (red): the run\'s steps carry W10\'s line once the trace states the outcome', () => {
  const model = runModel(mapTrace(DRAWN));
  assert.deepEqual(model.steps.groups.map((g: { label: string }) => g.label), ['Querying data', 'This site mapped 3 of 5 rows from dataset pts1-0001']);
});

// Fold 6 (the seat's 7225128356): the table's "Label" heading and its two lines, and "not stated" for a row with no
// label value, on the map part and on the record page. The label column is the present call's own `label` argument;
// the fixture's third mapped row carries no name, so an empty cell fails the "not stated" read.
const LABEL_LINE = 'Label: the value in the complaint_type column. The AI chose that column.';
const ROW_LINE_5 = 'Row: its place in the 5 rows the data source returned, counting from 1.';
const ROW_LINE_1 = 'Row: its place in the 1 row the data source returned, counting from 1.';
const ONE_ROW = {
  outcome: { drawn: true },
  counts: { returned: 1, drawn: 1, withoutLocation: 0, beyondCap: 0 },
  map: { ...DRAWN.map, features: [feature('1', -73.99, 40.71, 'Noise')] },
};
function tableHead(html: string): string[] {
  return [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
}

test('fold 6 (red): the run\'s map part heads its table "Row", "Label", "Latitude", "Longitude", with the Label and Row lines under it, and "not stated" for an empty label', () => {
  const html = render(runModel(mapTrace(DRAWN)));
  assert.deepEqual(tableHead(html), ['Row', 'Label', 'Latitude', 'Longitude']);
  assert.ok(html.includes(`>${LABEL_LINE}<`), 'no Label line');
  assert.ok(html.includes(`>${ROW_LINE_5}<`), 'no Row line');
  assert.ok(html.indexOf('</table>') < html.indexOf(LABEL_LINE), 'the Label line is not under the table');
  assert.ok(html.indexOf('</table>') < html.indexOf(ROW_LINE_5), 'the Row line is not under the table');
  assert.ok(/<td[^>]*>not stated<\/td>/.test(html), 'a row with no label value does not read "not stated"');
});

test('fold 6 (red): the record page heads its table the same way, with both lines, "not stated", and the one-row form of the Row line', () => {
  assert.ok(mapPart, 'there is no map-part module');
  const html = render({ ...runModel(traceWith({})), map: mapPart!.mapPartFromRecord(RECORD_FIXTURE) });
  assert.deepEqual(tableHead(html), ['Row', 'Label', 'Latitude', 'Longitude']);
  assert.ok(html.includes(`>${LABEL_LINE}<`), 'no Label line');
  assert.ok(html.includes(`>${ROW_LINE_5}<`), 'no Row line');
  assert.ok(/<td[^>]*>not stated<\/td>/.test(html), 'a row with no label value does not read "not stated"');
  const one = render({ ...runModel(traceWith({})), map: mapPart!.mapPartFromRecord({ ...RECORD_FIXTURE, extensions: { 'org.civicaitools.output-format': { preset: { id: 'plain-map', version: '1' }, ...ONE_ROW } } }) });
  assert.ok(one.includes(`>${ROW_LINE_1}<`), 'the Row line\'s one-row form');
  assert.ok(one.includes('>1 of 1 row mapped.<'), 'premise: the one-row record');
});

// --- Criterion 9 ---------------------------------------------------------------------------------------------------

test('criterion 9 (red): the plot\'s alternative text is built from the counts, and markup in a row\'s name is shown as text', () => {
  const html = render(runModel(mapTrace(DRAWN)));
  assert.match(html, /<svg data-part="map-plot" role="img" aria-label="Map of 3 points from dataset pts1-0001\. 2 rows had no location\."/);
  assert.ok(html.includes('<title>Map of 3 points from dataset pts1-0001. 2 rows had no location.</title>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&lt;b&gt;bold&lt;/b&gt;'), 'the name is not shown as text');
  assert.ok(!html.includes('<img src=x'), 'the name rendered an image element');
  assert.ok(!html.includes('<b>bold</b>'), 'the name rendered markup');
});

// --- Criterion 10 --------------------------------------------------------------------------------------------------

test('criterion 10 (red): the record page shows "Output format: Map", the not-shown line, the count line and the table; no plot, no save action', () => {
  assert.ok(mapPart, 'there is no map-part module');
  const record = { extensions: { 'org.civicaitools.output-format': { preset: { id: 'plain-map', version: '1' }, ...DRAWN } }, queries: [{ tool: 'socrata__get_data', operationType: 'query', arguments: { dataset_id: 'pts1-0001' } }, { tool: 'present_result', operationType: 'present_result', arguments: { result: 1, label: 'complaint_type' } }], trace: { resourceSpans: [{ scopeSpans: [{ spans: [{ name: 'mcp_tool_call', attributes: [attr('tool.operation_type', 'present_result'), attr('tool.present_outcome', 'accepted')] }] }] }] } };
  const base = runModel(traceWith({}));
  const html = render({ ...base, map: mapPart!.mapPartFromRecord(record) });
  assert.ok(html.includes('>Output format: Map<'), 'no format line');
  assert.ok(html.includes('>This page lists the mapped rows. It does not show the map.<'), 'no not-shown line');
  assert.ok(html.indexOf('Output format: Map') < html.indexOf('This page lists the mapped rows.'), 'the not-shown line is not under the format line');
  assert.ok(html.includes('>3 of 5 rows mapped; 2 had no location.<'));
  assert.ok(html.includes('>The 3 mapped rows from dataset pts1-0001</caption>'));
  assert.ok(!html.includes('data-part="map-plot"'), 'the record page draws a plot');
  assert.ok(!html.includes('<svg data-part'), 'the record page draws a plot');
  assert.ok(!html.includes('data-part="map-download"'), 'the record page offers "Download map data"');
  assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;') && !html.includes('<b>bold</b>'), 'the record page rendered a name as markup');
});

test('criterion 10 (red): a record with no format key shows nothing about the format', () => {
  assert.ok(mapPart, 'there is no map-part module');
  assert.equal(mapPart!.mapPartFromRecord({ extensions: {}, queries: [] }), null);
  const html = render(runModel(traceWith({})));
  assert.ok(!html.includes('Output format'), 'the page says something about the format');
});
