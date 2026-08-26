// Renderer syntax + kwargs-collision tests (Wave N6 P5, #320).
//
// pyKwargs appends every arg a renderer did not enumerate by hand. The Data
// Commons renderer hand-writes variable_dcid and place_dcid, then also
// passes call.args through pyKwargs — so both landed twice and every
// generated Data Commons cell was a Python SyntaxError: keyword argument
// repeated. This is the first test file for tool-to-cell.ts. It:
//
//   - parses every generated code cell as Python via a real python3
//     subprocess, across every cell-producing renderer in the file — not
//     just the Data Commons one, so a repeat-kwargs regression anywhere
//     here trips it;
//   - pins that a Data Commons call carrying date/child_place_type renders
//     each kwarg exactly once;
//   - pins the Socrata renderer's output as byte-for-byte unchanged.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { NotebookCell } from './cells.ts';
import {
  renderDiscoverySummaryCell,
  renderFetchToolCell,
  TOOL_FAILURE_KINDS,
  type PhaseAToolCall,
} from './tool-to-cell.ts';

const CTX = { dataFrameIndex: 1, defaultPortal: 'data.cityofnewyork.us' };

/**
 * Parse a Jupyter code cell's source as Python via a real `python3`
 * subprocess — the same syntax check `nbconvert`/the sandbox execution
 * path would trip over first.
 *
 * Uses `compile()`, not bare `ast.parse()`: measured locally, `ast.parse()`
 * accepts a repeated keyword argument (e.g. `f(x=1, x=2)`) without error —
 * that check runs during compilation, not grammar parsing — so it would
 * pass on the pre-fix #320 renderer output and never demonstrate the
 * failure this test exists to catch. `compile(..., 'exec')` is a superset
 * of `ast.parse()`'s syntax checking and also raises
 * `SyntaxError: keyword argument repeated` for that case.
 */
function assertParsesAsPython(cell: NotebookCell, label: string): void {
  assert.equal(cell.cell_type, 'code', `${label}: expected a code cell`);
  const source = cell.source.join('');
  const result = spawnSync(
    'python3',
    ['-c', "import sys; compile(sys.stdin.read(), '<cell>', 'exec')"],
    { input: source, encoding: 'utf-8' },
  );
  assert.equal(
    result.status,
    0,
    `${label}: generated cell is not valid Python (exit ${result.status})\n` +
      `--- source ---\n${source}\n--- stderr ---\n${result.stderr}`,
  );
}

/**
 * Python source that reports every `fetch_*(...)` call in a cell together with
 * how many `try` BODIES enclose it, as JSON `[[name, depth], …]`.
 *
 * A structural AST walk, not a string match on `"try:"` (website#325 P3,
 * #321). A cell containing the characters `try:` anywhere — in a comment, in a
 * SQL string literal, in a `try` around some other statement — would satisfy a
 * text search while leaving the fetch itself unguarded, so the check would
 * pass on exactly the code it exists to reject. Enclosure is a fact about the
 * tree; only the tree can be asked.
 *
 * `visit_Try` walks `node.body` at depth+1 and the handler/else/finally
 * branches at the SAME depth: a fetch inside an `except` block is not
 * protected by the `try` it belongs to, and counting it as protected would
 * re-open the same hole one level down.
 */
const FETCH_DEPTH_PROBE = [
  'import ast, json, sys',
  'tree = ast.parse(sys.stdin.read())',
  'found = []',
  'class V(ast.NodeVisitor):',
  '    def __init__(self):',
  '        self.depth = 0',
  '    def visit_Try(self, node):',
  '        self.depth += 1',
  '        for s in node.body: self.visit(s)',
  '        self.depth -= 1',
  '        for h in node.handlers: self.visit(h)',
  '        for s in node.orelse: self.visit(s)',
  '        for s in node.finalbody: self.visit(s)',
  '    def visit_Call(self, node):',
  '        f = node.func',
  "        if isinstance(f, ast.Name) and f.id.startswith('fetch_'):",
  '            found.append([f.id, self.depth])',
  '        self.generic_visit(node)',
  'V().visit(tree)',
  'print(json.dumps(found))',
].join('\n');

