// The real publish dialog (`PublishEvidenceDialog.tsx`), driven outside a
// browser: rendered, clicked and typed into, and its markup read with the real
// `react-dom/server`. Shared by the tests that drive it; it is not a test
// itself, and nothing in the app imports it.
//
// HOW. This repository has no DOM library, so the dialog's own hooks run on a
// small hook runtime instead of React's: `react` is replaced for the dialog,
// for `EvidenceOriginProvider.tsx` (whose context the dialog reads), and for
// the shared primitives the dialog is built from (`ui/*.tsx`, UX-1 P1), by
// cells kept per component instance and hook call index (`useState`,
// `useRef`, `useId`), effects run after each render when their dependencies
// change (`useEffect`), and a context read that answers with the attribution
// the test supplies. Every other module, the JSX runtime included, is the real
// one, so the tree the dialog returns is a real React element tree. A state
// update re-renders once per microtask, as React batches an event.
// `next/navigation` is replaced for the dialog, which only calls
// `router.push`. The `.tsx` files are compiled by the TypeScript compiler
// already in devDependencies (`transpileModule`), as in
// `notebook/notebook-error-traceback.test.ts`.
//
// THE TREE A TEST READS IS THE HOST TREE. The dialog returns P0's `Dialog`,
// which draws its footer (the primary action, Cancel, the consequence line)
// from props rather than children, so the tree the dialog returns does not
// contain the controls a reader sees. After each render the runtime expands
// it: a function component is called on the runtime (its hooks kept per
// instance, keyed by its place in the tree), a fragment is replaced by its
// children, and a host element (`div`, `button`, ...) is rebuilt around its
// expanded children with its own props, handlers included. `tree()`,
// `elements()` and `markup()` all read that host tree, so `button('Seal')`
// finds the footer's action and a handler fired on it is the dialog's own.
// On a dialog that renders no function component the expansion changes
// nothing a test reads.
//
// WHAT THE CALLER SUPPLIES. The `@/` alias (each test file registers its own
// resolver BEFORE calling `registerPublishDialogHooks`, so these hooks run
// first and hand everything else on), and `globalThis.fetch`: the dialog's
// requests go wherever the test sends them.
//
// BLIND SPOT, stated: effect cleanups are not run and a hook's call order is
// assumed stable across renders, which holds for this dialog (every hook is
// called before its one early return) and for the primitives. Refs are never
// attached to elements, so the primitives' focus behaviour is not exercised. A
// layout or a browser-only behaviour is not exercised here.

import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, Fragment, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
const DIALOG_FILE = path.join(SRC, 'components/PublishEvidenceDialog.tsx');
const ORIGIN_FILE = path.join(SRC, 'components/EvidenceOriginProvider.tsx');
const UI_DIR = path.join(SRC, 'components/ui');
const STUBBED_FOR = new Set([DIALOG_FILE, ORIGIN_FILE]);
/** The modules whose `react` is the runtime's: the dialog, its context, and the primitives it is built from. */
const rendersOnRuntime = (file: string) =>
  STUBBED_FOR.has(file) || (path.dirname(file) === UI_DIR && file.endsWith('.tsx'));
const STUB_PREFIX = 'file:///civic-publish-dialog-harness/';

interface Runtime {
  /** The cells of the component instance rendering now (the dialog's, or a primitive's). */
  cells: Array<Record<string, unknown>>;
  index: number;
  ids: number;
  effects: Array<() => void>;
  schedule: () => void;
  attribution: unknown;
  pushed: string[];
}

interface HarnessGlobal { current: Runtime | null }
const HARNESS: HarnessGlobal = { current: null };
(globalThis as unknown as { __publishDialogHarness: HarnessGlobal }).__publishDialogHarness = HARNESS;

