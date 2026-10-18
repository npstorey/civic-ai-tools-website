// LAYOUT-WEB W2 P1, criterion 2: the step view reads a tool's name only through
// the name readers in `src/lib/mcp/operation-types.ts`.
//
// THE PROPERTY. Where the comparison's steps are built and rendered —
// `src/components/`, `src/hooks/` and `src/lib/answer-view/` (where the
// grouping and labelling now live), test files excluded — a quoted civic tool
// name (`'get_data'`, `'search'`, `'fetch'`, `'search_indicators'`) appears
// only as:
//   - the name `isTool(name, '…')` compares, in either spelling;
//   - the right side of a comparison with `upstreamToolName(…)`;
//   - the right side of a comparison with an operation type (`opType ===
//     'search'` compares a derived operation type, not a name).
// Anything else — `name === 'get_data'`, `case 'fetch':`, a list of names — is
// a second reading of names beside the seam, and misses the exposed spelling
// (`socrata__get_data`).
//
// HOW IT READS. The scan is the criterion's own command, run from the
// repository root:
//   git grep -nE "'(get_data|search|fetch|search_indicators)'" -- src/components src/hooks src/lib/answer-view ':!*.test.ts' ':!*.test.tsx'
// At 4598f55 it returned three lines, all compliant (`useStreamingComparison.ts`
// :303, :330, :353); after the move they are in `src/lib/answer-view/steps.ts`.
//
// BLIND SPOTS, stated. `git grep` reads tracked files: a new file is read once
// it is added to the index. Double-quoted and template-literal names are not
// scanned (at 4598f55 those forms hit comments only). A comment that quotes a
// name in single quotes is read like code and reported. Fixtures name tools
// freely, so test files are excluded, as the criterion excludes them.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/answer-view/tool-names-read-through-the-seam.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIRECTORIES = ['src/components', 'src/hooks', 'src/lib/answer-view'];
const NAMES = ['get_data', 'search', 'fetch', 'search_indicators'];
const LITERAL = new RegExp(`'(?:${NAMES.join('|')})'`, 'g');

/** The criterion's `git grep`, as `file:line:text` rows; none is an empty list. */
function scan(): string[] {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-nE', `'(${NAMES.join('|')})'`, '--', ...DIRECTORIES, ':!*.test.ts', ':!*.test.tsx'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    return out.split('\n').filter((row) => row !== '');
  } catch (error) {
    // `git grep` exits 1 when nothing matches.
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

/** Why a quoted name at this position is a read through the seam, or null. */
function throughTheSeam(before: string): string | null {
  if (/\bisTool\([^()]*,\s*$/.test(before)) return 'isTool';
  if (/\bupstreamToolName\([^()]*\)\s*[!=]==?\s*$/.test(before)) return 'upstreamToolName';
  if (/\b\w*(?:opType|OpType|operationType|OperationType)\s*[!=]==?\s*$/.test(before)) return 'operation type';
  return null;
}

/** Every quoted name on a line that is not read through the seam. */
function offendingNames(line: string): string[] {
  const found: string[] = [];
  for (const m of line.matchAll(LITERAL)) {
    if (throughTheSeam(line.slice(0, m.index)) === null) found.push(m[0]);
  }
  return found;
}

test('names are read through the seam: every quoted tool name in components, hooks and the step module is an isTool / upstreamToolName read or an operation-type comparison', () => {
  const offending = scan().filter((row) => {
    const text = row.replace(/^[^:]*:\d+:/, '');
    return offendingNames(text).length > 0;
  });
  assert.deepEqual(
    offending,
    [],
    `${offending.length} line(s) read a tool name beside the seam (src/lib/mcp/operation-types.ts):\n  ${offending.join('\n  ')}\n` +
      'Read a name through `isTool(name, upstream)` or `upstreamToolName(name)`, which read either spelling.',
  );
});

test('names are read through the seam: the scan reaches the step module, where the label reads landed', () => {
  const rows = scan();
  const inModule = rows.filter((row) => row.startsWith('src/lib/answer-view/steps.ts:'));
  assert.ok(
    inModule.length > 0,
    `the scan returns no line from src/lib/answer-view/steps.ts; the label reads it was written for are not where it looks:\n  ${rows.join('\n  ')}`,
  );
  const kinds = new Set(inModule.flatMap((row) => [...row.matchAll(LITERAL)].map((m) => throughTheSeam(row.slice(0, m.index)))));
  for (const kind of ['isTool', 'operation type']) {
    assert.ok(kinds.has(kind), `no ${kind} read in the step module; the instrument no longer sees the reads it classifies`);
  }
});

test('names are read through the seam: the instrument reports the shapes that read a name beside it and passes the ones that read through it', () => {
  const beside = [
    "if (name === 'get_data') return 'Gathering data';",
    "const isFetch = entry.toolName === 'fetch';",
    "    case 'search':",
    "if (['get_data', 'fetch'].includes(name)) {",
    "return named.toolName !== 'search_indicators' ? a : b;",
    "if (isTool(first.toolName, 'fetch') || first.toolName === 'search') {",
  ];
  for (const line of beside) {
    assert.ok(offendingNames(line).length > 0, `must report: ${line}`);
  }
  const through = [
    "if (opType === 'search') {",
    "if (isTool(first.toolName, 'fetch')) {",
    "if (named) return named.toolName && !isTool(named.toolName, 'get_data') ? a : b;",
    "if (upstreamToolName(call.name) === 'search_indicators') {",
    "const searching = entryOperationType !== 'search';",
  ];
  for (const line of through) {
    assert.deepEqual(offendingNames(line), [], `must pass: ${line}`);
  }
});
