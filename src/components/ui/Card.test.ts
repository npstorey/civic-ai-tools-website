// UX-1 P0, criterion 1: P5 · Card renders each variant and state design §2 lists.
//
// Variants: plain, tinted (by tone: accent, info, caution, error, success),
// selectable. States: idle, hover (CSS, selectable only), selected,
// disabled-with-reason. Sizes: default padding, compact.
//
// Mounted on the surface harness; classes and attributes are read from the
// rendered opening tags (`./ui-test-helpers.ts`). A tinted tone's wash is read
// from globals.css: it is written through the tone's `-rgb` twin.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/ui/Card.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, mount, registerSurfaceHooks, type Surface } from '../sources/surface-test-harness.ts';
import { attr, byClass, classesOf, cssRulesMentioning, hasClass, one, readText, within } from './ui-test-helpers.ts';

registerSurfaceHooks();
const { Card } = await import('@/components/ui/Card');

const TONES = ['accent', 'info', 'caution', 'error', 'success'] as const;
const cardOf = (s: Surface) => one(byClass(s, 'ui-card'), 'ui-card');

test('Card renders each variant class: plain (the default), tinted, selectable', async () => {
  for (const variant of ['plain', 'tinted', 'selectable'] as const) {
    const s = await mount(h(Card, { variant, children: 'Fixture content' }));
    const card = cardOf(s);
    assert.ok(hasClass(card, `ui-card--${variant}`), `variant ${variant}: ui-card--${variant} in [${classesOf(card).join(' ')}]`);
    assert.equal(readText(card), 'Fixture content');
  }
  const plain = await mount(h(Card, { children: 'C' }));
  assert.ok(hasClass(cardOf(plain), 'ui-card--plain'), 'the default variant is plain');
});

test('Card tinted renders each tone class, and globals.css washes each through its -rgb twin', async () => {
  for (const tone of TONES) {
    const s = await mount(h(Card, { variant: 'tinted', tone, children: 'C' }));
    assert.ok(hasClass(cardOf(s), `ui-card--tone-${tone}`), `tone ${tone}: ui-card--tone-${tone} in [${classesOf(cardOf(s)).join(' ')}]`);
    const washes = cssRulesMentioning(`ui-card--tone-${tone}`).filter((r) => r.body.includes(`rgba(var(--${tone}-rgb)`));
    assert.ok(washes.length > 0, `globals.css: a rule for ui-card--tone-${tone} reads rgba(var(--${tone}-rgb), …)`);
  }
});

test('Card states: selected, disabled-with-reason, and compact', async () => {
  const idle = await mount(h(Card, { variant: 'selectable', children: 'C' }));
  assert.ok(!hasClass(cardOf(idle), 'ui-card--selected'), 'idle: not selected');
  assert.equal(attr(cardOf(idle), 'aria-disabled'), null, 'idle: not disabled');
  assert.equal(byClass(idle, 'ui-card-reason').length, 0, 'idle: no reason line');

  const selected = await mount(h(Card, { variant: 'selectable', selected: true, children: 'C' }));
  assert.ok(hasClass(cardOf(selected), 'ui-card--selected'), 'selected: ui-card--selected');

  const disabled = await mount(h(Card, { variant: 'selectable', disabledReason: 'Fixture reason', children: 'C' }));
  const card = cardOf(disabled);
  assert.ok(hasClass(card, 'ui-card--disabled'), 'disabled-with-reason: ui-card--disabled');
  assert.equal(attr(card, 'aria-disabled'), 'true', 'disabled-with-reason: aria-disabled="true"');
  const reason = one(within(card).filter((el) => hasClass(el, 'ui-card-reason')), 'ui-card-reason inside the card');
  assert.equal(readText(reason), 'Fixture reason');

  const compact = await mount(h(Card, { compact: true, children: 'C' }));
  assert.ok(hasClass(cardOf(compact), 'ui-card--compact'), 'compact: ui-card--compact');
  assert.ok(!hasClass(cardOf(idle), 'ui-card--compact'), 'default: not compact');
});

test('Card renders as the element asked for', async () => {
  const s = await mount(h(Card, { as: 'section', children: 'C' }));
  assert.equal(cardOf(s).type, 'section');
  const d = await mount(h(Card, { children: 'C' }));
  assert.equal(cardOf(d).type, 'div', 'the default element is a div');
});
