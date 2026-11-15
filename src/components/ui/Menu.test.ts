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
import fs from 'node:fs';
import path from 'node:path';
import { NEXT_LINK_STUB, SRC, h, mount, registerSurfaceHooks, type Surface } from '../sources/surface-test-harness.ts';
import { attr, byClass, byRole, classesOf, findAll, hasClass, one, readText, within } from './ui-test-helpers.ts';

registerSurfaceHooks({ 'next/link': NEXT_LINK_STUB });
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

test('Menu link items render as links that keep the item role', async () => {
  const s = await mount(h(Menu, { trigger: 'T', open: true, items: [
    { id: 'go', label: 'Fixture link', href: '/fixture/path' },
    { id: 'off', label: 'Fixture off', href: '/fixture/off', disabledReason: 'Fixture reason' },
  ] }));
  const items = byRole(s, 'menuitem');
  assert.equal(items.length, 2, 'two menuitems');
  assert.equal(items[0].type, 'a', 'an enabled href item is a link');
  assert.equal(attr(items[0], 'href'), '/fixture/path');
  assert.notEqual(items[1].type, 'a', 'a disabled href item is not a link');
  assert.equal(attr(items[1], 'aria-disabled'), 'true');
});

// UX-2 P3b-1 (#728 line 13; the seat's ruling S1): an item can name the page being shown. Only that item's link
// carries `aria-current="page"`; an item without the field renders as before, with no `aria-current` at all.
test('Menu: a link item marked current carries aria-current="page"; no other item carries aria-current', async () => {
  const s = await mount(h(Menu, { trigger: 'T', open: true, items: [
    { id: 'here', label: 'Fixture here', href: '/fixture/here', current: true },
    { id: 'there', label: 'Fixture there', href: '/fixture/there' },
    { id: 'not-current', label: 'Fixture not current', href: '/fixture/not', current: false },
    { id: 'action', label: 'Fixture action' },
  ] }));
  const items = byRole(s, 'menuitem');
  assert.equal(items.length, 4, 'premise: four menuitems');
  assert.deepEqual(items.map((el) => attr(el, 'aria-current')), ['page', null, null, null], 'aria-current on each item, in order');
  assert.equal(items[0].type, 'a', 'the current item is still a link');
});

// --- UX-2 P3b-2 (#729), criterion 7 (2A; Q10 = A) and fix 1 (#729 6865424128): the extension the harness menu needs ---
//
// An item may carry a value at the right (`value`, `ui-menu-item-value`), a description under its label
// (`description`, `ui-menu-item-description`), or `children`: an expandable group whose children are `menuitemradio`s
// (each `checked` or not), opened and closed inline by a click on its row (Enter and Space on a <button> are that
// click), reporting the chosen child through `onSelect`. An item's `kind` makes it a heading row (`ui-menu-heading`, no
// role, not hidden from assistive technology), a rule (`<hr role="separator">`), a footer link, or a full-width
// <button> (`ui-menu-item--button`). `wide` gives the panel `ui-menu-panel--wide` (fix 1). Every test above passes
// unchanged; the render diff of every other Menu user is the gate record's (`temp/ux-2/p3b-measure/p3b2/m6/`).
// WHAT MAKES IT ABLE TO FAIL. At P3b-2's base `MenuItem` has none of these fields, so each renders as a plain item or
// not at all. The items are typed loosely here so the red commit type-checks against the base.
// BLIND SPOTS, stated. The arrow keys walking into an expanded group, Escape and the cap at open (fix 2) need a browser:
// the instrument's KB-2 and its fix-2 read.

const GROUP = [
  { id: 'g', label: 'Fixture group', value: 'Fixture one', children: [
    { id: 'one', label: 'Fixture one', checked: true },
    { id: 'two', label: 'Fixture two', description: 'Fixture description two' },
  ] },
  { id: 'plain', label: 'Fixture plain item', value: 'Fixture value' },
] as unknown as Parameters<typeof Menu>[0]['items'];

test('P3b-2 criterion 7 (2A): an item\'s value renders at its right, in ui-menu-item-value', async () => {
  const s = await mount(h(Menu, { trigger: 'T', items: GROUP, open: true }));
  const plain = one(byRole(s, 'menuitem').filter((el) => readText(el).startsWith('Fixture plain item')), 'the plain item');
  assert.deepEqual(within(plain).filter((el) => hasClass(el, 'ui-menu-item-value')).map((el) => readText(el)), ['Fixture value']);
});

