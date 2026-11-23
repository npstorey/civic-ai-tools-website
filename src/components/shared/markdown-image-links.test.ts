// The rule: images in answers are shown as links.
//
// WHAT IS DRIVEN. Each markdown renderer that shows text a model, a publisher
// or a reviewer wrote, as the real component, rendered by react-dom/server:
//   - the answer (`AnswerView`, from a stored record through `adaptRecord`);
//   - the sources line (`AnswerView`'s `sources` part);
//   - a notebook output in markdown form (`RenderingCellOutputs`, from a live
//     run through `adaptNotebook`);
//   - a review's body (`AttestationSection`, its store answered here);
//   - the panel's answer (`ResponsePanel`);
//   - the steps' summary line (`ProgressLog`, whose line quotes a call's own
//     arguments).
// Each render shows no `<img>` with a remote address, and one link to the
// address whose text is the alt text, or the address when the alt text is
// empty.
//
// THE PINS. A notebook's own `image/png` output still renders as an image, and
// a stored record's package bytes are the same after the render.
//
// Module hooks resolve `@/` and transpile `.ts`/`.tsx`, as the other render
// tests here do. One module is replaced: the review store
// (`RecordReviewsProvider`), for `AttestationSection` only.
//
// Run with: npm test

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
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve?: (specifier: string, context: unknown, nextResolve: NextResolve) => ResolveResult;
    load?: (url: string, context: unknown, nextLoad: NextLoad) => LoadResult;
  }): void;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');
const ATTESTATION_SECTION = path.join(SRC, 'components', 'evidence', 'AttestationSection.tsx');
// Never on disk: served by the load hook below.
const REVIEWS_STUB_URL = pathToFileURL(path.join(SRC, 'components', 'evidence', '__image-links-reviews-stub.mjs')).href;
const REVIEWS_STUB = `
  export function useRecordReviews() {
    return globalThis.__imageLinksReviews;
  }`;

function firstFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}
const candidatesFor = (base: string) => [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];

