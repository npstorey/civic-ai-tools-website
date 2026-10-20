// The consent surfaces, driven outside a browser (R6 W3, #632): a component
// tree rendered, clicked, typed into and submitted, its markup read with the
// real `react-dom/server`, and every request it makes answered by the test.
// Shared by the W3 surface suites; it is not a test itself, and nothing in the
// app imports it.
//
// HOW. This repository has no DOM library, so the components' hooks run on a
// small runtime instead of React's, as `../publish-dialog-test-harness.ts`
// does for one dialog. Here the runtime renders a whole tree: `react` is
// replaced for every module under `src/` (this file and the test files
// excepted) by hooks kept per component instance, keyed by the instance's
// place in the tree; function components are called by the runtime itself,
// context providers carry their values down, effects run after each render
// when their dependencies change (and their cleanups run first, and on
// unmount), and a state update re-renders once per microtask, as React
// batches an event. The JSX runtime is the real one, so every element is a
// real React element, and the host tree the runtime produces is rendered to
// markup by the real `react-dom/server`.
//
// WHAT THE CALLER SUPPLIES. Its own module stubs (`next-auth/react`,
// `next/link`, `next/navigation`, and any server module a route handler the
// test answers requests with reads), passed to `registerSurfaceHooks`, and the
// answer to every request (`installFetch`).
//
// BLIND SPOTS, stated. No layout, focus or browser event dispatch: a handler
// is called as React would call it for that event, with a minimal event
// object. A component from outside `src/` that uses React's own hooks is
// rendered once by the real `react-dom/server` and is not interactive.
// Refs are never attached to elements.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as nodeModule from 'node:module';
import path from 'node:path';
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
export const SRC = path.resolve(HERE, '..', '..');
const HARNESS_FILE = fileURLToPath(import.meta.url);
const STUB_PREFIX = 'file:///civic-w3-surface-stub/';
const REACT_URL = pathToFileURL(createRequire(import.meta.url).resolve('react')).href;

// --- The runtime -----------------------------------------------------------------

interface Cell { value?: unknown; current?: unknown; deps?: unknown[]; cleanup?: (() => void) | void; effect?: () => (() => void) | void; pending?: boolean }
interface Instance { cells: Cell[]; seen: boolean }
interface Runtime {
  instance: Instance | null;
  index: number;
  context: Map<unknown, unknown>;
  schedule: () => void;
  ids: number;
}

interface SurfaceGlobal { current: Runtime | null }
const GLOBAL: SurfaceGlobal = { current: null };
(globalThis as unknown as { __w3Surface: SurfaceGlobal }).__w3Surface = GLOBAL;

