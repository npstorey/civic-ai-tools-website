// Wave N9 P4 (#384), family F3 — the red instrument, stage 1.
//
// Two properties, ruled by the anchor's criterion 7 and by ruling D3 = A:
//
//   (F3-a, #371) The cover text of an executed notebook CARRIES ITS OWN COUNT
//   in every case — "N of M steps re-run a live request" — and never asserts
//   "complete" as a bare adjective. At the base the claim is binary: three of
//   four fetches can fail and the reader is still told the notebook "contains a
//   complete, reproducible analysis of the query above" whose "same numbers can
//   be reproduced against live data by re-running cells top-to-bottom".
//
//   (F3-b, C2) The two notebook generators SAY THE SAME THING ABOUT THE SAME
//   CALL. At the base `renderFetchToolCell` names neither `fetch` nor `search`
//   and both fall to `return null` (tool-to-cell.ts:751), so a `fetch` on a
//   `record:` id — one real data row — is filed by `renderDiscoverySummaryCell`
//   under "discovery calls before fetching data … the data fetches below
//   already encode the discoveries" (tool-to-cell.ts:775-776). Nothing below
//   encodes that row.
//
// ---------------------------------------------------------------------------
// The definition this file fixes, so stage 2 implements exactly this
// ---------------------------------------------------------------------------
//
// A **step** is a tool call the notebook renders as its own step in the
// analysis pipeline: one that either re-runs a live request (a code cell
// carrying `dfN = fetch_*(`, which `isReproducedFetchCell` already recognises)
// or is stated as not re-run (a `#### Not reproduced:` markdown cell). A
// discovery call is NOT a step: `renderDiscoverySummaryCell` collapses every
// one of them into a single "Discovery" cell that already tells the reader they
// are not re-executed, and the notebook never numbers them.
//
// So  N = cells that re-run a live request,
//     M = N + cells that state a step was not re-run,
// and both numbers are derivable FROM THE CELLS — which is what validate.ts's
// own principle (`:155-158`) demands: a count read off the document, never a
// stamped number, so it cannot be satisfied by a claim.
//
// Why not "every tool call in the record": a notebook that ran three catalog
// searches and two successful queries would then read "2 of 5 steps re-run a
// live request", understating itself against its own body — the catalog
// searches were never candidates for re-running, their result IS encoded in the
// dataset ids of the fetches below, and the Discovery cell says so in words.
// That is the same false precision one step to the left that prompt.ts:69-74
// already refuses for the zero case.
//
// The exact cover sentence, in every case where the notebook renders at least
// one step (whitespace-normalised before matching, so stage 2 may hand-wrap it
// across source lines as the surrounding paragraphs are wrapped):
//
//     This notebook re-runs a live request in N of its M analysis steps.
//
// The subject is the notebook, not the numeral, so the verb does not change
// with N and the validator can re-derive one fixed form. When the notebook
// renders no step at all (a discovery-only analysis), there is no ratio to
// state and none is stated — the zero-fetch paragraph #341 added stands, and
// "N of its 0" never appears.
//
// The decision on `search`, stated: **`search` stays a discovery call, `fetch`
// does not.** This repository's own measurement is the reason. For `search`,
// `mcp/operation-types.ts:14-23` records that the server runs it through the
// same catalog handler `get_data` type=catalog uses and answers with dataset
// descriptors, and that any `preview_rows` are "an enrichment of a catalog hit
// rather than rows the analysis queried" — a call that returns dataset
// descriptions is discovery, and rendering it as a not-reproduced DATA step
// would assert it read data, the mirror image of the defect. For `fetch`,
// `:25-41` records that this repository CANNOT KNOW which of two operations
// ran — a `dataset:` id returns metadata, a `record:` id returns one real data
// row — so filing it under "the data fetches below already encode the
// discoveries" asserts something unknowable. Absent is absent: the step is
// stated as not re-run, and nothing is claimed about what it read.
//
// ---------------------------------------------------------------------------
// RED at d81eb76 (measured, not assumed — every line below was probed)
// ---------------------------------------------------------------------------
//
//   - the partial fixture (3 of 4 failed) yields a cover carrying "This
//     notebook contains a complete, reproducible analysis of the query above."
//     and no count at all; `countReproducedFetchCells` = 1 and three
//     `#### Not reproduced:` cells stand under it;
//   - the all-succeeded fixture carries the same sentence and no count;
//   - `validateExecutedNotebook` returns `{ok: true, issues: []}` for both, and
//     for a notebook whose cover states a count the cells contradict;
//   - `renderFetchToolCell` returns `null` for the `fetch` record, and
//     `renderDiscoverySummaryCell` lists it as
//     "- `fetch` — to read the single complaint record the summary cites";
//   - the skeleton generator emits NO cell for that same record.
//
// One premise of the contract did not survive the check, and it changes what
// stage 2 must touch. The anchor and the phase contract both say the skeleton
// generator "handles the same call honestly (`notebook.ts:206-211`)". That is
// true of `planQueryStep` READ IN ISOLATION and false of the generator:
// `generateNotebook` filters its steps to `t.operationType === 'query'`
// (`notebook.ts:327`), and `fetch` deliberately derives to no operation type
// (`mcp/operation-types.ts:25-41`), so `planQueryStep` is never called for a
// `fetch` and the call is dropped from the skeleton with no step, no note and
// no mention. Measured both ways: forcing `operationType: 'query'` onto the
// same record makes the skeleton emit exactly the honest note. So the two
// generators do disagree about a `fetch`, but the skeleton's half of the
// disagreement is silence, not honesty, and `notebook.ts:142-146` already
// states why silence is the wrong answer — "Dropping it would make the document
// claim the analysis rested on fewer sources than it did".
//
// Universe: the executed-notebook generator (`synthesize.ts` over `prompt.ts`,
// `tool-to-cell.ts`, `validate.ts`) and the skeleton generator
// (`../notebook.ts`). Not covered here: the discovery cell's own second
// sentence, which claims "the data fetches below already encode the
// discoveries" even when there are no fetches below — a live defect this file
// deliberately does not drive, reported as a flag instead.
//
// Every value below is a placeholder; no credential, no network, no MCP server.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types \
//         src/lib/notebook-author/notebook-count-and-agreement.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Notebook } from './cells.ts';
import { synthesizeNotebook } from './synthesize.ts';
import { stampExecutedNotebook } from './phase-d.ts';
import { validateExecutedNotebook } from './validate.ts';
import {
  countReproducedFetchCells,
  renderDiscoverySummaryCell,
  renderFetchToolCell,
  type PhaseAToolCall,
} from './tool-to-cell.ts';
import { generateNotebook } from '../notebook.ts';
import type { ToolCall } from '../../hooks/useStreamingComparison.ts';
import { modelAccessPhrase } from '../model-catalog.ts';

