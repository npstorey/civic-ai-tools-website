// R10 P1b (#694), criterion 2: section B on a record, as `SkillSection`
// renders it.
//
// WHAT IS DRIVEN. `SkillSection.tsx` compiled with the TypeScript compiler
// already in devDependencies and rendered with the real `react-dom/server`.
// FOR THAT MODULE ONLY, `react` is a small hook runtime (cells kept per call
// index), so the test can do what a reader does: render, press "View skill
// guidance", let the fetch finish, render again. The section fetches through
// `globalThis.fetch`, answered here from a Map of blob URLs; nothing leaves the
// process.
//
// WHAT IS ASSERTED.
//   - P1b-d: a BlobRef whose bytes hash to its reference renders the text; a
//     blob whose bytes do not (tampered) renders the reference and the
//     mismatch sentence, never the text; a blob that cannot be fetched (a
//     404, a thrown fetch) renders the reference and the unavailable
//     sentence, never the text and never the error's own message.
//   - P1b-e: a record with no text renders the absent-case sentence, the hash
//     where the record states one, and the composition's components (id,
//     version, guidance hash) where it lists them.
//   - The ruling's many-prompts disclosure: with earlier prompts, the section
//     states how many prompts the model saw and lists the earlier ones by
//     hash, beside the last one's text.
//
// THE FIXTURES CAN FAIL. The tampered blob differs from the prompt by one
// appended line, so a section that rendered fetched bytes unchecked shows the
// prompt's own text; the 404 and the thrown fetch each carry a message a raw
// render would print.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as nodeModule from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { isValidElement, type ReactElement } from 'react';
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
const SRC = path.resolve(HERE, '..', '..');
const SKILL_SECTION_FILE = path.join(SRC, 'components', 'evidence', 'SkillSection.tsx');

// --- The hook runtime, for SkillSection.tsx only ------------------------------------

interface Runtime { cells: unknown[]; index: number }
const RUNTIME: Runtime = { cells: [], index: 0 };
(globalThis as unknown as { __p1bHooks: Runtime }).__p1bHooks = RUNTIME;
const REACT_URL = pathToFileURL(createRequire(import.meta.url).resolve('react')).href;
const HOOKS_URL = 'file:///r10-p1b-skill-section-hooks/react.mjs';
const HOOKS_SOURCE = `
  import React from '${REACT_URL}';
  export default React;
  export function useState(initial) {
    const rt = globalThis.__p1bHooks;
    const i = rt.index++;
    if (!(i in rt.cells)) rt.cells[i] = typeof initial === 'function' ? initial() : initial;
    const set = (update) => { rt.cells[i] = typeof update === 'function' ? update(rt.cells[i]) : update; };
    return [rt.cells[i], set];
  }`;

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
    const from = (context as { parentURL?: string }).parentURL;
    if (specifier === 'react' && from?.startsWith('file:') && fileURLToPath(from) === SKILL_SECTION_FILE) {
      return { url: HOOKS_URL, format: 'module', shortCircuit: true };
    }
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`skill section test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && from?.startsWith('file:') && fileURLToPath(from).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(from)), specifier)));
      if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl === HOOKS_URL) return { format: 'module', source: HOOKS_SOURCE, shortCircuit: true };
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

// --- Fixtures: the blobs, and the fetch that answers them ------------------------------

const PROMPT = 'PROMPTTEXT-r10-p1b: the directory, then the Socrata guidance.\nCount rows by borough.';
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const HASH = sha(PROMPT);
const BYTES = Buffer.from(PROMPT, 'utf8');
const urlFor = (name: string) => `https://blobs.example.test/evidence-refs/${HASH}-${name}.txt`;
const ref = (name: string) => ({ ref: `blob:sha256:${HASH}`, url: urlFor(name), contentType: 'text/plain; charset=utf-8', size: BYTES.byteLength });
const TAMPERED = Buffer.from(`${PROMPT}\nTAMPERED`, 'utf8');
const NOT_FOUND_MESSAGE = 'HTTP 404';
const THROWN_MESSAGE = 'fixture-network-SENTINEL-p1b';

const BLOBS = new Map<string, Buffer>([[urlFor('good'), BYTES], [urlFor('tampered'), TAMPERED]]);
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === urlFor('thrown')) throw new TypeError(THROWN_MESSAGE);
  const bytes = BLOBS.get(url);
  return bytes ? new Response(new Uint8Array(bytes), { status: 200 }) : new Response('not found', { status: 404, statusText: 'Not Found' });
}) as typeof fetch;

// --- The section, driven -----------------------------------------------------------------

/** String-typed specifiers, so the red commit type-checks before the modules change. */
const SKILL_SECTION: string = '@/components/evidence/SkillSection';
const COPY: string = '@/lib/sources/copy';
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const { default: SkillSection } = (await import(SKILL_SECTION)) as { default: (props: Loose) => ReactElement };
const { SYSTEM_PROMPT_TEXT: T } = (await import(COPY)) as Loose;

/** The first element in the tree with an onClick, as a reader's press finds the button. */
function findClickable(node: unknown): (() => unknown) | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findClickable(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { onClick?: () => unknown; children?: unknown };
  if (typeof props.onClick === 'function') return props.onClick;
  return findClickable(props.children);
}