const REACT_STUB = `
  import * as Real from ${JSON.stringify(REACT_URL)};
  const G = globalThis.__w3Surface;
  const rt = () => {
    const r = G.current;
    if (!r || !r.instance) throw new Error('w3 surface harness: a hook was called outside a component render');
    return r;
  };
  const cell = () => {
    const r = rt();
    const i = r.index++;
    if (r.instance.cells[i] === undefined) r.instance.cells[i] = {};
    return r.instance.cells[i];
  };
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, k) => Object.is(v, b[k]));
  export function useState(initial) {
    const c = cell();
    const r = G.current;
    if (!('value' in c)) {
      c.value = typeof initial === 'function' ? initial() : initial;
      c.set = (update) => {
        const next = typeof update === 'function' ? update(c.value) : update;
        if (Object.is(next, c.value)) return;
        c.value = next;
        r.schedule();
      };
    }
    return [c.value, c.set];
  }
  export function useReducer(reducer, initialArg, init) {
    const [state, set] = useState(() => (init ? init(initialArg) : initialArg));
    return [state, (action) => set((s) => reducer(s, action))];
  }
  export function useRef(initial) {
    const c = cell();
    if (!('current' in c)) c.current = initial;
    return c;
  }
  export function useMemo(factory, deps) {
    const c = cell();
    if (!('value' in c) || !same(c.deps, deps)) { c.value = factory(); c.deps = deps; }
    return c.value;
  }
  export function useCallback(fn, deps) { return useMemo(() => fn, deps); }
  export function useEffect(effect, deps) {
    const c = cell();
    if ('deps' in c && deps !== undefined && same(c.deps, deps)) return;
    c.deps = deps;
    c.effect = effect;
    c.pending = true;
  }
  export const useLayoutEffect = useEffect;
  export const useInsertionEffect = useEffect;
  export function useSyncExternalStore(subscribe, getSnapshot) {
    const c = cell();
    const r = G.current;
    // The unsubscribe is the cell's cleanup, so it runs when the component unmounts.
    if (!c.subscribed) { c.subscribed = true; c.cleanup = subscribe(() => r.schedule()); }
    return getSnapshot();
  }
  export function useId() { const c = cell(); if (!('value' in c)) c.value = ':w3r' + (G.current.ids++) + ':'; return c.value; }
  export function useTransition() { return [false, (fn) => fn()]; }
  export function useDeferredValue(value) { return value; }
  export function useImperativeHandle() { cell(); }
  export function useDebugValue() {}
  export function createContext(defaultValue) {
    const context = { __w3Default: defaultValue };
    function Provider() { return null; }
    Provider.__w3Context = context;
    context.Provider = Provider;
    context.Consumer = function Consumer({ children }) { return children(useContext(context)); };
    return context;
  }
  export function useContext(context) {
    const r = G.current;
    return r && r.context.has(context) ? r.context.get(context) : context.__w3Default;
  }
  export function use(value) { if (value && '__w3Default' in value) return useContext(value); throw new Error('w3 surface harness: use() of a promise is not supported'); }
  export function forwardRef(render) { const f = (props) => render(props, null); f.displayName = render.name; return f; }
  export function memo(component) { return component; }
  export function startTransition(fn) { fn(); }
  export const Fragment = Real.Fragment;
  export const Suspense = Real.Suspense;
  export const StrictMode = Real.StrictMode;
  export const Children = Real.Children;
  export const createElement = Real.createElement;
  export const cloneElement = Real.cloneElement;
  export const isValidElement = Real.isValidElement;
  export const Component = Real.Component;
  export default { useState, useReducer, useRef, useMemo, useCallback, useEffect, useLayoutEffect, useSyncExternalStore, useId, useContext, createContext, forwardRef, memo, Fragment, Suspense, Children, createElement, cloneElement, isValidElement };
`;

function firstFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}
const candidatesFor = (base: string) => [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];

/** True for a module the runtime's `react` replaces: under `src/`, not a test, not this file. */
function rendersOnRuntime(file: string): boolean {
  return file.startsWith(SRC) && file !== HARNESS_FILE && !/\.test\.(c|m)?[jt]sx?$/.test(file);
}

let registered = false;

/**
 * Register the hooks: the caller's stubs (by specifier, as module source), the
 * `@/` alias, extensionless relative imports under `src/`, the runtime's
 * `react` for every component module, and `.ts`/`.tsx` under `src/` through
 * the TypeScript compiler. Idempotent; the first call's stubs are the ones used.
 */
export function registerSurfaceHooks(stubs: Record<string, string> = {}): void {
  if (registered) return;
  registered = true;
  const all: Record<string, string> = { ...stubs };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = (context as { parentURL?: string }).parentURL;
      const parentFile = parent?.startsWith('file:') && !parent.startsWith(STUB_PREFIX) ? fileURLToPath(parent) : null;
      if (specifier === 'react' && parentFile && rendersOnRuntime(parentFile)) {
        return { url: `${STUB_PREFIX}react.mjs`, format: 'module', shortCircuit: true };
      }
      if (Object.prototype.hasOwnProperty.call(all, specifier)) {
        return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
      }
      if (specifier === 'next/server') return nextResolve('next/server.js', context);
      if (specifier.startsWith('@/')) {
        const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
        if (found === null) throw new Error(`w3 surface harness: cannot resolve ${specifier}`);
        return { url: pathToFileURL(found).href, shortCircuit: true };
      }
      if (specifier.startsWith('.') && parentFile && parentFile.startsWith(SRC)) {
        const found = firstFile(candidatesFor(path.resolve(path.dirname(parentFile), specifier)));
        if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(loadUrl, context, nextLoad) {
      if (loadUrl === `${STUB_PREFIX}react.mjs`) return { format: 'module', source: REACT_STUB, shortCircuit: true };
      if (loadUrl.startsWith(STUB_PREFIX)) {
        const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
        return { format: 'module', source: all[key], shortCircuit: true };
      }
      if (loadUrl.startsWith('file:')) {
        const file = fileURLToPath(loadUrl);
        if (file.startsWith(SRC) && /\.tsx?$/.test(file) && !file.endsWith('.d.ts')) {
          const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            fileName: file,
            compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
          });
          return { format: 'module', source: out.outputText, shortCircuit: true };
        }
        if (file.endsWith('.json') && file.startsWith(SRC)) {
          return { format: 'module', source: `export default ${fs.readFileSync(file, 'utf8')};`, shortCircuit: true };
        }
      }
      return nextLoad(loadUrl, context);
    },
  });
}

