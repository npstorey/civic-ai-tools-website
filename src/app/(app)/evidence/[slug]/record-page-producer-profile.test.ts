// R10 P5 (civic-ai-tools#289, hub ADR-0038), criterion 4: on a record that
// declares `ai-assisted-analysis/civicaitools-v1`, the record page's profile
// label reads the subtype's display name and links to its guidance bundle.
//
// THE LABEL. `page.tsx` prints the package's `producerProfile` in the
// Verification Status section. On a record declaring the subtype it reads
// "Civic AI Tools profile, v1" (D2's display name), and its href is the url in
// verify-core's subtype table row (`PRODUCER_PROFILE_SUBTYPES[…].bundle.url`),
// read here from the package, never written as a literal. Any other value
// prints as before: "Producer profile: <value>", with no link.
//
// HOW IT IS DRIVEN. The page's default export rendered to static markup under
// `node --test`, with the module hooks `record-page-data-sources.test.ts`
// uses (the page's server reads stubbed; every `.ts`/`.tsx` under `src/`
// transpiled with the TypeScript compiler; `@/` mapped to `src/`). The
// packages are built by the real `buildEvidencePackage` and rendered as
// stored.
//
// WHAT MAKES IT ABLE TO FAIL. Three packages that differ only in
// `producerProfile`: the subtype, `ai-assisted-analysis/datHere`, and none.
// At the base the subtype prints as its raw value with no link, so the
// assertion on the text and the href fails there; the other two are controls
// that read the same on both sides.
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
import { PRODUCER_PROFILE_SUBTYPES } from '@typedstandards/verify-core';

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
const SRC = path.resolve(HERE, '..', '..', '..', '..');

/** The subtype, spelled out: the assertions must not lean on the constant they test. */
const SUBTYPE = 'ai-assisted-analysis/civicaitools-v1';
const DATHERE_SUBTYPE = 'ai-assisted-analysis/datHere';
/** D2's display name (civic-ai-tools#289, ruled A). */
const DISPLAY_NAME = 'Civic AI Tools profile, v1';

// --- Module hooks (as record-page-data-sources.test.ts) ----------------------------

