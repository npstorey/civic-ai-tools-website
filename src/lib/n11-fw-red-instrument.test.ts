// THROWAWAY — Wave N11 F-W's red instrument (civic-ai-tools-website#434, G41 D1 D3 D4). Never merged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describeQueryOutcome, describeUnrecordedOutcomes } from './evidence/query-step.ts';
import { generateNotebook } from './notebook.ts';
import { synthesizeNotebook } from './notebook-author/synthesize.ts';

// --- D1: a pre-N10 record whose refusal lives only in its trace ------------------------------
// Shaped after the two live records G40 measured: entries carry no `failed`; one entry carries
// `resultRows`; the tool spans line up with the entries by position and byte-equal arguments; the
// refused call's span carries `error: true` and the source's raw text in `error.message`.

const RAW = 'N11FW-RAW-SOURCE-TEXT upstream said no';
const A0 = { type: 'query', portal: 'data.alpha-town.gov', dataset_id: 'aaaa-0001', limit: 3 };
const A1 = { type: 'catalog', portal: 'data.alpha-town.gov', query: 'permits', limit: 5 };
const A2 = { type: 'metadata', portal: 'data.alpha-town.gov', dataset_id: 'aaaa-0002' };
const attr = (key: string, value: unknown) =>
  typeof value === 'boolean' ? { key, value: { boolValue: value } }
    : typeof value === 'number' ? { key, value: { intValue: value } }
    : { key, value: { stringValue: String(value) } };
const span = (args: object, extra: Array<ReturnType<typeof attr>> = []) => ({
  name: 'mcp_tool_call',
  attributes: [attr('tool.name', 'get_data'), attr('tool.arguments', JSON.stringify(args)), ...extra],
});

const PRE_N10 = {
  metadata: { createdAt: '2026-05-21T14:48:59.489Z' },
  queries: [
    { tool: 'get_data', operationType: 'query', arguments: A0 },
    { tool: 'get_data', operationType: 'catalog', arguments: A1, resultRows: 5, resultColumns: 4 },
    { tool: 'get_data', operationType: 'metadata', arguments: A2 },
  ],
  trace: { resourceSpans: [{ scopeSpans: [{ spans: [
    span(A0, [attr('error', true), attr('error.message', RAW)]),
    span(A1, [attr('tool.response_rows', 5)]),
    span(A2),
  ] }] }] },
};

const CURRENT = {
  metadata: { createdAt: '2026-09-14T10:00:00.000Z' },
  queries: [
    { tool: 'get_data', operationType: 'query', arguments: A0, resultRows: 3, resultColumns: 2, duration_ms: 80 },
    { tool: 'get_data', operationType: 'metadata', arguments: A2, duration_ms: 40 },
  ],
  trace: { resourceSpans: [{ scopeSpans: [{ spans: [span(A0), span(A2)] }] }] },
};

test('PREMISE D1: the pre-N10 shape has its refusal only in the trace, and positions and arguments agree', () => {
  const spans = PRE_N10.trace.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans.length, PRE_N10.queries.length);
  spans.forEach((s, i) => {
    const args = s.attributes.find((a) => a.key === 'tool.arguments')!.value.stringValue as string;
    assert.deepEqual(JSON.parse(args), PRE_N10.queries[i].arguments);
  });
  assert.equal(PRE_N10.queries.some((q) => 'failed' in q), false);
});

test('PREMISE D1: the entry fields alone cannot state the refusal (why D1 reads the trace)', () => {
  assert.equal(describeQueryOutcome(PRE_N10.queries[0]).kind, 'unrecorded');
  assert.equal(describeQueryOutcome(PRE_N10.queries[2]).kind, 'unrecorded');
});

test('RED D1: that record carries the dated record-level statement', () => {
  assert.notEqual(describeUnrecordedOutcomes(PRE_N10), null);
});

test('PREMISE D1 (rider 3): a package the current producer writes, with an answered metadata call, gains no line and no refusal', () => {
  assert.equal(describeUnrecordedOutcomes(CURRENT), null);
  for (const q of CURRENT.queries) assert.notEqual(describeQueryOutcome(q).kind, 'failed');
});

// --- D3: the notebook cover names a portal only a refused call touched ------------------------

const ANSWERED = { name: 'get_data', operationType: 'query', args: { type: 'query', portal: 'data.alpha-town.gov', dataset_id: 'aaaa-0001', limit: 5 }, resultSummary: { rows: 5, columns: 3 }, duration_ms: 90 };
const REFUSED = { name: 'get_data', operationType: 'query', args: { type: 'query', portal: 'data.beta-town.gov', dataset_id: 'bbbb-0009', limit: 5 }, failed: true, failureKind: 'unknown', duration_ms: 30 };
const NO_ATTRIBUTION = { origin: null, host: null, platformTitle: null };
const portalLine = (cover: string) => (/\*\*Portals?:\*\*[^\n]*/.exec(cover) ?? [''])[0];
const coverOf = (nb: { cells: { source: string[] }[] }) => nb.cells[0].source.join('');

test('PREMISE D3: the answered portal is on the cover of both notebooks', () => {
  const skeleton = synthesizeNotebook({ query: 'q?', defaultPortal: '', modelName: 'test/model', modelAccess: 'through an API', finalAnswer: 'a', generatedAt: '2026-01-01T00:00:00.000Z', toolCalls: [ANSWERED, REFUSED] as never });
  assert.match(portalLine(coverOf(skeleton.notebook as never)), /data\.alpha-town\.gov/);
  assert.match(portalLine(coverOf(generateNotebook('q?', null, [ANSWERED, REFUSED] as never, 'a', NO_ATTRIBUTION) as never)), /data\.alpha-town\.gov/);
});

test('RED D3: the chat notebook cover does not list a refused-only portal as a portal', () => {
  assert.doesNotMatch(portalLine(coverOf(generateNotebook('q?', null, [ANSWERED, REFUSED] as never, 'a', NO_ATTRIBUTION) as never)), /data\.beta-town\.gov/);
});

test('RED D3: the skeleton notebook cover does not list a refused-only portal as a portal', () => {
  const { notebook } = synthesizeNotebook({ query: 'q?', defaultPortal: '', modelName: 'test/model', modelAccess: 'through an API', finalAnswer: 'a', generatedAt: '2026-01-01T00:00:00.000Z', toolCalls: [ANSWERED, REFUSED] as never });
  assert.doesNotMatch(portalLine(coverOf(notebook as never)), /data\.beta-town\.gov/);
});

// --- D4: the #407 guard's universe is a directory ---------------------------------------------

test('RED #407 universe: every tracked non-test file outside src/ that spells a portal hostname is classified by the guard', () => {
  const guard = readFileSync(new URL('./portal-default-is-configured.test.ts', import.meta.url), 'utf8');
  const re = /\b(?:data|opendata)\.[a-z0-9-]+\.(?:gov|us|org|com|net|io)\b|\b[a-z0-9-]+\.data\.socrata\.com\b|\bapi\.datacommons\.org\b/i;
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0')
    .filter((f) => f && !f.startsWith('src/') && /\.(ts|tsx|js|jsx|mjs|py|md)$/.test(f) && !/\.test\.tsx?$/.test(f));
  assert.ok(files.length > 20, `derived ${files.length} files: the instrument saw nothing`);
  const unclassified = files.filter((f) => re.test(readFileSync(f, 'utf8')) && !guard.includes(`'${f}'`));
  assert.deepEqual(unclassified, []);
});