/** The real JSX element factory, re-exported so a test file can build a tree without JSX. */
export const h = createElement;

/** A module stub that renders `next/link` as a plain anchor. */
export const NEXT_LINK_STUB = `
  import { createElement } from ${JSON.stringify(REACT_URL)};
  export default function Link({ href, children, prefetch, replace, scroll, shallow, ...rest }) {
    return createElement('a', { href: typeof href === 'string' ? href : String(href?.pathname ?? ''), ...rest }, children);
  }`;

/**
 * The session both halves read, set per case by the test: `server` is what
 * `getServerSession` answers a route handler with, `client` what
 * `useSession` answers a component with.
 */
export interface SurfaceSessions {
  server: { user?: { id?: string; dbId?: string } } | null;
  client: { status: 'authenticated' | 'unauthenticated' | 'loading'; data: unknown };
  /** The in-memory `source_consents` rows, by account id. */
  rows: Map<string, unknown>;
  /** Every address `router.push` or `router.replace` was called with. */
  pushed: string[];
}
const SESSIONS: SurfaceSessions = { server: null, client: { status: 'unauthenticated', data: null }, rows: new Map(), pushed: [] };
(globalThis as unknown as { __w3Sessions: SurfaceSessions }).__w3Sessions = SESSIONS;
export const sessions = SESSIONS;

/**
 * The stubs every consent-surface suite needs: the two sessions, a link, the
 * router, and the signed-in half of the consent store held in memory (its
 * three functions, as `src/lib/sources/consent-store.ts` exports them).
 */
