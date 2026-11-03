// UX-1 P0, criterion 1: P6 · Signal renders each tier and size design §2 lists.
//
// Tiers, glyph and token, never colour alone: neutral (dot, --text-muted),
// ok (check, --success), caution (triangle, --caution), problem (cross,
// --error), info (i, --info). Sizes: line, block. Optional detail; optional P1
// inline disclosure. The glyph is decorative (aria-hidden); the caller's label
// carries the meaning. `TrustSignal.tsx` is the reference and is not touched.
//
// Mounted on the surface harness; attributes are read from the rendered
// opening tags (`./ui-test-helpers.ts`); each tier's token from globals.css.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/ui/Signal.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { h, mount, registerSurfaceHooks, type Surface } from '../sources/surface-test-harness.ts';
import { attr, byClass, byTag, classesOf, cssRulesMentioning, hasClass, one, readText, within } from './ui-test-helpers.ts';

registerSurfaceHooks();
const { Signal } = await import('@/components/ui/Signal');

const TIERS = [
  { tier: 'neutral', glyph: 'dot', token: '--text-muted' },
  { tier: 'ok', glyph: 'check', token: '--success' },
  { tier: 'caution', glyph: 'triangle', token: '--caution' },
  { tier: 'problem', glyph: 'cross', token: '--error' },
  { tier: 'info', glyph: 'info', token: '--info' },
] as const;

const signalOf = (s: Surface) => one(byClass(s, 'ui-signal'), 'ui-signal');

test('Signal renders a decorative glyph and the caller\'s label in each of the five tiers', async () => {
  const glyphMarkup: string[] = [];
  for (const { tier, glyph, token } of TIERS) {
    const label = `Fixture label ${tier}`;
    const s = await mount(h(Signal, { tier, label }));
    const row = signalOf(s);
    assert.ok(hasClass(row, `ui-signal--${tier}`), `tier ${tier}: ui-signal--${tier} in [${classesOf(row).join(' ')}]`);
    const svg = one(within(row).filter((el) => el.type === 'svg'), `the glyph <svg> in tier ${tier}`);
    assert.equal(attr(svg, 'aria-hidden'), 'true', `tier ${tier}: the glyph is aria-hidden`);
    assert.equal(attr(svg, 'aria-label'), null, `tier ${tier}: the glyph carries no aria-label`);
    assert.equal(attr(svg, 'data-glyph'), glyph, `tier ${tier}: the ${glyph} glyph`);
    assert.ok(hasClass(svg, 'ui-signal-glyph'), `tier ${tier}: the glyph carries ui-signal-glyph`);
    const labelEl = one(within(row).filter((el) => hasClass(el, 'ui-signal-label')), `ui-signal-label in tier ${tier}`);
    assert.equal(readText(labelEl), label, `tier ${tier}: the caller's label`);
    glyphMarkup.push(renderToStaticMarkup(svg));
    const painted = cssRulesMentioning(`.ui-signal--${tier}`).filter((r) => r.body.includes(`var(${token})`));
    assert.ok(painted.length > 0, `globals.css: a rule for .ui-signal--${tier} reads var(${token})`);
  }
  assert.equal(new Set(glyphMarkup).size, TIERS.length, 'five tiers, five distinct glyph silhouettes');
});

test('Signal sizes: line (the default) and block, with the detail under the label only when given', async () => {
  for (const size of ['line', 'block'] as const) {
    const s = await mount(h(Signal, { tier: 'ok', label: 'L', size, detail: 'Fixture detail' }));
    assert.ok(hasClass(signalOf(s), `ui-signal--${size}`), `size ${size}: ui-signal--${size}`);
    const detail = one(byClass(s, 'ui-signal-detail'), `ui-signal-detail at size ${size}`);
    assert.equal(readText(detail), 'Fixture detail');
  }
  const plain = await mount(h(Signal, { tier: 'ok', label: 'L' }));
  assert.ok(hasClass(signalOf(plain), 'ui-signal--line'), 'the default size is line');
  assert.equal(byClass(plain, 'ui-signal-detail').length, 0, 'no detail given, no detail element');
});

test('Signal can carry an inline P1 disclosure under the row', async () => {
  const s = await mount(h(Signal, { tier: 'info', label: 'L', disclosure: { summary: 'Fixture summary', children: 'Fixture more' } }));
  const details = one(byTag(s, 'details'), '<details>');
  assert.ok(hasClass(details, 'ui-disclosure') && hasClass(details, 'ui-disclosure--inline'), `an inline ui-disclosure; it has [${classesOf(details).join(' ')}]`);
  assert.ok(within(signalOf(s)).includes(details), 'the disclosure is inside the signal row');
  const plain = await mount(h(Signal, { tier: 'info', label: 'L' }));
  assert.equal(byTag(plain, 'details').length, 0, 'no disclosure given, none rendered');
});
