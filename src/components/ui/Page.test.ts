// UX-1 P0, criterion 1: P9 · Page renders each width and part design §2 lists.
//
// Widths: reading (720 px), record (800 px), wide (1200 px). One h1, one lede
// style, one section heading. The chip row (ui-chip-row): a horizontally
// scrolling, non-wrapping row. `PageToc` is P7's, not here.
//
// Mounted on the surface harness; classes from the rendered opening tags
// (`./ui-test-helpers.ts`); each width's max-width from globals.css.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/ui/Page.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, mount, registerSurfaceHooks } from '../sources/surface-test-harness.ts';
import { attr, byClass, byTag, classesOf, cssRules, hasClass, one, readText, within } from './ui-test-helpers.ts';

registerSurfaceHooks();
const { Page, PageSection, ChipRow } = await import('@/components/ui/Page');

test('Page renders each width class with its max-width: reading 720, record 800, wide 1200', async () => {
  for (const [width, px] of [['reading', 720], ['record', 800], ['wide', 1200]] as const) {
    const s = await mount(h(Page, { width, children: 'Fixture content' }));
    const page = one(byClass(s, 'ui-page'), `ui-page at width ${width}`);
    assert.ok(hasClass(page, `ui-page--${width}`), `width ${width}: ui-page--${width} in [${classesOf(page).join(' ')}]`);
    assert.match(cssRules(`.ui-page--${width}`).join(';'), new RegExp(`max-width\\s*:\\s*${px}px`), `globals.css: .ui-page--${width} max-width ${px}px`);
  }
});

test('Page renders one h1 and the lede when given, and neither when not', async () => {
  const s = await mount(h(Page, { width: 'reading', title: 'Fixture title', lede: 'Fixture lede', children: 'C' }));
  const page = one(byClass(s, 'ui-page'), 'ui-page');
  const h1 = one(byTag(s, 'h1'), '<h1>');
  assert.ok(within(page).includes(h1), 'the h1 is inside the page');
  assert.ok(hasClass(h1, 'ui-page-title'), 'the h1 carries ui-page-title');
  assert.equal(readText(h1), 'Fixture title');
  const lede = one(byClass(s, 'ui-page-lede'), 'ui-page-lede');
  assert.equal(readText(lede), 'Fixture lede');
  const bare = await mount(h(Page, { width: 'reading', children: 'C' }));
  assert.equal(byTag(bare, 'h1').length, 0, 'no title, no h1');
  assert.equal(byClass(bare, 'ui-page-lede').length, 0, 'no lede, no lede element');
});

test('PageSection renders a section with the one section-heading style', async () => {
  const s = await mount(h(PageSection, { heading: 'Fixture heading', id: 'fixture-section', children: 'Fixture body' }));
  const section = one(byClass(s, 'ui-page-section'), 'ui-page-section');
  assert.equal(section.type, 'section', 'a <section>');
  const heading = one(within(section).filter((el) => el.type === 'h2'), '<h2> in the section');
  assert.ok(hasClass(heading, 'ui-page-section-heading'), 'the heading carries ui-page-section-heading');
  assert.equal(readText(heading), 'Fixture heading');
  assert.equal(attr(section, 'aria-labelledby'), attr(heading, 'id'), 'the section is labelled by its heading');
});

test('ChipRow renders a named group with the chip-row class that scrolls rather than wraps', async () => {
  const s = await mount(h(ChipRow, { label: 'Fixture chips', children: [h('button', { key: 'a', type: 'button' }, 'A'), h('button', { key: 'b', type: 'button' }, 'B')] }));
  const row = one(byClass(s, 'ui-chip-row'), 'ui-chip-row');
  assert.equal(attr(row, 'role'), 'group', 'role="group"');
  assert.equal(attr(row, 'aria-label'), 'Fixture chips', 'named by label');
  assert.equal(within(row).filter((el) => el.type === 'button').length, 2, 'the chips are inside');
  const declared = cssRules('.ui-chip-row').join(';');
  assert.match(declared, /overflow-x\s*:\s*auto/, 'globals.css: .ui-chip-row scrolls horizontally');
  assert.match(declared, /flex-wrap\s*:\s*nowrap/, 'globals.css: .ui-chip-row does not wrap');
});
