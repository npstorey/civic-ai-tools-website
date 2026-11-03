// UX-1 P1 (anchor #719, part 2, "P1: the Publish dialog"): the Publish dialog
// on P0's `Dialog`. Its regions, its accessible name, its ruled words, and the
// sentences and request it must keep.
//
// WHAT IS DRIVEN. The real dialog (`PublishEvidenceDialog.tsx`), mounted,
// clicked and typed into through `publish-dialog-test-harness.ts`; its markup
// is React's own (`react-dom/server`). Its three requests are answered here,
// per case: `signing-status` (signing configured or not; seal-only on or off),
// `generate-summary`, and `/api/records` (a sealed or a public result, held
// open when a case reads the publishing state).
//
// HOW A RELATION IS READ. As P0's fixture tests read them
// (`ui/ui-test-helpers.ts`): no HTML parser is installed (F13), so a parent, a
// descendant or a section is read from the rendered element tree by object
// identity, never by matching markup text. The tree is the harness's `tree()`:
// host elements (`div`, `button`, `details`, ...) are walked through
// `props.children`, and an element that is not a host element (a fragment) is
// transparent, its children taken as its parent's. P0's own readers skip a
// fragment's children, and this dialog's tree carries fragments, so the walk
// is restated here. A function component the harness did not render
// contributes only the children it was handed, so a region only a component
// draws (the footer) is absent and an assertion on it fails rather than passes.
// An attribute is read from the element's own opening tag as `react-dom/server`
// writes it. Whether an element scrolls is read from its inline style and, for
// each of its classes, from that class's declarations in globals.css
// (`cssRules`, P0's reader).
//
// WHAT IS ASSERTED.
//   C1. The primary action is inside `[data-part="footer"]` and not inside
//       `[data-part="body"]`; the body is the only element that scrolls; the
//       footer carries Cancel, which closes the dialog and sends nothing; on an
//       unsigned instance the footer's line is the unsigned explanation (the
//       disabled reason), byte for byte.
//   C2. `role="dialog"` (with `aria-modal`), and `aria-labelledby` naming the
//       heading's id.
//   C3. The ruled words where the contract's tables put them: the heading
//       "Publish"; W1 "Question text"; W2 "Include full text"; W3 on the "Hash
//       only" option while "Include full text" is selected; W4 "What the other
//       choice does", a closed disclosure in each section holding the
//       unselected option's full ruled description, while the selected option
//       shows its own; W5 the footer's line for each visibility; W15 "Back to
//       your answer", which only closes the dialog; and "analysis" in the
//       publishing and public success states.
//   C4. (no-change guard) Every ruled sentence is in the markup, byte for
//       byte, under seal-only off and on, each visibility and each question
//       choice, and on an unsigned instance and in the public success state
//       where it renders there.
//   C6. (no-change guard) The publish request body carries the same keys, and
//       the visibility is sent explicitly.
//
// RED ON THE BASE d691a7f (the merge of P0): C1, C2 and C3 fail at their
// assertions; C4 and C6 pass there and must keep passing.
//
// BLIND SPOTS, stated. No layout: whether the action is visible without
// scrolling at a given viewport is criterion 7, on staging. No focus, Escape
// or backdrop events (non-goals here; staging). Under seal-only on, whether the
// Visibility section carries a disclosure is not asserted: the public choice
// is unavailable and its reason stands on the option itself.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/publish-dialog-shape.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Element, MountedDialog } from './publish-dialog-test-harness.ts';
import { cssRules } from './ui/ui-test-helpers.ts';
import { sealedStateCopy, SEAL_ONLY_UI_REASON } from '../lib/evidence/seal-only.ts';

