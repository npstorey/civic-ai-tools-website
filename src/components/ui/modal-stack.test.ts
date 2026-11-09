// UX-2 P4b, from the owner's staging read: with two modals open (the review
// Sheet, then the Settings overlay's Dialog over it), one Escape closed both.
// Only the topmost open modal answers Escape and Tab; a second Escape closes
// the next one down; focus returns layer by layer.
//
// WHAT IS DRIVEN. `useModalFocus` (`./Dialog.tsx`), the one implementation the
// Dialog (`Dialog.tsx:158`) and the Sheet (`Sheet.tsx:55`) share: each passes
// it its panel's ref and `() => { if (!busy) onClose(); }`. The hook is the
// class under test, so it is driven directly, once per modal, each on its own
// surface (`../sources/surface-test-harness.ts`, its effects and cleanups).
//
// WHY NOT THE REAL Dialog AND Sheet. The surface harness never attaches refs
// and has no `document` (its header, "BLIND SPOTS"), so inside a mounted
// Dialog or Sheet the hook returns before it adds a listener: nothing there
// can fail. Here each modal's panel is a small fake element handed in as the
// ref, and `document` is a fake that dispatches a key event as the DOM does:
// listeners in the order they were added, `stopPropagation()` NOT stopping
// another listener on the same target, `stopImmediatePropagation()` doing so,
// and a listener removed during the dispatch not called. The real components
// in a browser are criterion 6's instrument, not this file's.
//
// WHAT MAKES IT ABLE TO FAIL. At the base each open modal's listener acts on
// every key, so one Escape calls both modals' `onEscape`, and the lower
// modal's trap moves focus into its own panel before the upper one moves it
// back.
//
// BLIND SPOTS, stated. No layout and no real focus order: Tab's natural move
// (when the trap does not prevent it) is not simulated, so a Tab from the
// middle of a panel is read as "not prevented, focus not moved". The busy
// guard lives in the Dialog's and the Sheet's own callbacks and is not driven
// here.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { h, mount, registerSurfaceHooks, type Surface } from '../sources/surface-test-harness.ts';

// --- A fake DOM, just enough for the hook ----------------------------------------------

class FakeElement {
  name: string;
  focusable: boolean;
  kids: FakeElement[] = [];
  parent: FakeElement | null = null;
  constructor(name: string, focusable = false) {
    this.name = name;
    this.focusable = focusable;
  }
  add(...kids: FakeElement[]): this {
    for (const kid of kids) {
      kid.parent = this;
      this.kids.push(kid);
    }
    return this;
  }
  focus(): void {
    fakeDocument.activeElement = this;
    focusLog.push(this.name);
  }
  contains(other: unknown): boolean {
    for (let at = other as FakeElement | null; at; at = at.parent) if (at === this) return true;
    return false;
  }
  closest(): null {
    return null;
  }
  querySelectorAll(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const kid of el.kids) {
        if (kid.focusable) out.push(kid);
        walk(kid);
      }
    };
    walk(this);
    return out;
  }
}

interface FakeKeyEvent {
  key: string;
  shiftKey: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}
type Listener = (event: FakeKeyEvent) => void;
interface Registered { fn: Listener; capture: boolean }

let listeners: Registered[] = [];
const focusLog: string[] = [];
const captureOf = (options: unknown) => (typeof options === 'boolean' ? options : Boolean((options as { capture?: boolean } | undefined)?.capture));
const body = new FakeElement('body');
const fakeDocument = {
  activeElement: body as FakeElement,
  body,
  addEventListener(type: string, fn: Listener, options?: unknown) {
    if (type !== 'keydown') return;
    const capture = captureOf(options);
    if (!listeners.some((l) => l.fn === fn && l.capture === capture)) listeners.push({ fn, capture });
  },
  removeEventListener(type: string, fn: Listener, options?: unknown) {
    if (type !== 'keydown') return;
    const capture = captureOf(options);
    listeners = listeners.filter((l) => !(l.fn === fn && l.capture === capture));
  },
};
(globalThis as unknown as { document: unknown }).document = fakeDocument;
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeElement;

