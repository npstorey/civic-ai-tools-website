// The real publish dialog (`PublishEvidenceDialog.tsx`), driven outside a
// browser: rendered, clicked and typed into, and its markup read with the real
// `react-dom/server`. Shared by the tests that drive it; it is not a test
// itself, and nothing in the app imports it.
//
// HOW. This repository has no DOM library, so the dialog's own hooks run on a
// small hook runtime instead of React's: `react` is replaced FOR TWO MODULES
// ONLY — the dialog and `EvidenceOriginProvider.tsx`, whose context the dialog
// reads — by cells kept per hook call index (`useState`, `useRef`), effects
// run after each render when their dependencies change (`useEffect`), and a
// context read that answers with the attribution the test supplies. Every
// other module, the JSX runtime included, is the real one, so the tree the
// dialog returns is a real React element tree and its markup is React's. A
// state update re-renders once per microtask, as React batches an event.
// `next/navigation` is replaced for the dialog, which only calls
// `router.push`. The `.tsx` files are compiled by the TypeScript compiler
// already in devDependencies (`transpileModule`), as in
// `notebook/notebook-error-traceback.test.ts`.
//
// WHAT THE CALLER SUPPLIES. The `@/` alias (each test file registers its own
// resolver BEFORE calling `registerPublishDialogHooks`, so these hooks run
// first and hand everything else on), and `globalThis.fetch`: the dialog's
// requests go wherever the test sends them.
//
// BLIND SPOT, stated: effect cleanups are not run and a hook's call order is
// assumed stable across renders, which holds for this dialog (every hook is
// called before its one early return). A layout or a browser-only behaviour
// is not exercised here.

import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { ReactElement, ReactNode } from 'react';
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
const STUBBED_FOR = new Set([DIALOG_FILE, ORIGIN_FILE]);
const STUB_PREFIX = 'file:///civic-publish-dialog-harness/';

interface Runtime {
  cells: Array<Record<string, unknown>>;
  index: number;
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
      if (parent?.startsWith('file:') && STUBBED_FOR.has(fileURLToPath(parent)) && specifier in STUBS) {
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
  const rt: Runtime = {
    cells: [],
    index: 0,
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
  const render = () => {
    HARNESS.current = rt;
    rt.index = 0;
    rt.effects = [];
    tree = Dialog(fullProps);
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
