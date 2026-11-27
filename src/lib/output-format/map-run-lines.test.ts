// OF3b (Sprint OF-1, website #810; criterion 11, and criterion 9's model half): what a `present_result` call reads as
// in the run's steps, its summary sentence, "Where this question went" and the sources line, and the map part's model
// from a run's trace and from a record's bytes.
//
// WHAT MAKES IT ABLE TO FAIL.
//   - At OF3a's head the step reads "Gathering data", the summary ends "…, then called present_result.", the reason is
//     "to call present_result", and there is no map-part module: each assertion fails at its value.
//   - "Where this question went" is driven with a resolver that names a source for EVERY tool name, the present step's
//     included, so a reader that counts the step as a call to a source fails; the span reader is handed a present span
//     that carries `mcp.source`, which harness 0.16.0 never writes, for the same reason.
//   - The record's dataset reading is driven on a record whose last present call was refused after an accepted one
//     naming another dataset, so a reader that takes the last present call instead of the last accepted one fails.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (rel: string): Promise<Mod | null> => import(pathToFileURL(path.join(SRC, rel)).href).catch(() => null);
const streaming = (await load('lib/streaming.ts'))!;
const steps = (await load('lib/answer-view/steps.ts'))!;
const where = (await load('lib/flows/where-it-went.ts'))!;
const mapPart = await load('lib/output-format/map-part.ts');
const M = (): Mod => {
  assert.ok(mapPart, 'there is no map-part module');
  return mapPart!;
};

const getData = (dataset: string, portal = 'data.example.org') => ({ name: 'socrata__get_data', operationType: 'query', args: { type: 'query', dataset_id: dataset, portal, query: 'SELECT *' }, resultSummary: { rows: 5, columns: 4 } });
const present = (result: unknown, label: unknown, outcome = 'accepted') => ({ name: 'present_result', operationType: 'present_result', args: { result, label }, presentOutcome: outcome });

// --- The steps, the reason, the progress line and the breadcrumb -----------------------------------------------------

test('criterion 11 (red): the map step reads "Choosing what to map" while it runs and before the trace, never "Gathering data"', () => {
  const start = { message: 'x', timestamp: 0, phase: 'tool_start', iteration: 2, toolName: 'present_result', operationType: 'present_result', args: { result: 1, label: 'name' } };
  assert.equal(steps.openStepLabel([start]), 'Choosing what to map');
  assert.equal(steps.generateGroupLabel([start]), 'Choosing what to map');
  assert.equal(streaming.formatToolProgress('present_result', { result: 1, label: 'name' }), 'Choosing what to map');
  assert.equal(streaming.buildBreadcrumbLabel({ name: 'present_result', operationType: 'present_result', args: {} }), 'Choosing what to map');
  assert.ok(!streaming.generateToolReason({ result: 1, label: 'name' }, 'present_result').includes('present_result'));
});

test('criterion 11 (red): once the trace says what was mapped, the map step reads W10\'s line; a load step beside it keeps its own', () => {
  assert.ok(typeof steps.withMapStepLabel === 'function', 'there is no withMapStepLabel');
  const groups = [
    { iteration: 1, label: 'Querying data', isComplete: true, entries: [{ message: 'q', timestamp: 0, phase: 'tool_start', iteration: 1, toolName: 'socrata__get_data', operationType: 'query' }] },
    { iteration: 2, label: 'Choosing what to map', isComplete: true, entries: [{ message: 'p', timestamp: 0, phase: 'tool_start', iteration: 2, toolName: 'present_result', operationType: 'present_result' }] },
  ];
  const out = steps.withMapStepLabel(groups, 'This site mapped 3 of 5 rows from dataset pts1-0001');
  assert.deepEqual(out.map((g: { label: string }) => g.label), ['Querying data', 'This site mapped 3 of 5 rows from dataset pts1-0001']);
});