/**
 * The props: the section, and the three props the base's call site passed
 * (`skillText`, `skillTextRef`, `skillHash`), so the base's component renders
 * the same record and its red is the defect itself (no hash check), not a
 * missing prop.
 */
function propsOf(section: Loose): Loose {
  const d = section.disclosure;
  return {
    section,
    skillText: d.kind === 'inline' ? d.text : undefined,
    skillTextRef: d.kind === 'blob' ? d.ref : undefined,
    skillHash: d.kind === 'inline' || d.kind === 'blob' ? d.hash : undefined,
  };
}

/** Render, press the button, wait for what it started, render again. */
async function openSection(section: Loose): Promise<string> {
  RUNTIME.cells = [];
  RUNTIME.index = 0;
  const first = SkillSection(propsOf(section));
  const press = findClickable(first);
  assert.ok(press, 'premise — the section has a button to open it');
  await press!();
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  RUNTIME.index = 0;
  return renderToStaticMarkup(SkillSection(propsOf(section)));
}

function renderSection(section: Loose): string {
  RUNTIME.cells = [];
  RUNTIME.index = 0;
  return renderToStaticMarkup(SkillSection(propsOf(section)));
}

const blobSection = (name: string, earlier: string[] = []) => ({
  author: null,
  disclosure: { kind: 'blob', ref: ref(name), hash: HASH },
  earlierPromptHashes: earlier,
  components: [],
});

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '\'').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// --- P1b-d ---------------------------------------------------------------------------------

test('criterion 2: a blob whose bytes hash to its reference renders the resolved text', async () => {
  const html = await openSection(blobSection('good'));
  assert.ok(textOf(html).includes(PROMPT), 'the verified text is not rendered');
});

test('criterion 2: a tampered blob renders the reference and the mismatch sentence, not the text', async () => {
  const html = await openSection(blobSection('tampered'));
  const text = textOf(html);
  assert.equal(text.includes('Count rows by borough.'), false, 'bytes that do not hash to the reference were rendered');
  assert.ok(text.includes(`blob:sha256:${HASH.slice(0, 12)}`), 'the reference is not shown');
  assert.ok(text.includes(T.mismatch), 'the mismatch sentence is not shown');
});

for (const [name, raw] of [['missing', NOT_FOUND_MESSAGE], ['thrown', THROWN_MESSAGE]] as const) {
  test(`criterion 2: a blob that cannot be fetched (${name}) renders the reference and a sentence, never the text or the error`, async () => {
    const html = await openSection(blobSection(name));
    const text = textOf(html);
    assert.equal(text.includes('Count rows by borough.'), false);
    assert.ok(text.includes(`blob:sha256:${HASH.slice(0, 12)}`), 'the reference is not shown');
    assert.ok(text.includes(T.unavailable), 'the unavailable sentence is not shown');
    assert.equal(text.includes(raw), false, 'the raw error reached the reader');
  });
}

// --- P1b-e ---------------------------------------------------------------------------------

const COMPONENTS = [
  { id: 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server', guidanceHash: 'a'.repeat(64) },
  { id: 'data-commons', version: '1.4.0' },
  { id: '@typedstandards/civic-typed-router', version: '0.6.0' },
];

test('criterion 2: a record with no text says so, shows its hash, and lists the composition\'s components', () => {
  const html = renderSection({
    author: null,
    disclosure: { kind: 'hash-only', hash: 'b'.repeat(64) },
    earlierPromptHashes: [],
    components: COMPONENTS,
  });
  const text = textOf(html);
  assert.ok(text.includes(T.notCarried), 'the absent-case sentence is not shown');
  assert.ok(text.includes(T.hashLabel) && text.includes('b'.repeat(64)), 'the hash is not shown');
  assert.ok(text.includes(T.componentsIntro), 'the components are not introduced');
  for (const c of COMPONENTS) assert.ok(text.includes(c.id), `component ${c.id} is not listed`);
  assert.ok(text.includes('1.4.0') && text.includes('0.6.0'), 'a version is not listed');
  assert.ok(text.includes(T.guidanceHashLabel) && text.includes('a'.repeat(64)), 'the guidance hash is not listed');
});

test('criterion 2: a record with neither text nor hash says the text was not carried and shows no hash', () => {
  const text = textOf(renderSection({ author: null, disclosure: { kind: 'none' }, earlierPromptHashes: [], components: [] }));
  assert.ok(text.includes(T.notCarried));
  assert.equal(text.includes(T.hashLabel), false);
  assert.equal(text.includes(T.componentsIntro), false, 'an empty list is introduced');
});
// --- The many-prompts disclosure --------------------------------------------------------------

test('many prompts: the section states how many prompts the model saw, shows the last, and lists the earlier ones by hash', async () => {
  const earlier = ['1'.repeat(64), '2'.repeat(64)];
  const text = textOf(await openSection(blobSection('good', earlier)));
  assert.ok(text.includes(T.manyPrompts(3)), 'the count is not stated');
  for (const h of earlier) assert.ok(text.includes(h), `earlier prompt ${h.slice(0, 8)} is not listed`);
  assert.ok(text.includes(PROMPT), 'the last prompt is not shown');
});

test('many prompts: one prompt states no count', async () => {
  const text = textOf(await openSection(blobSection('good')));
  assert.equal(text.includes(T.manyPrompts(1)), false);
  assert.equal(text.includes(T.manyPrompts(2)), false);
});