/** Dispatch a keydown at `document`, as the DOM does for a listener on that target. */
function press(key: string, shiftKey = false): FakeKeyEvent {
  let immediate = false;
  const event: FakeKeyEvent = {
    key,
    shiftKey,
    defaultPrevented: false,
    preventDefault() { event.defaultPrevented = true; },
    stopPropagation() { /* the other listeners on document still run */ },
    stopImmediatePropagation() { immediate = true; },
  };
  // At the target, capture listeners run before the others, each in the order added.
  const snapshot = [...listeners.filter((l) => l.capture), ...listeners.filter((l) => !l.capture)];
  for (const entry of snapshot) {
    if (immediate) break;
    if (!listeners.includes(entry)) continue;
    entry.fn(event);
  }
  return event;
}

registerSurfaceHooks();
const { useModalFocus } = await import('@/components/ui/Dialog');

/** One modal: the hook, as the Dialog and the Sheet call it, with a fake panel. Renders nothing. */
function Modal({ panel, onEscape }: { panel: FakeElement; onEscape: () => void }) {
  useModalFocus(true, { current: panel as unknown as HTMLElement }, onEscape);
  return null;
}

interface Layer { name: string; panel: FakeElement; surface: Surface; first: FakeElement; middle: FakeElement; last: FakeElement }

const escaped: string[] = [];

/** Open a modal (mount it, so its effect runs) whose panel holds three focusable controls. */
async function open(name: string, extra: FakeElement[] = []): Promise<Layer> {
  const first = new FakeElement(`${name}:first`, true);
  const middle = new FakeElement(`${name}:middle`, true);
  const last = new FakeElement(`${name}:last`, true);
  const panel = new FakeElement(`${name}:panel`).add(first, ...extra, middle, last);
  const surface = await mount(h(Modal, { panel, onEscape: () => escaped.push(name) }));
  return { name, panel, surface, first, middle, last };
}

/** Close a modal as its caller does after `onEscape`: unmount it, so its cleanup runs. */
const close = (layer: Layer) => layer.surface.unmount();

function reset(): FakeElement {
  listeners = [];
  escaped.length = 0;
  focusLog.length = 0;
  const opener = new FakeElement('page:opener', true);
  body.kids = [];
  body.add(opener);
  opener.focus();
  focusLog.length = 0;
  return opener;
}

/** A Sheet open on the page, with a link inside it, and a Dialog opened from that link. */
async function sheetThenDialog() {
  const pageOpener = reset();
  const link = new FakeElement('sheet:link', true);
  const sheet = await open('sheet', [link]);
  assert.equal(fakeDocument.activeElement, sheet.first, 'premise: opening the sheet focuses its first control');
  link.focus();
  const dialog = await open('dialog');
  assert.equal(fakeDocument.activeElement, dialog.first, 'premise: opening the dialog focuses its first control');
  focusLog.length = 0;
  return { pageOpener, link, sheet, dialog };
}

// --- The fake's own decoys: it dispatches as the DOM does --------------------------------

test('premise: the fake document runs every listener on its target; stopPropagation does not stop the next one', () => {
  reset();
  const seen: string[] = [];
  const a: Listener = (e) => { seen.push('a'); e.stopPropagation(); };
  const b: Listener = () => seen.push('b');
  fakeDocument.addEventListener('keydown', a);
  fakeDocument.addEventListener('keydown', b);
  press('Escape');
  assert.deepEqual(seen, ['a', 'b'], 'stopPropagation stopped a listener on the same target');
  seen.length = 0;
  const c: Listener = (e) => { seen.push('c'); e.stopImmediatePropagation(); };
  listeners = [];
  fakeDocument.addEventListener('keydown', c);
  fakeDocument.addEventListener('keydown', b);
  press('Escape');
  assert.deepEqual(seen, ['c'], 'stopImmediatePropagation did not stop the next listener');
  listeners = [];
});

// --- One modal: unchanged -----------------------------------------------------------------

test('one modal: Escape calls its onEscape once, and closing returns focus to its opener', async () => {
  const opener = reset();
  const only = await open('only');
  assert.equal(fakeDocument.activeElement, only.first, 'opening focuses the first control');
  press('Escape');
  assert.deepEqual(escaped, ['only'], 'Escape did not call onEscape exactly once');
  close(only);
  assert.equal(fakeDocument.activeElement, opener, 'closing did not return focus to the opener');
  assert.equal(listeners.length, 0, 'closing left a keydown listener on document');
});

