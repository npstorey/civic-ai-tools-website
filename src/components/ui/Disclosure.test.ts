// UX-1 P0, criterion 1: P1 · Disclosure renders each state design §2 lists.
//
// States: closed and open (there is no disabled state). Sizes: inline,
// section, row. The open attribute follows a controlled prop.
//
// Mounted on the surface harness; relations and attributes are read from the
// host tree and the rendered opening tags (`./ui-test-helpers.ts` says how).
// A claim checked in Node: native toggling, focus and keyboard are a browser's,
// and are not asserted here.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/ui/Disclosure.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEXT_LINK_STUB, h, mount, registerSurfaceHooks } from '../sources/surface-test-harness.ts';
import { attr, byClass, byTag, childrenOf, classesOf, hasClass, one, readText } from './ui-test-helpers.ts';

// `next/link` as a plain anchor, for the Menu the criterion-7 case mounts.
registerSurfaceHooks({ 'next/link': NEXT_LINK_STUB });
const { Disclosure } = await import('@/components/ui/Disclosure');
const { Menu } = await import('@/components/ui/Menu');

test('Disclosure is a native <details class="ui-disclosure"> whose first child is its <summary>', async () => {
  const s = await mount(h(Disclosure, { summary: 'Fixture summary', children: 'Fixture body' }));
  const details = one(byTag(s, 'details'), '<details>');
  assert.ok(hasClass(details, 'ui-disclosure'), `the <details> carries ui-disclosure; it has [${classesOf(details).join(' ')}]`);
  const first = childrenOf(details)[0];
  assert.equal(first?.type, 'summary', 'the first child of the <details> is a <summary>');
  assert.equal(readText(first), 'Fixture summary');
  const body = one(byClass(s, 'ui-disclosure-body'), 'ui-disclosure-body');
  assert.ok(childrenOf(details).includes(body), 'the body is a direct child of the <details>');
  assert.equal(readText(body), 'Fixture body');
});

test('Disclosure closed and open: the open attribute follows the controlled prop', async () => {
  const uncontrolled = await mount(h(Disclosure, { summary: 'S', children: 'B' }));
  assert.equal(attr(one(byTag(uncontrolled, 'details'), '<details>'), 'open'), null, 'closed by default');

  const closed = await mount(h(Disclosure, { summary: 'S', children: 'B', open: false }));
  assert.equal(attr(one(byTag(closed, 'details'), '<details>'), 'open'), null, 'open={false}: no open attribute');

  const open = await mount(h(Disclosure, { summary: 'S', children: 'B', open: true }));
  assert.equal(attr(one(byTag(open, 'details'), '<details>'), 'open'), '', 'open={true}: a bare open attribute');

  const initiallyOpen = await mount(h(Disclosure, { summary: 'S', children: 'B', defaultOpen: true }));
  assert.equal(attr(one(byTag(initiallyOpen, 'details'), '<details>'), 'open'), '', 'defaultOpen: open on first render');
});

// UX-2 P2 criterion 7 (#728 line 2): the cases above mount a fresh element for
// each value of `open`. This one changes `open` on ONE mounted element. A
// guard, green on the base: `Disclosure.tsx:71` passes `open={open ?? defaultOpen}`.
//
// HOW THE PROP CHANGES. The parent reads `open` from `current` each time it is
// rendered. A test file's own hooks are not the harness's (it replaces `react`
// for modules under `src/` only), so the re-render is caused by a primitive
// with state of its own, mounted beside it: a click on a P2 Menu's trigger
// sets the Menu's state, and the harness renders the whole tree again.
test('UX-2 P2 (7) Disclosure: changing `open` on a mounted element moves its open attribute, both ways', async () => {
  const current = { open: false };
  function Parent() {
    return [
      h(Disclosure, { key: 'd', summary: 'S', children: 'B', open: current.open }),
      h(Menu, { key: 'm', trigger: 'Re-render', items: [{ id: 'x', label: 'X' }] }),
    ];
  }
  const s = await mount(h(Parent));
  const pump = () => s.click(one(s.elements().filter((el) => el.type === 'button' && attr(el, 'aria-haspopup') === 'menu'), 'the Menu trigger'));
  const first = one(byTag(s, 'details'), '<details>');
  assert.equal(attr(first, 'open'), null, 'open={false}: closed');
  current.open = true;
  await pump();
  assert.equal(attr(one(byTag(s, 'details'), '<details>'), 'open'), '', 'open={true} on the same element: open');
  current.open = false;
  await pump();
  assert.equal(attr(one(byTag(s, 'details'), '<details>'), 'open'), null, 'and closed again');
  s.unmount();
});

test('Disclosure renders each size class: inline, section (the default), row', async () => {
  for (const size of ['inline', 'section', 'row'] as const) {
    const s = await mount(h(Disclosure, { summary: 'S', children: 'B', size }));
    const details = one(byTag(s, 'details'), `<details> at size ${size}`);
    assert.ok(hasClass(details, `ui-disclosure--${size}`), `size ${size}: ui-disclosure--${size} in [${classesOf(details).join(' ')}]`);
  }
  const plain = await mount(h(Disclosure, { summary: 'S', children: 'B' }));
  assert.ok(hasClass(one(byTag(plain, 'details'), '<details>'), 'ui-disclosure--section'), 'the default size is section');
});

test('Disclosure paints the summary as a destination only when told to', async () => {
  const plain = await mount(h(Disclosure, { summary: 'S', children: 'B' }));
  assert.ok(!hasClass(one(byTag(plain, 'details'), '<details>'), 'ui-disclosure--destination'), 'no destination class by default');
  const dest = await mount(h(Disclosure, { summary: 'S', children: 'B', destination: true }));
  assert.ok(hasClass(one(byTag(dest, 'details'), '<details>'), 'ui-disclosure--destination'), 'destination: ui-disclosure--destination');
});
