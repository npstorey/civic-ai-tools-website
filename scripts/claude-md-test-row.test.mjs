// Guard: CLAUDE.md's `npm test` and `npm run lint` rows do not pin a live
// count that the runner outgrows (#381, D6 = A; #385).
//
// WHY. `CLAUDE.md`'s Commands table read, at `c342fe0`:
//
//   | `npm test` | `# pass 1205` / `# fail 0` (`node --test` TAP summary) —
//   the total rises as tests are added; `# fail 0` is the gate (#381) |
//   | `npm run lint` | `✖ 3 problems (0 errors, 3 warnings)` — warnings are
//   the baseline; **zero errors** is the gate |
//
// The runner reported `# pass 1274` at this wave's merge-ref — already wrong
// — and will be wrong again after every phase that adds a test, forever,
// because the total is monotonically increasing and the row is a literal.
// Ruling D6 = A (comment 5513506685): drop the pinned number; `# fail 0`
// stays the gate, and the note already in the cell ("the total rises as
// tests are added; `# fail 0` is the gate") stays as-is — it already says
// the right thing about the count, it just sits next to a number that
// contradicts it.
//
// SCOPE. Stage 1 of this guard covered only the `npm test` row — #385/#381
// named only that row, and the `npm run lint` row's pinned `3 warnings` was
// flagged rather than fixed, pending an ORCH ruling on whether it is the same
// defect class. The ORCH ruled it is (same phase, stage 2): a documented
// figure a reader can falsify just by running the command. Both rows are
// covered here now.
//
// BLIND SPOT, STATED. This reads CLAUDE.md as text and finds two rows by
// their leading cell. It cannot see whether `# fail 0` or `0 errors` is still
// true — that is what `npm test`'s and `npm run lint`'s own exit codes are
// for — only whether the rows still claim a specific pass/warning count.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLAUDE_MD_PATH = fileURLToPath(new URL('../CLAUDE.md', import.meta.url));
const CLAUDE_MD = readFileSync(CLAUDE_MD_PATH, 'utf8');

function findRow(text, leadingCell) {
  return text.split('\n').find((line) => line.startsWith(leadingCell));
}

test('#381: the npm test row exists in the Commands table', () => {
  const row = findRow(CLAUDE_MD, '| `npm test`');
  assert.ok(row, 'no row starting with "| `npm test`" found — update this guard if the table moved');
});

test('#381: the npm test row keeps `# fail 0` as the gate', () => {
  const row = findRow(CLAUDE_MD, '| `npm test`');
  assert.ok(row, 'no row starting with "| `npm test`" found — update this guard if the table moved');
  assert.ok(
    row.includes('# fail 0'),
    `the npm test row must still name "# fail 0" as the gate; found: ${row}`,
  );
});

test('#381: the npm test row does not pin a `# pass <N>` literal', () => {
  const row = findRow(CLAUDE_MD, '| `npm test`');
  assert.ok(row, 'no row starting with "| `npm test`" found — update this guard if the table moved');
  assert.ok(
    !/#\s*pass\s+\d+/.test(row),
    `the npm test row still pins a pass count, which the total outgrows every phase (D6 = A, #381): ${row}`,
  );
});

test('#381: the npm run lint row does not pin a `<N> warnings` literal', () => {
  // Same defect, same ruling, taken in this phase per the ORCH: the warning
  // count is a small, moving baseline (new warnings, fixed warnings), not a
  // number worth re-editing this file for every time it changes by one.
  // Zero errors stays the gate.
  const row = findRow(CLAUDE_MD, '| `npm run lint`');
  assert.ok(row, 'no row starting with "| `npm run lint`" found — update this guard if the table moved');
  assert.ok(
    !/\d+\s+warnings?/i.test(row),
    `the npm run lint row still pins a warning count, which drifts independently of this phase: ${row}`,
  );
  assert.ok(
    /0 errors/.test(row),
    `the npm run lint row must still name "0 errors" as the gate; found: ${row}`,
  );
});
