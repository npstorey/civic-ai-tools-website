// S2-B W11 (npstorey/civic-ai-tools#309; card G0-B4 A; the research check's R8, ruled D4 = A): a notebook step
// naming a tool of a server this site no longer runs is stated as not re-runnable, in R8's words, then the
// existing closing line.
//
// THE CASE. Under router 0.8.0 NYC City Record is a pack over the Socrata server, and no manifest entry declares
// its old server's seven tools. Records sealed before the move still name them, as `nyc_record__search_notices`
// and its six siblings. Until this change such a call was no step at all: `isAnalysisStep` did not admit it, so
// the executed notebook listed it under "Discovery" and the skeleton left it out (P3's stage-1 measurement).
// It returned notices an answer can rest on, so it is a step neither notebook can re-run, as Charter's
// `get_section` is.
//
// HOW A STEP IS KNOWN TO NAME ONE. `RETIRED_HOSTED_SERVERS` (`../mcp/retired-sources.ts`) carries the retired
// server's alias and tool names, frozen from the last manifest this site pinned that declared them (router
// 0.6.0, read by script). The package and version in the sentence come from the same entry, never typed here.
// The server's name is R8's spelling, not the manifest's `displayName`, which now names the pack.
//
// THE DECOY. A Charter `get_section` step still renders the hosted branch's words, unchanged.
//
// RED at tree 5b (d99f2532): the entry has no `alias` or `toolNames`, and an answered retired call is no step.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { RETIRED_HOSTED_SERVERS } from '../mcp/retired-sources.ts';
import { isAnalysisStep, renderDiscoverySummaryCell, renderFetchToolCell, type PhaseAToolCall } from './tool-to-cell.ts';
import { generateNotebook } from '../notebook.ts';
import { synthesizeNotebook } from './synthesize.ts';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Router 0.6.0's City Record entry, as `RETIRED_HOSTED_SERVERS` freezes it (P3's `read-retired.mjs`). */
const SEVEN = [
  'search_notices',
  'get_notices_by_agency',
  'get_notices_by_type',
  'get_procurement_notices',
  'get_public_hearings',
  'get_open_solicitations',
  'get_notices_by_date_range',
];
const RETIRED = RETIRED_HOSTED_SERVERS['nyc-record'] as unknown as Loose;
const CTX = { dataFrameIndex: 1, defaultPortal: 'data.cityofnewyork.us' };
const CLOSING = 'No code cell is generated for it, and nothing is cited for it: this document did not read that source.';

/** R8's four sentences (the owner's D4 = A), with the call's name and the frozen pin filled in. */
const r8 = (tool: string, pinned: string) =>
  `The original analysis called \`${tool}\`, a tool of BetaNYC's City Record MCP server. ` +
  `The site that ran the analysis used the pinned package \`${pinned}\` for that server. ` +
  'It no longer runs that server: City Record notices now come through the Socrata source. ' +
  'This notebook has no helper that calls that tool, so no cell here repeats the request, and nothing here states what it returned.';

const answered = (name: string): PhaseAToolCall => ({
  name,
  args: { query: 'sidewalk repair', limit: 5 },
  resultSummary: { rows: 5, columns: 9 },
  reason: 'to search City Record notices',
});

const cellText = (output: ReturnType<typeof renderFetchToolCell>) =>
  (output?.cells ?? []).map((c) => [c.source].flat().join('')).join('\n');

test('S2-B W11 premise: the retired entry freezes router 0.6.0\'s alias and seven tool names, and no installed entry declares them', () => {
  assert.equal(RETIRED.alias, 'nyc_record');
  assert.deepEqual(RETIRED.toolNames, SEVEN);
  assert.deepEqual(CIVIC_MANIFEST.filter((entry) => entry.toolNames.some((name) => SEVEN.includes(name))).map((e) => e.sourceId), []);
  assert.equal(`${RETIRED.package}@${RETIRED.version}`, '@betanyc/nyc-record-mcp@1.1.0');
});