const CTX = { dataFrameIndex: 1, defaultPortal: 'data.cityofnewyork.us' };

/** The one sentence the cover must carry whenever the notebook renders a step. */
function countSentence(reRun: number, steps: number): string {
  return `This notebook re-runs a live request in ${reRun} of its ${steps} analysis steps.`;
}

/** The claim ruling D3 = A removes from every cover text. */
const BARE_CLAIM = 'complete, reproducible analysis';

/**
 * The phrase both generators must use for a step that is not re-run. Both
 * already own a copy — `#### Not reproduced:` in `tool-to-cell.ts:400`/`:699`,
 * `*Not reproduced below.*` in `notebook.ts:153` — so this is the word the two
 * documents already share, not a new vocabulary invented for the test.
 */
const SHARED_NOT_REPRODUCED = 'Not reproduced';

const BASE_INPUTS = {
  query: 'Top 5 complaint types in Brooklyn over the past 30 days',
  defaultPortal: 'data.cityofnewyork.us',
  modelName: 'anthropic/claude-sonnet-4-6',
  modelAccess: modelAccessPhrase('openai-compatible'),
  generatedAt: '2026-05-21T14:00:00.000Z',
  finalAnswer: 'Noise complaints led with 4,812 reports.',
};

/** One fetching Socrata query, succeeded or rejected. */
function fetchingCall(n: number, failed: boolean): PhaseAToolCall {
  return {
    name: 'get_data',
    operationType: 'query',
    args: {
      type: 'query',
      portal: 'data.cityofnewyork.us',
      dataset_id: `ds${n}s-000${n}`,
      select: 'complaint_type, count(*) as count',
      group: 'complaint_type',
      limit: 5,
    },
    reason: `to aggregate table ${n} by complaint_type`,
    ...(failed
      ? { failed: true, failureKind: 'timeout' as const }
      : { resultSummary: { rows: 5, columns: 2 } }),
  };
}

