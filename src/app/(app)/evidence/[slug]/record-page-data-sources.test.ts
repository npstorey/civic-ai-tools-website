// R7 WF, criterion D3 (#617): the record page's "Data sources" line for a
// Charter-only record names the source in the reader's language.
//
// THE LINE. `page.tsx` writes `formatDataSourcesSummary(renderPkg.dataSources)`
// into section C, or "—" when it returns null, through the shim's default
// registry. Before this phase a Charter-only run signed `dataSources: []`, so
// the line read "—". A package carrying the entry, read against the harness's
// three-source registry, would read "Nyc Charter" (the harness capitalises an
// id it does not know). Neither is the source's name. The line reads
// "NYC Charter, Laws and Rules": the manifest's display name, without the
// "MCP Server" suffix, which is implementation language on a reader surface
// (`docs/design-principles.md`).
//
// HOW IT IS DRIVEN. The page's default export rendered to static markup under
// `node --test`, with the module hooks `record-page-layout.test.ts` uses (the
// page's server reads stubbed; every `.ts`/`.tsx` under `src/` transpiled with
// the TypeScript compiler; `@/` mapped to `src/`). Two packages, both
// Charter-only:
//   - BUILT: made in this test by the real `buildEvidencePackage` from a
//     Charter-only trace, then rendered as stored. At 931fa48 it carries no
//     entry and the line reads "—";
//   - STORED: a package carrying the entry exactly as the packager now writes
//     it. At 931fa48 the line reads "Nyc Charter".
// No edit to `page.tsx`: the name reaches the page through the shim's default.
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
const SRC = path.resolve(HERE, '..', '..', '..', '..');

// --- Module hooks (as record-page-layout.test.ts) ---------------------------------

const STUB_PREFIX = 'file:///r7-wf-d3-stub/';
const STUB_SOURCE: Record<string, string> = {
  '@/lib/db': `
    const chain = {
      from() { return chain; },
      where() { return chain; },
      async limit() { return (globalThis.__wfRows ?? []).shift() ?? []; },
    };
    export const db = { select() { return chain; } };`,
  '@/lib/storage': `export async function getPackage() { return globalThis.__wfPackage ?? null; }`,
  '@/lib/evidence/lifecycle': `export async function resolveLifecycle() { return { status: 'active', source: 'legacy-columns', chain: [] }; }`,
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
      if (found === null) throw new Error(`data-sources render hook: cannot resolve ${specifier}`);
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
  throw new Error(`data-sources render test: no network (${String(input)})`);
};

// --- The packages ------------------------------------------------------------------

const { REFERENCE_IDENTITY_ENV } = (await import('@/lib/evidence/reference-identity-fixture')) as {
  REFERENCE_IDENTITY_ENV: Record<string, string>;
};
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;

const { buildEvidencePackage } = (await import('@/lib/evidence/packager')) as unknown as {
  buildEvidencePackage: (input: Record<string, unknown>) => { pkg: Record<string, unknown> & { dataSources: unknown[] } };
};
const { CIVIC_MANIFEST } = await import('@typedstandards/civic-typed-router');
const { hostedServerPurl } = (await import('@/lib/mcp/registry')) as {
  hostedServerPurl: (hosting: { package: string; version: string }) => string;
};

const CHARTER = CIVIC_MANIFEST.find((entry) => entry.sourceId === 'nyc-charter');
// Router 0.4.0 (#632 D11): the pin is the entry's npm-package hosting variant.
const CHARTER_PIN = CHARTER?.hostings.find((variant) => variant.kind === 'npm-package');
if (!CHARTER || CHARTER_PIN?.kind !== 'npm-package') throw new Error('premise: the manifest holds a hosted nyc-charter entry');
const CHARTER_PURL = hostedServerPurl(CHARTER_PIN);

/** The name the line must read: the manifest's display name, without "MCP Server". */
const READER_NAME = 'NYC Charter, Laws and Rules';

const START_SEC = 1_760_000_000;
const NANOS = '000000000';

