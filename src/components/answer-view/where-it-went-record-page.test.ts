// R6 W4 (#632, ruling W4-D1 = A; premise 4): the record page builds the
// statement this site serves at render, in the page, and hands it to the
// record adapter, whose model renders "Where this question went".
//
// HOW IT IS DRIVEN. The page's default export rendered to static markup under
// `node --test`, with the module hooks `record-page-data-sources.test.ts` uses
// (the page's server reads stubbed; every `.ts`/`.tsx` under `src/`
// transpiled; `@/` mapped to `src/`). The stored package is the saved
// `…-d887c1` (`src/lib/flows/fixtures/record-d887c1.package.json`, read live at
// G0), whose reference names hash 78c516db…; the statement the page builds
// under this test's environment has another hash (checked below as a
// premise), so the section gives the reference line and "not recorded". The
// matched case is driven through the adapter, where the statement is an input
// (`where-it-went-view.test.ts`). A traceless copy of the same package renders
// no section.
//
// At the base the page passes no statement and the view has no section, so
// the first test fails at its look for `data-part="where-it-went"`.
//
// A CLAIM CHECKED IN NODE, NOT IN A BROWSER: the server-rendered markup.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement, type ComponentType, type ReactElement, type ReactNode } from 'react';
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

const STUB_PREFIX = 'file:///r6-w4-record-page-stub/';
const STUB_SOURCE: Record<string, string> = {
  '@/lib/db': `
    const chain = {
      from() { return chain; },
      where() { return chain; },
      async limit() { return (globalThis.__w4Rows ?? []).shift() ?? []; },
    };
    export const db = { select() { return chain; } };`,
  '@/lib/storage': `export async function getPackage() { return globalThis.__w4Package ?? null; }`,
  '@/lib/evidence/lifecycle': `export async function resolveRecordAttestations() { return { lifecycle: { status: 'active', source: 'legacy-columns', chain: [] }, publishedLayoutNodeId: null }; }`,
  '@/lib/evidence/adversarial-eval': `export async function loadEvaluationViews() { return []; }`,
  '@/lib/evidence/sealed-access': `export async function sessionUserIsCreator() { return true; }`,
  'next/headers': `
    export async function headers() {
      const h = { host: 'records.fixture-w4.example', 'x-forwarded-proto': 'https' };
      return { get(name) { return h[name] ?? null; } };
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
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    if (specifier === 'next/navigation' || specifier === 'next/link' || specifier === 'next/server') {
      return nextResolve(`${specifier}.js`, context);
    }
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`where-it-went record-page hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && parent?.startsWith('file:') && fileURLToPath(parent).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(parent)), specifier)));
      if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
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

const globals = globalThis as unknown as Record<string, unknown>;
globals.fetch = async (input: unknown) => {
  throw new Error(`where-it-went record-page test: no network (${String(input)})`);
};

const { REFERENCE_IDENTITY_ENV } = (await import('@/lib/evidence/reference-identity-fixture')) as { REFERENCE_IDENTITY_ENV: Record<string, string> };
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;

const { buildFlowsStatement, statementHash } = (await import('@/lib/flows/statement')) as unknown as {
  buildFlowsStatement: () => Promise<unknown>;
  statementHash: (s: unknown) => string;
};

// --- The record ------------------------------------------------------------------------

const D887C1 = JSON.parse(fs.readFileSync(path.join(SRC, 'lib/flows/fixtures/record-d887c1.package.json'), 'utf8')) as Record<string, unknown>;
const D887C1_HASH = '78c516db86bf5af90f0f0de1f6c3a614b6ff1c9026b27a25620fbc7c52ecd995';
const SLUG = 'noise-trends-in-nyc-last-week-d887c1';
const HEADING = 'Where this question went';
/** Stage C: the summary, the only closed-state text (d887c1 reached one source; Stage D names its runner). */
const SUMMARY = 'Where this question went: the model, the notebook runner and 1 data source.';
const RECORD_SENTENCE = 'This site cannot show what each one keeps for this record.';
const D1_LINE = 'What each one keeps: where a question can go, as of 20 October 2026.';
const DISCLOSURE_LABEL = 'Learn more about how this analysis was produced';

