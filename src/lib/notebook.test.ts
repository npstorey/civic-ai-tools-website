// The skeleton notebook: what a step's URL is allowed to claim.
//
// WHAT THIS FILE GUARDS. `generateNotebook` builds the notebook that
// `PublishEvidenceDialog` puts into a SIGNED record package when the session
// did not execute in the sandbox (`executedNotebook ?? generateNotebook(...)`),
// and that the response panel offers as a download. Its code cells are the
// reader's way to re-run the analysis, so a URL in one of them is a claim
// about what the analysis read.
//
// Two properties, both measured here by rendering rather than by reading:
//
//   1. No URL is emitted for a call this builder cannot address. The step
//      filter is `operationType === 'query'`, which admits Data Commons' and
//      CKAN's query tools as well as Socrata's — none of which carry a portal
//      or a dataset id. The builder used to interpolate them anyway and emit
//      `https://undefined/resource/undefined.json` under a row count from a
//      different query.
//
//   2. A rendered URL carries every argument that affects its result and none
//      that does not. `query` and `offset` are advertised on `get_data` and
//      were silently dropped, so the cell returned the dataset's unfiltered
//      default page under the original run's row count. That is worse than the
//      #340 it mirrors: #340 raised a `TypeError` and told the reader live data
//      could not be fetched; this ran clean and was confidently wrong.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/notebook.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateNotebook } from './notebook.ts';
import { SOQL_QUERY_SNIFF } from './notebook-author/tool-to-cell.ts';

const NO_ATTRIBUTION = { origin: null, host: null, platformTitle: null };
const PORTAL = 'data.cityofnewyork.us';

type ToolCallFixture = {
  name: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  operationType?: string;
  reason?: string;
};

/** Every source line of every cell, as one string — what a reader downloads. */
function render(tools: ToolCallFixture[], response = 'An analysis.'): string {
  const nb = generateNotebook('How many complaints?', PORTAL, tools, response, NO_ATTRIBUTION);
  return nb.cells.map(c => c.source.join('')).join('\n');
}

/** Just the code cells — where a URL would live. */
function renderCode(tools: ToolCallFixture[]): string {
  const nb = generateNotebook('How many complaints?', PORTAL, tools, '', NO_ATTRIBUTION);
  return nb.cells.filter(c => c.cell_type === 'code').map(c => c.source.join('')).join('\n');
}

const socrataQuery = (args: Record<string, unknown>, extra: Partial<ToolCallFixture> = {}): ToolCallFixture => ({
  name: 'get_data',
  operationType: 'query',
  args: { type: 'query', portal: PORTAL, dataset_id: 'erm2-nwe9', ...args },
  ...extra,
});

// --- Property 1: no URL this builder cannot honestly address ----------------

