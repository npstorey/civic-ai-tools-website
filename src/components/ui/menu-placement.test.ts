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
import { MENU_EDGE_MARGIN, MIN_CAP, horizontalShift, verticalPlacement } from './menu-placement.ts';

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
  assert.ok(/import \{[^}]*\bhorizontalShift\b[^}]*\} from '\.\/menu-placement';/.test(source), 'Menu.tsx does not import horizontalShift');
  assert.ok(/horizontalShift\(panel\.getBoundingClientRect\(\), document\.documentElement\.clientWidth\)/.test(source),
    'Menu.tsx does not call horizontalShift with the panel\'s box and the viewport\'s width');
});

// --- UX-2-FIX P2, item 8 (#790): every menu's panel is capped to the room it opens into ---------------------------------
//
// THE DEFECT. The cap was set only for a menu with a group (P3b-2 fix 2); every other menu's panel was up to 60vh, so
// a long one opened mid-screen ran under the sticky header (opening up) or past the window's bottom (opening down).
//
// WHAT IS DRIVEN. `verticalPlacement`, the decision `Menu` makes at open, with a trigger's box, the viewport's height,
// the sticky header's bottom edge and the item count, for a menu with no group. The harness attaches no refs, so that
// `Menu` applies the cap to its panel is read from its source, and how the cap composes with the stylesheet's rules
// (the directory's filters keep their 280 px) from `globals.css`; the panel lying inside its room is the phase's
// Chrome read at 390 and 1280.

const VH = 844;
const HEADER = 64;

test('#790 item 8: a menu without a group opening down is capped to the room below (less 12 px)', () => {
  const placed = verticalPlacement({ top: 400, bottom: 440 }, VH, HEADER, 30);
  assert.deepEqual(placed, { above: false, cap: VH - 440 - 12 });
});

test('#790 item 8: a menu without a group opening up is capped to the room above, measured to the sticky header\'s bottom', () => {
  const placed = verticalPlacement({ top: 600, bottom: 640 }, VH, HEADER, 30);
  assert.deepEqual(placed, { above: true, cap: 600 - HEADER - 12 });
});

test('#790 item 8: the cap is floored at MIN_CAP in a cramped window', () => {
  assert.deepEqual(verticalPlacement({ top: 100, bottom: 140 }, 260, HEADER, 30), { above: false, cap: MIN_CAP });
});

test('#790 item 8 (guard): the cap is the one a menu with a group had before (fix 2), for every menu', () => {
  assert.deepEqual(verticalPlacement({ top: 600, bottom: 640 }, VH, HEADER, 30), { above: true, cap: 600 - HEADER - 12 });
  assert.deepEqual(verticalPlacement({ top: 100, bottom: 140 }, VH, HEADER, 3), { above: false, cap: VH - 140 - 12 });
});

/** The declarations (name -> value) of every rule naming `selector` exactly, comments removed. */
function declarations(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map((x) => x.replace(/\s+/g, ' ').trim()).includes(selector)) continue;
    for (const d of m[2].split(';')) {
      const at = d.indexOf(':');
      if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim();
    }
  }
  return out;
}

test('#790 item 8: Menu sets the cap for every menu as a custom property, never as an inline max-height that would override the stylesheet', () => {
  const source = fs.readFileSync(path.join(HERE, 'Menu.tsx'), 'utf8');
  const call = /verticalPlacement\(button\.getBoundingClientRect\(\), window\.innerHeight, header, items\.length\)/.test(source);
  assert.deepEqual({
    placementForEveryMenu: call,
    inlineMaxHeight: /maxHeight:/.test(source),
    capProperty: source.includes("'--ui-menu-cap'"),
  }, { placementForEveryMenu: true, inlineMaxHeight: false, capProperty: true });
});

test('#790 item 8: the stylesheet reads the cap in the panel\'s rule and in the filters\' rule, which keeps its 280 px', () => {
  const css = fs.readFileSync(path.join(HERE, '..', '..', 'app', 'globals.css'), 'utf8');
  const panel = declarations(css, '.ui-menu-panel')['max-height'] ?? '';
  const filter = declarations(css, '.directory-filter .ui-menu-panel')['max-height'] ?? '';
  assert.deepEqual({
    panelReadsCap: panel.includes('var(--ui-menu-cap'),
    panelKeeps60vh: panel.includes('60vh'),
    filterReadsCap: filter.includes('var(--ui-menu-cap'),
    filterKeeps280: filter.includes('280px'),
  }, { panelReadsCap: true, panelKeeps60vh: true, filterReadsCap: true, filterKeeps280: true }, `panel: ${panel}; filter: ${filter}`);
});