const STUB_PREFIX = 'file:///r10-p5-record-page-stub/';
const STUB_SOURCE: Record<string, string> = {
  '@/lib/db': `
    const chain = {
      from() { return chain; },
      where() { return chain; },
      async limit() { return (globalThis.__p5Rows ?? []).shift() ?? []; },
    };
    export const db = { select() { return chain; } };`,
  '@/lib/storage': `export async function getPackage() { return globalThis.__p5Package ?? null; }`,
  '@/lib/evidence/lifecycle': `export async function resolveRecordAttestations() { return { lifecycle: { status: 'active', source: 'legacy-columns', chain: [] }, publishedLayoutNodeId: null }; }`,
  '@/lib/evidence/adversarial-eval': `export async function loadEvaluationViews() { return []; }`,
  '@/lib/evidence/sealed-access': `export async function sessionUserIsCreator() { return true; }`,
  'next/headers': `
    export async function headers() {
      const h = { host: 'records.example.test', 'x-forwarded-proto': 'https' };
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
      if (found === null) throw new Error(`producer-profile render hook: cannot resolve ${specifier}`);
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
  throw new Error(`producer-profile render test: no network (${String(input)})`);
};

// --- The packages ------------------------------------------------------------------

const { REFERENCE_IDENTITY_ENV } = (await import('@/lib/evidence/reference-identity-fixture')) as {
  REFERENCE_IDENTITY_ENV: Record<string, string>;
};
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;

type Pkg = Record<string, unknown>;
const { buildEvidencePackage } = (await import('@/lib/evidence/packager')) as unknown as {
  buildEvidencePackage: (input: Record<string, unknown>) => { pkg: Pkg };
};

/** A notebook, as the dialog sends one: a datHere record requires it (§8.7.1). */
const NOTEBOOK = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells: [{ cell_type: 'markdown', metadata: {}, source: ['# Street trees planted in 2025'] }],
};

function build(contentProfile: 'datHere' | 'default', producerProfile: string | undefined): Pkg {
  return buildEvidencePackage({
    trace: { resourceSpans: [] },
    prompt: 'How many street trees were planted in 2025?',
    output: 'The dataset records 1,204 plantings in 2025.',
    toolCalls: [{ name: 'get_data', args: { type: 'query', dataset_id: 'abcd-1234', portal: 'data.example.org' }, resultSummary: { rows: 1, columns: 1 } }],
    model: 'openai/gpt-4o',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: contentProfile === 'datHere' ? 'full_text' : 'hash_only',
    title: 'Street trees planted in 2025',
    summary: 'A count of street-tree plantings in one year.',
    captureMethod: 'chat-flow-stream',
    contentProfile,
    ...(producerProfile ? { producerProfile } : {}),
    extensions: { 'org.civicaitools.notebook': NOTEBOOK },
  }).pkg;
}

// --- Render ------------------------------------------------------------------------

function row(slug: string, contentProfile: string | null) {
  return {
    id: `id-${slug}`, slug, title: `TITLE-${slug}`, summary: `SUMMARY-${slug}`, creatorId: 'creator-1',
    model: 'openai/gpt-4o', promptHash: 'x', promptVisibility: contentProfile === 'datHere' ? 'full_text' : 'hash_only',
    jurisdiction: 'NYC', civicContext: null, contentProfile, captureMethod: 'chat-flow-stream',
    verificationStatus: 'unverified', consistencyClassification: null, visibility: 'public', isPublic: true,
    basePackageSignature: 'sig', basePackageHash: 'a'.repeat(64), basePackageStorageKey: `k-${slug}`,
    withdrawnAt: null, withdrawnReason: null, reinstatedAt: null, reinstatedReason: null,
    createdAt: new Date('2026-10-30T12:00:00.000Z'),
  };
}
const CREATOR = { id: 'creator-1', displayName: 'CREATOR', githubProfileUrl: null, githubId: null };

const { default: EvidencePage } = (await import('./page.tsx')) as unknown as {
  default: (props: { params: Promise<{ slug: string }> }) => Promise<ReactElement>;
};

async function render(slug: string, contentProfile: string | null, pkg: Pkg): Promise<string> {
  globals.__p5Rows = [[row(slug, contentProfile)], [CREATOR]];
  globals.__p5Package = structuredClone(pkg);
  const element = await EvidencePage({ params: Promise.resolve({ slug }) });
  const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;
  return renderToStaticMarkup(createElement(Session, { session: null }, element));
}

/** The Verification Status section's body: from its heading to the end of the disclosure's sections. */
function verificationSection(html: string): string {
  const start = html.indexOf('>Verification Status</h2>');
  assert.ok(start >= 0, 'premise: the page rendered its Verification Status section');
  return html.slice(start, start + 4000);
}

/** Every `<a …>text</a>` in a fragment, as { href, text }. */
function links(fragment: string): Array<{ href: string | null; text: string; tag: string }> {
  const out: Array<{ href: string | null; text: string; tag: string }> = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  for (let m = re.exec(fragment); m !== null; m = re.exec(fragment)) {
    const href = /\shref="([^"]*)"/.exec(m[1]);
    out.push({ href: href ? href[1].replace(/&amp;/g, '&') : null, text: m[2].replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ''), tag: m[1] });
  }
  return out;
}

const textOf = (fragment: string) => fragment.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ');

// --- Criterion 4 ---------------------------------------------------------------------

const BUNDLE_URL = (PRODUCER_PROFILE_SUBTYPES as Record<string, { bundle?: { url: string } }>)[SUBTYPE]?.bundle?.url;

test('4: premise: verify-core\'s table row for the subtype names a bundle url, and each package states its producerProfile as built', () => {
  assert.equal(typeof BUNDLE_URL, 'string', 'the subtype row names no bundle url');
  assert.equal(build('datHere', SUBTYPE).producerProfile, SUBTYPE);
  assert.equal(build('default', SUBTYPE).producerProfile, SUBTYPE);
  assert.equal(build('datHere', DATHERE_SUBTYPE).producerProfile, DATHERE_SUBTYPE);
  assert.equal(build('default', undefined).producerProfile, undefined);
});

for (const [contentProfile, slug] of [['datHere', 'subtype-full-text'], ['default', 'subtype-hash-only']] as const) {
  test(`4: a ${contentProfile} record declaring the subtype: the label reads "${DISPLAY_NAME}" and links to the bundle in verify-core's table`, async () => {
    const section = verificationSection(await render(slug, contentProfile, build(contentProfile, SUBTYPE)));
    const label = links(section).filter((l) => l.text === DISPLAY_NAME);
    assert.equal(label.length, 1, `the label does not read "${DISPLAY_NAME}" as one link: ${textOf(section).slice(0, 400)}`);
    assert.equal(label[0].href, BUNDLE_URL, 'the label does not link to the bundle url of the subtype\'s table row');
    assert.match(label[0].tag, /target="_blank"/, 'the bundle opens in place of the record');
    assert.match(label[0].tag, /rel="noopener noreferrer"/);
    assert.doesNotMatch(textOf(section), /Producer profile: ai-assisted-analysis\/civicaitools-v1/, 'the raw value still prints as the label');
  });
}

test('4: a record declaring ai-assisted-analysis/datHere prints as before, with no link', async () => {
  const section = verificationSection(await render('dathere-subtype', 'datHere', build('datHere', DATHERE_SUBTYPE)));
  assert.match(section, /<span style="font-size:13px;color:var\(--text-muted\)">Producer profile: (<!-- -->)?ai-assisted-analysis\/datHere<\/span>/);
  assert.equal(links(section).some((l) => l.href === BUNDLE_URL), false, 'a record of another subtype links to this subtype\'s bundle');
});

test('4: a record with no producerProfile prints no label', async () => {
  const section = verificationSection(await render('no-profile', null, build('default', undefined)));
  assert.doesNotMatch(section, /Producer profile/);
  assert.equal(links(section).some((l) => l.text === DISPLAY_NAME), false);
});