const STUBS: Record<string, string> = {
  react: `
    const H = globalThis.__publishDialogHarness;
    export function useState(initial) {
      const rt = H.current;
      const i = rt.index++;
      if (rt.cells[i] === undefined) rt.cells[i] = { value: typeof initial === 'function' ? initial() : initial };
      const cell = rt.cells[i];
      const set = (update) => {
        const next = typeof update === 'function' ? update(cell.value) : update;
        if (Object.is(next, cell.value)) return;
        cell.value = next;
        rt.schedule();
      };
      return [cell.value, set];
    }
    export function useRef(initial) {
      const rt = H.current;
      const i = rt.index++;
      if (rt.cells[i] === undefined) rt.cells[i] = { current: initial };
      return rt.cells[i];
    }
    export function useId() {
      const rt = H.current;
      const i = rt.index++;
      if (rt.cells[i] === undefined) rt.cells[i] = { value: 'pd' + (rt.ids++) };
      return rt.cells[i].value;
    }
    export function useEffect(effect, deps) {
      const rt = H.current;
      const i = rt.index++;
      const prev = rt.cells[i];
      const same = prev !== undefined && Array.isArray(deps) && Array.isArray(prev.deps)
        && deps.length === prev.deps.length && deps.every((d, k) => Object.is(d, prev.deps[k]));
      if (same) return;
      rt.cells[i] = { deps };
      rt.effects.push(effect);
    }
    export function createContext(defaultValue) { return { defaultValue, Provider: 'context-provider' }; }
    export function useContext(context) {
      const rt = H.current;
      return rt && rt.attribution !== undefined ? rt.attribution : context.defaultValue;
    }`,
  'next/navigation': `
    export function useRouter() {
      const rt = globalThis.__publishDialogHarness.current;
      return { push(url) { rt.pushed.push(url); } };
    }`,
};

let registered = false;

/** Register the hooks; call after the test file's own `@/` resolver. Idempotent. */
export function registerPublishDialogHooks(): void {
  if (registered) return;
  registered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = (context as { parentURL?: string }).parentURL;
      if (parent?.startsWith('file:') && rendersOnRuntime(fileURLToPath(parent)) && specifier in STUBS) {
        return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(loadUrl, context, nextLoad) {
      if (loadUrl.startsWith(STUB_PREFIX)) {
        const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
        return { format: 'module', source: STUBS[key], shortCircuit: true };
      }
      if (loadUrl.startsWith('file:')) {
        const file = fileURLToPath(loadUrl);
        if (file.startsWith(SRC) && file.endsWith('.tsx')) {
          const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            fileName: file,
            compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
          });
          return { format: 'module', source: out.outputText, shortCircuit: true };
        }
      }
      return nextLoad(loadUrl, context);
    },
  });
}

// --- The element tree ------------------------------------------------------------

type Props = Record<string, unknown> & { children?: ReactNode };
export type Element = ReactElement<Props>;

function isElement(node: unknown): node is Element {
  return node !== null && typeof node === 'object' && !Array.isArray(node) && 'props' in (node as object);
}

function* elementsIn(node: ReactNode): Generator<Element> {
  if (Array.isArray(node)) {
    for (const child of node) yield* elementsIn(child as ReactNode);
    return;
  }
  if (!isElement(node)) return;
  yield node;
  yield* elementsIn(node.props.children);
}

/** The text an element's subtree carries, in order. */
export function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((child) => textOf(child as ReactNode)).join('');
  if (isElement(node)) return textOf(node.props.children);
  return '';
}

// --- Mounting ----------------------------------------------------------------------

export interface MountedDialog {
  /** The tree the last render returned (null when the dialog renders nothing). */
  tree(): Element | null;
  /** Every element of the last render, in document order. */
  elements(): Element[];
  /** The last render, as `react-dom/server` writes it. */
  markup(): string;
  /** What the reader reads: the markup with its tags removed and its entities decoded. */
  text(): string;
  /** The `<input>` inside the one `<label>` whose text includes `labelText`. */
  inputLabelled(labelText: string): Element;
  /** The one `<button>` whose text is `label`. */
  button(label: string): Element;
  /** The title field. */
  titleInput(): Element;
  /** The summary field. */
  summaryField(): Element;
  /** Every address `router.push` was called with. */
  pushed(): string[];
  /** Wait until no render is pending and every awaited reply has been read. */
  settle(): Promise<void>;
}

type DialogComponent = (props: Record<string, unknown>) => Element | null;

let dialog: DialogComponent | null = null;

/** The real dialog module's default export. */
export async function loadPublishDialog(): Promise<DialogComponent> {
  if (dialog) return dialog;
  registerPublishDialogHooks();
  const mod = (await import(pathToFileURL(DIALOG_FILE).href)) as { default: DialogComponent };
  dialog = mod.default;
  return dialog;
}

/**
 * Mount the dialog with these props (`isOpen` defaults to true) and run its
 * first effects. One dialog is current at a time; mounting another replaces it.
 */