interface ResolveResult { url: string; format?: string | null; shortCircuit?: boolean }
interface LoadResult { format: string; source?: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context?: unknown) => ResolveResult;
type NextLoad = (url: string, context?: unknown) => LoadResult;
// Typed here because the installed `@types/node` predates `registerHooks`.
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`UX-1 P1 dialog test hook: cannot resolve ${specifier}`);
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && !path.extname(specifier) && parent?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      const json = fs.readFileSync(fileURLToPath(loadUrl), 'utf8');
      return { format: 'module', source: `export default ${json};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

const { mountPublishDialog, fire } = await import('./publish-dialog-test-harness.ts');

// --- The words ----------------------------------------------------------------------

// Ruled 2026-11-03 (the contract's tables).
const HEADING = 'Publish';
const W1_SECTION = 'Question text';
const W2_FULL_TEXT = 'Include full text';
const W3_HASH_SHORT = 'Keeps a fingerprint of the question, not its words.';
const W4_OTHER = 'What the other choice does';
const W5_SEALED = 'Private to you; signed and registered';
const W5_PUBLIC = 'Public and listed; not reversible';
const W15_BACK = 'Back to your answer';
const CANCEL = 'Cancel';
const PUBLISHING = 'Packaging and storing the analysis...';
const PUBLIC_LIVE = 'Your analysis page is live.';
const VIEW_PAGE = 'View your analysis page →';

// The words they replace.
const OLD = ['Publish as Record', 'Prompt visibility', 'Include full prompt text', 'Keep chatting',
  'Packaging and storing the record...', 'Your record page is live.', 'View your record page →'];

// Kept verbatim (criterion 4; `PublishEvidenceDialog.tsx` at the base).
const HASH_ONLY = 'Hash only';
const FULL_TEXT_WORDS = 'Anyone can see exactly what you asked';
const HASH_ONLY_WORDS =
  'The record keeps a fingerprint of your question instead of its text. Anyone who knows or guesses the exact ' +
  'wording can confirm it matches. The answer, summary and data queries may still contain its words.';
const SEAL_CHOICE = 'Seal (default)';
const PUBLIC_CHOICE = 'Publish now';
const PUBLIC_WORDS = 'Content becomes public and listed in the registry immediately. Publication is not reversible.';
const TITLE_NOTE = 'The title is public and becomes the record’s address.';
const UNSIGNED_WORDS =
  'This instance is running unsigned. Signing is not configured, so records cannot be sealed or published — ' +
  'an unsigned package can reach neither the sealed nor the public state. The analysis itself still works; an ' +
  'operator enables signing via the instance setup guide.';
const UNSIGNED_ACTION = 'Unavailable (running unsigned)';
const SIGNED_LINE = 'The record is signed, timestamped, and registered on the public transparency log.';

// --- The dialog's requests, answered here ---------------------------------------------

interface Setup {
  signingConfigured: boolean;
  sealOnly: boolean;
  resultVisibility: 'sealed' | 'public';
  holdPublish: boolean;
}

let SETUP: Setup = { signingConfigured: true, sealOnly: false, resultVisibility: 'sealed', holdPublish: false };
let REQUESTS: Array<{ url: string; body: Record<string, unknown> }> = [];
let releasePublish: (() => void) | null = null;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  REQUESTS.push({ url, body });
  if (url === '/api/records/signing-status') {
    return Response.json({ signingConfigured: SETUP.signingConfigured, sealOnly: SETUP.sealOnly });
  }
  if (url === '/api/records/generate-summary') return Response.json({ summary: 'A fixture summary.' });
  if (url === '/api/records') {
    const reply = () => Response.json({
      slug: 'fixture-p1',
      ...(SETUP.resultVisibility === 'public' ? { url: '/records/fixture-p1' } : {}),
      visibility: SETUP.resultVisibility,
      packageHash: 'f'.repeat(64),
    });
    if (!SETUP.holdPublish) return reply();
    return new Promise<Response>((resolve) => { releasePublish = () => resolve(reply()); });
  }
  throw new TypeError(`the dialog asked for ${url}, which this test does not answer`);
}) as typeof fetch;

const PROPS = {
  queryText: 'How many noise reports were logged near the fixture park?',
  output: 'Nine reports were recorded.\n\nOne request returned the figure.',
  toolCalls: [{ name: 'socrata__get_data', args: { portal: 'data.example.org', dataset_id: 'erm2-nwe9', query: 'SELECT count(*)' } }],
  evidenceTrace: { resourceSpans: [] },
  model: 'fixture-fast',
  portal: 'data.example.org',
  promptTokens: 11,
  completionTokens: 7,
  duration_ms: 1234,
};

async function open(setup: Partial<Setup> = {}): Promise<{ dialog: MountedDialog; closed: () => number }> {
  SETUP = { signingConfigured: true, sealOnly: false, resultVisibility: 'sealed', holdPublish: false, ...setup };
  REQUESTS = [];
  releasePublish = null;
  let closed = 0;
  const dialog = await mountPublishDialog({ ...PROPS, onClose: () => { closed += 1; } });
  await dialog.settle();
  return { dialog, closed: () => closed };
}

// --- Reading the tree -------------------------------------------------------------------

function isElement(node: unknown): node is Element {
  return node !== null && typeof node === 'object' && !Array.isArray(node) && 'props' in (node as object);
}

/** The host elements a node renders as children, in order; a non-host element is transparent. */
function hostsOf(node: unknown): Element[] {
  const out: Element[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) {
      for (const child of n) walk(child);
      return;
    }
    if (!isElement(n)) return;
    if (typeof n.type === 'string') out.push(n);
    else walk(n.props.children);
  };
  walk(node);
  return out;
}

const childrenOf = (el: Element): Element[] => hostsOf(el.props.children);

/** Every host element under `el` (not `el` itself), in document order. */
function within(el: Element): Element[] {
  const out: Element[] = [];
  for (const child of childrenOf(el)) out.push(child, ...within(child));
  return out;
}

/** Every host element of the last render, in document order. */
function hosts(dialog: MountedDialog): Element[] {
  return hostsOf(dialog.tree()).flatMap((root) => [root, ...within(root)]);
}

/** The host elements enclosing `target`, nearest first. */
function ancestorsOf(dialog: MountedDialog, target: Element): Element[] {
  const parent = new Map<Element, Element>();
  for (const el of hosts(dialog)) for (const child of childrenOf(el)) parent.set(child, el);
  const out: Element[] = [];
  for (let at = parent.get(target); at; at = parent.get(at)) out.push(at);
  return out;
}

/** The element's opening tag as `react-dom/server` writes it. */
function openingTag(el: Element): string {
  const match = /^<[^>]*>/.exec(renderToStaticMarkup(el));
  assert.ok(match, `no opening tag in the markup of a <${String(el.type)}>`);
  return match[0];
}

/** An attribute's value as rendered: `null` when absent, `''` when bare. */
function attr(el: Element, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\s${escaped}(?:="([^"]*)")?(?=[\\s/>])`).exec(openingTag(el));
  if (!match) return null;
  return match[1] ?? '';
}

