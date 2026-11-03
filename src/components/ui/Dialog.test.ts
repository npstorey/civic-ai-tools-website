// UX-1 P0, criterion 1: P4 · Dialog renders each state design §2 lists.
//
// States: form, busy, success, error (the Publish dialog's four). Sizes:
// short (max 480 px), form (max 520 px). Regions: header (title, close),
// body (the only element carrying the overflow class), footer (outside the
// scroll: a SIBLING of the body, never inside it, carrying the primary action
// and its one-line consequence).
//
// Mounted on the surface harness. The sibling relation is read from the host
// tree by object identity (`parentOf`), not from markup text; attributes from
// the rendered opening tags (`./ui-test-helpers.ts`). The overflow property
// behind the body's class is read from globals.css.
// Focus trap, Escape, focus return and the backdrop rule are implemented, not
// asserted: the harness has no focus, no layout and no browser events.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/ui/Dialog.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, mount, registerSurfaceHooks, type Surface } from '../sources/surface-test-harness.ts';
import {
  attr, byClass, byPart, byRole, classesOf, cssRules, findAll, hasClass, one, parentOf, readText, within,
} from './ui-test-helpers.ts';

registerSurfaceHooks();
const { Dialog } = await import('@/components/ui/Dialog');

const noop = () => {};
const base = {
  open: true,
  onClose: noop,
  title: 'Fixture title',
  children: 'Fixture body',
  primaryAction: { label: 'Fixture action', onClick: noop },
  footerLine: 'Fixture consequence',
};

const dialogOf = (s: Surface) => one(byRole(s, 'dialog'), 'role="dialog"');

test('Dialog closed renders nothing', async () => {
  const s = await mount(h(Dialog, { ...base, open: false }));
  assert.equal(s.markup(), '', 'open={false}: no markup at all');
});

test('Dialog open: role="dialog", aria-modal, and aria-labelledby naming the title', async () => {
  const s = await mount(h(Dialog, base));
  const dialog = dialogOf(s);
  assert.equal(attr(dialog, 'aria-modal'), 'true', 'aria-modal="true"');
  assert.ok(hasClass(dialog, 'ui-dialog'), `the dialog carries ui-dialog; it has [${classesOf(dialog).join(' ')}]`);
  const labelledBy = attr(dialog, 'aria-labelledby');
  assert.ok(labelledBy, 'the dialog carries aria-labelledby');
  const title = one(findAll(s, (el) => attr(el, 'id') === labelledBy), `element with id="${labelledBy}"`);
  assert.equal(readText(title), 'Fixture title', 'aria-labelledby names the title');
  assert.ok(hasClass(title, 'ui-dialog-title'), 'the title carries ui-dialog-title');
  const header = one(byPart(s, 'header'), '[data-part="header"]');
  assert.ok(within(header).includes(title), 'the title is in the header');
  const close = one(findAll(s, (el) => el.type === 'button' && attr(el, 'aria-label') === 'Close'), 'button with aria-label="Close"');
  assert.ok(within(header).includes(close), 'the close control is in the header');
  assert.equal(attr(close, 'type'), 'button', 'the close control is type="button"');
});

test('Dialog regions: the footer is a sibling of the body, and only the body carries the overflow class', async () => {
  const s = await mount(h(Dialog, base));
  const dialog = dialogOf(s);
  const body = one(byPart(s, 'body'), '[data-part="body"]');
  const footer = one(byPart(s, 'footer'), '[data-part="footer"]');
  const bodyParent = parentOf(s, body);
  assert.ok(bodyParent, 'the body has a parent element');
  assert.equal(parentOf(s, footer), bodyParent, 'the footer and the body share one parent (siblings)');
  assert.ok(within(dialog).includes(body) && within(dialog).includes(footer), 'both are inside the dialog');
  assert.ok(!within(body).includes(footer), 'the footer is not inside the body');
  assert.equal(readText(body), 'Fixture body');

  assert.deepEqual(byClass(s, 'ui-dialog-body'), [body], 'ui-dialog-body is on the body and on nothing else');
  const declared = cssRules('.ui-dialog-body').join(';');
  assert.match(declared, /overflow(-y)?\s*:\s*auto/, 'globals.css: .ui-dialog-body declares overflow auto');
  for (const part of ['.ui-dialog-footer', '.ui-dialog-header', '.ui-dialog']) {
    assert.doesNotMatch(cssRules(part).join(';'), /overflow/, `globals.css: ${part} declares no overflow`);
  }

  const action = one(within(footer).filter((el) => el.type === 'button' && readText(el) === 'Fixture action'), 'primary action in the footer');
  assert.equal(attr(action, 'disabled'), null, 'form state: the primary action is enabled');
  const line = one(byClass(s, 'ui-dialog-footer-line'), 'ui-dialog-footer-line');
  assert.ok(within(footer).includes(line), 'the one-line consequence is in the footer');
  assert.equal(readText(line), 'Fixture consequence');
});

test('Dialog states: form, busy, success, error each mark the dialog; busy disables the action and makes the body inert', async () => {
  for (const state of ['form', 'busy', 'success', 'error'] as const) {
    const s = await mount(h(Dialog, { ...base, state }));
    assert.equal(attr(dialogOf(s), 'data-state'), state, `state ${state}: data-state="${state}"`);
  }
  const busy = await mount(h(Dialog, { ...base, state: 'busy' }));
  assert.equal(attr(dialogOf(busy), 'aria-busy'), 'true', 'busy: aria-busy="true"');
  const body = one(byPart(busy, 'body'), '[data-part="body"]');
  assert.equal(attr(body, 'inert'), '', 'busy: the body is inert');
  const footer = one(byPart(busy, 'footer'), '[data-part="footer"]');
  const action = one(within(footer).filter((el) => el.type === 'button' && readText(el) === 'Fixture action'), 'primary action');
  assert.equal(attr(action, 'disabled'), '', 'busy: the primary action is disabled');
  assert.equal(within(footer).filter((el) => hasClass(el, 'ui-spinner')).length, 1, 'busy: one spinner in the footer');

  const idle = await mount(h(Dialog, base));
  assert.equal(attr(one(byPart(idle, 'body'), '[data-part="body"]'), 'inert'), null, 'form: the body is not inert');
  assert.equal(byClass(idle, 'ui-spinner').length, 0, 'form: no spinner');
});

test('Dialog sizes: short (480 px) and form (520 px, the default)', async () => {
  for (const [size, px] of [['short', 480], ['form', 520]] as const) {
    const s = await mount(h(Dialog, { ...base, size }));
    assert.ok(hasClass(dialogOf(s), `ui-dialog--${size}`), `size ${size}: ui-dialog--${size} in [${classesOf(dialogOf(s)).join(' ')}]`);
    assert.match(cssRules(`.ui-dialog--${size}`).join(';'), new RegExp(`max-width\\s*:\\s*${px}px`), `globals.css: .ui-dialog--${size} max-width ${px}px`);
  }
  const plain = await mount(h(Dialog, base));
  assert.ok(hasClass(dialogOf(plain), 'ui-dialog--form'), 'the default size is form');
});