/** THE fixture #371 asks for: four fetching calls, three of them rejected. */
const PARTIAL_FAILURE = [
  fetchingCall(1, false),
  fetchingCall(2, true),
  fetchingCall(3, true),
  fetchingCall(4, true),
];

/** The same four, none rejected — the positive control for the same sentence. */
const ALL_SUCCEEDED = [
  fetchingCall(1, false),
  fetchingCall(2, false),
  fetchingCall(3, false),
  fetchingCall(4, false),
];

/**
 * A `fetch` on a `record:` identifier: the server's `handleFetchTool` branches
 * on the id's shape and this one returned a single real data row. Nothing in
 * this repository can re-run it, and nothing in this repository may say which
 * branch ran (`mcp/operation-types.ts:25-41`).
 */
const FETCH_RECORD: PhaseAToolCall = {
  name: 'fetch',
  args: { id: 'record:data.cityofnewyork.us:erm2-nwe9:row-8814' },
  resultSummary: { rows: 1, columns: 41 },
  reason: 'to read the single complaint record the summary cites',
};

/** A `search`: dataset descriptions, not analysis rows. Stays discovery. */
const SEARCH_CALL: PhaseAToolCall = {
  name: 'search',
  operationType: 'search',
  args: { query: 'noise complaints' },
  resultSummary: { rows: 12, columns: 5 },
  reason: 'to find datasets about noise complaints',
};

/** A catalog search that succeeded — a discovery call, and never a step. */
const CATALOG_CALL: PhaseAToolCall = {
  name: 'get_data',
  operationType: 'catalog',
  args: { type: 'catalog', portal: 'data.cityofnewyork.us', query: 'noise complaints' },
  resultSummary: { rows: 40, columns: 4 },
};

function coverText(notebook: Notebook): string {
  return notebook.cells[0].source.join('');
}

/** Match the sentence however stage 2 chooses to wrap it across source lines. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function stamped(calls: readonly PhaseAToolCall[]): Notebook {
  const synth = synthesizeNotebook({ ...BASE_INPUTS, toolCalls: calls });
  stampExecutedNotebook(
    synth.notebook,
    { executedAt: '2026-05-21T14:23:45.000Z', executionDuration_ms: 12340 },
    synth.dataFrameVariables,
  );
  return synth.notebook;
}

/** Replace the cover cell's text, leaving every other cell untouched. */
function withCoverText(notebook: Notebook, cover: string): Notebook {
  notebook.cells[0].source = [cover];
  return notebook;
}

// ---------------------------------------------------------------------------
// (1) The cover text, partial — the case #371 was filed for
// ---------------------------------------------------------------------------

