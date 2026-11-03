// UX-1 P0, criterion 1: P2 · Menu renders each state design §2 lists.
//
// Trigger: idle, open (`aria-expanded`), disabled; the three trigger sizes
// (icon, label, field). Items: idle, selected (`aria-checked` on radio items),
// disabled-with-reason (the reason as the item's second line). Hover is CSS.
//
// Mounted on the surface harness; relations and attributes are read from the
// host tree and the rendered opening tags (`./ui-test-helpers.ts`). The open
// state is reached by calling the trigger's onClick, as React would for a
// click. Escape, outside click, arrow keys, Enter and focus return are
// implemented, not asserted: the harness has no focus and no browser events.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/ui/Menu.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, mount, registerSurfaceHooks, type Surface } from '../sources/surface-test-harness.ts';
import { attr, byClass, byRole, classesOf, findAll, hasClass, one, readText, within } from './ui-test-helpers.ts';

registerSurfaceHooks();
const { Menu } = await import('@/components/ui/Menu');

const ITEMS = [
  { id: 'a', label: 'Fixture item A' },
  { id: 'b', label: 'Fixture item B' },
  { id: 'c', label: 'Fixture item C', disabledReason: 'Fixture reason C' },
];

const trigger = (s: Surface) => one(findAll(s, (el) => attr(el, 'aria-haspopup') === 'menu'), 'trigger with aria-haspopup="menu"');

test('Menu closed: a <button> trigger with aria-haspopup="menu" and aria-expanded="false", and no panel', async () => {
  const s = await mount(h(Menu, { trigger: 'Fixture trigger', items: ITEMS }));
  const t = trigger(s);
  assert.equal(t.type, 'button', 'the trigger is a <button>');
  assert.equal(attr(t, 'type'), 'button', 'the trigger is type="button"');
  assert.equal(attr(t, 'aria-expanded'), 'false', 'closed: aria-expanded="false"');
  assert.ok(hasClass(t, 'ui-menu-trigger'), `the trigger carries ui-menu-trigger; it has [${classesOf(t).join(' ')}]`);
  assert.equal(byRole(s, 'menu').length, 0, 'closed: no role="menu" panel');
});

test('Menu open: aria-expanded="true" and a role="menu" panel of menuitems', async () => {
  const s = await mount(h(Menu, { trigger: 'Fixture trigger', items: ITEMS }));
  await s.click(trigger(s));
  assert.equal(attr(trigger(s), 'aria-expanded'), 'true', 'after the trigger is clicked: aria-expanded="true"');
  const panel = one(byRole(s, 'menu'), 'role="menu" panel');
  assert.ok(hasClass(panel, 'ui-menu-panel'), `the panel carries ui-menu-panel; it has [${classesOf(panel).join(' ')}]`);
  const items = within(panel).filter((el) => attr(el, 'role') === 'menuitem');
  assert.deepEqual(items.map((el) => readText(el).startsWith('Fixture item')), [true, true, true], 'three menuitems, in order');
  for (const item of items) assert.ok(hasClass(item, 'ui-menu-item'), 'each item carries ui-menu-item');

  const controlled = await mount(h(Menu, { trigger: 'T', items: ITEMS, open: true }));
  assert.equal(attr(trigger(controlled), 'aria-expanded'), 'true', 'open={true}: aria-expanded="true"');
  assert.equal(byRole(controlled, 'menu').length, 1, 'open={true}: the panel renders');
  const shut = await mount(h(Menu, { trigger: 'T', items: ITEMS, open: false }));
  assert.equal(attr(trigger(shut), 'aria-expanded'), 'false', 'open={false}: aria-expanded="false"');
  assert.equal(byRole(shut, 'menu').length, 0, 'open={false}: no panel');
});

test('Menu radio items carry aria-checked; the selected one is true', async () => {
  const s = await mount(h(Menu, { trigger: 'T', items: ITEMS.slice(0, 2), kind: 'radio', selectedId: 'b', open: true }));
  const radios = byRole(s, 'menuitemradio');
  assert.equal(radios.length, 2, 'two menuitemradio items');
  assert.deepEqual(radios.map((el) => attr(el, 'aria-checked')), ['false', 'true'], 'aria-checked follows selectedId');
});

test('Menu disabled-with-reason item: aria-disabled and its reason as the second line', async () => {
  const s = await mount(h(Menu, { trigger: 'T', items: ITEMS, open: true }));
  const disabled = one(findAll(s, (el) => attr(el, 'aria-disabled') === 'true'), 'item with aria-disabled="true"');
  assert.equal(attr(disabled, 'role'), 'menuitem', 'the disabled item is still a menuitem');
  const reason = one(within(disabled).filter((el) => hasClass(el, 'ui-menu-item-reason')), 'ui-menu-item-reason inside the disabled item');
  assert.equal(readText(reason), 'Fixture reason C');
  assert.equal(byClass(s, 'ui-menu-item-reason').length, 1, 'only the disabled item carries a reason line');
});

test('Menu trigger sizes and the disabled trigger', async () => {
  for (const size of ['icon', 'label', 'field'] as const) {
    const s = await mount(h(Menu, { trigger: 'T', triggerLabel: 'Fixture name', items: ITEMS, size }));
    assert.ok(hasClass(trigger(s), `ui-menu-trigger--${size}`), `size ${size}: ui-menu-trigger--${size} in [${classesOf(trigger(s)).join(' ')}]`);
  }
  const icon = await mount(h(Menu, { trigger: '+', triggerLabel: 'Fixture name', items: ITEMS, size: 'icon' }));
  assert.equal(attr(trigger(icon), 'aria-label'), 'Fixture name', 'an icon trigger is named by triggerLabel');
  const off = await mount(h(Menu, { trigger: 'T', items: ITEMS, disabled: true }));
  assert.equal(attr(trigger(off), 'disabled'), '', 'disabled: the trigger carries disabled');
});