for (const tool of SEVEN) {
  test(`S2-B W11: an answered nyc_record__${tool} is a step, stated as not re-runnable in R8's words, then the closing line`, () => {
    const call = answered(`nyc_record__${tool}`);
    assert.equal(isAnalysisStep(call), true, 'the retired call is not a step');
    const output = renderFetchToolCell(call, CTX);
    assert.ok(output, 'the retired call renders no step cell');
    assert.equal(
      cellText(output),
      [`#### Not reproduced: \`nyc_record__${tool}\``, '', r8(`nyc_record__${tool}`, `${RETIRED.package}@${RETIRED.version}`), '', CLOSING].join('\n'),
    );
    assert.equal(output!.citation, null, 'the cell credits a source this notebook did not read');
    assert.equal(output!.producedDataFrame, false);
    assert.equal(output!.cells.every((c) => c.cell_type === 'markdown'), true, 'the step has a code cell');
  });
}

test('S2-B W11: the pin in the sentence is the frozen entry\'s, and the server\'s name is not the manifest\'s displayName', () => {
  const text = cellText(renderFetchToolCell(answered('nyc_record__search_notices'), CTX));
  assert.ok(text.includes('`@betanyc/nyc-record-mcp@1.1.0`'), text);
  assert.ok(text.includes('BetaNYC\'s City Record MCP server'), text);
  const live = CIVIC_MANIFEST.find((entry) => entry.sourceId === 'nyc-record');
  assert.equal(text.includes(String(live?.displayName)), false, 'the sentence reads the pack\'s displayName');
});

test('S2-B W11: a bare retired name is recognised the same way, and names the call as recorded', () => {
  const call = answered('search_notices');
  assert.equal(isAnalysisStep(call), true);
  assert.ok(cellText(renderFetchToolCell(call, CTX)).startsWith('#### Not reproduced: `search_notices`\n\nThe original analysis called `search_notices`, a tool of BetaNYC'));
});

test('S2-B W11: the executed notebook no longer lists the retired call under Discovery, and states it as a step', () => {
  const call = answered('nyc_record__search_notices');
  assert.equal(renderDiscoverySummaryCell([call], 'data.cityofnewyork.us'), null, 'the retired call is still summarised as discovery');
  const { notebook } = synthesizeNotebook({
    query: 'Which notices did the City Record publish about sidewalk repair?',
    defaultPortal: 'data.cityofnewyork.us',
    toolCalls: [call],
    finalAnswer: 'Five notices.',
    modelName: 'vendor/model-fixture-1',
    modelAccess: 'through a fixture',
    generatedAt: '2026-11-10T00:00:00Z',
  });
  const all = notebook.cells.map((c) => [c.source].flat().join('')).join('\n');
  assert.ok(all.includes(r8('nyc_record__search_notices', '@betanyc/nyc-record-mcp@1.1.0')), 'the executed notebook does not state R8\'s words');
  assert.equal(all.includes('### Discovery'), false, 'the executed notebook lists a discovery call');
});

test('S2-B W11: the skeleton notebook states the same call as a numbered step it does not reproduce, through the shared predicate', () => {
  const attribution = { host: null, origin: null, platformTitle: null } as unknown as Parameters<typeof generateNotebook>[4];
  const nb = generateNotebook('Which notices?', 'data.cityofnewyork.us', [answered('nyc_record__search_notices')] as never, 'Five notices.', attribution);
  const steps = nb.cells.map((c) => [c.source].flat().join('')).filter((t) => t.startsWith('## Step '));
  assert.equal(steps.length, 1, 'the skeleton does not state the retired call as a step');
  assert.ok(steps[0].includes('*Not reproduced below.* This step called `nyc_record__search_notices`,'), steps[0]);
});

test('S2-B W11 decoy: a Charter get_section step still renders the hosted branch\'s words, unchanged', () => {
  const text = cellText(renderFetchToolCell({ name: 'nyc_charter__get_section', args: { citation: '§ 259', corpus: 'charter' }, resultSummary: { rows: 1, columns: 1 } }, CTX));
  assert.equal(
    text,
    [
      '#### Not reproduced: `get_section`',
      '',
      'The original analysis read a section of law through `get_section`, a tool of the NYC Charter, Laws and Rules MCP Server, ' +
        'which the instance runs from the pinned package `@betanyc/nyc-charter-laws-rules@0.3.1`. This notebook has no helper that ' +
        'calls that source, so no cell here repeats the request, and nothing here states what it returned.',
      '',
      CLOSING,
    ].join('\n'),
  );
});