test('one modal: the trap, Tab from the last goes to the first and Shift+Tab from the first goes to the last', async () => {
  reset();
  const only = await open('only');
  only.last.focus();
  const tab = press('Tab');
  assert.ok(tab.defaultPrevented && fakeDocument.activeElement === only.first, 'Tab from the last did not wrap to the first');
  const back = press('Tab', true);
  assert.ok(back.defaultPrevented && fakeDocument.activeElement === only.last, 'Shift+Tab from the first did not wrap to the last');
  only.middle.focus();
  const mid = press('Tab');
  assert.ok(!mid.defaultPrevented && fakeDocument.activeElement === only.middle, 'Tab from the middle was trapped');
  close(only);
});

// --- Two modals: only the top one answers -------------------------------------------------

test('UX-2 P4b two modals: one Escape closes only the top modal; a second closes the next', async () => {
  const { pageOpener, link, sheet, dialog } = await sheetThenDialog();
  press('Escape');
  assert.deepEqual(escaped, ['dialog'], `one Escape closed ${JSON.stringify(escaped)}, not only the dialog`);
  close(dialog);
  assert.equal(fakeDocument.activeElement, link, 'closing the dialog did not return focus to its opener inside the sheet');
  press('Escape');
  assert.deepEqual(escaped, ['dialog', 'sheet'], `the second Escape closed ${JSON.stringify(escaped.slice(1))}, not the sheet`);
  close(sheet);
  assert.equal(fakeDocument.activeElement, pageOpener, 'closing the sheet did not return focus to its opener');
});

test('UX-2 P4b two modals: Tab from the top modal\'s last control goes to its own first, and focus never lands in the sheet', async () => {
  const { sheet, dialog } = await sheetThenDialog();
  dialog.last.focus();
  focusLog.length = 0;
  press('Tab');
  assert.equal(fakeDocument.activeElement, dialog.first, 'Tab from the dialog\'s last did not end on its first');
  assert.deepEqual(focusLog.filter((n) => n.startsWith('sheet:')), [], `Tab moved focus into the sheet on the way: ${focusLog.join(' → ')}`);
  close(dialog);
  close(sheet);
});

test('UX-2 P4b two modals: Shift+Tab from the top modal\'s first control goes to its own last, and focus never lands in the sheet', async () => {
  const { sheet, dialog } = await sheetThenDialog();
  dialog.first.focus();
  focusLog.length = 0;
  press('Tab', true);
  assert.equal(fakeDocument.activeElement, dialog.last, 'Shift+Tab from the dialog\'s first did not end on its last');
  assert.deepEqual(focusLog.filter((n) => n.startsWith('sheet:')), [], `Shift+Tab moved focus into the sheet on the way: ${focusLog.join(' → ')}`);
  close(dialog);
  close(sheet);
});

test('UX-2 P4b two modals: Tab from the middle of the top modal is not trapped', async () => {
  const { sheet, dialog } = await sheetThenDialog();
  dialog.middle.focus();
  focusLog.length = 0;
  const event = press('Tab');
  assert.ok(!event.defaultPrevented, `Tab from the dialog's middle was prevented, so focus does not move on; it went ${focusLog.join(' → ')}`);
  assert.equal(fakeDocument.activeElement, dialog.middle, `Tab from the dialog's middle moved focus to ${(fakeDocument.activeElement as FakeElement).name}`);
  close(dialog);
  close(sheet);
});

test('two modals, decoy for the stack: closing the top by its own control (no Escape) returns focus layer by layer', async () => {
  const { pageOpener, link, sheet, dialog } = await sheetThenDialog();
  close(dialog);
  assert.equal(fakeDocument.activeElement, link, 'closing the dialog did not return focus to its opener inside the sheet');
  press('Escape');
  assert.deepEqual(escaped, ['sheet'], `with only the sheet left, Escape closed ${JSON.stringify(escaped)}`);
  close(sheet);
  assert.equal(fakeDocument.activeElement, pageOpener, 'closing the sheet did not return focus to its opener');
  assert.equal(listeners.length, 0, 'closing both left a keydown listener on document');
});
