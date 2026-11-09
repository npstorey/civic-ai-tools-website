// UX-2 P4a leg D: an open Menu panel stays inside the viewport sideways.
//
// THE DEFECT (the owner's staging read, OA-543). The dashboard's row menu is
// `align="end"`: `.ui-menu-panel--end` puts the panel's right edge at the
// trigger's right edge, and the panel is at least 220 px wide. Below 640 px
// the row's trailing column wraps under the meta line, which leaves the "⋯"
// trigger about 200 px from the left, so the panel ran past the viewport's
// left edge. `Menu` measured vertical room when it opened and flipped up
// (`Menu.tsx:155-162`) but never measured horizontal room.
//
// WHAT IS DRIVEN HERE. The placement decision, `horizontalShift`, called with
// the panel's box as `getBoundingClientRect` reads it and the viewport's
// width. The surface harness cannot drive Menu's own measurement: it never
// attaches refs (`surface-test-harness.ts:29`), so the panel element the
// effect measures is never there. That the Menu applies the decision is read
// from its source below; that it works in a browser is criterion 7's
// instrument (planning `temp/ux-2/p4a-measure/`, assertions MB and HM), which
// opens every row's menu and the account menu at twelve widths.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MENU_EDGE_MARGIN, horizontalShift } from './menu-placement.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const at = (panel: { left: number; right: number }, vw: number) => {
  const dx = horizontalShift(panel, vw);
  return { left: panel.left + dx, right: panel.right + dx };
};

test('leg D: a panel past the left edge (the staging screenshot\'s shape, 390 px) moves right to the margin', () => {
  // The trigger's right edge at about 200 px, the panel 240 px wide, aligned to it.
  const moved = at({ left: -40, right: 200 }, 390);
  assert.equal(moved.left, MENU_EDGE_MARGIN, `the panel's left edge lands at ${moved.left}`);
  assert.ok(moved.right <= 390 - MENU_EDGE_MARGIN, `the panel's right edge lands at ${moved.right}`);
});

test('leg D: a panel past the right edge moves left to the margin', () => {
  const moved = at({ left: 300, right: 540 }, 390);
  assert.equal(moved.right, 390 - MENU_EDGE_MARGIN, `the panel's right edge lands at ${moved.right}`);
  assert.ok(moved.left >= MENU_EDGE_MARGIN, `the panel's left edge lands at ${moved.left}`);
});

test('leg D: a panel already inside the viewport does not move', () => {
  assert.equal(horizontalShift({ left: 150, right: 382 }, 390), 0);
  assert.equal(horizontalShift({ left: MENU_EDGE_MARGIN, right: 380 }, 390), 0);
});

test('leg D: a panel wider than the room keeps its left edge, where the items start, in view', () => {
  const moved = at({ left: -100, right: 300 }, 320);
  assert.equal(moved.left, MENU_EDGE_MARGIN, `the panel's left edge lands at ${moved.left}`);
});

test('leg D: Menu applies the decision to its open panel, from the panel\'s box and the viewport\'s width', () => {
  const source = fs.readFileSync(path.join(HERE, 'Menu.tsx'), 'utf8');
  assert.ok(source.includes("import { horizontalShift } from './menu-placement';"), 'Menu.tsx does not import horizontalShift');
  assert.ok(/horizontalShift\(panel\.getBoundingClientRect\(\), document\.documentElement\.clientWidth\)/.test(source),
    'Menu.tsx does not call horizontalShift with the panel\'s box and the viewport\'s width');
});
