// UX-1 P0, criterion 1: P8 · Tabs renders each state design §2 lists.
//
// role="tablist" / role="tab" / aria-selected. States: idle, hover (CSS),
// selected, disabled-with-reason. The row wraps at narrow width (CSS).
//
// Mounted on the surface harness; attributes are read from the rendered
// opening tags (`./ui-test-helpers.ts`). The selection is driven through the
// tab's onClick, as React would call it. Arrow keys and focus movement are
// implemented, not asserted: the harness has no focus and no browser events.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/ui/Tabs.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, mount, registerSurfaceHooks } from '../sources/surface-test-harness.ts';
import { attr, byRole, classesOf, cssRules, findAll, hasClass, one, readText, within } from './ui-test-helpers.ts';

registerSurfaceHooks();
const { Tabs } = await import('@/components/ui/Tabs');

const TABS = [
  { id: 'one', label: 'Fixture one (3)' },
  { id: 'two', label: 'Fixture two' },
  { id: 'three', label: 'Fixture three', disabledReason: 'Fixture reason' },
];

test('Tabs renders role="tablist" named by its label, and a role="tab" per item', async () => {
  const s = await mount(h(Tabs, { label: 'Fixture tabs', tabs: TABS, selectedId: 'one', onSelect: () => {} }));
  const list = one(byRole(s, 'tablist'), 'role="tablist"');
  assert.equal(attr(list, 'aria-label'), 'Fixture tabs', 'the tablist is named by label');
  assert.ok(hasClass(list, 'ui-tabs'), `the tablist carries ui-tabs; it has [${classesOf(list).join(' ')}]`);
  assert.match(cssRules('.ui-tabs').join(';'), /flex-wrap\s*:\s*wrap/, 'globals.css: .ui-tabs wraps');
  const tabs = byRole(s, 'tab');
  assert.equal(tabs.length, 3, 'three tabs');
  for (const tab of tabs) {
    assert.ok(within(list).includes(tab), 'each tab is inside the tablist');
    assert.equal(tab.type, 'button', 'each tab is a <button>');
    assert.equal(attr(tab, 'type'), 'button', 'each tab is type="button"');
    assert.ok(hasClass(tab, 'ui-tab'), 'each tab carries ui-tab');
  }
  assert.deepEqual(tabs.map(readText).map((t) => t.startsWith('Fixture')), [true, true, true], 'each tab carries the caller\'s words');
});

test('Tabs selected: aria-selected and the roving tabindex follow selectedId; the panel is labelled by the selected tab', async () => {
  const s = await mount(h(Tabs, { label: 'L', tabs: TABS, selectedId: 'two', onSelect: () => {}, children: 'Fixture panel' }));
  const tabs = byRole(s, 'tab');
  assert.deepEqual(tabs.map((t) => attr(t, 'aria-selected')), ['false', 'true', 'false'], 'aria-selected');
  assert.deepEqual(tabs.map((t) => attr(t, 'tabindex')), ['-1', '0', '-1'], 'only the selected tab is in the tab order');
  const panel = one(byRole(s, 'tabpanel'), 'role="tabpanel"');
  assert.equal(readText(panel), 'Fixture panel');
  const selected = tabs[1];
  assert.ok(attr(selected, 'id'), 'the selected tab has an id');
  assert.equal(attr(panel, 'aria-labelledby'), attr(selected, 'id'), 'the panel is labelled by the selected tab');
  assert.equal(attr(selected, 'aria-controls'), attr(panel, 'id'), 'the selected tab controls the panel');
});

test('Tabs onClick selects an enabled tab and not a disabled one', async () => {
  const chosen: string[] = [];
  const s = await mount(h(Tabs, { label: 'L', tabs: TABS, selectedId: 'one', onSelect: (id: string) => { chosen.push(id); } }));
  const tabs = byRole(s, 'tab');
  assert.equal(tabs.length, 3, 'three tabs');
  await s.click(tabs[1]);
  assert.deepEqual(chosen, ['two'], 'clicking an enabled tab calls onSelect with its id');
  const disabled = byRole(s, 'tab')[2];
  if (typeof disabled.props.onClick === 'function') await s.click(disabled);
  assert.deepEqual(chosen, ['two'], 'a disabled tab does not select');
});

test('Tabs disabled-with-reason: aria-disabled and a reason the tab is described by', async () => {
  const s = await mount(h(Tabs, { label: 'L', tabs: TABS, selectedId: 'one', onSelect: () => {} }));
  const disabled = one(findAll(s, (el) => attr(el, 'role') === 'tab' && attr(el, 'aria-disabled') === 'true'), 'tab with aria-disabled="true"');
  const describedBy = attr(disabled, 'aria-describedby');
  assert.ok(describedBy, 'the disabled tab carries aria-describedby');
  const reason = one(findAll(s, (el) => attr(el, 'id') === describedBy), `element with id="${describedBy}"`);
  assert.equal(readText(reason), 'Fixture reason', 'the description is the reason');
  assert.equal(findAll(s, (el) => attr(el, 'aria-disabled') === 'true').length, 1, 'only the one tab is disabled');
});