export const CONSENT_SURFACE_STUBS: Record<string, string> = {
  'next/link': NEXT_LINK_STUB,
  'next-auth/react': `
    const S = globalThis.__w3Sessions;
    export function useSession() { return { status: S.client.status, data: S.client.data, update: async () => S.client.data }; }
    export async function signIn() {}
    export async function signOut() {}
    export function SessionProvider({ children }) { return children; }`,
  'next/navigation': `
    const S = globalThis.__w3Sessions;
    export function useRouter() { return { push(url) { S.pushed.push(url); }, replace(url) { S.pushed.push(url); }, refresh() {}, back() {}, prefetch() {} }; }
    export function usePathname() { return '/'; }
    export function useSearchParams() { return new URLSearchParams(''); }
    export function redirect(url) { throw new Error('redirect ' + url); }
    export function notFound() { throw new Error('not found'); }`,
  'next-auth': `export async function getServerSession() { return globalThis.__w3Sessions.server; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/sources/consent-store': `
    const rows = () => globalThis.__w3Sessions.rows;
    export async function readConsentRow(userId) { return rows().get(userId) ?? null; }
    export async function writeConsentRow(userId, row) {
      const prior = rows().get(userId);
      const now = row.now ?? new Date();
      rows().set(userId, { userId, states: row.states, flowsHash: row.flowsHash, flowsStatement: row.flowsStatement, consentedAt: prior?.consentedAt ?? now, updatedAt: now });
    }
    export async function deleteConsentRow(userId) { rows().delete(userId); }`,
};

// --- The host tree -------------------------------------------------------------------

type Props = Record<string, unknown> & { children?: ReactNode };
export type HostElement = ReactElement<Props> & { type: string };

function isElement(node: unknown): node is ReactElement<Props> {
  return node !== null && typeof node === 'object' && !Array.isArray(node) && 'props' in (node as object) && '$$typeof' in (node as object);
}

function* hostElementsIn(node: unknown): Generator<HostElement> {
  if (Array.isArray(node)) {
    for (const child of node) yield* hostElementsIn(child);
    return;
  }
  if (!isElement(node)) return;
  if (typeof node.type === 'string') yield node as HostElement;
  yield* hostElementsIn(node.props.children);
}

/** What a reader reads in a piece of markup: tags removed, entities decoded, whitespace collapsed. */
export function readableText(markup: string): string {
  return markup
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The readable text of one host element's subtree. */
export function textOf(node: ReactNode): string {
  if (!isElement(node)) return readableText(renderToStaticMarkup(createElement(Fragment, null, node)));
  return readableText(renderToStaticMarkup(node));
}

// --- Mounting ------------------------------------------------------------------------

export interface Surface {
  /** The last render, as `react-dom/server` writes it. */
  markup(): string;
  /** What a reader reads of the last render. */
  text(): string;
  /** Every host element of the last render, in document order. */
  elements(): HostElement[];
  /** The one `<button>` whose readable text is `label`; throws on none or several. */
  button(label: string): HostElement;
  /** Every `<button>` whose readable text is `label`. */
  buttons(label: string): HostElement[];
  /** Click: the element's `onClick`, as React would call it. */
  click(element: HostElement): Promise<void>;
  /** Type into an `<input>` or `<textarea>`: its `onChange` with the new value. */
  type(element: HostElement, value: string): Promise<void>;
  /** Choose a radio or checkbox: its `onChange` with `checked: true`. */
  check(element: HostElement): Promise<void>;
  /** A key pressed on an element: its `onKeyDown`. */
  key(element: HostElement, key: string, extra?: Record<string, unknown>): Promise<void>;
  /** Submit a `<form>`: its `onSubmit`. */
  submit(form: HostElement): Promise<void>;
  /** Wait until no render is pending and every request the test answers has been read. */
  settle(): Promise<void>;
  /** Stop: every effect cleanup runs. */
  unmount(): void;
}

const FRAGMENT = Symbol.for('react.fragment');
const SUSPENSE = Symbol.for('react.suspense');
const STRICT = Symbol.for('react.strict_mode');

function nameOf(type: unknown): string {
  return typeof type === 'function' ? ((type as { displayName?: string }).displayName ?? type.name ?? 'anonymous') : String(type);
}

let pendingRequests = 0;

/** Mount `element` and run its first effects. Several surfaces may be mounted; each has its own runtime. */
export async function mount(element: ReactElement): Promise<Surface> {
  const instances = new Map<string, Instance>();
  let host: ReactNode = null;
  let scheduled = false;
  let renders = 0;
  const rt: Runtime = {
    instance: null,
    index: 0,
    context: new Map(),
    schedule: () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        render();
      });
    },
    ids: 0,
  };

  const expand = (node: unknown, at: string, context: Map<unknown, unknown>): ReactNode => {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) {
      return node.map((child, i) => {
        const key = isElement(child) && child.key !== null ? `k${child.key}` : `i${i}`;
        return expand(child, `${at}.${key}`, context);
      });
    }
    if (!isElement(node)) return null;
    const { type, props } = node as unknown as { type: unknown; props: Props };
    if (type === FRAGMENT || type === SUSPENSE || type === STRICT) return expand(props.children, `${at}~`, context);
    if (typeof type === 'string') {
      const children = expand(props.children, `${at}>${type}`, context);
      return createElement(type, { ...props, key: node.key ?? undefined }, ...(Array.isArray(children) ? children : [children]));
    }
    if (typeof type === 'function') {
      const ctx = (type as { __w3Context?: unknown }).__w3Context;
      if (ctx !== undefined) {
        const next = new Map(context);
        next.set(ctx, props.value);
        return expand(props.children, `${at}^`, next);
      }
      const key = `${at}/${nameOf(type)}`;
      let instance = instances.get(key);
      if (!instance) {
        instance = { cells: [], seen: true };
        instances.set(key, instance);
      }
      instance.seen = true;
      const saved = { instance: rt.instance, index: rt.index, context: rt.context };
      rt.instance = instance;
      rt.index = 0;
      rt.context = context;
      GLOBAL.current = rt;
      let out: unknown;
      try {
        out = (type as (p: Props) => unknown)(props);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A component from outside `src/` calling React's own hooks: rendered once by React.
        if (/Invalid hook call|reading 'use[A-Z]/.test(message)) {
          rt.instance = saved.instance;
          rt.index = saved.index;
          rt.context = saved.context;
          return createElement('div', { 'data-w3-island': nameOf(type), dangerouslySetInnerHTML: { __html: renderToStaticMarkup(node) } });
        }
        throw error;
      } finally {
        rt.instance = saved.instance;
        rt.index = saved.index;
        rt.context = saved.context;
      }
      return expand(out, key, context);
    }
    return null;
  };

  const render = () => {
    renders += 1;
    if (renders > 500) throw new Error('w3 surface harness: more than 500 renders; a state update loops');
    for (const instance of instances.values()) instance.seen = false;
    host = expand(element, 'root', new Map());
    for (const [key, instance] of instances) {
      if (instance.seen) continue;
      for (const c of instance.cells) if (typeof c?.cleanup === 'function') c.cleanup();
      instances.delete(key);
    }
    GLOBAL.current = rt;
    for (const instance of instances.values()) {
      for (const c of instance.cells) {
        if (!c?.pending) continue;
        c.pending = false;
        if (typeof c.cleanup === 'function') c.cleanup();
        c.cleanup = c.effect?.();
      }
    }
  };

  render();
  const markup = () => renderToStaticMarkup(createElement(Fragment, null, host));
  const elements = () => [...hostElementsIn(host)];
  const settle = async () => {
    let idle = 0;
    for (let i = 0; i < 1000 && idle < 8; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      idle = !scheduled && pendingRequests === 0 ? idle + 1 : 0;
    }
  };
  const call = async (el: HostElement, handler: string, event: Record<string, unknown>) => {
    const fn = el.props[handler];
    if (typeof fn !== 'function') throw new Error(`w3 surface harness: the <${el.type}> has no ${handler}`);
    GLOBAL.current = rt;
    await (fn as (e: unknown) => unknown)({ preventDefault() {}, stopPropagation() {}, currentTarget: el.props, target: el.props, ...event });
    await settle();
  };
  const surface: Surface = {
    markup,
    text: () => readableText(markup()),
    elements,
    buttons: (label) => elements().filter((el) => el.type === 'button' && textOf(el) === label),
    button: (label) => {
      const found = surface.buttons(label);
      if (found.length !== 1) throw new Error(`w3 surface harness: expected one button "${label}", found ${found.length}; the surface reads: ${readableText(markup()).slice(0, 600)}`);
      return found[0];
    },
    click: (el) => call(el, 'onClick', {}),
    type: (el, value) => call(el, 'onChange', { target: { ...el.props, value }, currentTarget: { ...el.props, value } }),
    check: (el) => call(el, 'onChange', { target: { ...el.props, checked: true }, currentTarget: { ...el.props, checked: true } }),
    key: (el, key, extra = {}) => call(el, 'onKeyDown', { key, shiftKey: false, ...extra }),
    submit: (form) => call(form, 'onSubmit', {}),
    settle,
    unmount: () => {
      for (const instance of instances.values()) for (const c of instance.cells) if (typeof c?.cleanup === 'function') c.cleanup();
      instances.clear();
      host = null;
    },
  };
  await settle();
  return surface;
}

// --- Requests ------------------------------------------------------------------------

export interface SentRequest { method: string; path: string; body: string; cookie: string }

export type Answer = (request: Request) => Promise<Response> | Response;

/**
 * Replace `globalThis.fetch` for the surfaces: a relative path is resolved
 * against `origin`, the request is handed to the first answer whose path
 * prefix matches (or refused with a 599 when none does), and every request is
 * recorded. A cookie jar carries what a `Set-Cookie` header sets to the next
 * request, as a browser does for its own origin; a cookie set with `Secure`
 * is kept only when `origin` is `https:` or a `localhost` address.
 */
export function installFetch(origin: string, answers: Record<string, Answer>): { sent: SentRequest[]; jar: Map<string, string>; clear(): void } {
  const sent: SentRequest[] = [];
  const jar = new Map<string, string>();
  const secureOrigin = origin.startsWith('https:') || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(origin);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin);
    const headers = new Headers(init?.headers);
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    if (cookie) headers.set('cookie', cookie);
    const body = typeof init?.body === 'string' ? init.body : '';
    const method = (init?.method ?? 'GET').toUpperCase();
    sent.push({ method, path: url.pathname, body, cookie });
    pendingRequests += 1;
    try {
      const prefix = Object.keys(answers).sort((a, b) => b.length - a.length).find((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
      if (prefix === undefined) return new Response(JSON.stringify({ error: `no answer for ${url.pathname}` }), { status: 599 });
      const request = new Request(url.href, { method, headers, ...(body && method !== 'GET' ? { body } : {}) });
      const response = await answers[prefix](request);
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const [pair, ...attrs] = setCookie.split(';').map((p) => p.trim());
        const at = pair.indexOf('=');
        const name = pair.slice(0, at);
        const value = pair.slice(at + 1);
        const lower = attrs.map((a) => a.toLowerCase());
        const expired = lower.includes('max-age=0');
        const secure = lower.includes('secure');
        if (expired) jar.delete(name);
        else if (!secure || secureOrigin) jar.set(name, value);
      }
      return response;
    } finally {
      pendingRequests -= 1;
    }
  }) as typeof fetch;
  return { sent, jar, clear: () => { sent.length = 0; } };
}