test('criterion 11 (red, the seat\'s 7175461805): the summary sentence ends with W10\'s clause, with the named dataset and without one', () => {
  const named = streaming.buildNarrativeSummary([getData('pts1-0001'), present(1, 'complaint_type')]);
  assert.ok(named.endsWith(', then chose rows from dataset pts1-0001 for this site to map.'), named);
  const unnamed = streaming.buildNarrativeSummary([{ name: 'socrata__get_data', operationType: 'query', args: { type: 'query', query: 'SELECT *' } }, present(1, 'complaint_type')]);
  assert.ok(unnamed.endsWith(', then chose rows for this site to map.'), unnamed);
  const outOfRange = streaming.buildNarrativeSummary([getData('pts1-0001'), present(9, 'complaint_type', 'refused')]);
  assert.ok(outOfRange.endsWith(', then chose rows for this site to map.'), outOfRange);
  for (const s of [named, unnamed, outOfRange]) assert.ok(!s.includes('present_result'), s);
});

test('criterion 11 (pin): the sources line names no source for the step, and its "Using …" clause only the queried dataset', () => {
  const calls = [getData('pts1-0001'), present(1, 'complaint_type')];
  assert.equal(streaming.buildProvenanceLine(calls), streaming.buildProvenanceLine([getData('pts1-0001')]));
  assert.ok(streaming.buildNarrativeSummary(calls).startsWith('Using '), 'premise: one dataset prefix');
});

test('criterion 11 (red): "Where this question went" counts no call for the step, even with a resolver that names a source for it', () => {
  const statement = null;
  const base = { resolveSource: () => 'socrata', sourcesOffered: [{ sourceId: 'socrata', alias: 'socrata', reason: 'offered' }], statement, model: 'm', service: 's' };
  const withStep = where.whereItWentFromCalls({ ...base, toolCalls: [getData('pts1-0001'), present(1, 'complaint_type')] });
  const without = where.whereItWentFromCalls({ ...base, toolCalls: [getData('pts1-0001')] });
  assert.deepEqual(withStep, without, 'the present step changed "Where this question went"');
  const span = (attrs: Record<string, string>) => ({ name: 'mcp_tool_call', attributes: Object.entries(attrs).map(([key, v]) => ({ key, value: { stringValue: v } })) });
  const fromSpans = where.whereItWentFromSpans({
    spans: [span({ 'tool.name': 'socrata__get_data', 'tool.operation_type': 'query', 'mcp.source': 'socrata' }), span({ 'tool.name': 'present_result', 'tool.operation_type': 'present_result', 'mcp.source': 'socrata' })],
    sourcesOffered: base.sourcesOffered,
  });
  const reached = fromSpans.reached.filter((r: { kind: string }) => r.kind === 'source');
  assert.deepEqual(reached.map((r: { sourceId: string; calls: number }) => [r.sourceId, r.calls]), [['socrata', 1]]);
});

// --- The map part's model from a trace ------------------------------------------------------------------------------

type Attr = { key: string; value: { stringValue: string } };
function traceWith(root: Record<string, string>, children: Array<Record<string, string>> = []): unknown {
  const attr = (key: string, value: string): Attr => ({ key, value: { stringValue: value } });
  return {
    resourceSpans: [{ scopeSpans: [{ spans: [
      { spanId: 'r', name: 'analysis', attributes: Object.entries(root).map(([k, v]) => attr(k, v)) },
      ...children.map((c, i) => ({ spanId: `c${i}`, parentSpanId: 'r', name: 'mcp_tool_call', attributes: Object.entries(c).map(([k, v]) => attr(k, v)) })),
    ] }] }],
  };
}
const MAP_REF = JSON.stringify({ id: 'plain-map', version: '1' });
const feature = (id: string, lon: number, lat: number, name?: unknown) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: name === undefined ? {} : { name } });
const drawnMap = (features: unknown[]) => ({ name: 'n', description: '', basemap: null, extent: { zoom: { mode: 'range', min: 0, max: 22 } }, view: null, legend: null, features });
const MARKUP = '<img src=x onerror=alert(1)><b>bold</b>';
const DRAWN = { outcome: { drawn: true }, counts: { returned: 5, drawn: 3, withoutLocation: 2, beyondCap: 0 }, map: drawnMap([feature('1', -73.99, 40.71, 'Noise'), feature('2', -73.98, 40.72, MARKUP), feature('4', -73.95, 40.75)]) };

