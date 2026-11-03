// UX-1 P0, criterion 1: P3 · Sheet renders each state design §2 lists.
//
// States: closed, open, busy (the footer action disabled with a spinner, the
// body inert). Regions: header (title, close), body (the only element
// carrying the overflow class), footer (fixed: one primary action, or a
// status line). The side-panel and bottom-sheet placements are CSS at 900 px.
//
// Mounted on the surface harness. The sibling relation is read from the host
// tree by object identity (`parentOf`), not from markup text; attributes from
// the rendered opening tags (`./ui-test-helpers.ts`). The overflow property
// behind the body's class is read from globals.css.
// Focus trap, Escape, focus return and the backdrop are implemented, not
// asserted: the harness has no focus, no layout and no browser events.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/ui/Sheet.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, mount, registerSurfaceHooks, type Surface } from '../sources/surface-test-harness.ts';
import {
  attr, byClass, byPart, byRole, classesOf, cssRules, findAll, hasClass, one, parentOf, readText, within,
} from './ui-test-helpers.ts';

registerSurfaceHooks();
const { Sheet } = await import('@/components/ui/Sheet');

const noop = () => {};
const base = {
  open: true,
  onClose: noop,
  title: 'Fixture title',
  children: 'Fixture body',
  primaryAction: { label: 'Fixture action', onClick: noop },
};

const sheetOf = (s: Surface) => one(byRole(s, 'dialog'), 'role="dialog"');

test('Sheet closed renders nothing', async () => {
  const s = await mount(h(Sheet, { ...base, open: false }));
  assert.equal(s.markup(), '', 'open={false}: no markup at all');
});

test('Sheet open: role="dialog", aria-modal, and aria-labelledby naming the title', async () => {
  const s = await mount(h(Sheet, base));
  const sheet = sheetOf(s);
  assert.equal(attr(sheet, 'aria-modal'), 'true', 'aria-modal="true"');
  assert.ok(hasClass(sheet, 'ui-sheet'), `the sheet carries ui-sheet; it has [${classesOf(sheet).join(' ')}]`);
  const labelledBy = attr(sheet, 'aria-labelledby');
  assert.ok(labelledBy, 'the sheet carries aria-labelledby');
  const title = one(findAll(s, (el) => attr(el, 'id') === labelledBy), `element with id="${labelledBy}"`);
  assert.equal(readText(title), 'Fixture title', 'aria-labelledby names the title');
  assert.ok(hasClass(title, 'ui-sheet-title'), 'the title carries ui-sheet-title');
  const header = one(byPart(s, 'header'), '[data-part="header"]');
  assert.ok(within(header).includes(title), 'the title is in the header');
  const close = one(findAll(s, (el) => el.type === 'button' && attr(el, 'aria-label') === 'Close'), 'button with aria-label="Close"');
  assert.ok(within(header).includes(close), 'the close control is in the header');
  assert.equal(attr(close, 'type'), 'button', 'the close control is type="button"');
});

test('Sheet regions: the footer is a sibling of the body, and only the body carries the overflow class', async () => {
  const s = await mount(h(Sheet, base));
  const sheet = sheetOf(s);
  const body = one(byPart(s, 'body'), '[data-part="body"]');
  const footer = one(byPart(s, 'footer'), '[data-part="footer"]');
  const bodyParent = parentOf(s, body);
  assert.ok(bodyParent, 'the body has a parent element');
  assert.equal(parentOf(s, footer), bodyParent, 'the footer and the body share one parent (siblings)');
  assert.ok(within(sheet).includes(body) && within(sheet).includes(footer), 'both are inside the sheet');
  assert.ok(!within(body).includes(footer), 'the footer is not inside the body');
  assert.equal(readText(body), 'Fixture body');

  assert.deepEqual(byClass(s, 'ui-sheet-body'), [body], 'ui-sheet-body is on the body and on nothing else');
  const declared = cssRules('.ui-sheet-body').join(';');
  assert.match(declared, /overflow(-y)?\s*:\s*auto/, 'globals.css: .ui-sheet-body declares overflow auto');
  for (const part of ['.ui-sheet-footer', '.ui-sheet-header', '.ui-sheet']) {
    assert.doesNotMatch(cssRules(part).join(';'), /overflow/, `globals.css: ${part} declares no overflow`);
  }

  const action = one(within(footer).filter((el) => el.type === 'button' && readText(el) === 'Fixture action'), 'primary action in the footer');
  assert.equal(attr(action, 'disabled'), null, 'open: the primary action is enabled');
});

test('Sheet footer can carry a status line instead of an action', async () => {
  const s = await mount(h(Sheet, { ...base, primaryAction: undefined, footerLine: 'Fixture status' }));
  const footer = one(byPart(s, 'footer'), '[data-part="footer"]');
  const line = one(byClass(s, 'ui-sheet-footer-line'), 'ui-sheet-footer-line');
  assert.ok(within(footer).includes(line), 'the status line is in the footer');
  assert.equal(readText(line), 'Fixture status');
  assert.equal(within(footer).filter((el) => el.type === 'button').length, 0, 'no action button in the footer');
});

test('Sheet busy: aria-busy, the footer action disabled with a spinner, the body inert', async () => {
  const s = await mount(h(Sheet, { ...base, busy: true }));
  assert.equal(attr(sheetOf(s), 'aria-busy'), 'true', 'busy: aria-busy="true"');
  const body = one(byPart(s, 'body'), '[data-part="body"]');
  assert.equal(attr(body, 'inert'), '', 'busy: the body is inert');
  const footer = one(byPart(s, 'footer'), '[data-part="footer"]');
  const action = one(within(footer).filter((el) => el.type === 'button' && readText(el) === 'Fixture action'), 'primary action');
  assert.equal(attr(action, 'disabled'), '', 'busy: the primary action is disabled');
  assert.equal(within(footer).filter((el) => hasClass(el, 'ui-spinner')).length, 1, 'busy: one spinner in the footer');

  const idle = await mount(h(Sheet, base));
  assert.equal(attr(one(byPart(idle, 'body'), '[data-part="body"]'), 'inert'), null, 'open: the body is not inert');
  assert.equal(byClass(idle, 'ui-spinner').length, 0, 'open: no spinner');
});