/**
 * Assert that every `fetch_*` call in a code cell sits inside a `try` body
 * (#321, part 3).
 *
 * Civic data is live: a fetch that worked when the analysis ran can fail at
 * re-execution time for reasons unrelated to this notebook. Unguarded, the
 * first such failure raises and every later cell — the analysis, the synthesis,
 * the comparison — never runs. Also asserts at least one fetch was FOUND, so a
 * renderer that stopped emitting one can't pass this vacuously.
 */
function assertFetchIsGuarded(cell: NotebookCell, label: string): void {
  assert.equal(cell.cell_type, 'code', `${label}: expected a code cell`);
  const source = cell.source.join('');
  const result = spawnSync('python3', ['-c', FETCH_DEPTH_PROBE], { input: source, encoding: 'utf-8' });
  assert.equal(result.status, 0, `${label}: AST probe failed\n${result.stderr}`);
  const found = JSON.parse(result.stdout) as [string, number][];
  assert.ok(
    found.length > 0,
    `${label}: no fetch_* call found in the cell at all — the probe would pass vacuously:\n${source}`,
  );
  for (const [name, depth] of found) {
    assert.ok(
      depth >= 1,
      `${label}: ${name}() is not inside a try body (depth ${depth}). One dead endpoint ` +
        `would abort every later cell:\n--- source ---\n${source}`,
    );
  }
}

function codeCells(call: PhaseAToolCall): NotebookCell[] {
  const out = renderFetchToolCell(call, CTX);
  assert.ok(out, `renderFetchToolCell returned null for ${call.name}`);
  return out!.cells.filter(c => c.cell_type === 'code');
}

// --- Socrata query -----------------------------------------------------

const SOCRATA_CALL: PhaseAToolCall = {
  name: 'get_data',
  operationType: 'query',
  args: {
    type: 'query',
    portal: 'data.cityofnewyork.us',
    dataset_id: 'erm2-nwe9',
    select: 'complaint_type, count(*) as count',
    where: 'complaint_type IS NOT NULL',
    group: 'complaint_type',
    order: 'count DESC',
    limit: 5,
  },
  reason: 'to aggregate by complaint_type',
  resultSummary: { rows: 5, columns: 2 },
};

// --- Data Commons observations ------------------------------------------

const DC_CALL_MINIMAL: PhaseAToolCall = {
  name: 'get_observations',
  args: {
    variable_dcid: 'Count_Person',
    place_dcid: 'geoId/06',
  },
  resultSummary: { rows: 12, columns: 2 },
};

const DC_CALL_WITH_OPTIONALS: PhaseAToolCall = {
  name: 'get_observations',
  args: {
    variable_dcid: 'Count_Person',
    place_dcid: 'geoId/06',
    date: '2020',
    child_place_type: 'County',
  },
  resultSummary: { rows: 58, columns: 2 },
};

// --- Boston OpenContext ---------------------------------------------------

const OPENCONTEXT_SQL_CALL: PhaseAToolCall = {
  name: 'ckan__execute_sql',
  args: { sql: 'SELECT * FROM "abc123" LIMIT 10' },
};

const OPENCONTEXT_QUERY_CALL: PhaseAToolCall = {
  name: 'ckan__query_data',
  args: { resource_id: 'abc123', filters: { status: 'open' }, limit: 25 },
  resultSummary: { rows: 25, columns: 4 },
};

const ALL_FIXTURES: Array<[string, PhaseAToolCall]> = [
  ['socrata get_data (query)', SOCRATA_CALL],
  ['data commons get_observations (minimal)', DC_CALL_MINIMAL],
  ['data commons get_observations (date + child_place_type)', DC_CALL_WITH_OPTIONALS],
  ['opencontext ckan__execute_sql', OPENCONTEXT_SQL_CALL],
  ['opencontext ckan__query_data', OPENCONTEXT_QUERY_CALL],
];

test('every renderer emits code cells that parse as Python', () => {
  for (const [label, call] of ALL_FIXTURES) {
    for (const cell of codeCells(call)) {
      assertParsesAsPython(cell, label);
    }
  }
});

test('data commons: date and child_place_type each render exactly once when present', () => {
  const [cell] = codeCells(DC_CALL_WITH_OPTIONALS);
  assertParsesAsPython(cell, 'data commons (date + child_place_type)');
  const source = cell.source.join('');
  for (const key of ['variable_dcid', 'place_dcid', 'date', 'child_place_type']) {
    const occurrences = source.split(`${key}=`).length - 1;
    assert.equal(occurrences, 1, `${key}= should appear exactly once in:\n${source}`);
  }
});