test('criterion 9 (red): a run\'s map part is built from the trace, its alternative text from the counts; a name with markup stays text', () => {
  const trace = traceWith({ 'analysis.output_format': MAP_REF, 'analysis.output_format_result': JSON.stringify(DRAWN) });
  const part = M().mapPartFromTrace(trace, [getData('pts1-0001'), present(1, 'complaint_type')]);
  assert.equal(part.surface, 'run');
  assert.equal(part.outcome.kind, 'drawn');
  assert.equal(part.outcome.alt, 'Map of 3 points from dataset pts1-0001. 2 rows had no location.');
  assert.equal(part.outcome.countLine, '3 of 5 rows mapped; 2 had no location.');
  assert.equal(part.outcome.caption, 'The 3 mapped rows from dataset pts1-0001');
  assert.equal(part.stepLine, 'This site mapped 3 of 5 rows from dataset pts1-0001');
  assert.deepEqual(part.outcome.points, [
    { id: '1', longitude: -73.99, latitude: 40.71, name: 'Noise' },
    { id: '2', longitude: -73.98, latitude: 40.72, name: MARKUP },
    { id: '4', longitude: -73.95, latitude: 40.75 },
  ]);
  assert.deepEqual(JSON.parse(part.download.json), DRAWN.map, 'the download is not the map data as the record keeps it');
});

test('criterion 8 (red): no map part under "Auto", for a run with no outcome stated yet, or for a trace that cannot be read', () => {
  assert.equal(M().mapPartFromTrace(traceWith({}), []), null, '"Auto"');
  assert.equal(M().mapPartFromTrace(traceWith({ 'analysis.output_format': MAP_REF }), []), null, 'no outcome yet');
  assert.equal(M().mapPartFromTrace(traceWith({ 'analysis.output_format': MAP_REF, 'analysis.output_format_result': '{' }), []), null, 'malformed');
  assert.equal(M().mapPartFromTrace(null, []), null, 'no trace');
});

test('criterion 8 (red): every no-map outcome is a sentence, never an empty map; a call that named no dataset is "the data the AI chose"', () => {
  const cases: Array<[unknown, string]> = [
    [{ outcome: { drawn: false, reason: 'no-result-named' } }, 'No map: the AI did not make a choice this site could use.'],
    [{ outcome: { drawn: false, reason: 'no-location-columns' }, counts: { returned: 2, drawn: 0, withoutLocation: 2, beyondCap: 0 } }, 'No map: the data chosen for the map has no location column.'],
    [{ outcome: { drawn: false, reason: 'no-located-rows' }, counts: { returned: 2, drawn: 0, withoutLocation: 2, beyondCap: 0 } }, 'No map: none of the 2 rows had a location.'],
    [{ outcome: { drawn: false, reason: 'no-located-rows' }, counts: { returned: 1, drawn: 0, withoutLocation: 1, beyondCap: 0 } }, 'No map: the one row returned had no location.'],
    [{ outcome: { drawn: false, reason: 'no-located-rows' }, counts: { returned: 0, drawn: 0, withoutLocation: 0, beyondCap: 0 } }, 'No map: the data chosen for the map returned no rows.'],
    [{ outcome: { drawn: false, reason: 'result-failed' } }, 'No map: the data for the map did not arrive or could not be read.'],
  ];
  for (const [result, sentence] of cases) {
    const part = M().mapPartFromTrace(traceWith({ 'analysis.output_format': MAP_REF, 'analysis.output_format_result': JSON.stringify(result) }), []);
    assert.deepEqual(part.outcome, { kind: 'none', sentence });
    assert.equal(part.stepLine, sentence);
    assert.equal(part.download, undefined);
  }
  const unnamed = M().mapPartFromTrace(traceWith({ 'analysis.output_format': MAP_REF, 'analysis.output_format_result': JSON.stringify(DRAWN) }), [{ name: 'x', args: {} }, present(1, 'n')]);
  assert.equal(unnamed.outcome.caption, 'The 3 mapped rows from the data the AI chose');
});

