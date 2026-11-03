// Readers shared by the primitive fixture tests in this directory (UX-1 P0). Not
// a test itself (a `.test.ts` name would make the runner execute it as an empty
// suite), and nothing in the app imports it.
//
// HOW A RELATION IS READ. No HTML parser is installed (F13). The primitives are
// mounted on the surface harness (`../sources/surface-test-harness.ts`), whose
// `elements()` is the host tree itself: real React elements of host type
// (`div`, `button`, `details`, ...) with their host children already expanded.
// A parent, a sibling or a descendant is read from that tree by object identity
// (`childrenOf`, `parentOf`, `within`), never by matching markup text.
//
// HOW AN ATTRIBUTE IS READ. From the element's own opening tag as
// `react-dom/server` writes it (`openingTag`), so an assertion reads what a
// browser receives (`aria-expanded="false"`, a bare `open=""`) rather than the
// prop React was handed.
//
// HOW A STYLE IS READ. `cssRules` reads `src/app/globals.css` with comments
// removed and returns the declarations of every innermost block whose selector
// list names the selector given, exactly. It is a reader for the flat rules this
// stylesheet writes, not a CSS parser.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { SRC, type HostElement, type Surface } from '../sources/surface-test-harness.ts';

const GLOBALS_CSS = path.join(SRC, 'app', 'globals.css');

/** The element's opening tag as `react-dom/server` writes it. */
export function openingTag(el: HostElement): string {
  const markup = renderToStaticMarkup(el);
  const match = /^<[^>]*>/.exec(markup);
  assert.ok(match, `no opening tag in the markup of a <${el.type}>`);
  return match[0];
}

/** An attribute's value as rendered: `null` when absent, `''` when bare. */
export function attr(el: HostElement, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\s${escaped}(?:="([^"]*)")?(?=[\\s/>])`).exec(openingTag(el));
  if (!match) return null;
  return match[1] ?? '';
}

/** The rendered `class` attribute, split. */
export function classesOf(el: HostElement): string[] {
  return (attr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
}

export function hasClass(el: HostElement, name: string): boolean {
  return classesOf(el).includes(name);
}

function isHost(node: unknown): node is HostElement {
  return node !== null && typeof node === 'object' && !Array.isArray(node) && 'props' in (node as object)
    && typeof (node as { type?: unknown }).type === 'string';
}

/** The element's direct host children, in order. */
export function childrenOf(el: HostElement): HostElement[] {
  const out: HostElement[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (isHost(node)) out.push(node);
  };
  walk(el.props.children);
  return out;
}

/** Every host element under `el` (not `el` itself), in document order. */
export function within(el: HostElement): HostElement[] {
  const out: HostElement[] = [];
  for (const child of childrenOf(el)) {
    out.push(child, ...within(child));
  }
  return out;
}

/** The host element whose direct children include `target`; `null` at the top. */
export function parentOf(surface: Surface, target: HostElement): HostElement | null {
  return surface.elements().find((el) => childrenOf(el).includes(target)) ?? null;
}

/** Every host element of the last render matching `pred`. */
export function findAll(surface: Surface, pred: (el: HostElement) => boolean): HostElement[] {
  return surface.elements().filter(pred);
}

/** The one element in `found`; an assertion failure naming `what` on none or several. */
export function one(found: HostElement[], what: string): HostElement {
  assert.equal(found.length, 1, `expected exactly one ${what}, found ${found.length}`);
  return found[0];
}

export function byRole(surface: Surface, role: string): HostElement[] {
  return findAll(surface, (el) => attr(el, 'role') === role);
}

export function byPart(surface: Surface, part: string): HostElement[] {
  return findAll(surface, (el) => attr(el, 'data-part') === part);
}

export function byClass(surface: Surface, name: string): HostElement[] {
  return findAll(surface, (el) => hasClass(el, name));
}

export function byTag(surface: Surface, tag: string): HostElement[] {
  return findAll(surface, (el) => el.type === tag);
}

/** What a reader reads of one element's subtree: tags and React's `<!-- -->` removed. */
export function readText(el: HostElement): string {
  return renderToStaticMarkup(el)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The declarations of every innermost block in globals.css whose selector list
 * names `selector` exactly (after whitespace is collapsed). An empty list when
 * no block does.
 */
export function cssRules(selector: string): string[] {
  const css = fs.readFileSync(GLOBALS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const want = selector.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim());
    if (selectors.includes(want)) out.push(match[2]);
  }
  return out;
}

/** Every innermost block whose selector list contains a selector that includes `fragment`. */
export function cssRulesMentioning(fragment: string): { selector: string; body: string }[] {
  const css = fs.readFileSync(GLOBALS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; body: string }[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\s+/g, ' ').trim();
    if (selector.split(',').some((s) => s.includes(fragment))) out.push({ selector, body: match[2] });
  }
  return out;
}