const classesOf = (el: Element): string[] => (attr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
const hasClass = (el: Element, name: string): boolean => classesOf(el).includes(name);

const decode = (value: string) => value
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

/** What a reader reads of a markup string: comments and tags removed, entities decoded, spaces collapsed. */
const readable = (markup: string): string =>
  decode(markup.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const textIn = (el: Element): string => readable(renderToStaticMarkup(el));
const dialogText = (dialog: MountedDialog): string => readable(dialog.markup());

function one(found: Element[], what: string): Element {
  assert.equal(found.length, 1, `expected exactly one ${what}, found ${found.length}`);
  return found[0];
}

const tagOf = (el: Element) => `<${String(el.type)} class="${classesOf(el).join(' ')}">`;

const overflowByClass = new Map<string, boolean>();
/** True when the element scrolls: an inline `overflow` of auto or scroll, or a class declaring one. */
function scrolls(el: Element): boolean {
  const style = (el.props.style ?? {}) as Record<string, unknown>;
  if (['overflow', 'overflowY'].some((key) => /^(auto|scroll)$/.test(String(style[key] ?? '')))) return true;
  return classesOf(el).some((name) => {
    if (!overflowByClass.has(name)) {
      overflowByClass.set(name, /overflow(-y)?\s*:\s*(auto|scroll)/.test(cssRules(`.${name}`).join(';')));
    }
    return overflowByClass.get(name) === true;
  });
}

function buttonReading(dialog: MountedDialog, label: string): Element {
  return one(hosts(dialog).filter((el) => el.type === 'button' && textIn(el) === label), `button reading "${label}"`);
}

function regions(dialog: MountedDialog): { all: Element[]; body: Element; footer: Element } {
  const all = hosts(dialog);
  const body = one(all.filter((el) => attr(el, 'data-part') === 'body'), 'element with data-part="body"');
  const footer = one(all.filter((el) => attr(el, 'data-part') === 'footer'), 'element with data-part="footer"');
  return { all, body, footer };
}

function radios(dialog: MountedDialog, name: string): Element[] {
  return hosts(dialog).filter((el) => el.type === 'input' && attr(el, 'type') === 'radio' && attr(el, 'name') === name);
}

/** The option (the nearest enclosing `<label>`) of the radio named `name` whose option text starts with `label`. */
function option(dialog: MountedDialog, name: string, label: string): { radio: Element; option: Element } {
  const found = radios(dialog, name).flatMap((radio) => {
    const enclosing = ancestorsOf(dialog, radio).find((el) => el.type === 'label');
    return enclosing && textIn(enclosing).startsWith(label) ? [{ radio, option: enclosing }] : [];
  });
  assert.equal(found.length, 1, `expected exactly one ${name} option reading "${label}…", found ${found.length}`);
  return found[0];
}

/** The section: the nearest element enclosing the element reading exactly `heading` and both radios named `name`. */
function section(dialog: MountedDialog, heading: string, name: string): Element {
  const named = hosts(dialog).filter((el) => textIn(el) === heading);
  assert.ok(named.length >= 1, `no element reads exactly "${heading}"`);
  const both = radios(dialog, name);
  assert.equal(both.length, 2, `expected two radios named ${name}, found ${both.length}`);
  const enclosing = ancestorsOf(dialog, named[0]).find((el) => both.every((radio) => within(el).includes(radio)));
  assert.ok(enclosing, `no element encloses "${heading}" and the ${name} radios`);
  return enclosing;
}

/** The one `ui-disclosure` in `container` whose summary reads W4. */
function otherChoice(container: Element, where: string): Element {
  return one(within(container).filter((el) => el.type === 'details' && hasClass(el, 'ui-disclosure')
    && childrenOf(el).some((child) => child.type === 'summary' && textIn(child) === W4_OTHER)),
  `${where}: ui-disclosure reading "${W4_OTHER}"`);
}

async function choose(dialog: MountedDialog, name: string, label: string): Promise<void> {
  fire(option(dialog, name, label).radio, 'onChange');
  await dialog.settle();
}

const includes = (haystack: string, needle: string, message: string) =>
  assert.ok(haystack.includes(needle), `${message}\n  wanted: ${needle}\n  in:     ${haystack}`);
const excludes = (haystack: string, needle: string, message: string) =>
  assert.ok(!haystack.includes(needle), `${message}\n  found:  ${needle}\n  in:     ${haystack}`);

// --- C1. The regions ------------------------------------------------------------------------

test('UX-1 P1 C1: the primary action sits in the footer, outside the body, and the body is the only element that scrolls', async () => {
  const cases: Array<{ what: string; setup: Partial<Setup>; publicChosen: boolean; action: string }> = [
    { what: 'sealed', setup: {}, publicChosen: false, action: 'Seal' },
    { what: 'public', setup: {}, publicChosen: true, action: 'Publish' },
    { what: 'seal-only', setup: { sealOnly: true }, publicChosen: false, action: 'Seal' },
    { what: 'unsigned', setup: { signingConfigured: false }, publicChosen: false, action: UNSIGNED_ACTION },
  ];
  for (const { what, setup, publicChosen, action } of cases) {
    const { dialog } = await open(setup);
    if (publicChosen) await choose(dialog, 'visibility', PUBLIC_CHOICE);
    const { all, body, footer } = regions(dialog);
    const button = buttonReading(dialog, action);
    assert.ok(within(footer).includes(button), `${what}: the "${action}" action is not inside the footer`);
    assert.ok(!within(body).includes(button), `${what}: the "${action}" action is inside the body`);
    assert.ok(!within(body).includes(footer), `${what}: the footer is inside the body`);
    assert.ok(within(footer).includes(buttonReading(dialog, CANCEL)), `${what}: the footer carries no "${CANCEL}"`);
    const scrolling = all.filter(scrolls);
    assert.ok(scrolling.length === 1 && scrolling[0] === body,
      `${what}: the body must be the only element that scrolls; these do: ${scrolling.map(tagOf).join(', ')}`);
    assert.ok(all.some((el) => hasClass(el, 'ui-dialog--form')), `${what}: the dialog is not P0's Dialog at size form`);
  }
});

test('UX-1 P1 C1: Cancel closes the dialog and sends nothing', async () => {
  const { dialog, closed } = await open();
  const before = REQUESTS.length;
  fire(buttonReading(dialog, CANCEL), 'onClick');
  await dialog.settle();
  assert.equal(closed(), 1, 'Cancel did not close the dialog');
  assert.equal(REQUESTS.length, before, `Cancel sent: ${REQUESTS.slice(before).map((r) => r.url).join(', ')}`);
});

test('UX-1 P1 C1: on an unsigned instance the action is disabled and the footer line is the unsigned explanation, byte for byte', async () => {
  for (const sealOnly of [false, true]) {
    const { dialog } = await open({ signingConfigured: false, sealOnly });
    const { body, footer } = regions(dialog);
    const line = one(within(footer).filter((el) => hasClass(el, 'ui-dialog-footer-line')), 'ui-dialog-footer-line in the footer');
    assert.equal(textIn(line), UNSIGNED_WORDS, `seal-only ${sealOnly}: the footer line is not the unsigned explanation`);
    excludes(textIn(body), UNSIGNED_WORDS, `seal-only ${sealOnly}: the unsigned explanation is still a body block`);
    assert.equal(attr(buttonReading(dialog, UNSIGNED_ACTION), 'disabled'), '', `seal-only ${sealOnly}: the action is not disabled`);
  }
});

// --- C2. The accessible name ----------------------------------------------------------------

test('UX-1 P1 C2: role="dialog" with aria-modal, and aria-labelledby naming the heading', async () => {
  const { dialog } = await open();
  const all = hosts(dialog);
  const box = one(all.filter((el) => attr(el, 'role') === 'dialog'), 'element with role="dialog"');
  assert.equal(attr(box, 'aria-modal'), 'true', 'the dialog does not carry aria-modal="true"');
  const id = attr(box, 'aria-labelledby');
  assert.ok(id, 'the dialog carries no aria-labelledby');
  const heading = one(all.filter((el) => attr(el, 'id') === id), `element with id="${id}"`);
  assert.equal(heading.type, 'h2', `aria-labelledby names a <${String(heading.type)}>, not the heading`);
  assert.ok(within(box).includes(heading), 'the heading is not inside the dialog');
});

// --- C3. The words --------------------------------------------------------------------------

test('UX-1 P1 C3: the heading reads "Publish", and no replaced word renders in the form', async () => {
  const { dialog } = await open();
  const heading = one(hosts(dialog).filter((el) => el.type === 'h2'), 'h2');
  assert.equal(textIn(heading), HEADING);
  const text = dialogText(dialog);
  for (const word of OLD) excludes(text, word, 'a replaced word still renders');
});

test('UX-1 P1 C3 W1, W2: the section reads "Question text" and its first choice "Include full text"', async () => {
  const { dialog } = await open();
  const question = section(dialog, W1_SECTION, 'promptVisibility');
  const full = option(dialog, 'promptVisibility', W2_FULL_TEXT);
  const hash = option(dialog, 'promptVisibility', HASH_ONLY);
  assert.ok(within(question).includes(full.option) && within(question).includes(hash.option), 'the options are not in the "Question text" section');
  assert.ok(radios(dialog, 'visibility').every((radio) => !within(question).includes(radio)), 'the "Question text" section holds the visibility radios');
});

test('UX-1 P1 C3 W3, W4: Question text: the selected option shows its description; the other\'s is behind "What the other choice does"', async () => {
  for (const selected of ['full_text', 'hash_only'] as const) {
    const { dialog } = await open();
    if (selected === 'hash_only') await choose(dialog, 'promptVisibility', HASH_ONLY);
    const where = `${selected} selected`;
    const question = section(dialog, W1_SECTION, 'promptVisibility');
    const full = textIn(option(dialog, 'promptVisibility', W2_FULL_TEXT).option);
    const hash = textIn(option(dialog, 'promptVisibility', HASH_ONLY).option);
    const other = otherChoice(question, `${where}, Question text`);
    assert.equal(attr(other, 'open'), null, `${where}: the disclosure starts open`);
    if (selected === 'full_text') {
      includes(full, FULL_TEXT_WORDS, `${where}: the full-text option does not show its description`);
      includes(hash, W3_HASH_SHORT, `${where}: the hash-only option does not show its short line`);
      excludes(hash, HASH_ONLY_WORDS, `${where}: the hash-only option still shows its full description`);
      includes(textIn(other), HASH_ONLY_WORDS, `${where}: the disclosure does not hold the hash-only description`);
    } else {
      includes(hash, HASH_ONLY_WORDS, `${where}: the hash-only option does not show its description`);
      excludes(hash, W3_HASH_SHORT, `${where}: the hash-only option still shows its short line`);
      excludes(full, FULL_TEXT_WORDS, `${where}: the full-text option still shows its description`);
      includes(textIn(other), FULL_TEXT_WORDS, `${where}: the disclosure does not hold the full-text description`);
    }
  }
});

test('UX-1 P1 C3 W4: Visibility: the selected option shows its description; the other\'s is behind "What the other choice does"', async () => {
  const sealWords = sealedStateCopy(false).sealChoice;
  for (const selected of ['sealed', 'public'] as const) {
    const { dialog } = await open();
    if (selected === 'public') await choose(dialog, 'visibility', PUBLIC_CHOICE);
    const where = `${selected} selected`;
    const visibility = section(dialog, 'Visibility', 'visibility');
    const seal = textIn(option(dialog, 'visibility', SEAL_CHOICE).option);
    const pub = textIn(option(dialog, 'visibility', PUBLIC_CHOICE).option);
    const other = otherChoice(visibility, `${where}, Visibility`);
    assert.equal(attr(other, 'open'), null, `${where}: the disclosure starts open`);
    if (selected === 'sealed') {
      includes(seal, sealWords, `${where}: the Seal option does not show its description`);
      excludes(pub, PUBLIC_WORDS, `${where}: the public option still shows its description`);
      includes(textIn(other), PUBLIC_WORDS, `${where}: the disclosure does not hold the public description`);
    } else {
      includes(pub, PUBLIC_WORDS, `${where}: the public option does not show its description`);
      excludes(seal, sealWords, `${where}: the Seal option still shows its description`);
      includes(textIn(other), sealWords, `${where}: the disclosure does not hold the Seal description`);
    }
  }
});

test('UX-1 P1 C3 W5: the footer\'s line is the selected visibility\'s consequence', async () => {
  const cases: Array<{ what: string; setup: Partial<Setup>; publicChosen: boolean; line: string }> = [
    { what: 'sealed', setup: {}, publicChosen: false, line: W5_SEALED },
    { what: 'public', setup: {}, publicChosen: true, line: W5_PUBLIC },
    { what: 'seal-only', setup: { sealOnly: true }, publicChosen: false, line: W5_SEALED },
    { what: 'seal-only, the public radio fired', setup: { sealOnly: true }, publicChosen: true, line: W5_SEALED },
  ];
  for (const { what, setup, publicChosen, line } of cases) {
    const { dialog } = await open(setup);
    if (publicChosen) await choose(dialog, 'visibility', PUBLIC_CHOICE);
    const { footer } = regions(dialog);
    const el = one(within(footer).filter((e) => hasClass(e, 'ui-dialog-footer-line')), `${what}: ui-dialog-footer-line in the footer`);
    assert.equal(textIn(el), line, `${what}: the footer line`);
  }
});

/** A public publish, read while the request is held open and again after its reply. */
async function publishPublic(): Promise<{ dialog: MountedDialog; closed: () => number; publishing: string; success: string }> {
  const { dialog, closed } = await open({ resultVisibility: 'public', holdPublish: true });
  await choose(dialog, 'visibility', PUBLIC_CHOICE);
  void fire(buttonReading(dialog, 'Publish'), 'onClick');
  await dialog.settle();
  const publishing = dialogText(dialog);
  assert.ok(releasePublish, 'premise: the publish request was sent and held');
  releasePublish!();
  await dialog.settle();
  return { dialog, closed, publishing, success: dialogText(dialog) };
}

test('UX-1 P1 C3 noun: the publishing and public success states say "analysis"', async () => {
  const { dialog, publishing, success } = await publishPublic();
  const misses: string[] = [];
  if (!publishing.includes(PUBLISHING)) misses.push(`publishing: no "${PUBLISHING}"`);
  if (publishing.includes('Packaging and storing the record...')) misses.push('publishing: "Packaging and storing the record..." still renders');
  if (!success.includes(PUBLIC_LIVE)) misses.push(`success: no "${PUBLIC_LIVE}"`);
  if (success.includes('Your record page is live.')) misses.push('success: "Your record page is live." still renders');
  const view = hosts(dialog).filter((el) => el.type === 'button' && textIn(el) === VIEW_PAGE);
  if (view.length !== 1) misses.push(`success: ${view.length} buttons read "${VIEW_PAGE}"`);
  if (success.includes('View your record page →')) misses.push('success: "View your record page →" still renders');
  assert.deepEqual(misses, [], `the noun, as ruled:\n  ${misses.join('\n  ')}`);
});

test('UX-1 P1 C3 W15: the public success state\'s button reads "Back to your answer", and it only closes the dialog', async () => {
  const { dialog, closed, success } = await publishPublic();
  excludes(success, 'Keep chatting', 'the public success state still carries the replaced word');
  const back = buttonReading(dialog, W15_BACK);
  const before = REQUESTS.length;
  fire(back, 'onClick');
  await dialog.settle();
  assert.equal(closed(), 1, `"${W15_BACK}" did not close the dialog`);
  assert.deepEqual(dialog.pushed(), [], `"${W15_BACK}" navigated`);
  assert.equal(REQUESTS.length, before, `"${W15_BACK}" sent: ${REQUESTS.slice(before).map((r) => r.url).join(', ')}`);
});

// --- C4. The ruled sentences (no-change guard) ------------------------------------------------

test('UX-1 P1 C4 (guard): every ruled sentence renders byte for byte under seal-only off and on, each visibility and each question choice', async () => {
  for (const sealOnly of [false, true]) {
    for (const visibility of ['sealed', 'public'] as const) {
      for (const question of ['full_text', 'hash_only'] as const) {
        const { dialog } = await open({ sealOnly });
        if (visibility === 'public') await choose(dialog, 'visibility', PUBLIC_CHOICE);
        if (question === 'hash_only') await choose(dialog, 'promptVisibility', HASH_ONLY);
        const where = `seal-only ${sealOnly}, ${visibility} chosen, ${question}`;
        const text = dialogText(dialog);
        const ruled = [
          TITLE_NOTE,
          HASH_ONLY_WORDS,
          FULL_TEXT_WORDS,
          sealedStateCopy(sealOnly).sealChoice,
          sealOnly ? SEAL_ONLY_UI_REASON : PUBLIC_WORDS,
        ];
        for (const sentence of ruled) includes(text, sentence, `${where}: a ruled sentence is missing`);
      }
    }
  }
  for (const sealOnly of [false, true]) {
    const { dialog } = await open({ signingConfigured: false, sealOnly });
    includes(dialogText(dialog), UNSIGNED_WORDS, `unsigned, seal-only ${sealOnly}: the unsigned explanation is missing`);
  }
  const { dialog } = await open({ resultVisibility: 'public' });
  await choose(dialog, 'visibility', PUBLIC_CHOICE);
  fire(buttonReading(dialog, 'Publish'), 'onClick');
  await dialog.settle();
  includes(dialogText(dialog), SIGNED_LINE, 'the public success state: the signed line is missing');
});

// --- C6. The request (no-change guard) ------------------------------------------------------------

// The keys `PublishEvidenceDialog.tsx` sends at the base (`body: JSON.stringify({ ... })`).
const BODY_KEYS = ['captureMethod', 'contentProfile', 'duration_ms', 'extensions', 'model', 'output', 'portal', 'prompt',
  'promptVisibility', 'summary', 'title', 'tokenUsage', 'toolCalls', 'trace', 'visibility'];

test('UX-1 P1 C6 (guard): the publish request carries the same keys, and the visibility is sent explicitly', async () => {
  const cases: Array<{ what: string; setup: Partial<Setup>; publicChosen: boolean; hashOnly: boolean; action: string; visibility: string }> = [
    { what: 'default', setup: {}, publicChosen: false, hashOnly: false, action: 'Seal', visibility: 'sealed' },
    { what: 'public chosen', setup: {}, publicChosen: true, hashOnly: false, action: 'Publish', visibility: 'public' },
    { what: 'seal-only, the public radio fired', setup: { sealOnly: true }, publicChosen: true, hashOnly: false, action: 'Seal', visibility: 'sealed' },
    { what: 'hash only', setup: {}, publicChosen: false, hashOnly: true, action: 'Seal', visibility: 'sealed' },
  ];
  for (const { what, setup, publicChosen, hashOnly, action, visibility } of cases) {
    const { dialog } = await open(setup);
    if (publicChosen) await choose(dialog, 'visibility', PUBLIC_CHOICE);
    if (hashOnly) await choose(dialog, 'promptVisibility', HASH_ONLY);
    fire(buttonReading(dialog, action), 'onClick');
    await dialog.settle();
    const sent = REQUESTS.filter((r) => r.url === '/api/records');
    assert.equal(sent.length, 1, `${what}: expected one publish request, found ${sent.length}`);
    const body = sent[0].body;
    assert.deepEqual(Object.keys(body).sort(), BODY_KEYS, `${what}: the body's keys`);
    assert.equal(body.visibility, visibility, `${what}: the visibility sent`);
    assert.equal(body.promptVisibility, hashOnly ? 'hash_only' : 'full_text', `${what}: the question visibility sent`);
    assert.equal(body.contentProfile, hashOnly ? 'default' : 'datHere', `${what}: the content profile sent`);
    assert.equal(body.captureMethod, 'chat-flow-stream', `${what}: the capture method sent`);
    assert.deepEqual(body.tokenUsage, { promptTokens: 11, completionTokens: 7 }, `${what}: the token usage sent`);
    assert.equal(body.duration_ms, 1234, `${what}: the duration sent`);
  }
});