test('#371: a notebook where three of four fetches were rejected states 1 of 4, and never "complete"', () => {
  // RED at d81eb76: prompt.ts:96 branches on `reproducedFetchCount === 0`, so
  // ANY surviving fetch takes the ":115" branch and this reader is told the
  // analysis is complete and that re-running the cells reproduces the same
  // numbers. Three quarters of it did not run.
  const notebook = synthesizeNotebook({ ...BASE_INPUTS, toolCalls: PARTIAL_FAILURE }).notebook;
  const cover = coverText(notebook);

  // The fixture must really be partial, or this test proves nothing.
  assert.equal(countReproducedFetchCells(notebook.cells), 1, 'fixture: exactly one fetch survived');
  assert.equal(
    notebook.cells.filter(c => c.source.join('').includes('#### Not reproduced:')).length,
    3,
    'fixture: exactly three steps are stated as not re-run',
  );

  assert.ok(
    flat(cover).includes(countSentence(1, 4)),
    `cover text carries no count of its own:\n${cover}`,
  );
  assert.ok(!cover.includes(BARE_CLAIM), `cover still claims a ${BARE_CLAIM}:\n${cover}`);
  assert.doesNotMatch(cover, /\bcomplete\b/i, '"complete" is never a bare adjective about the analysis');
  // #371's second false claim: true only of the numbers behind the one fetch
  // that worked. The rest come from the synthesis cell's fallback to the
  // original answer text, with no computation behind them.
  assert.doesNotMatch(
    cover,
    /the same numbers can be reproduced/,
    'three of four steps did not run; their numbers are not reproduced by re-running cells',
  );
});

test('#371 + C2: a `fetch` step counts in the denominator it cannot satisfy', () => {
  // The junction of the two halves. One successful query and one `fetch` on a
  // `record:` id: two steps, one of which re-runs a live request.
  // RED at d81eb76 twice over — the `fetch` is not a step at all (it is swept
  // into the Discovery cell) and the cover says "complete".
  const notebook = synthesizeNotebook({
    ...BASE_INPUTS,
    toolCalls: [fetchingCall(1, false), FETCH_RECORD],
  }).notebook;
  const cover = coverText(notebook);

  assert.ok(
    flat(cover).includes(countSentence(1, 2)),
    `cover text does not count the \`fetch\` as a step it cannot re-run:\n${cover}`,
  );
  assert.doesNotMatch(cover, /\bcomplete\b/i);
});

// ---------------------------------------------------------------------------
// (2) The cover text, all succeeded — the positive control
// ---------------------------------------------------------------------------

test('#371: a notebook where every fetch succeeded states 4 of 4, and still never "complete"', () => {
  // The control that catches a fix which simply deletes the claim, or one that
  // states a count only when something failed. RED at d81eb76: the binary
  // branch prints the "complete, reproducible analysis" sentence and no count.
  const cover = coverText(synthesizeNotebook({ ...BASE_INPUTS, toolCalls: ALL_SUCCEEDED }).notebook);

  assert.ok(
    flat(cover).includes(countSentence(4, 4)),
    `cover text carries no count of its own:\n${cover}`,
  );
  assert.ok(!cover.includes(BARE_CLAIM));
  assert.doesNotMatch(cover, /\bcomplete\b/i);
});

test('#371: a discovery-only notebook renders no step, so it states no ratio', () => {
  // "0 of its 0 analysis steps" is not a count, it is a division by nothing.
  // The zero-fetch paragraph #341 added is what this reader gets, and this
  // assertion exists so the count sentence is never emitted with an empty
  // denominator. GREEN at d81eb76 by construction — a guard on stage 2, not
  // evidence about the base.
  const cover = coverText(
    synthesizeNotebook({ ...BASE_INPUTS, toolCalls: [CATALOG_CALL] }).notebook,
  );
  assert.ok(!flat(cover).includes('of its 0'), `empty denominator in the cover text:\n${cover}`);
  assert.match(cover, /reproduces no data fetch/, '#341\'s zero-fetch paragraph still stands');
});

// ---------------------------------------------------------------------------
// (3) The validator — derived from the cells, so a claim cannot satisfy it
// ---------------------------------------------------------------------------

test('#371: the validator reports a cover count the cells contradict, naming both numbers', () => {
  // RED at d81eb76: `validateReproducedFetches` reports only at `=== 0`
  // (validate.ts:161), so a cover text that overstates its own reproduction by
  // any margin short of everything validates `ok: true`.
  const notebook = withCoverText(
    stamped(PARTIAL_FAILURE),
    ['# Data Analysis', '', '## How to use this notebook', '', countSentence(3, 4)].join('\n'),
  );

  const result = validateExecutedNotebook(notebook);
  assert.equal(result.ok, false, 'a cover text the cells contradict must not validate clean');

  const messages = result.issues.map(i => i.message).join(' | ');
  assert.match(messages, /3 of 4/, 'the issue must name what the cover text claims');
  assert.match(messages, /1 of 4/, 'and what the cells actually show');
  assert.match(messages, /cover/i, 'and say which of the two is the claim');
  assert.ok(
    result.issues.some(i => i.path.includes('cells')),
    `the issue must point at the cells, not at a metadata path: ${JSON.stringify(result.issues)}`,
  );
});

