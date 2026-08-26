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
import { renderFetchToolCell, type PhaseAToolCall } from './tool-to-cell.ts';

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
  const expected = [
    'df1 = fetch_socrata(',
    '    portal="data.cityofnewyork.us",',
    '    dataset_id="erm2-nwe9",',
    '    select="complaint_type, count(*) as count",',
    '    where="complaint_type IS NOT NULL",',
    '    group="complaint_type",',
    '    order="count DESC",',
    '    limit=5,',
    ')',
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