test('data commons: variable_dcid and place_dcid render exactly once even without date/child_place_type', () => {
  const [cell] = codeCells(DC_CALL_MINIMAL);
  const source = cell.source.join('');
  for (const key of ['variable_dcid', 'place_dcid']) {
    const occurrences = source.split(`${key}=`).length - 1;
    assert.equal(occurrences, 1, `${key}= should appear exactly once in:\n${source}`);
  }
  assert.doesNotMatch(source, /\bdate=/);
  assert.doesNotMatch(source, /child_place_type=/);
});

test('socrata: rendered cell output is unchanged (portal/dataset_id hand-written once, type never emitted)', () => {
  const [cell] = codeCells(SOCRATA_CALL);
  const source = cell.source.join('');
  // Updated for the try/except guard (website#325 P3, #321): the fetch is
  // indented one level into a try body and a print/empty-DataFrame fallback
  // follows. The kwargs invariants this test was written for (#320) are
  // unchanged and still asserted below.
  const expected = [
    'try:',
    '    df1 = fetch_socrata(',
    '        portal="data.cityofnewyork.us",',
    '        dataset_id="erm2-nwe9",',
    '        select="complaint_type, count(*) as count",',
    '        where="complaint_type IS NOT NULL",',
    '        group="complaint_type",',
    '        order="count DESC",',
    '        limit=5,',
    '    )',
    'except Exception as _err:',
    '    df1 = pd.DataFrame()',
    '    print(f"Step 1: live data could not be fetched ({type(_err).__name__}); continuing with an empty table.")',
    'df1',
  ].join('\n');
  assert.equal(source, expected);
  // The type= call-routing discriminator never appears in the rendered
  // Python, and portal/dataset_id are emitted exactly once each — the
  // same invariant #320 broke for Data Commons.
  assert.doesNotMatch(source, /\btype=/);
  assert.equal(source.split('portal=').length - 1, 1);
  assert.equal(source.split('dataset_id=').length - 1, 1);
});

// --- #321: a call the data source did not answer ---------------------------
//
// Wave N6 P3. A tool call that failed during Phase A was still rendered as an
// executable fetch cell, which then threw on execution — in a notebook whose
// own cover text tells the reader it is reproducible. Each test below names
// the change that makes it red.

const FAILED_SOCRATA_CALL: PhaseAToolCall = {
  name: 'get_data',
  operationType: 'query',
  args: {
    type: 'query',
    portal: 'data.cityofnewyork.us',
    dataset_id: 'erm2-nwe9',
    select: 'complaint_type, count(*) as count',
  },
  reason: 'to aggregate by complaint_type',
  failed: true,
  failureKind: 'timeout',
  // No resultSummary: the call never produced one. See the zero-row test at
  // the bottom for why that absence is NOT what marks it failed.
};

test('#321: a failed call renders as markdown and never as a code cell', () => {
  // RED: keep the type change, revert the failed branch in renderFetchToolCell
  // — a code cell reappears and this fails.
  const out = renderFetchToolCell(FAILED_SOCRATA_CALL, CTX);
  assert.ok(out, 'a failed call must not return null — see the discovery test below');

  const code = out!.cells.filter(c => c.cell_type === 'code');
  assert.equal(
    code.length,
    0,
    `a failed call must contribute no executable cell; got ${code.length}:\n` +
      code.map(c => c.source.join('')).join('\n---\n'),
  );
  assert.equal(out!.cells.length, 1);
  assert.equal(out!.cells[0].cell_type, 'markdown');
  assert.equal(out!.producedDataFrame, false);
  assert.equal(out!.dataFrameVariable, null);
  // Nothing was retrieved, so nothing may be cited as retrieved.
  assert.equal(out!.citation, null);

  const md = out!.cells[0].source.join('');
  // Says WHAT was attempted…
  assert.match(md, /get_data/);
  assert.match(md, /erm2-nwe9/);
  assert.match(md, /data\.cityofnewyork\.us/);
  assert.match(md, /to aggregate by complaint_type/);
  // …and WHY it produced nothing.
  assert.match(md, /did not respond in time/);
  assert.match(md, /returned no data/);
});