function charterTrace(): Record<string, unknown> {
  const attrs = (entries: Record<string, string>) => Object.entries(entries).map(([key, stringValue]) => ({ key, value: { stringValue } }));
  const root = {
    traceId: 'c0ffee00c0ffee00c0ffee00c0ffee00',
    spanId: 'cccccccccccc0000',
    name: 'analysis',
    kind: 1,
    startTimeUnixNano: `${START_SEC}${NANOS}`,
    endTimeUnixNano: `${START_SEC + 30}${NANOS}`,
    attributes: attrs({ 'analysis.mcp_servers': JSON.stringify([{ url: CHARTER_PURL, name: 'nyc-charter' }]) }),
    events: [],
    status: { code: 1 },
  };
  const span = {
    traceId: root.traceId,
    spanId: 'dddddddddddd0001',
    parentSpanId: root.spanId,
    name: 'mcp_tool_call',
    kind: 1,
    startTimeUnixNano: `${START_SEC + 1}${NANOS}`,
    endTimeUnixNano: `${START_SEC + 2}${NANOS}`,
    attributes: attrs({
      'tool.name': 'nyc_charter__get_section',
      'tool.operation_type': 'query',
      'tool.arguments': JSON.stringify({ citation: '26-504', corpus: 'admin_code' }),
      'mcp.source': 'nyc-charter',
    }),
    events: [],
    status: { code: 1 },
  };
  return { resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: 'test', version: '1' }, spans: [root, span] }] }] };
}

const BUILT = buildEvidencePackage({
  trace: charterTrace(),
  prompt: 'What does section 26-504 of the Administrative Code cover?',
  output: 'Section 26-504 defines the housing accommodations subject to rent stabilization.',
  toolCalls: [{ name: 'nyc_charter__get_section', args: { citation: '26-504', corpus: 'admin_code' }, resultSummary: { rows: 1, columns: 1 } }],
  model: 'openai/gpt-4o',
  tokenUsage: { promptTokens: 10, completionTokens: 5 },
  promptVisibility: 'full_text',
  title: 'Charter-only run',
  summary: 'Charter-only run.',
}).pkg;

/** A Charter-only package carrying the entry as the packager writes it. */
const STORED = {
  ...structuredClone(BUILT),
  dataSources: [{ sourceId: 'nyc-charter', catalogType: 'npm-package', portalUrl: CHARTER_PURL, accessTimestamp: '2026-10-17T12:00:00.000Z' }],
};

// --- Render ------------------------------------------------------------------------

function row(slug: string) {
  return {
    id: `id-${slug}`, slug, title: `TITLE-${slug}`, summary: `SUMMARY-${slug}`, creatorId: 'creator-1',
    model: 'openai/gpt-4o', promptHash: 'x', promptVisibility: 'full_text', jurisdiction: 'NYC', civicContext: null,
    contentProfile: null, captureMethod: 'chat-flow-stream', verificationStatus: 'unverified', consistencyClassification: null,
    visibility: 'public', isPublic: true, basePackageSignature: 'sig', basePackageHash: 'a'.repeat(64), basePackageStorageKey: `k-${slug}`,
    withdrawnAt: null, withdrawnReason: null, reinstatedAt: null, reinstatedReason: null, createdAt: new Date('2026-10-17T12:00:00.000Z'),
  };
}
const CREATOR = { id: 'creator-1', displayName: 'CREATOR', githubProfileUrl: null, githubId: null };

const { default: EvidencePage } = (await import('./page.tsx')) as unknown as {
  default: (props: { params: Promise<{ slug: string }> }) => Promise<ReactElement>;
};

async function render(slug: string, pkg: unknown): Promise<string> {
  globals.__wfRows = [[row(slug)], [CREATOR]];
  globals.__wfPackage = structuredClone(pkg);
  const element = await EvidencePage({ params: Promise.resolve({ slug }) });
  const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;
  return renderToStaticMarkup(createElement(Session, { session: null }, element));
}

/** Section C's label → value pairs (the markup `record-page-layout.test.ts` reads). */
function cItems(html: string): Map<string, string> {
  const items = new Map<string, string>();
  const re = /<div data-part="c-item"[^>]*><div[^>]*>([^<]*)<\/div><div[^>]*>([\s\S]*?)<\/div><\/div>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) items.set(m[1], m[2].replace(/<[^>]*>/g, ''));
  return items;
}

const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

for (const [label, slug, pkg] of [
  ['built by the real packager from a Charter-only run', 'charter-built', BUILT],
  ['stored with the entry as the packager writes it', 'charter-stored', STORED],
] as const) {
  test(`D3: a Charter-only record's Data sources line names the source (${label})`, async () => {
    const html = await render(slug, pkg);
    const items = cItems(html);
    assert.ok(items.has('Content profile'), 'premise: section C rendered its items');
    const line = items.get('Data sources');
    assert.notEqual(line, '—', 'the line reads "—": the record states no data source');
    assert.notEqual(line, 'Nyc Charter', 'the line reads the harness\'s capitalised fallback for an unknown id');
    assert.equal(line, escaped(READER_NAME), 'the line does not name the source in the reader\'s language');
  });
}

test('D3: the name is the manifest\'s display name, in the reader\'s language', () => {
  assert.equal(`${READER_NAME} MCP Server`, CHARTER.displayName, 'premise: the manifest names the source with the suffix');
});
