// #516 P3 — the reader is SHOWN a notebook's own traceback, under the error
// message, with the correlation id (the 2026-09-21 ruling: shown, not merely
// sent).
//
// WHAT IS DRIVEN. The real hook (`src/hooks/useNotebookStream.ts`) reads the
// error event as the route sends it, and the real component
// (`NotebookOutput.tsx`) renders the state the hook produced, to static markup
// with `react-dom/server`. The hook runs outside React: `react` is replaced
// FOR THE HOOK MODULE ONLY by a state cell (`useState` keeps the latest value,
// `useCallback` and `useRef` are the identity), and `@/lib/sse-client` by a
// reader that hands the hook the events below. The component renders with the
// real React. The JSX is compiled by the TypeScript compiler already in
// devDependencies (`transpileModule`), as in
// `chat-notebook-output-layout.test.ts`.
//
// WHAT IS ASSERTED: the reader's text, not the component's structure. Tags are
// stripped and entities decoded before any assertion, so a later change to
// the error block's markup (#619) keeps this test as long as the reader still
// sees the same words in the same order.
//
// RED on the base: the hook rebuilds the message from `correlationId` and
// `exitCode` and drops every other field, so the canary never reaches the page.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/notebook/notebook-error-traceback.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionProvider } from 'next-auth/react';

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
const SRC = path.resolve(HERE, '..', '..');
const HOOK_FILE = path.join(SRC, 'hooks/useNotebookStream.ts');
const STUB_PREFIX = 'file:///civic-516-p3-render-stub/';

const STUBS: Record<string, string> = {
  // A state cell: what the hook last set is what the reader would see next.
  react: `
    export function useState(initial) {
      globalThis.__p3Hook.state = typeof initial === 'function' ? initial() : initial;
      const set = (update) => {
        globalThis.__p3Hook.state = typeof update === 'function' ? update(globalThis.__p3Hook.state) : update;
      };
      return [globalThis.__p3Hook.state, set];
    }
    export function useCallback(fn) { return fn; }
    export function useRef(value) { return { current: value }; }`,
  // The SSE reader, handing over the events as the route sent them.
  '@/lib/sse-client': `
    export async function connectSSE({ onEvent, onComplete }) {
      for (const event of globalThis.__p3Hook.events) onEvent(event);
      if (onComplete) onComplete();
    }`,
};

function firstFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}

function candidatesFor(base: string): string[] {
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = (context as { parentURL?: string }).parentURL;
    if (parent?.startsWith('file:') && fileURLToPath(parent) === HOOK_FILE && specifier in STUBS) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    // Next's bundler resolves `next/navigation`; Node's needs the file.
    if (/^next\/[a-z-]+$/.test(specifier) && specifier !== 'next/server') return nextResolve(`${specifier}.js`, context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`render test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && parent?.startsWith('file:') && fileURLToPath(parent).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(parent)), specifier)));
      if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
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
      if (file.startsWith(SRC) && /\.tsx?$/.test(file)) {
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

interface HookCell { state: Record<string, unknown>; events: Array<Record<string, unknown>> }
const cell = { state: {}, events: [] } as HookCell;
(globalThis as unknown as { __p3Hook: HookCell }).__p3Hook = cell;

// Called outside React on purpose (see the header), so it is not named as a hook here.
const { useNotebookStream: notebookStreamOutsideReact } = (await import(pathToFileURL(HOOK_FILE).href)) as {
  useNotebookStream: () => { start: (query: string, model: string, portal: string) => Promise<void> };
};
const { default: NotebookOutput } = (await import('./NotebookOutput.tsx')) as unknown as {
  default: ComponentType<Record<string, unknown>>;
};

/** The state the hook holds after reading these events, as the component would receive it. */
async function stateAfter(events: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
  cell.events = events;
  const { start } = notebookStreamOutsideReact();
  await start('How many noise complaints were there last week?', 'fixture-fast', 'data.example.org');
  return cell.state;
}

const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;

/** What the reader reads: the rendered markup with its tags removed and its entities decoded. */
function readerText(state: Record<string, unknown>): string {
  const html = renderToStaticMarkup(
    createElement(Session, { session: null }, createElement(NotebookOutput, {
      state,
      prompt: 'How many noise complaints were there last week?',
      model: 'fixture-fast',
      portal: 'data.example.org',
    })),
  );
  return html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const CANARY = 'Rn6vTz1-reader-traceback-canary';
const CORRELATION_ID = 'nb-5a1e7c3d';
const MESSAGE = `Notebook execution failed (exit 1). Reference: ${CORRELATION_ID}. Try again, or include this reference if you report the problem.`;
const TRACEBACK = [
  'nbclient.exceptions.CellExecutionError: An error occurred while executing the following cell:',
  '------------------',
  `raise KeyError('${CANARY}')`,
  '------------------',
  '',
  'KeyError                                  Traceback (most recent call last)',
  'Cell In[2], line 1',
  `KeyError: '${CANARY}'`,
].join('\n');

test('the reader is shown the notebook’s traceback under the error message, with the correlation id', async () => {
  const state = await stateAfter([
    { type: 'phase', name: 'C', message: 'Executing in sandbox…' },
    { type: 'error', message: MESSAGE, code: 'notebook_execution', correlationId: CORRELATION_ID, exitCode: 1, traceback: TRACEBACK },
  ]);
  const text = readerText(state);
  const messageAt = text.indexOf(MESSAGE);
  assert.notEqual(messageAt, -1, `the error message is not shown:\n${text}`);
  const after = text.slice(messageAt + MESSAGE.length);
  const canaryAt = after.indexOf(CANARY);
  assert.notEqual(canaryAt, -1, `the traceback is not shown under the error message:\n${text}`);
  assert.ok(
    after.slice(0, canaryAt).includes(CORRELATION_ID),
    `the traceback is not shown with its correlation id:\n${after.slice(0, canaryAt + CANARY.length)}`,
  );
  for (const line of TRACEBACK.split('\n').filter(Boolean)) {
    assert.ok(after.includes(line), `a traceback line is missing from what the reader sees: ${line}`);
  }
});

test('an error event with no traceback field shows the message alone, and a message is never taken from the wire', async () => {
  const state = await stateAfter([
    // A setup failure, or any failure under EXECUTOR_DRIVER=lambda: no field.
    // The wire message carries the canary; the hook rebuilds the message from
    // the typed fields (#271), so the canary must not be shown.
    { type: 'error', message: `${MESSAGE} ${CANARY}`, code: 'notebook_execution', correlationId: CORRELATION_ID, exitCode: 1 },
  ]);
  const text = readerText(state);
  assert.ok(text.includes(MESSAGE), `the error message is not shown:\n${text}`);
  assert.ok(!text.includes(CANARY), `text the event did not carry as a traceback was shown:\n${text}`);
});