export async function mountPublishDialog(
  props: Record<string, unknown>,
  attribution: { origin: string | null; host: string | null; platformTitle: string | null } = { origin: null, host: null, platformTitle: null },
): Promise<MountedDialog> {
  const Dialog = await loadPublishDialog();
  let tree: Element | null = null;
  let scheduled = false;
  const rootCells: Array<Record<string, unknown>> = [];
  // A primitive's hook cells, by its place in the tree.
  const instances = new Map<string, Array<Record<string, unknown>>>();
  const rt: Runtime = {
    cells: rootCells,
    index: 0,
    ids: 0,
    effects: [],
    schedule: () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        render();
      });
    },
    attribution,
    pushed: [],
  };
  const fullProps = { isOpen: true, onClose: () => undefined, ...props };
  // The host tree: function components called on the runtime, fragments
  // replaced by their children, host elements rebuilt around their expanded
  // children (see the header).
  const expand = (node: unknown, at: string): ReactNode => {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) {
      return node.map((child, i) => expand(child, `${at}.${isElement(child) && child.key !== null ? `k${child.key}` : `i${i}`}`));
    }
    if (!isElement(node)) return null;
    const { type, props } = node;
    if (typeof type === 'string') {
      const children = expand(props.children, `${at}>${type}`);
      const rebuilt = createElement(type, { ...props, key: node.key ?? undefined }, ...(Array.isArray(children) ? children : [children]));
      // React's development build marks an element written among static
      // children as key-checked; the rebuilt element keeps that mark, so a
      // list the original did not warn about does not warn now.
      const from = (node as { _store?: { validated?: number } })._store;
      const to = (rebuilt as { _store?: { validated?: number } })._store;
      if (from && to) to.validated = from.validated;
      return rebuilt;
    }
    if (typeof type === 'function') {
      const key = `${at}/${(type as { name?: string }).name ?? 'anonymous'}`;
      let cells = instances.get(key);
      if (!cells) {
        cells = [];
        instances.set(key, cells);
      }
      const saved = { cells: rt.cells, index: rt.index };
      rt.cells = cells;
      rt.index = 0;
      let out: unknown;
      try {
        out = (type as (p: Props) => unknown)(props);
      } finally {
        rt.cells = saved.cells;
        rt.index = saved.index;
      }
      return expand(out, key);
    }
    // A fragment, or anything else that is not a host element: its children.
    return expand(props.children, `${at}~`);
  };

  const render = () => {
    HARNESS.current = rt;
    rt.cells = rootCells;
    rt.index = 0;
    rt.effects = [];
    const returned = Dialog(fullProps);
    const host = returned === null ? null : expand(returned, 'root');
    tree = host === null ? null : isElement(host) ? host : (createElement(Fragment, null, host) as unknown as Element);
    const effects = rt.effects;
    rt.effects = [];
    for (const effect of effects) effect();
  };
  render();

  const elements = (): Element[] => (tree ? [...elementsIn(tree)] : []);
  const one = (what: string, matches: Element[]): Element => {
    if (matches.length !== 1) throw new Error(`publish dialog harness: expected one ${what}, found ${matches.length}`);
    return matches[0];
  };
  const markup = () => (tree ? renderToStaticMarkup(tree) : '');

  const mounted: MountedDialog = {
    tree: () => tree,
    elements,
    markup,
    text: () => markup()
      .replace(/<!-- -->/g, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&'),
    inputLabelled: (labelText) => {
      const labels = elements().filter((el) => el.type === 'label' && textOf(el).includes(labelText)
        && [...elementsIn(el.props.children)].some((child) => child.type === 'input'));
      const label = one(`label carrying "${labelText}" and an input`, labels);
      return one(`input in the label "${labelText}"`, [...elementsIn(label.props.children)].filter((child) => child.type === 'input'));
    },
    button: (label) => one(`button "${label}"`, elements().filter((el) => el.type === 'button' && textOf(el).trim() === label)),
    titleInput: () => one('text input', elements().filter((el) => el.type === 'input' && el.props.type === 'text')),
    summaryField: () => one('textarea', elements().filter((el) => el.type === 'textarea')),
    pushed: () => [...rt.pushed],
    settle: async () => {
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!scheduled) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (!scheduled) return;
        }
      }
    },
  };
  return mounted;
}

/** Call an element's handler as React would for that event. */
export function fire(element: Element, handler: 'onChange' | 'onClick', event: Record<string, unknown> = {}): unknown {
  const fn = element.props[handler];
  if (typeof fn !== 'function') throw new Error(`publish dialog harness: the element has no ${handler}`);
  return (fn as (e: unknown) => unknown)({ preventDefault() {}, stopPropagation() {}, ...event });
}
