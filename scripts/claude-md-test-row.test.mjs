// Guard: CLAUDE.md's `npm test` row does not pin a pass count (#381, D6 = A).
//
// WHY. `CLAUDE.md`'s Commands table read, at `c342fe0`:
//
//   | `npm test` | `# pass 1205` / `# fail 0` (`node --test` TAP summary) —
//   the total rises as tests are added; `# fail 0` is the gate (#381) |
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
// SCOPE. Only the `npm test` row. The `npm run lint` row two lines below
// pins `3 warnings` in the same shape (a live count in a literal) — this
// guard does not touch it; #385/#381 name only the test row, and whether
// the lint count is the same defect is for the report to flag, not for this
// phase to resolve unilaterally.
//
// BLIND SPOT, STATED. This reads CLAUDE.md as text and finds one row by its
// leading cell (`| \`npm test\` |`). It cannot see whether `# fail 0` is
// still true — that is what `npm test`'s own exit code is for — only
// whether the row still claims a specific pass count.

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
