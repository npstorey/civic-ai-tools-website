// UX-1 P0, criterion 1: P7 · Row renders each part, size and state design §2 lists.
//
// Anatomy: title (a link), summary, meta line, a trailing column of signals,
// an optional row menu, an optional P1 row disclosure. Sizes: list, card (a
// P5 plain card around the row). States: idle, hover (CSS), withdrawn,
// selected.
//
// Mounted on the surface harness; classes and relations are read from the
// host tree and the rendered opening tags (`./ui-test-helpers.ts`).
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/ui/Row.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEXT_LINK_STUB, h, mount, registerSurfaceHooks, type Surface } from '../sources/surface-test-harness.ts';
import { attr, byClass, byTag, classesOf, findAll, hasClass, one, readText, within } from './ui-test-helpers.ts';

registerSurfaceHooks({ 'next/link': NEXT_LINK_STUB });
const { Row } = await import('@/components/ui/Row');

const rowOf = (s: Surface) => one(byClass(s, 'ui-row'), 'ui-row');
const full = {
  title: 'Fixture title',
  href: '/fixture/path',
  summary: 'Fixture summary',
  meta: ['Fixture date', 'Fixture author', 'Fixture model'],
  signals: h('span', { 'data-fixture': 'signal' }, 'Fixture signal'),
  menu: h('span', { 'data-fixture': 'menu' }, 'Fixture menu'),
  disclosure: { summary: 'Fixture more', children: 'Fixture hidden' },
};

test('Row renders its anatomy: title link, summary, meta, signals, menu, row disclosure', async () => {
  const s = await mount(h(Row, full));
  const row = rowOf(s);
  const inRow = within(row);
  const title = one(inRow.filter((el) => hasClass(el, 'ui-row-title')), 'ui-row-title');
  const link = one(title.type === 'a' ? [title] : within(title).filter((el) => el.type === 'a'), 'the title link');
  assert.equal(attr(link, 'href'), '/fixture/path', 'the title links to href');
  assert.equal(readText(title), 'Fixture title');
  assert.equal(readText(one(inRow.filter((el) => hasClass(el, 'ui-row-summary')), 'ui-row-summary')), 'Fixture summary');
  const meta = one(inRow.filter((el) => hasClass(el, 'ui-row-meta')), 'ui-row-meta');
  assert.deepEqual(within(meta).filter((el) => hasClass(el, 'ui-row-meta-item')).map(readText), ['Fixture date', 'Fixture author', 'Fixture model'], 'the meta items, in order');
  const signals = one(inRow.filter((el) => hasClass(el, 'ui-row-signals')), 'ui-row-signals');
  assert.equal(within(signals).filter((el) => attr(el, 'data-fixture') === 'signal').length, 1, 'the signals sit in the trailing column');
  const menu = one(inRow.filter((el) => hasClass(el, 'ui-row-menu')), 'ui-row-menu');
  assert.equal(within(menu).filter((el) => attr(el, 'data-fixture') === 'menu').length, 1, 'the menu sits in its slot');
  const details = one(inRow.filter((el) => el.type === 'details'), '<details> in the row');
  assert.ok(hasClass(details, 'ui-disclosure--row'), `the row disclosure is size row; it has [${classesOf(details).join(' ')}]`);
});

test('Row omits each optional part it is not given', async () => {
  const s = await mount(h(Row, { title: 'Fixture title' }));
  rowOf(s);
  for (const part of ['ui-row-summary', 'ui-row-meta', 'ui-row-signals', 'ui-row-menu']) {
    assert.equal(byClass(s, part).length, 0, `no ${part} when not given`);
  }
  assert.equal(byTag(s, 'details').length, 0, 'no disclosure when not given');
  assert.equal(byTag(s, 'a').length, 0, 'no link when no href');
});

test('Row sizes: list (the default) and card, which is a P5 plain card', async () => {
  const list = await mount(h(Row, { title: 'T' }));
  assert.ok(hasClass(rowOf(list), 'ui-row--list'), `the default size is list; it has [${classesOf(rowOf(list)).join(' ')}]`);
  assert.equal(byClass(list, 'ui-card').length, 0, 'list: no card');
  const card = await mount(h(Row, { title: 'T', size: 'card' }));
  assert.ok(hasClass(rowOf(card), 'ui-row--card'), 'card: ui-row--card');
  const surface = one(findAll(card, (el) => hasClass(el, 'ui-card') && hasClass(el, 'ui-card--plain')), 'a plain ui-card');
  assert.ok(surface === rowOf(card) || within(surface).includes(rowOf(card)), 'the card is the row or wraps it');
});

test('Row states: withdrawn and selected', async () => {
  const idle = await mount(h(Row, { title: 'T' }));
  assert.ok(!hasClass(rowOf(idle), 'ui-row--withdrawn') && !hasClass(rowOf(idle), 'ui-row--selected'), 'idle: neither state class');
  const withdrawn = await mount(h(Row, { title: 'T', withdrawn: true }));
  assert.ok(hasClass(rowOf(withdrawn), 'ui-row--withdrawn'), 'withdrawn: ui-row--withdrawn');
  const selected = await mount(h(Row, { title: 'T', selected: true }));
  assert.ok(hasClass(rowOf(selected), 'ui-row--selected'), 'selected: ui-row--selected');
});