test('P3b-2 criterion 7 (2A): a group row expands inline on a click, its children menuitemradios (checked as given, a description under one), the menu still open; choosing a child reports it and closes the menu', async () => {
  const chosen: string[] = [];
  const s = await mount(h(Menu, { trigger: 'T', items: GROUP, onSelect: (id: string) => chosen.push(id) }));
  await s.click(trigger(s));
  const row = () => one(byRole(s, 'menuitem').filter((el) => readText(el).startsWith('Fixture group')), 'the group row');
  assert.equal(attr(row(), 'aria-expanded'), 'false', 'the group row is not marked collapsed');
  assert.equal(byRole(s, 'menuitemradio').length, 0, 'collapsed, the group\'s children render');
  await s.click(row());
  assert.equal(byRole(s, 'menu').length, 1, 'expanding the group closed the menu');
  assert.equal(attr(row(), 'aria-expanded'), 'true', 'the group row is not marked expanded');
  assert.deepEqual(chosen, [], 'expanding the group reported a choice');
  const radios = byRole(s, 'menuitemradio');
  assert.deepEqual(radios.map((el) => [readText(el).split(' Fixture description')[0], attr(el, 'aria-checked'), attr(el, 'aria-disabled')]), [
    ['Fixture one', 'true', null],
    ['Fixture two', 'false', null],
  ], 'the children: enabled radios, the first checked');
  assert.deepEqual(within(radios[1]).filter((el) => hasClass(el, 'ui-menu-item-description')).map((el) => readText(el)), ['Fixture description two']);
  await s.click(radios[1]);
  assert.deepEqual(chosen, ['two'], 'the chosen child is not reported');
  assert.equal(byRole(s, 'menu').length, 0, 'choosing a child left the menu open');
});

test('P3b-2 criterion 7 (2A): kind heading, rule, footer and button render a heading row, a separator, a footer link and a full-width <button>', async () => {
  const chosen: string[] = [];
  const items = [
    { id: 'h', label: 'Fixture heading', kind: 'heading' },
    { id: 'r', label: '', kind: 'rule' },
    { id: 'f', label: 'Fixture footer', href: '/fixture-footer', kind: 'footer' },
    { id: 'b', label: 'Fixture button', kind: 'button' },
  ] as unknown as Parameters<typeof Menu>[0]['items'];
  const s = await mount(h(Menu, { trigger: 'T', items, open: true, onSelect: (id: string) => chosen.push(id) }));
  const heading = one(byClass(s, 'ui-menu-heading'), 'the heading row');
  assert.deepEqual([readText(heading), attr(heading, 'role'), attr(heading, 'aria-hidden')], ['Fixture heading', null, null], 'the heading: its words, no role, not hidden');
  assert.equal(findAll(s, (el) => el.type === 'hr' && attr(el, 'role') === 'separator').length, 1, 'the rule');
  const footer = one(findAll(s, (el) => el.type === 'a' && attr(el, 'href') === '/fixture-footer'), 'the footer link');
  assert.equal(readText(footer), 'Fixture footer');
  const button = one(byClass(s, 'ui-menu-item--button'), 'the full-width button item');
  assert.equal(button.type, 'button', 'the button item is not a <button>');
  await s.click(button);
  assert.deepEqual(chosen, ['b'], 'the button item does not report its choice');
});

test('P3b-2 fix 1: `wide` gives the panel ui-menu-panel--wide; a menu without it renders none', async () => {
  const wide = await mount(h(Menu, { trigger: 'T', items: ITEMS, open: true, wide: true } as unknown as Parameters<typeof Menu>[0]));
  assert.ok(hasClass(one(byRole(wide, 'menu'), 'the panel'), 'ui-menu-panel--wide'), 'the wide panel lacks ui-menu-panel--wide');
  const plain = await mount(h(Menu, { trigger: 'T', items: ITEMS, open: true }));
  assert.ok(!hasClass(one(byRole(plain, 'menu'), 'the panel'), 'ui-menu-panel--wide'), 'a plain panel carries ui-menu-panel--wide');
});

test('P3b-2 criterion 7 (2G): docs/ui-patterns.md records the extension and the harness menu, and no longer defers submenus', () => {
  const doc = fs.readFileSync(path.join(SRC, '..', 'docs', 'ui-patterns.md'), 'utf8');
  const section = doc.slice(doc.indexOf('### P2 · Menu'), doc.indexOf('### P3 · Sheet'));
  assert.ok(section.length > 0, 'premise: the Menu section is found');
  assert.ok(!section.includes('**Not in this phase:** submenus'), 'the Menu section still defers submenus');
  assert.ok(!section.includes('the composer\'s "+" and settings'), 'the Menu section still names the composer\'s "+" and settings');
  for (const name of ['ui-menu-item-value', 'ui-menu-item-description', 'ui-menu-heading', 'ui-menu-item--button', 'ui-menu-panel--wide', 'children', 'harness menu']) {
    assert.ok(section.includes(name), `the Menu section does not record ${name}`);
  }
});