test('#321: the failure note carries no raw error text, status codes or host detail', () => {
  // CLAUDE.md: reader-facing failure text never carries raw error strings. The
  // copy is static per kind and takes no message parameter, so this holds by
  // construction — asserted anyway, because a constructive guarantee is one
  // refactor away from being a convention.
  for (const kind of TOOL_FAILURE_KINDS) {
    const out = renderFetchToolCell({ ...FAILED_SOCRATA_CALL, failureKind: kind }, CTX);
    const md = out!.cells[0].source.join('');
    assert.doesNotMatch(md, /\b(?:4\d{2}|5\d{2})\b/, `${kind}: no HTTP status codes`);
    assert.doesNotMatch(md, /Error:|Traceback|ECONNREFUSED|ENOTFOUND|stack/i, `${kind}: no raw error text`);
    // "MCP server" is implementation language (design-principles.md P9).
    assert.doesNotMatch(md, /MCP/i, `${kind}: user language, not implementation language`);
  }
});

test('#321: a failed call is never counted as a discovery step', () => {
  // The trap. `renderDiscoverySummaryCell` selects discovery calls by
  // `renderFetchToolCell(...) === null`, so a failed call that returned null
  // would be swept in here and described to the reader as something the
  // analysis "ran … before fetching data" — a worse claim than the bug being
  // fixed, and one a test asserting only "no code cell" would not catch.
  //
  // RED: make the failed branch in renderFetchToolCell return null.
  const realDiscoveryCall: PhaseAToolCall = {
    name: 'get_data',
    args: { type: 'catalog', query: 'noise complaints' },
    operationType: 'catalog',
  };
  const cell = renderDiscoverySummaryCell([FAILED_SOCRATA_CALL, realDiscoveryCall]);
  assert.ok(cell, 'the genuine catalog call must still produce a discovery summary');
  const md = cell!.source.join('');

  assert.match(md, /catalog/, 'the genuine discovery call is still listed');
  // The failed call's distinctive `reason` is what a swept-in bullet would
  // carry (`- \`get_data\` (query) — to aggregate by complaint_type`), so this
  // is the assertion that names the defect directly.
  assert.doesNotMatch(
    md,
    /to aggregate by complaint_type/,
    `the failed call was swept into the discovery summary and described as a ` +
      `completed discovery step:\n${md}`,
  );
  // And exactly one bullet — the genuine discovery call.
  assert.equal(
    md.split('\n').filter(l => l.startsWith('- `')).length,
    1,
    `expected only the genuine discovery call to be listed:\n${md}`,
  );
});

test('#321: a failed DISCOVERY call is also excluded, not silently listed as completed', () => {
  // A discovery call renders no code cell either way, so the executable-cell
  // bug does not apply to it — but listing a call that never completed among
  // the steps "the original analysis ran" is its own false claim.
  const failedDiscovery: PhaseAToolCall = {
    name: 'ckan__search_datasets',
    args: { query: 'potholes' },
    operationType: 'catalog',
    failed: true,
    failureKind: 'unavailable',
  };
  assert.equal(renderDiscoverySummaryCell([failedDiscovery]), null);

  const out = renderFetchToolCell(failedDiscovery, CTX);
  assert.ok(out, 'a failed discovery call gets a note of its own');
  assert.equal(out!.cells.filter(c => c.cell_type === 'code').length, 0);
  assert.match(out!.cells[0].source.join(''), /ckan__search_datasets/);
  assert.match(out!.cells[0].source.join(''), /could not be reached/);
});

test('#321: every surviving fetch cell wraps its fetch_* call in a try body', () => {
  // RED: drop the try/except from guardedFetch — every fixture reports depth 0.
  for (const [label, call] of ALL_FIXTURES) {
    for (const cell of codeCells(call)) {
      assertFetchIsGuarded(cell, label);
      // Still valid Python after the wrapping.
      assertParsesAsPython(cell, label);
    }
  }
});