test('#371: the validator reports a cover that claims completeness over a step that did not run', () => {
  // The base's own output, handed back to the validator: this is the exact
  // cover text d81eb76 produces for the partial fixture. A validator that only
  // compared numerals would pass a cover carrying a correct count AND the
  // forbidden claim, so the claim is checked in its own right.
  // RED at d81eb76: `{ok: true, issues: []}`.
  const notebook = withCoverText(
    stamped(PARTIAL_FAILURE),
    [
      '# Data Analysis',
      '',
      '## How to use this notebook',
      '',
      'This notebook contains a complete, reproducible analysis of the query above.',
      'Every code cell that fetches data uses the helper functions defined below,',
      'so the same numbers can be reproduced against live data by re-running cells',
      'top-to-bottom. The final "Synthesis" cell explains what the data shows.',
    ].join('\n'),
  );

  const result = validateExecutedNotebook(notebook);
  assert.equal(result.ok, false, 'the document the base emits must not validate clean');
  const messages = result.issues.map(i => i.message).join(' | ');
  assert.match(
    messages,
    /complete, reproducible/,
    'the issue must quote the claim it is refusing, not only report a missing count',
  );
});

test('#371: a notebook whose cover count matches its cells validates clean', () => {
  // The control. A partial notebook is not an invalid notebook — it is a
  // notebook that has to say so. A validator written broadly enough to fail
  // every partially-failed run would block the publish path for a document
  // that is telling the truth. GREEN at d81eb76 and it must stay green.
  const result = validateExecutedNotebook(stamped(PARTIAL_FAILURE));
  assert.deepEqual(result.issues, [], `unexpected issues: ${JSON.stringify(result.issues)}`);
  assert.ok(result.ok);
});

// ---------------------------------------------------------------------------
// (4) C2 — the executed notebook, on a `fetch` and on a `search`
// ---------------------------------------------------------------------------

test('C2: a `fetch` on a `record:` id is a stated not-reproduced step, never a discovery call', () => {
  // RED at d81eb76: `renderFetchToolCell` names neither `fetch` nor `search`
  // and both fall to `return null` (tool-to-cell.ts:751), so this call — one
  // real data row — is filed under "discovery calls before fetching data …
  // the data fetches below already encode the discoveries". Nothing below
  // encodes it.
  const out = renderFetchToolCell(FETCH_RECORD, CTX);
  assert.ok(out, 'null sweeps it into the discovery summary — the defect itself');

  assert.equal(out!.cells.filter(c => c.cell_type === 'code').length, 0, 'nothing here can be re-run');
  assert.equal(out!.producedDataFrame, false);
  assert.equal(
    out!.citation,
    null,
    'the `record:` id is not parsed for a dataset to cite: that grammar lives in the MCP server',
  );

  const md = out!.cells[0].source.join('');
  assert.ok(md.includes(SHARED_NOT_REPRODUCED), `the step must be stated as not re-run:\n${md}`);
  assert.match(md, /`fetch`/, 'and named by the tool the loop recorded');
  assert.doesNotMatch(md, /already encode/, 'nothing below encodes this row');
  assert.doesNotMatch(md, /discovery/i, 'a call that may have returned a data row is not a discovery call');
  assert.doesNotMatch(md, /erm2-nwe9/, 'the id is not decomposed into a dataset this notebook cannot verify');
});