test('a Data Commons observation step renders no fabricated Socrata URL', () => {
  const out = render([
    {
      name: 'get_observations',
      operationType: 'query',
      args: { variable_dcid: 'Median_Income_Person', place_dcid: 'geoId/36061' },
      resultSummary: { rows: 47, columns: 3 },
      reason: 'Median income',
    },
  ]);
  assert.ok(!out.includes('undefined'), 'no cell may contain the word undefined');
  assert.ok(!/https:\/\/[^"\s]*\/resource\//.test(out), 'no Socrata resource URL for a non-Socrata call');
});

test('a CKAN query step renders no fabricated Socrata URL', () => {
  for (const name of ['ckan__query_data', 'ckan__execute_sql', 'ckan__aggregate_data']) {
    const out = render([
      {
        name,
        operationType: 'query',
        args: { resource_id: 'abc-123', sql: 'SELECT 1' },
        resultSummary: { rows: 12, columns: 2 },
      },
    ]);
    assert.ok(!out.includes('undefined'), `${name}: no cell may contain the word undefined`);
    assert.ok(!/https:\/\/[^"\s]*\/resource\//.test(out), `${name}: no Socrata resource URL`);
  }
});

test('a query call missing its portal or dataset id renders no URL', () => {
  for (const args of [
    { type: 'query', dataset_id: 'erm2-nwe9' },
    { type: 'query', portal: PORTAL },
    { type: 'query' },
  ]) {
    const out = render([{ name: 'get_data', operationType: 'query', args }]);
    assert.ok(!out.includes('undefined'), `no undefined for ${JSON.stringify(args)}`);
    assert.ok(!out.includes('url = "'), `no URL assignment for ${JSON.stringify(args)}`);
  }
});

test('a step with no URL is still a step, and still says what it read', () => {
  // Dropping it would make the notebook claim the analysis rested on fewer
  // sources than it did, which is the same false-precision failure pointing
  // the other way (docs/design-principles.md Principle 3, Principle 2).
  const out = render([
    {
      name: 'get_observations',
      operationType: 'query',
      args: { variable_dcid: 'Median_Income_Person', place_dcid: 'geoId/36061' },
      resultSummary: { rows: 47, columns: 3 },
      reason: 'Median income',
    },
    socrataQuery({}, { reason: 'Complaint counts' }),
  ]);
  assert.match(out, /Step 1: Median income/);
  assert.match(out, /Step 2: Complaint counts/);
  assert.match(out, /47 rows, 3 columns/, 'the original row count stays with its own step');
  assert.match(out, /get_observations/, 'the step names the operation it could not reproduce');
});

test('a step with no URL contributes no data-source link', () => {
  const out = render([
    {
      name: 'ckan__query_data',
      operationType: 'query',
      args: { resource_id: 'abc-123' },
    },
  ]);
  assert.ok(!/\]\(https:\/\//.test(out), 'nothing may be linked as a source this notebook did not address');
});

// --- Property 2: every argument that affects the result --------------------

test('an offset argument reaches the URL', () => {
  const code = renderCode([socrataQuery({ limit: 50, offset: 100 })]);
  assert.match(code, /\$offset=100/, 'a page the analysis read must be the page the cell reads');
  assert.match(code, /\$limit=50/);
});

test('a search-phrase query argument reaches the URL as a full-text search', () => {
  const code = renderCode([socrataQuery({ query: 'noise', where: "borough='QUEENS'" })]);
  assert.ok(!SOQL_QUERY_SNIFF.test('noise'), 'the fixture is a phrase, not a statement');
  assert.match(code, /\$q=noise/);
  assert.match(code, /\$where=/, 'a phrase query does not supersede the clauses');
});

test('a full SoQL query argument becomes the whole query and supersedes the clauses', () => {
  // The precedence the data source applies, and that P5 established for the
  // executed-notebook renderer: a `query` matching SOQL_QUERY_SNIFF is sent as
  // `$query` alone, and `$limit`/`$offset` are not sent alongside it.
  const soql = 'SELECT complaint_type, count(*) GROUP BY complaint_type LIMIT 5';
  assert.ok(SOQL_QUERY_SNIFF.test(soql), 'the fixture is a statement, not a phrase');
  const code = renderCode([
    socrataQuery({ query: soql, where: "borough='QUEENS'", limit: 10, offset: 20, select: 'complaint_type' }),
  ]);
  assert.match(code, /\$query=/);
  assert.ok(!code.includes('$where='), 'a superseded clause is not written as an argument with no effect');
  assert.ok(!code.includes('$select='), 'a superseded clause is not written as an argument with no effect');
  assert.ok(!code.includes('$limit='), 'no $limit is sent with a $query');
  assert.ok(!code.includes('$offset='), 'no $offset is sent with a $query');
  assert.ok(!code.includes('$q='), 'a statement is not also sent as a search phrase');
});

test('the superseded clauses are disclosed, not silently dropped', () => {
  const code = renderCode([
    socrataQuery({ query: 'SELECT complaint_type LIMIT 5', where: "borough='QUEENS'", limit: 10 }),
  ]);
  assert.match(code, /Superseded on this call[^\n]*where/);
  assert.match(code, /Superseded on this call[^\n]*limit/);
});

test('an argument this URL has no parameter for is disclosed, not silently dropped', () => {
  const code = renderCode([socrataQuery({ some_future_arg: 'x' })]);
  assert.match(code, /some_future_arg/, 'an unrecognised argument is named in the cell');
  assert.ok(!code.includes('$some_future_arg='), 'and is not invented as a query parameter');
});

test('a clause whose value this URL cannot express is disclosed, not stringified into it', () => {
  // Every advertised clause is typed string or number. Anything else would
  // render as `$where=%5Bobject%20Object%5D` — a parameter with no effect on
  // the rows, which is what the URL may not contain.
  const code = renderCode([socrataQuery({ where: { column: 'borough' } })]);
  assert.ok(!code.includes('$where='), 'no parameter is written from a value it cannot express');
  assert.ok(!code.includes('object Object'), 'and nothing is stringified into the URL');
  assert.match(code, /also passed where/, 'the argument is named in the cell instead');
});

test('the six advertised clauses still reach the URL', () => {
  const code = renderCode([
    socrataQuery({
      select: 'complaint_type, COUNT(*) as count',
      where: "created_date > '2024-01-01'",
      group: 'complaint_type',
      order: 'count DESC',
      limit: 10,
      offset: 5,
    }),
  ]);
  for (const p of ['$select=', '$where=', '$group=', '$order=', '$limit=10', '$offset=5']) {
    assert.ok(code.includes(p), `${p} must be in the URL`);
  }
});

test('a limit of zero is a limit, not an absent argument', () => {
  const code = renderCode([socrataQuery({ limit: 0 })]);
  assert.match(code, /\$limit=0/);
});

test('the routing argument `type` is not invented as a query parameter', () => {
  const code = renderCode([socrataQuery({})]);
  assert.ok(!code.includes('$type='), '`type` selects the operation; it is not a Socrata parameter');
  assert.ok(!code.includes('type'), 'and it is not disclosed as a dropped argument either');
});

// --- What did not change ----------------------------------------------------

test('a reproducible Socrata step still renders the fetch it always did', () => {
  const nb = generateNotebook(
    'How many complaints?',
    PORTAL,
    [socrataQuery({ limit: 5 }, { resultSummary: { rows: 5, columns: 3 }, reason: 'Sample rows' })],
    'An analysis.',
    NO_ATTRIBUTION,
  );
  const all = nb.cells.map(c => c.source.join('')).join('\n');
  assert.match(all, /url = "https:\/\/data\.cityofnewyork\.us\/resource\/erm2-nwe9\.json\?\$limit=5"/);
  assert.match(all, /response = requests\.get\(url\)/);
  assert.match(all, /df = pd\.DataFrame\(data\)/);
  assert.match(all, /Original query returned 5 rows, 3 columns\./);
  assert.match(all, /\[erm2-nwe9\]\(https:\/\/data\.cityofnewyork\.us\/d\/erm2-nwe9\)/);
});

test('non-query tool calls are still excluded from the step list', () => {
  const out = render([
    { name: 'get_data', operationType: 'catalog', args: { type: 'catalog', portal: PORTAL, query: '311' } },
    { name: 'search', operationType: 'search', args: { query: '311' } },
  ]);
  assert.ok(!out.includes('Step 1'), 'discovery calls are not analysis steps');
});