test('#321: the guard probe is structural — a cell that merely CONTAINS "try:" fails it', () => {
  // A meta-test on the check itself. An acceptance check that cannot fail is
  // worse than no check, because it reads as passing evidence. This cell would
  // satisfy any `source.includes('try:')` search — the characters appear in a
  // comment, in a SQL string literal, and in a real `try` around an unrelated
  // statement — while `fetch_opencontext` sits outside every try body. The AST
  // probe must reject it, and its rejection is what proves the probe is
  // measuring enclosure rather than the presence of six characters.
  const decoy = [
    '# try: the fetch below is deliberately NOT wrapped',
    '_sql = "SELECT \'try:\' FROM some_table"',
    'df1 = fetch_opencontext(sql=_sql)',
    'try:',
    '    _unrelated = 1',
    'except Exception:',
    '    _unrelated = 0',
    'df1',
  ].join('\n');
  assert.ok(decoy.includes('try:'), 'the decoy does contain the literal a text search looks for');

  const cell: NotebookCell = {
    cell_type: 'code',
    id: 'decoy',
    metadata: {},
    source: decoy.split('\n').map((l, i, a) => (i < a.length - 1 ? l + '\n' : l)),
  };
  assert.throws(
    () => assertFetchIsGuarded(cell, 'decoy'),
    /is not inside a try body \(depth 0\)/,
    'the probe must reject an unguarded fetch even when "try:" appears in the cell',
  );
});

test('#321: the guard falls back to an empty DataFrame and says so out loud', () => {
  // An empty table that reads as a real zero is the false precision
  // design-principles.md Principle 3 forbids, so the failure is printed into
  // the executed output rather than swallowed.
  const [cell] = codeCells(SOCRATA_CALL);
  const source = cell.source.join('');
  assert.match(source, /except Exception as _err:/);
  assert.match(source, /df1 = pd\.DataFrame\(\)/);
  assert.match(source, /print\(f"Step 1: live data could not be fetched/);
  // The exception TYPE, never str(_err) — this notebook's outputs are captured
  // into a published record, so its printed text is a reader-facing surface.
  assert.match(source, /\{type\(_err\)\.__name__\}/);
  assert.doesNotMatch(source, /str\(_err\)/);
  // The trailing bare `df1` stays outside the try so the cell renders its
  // table on both paths.
  assert.ok(source.endsWith('\ndf1'), `cell must end with the bare df1 display:\n${source}`);
});

test('#321: a zero-row SUCCESS is not a failure — only `failed` marks one', () => {
  // Pins the distinction website#325 P2 made possible. Before P2, Socrata
  // resultSummary was always absent, so "no summary" looked like a plausible
  // failure signal. It never was: since P2 a zero-row success carries
  // {rows: 0, columns: 0}, and a query can legitimately match nothing.
  //
  // RED: any implementation that infers failure from a missing or zero
  // summary. Both calls below have no rows; only one of them failed.
  const zeroRowSuccess: PhaseAToolCall = {
    name: 'get_data',
    args: {
      type: 'query',
      portal: 'data.cityofnewyork.us',
      dataset_id: 'erm2-nwe9',
      where: "complaint_type = 'Nonexistent'",
    },
    resultSummary: { rows: 0, columns: 0 },
  };
  const successOut = renderFetchToolCell(zeroRowSuccess, CTX);
  const successCode = successOut!.cells.filter(c => c.cell_type === 'code');
  assert.equal(successCode.length, 1, 'a zero-row success is still reproducible and still gets a cell');
  assert.equal(successOut!.producedDataFrame, true);
  assertParsesAsPython(successCode[0], 'zero-row success');
  assertFetchIsGuarded(successCode[0], 'zero-row success');

  // Same absence of rows, opposite outcome — and the only thing that differs
  // is the explicit `failed` flag.
  const failedNoSummary = renderFetchToolCell(FAILED_SOCRATA_CALL, CTX);
  assert.equal(failedNoSummary!.cells.filter(c => c.cell_type === 'code').length, 0);

  // And a call that failed but DID carry a summary is still a failure: having
  // a summary is not evidence a call did not fail.
  const failedWithSummary = renderFetchToolCell(
    { ...FAILED_SOCRATA_CALL, resultSummary: { rows: 0, columns: 0 } },
    CTX,
  );
  assert.equal(failedWithSummary!.cells.filter(c => c.cell_type === 'code').length, 0);
});

test('#321: a failed call with no failureKind still renders, reading as `unknown`', () => {
  // Defensive: `failed` without a kind must not throw or emit "undefined".
  const out = renderFetchToolCell({ ...FAILED_SOCRATA_CALL, failureKind: undefined }, CTX);
  const md = out!.cells[0].source.join('');
  assert.equal(out!.cells.filter(c => c.cell_type === 'code').length, 0);
  assert.match(md, /could not be completed/);
  assert.doesNotMatch(md, /undefined/);
});