registerHooks({
  resolve(specifier, context, nextResolve) {
    const from = (context as { parentURL?: string }).parentURL;
    if (specifier === './RecordReviewsProvider' && from?.startsWith('file:') && fileURLToPath(from) === ATTESTATION_SECTION) {
      return { url: REVIEWS_STUB_URL, format: 'module', shortCircuit: true };
    }
    if (/^next\/[a-z-]+$/.test(specifier) && specifier !== 'next/server') return nextResolve(`${specifier}.js`, context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`image links test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && from?.startsWith('file:') && fileURLToPath(from).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(from)), specifier)));
      if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl === REVIEWS_STUB_URL) return { format: 'module', source: REVIEWS_STUB, shortCircuit: true };
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

type AnyComponent = ComponentType<Record<string, unknown>>;
const { default: AnswerView } = (await import('@/components/answer-view/AnswerView')) as unknown as { default: AnyComponent };
const { AnswerLayoutsProvider } = (await import('@/components/answer-view/AnswerLayoutsProvider')) as unknown as {
  AnswerLayoutsProvider: ComponentType<{ value: unknown; children?: ReactNode }>;
};
const { adaptNotebook } = await import('@/components/answer-view/adapt-notebook');
const { adaptRecord } = await import('@/components/answer-view/adapt-record');
const { BUILT_IN_INSTANCE_LAYOUTS } = await import('@/lib/answer-layout');
const { default: AttestationSection } = (await import('@/components/evidence/AttestationSection')) as unknown as { default: AnyComponent };
const { default: ResponsePanel } = (await import('@/components/ResponsePanel')) as unknown as { default: AnyComponent };
const { default: ProgressLog } = (await import('@/components/ProgressLog')) as unknown as { default: AnyComponent };

// --- Fixtures -------------------------------------------------------------------

const ADDRESS = 'https://img.example.test/a.png';
const ALT = 'ALT-imglink';
const WITH_ALT = `Before ![${ALT}](${ADDRESS}) after.`;
const NO_ALT = `Before ![](${ADDRESS}) after.`;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';

const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;

function inAnswerView(model: unknown): string {
  return renderToStaticMarkup(createElement(Session, { session: null },
    createElement(AnswerLayoutsProvider, { value: BUILT_IN_INSTANCE_LAYOUTS }, createElement(AnswerView, { model }))));
}

function notebook(outputs: unknown[]) {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { extensions: { 'org.civicaitools.notebook': { provenance: 'executed' } } },
    cells: [{ cell_type: 'code', metadata: { role: 'synthesis' }, execution_count: 1, source: ['display(t)\n'], outputs }],
  };
}

function storedPackage(output: string): Record<string, unknown> {
  return {
    metadata: { schemaVersion: '0.1.0', packageId: 'imglink', createdAt: '2026-11-21T00:00:00.000Z', signingKeyId: 'platform:fixture', captureMethod: 'chat-flow-stream', contentProfile: 'datHere' },
    prompt: { hash: 'd'.repeat(64), visibility: 'full_text', text: 'How many?' },
    queries: [],
    cost: { model: 'openai/gpt-4o', promptTokens: 1, completionTokens: 1, totalTokens: 2, durationMs: 1 },
    skillMetadata: { skillText: 'skill', systemPromptHash: 'e'.repeat(64) },
    output,
    summary: 'summary',
    dataSources: [],
  };
}

function recordModel(pkg: Record<string, unknown>) {
  return adaptRecord({
    stored: pkg as never,
    resolution: { pkg, outputIsBlob: false, outputBlobRef: null, skillTextIsBlob: false, skillTextBlobRef: null } as never,
    row: { slug: 'imglink-record', summary: 'summary', contentProfile: 'datHere', captureMethod: 'chat-flow-stream' },
    instance: 'records.example.test',
  });
}

function liveNotebook(outputs: unknown[]) {
  return adaptNotebook({
    notebook: notebook(outputs) as never, prompt: 'How many?', model: 'openai/gpt-4o', portal: 'data.example.test',
    toolCalls: [], instance: 'records.example.test', socrataMcpUrl: null,
  });
}

function review(body: string): string {
  (globalThis as unknown as { __imageLinksReviews: unknown }).__imageLinksReviews = {
    state: 'ready',
    attestations: [{ id: 'r-1', type: 'expert_attestation', packageHash: 'h', createdAt: '2026-11-21T00:00:00.000Z', creatorDisplayName: 'Fixture Reviewer', creatorGithubUrl: 'https://github.com/fixture', signature: null }],
    expertPayloads: { 'r-1': { type: 'expert_attestation', body, rating: 'endorse' } },
    openSheet() {},
  };
  return renderToStaticMarkup(createElement(Session, { session: null },
    createElement(AttestationSection, { slug: 'imglink-record', analysisModel: 'openai/gpt-4o', promptVisibility: 'full_text' })));
}

/** Each renderer, given one markdown text, returns the markup it renders. */
const RENDERERS: [name: string, render: (markdown: string) => string][] = [
  ['the answer', (markdown) => inAnswerView(recordModel(storedPackage(markdown)))],
  ['the sources line', (markdown) => inAnswerView({ ...recordModel(storedPackage('An answer.')), sources: { author: 'Fixture author', line: markdown } })],
  ['a notebook output in markdown form', (markdown) => inAnswerView(liveNotebook([{ output_type: 'display_data', metadata: {}, data: { 'text/markdown': markdown } }]))],
  ["a review's body", (markdown) => review(`First line.\n\n${markdown}`)],
  ["the panel's answer", (markdown) => renderToStaticMarkup(createElement(ResponsePanel, { title: 'Fixture', subtitle: 'Fixture', content: markdown, variant: 'without-mcp', duration_ms: 5, isLoading: false }))],
  ["the steps' summary line", (markdown) => renderToStaticMarkup(createElement(ProgressLog, {
    groups: [], standaloneEntries: [], variant: 'with-mcp', isActive: false, isComplete: true,
    toolsCalled: [{ name: 'search', args: { type: 'catalog', query: markdown }, duration_ms: 5 }], totalDuration_ms: 5,
  }))],
];

/** Every `<img>` in a render whose `src` is not a `data:` address. */
function remoteImages(markup: string): string[] {
  return [...markup.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => !/\bsrc="data:/i.test(tag));
}

/** Every link to the address, with its text. */
function linksTo(markup: string, address: string): { tag: string; text: string }[] {
  return [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter((m) => m[1].includes(`href="${address}"`))
    .map((m) => ({ tag: m[0], text: m[2].replace(/<[^>]+>/g, '') }));
}

// --- The rule -----------------------------------------------------------------------

for (const [name, render] of RENDERERS) {
  test(`images in answers are shown as links: ${name}, with alt text`, () => {
    const markup = render(WITH_ALT);
    assert.ok(markup.includes('Before'), `premise: the text renders: ${markup.slice(0, 400)}`);
    assert.deepEqual(remoteImages(markup), [], 'an image with a remote address renders');
    const links = linksTo(markup, ADDRESS);
    assert.equal(links.length, 1, `not one link to the address: ${JSON.stringify(links)}`);
    assert.equal(links[0].text, ALT, 'the link text is not the alt text');
    assert.match(links[0].tag, /target="_blank"/, 'the link does not open in a new tab');
    assert.match(links[0].tag, /rel="noopener noreferrer"/, 'the link does not carry noopener noreferrer');
  });

  test(`images in answers are shown as links: ${name}, with empty alt text`, () => {
    const markup = render(NO_ALT);
    assert.deepEqual(remoteImages(markup), [], 'an image with a remote address renders');
    const links = linksTo(markup, ADDRESS);
    assert.equal(links.length, 1, `not one link to the address: ${JSON.stringify(links)}`);
    assert.equal(links[0].text, ADDRESS, 'the link text is not the address');
  });
}

// --- The pins -----------------------------------------------------------------------

test("a notebook's own image/png output still renders as an image", () => {
  const markup = inAnswerView(liveNotebook([{ output_type: 'display_data', metadata: {}, data: { 'image/png': PNG } }]));
  assert.ok(markup.includes(`<img src="data:image/png;base64,${PNG}"`), `the image/png output is not an image: ${markup.slice(0, 400)}`);
});

test("a stored record's package bytes are the same after the render", () => {
  const pkg = storedPackage(WITH_ALT);
  const before = JSON.stringify(pkg);
  const markup = inAnswerView(recordModel(pkg));
  assert.equal(JSON.stringify(pkg), before, 'the render changed the stored package');
  assert.equal(pkg.output, WITH_ALT, 'premise: the stored package carries the output as written');
  assert.ok(markup.includes(ALT), 'premise: the render shows the output');
});