test('C2: the discovery summary no longer lists the `fetch`, and lists nothing when that was all there was', () => {
  // RED at d81eb76: "- `fetch` — to read the single complaint record the
  // summary cites" appears under the discovery heading.
  const cell = renderDiscoverySummaryCell([FETCH_RECORD, SEARCH_CALL, CATALOG_CALL]);
  assert.ok(cell, 'the search and the catalog call are still discovery, so a cell is still emitted');
  const text = cell!.source.join('');
  assert.ok(!text.includes('- `fetch`'), `the fetch is still listed as discovery:\n${text}`);
  assert.ok(text.includes('- `search`'), 'the search is still summarised here');

  assert.equal(
    renderDiscoverySummaryCell([FETCH_RECORD]),
    null,
    'with only a fetch, there is no discovery to summarise and no cell to emit',
  );
});

test('C2: a `search` stays a discovery call — the decision, pinned against over-reach', () => {
  // GREEN at d81eb76 by construction, and stated as such: this is a guard on
  // stage 2, not evidence about the base. `mcp/operation-types.ts:14-23`
  // records that the server runs `search` through the same catalog handler
  // `get_data` type=catalog uses and answers with dataset descriptors, and that
  // any preview rows are an enrichment of a catalog hit "rather than rows the
  // analysis queried". Rendering it as a not-reproduced DATA step would assert
  // it read data — the mirror image of the defect C2 is about.
  assert.equal(renderFetchToolCell(SEARCH_CALL, CTX), null);
  const cell = renderDiscoverySummaryCell([SEARCH_CALL]);
  assert.ok(cell);
  assert.ok(cell!.source.join('').includes('- `search`'));
});

// ---------------------------------------------------------------------------
// (5) The two generators agree about the same record
// ---------------------------------------------------------------------------

test('criterion 7: both notebook generators state the same `fetch` as a step that is not re-run', () => {
  // RED at d81eb76 on the SKELETON side, and not for the reason the contract
  // gives. `planQueryStep` (notebook.ts:206-211) does return `not-reproduced`
  // for this record — but `generateNotebook` filters its steps to
  // `operationType === 'query'` (notebook.ts:327) and `fetch` deliberately
  // derives to no operation type, so `planQueryStep` is never reached and the
  // skeleton emits no cell for the call at all. Silence is not agreement:
  // notebook.ts:142-146 already says why a dropped step makes the document
  // "claim the analysis rested on fewer sources than it did".
  // The skeleton half is asserted FIRST, deliberately: at d81eb76 the executed
  // half is already red in the C2 test above, and a test that stopped there
  // would never show the silence this one exists to name.
  const skeletonCall: ToolCall = {
    name: FETCH_RECORD.name,
    args: FETCH_RECORD.args,
    resultSummary: FETCH_RECORD.resultSummary,
    reason: FETCH_RECORD.reason,
  };
  const skeleton = generateNotebook(
    BASE_INPUTS.query,
    'data.cityofnewyork.us',
    [skeletonCall],
    BASE_INPUTS.finalAnswer,
    { origin: null, host: null, platformTitle: null },
  );
  const skeletonText = skeleton.cells.map(c => c.source.join('')).join('\n');

  assert.ok(
    skeletonText.includes(SHARED_NOT_REPRODUCED),
    `the skeleton says nothing at all about this call:\n${skeletonText}`,
  );
  assert.match(skeletonText, /`fetch`/, 'and it names the tool the record carried');

  const executed = renderFetchToolCell(FETCH_RECORD, CTX);
  assert.ok(executed, 'executed side: see the C2 test above');
  const executedText = executed!.cells.map(c => c.source.join('')).join('\n');
  assert.ok(
    executedText.includes(SHARED_NOT_REPRODUCED),
    `the executed notebook says nothing about this call either:\n${executedText}`,
  );

  // Neither document may invent a source for it. The `record:` id contains a
  // dataset-shaped substring; decomposing it means reimplementing the MCP
  // server's identifier grammar in this repository, where it would drift.
  assert.doesNotMatch(skeletonText, /resource\/erm2-nwe9/, 'no URL is written for a call that named no portal');
  assert.ok(
    !skeleton.cells[skeleton.cells.length - 1].source.join('').includes('erm2-nwe9'),
    'and nothing is cited in "Data sources" that no cell fetched',
  );
});
