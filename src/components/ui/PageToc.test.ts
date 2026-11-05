// UX-1 P7: PageToc, the page frame's jump list (design §2 P9).
//
// A `<nav aria-label>` named by the caller, holding one list of fragment
// links in the order given, each reaching the id the caller names, with the
// caller's `data-*` attributes on the element that holds the list. Mounted on
// the surface harness inside `Page`; read with P0's shared readers.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/ui/PageToc.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, mount, registerSurfaceHooks } from '../sources/surface-test-harness.ts';
import { attr, byClass, byTag, childrenOf, cssRules, hasClass, one, readText, within } from './ui-test-helpers.ts';

registerSurfaceHooks();
const { PageToc } = await import('@/components/ui/PageToc');
const { Page } = await import('@/components/ui/Page');

const ITEMS = [
  { id: 'fixture-one', label: 'Fixture one' },
  { id: 'fixture-two', label: 'Fixture two' },
  { id: 'fixture-three', label: 'Fixture three' },
];

test('PageToc renders one named nav with a fragment link per item, in order', async () => {
  const s = await mount(h(Page, { width: 'reading', title: 'T', children: h(PageToc, { label: 'Fixture sections', items: ITEMS }) }));
  const nav = one(byTag(s, 'nav'), '<nav>');
  assert.equal(attr(nav, 'aria-label'), 'Fixture sections', 'named by label');
  assert.ok(hasClass(nav, 'ui-page-toc'), 'the nav carries ui-page-toc');
  assert.ok(within(one(byClass(s, 'ui-page'), 'ui-page')).includes(nav), 'the jump list sits inside the frame');
  const list = one(byClass(s, 'ui-page-toc-list'), 'ui-page-toc-list');
  assert.equal(list.type, 'ul');
  const links = within(list).filter((el) => el.type === 'a');
  assert.deepEqual(links.map((a) => attr(a, 'href')), ['#fixture-one', '#fixture-two', '#fixture-three']);
  assert.deepEqual(links.map((a) => readText(a)), ['Fixture one', 'Fixture two', 'Fixture three']);
});

test('PageToc puts the caller\'s data attributes on the element holding the list', async () => {
  const s = await mount(h(PageToc, { label: 'L', items: ITEMS, data: { 'data-statement': 'fixture', 'data-trace': 'const:fixture#X' } }));
  const nav = one(byTag(s, 'nav'), '<nav>');
  const [holder] = childrenOf(nav);
  assert.equal(attr(holder, 'data-statement'), 'fixture');
  assert.equal(attr(holder, 'data-trace'), 'const:fixture#X');
  assert.ok(childrenOf(holder).some((el) => hasClass(el, 'ui-page-toc-list')), 'the holder holds the list');
});

test('PageToc with no data attributes renders none', async () => {
  const s = await mount(h(PageToc, { label: 'L', items: ITEMS }));
  const [holder] = childrenOf(one(byTag(s, 'nav'), '<nav>'));
  assert.equal(attr(holder, 'data-statement'), null);
});

test('globals.css styles the jump list as a list under the lede, spaced like a section', () => {
  assert.match(cssRules('.ui-page-toc').join(';'), /margin\s*:\s*0 0 var\(--space-lg\)/, '.ui-page-toc sits --space-lg above what follows');
  assert.match(cssRules('.ui-page-toc-list').join(';'), /padding-left\s*:\s*20px/, '.ui-page-toc-list is an indented list');
});