// --- The map part's model from a record ----------------------------------------------------------------------------

const KEY = 'org.civicaitools.output-format';
const recordWith = (ext: unknown, queries: unknown[] = [], trace: unknown = undefined) => ({ extensions: ext === undefined ? {} : { [KEY]: ext }, queries, trace });

test('criterion 10 (red): a record states "Output format: Map", the not-shown line, the count line and the table, from its bytes; no download', () => {
  const queries = [
    { tool: 'socrata__get_data', operationType: 'query', arguments: { dataset_id: 'aaaa-0001' } },
    { tool: 'socrata__get_data', operationType: 'query', arguments: { dataset_id: 'pts1-0001' } },
    { tool: 'present_result', operationType: 'present_result', arguments: { result: 2, label: 'complaint_type' } },
    { tool: 'present_result', operationType: 'present_result', arguments: { result: 1, label: 'nope' } },
  ];
  // The trace states the third call accepted and the fourth refused: the dataset is the accepted call's.
  const trace = traceWith({}, [
    { 'tool.operation_type': 'query' }, { 'tool.operation_type': 'query' },
    { 'tool.operation_type': 'present_result', 'tool.present_outcome': 'accepted' },
    { 'tool.operation_type': 'present_result', 'tool.present_outcome': 'refused' },
  ]);
  const part = M().mapPartFromRecord(recordWith({ preset: { id: 'plain-map', version: '1' }, ...DRAWN }, queries, trace));
  assert.equal(part.surface, 'record');
  assert.equal(part.formatLine, 'Output format: Map');
  assert.equal(part.notShownLine, 'This page lists the mapped rows. It does not show the map.');
  assert.equal(part.outcome.countLine, '3 of 5 rows mapped; 2 had no location.');
  assert.equal(part.outcome.caption, 'The 3 mapped rows from dataset pts1-0001');
  assert.equal(part.download, undefined);
  assert.equal(part.stepLine, 'This site mapped 3 of 5 rows from dataset pts1-0001');
});

test('criterion 10 (red): a record with no key shows nothing about the format; a key with preset alone shows the format line only', () => {
  assert.equal(M().mapPartFromRecord(recordWith(undefined)), null);
  assert.equal(M().mapPartFromRecord({ queries: [] }), null);
  assert.deepEqual(M().mapPartFromRecord(recordWith({ preset: { id: 'plain-map', version: '1' } })), { surface: 'record', formatLine: 'Output format: Map' });
  const none = M().mapPartFromRecord(recordWith({ preset: { id: 'plain-map', version: '1' }, outcome: { drawn: false, reason: 'no-result-named' } }));
  assert.deepEqual(none.outcome, { kind: 'none', sentence: 'No map: the AI did not make a choice this site could use.' });
  assert.equal(none.notShownLine, undefined, 'the not-shown line is stated with no rows to list');
});

test('criterion 11 (red): a record\'s map step reads W10\'s line in its step view, not "No result summary was recorded"', () => {
  const view = steps.buildRecordStepView(
    [{ tool: 'socrata__get_data', operationType: 'query', arguments: { dataset_id: 'pts1-0001' }, resultRows: 5 }, { tool: 'present_result', operationType: 'present_result', arguments: { result: 1, label: 'n' } }],
    new Set(), new Map(), 'This site mapped 3 of 5 rows from dataset pts1-0001',
  );
  assert.equal(view.steps[1].label, 'Choosing what to map');
  assert.equal(view.steps[1].calls[0].outcome, 'This site mapped 3 of 5 rows from dataset pts1-0001.');
  assert.equal(view.steps[1].calls[0].failed, false);
});