function row(slug: string) {
  return {
    id: `id-${slug}`, slug, title: `TITLE-${slug}`, summary: `SUMMARY-${slug}`, creatorId: 'creator-1',
    model: 'anthropic/claude-haiku-5.5', promptHash: 'x', promptVisibility: 'full_text', jurisdiction: null, civicContext: null,
    contentProfile: 'datHere', captureMethod: 'chat-flow-stream', verificationStatus: 'unverified', consistencyClassification: null,
    visibility: 'public', isPublic: true, basePackageSignature: 'sig', basePackageHash: 'd887c1'.padEnd(64, '0'), basePackageStorageKey: `k-${slug}`,
    withdrawnAt: null, withdrawnReason: null, reinstatedAt: null, reinstatedReason: null, createdAt: new Date('2026-10-20T19:37:21.626Z'),
  };
}
const CREATOR = { id: 'creator-1', displayName: 'CREATOR-w4', githubProfileUrl: null, githubId: null };

const { default: EvidencePage } = (await import('@/app/(app)/evidence/[slug]/page')) as unknown as {
  default: (props: { params: Promise<{ slug: string }> }) => Promise<ReactElement>;
};

async function render(slug: string, pkg: unknown): Promise<string> {
  globals.__w4Rows = [[row(slug)], [CREATOR]];
  globals.__w4Package = structuredClone(pkg);
  const element = await EvidencePage({ params: Promise.resolve({ slug }) });
  const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;
  return renderToStaticMarkup(createElement(Session, { session: null }, element));
}

function elementEnd(html: string, start: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error(`no closing </${tag}> for the element at ${start}`);
}

const unescape = (text: string) =>
  text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// --- The page --------------------------------------------------------------------------

test('premise 4: the record page builds the statement it serves and hands it to the adapter; d887c1 reads as a reference', async () => {
  assert.notEqual(statementHash(await buildFlowsStatement()), D887C1_HASH, 'premise: this test\'s environment serves another statement');
  const html = await render(SLUG, D887C1);
  const m = /<(\w+)\b[^>]*\bdata-part="where-it-went"[^>]*>/.exec(html);
  assert.ok(m !== null, 'the record page renders no where-it-went section');
  const end = elementEnd(html, m.index, m[1]);
  const markup = html.slice(m.index, end);
  const flat = unescape(markup.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ''));
  assert.match(m[0], /^<details\b/, 'the section is a <details>');
  assert.doesNotMatch(m[0], /\bopen\b/, 'closed by default');
  assert.ok(flat.startsWith(SUMMARY), `the section opens with its summary: ${flat.slice(0, 80)}`);
  assert.ok(flat.includes(D1_LINE), `the reference line reads "${D1_LINE}"`);
  assert.match(markup, /<a\b[^>]*href="https:\/\/app\.civicaitools\.org\/api\/flows"[^>]*>where a question can go<\/a>/);
  assert.ok(flat.includes(RECORD_SENTENCE), `the record says "${RECORD_SENTENCE}"`);
  assert.ok(flat.includes('Socrata (socrata-mcp.civicaitools.org)'), 'Socrata at the record\'s host');
  // Ruling (b) = (i): the sources not reached are not rendered.
  for (const reason of ['Not sent to', 'Off.', 'Not set up on this site.', 'On, not used for this question.']) assert.ok(!flat.includes(reason), `"${reason}" is rendered`);
  const details = html.indexOf(`>${DISCLOSURE_LABEL}<`);
  assert.ok(details > end, 'the section sits before the disclosure, outside it');
  assert.ok(html.indexOf('data-part="steps"') < m.index, 'after the steps');
});

test('criterion 3: on the record page, a package with no trace renders no section', async () => {
  const { trace: _trace, ...traceless } = D887C1;
  void _trace;
  const traced = await render(SLUG, D887C1);
  assert.ok(traced.includes('data-part="where-it-went"'), 'the traced record renders no section');
  const html = await render(`${SLUG}-traceless`, traceless);
  assert.ok(html.includes('data-part="status-row"'), 'premise: the record rendered');
  assert.ok(!html.includes('data-part="where-it-went"') && !html.includes(HEADING), 'a traceless record renders the section');
});
