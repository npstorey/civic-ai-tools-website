// LAYOUT-W1 P2: the record page renders sections A-G for every record, in the
// answer-first order, whatever the record's content profile.
//
// THE LAYOUT, top to bottom, by position in the rendered markup:
//   outside, above the answer — the unsigned, sealed and withdrawal banners;
//     the header; the status row (ruling D1: the notebook's own reading, then
//     the spec link and the notebook download for A-G-format records); the
//     refused-request lines (ruling D2: "N of M requests did not complete."
//     and the unrecorded-outcomes sentence);
//   the answer, with no section heading, then the citation block (ruling D3);
//   one <details>, closed, summary "Learn more about how this analysis was
//     produced" (ruling D4), holding A-G, then Provenance Graph, Additional
//     Artifacts, Adversarial evaluations, Attestations, Verification Status;
//   outside, after it — Status History, Actions, Package hash.
//
// HOW IT IS DRIVEN. The page's default export, called with `params`, and the
// element it returns rendered to static markup with `react-dom/server` under
// `node --test`. `module.registerHooks()` (in-file, as the P1 render test and
// the route tests use it) transpiles `.ts`/`.tsx` under `src/` with the
// TypeScript compiler already in devDependencies, maps `@/` to `src/`, and
// stubs the page's server reads:
//   - `@/lib/db`: no database; each `select…limit` answers the next row the
//     test queued (the record, then its creator);
//   - `@/lib/storage`: `getPackage` answers the fixture package as stored;
//   - `@/lib/evidence/lifecycle`, `@/lib/evidence/adversarial-eval`: the
//     lifecycle and evaluation views the test set;
//   - `@/lib/evidence/sealed-access`: the viewer is the record's creator, so a
//     sealed fixture renders rather than 404s;
//   - `next/headers`: a request host;
//   - `globalThis.fetch`: answers the blob URLs the blob fixtures name (one
//     whose bytes verify, and the W3 fix's two that do not), counts each
//     request, and refuses everything else, so no test reaches a network.
// The packages are rendered as stored: no field is rewritten for the render.
//
// A CLAIM CHECKED IN NODE, NOT IN A BROWSER. This reads the server-rendered
// markup. A closed <details> keeps its children in that markup, which is what
// lets the contents be asserted; that a browser shows them only on a click is
// the element's own behaviour, not measured here. Client components render
// their first pass only (no effects run): the integrity glance reads
// "Checking integrity…".
//
// THE FIXTURES CAN FAIL. The A-G fixture's refused call is on a dataset no
// other call touched, beside an unrecorded call, so a count by "not returned"
// would read two. The old-format fixture with a notebook is one the bundle
// route refuses (content profile not `datHere`, `bundle/route.ts:181-188`).
// Every fixture renders every part it is asserted over with content of its own.
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
import { createElement, type ComponentType, type ReactElement, type ReactNode } from 'react';
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
const SRC = path.resolve(HERE, '..', '..', '..', '..');
const REPO = path.resolve(SRC, '..');

// --- Module hooks ---------------------------------------------------------------

const STUB_PREFIX = 'file:///layout-w1-p2-stub/';
const STUB_SOURCE: Record<string, string> = {
  '@/lib/db': `
    const chain = {
      from() { return chain; },
      where() { return chain; },
      async limit() { return (globalThis.__p2Rows ?? []).shift() ?? []; },
    };
    export const db = { select() { return chain; } };`,
  '@/lib/storage': `export async function getPackage() { return globalThis.__p2Package ?? null; }`,
  '@/lib/evidence/lifecycle': `export async function resolveRecordAttestations() { return { lifecycle: globalThis.__p2Lifecycle, publishedLayoutNodeId: globalThis.__p2PublishedLayoutNodeId ?? null }; }`,
  '@/lib/evidence/adversarial-eval': `export async function loadEvaluationViews() { return globalThis.__p2Evaluations ?? []; }`,
  '@/lib/evidence/sealed-access': `export async function sessionUserIsCreator() { return true; }`,
  'next/headers': `
    export async function headers() {
      const h = globalThis.__p2Headers ?? {};
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

// LAYOUT-WEB W3 P2 (5): FOR SkillSection.tsx ONLY, `react` is the real module
// with one change — while `globalThis.__p2OpenSkill` is set, the section's
// open/closed state starts open, so the render shows B's text as a reader who
// clicked "Show full system prompt" sees it. The real hook is still called, so the
// hook order is the component's own.
const SKILL_SECTION_FILE = path.join(SRC, 'components', 'evidence', 'SkillSection.tsx');
const REACT_URL = pathToFileURL(createRequire(import.meta.url).resolve('react')).href;
const OPEN_SKILL_URL = 'file:///layout-web-w3-p2-open-skill/react.mjs';
const OPEN_SKILL_SOURCE = `
  import React from '${REACT_URL}';
  export function useState(initial) {
    const real = React.useState(initial);
    return globalThis.__p2OpenSkill === true && initial === false ? [true, real[1]] : real;
  }`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const from = (context as { parentURL?: string }).parentURL;
    if (specifier === 'react' && from?.startsWith('file:') && fileURLToPath(from) === SKILL_SECTION_FILE) {
      return { url: OPEN_SKILL_URL, format: 'module', shortCircuit: true };
    }
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    // Next's bundler resolves these subpaths; Node's resolver needs the file.
    if (specifier === 'next/navigation' || specifier === 'next/link' || specifier === 'next/server') {
      return nextResolve(`${specifier}.js`, context);
    }
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`layout test hook: cannot resolve ${specifier}`);
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
    if (loadUrl === OPEN_SKILL_URL) return { format: 'module', source: OPEN_SKILL_SOURCE, shortCircuit: true };
    if (loadUrl.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    if (loadUrl.startsWith('file:')) {
      const file = fileURLToPath(loadUrl);
      if (file.startsWith(SRC) && /\.tsx?$/.test(file)) {
        const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          fileName: file,
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        });
        return { format: 'module', source: out.outputText, shortCircuit: true };
      }
    }
    return nextLoad(loadUrl, context);
  },
});

const globals = globalThis as unknown as Record<string, unknown>;

// --- Fixtures -------------------------------------------------------------------

const DISCLOSURE_LABEL = 'Learn more about how this analysis was produced';
const HOST = 'records.example.test';

const AGF_ANSWER = 'AGFANSWER-p2-41c9';
const OLD_ANSWER = 'OLDANSWER-p2-8d2e';

/** The blob the old-format fixture's output points at, as the page fetches it. */
const OLD_OUTPUT_TEXT = `${OLD_ANSWER}: **17** permits were issued in the window.`;
const OLD_OUTPUT_BYTES = Buffer.from(OLD_OUTPUT_TEXT, 'utf8');
const OLD_OUTPUT_HASH = createHash('sha256').update(OLD_OUTPUT_BYTES).digest('hex');
const OLD_OUTPUT_URL = `https://blobs.example.test/evidence-refs/${OLD_OUTPUT_HASH}.md`;

/** The bytes each blob URL a fixture names answers with (the W3 fix adds two that do not verify). */
const BLOB_BYTES = new Map<string, Buffer>([[OLD_OUTPUT_URL, OLD_OUTPUT_BYTES]]);
/** How many times each blob URL was requested, so a test can count the page's fetches. */
const BLOB_REQUESTS = new Map<string, number>();

globals.fetch = async (input: unknown) => {
  const url = String(input instanceof URL ? input.href : (input as { url?: string }).url ?? input);
  const bytes = BLOB_BYTES.get(url);
  if (bytes !== undefined) {
    BLOB_REQUESTS.set(url, (BLOB_REQUESTS.get(url) ?? 0) + 1);
    return new Response(new Uint8Array(bytes), { status: 200, headers: { 'Content-Type': 'text/markdown' } });
  }
  throw new Error(`layout test: no network (${url})`);
};

function notebook(provenance: 'executed' | 'skeleton' | null, marker: string) {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      extensions: provenance === null ? {} : { 'org.civicaitools.notebook': { provenance } },
    },
    cells: [{ cell_type: 'markdown', metadata: {}, source: [`# ${marker}\n`] }],
  };
}

const PROVENANCE_GRAPH = {
  '@context': { prov: 'http://www.w3.org/ns/prov#' },
  '@graph': [{ '@id': 'urn:example:activity', '@type': 'prov:Activity', 'dcterms:title': 'PROVGRAPHMARKER-p2' }],
};

const OTHER_EXTENSION = 'org.example.otherartifact';

/** A-G format: refused call on a dataset no other call touched, beside an unrecorded one. */
const AGF_PACKAGE = {
  metadata: {
    schemaVersion: '0.1.0',
    packageId: 'p2-agf',
    createdAt: '2026-10-09T16:10:07.804Z',
    signingKeyId: 'platform:fixture',
    captureMethod: 'chat-flow-stream',
    contentProfile: 'datHere',
  },
  producerProfile: 'ai-assisted-analysis/datHere',
  type: 'content/analysis/v1',
  prompt: { hash: 'd'.repeat(64), visibility: 'full_text', text: 'AGFPROMPT-p2 Noise trends last week?' },
  queries: [
    {
      tool: 'get_data', operationType: 'query', datasetId: 'aaaa-1111', portal: 'data.example.test',
      arguments: { dataset_id: 'aaaa-1111', where: "created_date > '2026-10-01'" },
      resultRows: 12, resultColumns: 3, duration_ms: 410,
    },
    {
      tool: 'get_data', operationType: 'query', datasetId: 'bbbb-2222', portal: 'data.example.test',
      arguments: { dataset_id: 'bbbb-2222', where: 'REFUSEDARG-p2' },
      failed: true, failureKind: 'timeout', duration_ms: 1200,
    },
    {
      tool: 'search', operationType: 'catalog',
      arguments: { query: 'UNRECORDEDARG-p2' }, duration_ms: 95,
    },
  ],
  cost: { model: 'openai/gpt-4o', promptTokens: 33873, completionTokens: 448, totalTokens: 34321, durationMs: 71461 },
  skillMetadata: { skillText: 'AGFSKILLTEXT-p2', systemPromptHash: 'e'.repeat(64) },
  output: `${AGF_ANSWER}: **42** complaints in the window.`,
  summary: 'AGFSUMMARY-p2',
  dataSources: [
    {
      sourceId: 'socrata', catalogType: 'socrata', portalUrl: 'https://data.example.test',
      datasetId: 'aaaa-1111', datasetUrl: 'https://data.example.test/d/aaaa-1111', accessTimestamp: '2026-10-09T16:09:00Z',
    },
  ],
  provenance: PROVENANCE_GRAPH,
  extensions: {
    'org.civicaitools.environment': {
      modelVersion: 'openai/gpt-4o-2024',
      temperature: 0,
      mcpServers: [{ url: 'https://mcp.example.test', name: 'example' }],
      host: 'records.example.test',
    },
    'org.civicaitools.notebook': notebook('executed', 'AGFNOTEBOOK-p2'),
    [OTHER_EXTENSION]: { note: 'other' },
  },
};

/** Old format: no outcome stated for any request, output stored as a blob, no package summary. */
const OLD_PACKAGE = {
  metadata: {
    schemaVersion: '0.1.0',
    packageId: 'p2-old',
    createdAt: '2026-05-02T10:00:00.000Z',
    signingKeyId: 'platform:fixture',
  },
  prompt: { hash: 'f'.repeat(64), visibility: 'full_text', text: 'OLDPROMPT-p2 How many permits?' },
  queries: [
    { tool: 'get_data', operationType: 'metadata', datasetId: 'cccc-3333', portal: 'data.example.test', arguments: { dataset_id: 'cccc-3333' }, duration_ms: 222 },
    { tool: 'get_data', operationType: 'query', datasetId: 'cccc-3333', portal: 'data.example.test', arguments: { dataset_id: 'cccc-3333', select: 'count(*)' } },
  ],
  cost: { model: 'anthropic/claude-sonnet-4', promptTokens: 1200, completionTokens: 300, totalTokens: 1500, durationMs: 9000 },
  skillMetadata: { skillText: 'OLDSKILLTEXT-p2', systemPromptHash: '9'.repeat(64) },
  output: {
    ref: `blob:sha256:${OLD_OUTPUT_HASH}`,
    url: OLD_OUTPUT_URL,
    contentType: 'text/markdown',
    size: OLD_OUTPUT_BYTES.length,
  },
  dataSources: [
    {
      sourceId: 'data-commons', catalogType: 'data-commons', portalUrl: 'https://api.example.test/mcp',
      accessTimestamp: '2026-05-02T09:59:00Z',
    },
  ],
  provenance: PROVENANCE_GRAPH,
  extensions: {
    'org.civicaitools.notebook': notebook(null, 'OLDNOTEBOOK-p2'),
    [OTHER_EXTENSION]: { note: 'other' },
  },
};

/** Old format, sealed and unsigned, a skeleton notebook, a hash-only prompt and skill prompt. */
const SKELETON_PACKAGE = {
  metadata: {
    schemaVersion: '0.1.0',
    packageId: 'p2-skeleton',
    createdAt: '2026-06-01T12:00:00.000Z',
    signingKeyId: 'platform:fixture',
  },
  prompt: { hash: '7'.repeat(40) + 'abcdef0123456789abcdef01', visibility: 'hash_only' },
  queries: [
    { tool: 'get_data', operationType: 'query', arguments: { dataset_id: 'dddd-4444' }, resultRows: 3 },
  ],
  cost: { model: 'openai/gpt-4o', promptTokens: 10, completionTokens: 5, durationMs: 100 },
  skillMetadata: { systemPromptHash: '5'.repeat(12) + 'HASHONLYTAIL' },
  output: 'SKELETONANSWER-p2',
  extensions: {
    'org.civicaitools.notebook': notebook('skeleton', 'SKELETONNOTEBOOK-p2'),
  },
};

interface RecordRow {
  slug: string;
  title: string;
  summary: string;
  contentProfile: string | null;
  visibility: string;
  basePackageSignature: string | null;
  basePackageHash: string | null;
  basePackageStorageKey: string | null;
}

function row(r: RecordRow) {
  return {
    id: `id-${r.slug}`,
    creatorId: 'creator-1',
    model: 'openai/gpt-4o',
    promptHash: 'x',
    promptVisibility: 'full_text',
    jurisdiction: 'JURISDICTIONMARKER-p2',
    civicContext: null,
    captureMethod: 'chat-flow-stream',
    verificationStatus: 'unverified',
    consistencyClassification: null,
    isPublic: true,
    withdrawnAt: null,
    withdrawnReason: null,
    reinstatedAt: null,
    reinstatedReason: null,
    createdAt: new Date('2026-05-02T10:00:00.000Z'),
    ...r,
  };
}

const CREATOR = { id: 'creator-1', displayName: 'CREATORMARKER-p2', githubProfileUrl: null, githubId: null };

const ACTIVE = { status: 'active', source: 'legacy-columns', chain: [] };
const REINSTATED = {
  status: 'active', source: 'legacy-columns', chain: [],
  withdrawnAt: '2026-10-10T00:00:00Z', withdrawnReason: 'WITHDRAWREASON-p2',
  reinstatedAt: '2026-10-11T00:00:00Z', reinstatedReason: 'REINSTATEREASON-p2',
};
const WITHDRAWN = {
  status: 'withdrawn', source: 'legacy-columns', chain: [],
  withdrawnAt: '2026-06-10T00:00:00Z', withdrawnReason: 'WITHDRAWNNOW-p2',
};

const EVALUATIONS = [{
  nodeId: 'n'.repeat(64),
  createdAt: '2026-10-09T17:00:00Z',
  methodology: null,
  results: null,
  signatureValid: true,
  nodeIdMatches: true,
  hasTimestamp: false,
  hasRekor: false,
}];

interface Case {
  record: ReturnType<typeof row>;
  pkg: unknown;
  lifecycle: unknown;
  evaluations: unknown[];
}

const AGF: Case = {
  record: row({
    slug: 'agf-record-p2', title: 'AGFTITLE-p2', summary: 'AGFDBSUMMARY-p2', contentProfile: 'datHere',
    visibility: 'public', basePackageSignature: 'sig', basePackageHash: 'a'.repeat(64), basePackageStorageKey: 'k-agf',
  }),
  pkg: AGF_PACKAGE,
  lifecycle: REINSTATED,
  evaluations: EVALUATIONS,
};

const OLD: Case = {
  record: row({
    slug: 'old-record-p2', title: 'OLDTITLE-p2', summary: 'OLDDBSUMMARY-p2', contentProfile: null,
    visibility: 'public', basePackageSignature: 'sig', basePackageHash: 'b'.repeat(64), basePackageStorageKey: 'k-old',
  }),
  pkg: OLD_PACKAGE,
  lifecycle: WITHDRAWN,
  evaluations: EVALUATIONS,
};

const SKELETON: Case = {
  record: row({
    slug: 'skeleton-record-p2', title: 'SKELETONTITLE-p2', summary: 'SKELETONDBSUMMARY-p2', contentProfile: 'default',
    visibility: 'sealed', basePackageSignature: null, basePackageHash: 'c'.repeat(64), basePackageStorageKey: 'k-skel',
  }),
  pkg: SKELETON_PACKAGE,
  lifecycle: ACTIVE,
  evaluations: [],
};

const NO_PACKAGE: Case = {
  record: row({
    slug: 'no-package-p2', title: 'NOPKGTITLE-p2', summary: 'NOPKGDBSUMMARY-p2', contentProfile: null,
    visibility: 'public', basePackageSignature: 'sig', basePackageHash: '1'.repeat(64), basePackageStorageKey: null,
  }),
  pkg: null,
  lifecycle: ACTIVE,
  evaluations: [],
};

const { default: EvidencePage } = (await import('./page.tsx')) as unknown as {
  default: (props: { params: Promise<{ slug: string }> }) => Promise<ReactElement>;
};

const { AnswerLayoutsProvider } = (await import('@/components/answer-view/AnswerLayoutsProvider')) as unknown as {
  AnswerLayoutsProvider: ComponentType<{ value: unknown; children?: ReactNode }>;
};

/** The page as a reader meets it; with `layouts` (LAYOUT-WEB W4 P1), under the instance's layouts. */
async function render(c: Case, layouts?: unknown): Promise<string> {
  globals.__p2Rows = [[c.record], [CREATOR]];
  // As stored: a fresh copy per render, so nothing one render does reaches the next.
  globals.__p2Package = c.pkg === null ? null : structuredClone(c.pkg);
  globals.__p2Lifecycle = c.lifecycle;
  globals.__p2Evaluations = c.evaluations;
  globals.__p2Headers = { host: HOST, 'x-forwarded-proto': 'https' };
  const page = await EvidencePage({ params: Promise.resolve({ slug: c.record.slug }) });
  const element = layouts === undefined ? page : createElement(AnswerLayoutsProvider, { value: layouts }, page);
  const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;
  return renderToStaticMarkup(createElement(Session, { session: null }, element));
}

const HTML = {
  agf: await render(AGF),
  old: await render(OLD),
  skeleton: await render(SKELETON),
  noPackage: await render(NO_PACKAGE),
};

// --- Markup readers -------------------------------------------------------------

/** End index (exclusive) of the element of `tag` opening at `start`, nesting counted. */
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

interface Disclosure { start: number; end: number; openTag: string; summaryText: string }

/** The `<details>` whose own `<summary>` carries "Learn more", or null. */
function disclosureOf(html: string): Disclosure | null {
  const re = /<details\b[^>]*>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const after = html.slice(m.index + m[0].length);
    const summary = /^<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(after);
    if (summary === null) continue;
    const summaryText = summary[1].replace(/<[^>]*>/g, '');
    if (!summaryText.includes('Learn more')) continue;
    return { start: m.index, end: elementEnd(html, m.index, 'details'), openTag: m[0], summaryText };
  }
  return null;
}

function requireDisclosure(html: string): Disclosure {
  const d = disclosureOf(html);
  assert.ok(d !== null, `no <details> whose summary reads "${DISCLOSURE_LABEL}" is rendered`);
  return d;
}

function at(html: string, needle: string, from = 0): number {
  const i = html.indexOf(needle, from);
  assert.ok(i >= 0, `the markup does not contain ${JSON.stringify(needle)}`);
  return i;
}

function occurrences(html: string, needle: string): number[] {
  const found: number[] = [];
  for (let i = html.indexOf(needle); i >= 0; i = html.indexOf(needle, i + 1)) found.push(i);
  return found;
}

/** What `renderToStaticMarkup` writes for a text node. */
function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

const heading = (title: string) => `>${title}</h2>`;
/** The markup between a section's heading and the next section heading (or `end`). */
function sectionBody(html: string, title: string, end: number): string {
  const from = at(html, heading(title));
  const next = html.indexOf('</h2>', from + heading(title).length);
  return html.slice(from, next === -1 || next > end ? end : next);
}

const ENVELOPE = [
  'A · Initial prompt',
  'B · System prompts',
  'C · Model + environment',
  'D · Deliberative trace',
  'E · Answer notebook',
  'F · Rendered answer',
  'G · Summary',
];
const AFTER_ENVELOPE = [
  'Provenance Graph',
  'Additional Artifacts',
  'Adversarial evaluations',
  'Attestations',
  'Verification Status',
];

// --- Criterion 1: the order, on both formats -----------------------------------

for (const [name, key, answer] of [
  ['A-G format', 'agf', AGF_ANSWER],
  ['old format', 'old', OLD_ANSWER],
] as const) {
  test(`P2 (1) ${name}: header, status row, answer, citation, one closed disclosure, then Status History, Actions, Package hash`, () => {
    const html = HTML[key];
    const title = at(html, '<h1');
    const status = at(html, 'data-part="status-row"');
    const answerAt = at(html, answer);
    const citation = at(html, 'data-part="citation"');
    const d = requireDisclosure(html);
    assert.ok(title < status, 'the header precedes the status row');
    assert.ok(status < answerAt, 'the status row precedes the answer');
    assert.ok(answerAt < citation, 'the citation sits beneath the answer');
    assert.ok(citation < d.start, 'the disclosure follows the citation');
    assert.equal(d.summaryText, DISCLOSURE_LABEL, 'the disclosure summary reads exactly the ruled label');
    assert.doesNotMatch(d.openTag, /\bopen\b/, 'the disclosure is closed by default');
    assert.equal(occurrences(html, DISCLOSURE_LABEL).length, 1, 'one disclosure');

    const history = at(html, heading('Status History'));
    const actions = at(html, heading('Actions'));
    const hash = at(html, 'Package hash: ');
    assert.ok(d.end <= history && history < actions && actions < hash, 'Status History, Actions, Package hash follow the disclosure, in order');

    assert.doesNotMatch(html.slice(0, d.start), /[A-G] · /, 'a section letter precedes the disclosure');
  });

  test(`P2 (1) ${name}: inside the disclosure, A to G, then the parts that follow the envelope, in order`, () => {
    const html = HTML[key];
    const d = requireDisclosure(html);
    let last = d.start;
    for (const t of [...ENVELOPE, ...AFTER_ENVELOPE]) {
      const all = occurrences(html, heading(t));
      assert.equal(all.length, 1, `"${t}" is rendered once`);
      assert.ok(all[0] > last && all[0] < d.end, `"${t}" sits inside the disclosure, after the part before it`);
      last = all[0];
    }
  });
}

test('P2 (1) A-G format: the refused-request line sits between the status row and the answer', () => {
  const html = HTML.agf;
  const status = at(html, 'data-part="status-row"');
  const refused = at(html, 'data-part="refused-requests"');
  const answer = at(html, AGF_ANSWER);
  assert.ok(status < refused && refused < answer, 'status row, refused-request lines, answer');
});

test('P2 (1) a record whose package cannot be loaded keeps the parts that need none, the database summary among them', () => {
  const html = HTML.noPackage;
  const d = requireDisclosure(html);
  // (The JSON-LD block at the top of the page carries the summary too; G is read by its own section.)
  assert.ok(sectionBody(html, 'G · Summary', d.end).includes('NOPKGDBSUMMARY-p2'), 'the database summary renders, as G');
  assert.equal(html.slice(0, d.start).includes(heading('A · Initial prompt')), false, 'no envelope part renders above');
  for (const t of ['Attestations', 'Verification Status']) assert.ok(at(html, heading(t)) < d.end, `${t} renders inside`);
  assert.ok(at(html, heading('Actions')) > d.end, 'Actions renders after the disclosure');
  assert.ok(at(html, 'Package hash: ') > d.end, 'the package hash renders after the disclosure');
});

// --- Criterion 2: rule 3, by text ----------------------------------------------

function before(html: string, needle: string): void {
  const d = requireDisclosure(html);
  const first = at(html, needle);
  assert.ok(first < d.start, `${JSON.stringify(needle)} appears before the disclosure starts`);
}

test('P2 (2) the unsigned, sealed and withdrawal banners render before the disclosure', () => {
  before(HTML.skeleton, 'Unsigned package — no cryptographic commitment');
  before(HTML.skeleton, 'Sealed — not published');
  before(HTML.old, 'This record was withdrawn by the author on');
});

test('P2 (2) each of the three notebook readings renders before the disclosure, in the status row', () => {
  for (const [html, reading] of [
    [HTML.agf, 'Executed in a signed sandbox'],
    [HTML.skeleton, 'Analysis notebook (not executed)'],
    [HTML.old, 'Whether this notebook ran is not stated'],
  ] as const) {
    before(html, reading);
    const status = at(html, 'data-part="status-row"');
    const rowEnd = elementEnd(html, html.lastIndexOf('<div', status), 'div');
    assert.ok(html.slice(status, rowEnd).includes(reading), `the status row states "${reading}"`);
  }
});

test('P2 (2) the refused-request line and the unrecorded-outcomes sentence render before the disclosure, once', () => {
  before(HTML.agf, '1 of 3 requests did not complete.');
  assert.equal(occurrences(HTML.agf, 'requests did not complete.').length, 1, 'the refused-request line is rendered once');
  const unrecorded = 'This record was created on May 2, 2026 and states no outcome for any of its 2 requests';
  before(HTML.old, unrecorded);
  assert.equal(occurrences(HTML.old, unrecorded).length, 1, 'the unrecorded-outcomes sentence is rendered once, not again in D');
});

test('P2 (2) the verify link renders outside the disclosure on a public record', () => {
  for (const html of [HTML.agf, HTML.old]) {
    const d = requireDisclosure(html);
    const verify = at(html, 'https://typedstandards.org/verify?url=');
    assert.ok(verify < d.start || verify >= d.end, 'the verify link is outside the disclosure');
  }
});

// --- Criterion 3: one answer, one citation text --------------------------------

test('P2 (3) the answer renders twice, before the disclosure and as F, with identical markup', () => {
  for (const [html, answer] of [[HTML.agf, AGF_ANSWER], [HTML.old, OLD_ANSWER]] as const) {
    const d = requireDisclosure(html);
    const markers = occurrences(html, answer);
    assert.equal(markers.length, 2, `the answer marker appears exactly twice (found ${markers.length})`);
    assert.ok(markers[0] < d.start, 'the first answer sits before the disclosure');
    assert.ok(markers[1] > at(html, heading('F · Rendered answer')) && markers[1] < at(html, heading('G · Summary')), 'the second is F');
    const parts = occurrences(html, '<div data-part="answer"');
    assert.equal(parts.length, 2, 'the answer element is rendered twice');
    const [first, second] = parts.map((start) => html.slice(start, elementEnd(html, start, 'div')));
    assert.equal(first, second, 'the two answers are the same markup');
  }
});

const PAGE_SOURCE = fs.readFileSync(path.join(HERE, 'page.tsx'), 'utf8');

test('P2 (3) read from the source: the answer has one render site, in the shared view', () => {
  // LAYOUT-WEB W3 P2: the page renders no answer of its own. It renders
  // AnswerView, whose AnswerBody is the one render site every surface shares.
  const code = PAGE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.equal(code.match(/<ReactMarkdown\b/g)?.length ?? 0, 0, 'page.tsx renders markdown of its own');
  assert.equal(code.match(/<AnswerView\b/g)?.length ?? 0, 1, 'page.tsx renders one AnswerView');
  const view = fs.readFileSync(path.join(SRC, 'components', 'answer-view', 'AnswerView.tsx'), 'utf8');
  assert.equal(view.match(/<ReactMarkdown remarkPlugins=/g)?.length ?? 0, 1, 'AnswerView renders the answer’s markdown at one site');
});

test('P2 (3) the citation block renders the builder\'s text for the record, with a Copy button for each', async () => {
  const { buildRecordCitations } = await import('@/lib/evidence/record-citation');
  const html = HTML.agf;
  const start = at(html, 'data-part="citation"');
  const block = html.slice(start, requireDisclosure(html).start);
  const citations = buildRecordCitations({
    title: AGF.record.title,
    creatorName: CREATOR.displayName,
    createdAt: AGF.record.createdAt.toISOString(),
    slug: AGF.record.slug,
    brandName: null,
    origin: `https://${HOST}`,
  });
  assert.equal(citations.length, 2, 'the builder writes two formats');
  for (const c of citations) {
    assert.ok(block.includes(escaped(c.label)), `the block labels "${c.label}"`);
    assert.ok(block.includes(escaped(c.text)), `the block carries the builder's text for "${c.label}"`);
  }
  assert.equal(occurrences(block, '>Copy</button>').length, 2, 'a Copy button for each format');
  assert.ok(/<details\b(?![^>]*\bopen\b)[^>]*>/.test(block), 'the block is collapsed');
});

test('P2 (3) read from the source: the block and the Cite modal both write their text through buildRecordCitations', () => {
  const blockPath = path.join(SRC, 'components', 'evidence', 'CitationBlock.tsx');
  assert.ok(fs.existsSync(blockPath), 'src/components/evidence/CitationBlock.tsx renders the block');
  const actions = fs.readFileSync(path.join(SRC, 'components', 'evidence', 'EvidenceActions.tsx'), 'utf8');
  for (const [name, source] of [
    ['CitationBlock.tsx', fs.readFileSync(blockPath, 'utf8')],
    ['EvidenceActions.tsx', actions],
  ] as const) {
    assert.match(source, /buildRecordCitations\(/, `${name} calls buildRecordCitations`);
    assert.match(
      source,
      /import \{[^}]*\bbuildRecordCitations\b[^}]*\} from '@\/lib\/evidence\/record-citation'/,
      `${name} imports the builder from the one module that owns it`,
    );
    assert.doesNotMatch(source, /Record Package\.|\[(Verified|Published): /, `${name} writes no citation format of its own`);
  }
  assert.match(PAGE_SOURCE, /<CitationBlock\b/, 'the page renders the block');
});

// --- Criterion 4: section D shows the signed per-call fields (ruling D6) -------

function callCards(html: string): string[] {
  const d = requireDisclosure(html);
  const body = sectionBody(html, 'D · Deliberative trace', d.end);
  return occurrences(body, '<div data-part="call"').map((s) => body.slice(s, elementEnd(body, s, 'div')));
}

test('P2 (4) a call that carries datasetId and portal shows both, beside its tool, operation, arguments and outcome', () => {
  const cards = callCards(HTML.agf);
  assert.equal(cards.length, 3, 'one card per call');
  const [returned, refused, unrecorded] = cards;
  for (const [card, dataset, args, outcome] of [
    [returned, 'aaaa-1111', escaped("created_date > '2026-10-01'"), 'Returned 12 rows × 3 columns · 0.4 s'],
    [refused, 'bbbb-2222', 'REFUSEDARG-p2', 'This request did not complete.'],
  ] as const) {
    assert.ok(card.includes('get_data (query)'), 'the tool and operation type');
    assert.ok(card.includes(args), 'the raw arguments');
    assert.ok(card.includes(outcome), `the outcome sentence (${outcome})`);
    assert.ok(card.includes('Dataset') && card.includes(dataset), `the dataset id ${dataset}`);
    assert.ok(card.includes('Portal') && card.includes('data.example.test'), 'the portal');
  }
  assert.ok(unrecorded.includes('search (catalog)'), 'the call without them still shows its tool');
  assert.ok(unrecorded.includes('UNRECORDEDARG-p2'), 'and its arguments');
  assert.ok(unrecorded.includes('No result summary was recorded for this request.'), 'and its outcome');
  assert.doesNotMatch(unrecorded, /Dataset|Portal/, 'a call without them shows neither label');
});

// LAYOUT-W1 P3: a signed `duration_ms` is shown on every card, once. The outcome
// sentence states it for a returned call (" · 0.4 s") and a failed one ("The
// attempt took 1.2 s."; seconds since UX pass row 23); for a call whose outcome is unrecorded it states none,
// so the card shows the raw field as a "Duration" label beside Dataset/Portal.
// No label on a returned or failed card: beside "did not complete" a bare number
// reads as how long the call took to succeed (#413).
const cardText = (card: string) => card.replace(/<[^>]*>/g, '');

test('P3 a call with no stated outcome shows its signed duration; a returned or failed call states it once, in its outcome', () => {
  const [returned, failed, unrecorded] = callCards(HTML.agf);
  assert.ok(cardText(unrecorded).includes('No result summary was recorded for this request.'), 'the A-G unrecorded card is unrecorded');
  assert.ok(cardText(unrecorded).includes('Duration 0.1 s'), 'the A-G unrecorded card shows Duration 0.1 s');

  assert.ok(cardText(returned).includes('Returned 12 rows × 3 columns · 0.4 s'), 'the returned card states its duration in its outcome');
  assert.doesNotMatch(returned, /Duration/, 'no Duration label on a returned card');

  assert.equal(occurrences(cardText(failed), '1.2 s').length, 1, 'the failed card states its duration once');
  assert.ok(cardText(failed).includes('The attempt took 1.2 s.'), 'in the outcome sentence\'s words');
  assert.doesNotMatch(failed, /Duration|1200/, 'no Duration label and no bare number on a failed card');

  const [withDuration, withoutDuration] = callCards(HTML.old);
  assert.ok(cardText(withDuration).includes('No result summary was recorded for this request.'), 'the old-format card is unrecorded');
  assert.ok(cardText(withDuration).includes('Duration 0.2 s'), 'the old-format unrecorded card shows Duration 0.2 s');
  assert.doesNotMatch(withoutDuration, /Duration/, 'an entry with no duration_ms shows no Duration label');
});

// --- Criterion 5: the parts only the old format showed (ruling D7) -------------

function cItems(html: string): Map<string, string> {
  const d = requireDisclosure(html);
  const body = sectionBody(html, 'C · Model + environment', d.end);
  const items = new Map<string, string>();
  const re = /<div data-part="c-item"[^>]*><div[^>]*>([^<]*)<\/div><div[^>]*>([\s\S]*?)<\/div><\/div>/g;
  for (let m = re.exec(body); m !== null; m = re.exec(body)) items.set(m[1], m[2].replace(/<[^>]*>/g, ''));
  return items;
}

test('P2 (5) C states the content profile, data sources, system prompt hash, total tokens, tool calls and blob-stored fields', async () => {
  const agf = cItems(HTML.agf);
  const old = cItems(HTML.old);
  assert.equal(agf.get('Content profile'), 'datHere');
  // R10 P5 fix round 1 (W4): the raw value's small print states no value the record does not carry.
  assert.equal(old.get('Content profile'), 'not stated', 'a record with no profile states none');
  assert.equal(old.get('Content shape'), 'plain record', 'a record with no profile shows the default shape (absence is default)');
  const { formatDataSourcesSummary } = await import('@/lib/evidence/data-sources');
  for (const [items, pkg] of [[agf, AGF_PACKAGE], [old, OLD_PACKAGE]] as const) {
    const expected = formatDataSourcesSummary(pkg.dataSources as never);
    assert.ok(expected !== null && expected.length > 0, 'the fixture names a data source');
    assert.equal(items.get('Data sources used'), expected, 'data sources, as the shared formatter states them');
  }
  assert.notEqual(agf.get('Data sources used'), old.get('Data sources used'), 'each record states its own sources');
  assert.equal(agf.get('System prompt hash'), 'e'.repeat(12));
  assert.equal(agf.get('Total tokens'), (34321).toLocaleString());
  assert.equal(agf.get('Tool calls'), '3');
  assert.equal(old.get('Tool calls'), '2');
  assert.equal(old.get('Blob-stored fields'), 'output');
  assert.equal(agf.has('Blob-stored fields'), false, 'no blob-stored fields when none is a blob');
  // A hash-only skill prompt: its hash is disclosed in C. Until R10 P1b it had
  // no section B; since P1b-e, B renders and says the record carries no text
  // (asserted below).
  const skeleton = cItems(HTML.skeleton);
  assert.equal(skeleton.get('System prompt hash'), '555555555555');
  assert.equal(occurrences(HTML.skeleton, heading('B · System prompts')).length, 1, 'B renders once for a hash-only skill prompt (R10 P1b, P1b-e)');
});

// --- R10 P1b (#694): B on a record that carries no text, and on one whose model saw several prompts ---

const textOfMarkup = (markup: string) => markup.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, '')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The skeleton record, its trace stating three prompts, the last the record's, and its composition two components. */
const EARLIER_PROMPTS = ['1'.repeat(64), '2'.repeat(64)];
const llmSpan = (hash: string, i: number) => ({
  name: 'llm_inference', spanId: `llm-${i}`,
  attributes: [{ key: 'gen_ai.system_prompt_hash', value: { stringValue: hash } }, { key: 'gen_ai.inference_index', value: { intValue: String(i) } }],
});
const MANY_PROMPTS: Case = {
  ...SKELETON,
  record: { ...SKELETON.record, slug: 'many-prompts-p1b' },
  pkg: {
    ...SKELETON_PACKAGE,
    trace: { resourceSpans: [{ scopeSpans: [{ spans: [...EARLIER_PROMPTS, SKELETON_PACKAGE.skillMetadata.systemPromptHash].map(llmSpan) }] }] },
    extensions: {
      ...SKELETON_PACKAGE.extensions,
      'org.civicaitools.composition': {
        components: [
          { id: 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server', guidanceHash: '3'.repeat(64) },
          { id: '@typedstandards/civic-typed-router', version: '0.6.0' },
        ],
      },
    },
  },
};

test('R10 P1b, P1b-e: B on a record with no text says so and shows its hash', async () => {
  const { SYSTEM_PROMPT_TEXT: T } = (await import('@/lib/sources/copy')) as unknown as { SYSTEM_PROMPT_TEXT: Record<string, string> };
  const d = requireDisclosure(HTML.skeleton);
  const b = textOfMarkup(sectionBody(HTML.skeleton, 'B · System prompts', d.end));
  assert.ok(b.includes(T.notCarried), 'B does not say the text was not carried');
  assert.ok(b.includes(`${T.hashLabel}: ${SKELETON_PACKAGE.skillMetadata.systemPromptHash}`), 'B does not show the hash');
});

test('R10 P1b: B on a record whose trace states three prompts lists the components and the two earlier prompts by hash', async () => {
  const { SYSTEM_PROMPT_TEXT } = (await import('@/lib/sources/copy')) as unknown as { SYSTEM_PROMPT_TEXT: { manyPrompts: (n: number) => string; componentsIntro: string } };
  const html = await render(MANY_PROMPTS);
  const d = requireDisclosure(html);
  const b = textOfMarkup(sectionBody(html, 'B · System prompts', d.end));
  assert.ok(b.includes(SYSTEM_PROMPT_TEXT.manyPrompts(3)), 'B does not state how many prompts the model saw');
  for (const hash of EARLIER_PROMPTS) assert.ok(b.includes(hash), `B does not list ${hash.slice(0, 8)}`);
  assert.ok(b.includes(SYSTEM_PROMPT_TEXT.componentsIntro), 'B does not introduce the components');
  assert.ok(b.includes('@typedstandards/civic-typed-router 0.6.0'), 'B does not list a component with its version');
  assert.ok(b.includes('3'.repeat(64)), 'B does not list a component\'s guidance hash');
});

// #617 P4 (ruling a2, the named exception to this file's ownership): a hosted
// source is listed in `mcpServers` by the purl of the package it ran, whose
// URL parses with an empty host. The servers line never shows it as an empty
// entry. UX pass row 12: the line is labelled "Data sources this site could
// use", and an entry the manifest names reads as its reader name with the
// pinned version ("NYC Charter, Laws and Rules (0.3.1)"), never the purl; an
// entry it cannot name reads as stored (here, the addressed server's host).
test('R7 P4 a2: C\'s servers line shows a hosted source by name and pinned version, not an empty host or its purl', async () => {
  const PURL = 'pkg:npm/%40betanyc/nyc-charter-laws-rules@0.3.1';
  assert.equal(new URL(PURL).host, '', 'premise: the purl parses with an empty host');
  const pkg = structuredClone(AGF_PACKAGE) as typeof AGF_PACKAGE & { extensions: Record<string, Record<string, unknown>> };
  pkg.extensions['org.civicaitools.environment'].mcpServers = [
    { url: 'https://mcp.example.test', name: 'example' },
    { url: PURL, name: 'nyc-charter' },
  ];
  const html = await render({ ...AGF, pkg });
  assert.equal(cItems(html).get('Data sources this site could use'), 'mcp.example.test, NYC Charter, Laws and Rules (0.3.1)');
  assert.ok(!html.includes('pkg:npm/'), 'the page still prints a purl');
});

test('P2 (5) the blob note sits under the answer in F', () => {
  const html = HTML.old;
  const f = at(html, heading('F · Rendered answer'));
  const g = at(html, heading('G · Summary'));
  const note = at(html, `Output stored as blob (verified) · ${OLD_OUTPUT_BYTES.length.toLocaleString()} bytes`);
  const secondAnswer = occurrences(html, OLD_ANSWER)[1];
  assert.ok(f < secondAnswer && secondAnswer < note && note < g, 'F: the answer, then the note');
  assert.equal(occurrences(HTML.agf, 'Output stored as blob').length, 0, 'no note when the output is inline');
});

test('P2 (5) a hash-only prompt shows its hash in A', () => {
  const html = HTML.skeleton;
  const d = requireDisclosure(html);
  const a = sectionBody(html, 'A · Initial prompt', d.end);
  assert.ok(a.includes('Prompt visibility was hash-only; verbatim text not captured.'), "today's sentence");
  assert.ok(a.includes(SKELETON_PACKAGE.prompt.hash), 'the prompt hash');
});

test('P2 (5) the notebook download (/bundle) renders for the A-G record only', () => {
  assert.ok(HTML.agf.includes(`/api/records/${AGF.record.slug}/bundle`), 'present on the A-G record');
  assert.ok(OLD_PACKAGE.extensions['org.civicaitools.notebook'] !== undefined, 'the old-format fixture carries a notebook');
  assert.equal(occurrences(HTML.old, heading('E · Answer notebook')).length, 1, 'and the page renders it, as E');
  assert.equal(HTML.old.includes('/bundle'), false, 'absent on an old-format record the bundle route refuses');
  assert.equal(HTML.skeleton.includes('/bundle'), false, 'absent on the other old-format record too');
});

test('P2 (5) G shows the package summary, or the database summary when the package carries none', () => {
  const agfD = requireDisclosure(HTML.agf);
  assert.ok(sectionBody(HTML.agf, 'G · Summary', agfD.end).includes('AGFSUMMARY-p2'));
  const oldD = requireDisclosure(HTML.old);
  assert.ok(sectionBody(HTML.old, 'G · Summary', oldD.end).includes('OLDDBSUMMARY-p2'));
  assert.equal(occurrences(HTML.old, heading('Summary')).length, 0, 'the old Summary section is gone');
});

// --- Guard: the fixtures are what they say they are -----------------------------

test('P2 fixtures: the old-format records are ones the bundle route refuses', () => {
  const route = fs.readFileSync(path.join(SRC, 'app', 'api', 'evidence', '[slug]', 'bundle', 'route.ts'), 'utf8');
  assert.match(route, /contentProfile !== 'datHere'/, 'the bundle route refuses a record whose profile is not datHere');
  for (const c of [OLD, SKELETON]) assert.notEqual(c.record.contentProfile, 'datHere');
  assert.ok(fs.existsSync(path.join(REPO, 'package.json')));
});

// --- LAYOUT-WEB W2 P2 (4): section D is unchanged ---------------------------------
//
// Section D, inside the disclosure, keeps the signed per-call fields raw (W1
// ruling D6): the step view outside it is new, D is not. D's markup for the
// records below is compared, byte for byte, with
// `record-page-section-d.golden.txt`.
//
// THE GOLDEN WAS NOT WRITTEN BY HAND. It is this block's output on the base
// (website main 662099b): the base tree, extracted with `git archive`, ran this
// file with `SECTION_D_ACTUAL_OUT` set, and the markup it wrote is the golden.
// RE-CAPTURED the same way on the UX pass branch (row 23: a duration in
// seconds, "· 0.4 s", "The attempt took 1.2 s."); its diff from the base's
// capture is the four duration strings.
//
// THE ONE INTENDED DIFFERENCE is each call's label, which W2 P2 moves from the
// signed `tool` (`socrata__get_data`) to the upstream name. The label's text is
// normalized to `[label]` on both sides, so the golden pins everything else in
// D, and the label is asserted on its own (below, once it changes).
//
// THE FIXTURES CAN FAIL. The A-G record with its tools aliased (a returned
// call with dataset, portal and an elapsed; a rejected call on a dataset no
// other call touches; an unrecorded `search` with neither, whose duration is
// shown raw), and the old-format record (no outcome stated, one entry without
// a duration).

/** The A-G fixture as a record written after the tools were aliased (ADR-0033). */
const ALIASED_AGF_PACKAGE = (() => {
  const pkg = structuredClone(AGF_PACKAGE) as typeof AGF_PACKAGE;
  pkg.queries = pkg.queries.map((q) => ({ ...q, tool: `socrata__${q.tool}` })) as typeof pkg.queries;
  return pkg;
})();
const ALIASED_AGF: Case = { ...AGF, pkg: ALIASED_AGF_PACKAGE };
const HTML_ALIASED_AGF = await render(ALIASED_AGF);

/** Section D's markup, from its heading to the next section's. */
function sectionD(html: string): string {
  return html.slice(at(html, heading('D · Deliberative trace')), at(html, heading('E · Answer notebook')));
}

/** D with each call's label text replaced by `[label]` (the one intended difference). */
function normalizeDLabels(d: string): string {
  return d.replace(/(<div style="font-family:monospace;[^"]*">)([^<]*)(<\/div>)/g, '$1[label]$3');
}

const D_ACTUAL = [
  ['aliased A-G record', HTML_ALIASED_AGF],
  ['old-format record', HTML.old],
].map(([name, html]) => `=== ${name} ===\n${normalizeDLabels(sectionD(html))}\n`).join('');
if (process.env.SECTION_D_ACTUAL_OUT) fs.writeFileSync(process.env.SECTION_D_ACTUAL_OUT, D_ACTUAL);

test('W2 P2 (4) section D renders the same markup as on the base, its labels normalized', () => {
  const goldenPath = path.join(HERE, 'record-page-section-d.golden.txt');
  assert.ok(fs.existsSync(goldenPath), `no golden at ${goldenPath}; it is captured on the base, never written by hand`);
  const golden = fs.readFileSync(goldenPath, 'utf8');
  const calls = ALIASED_AGF_PACKAGE.queries.length + OLD_PACKAGE.queries.length;
  assert.equal(occurrences(D_ACTUAL, '[label]').length, calls, 'one normalized label per call: the normalization still finds every label');
  if (D_ACTUAL === golden) return;
  let i = 0;
  while (i < golden.length && golden[i] === D_ACTUAL[i]) i++;
  assert.fail(`section D differs from the golden at character ${i}:\n  golden: …${golden.slice(Math.max(0, i - 60), i + 80)}…\n  actual: …${D_ACTUAL.slice(Math.max(0, i - 60), i + 80)}…`);
});

// --- LAYOUT-WEB W2 P2 (2): the record page renders its steps -----------------------
//
// THE LAYOUT GAINS ONE PART, between the citation and the disclosure: the step
// view, one step per signed `queries[]` entry, built when the page renders —
// each with the sentence `generateToolReason` writes from the entry's name and
// arguments (through `reasonWithoutIdentifier`) and the outcome
// `describeQueryOutcome` states — under one author line naming the instance
// (`getInstanceAttribution()`), omitted when the instance declares none.
//
// The instance is read from the environment when the page renders; these
// renders set and clear its two variables (and their prior-era names) around
// each call, so what the shell happens to export cannot decide the result.

const INSTANCE = 'records-instance.example.test';
const INSTANCE_ENV = ['PUBLISHER_PUBLICATION_HOST', 'PUBLISHER_SITE_ORIGIN', 'EVIDENCE_PUBLICATION_HOST', 'EVIDENCE_SITE_ORIGIN'];

async function renderWithInstance(c: Case, instance: string | null, layouts?: unknown): Promise<string> {
  const saved = INSTANCE_ENV.map((name) => [name, process.env[name]] as const);
  for (const name of INSTANCE_ENV) delete process.env[name];
  if (instance !== null) process.env.PUBLISHER_PUBLICATION_HOST = instance;
  try {
    return await render(c, layouts);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const STEPS_HTML = {
  agf: await renderWithInstance(AGF, INSTANCE),
  old: await renderWithInstance(OLD, INSTANCE),
  agfAnonymous: await renderWithInstance(AGF, null),
  aliased: await renderWithInstance(ALIASED_AGF, INSTANCE),
};
const STEPS_AUTHOR_LINE = `Steps, written by ${INSTANCE} from the model&#x27;s calls`;

function stepView(html: string): string {
  const start = at(html, '<div data-part="steps"');
  return html.slice(start, elementEnd(html, start, 'div'));
}

function stepsIn(view: string): string[] {
  // The trailing space: `data-part="steps"` and `"step-call"` share the prefix.
  return occurrences(view, '<div data-part="step" ').map((s) => view.slice(s, elementEnd(view, s, 'div')));
}

for (const [name, key, answer, pkg] of [
  ['A-G record', 'agf', AGF_ANSWER, AGF_PACKAGE],
  ['legacy record', 'old', OLD_ANSWER, OLD_PACKAGE],
] as const) {
  test(`W2 P2 (2) ${name}: status row, refused-request line, answer, citation, steps, disclosure`, () => {
    const html = STEPS_HTML[key];
    const status = at(html, 'data-part="status-row"');
    const refused = at(html, 'data-part="refused-requests"');
    const answerAt = at(html, answer);
    const citation = at(html, 'data-part="citation"');
    const steps = at(html, '<div data-part="steps"');
    const d = requireDisclosure(html);
    assert.ok(status < refused && refused < answerAt && answerAt < citation && citation < steps && steps < d.start,
      'status row, refused-request line, answer, citation, steps, disclosure, in that order');
    assert.ok(steps + stepView(html).length <= d.start, 'the step view ends before the disclosure starts');
  });

  test(`W2 P2 (2) ${name}: one step per signed entry, each with the formatters' sentence and outcome`, async () => {
    const { generateToolReason, reasonWithoutIdentifier } = await import('@/lib/streaming');
    const { describeQueryOutcome } = await import('@/lib/evidence/query-step');
    const steps = stepsIn(stepView(STEPS_HTML[key]));
    assert.equal(steps.length, pkg.queries.length, `one step per queries[] entry (found ${steps.length})`);
    pkg.queries.forEach((q, i) => {
      const sentence = reasonWithoutIdentifier(generateToolReason(q.arguments, q.tool));
      const shown = /data-part="step-sentence"[^>]*>([^<]*)</.exec(steps[i])?.[1];
      assert.equal(shown, sentence === undefined ? undefined : escaped(sentence), `step ${i + 1}'s sentence is the function's output`);
      const outcome = describeQueryOutcome(q).text;
      assert.equal(/data-part="step-outcome"[^>]*>([^<]*)</.exec(steps[i])?.[1], escaped(outcome), `step ${i + 1}'s outcome`);
    });
  });

  test(`W2 P2 (2) ${name}: the author line appears exactly once, above the steps`, () => {
    const html = STEPS_HTML[key];
    assert.equal(occurrences(html, STEPS_AUTHOR_LINE).length, 1, 'the author line appears exactly once');
    const view = stepView(html);
    assert.ok(view.indexOf(STEPS_AUTHOR_LINE) >= 0 && view.indexOf(STEPS_AUTHOR_LINE) < view.indexOf('data-part="step"'), 'above the steps');
  });
}

test('W2 P2 (2) no author line when the instance declares none; the steps still render', () => {
  assert.equal(occurrences(STEPS_HTML.agfAnonymous, 'Steps, written by').length, 0);
  assert.equal(stepsIn(stepView(STEPS_HTML.agfAnonymous)).length, AGF_PACKAGE.queries.length);
});

test('W2 P2 (2) the fixtures can tell the sentences apart: not every step reads the same', () => {
  const sentences = stepsIn(stepView(STEPS_HTML.aliased)).map((s) => /data-part="step-sentence"[^>]*>([^<]*)</.exec(s)?.[1]);
  assert.ok(new Set(sentences).size > 1, `the A-G fixture's sentences: ${sentences.join(' | ')}`);
});

// --- LAYOUT-WEB W2 P2 (3): no exposed name in reader-facing text -----------------
//
// The A-G record with its tools aliased (`socrata__get_data`, `socrata__search`).
// What a reader reads — the markup outside `<script>` and `<style>`, attributes
// included — carries no alias separator (`__`) except in section D's raw
// signed fields: each call's arguments (`<pre>`) and its dataset and portal
// (`<code>`). The exposed name stays in the record (`queries[].tool`, the
// graph's `civic:toolName`); this asserts only what the page prints.

function readerFacing(html: string): string {
  const d = requireDisclosure(html);
  const body = sectionD(html);
  const dStart = html.indexOf(body);
  assert.ok(dStart > d.start && dStart < d.end, 'premise: D is inside the disclosure');
  const dWithoutRawFields = body.replace(/<pre\b[\s\S]*?<\/pre>/g, '').replace(/<code\b[\s\S]*?<\/code>/g, '');
  return (html.slice(0, dStart) + dWithoutRawFields + html.slice(dStart + body.length))
    .replace(/<script\b[\s\S]*?<\/script>/g, '')
    .replace(/<style\b[\s\S]*?<\/style>/g, '');
}

test('W2 P2 (3) the record page prints no exposed tool name outside section D’s raw fields', () => {
  assert.ok(ALIASED_AGF_PACKAGE.queries.every((q) => q.tool.includes('__')), 'premise: the record’s tools are aliased');
  const text = readerFacing(STEPS_HTML.aliased);
  const i = text.indexOf('__');
  assert.equal(i, -1, `reader-facing text carries an exposed name: …${text.slice(Math.max(0, i - 80), i + 40)}…`);
});

test('W2 P2 (4) section D labels each call by its upstream name and operation type', async () => {
  const { upstreamToolName } = await import('@/lib/mcp/operation-types');
  const d = sectionD(STEPS_HTML.aliased);
  const labels = [...d.matchAll(/<div style="font-family:monospace;[^"]*">([^<]*)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ALIASED_AGF_PACKAGE.queries.map((q) => `${upstreamToolName(q.tool)}${q.operationType ? ` (${q.operationType})` : ''}`));
});

// --- LAYOUT-WEB W3 P2: the record page renders through the answer view ----------
//
// THE VIEW, by position, on the record (design §4.1; the run surfaces' order,
// W3 P1): the status row (the notebook's reading, the spec link, the notebook
// download) with the refused-request lines under it; the answer; the citation
// block; the steps; one disclosure, holding A-G and then what W1's G0 placed
// after the envelope (Provenance Graph, Additional Artifacts, Adversarial
// evaluations, Attestations, Verification Status); then, outside it, Status
// History and the actions. The page keeps its banners and header above the
// view, and the package hash below it.
//
// NO SOURCES LINE. The run surfaces' part 5 is `buildProvenanceLine` over the
// calls' `args.portal`. A record states each call's portal in `queries[].portal`
// and its sources in `dataSources`, not in the arguments that formatter reads;
// building the line would be a new reader-facing claim over the signed fields,
// which this phase does not make. The part is absent, and asserted absent.
//
// WHO WROTE EACH PART (design §6), computed from §6's words with the fixture's
// instance and model, and only where the record states it — see
// `src/components/answer-view/adapt-record.test.ts`'s header: G carries no
// line (the record does not state what produced its summary), and B carries
// one only for a record its instance's chat flow captured. The status row, the
// actions, D and E carry none (the owner's ruling: §6 gives them no words).

const { formatModelName: modelName } = await import('@/lib/models');
const { upstreamToolName: upstreamOf } = await import('@/lib/mcp/operation-types');

const W3P2 = {
  question: 'Question, written by the person who asked',
  answer: (pkg: { cost: { model: string } }) => `Answer, written by the model ${modelName(pkg.cost.model)}`,
  citation: `Citation, assembled by ${INSTANCE}`,
  steps: `Steps, written by ${INSTANCE} from the model's calls`,
  instructions: `Instructions, written by ${INSTANCE} and the data source's skill`,
};

function unescapeHtml(text: string): string {
  return text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Every author line, by its key, in document order. */
function authorLines(html: string): Array<{ key: string; text: string; at: number }> {
  return [...html.matchAll(/<(\w+)\b[^>]*\bdata-author="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => ({ key: m[2], text: unescapeHtml(m[3].replace(/<!-- -->/g, '').replace(/<[^>]*>/g, '')), at: m.index ?? -1 }));
}

/** The element `<tag … data-part="name"…>` that opens first at or after `from`, or null. */
function partOf(html: string, name: string, from = 0): { start: number; end: number; markup: string } | null {
  const re = new RegExp(`<(\\w+)\\b[^>]*\\bdata-part="${name}"[^>]*>`, 'g');
  re.lastIndex = from;
  const m = re.exec(html);
  if (m === null) return null;
  const end = elementEnd(html, m.index, m[1]);
  return { start: m.index, end, markup: html.slice(m.index, end) };
}

function requirePart(html: string, name: string, from = 0): { start: number; end: number; markup: string } {
  const p = partOf(html, name, from);
  assert.ok(p !== null, `no element with data-part="${name}" is rendered`);
  return p;
}

const VIEW_PARTS = ['status-row', 'answer', 'citation', 'steps', 'sources', 'disclosure', 'actions'] as const;

/** The view's parts this markup renders, in the order they open. */
function partsInOrder(html: string): string[] {
  return VIEW_PARTS
    .map((name) => ({ name, at: partOf(html, name)?.start ?? -1 }))
    .filter((p) => p.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((p) => p.name);
}

const W3P2_HTML = {
  agf: STEPS_HTML.agf,
  old: STEPS_HTML.old,
  /** The legacy record, captured by a Claude Code session: its instructions are that session's. */
  oldClaudeCode: await renderWithInstance({ ...OLD, record: { ...OLD.record, captureMethod: 'claude-code-jsonl-readback' } }, INSTANCE),
  /** The legacy record, with no capture method stated anywhere. */
  oldUnstated: await renderWithInstance({ ...OLD, record: { ...OLD.record, captureMethod: null as unknown as string } }, INSTANCE),
};

for (const [name, key, pkg] of [
  ['A-G record', 'agf', AGF_PACKAGE],
  ['legacy record', 'old', OLD_PACKAGE],
] as const) {
  test(`W3 P2 (1) ${name}: status row, answer, citation, steps, disclosure, actions, in the view’s order, with no sources line`, () => {
    const html = W3P2_HTML[key];
    assert.deepEqual(partsInOrder(html), ['status-row', 'answer', 'citation', 'steps', 'disclosure', 'actions'],
      'the view’s parts, in its order');
    const d = requirePart(html, 'disclosure');
    assert.ok(d.markup.includes(`>${DISCLOSURE_LABEL}</summary>`), 'the disclosure is the view’s, under its label');
    assert.ok(at(html, '<h1') < requirePart(html, 'status-row').start, 'the page’s header sits above the view');
    assert.ok(at(html, 'Package hash: ') > requirePart(html, 'actions').end, 'the package hash sits below the view');
    assert.ok(requirePart(html, 'answer').markup.includes(key === 'agf' ? AGF_ANSWER : OLD_ANSWER), 'the answer part carries the record’s answer');
    assert.equal(stepsIn(requirePart(html, 'steps').markup).length, pkg.queries.length, 'the steps part carries one step per signed entry');
    assert.ok(requirePart(html, 'actions').markup.includes('https://typedstandards.org/verify?url='), 'the actions part carries the verify action');
  });

  test(`W3 P2 (1) ${name}: W1’s placement after the envelope — the five parts inside the view’s disclosure, after G; Status History and the actions outside`, () => {
    const html = W3P2_HTML[key];
    const d = requirePart(html, 'disclosure');
    let last = at(html, heading('G · Summary'));
    assert.ok(last > d.start && last < d.end, 'G sits inside the disclosure');
    for (const t of AFTER_ENVELOPE) {
      const i = at(html, heading(t));
      assert.ok(i > last && i < d.end, `"${t}" sits inside the view’s disclosure, after the part before it`);
      last = i;
    }
    const history = at(html, heading('Status History'));
    const actions = requirePart(html, 'actions');
    assert.ok(d.end <= history && history < actions.start, 'Status History sits after the disclosure, before the actions');
    assert.ok(actions.markup.includes(heading('Actions')), 'the actions part is the page’s Actions section');
  });

  test(`W3 P2 (1) ${name}: each author line reads §6’s words for what the record states`, () => {
    const html = W3P2_HTML[key];
    const d = requirePart(html, 'disclosure');
    const lines = authorLines(html);
    const expected: Array<[string, string, 'outside' | 'inside', number]> = [
      ['answer', W3P2.answer(pkg), 'outside', 2],
      ['citation', W3P2.citation, 'outside', 1],
      ['steps', W3P2.steps, 'outside', 1],
      ['question', W3P2.question, 'inside', 1],
      ['instructions', W3P2.instructions, 'inside', 1],
    ];
    for (const [k, text, where, count] of expected) {
      const found = lines.filter((l) => l.key === k);
      assert.equal(found.length, count, `${count} "${k}" author line(s) (found ${found.length})`);
      for (const l of found) assert.equal(l.text, text, `the "${k}" author line`);
      assert.ok(where === 'inside' ? found[0].at > d.start && found[0].at < d.end : found[0].at < d.start, `the "${k}" line sits ${where} the disclosure`);
    }
    const answers = lines.filter((l) => l.key === 'answer');
    assert.ok(answers[1].at > at(html, heading('F · Rendered answer')), 'the second answer line is F’s');
    assert.deepEqual([...new Set(lines.map((l) => l.key))].sort(), expected.map((e) => e[0]).sort(),
      'no other part carries an author line: not G (unstated), and not the status row, the actions, D or E (ruling A)');
  });
}

test('W3 P2 (1) the A-G record and the legacy record render the same order, the view’s', () => {
  const agf = partsInOrder(W3P2_HTML.agf);
  assert.deepEqual(partsInOrder(W3P2_HTML.old), agf);
  for (const name of ['disclosure', 'actions']) assert.ok(agf.includes(name), `the view’s ${name} part renders on both`);
});

test('W3 P2 (1) B names no author for a record a Claude Code session captured, or one that states no capture method', () => {
  for (const [name, html] of [['Claude Code capture', W3P2_HTML.oldClaudeCode], ['no capture method', W3P2_HTML.oldUnstated]] as const) {
    assert.equal(occurrences(html, heading('B · System prompts')).length, 1, `${name}: premise: B renders`);
    assert.deepEqual(authorLines(html).filter((l) => l.key === 'instructions'), [], `${name}: B carries no author line`);
    assert.ok(authorLines(html).some((l) => l.key === 'question'), `${name}: the other lines stay`);
  }
});

test('W3 P2 (8) the status row, the actions, D and E carry no author line', () => {
  for (const html of [W3P2_HTML.agf, W3P2_HTML.old]) {
    for (const name of ['status-row', 'actions']) {
      assert.doesNotMatch(requirePart(html, name).markup, /data-author=/, `the ${name} part carries an author line`);
    }
    const d = requirePart(html, 'disclosure');
    for (const [from, to] of [['D · Deliberative trace', 'E · Answer notebook'], ['E · Answer notebook', 'F · Rendered answer']] as const) {
      assert.doesNotMatch(html.slice(at(html, heading(from)), at(html, heading(to))), /data-author=/, `${from} carries an author line`);
    }
    assert.ok(at(html, heading('E · Answer notebook')) < d.end, 'premise: E renders, inside the disclosure');
  }
});

// --- W3 P2 item 2: reachable without opening the disclosure -----------------------

test('W3 P2 (2) the citation block, the verify action and every banner sit outside the disclosure', () => {
  for (const [html, isPublic] of [[W3P2_HTML.agf, true], [W3P2_HTML.old, true], [HTML.skeleton, false]] as const) {
    const d = requirePart(html, 'disclosure');
    const citation = requirePart(html, 'citation');
    assert.ok(citation.end <= d.start, 'the citation part closes before the disclosure opens');
    assert.ok(citation.markup.includes('>Copy</button>'), 'the citation part holds the citation block');
    if (!isPublic) continue;
    const verify = at(html, 'https://typedstandards.org/verify?url=');
    assert.ok(verify >= d.end && verify > requirePart(html, 'actions').start, 'the verify action sits in the actions, after the disclosure');
  }
  for (const [html, banner] of [
    [HTML.skeleton, 'Unsigned package — no cryptographic commitment'],
    [HTML.skeleton, 'Sealed — not published'],
    [W3P2_HTML.old, 'This record was withdrawn by the author on'],
  ] as const) {
    assert.ok(at(html, banner) < requirePart(html, 'status-row').start, `"${banner}" sits above the view`);
  }
});

// --- W3 P2 (5): criterion 3 restated, on the record page --------------------------
//
// No text the site writes names a tool by its exposed (aliased) name. Exempt:
// text the record carries word for word — B's composed prompt, the answer
// (first and as F), and D's raw fields — and an upstream name that itself holds
// the separator `__` (`ckan__get_schema`).
//
// THE FIXTURE MAKES EACH EXEMPTION ABLE TO FAIL: B's skill text names
// `socrata__get_data`, and so do the answer and one call's raw `where`; one
// call is shaped like `…b8cc28` (`ckan__get_schema`, operation type `metadata`,
// a `resource_id` argument). B's text reaches the markup only once a reader
// opens "Show full system prompt" (`SkillSection` is closed on its first render),
// so the record is rendered as that reader sees it (the hook above). The
// instrument is shown to fail on a site-written label carrying an alias.

const ALIAS = 'socrata__get_data';
const ALIAS_PACKAGE = (() => {
  const pkg = structuredClone(ALIASED_AGF_PACKAGE) as unknown as Omit<typeof AGF_PACKAGE, 'queries'> & { queries: Array<Record<string, unknown>> };
  pkg.skillMetadata = { ...pkg.skillMetadata, skillText: `ALIASSKILL-w3p2: call ${ALIAS} with type=query to count rows.` };
  pkg.output = `ALIASANSWER-w3p2: the analysis called ${ALIAS} twice.`;
  pkg.queries[1] = { ...pkg.queries[1], arguments: { dataset_id: 'bbbb-2222', where: `note = '${ALIAS}'` } };
  pkg.queries.push({ tool: 'ckan__get_schema', operationType: 'metadata', arguments: { resource_id: '8048697b-ad64-4bfc-b090-ee00169f2323' }, duration_ms: 50 });
  return pkg;
})();
const ALIAS_CASE: Case = { ...AGF, pkg: ALIAS_PACKAGE };

async function renderOpenSkill(c: Case): Promise<string> {
  globals.__p2OpenSkill = true;
  try {
    return await renderWithInstance(c, INSTANCE);
  } finally {
    globals.__p2OpenSkill = false;
  }
}

const ALIAS_HTML = await renderOpenSkill(ALIAS_CASE);

/** The tokens that hold the separator `__`. */
const separated = (text: string) => [...text.matchAll(/[A-Za-z0-9_]*[A-Za-z0-9]__[A-Za-z0-9_]+/g)].map((m) => m[0]);
/** A name is exposed when the dispatch map reads an upstream name out of it. */
const exposed = (token: string) => upstreamOf(token) !== token;

/** The markup with the exempt regions cut out, and the regions. */
function withoutExemptRegions(html: string): { rest: string; exempt: Record<string, string[]> } {
  const exempt: Record<string, string[]> = { answer: [], b: [], d: [] };
  const cut = (text: string, start: number, end: number, into: string[]) => { into.push(text.slice(start, end)); return text.slice(0, start) + text.slice(end); };
  let rest = html.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '');
  for (let p = partOf(rest, 'answer'); p !== null; p = partOf(rest, 'answer')) rest = cut(rest, p.start, p.end, exempt.answer);
  const section = (title: string, next: string, re: RegExp, into: string[]) => {
    const from = at(rest, heading(title));
    const to = at(rest, heading(next));
    const body = rest.slice(from, to).replace(re, (m) => { into.push(m); return ''; });
    rest = rest.slice(0, from) + body + rest.slice(to);
  };
  section('B · System prompts', 'C · Model + environment', /<pre\b[\s\S]*?<\/pre>/g, exempt.b);
  section('D · Deliberative trace', 'E · Answer notebook', /<pre\b[\s\S]*?<\/pre>|<code\b[\s\S]*?<\/code>/g, exempt.d);
  return { rest, exempt };
}

function leaks(html: string): string[] {
  return separated(withoutExemptRegions(html).rest).filter(exposed);
}

test('W3 P2 (5) the record page writes no exposed tool name; B’s prompt, the answer and D’s raw fields are exempt, and a ckan__ name is upstream', () => {
  assert.ok(ALIAS_PACKAGE.queries.filter((q) => String(q.tool).startsWith('socrata__')).length === 3, 'premise: the record’s socrata tools are aliased');
  assert.ok(exposed(ALIAS) && !exposed('ckan__get_schema'), 'premise: the dispatch map reads socrata__get_data as exposed and ckan__get_schema as upstream');
  const { rest, exempt } = withoutExemptRegions(ALIAS_HTML);
  assert.equal(exempt.answer.filter((e) => e.includes(ALIAS)).length, 2, 'the answer names the alias, first and as F: that exemption is exercised');
  assert.equal(exempt.b.filter((e) => e.includes(ALIAS)).length, 1, 'B’s skill text names the alias, as the opened section shows it: that exemption is exercised');
  assert.ok(exempt.d.some((e) => e.includes(ALIAS)), 'a raw field in D names the alias: that exemption is exercised');
  assert.deepEqual(separated(rest).filter(exposed), [], 'site-written text names a tool by its exposed name');
  const upstream = separated(rest);
  assert.ok(upstream.includes('ckan__get_schema'), 'premise: the ckan__ call’s upstream name is stated, so that exemption is exercised');
  for (const token of upstream) assert.equal(upstreamOf(token), token, `"${token}" is an upstream name holding the separator`);
});

test('W3 P2 (5) the instrument fails on a site-written label that prints an exposed name', () => {
  const planted = ALIAS_HTML.replace('>Steps, written by', `>${ALIAS} — Steps, written by`);
  assert.notEqual(planted, ALIAS_HTML, 'premise: the plant landed');
  assert.deepEqual(leaks(planted), [ALIAS]);
  const inD = ALIAS_HTML.replace(/(<div style="font-family:monospace;[^"]*">)get_data \(query\)/, `$1${ALIAS} (query)`);
  assert.notEqual(inD, ALIAS_HTML, 'premise: the D-label plant landed');
  assert.deepEqual(leaks(inD), [ALIAS], 'a D label is site-written: printing the exposed name there fails');
});

// --- W3 P2 (6): #115, one answer display across the surfaces --------------------
//
// The record's answer renders through the run surfaces' answer component. For
// a record carrying an executed notebook whose rendering cell's text is
// byte-equal to its signed `output`, the answer is that cell's outputs, as
// `adapt-notebook.ts` takes them; otherwise it is the record's `output` (the
// W3 fix, ruling 1). A fixture answering with its `output` carries an `output`
// that differs from any cell it has, so a page that rendered the wrong one
// fails; the differing executed case is the W3 fix (2) test.

const { default: ChatNotebookOutput } = (await import('@/components/notebook/ChatNotebookOutput')) as unknown as {
  default: ComponentType<Record<string, unknown>>;
};
const { EvidenceOriginProvider } = (await import('@/components/EvidenceOriginProvider')) as unknown as {
  EvidenceOriginProvider: ComponentType<{ value: Record<string, string | null>; children?: ReactNode }>;
};

function renderRun(notebook: unknown): string {
  const Session = SessionProvider as unknown as ComponentType<{ session: null; children?: ReactNode }>;
  const view = createElement(ChatNotebookOutput, { notebook, prompt: 'RUNQUESTION-w3p2', model: AGF_PACKAGE.cost.model, portal: 'data.example.test', toolCalls: [] });
  const origin = createElement(EvidenceOriginProvider, { value: { origin: `https://${INSTANCE}`, host: INSTANCE, platformTitle: null } }, view);
  return renderToStaticMarkup(createElement(Session, { session: null }, origin));
}

const markdownOutput = (md: string) => ({ output_type: 'display_data', metadata: {}, data: { 'text/markdown': md } });

function executedNotebook(outputs: unknown[]) {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { extensions: { 'org.civicaitools.notebook': { provenance: 'executed' } } },
    cells: [
      { cell_type: 'markdown', metadata: {}, source: ['# CELLNOTEBOOK-w3p2\n'] },
      { cell_type: 'code', metadata: { role: 'synthesis' }, execution_count: 1, source: ['display(Markdown(answer))\n'], outputs },
    ],
  };
}

function recordCarrying(notebook: unknown, output: string): Case {
  const pkg = structuredClone(AGF_PACKAGE) as Omit<typeof AGF_PACKAGE, 'extensions'> & { extensions: Record<string, unknown> };
  pkg.output = output;
  pkg.extensions['org.civicaitools.notebook'] = notebook;
  return { ...AGF, pkg };
}

const CELL_ANSWER = 'CELLANSWER-w3p2: **42** complaints in [the portal](https://data.example.test/), and:\n\n| a | b |\n|---|---|\n| 1 | 2 |';
const CELL_TABLE = { output_type: 'execute_result', metadata: {}, data: { 'text/html': '<table><tr><td>CELLTABLE-w3p2</td></tr></table>' } };

// Rewritten by the W3 fix (ruling 1). This test pinned that a record carrying
// an executed synthesis cell rendered the cell and never its differing
// `output`. Ruling 1 reverses that for the differing case (the W3 fix (2)
// test below), so the record here carries an `output` byte-equal to the cell's
// markdown, which is the case in which the record answers from the cell.
test('W3 P2 (6) one notebook renders byte-identical answer markup on the executed run and on the record that carries it, when the cell’s text is the record’s output', async () => {
  for (const [name, outputs] of [
    ['one markdown output', [markdownOutput(CELL_ANSWER)]],
    ['a markdown output and a table the cell computed', [markdownOutput(CELL_ANSWER), CELL_TABLE]],
  ] as const) {
    const notebook = executedNotebook([...outputs]);
    const run = requirePart(renderRun(notebook), 'answer').markup;
    const recordHtml = await renderWithInstance(recordCarrying(notebook, CELL_ANSWER), INSTANCE);
    const record = requirePart(recordHtml, 'answer').markup;
    assert.ok(run.includes('CELLANSWER-w3p2'), `${name}: premise: the run’s answer part carries the cell’s answer`);
    assert.equal(record, run, `${name}: the record’s answer part is the executed run’s, byte for byte`);
  }
  const table = await renderWithInstance(recordCarrying(executedNotebook([markdownOutput(CELL_ANSWER), CELL_TABLE]), CELL_ANSWER), INSTANCE);
  assert.ok(requirePart(table, 'answer').markup.includes('CELLTABLE-w3p2'), 'the table is answered from the cell');
  assert.deepEqual(
    authorLines(table).filter((l) => l.key === 'answer' || l.key === 'computed').map((l) => l.key),
    ['answer', 'computed', 'answer', 'computed'],
    'both of §6’s lines, over the answer and over F',
  );
});

test('W3 P2 (6) a record with no rendering cell renders its output through the same answer component', async () => {
  const run = requirePart(renderRun(executedNotebook([markdownOutput(CELL_ANSWER)])), 'answer').markup;
  const record = requirePart(await renderWithInstance(recordCarrying(notebook('skeleton', 'SKELETON-w3p2'), CELL_ANSWER), INSTANCE), 'answer').markup;
  assert.equal(record, run, 'the record’s output and the run’s cell, holding the same markdown, render the same markup');
});

test('W3 P2 (6) an answer over 2000 characters is not truncated, on the executed run or on the record', async () => {
  const long = `LONGSTART-w3p2 ${'The figures were read from the portal on the day. '.repeat(100)}LONGEND-w3p2`;
  assert.ok(long.length > 4000, 'premise: the answer is over 2000 characters, twice over');
  const text = (markup: string) => unescapeHtml(markup.replace(/<[^>]*>/g, ''));
  const cases: Array<[string, string]> = [
    ['the executed run', renderRun(executedNotebook([markdownOutput(long)]))],
    // The W3 fix (ruling 1): the cell answers only when its text is the record's output.
    ['a record carrying the notebook', await renderWithInstance(recordCarrying(executedNotebook([markdownOutput(long)]), long), INSTANCE)],
    ['a record answering with its output', await renderWithInstance(recordCarrying(notebook('skeleton', 'SKELETON-w3p2'), long), INSTANCE)],
  ];
  for (const [name, html] of cases) {
    const answers = occurrences(html, '<div data-part="answer"').map((s) => html.slice(s, elementEnd(html, s, 'div')));
    assert.ok(answers.length >= 1, `${name}: premise: the answer renders`);
    for (const a of answers) assert.equal(text(a).trim(), long, `${name}: the answer is rendered whole`);
  }
});

// --- W3 P2 fix 1 ---------------------------------------------------------------
//
// (1) A record whose output blob cannot be fetched has no answer to show. The
// page says so in its own words, and nothing it writes sits under a line that
// names the model (design §6). A record whose output was fetched is unchanged.
// (2) No element of the answer carries react-markdown's `node` prop as an
// attribute (`node="[object Object]"`), on any surface.
// (3) #115's "multi-turn": a record shaped like a multi-turn package — its
// transcript in `output`, its turns in `extensions["org.civicaitools.multi-turn"]`
// — renders its whole output through the answer component. No turn renderer
// (#96) is built here.

const UNFETCHED_BYTES = Buffer.from('UNFETCHED-w3p2f1: the bytes no fetch returns.', 'utf8');
const UNFETCHED_HASH = createHash('sha256').update(UNFETCHED_BYTES).digest('hex');
const UNFETCHED_CASE: Case = (() => {
  const pkg = structuredClone(OLD_PACKAGE) as Omit<typeof OLD_PACKAGE, 'output'> & { output: unknown };
  // The test's fetch refuses every URL but OLD_OUTPUT_URL, so this blob cannot be fetched.
  pkg.output = {
    ref: `blob:sha256:${UNFETCHED_HASH}`,
    url: `https://blobs.example.test/evidence-refs/${UNFETCHED_HASH}.md`,
    contentType: 'text/markdown',
    size: UNFETCHED_BYTES.length,
  };
  return { ...OLD, record: { ...OLD.record, slug: 'unfetched-record-w3p2f1' }, pkg };
})();
const UNFETCHED_HTML = await renderWithInstance(UNFETCHED_CASE, INSTANCE);
const OUTPUT_UNAVAILABLE = 'The answer is not shown: the stored copy of this record’s output could not be fetched. The package hash below identifies the record for audit.';

test('W3 P2 fix 1 (1) an output that could not be fetched: no line names the model, and the page says so in its own words', () => {
  const lines = authorLines(UNFETCHED_HTML);
  assert.deepEqual(lines.filter((l) => l.key === 'answer' || l.key === 'computed'), [], 'a line names the model over text the site wrote');
  assert.doesNotMatch(UNFETCHED_HTML, /written by the model/, 'no line on the page names the model');
  const answers = occurrences(UNFETCHED_HTML, '<div data-part="answer"').map((s) => UNFETCHED_HTML.slice(s, elementEnd(UNFETCHED_HTML, s, 'div')));
  assert.equal(answers.length, 2, 'the answer part is placed first and as F');
  for (const a of answers) assert.ok(unescapeHtml(a.replace(/<[^>]*>/g, '')).includes(OUTPUT_UNAVAILABLE), 'the answer part states that the output is unavailable');
  assert.equal(UNFETCHED_HTML.includes('Output blob could not be fetched'), false, 'the old placeholder is not rendered as the answer');
  assert.equal(UNFETCHED_HTML.includes('Output stored as blob (verified)'), false, 'an output that was not fetched is not called verified');
  assert.ok(lines.some((l) => l.key === 'question'), 'premise: the other author lines stay');
});

test('W3 P2 fix 1 (1) a record whose output blob was fetched is unchanged: the model’s line, its answer, the blob note', () => {
  const html = W3P2_HTML.old;
  assert.equal(authorLines(html).filter((l) => l.key === 'answer').length, 2);
  assert.ok(requirePart(html, 'answer').markup.includes(OLD_ANSWER));
  assert.ok(html.includes(`Output stored as blob (verified) · ${OLD_OUTPUT_BYTES.length.toLocaleString()} bytes`));
  assert.equal(html.includes(OUTPUT_UNAVAILABLE), false);
});

test('W3 P2 fix 1 (2) no element of the record’s answer carries a node attribute', async () => {
  const html = await renderWithInstance(recordCarrying(notebook('skeleton', 'SKELETON-w3p2'), CELL_ANSWER), INSTANCE);
  const answer = requirePart(html, 'answer').markup;
  assert.ok(/<a\b[^>]*href="https:\/\/data\.example\.test\/"/.test(answer), 'premise: the fixture answer renders a link');
  assert.doesNotMatch(answer, /\snode=/, 'an answer element carries react-markdown’s node prop as an attribute');
  const run = requirePart(renderRun(executedNotebook([markdownOutput(CELL_ANSWER)])), 'answer').markup;
  assert.doesNotMatch(run, /\snode=/, 'the executed run’s answer carries a node attribute');
  assert.equal(answer, run, 'criterion (3)’s byte-identity still holds');
});

const TURNS = [
  { index: 0, role: 'user', content: 'MTQUESTION-w3p2f1 How many permits were issued, and which neighbourhood led?' },
  ...Array.from({ length: 5 }, (_, i) => ({
    index: i + 1,
    role: i % 2 === 0 ? 'assistant' : 'user',
    content: `MTTURN${i + 1}-w3p2f1 ${'The permits were counted from the portal by month and by neighbourhood. '.repeat(8)}`,
  })),
];
const TRANSCRIPT = `${TURNS.map((t) => `### Turn ${t.index} — ${t.role === 'user' ? 'User' : 'Assistant'}\n\n${t.content.trim()}`).join('\n\n')}\n\nMTEND-w3p2f1`;
const MULTI_TURN_CASE: Case = (() => {
  const pkg = structuredClone(OLD_PACKAGE) as Omit<typeof OLD_PACKAGE, 'output' | 'extensions'> & { output: unknown; extensions: Record<string, unknown> };
  pkg.output = TRANSCRIPT;
  pkg.extensions = {
    'org.civicaitools.multi-turn': { version: '0.1.0', captureMode: 'full_conversation', sessionBoundary: 'first_civic_tool_call', turns: TURNS },
  };
  return { ...OLD, record: { ...OLD.record, slug: 'multi-turn-record-w3p2f1', captureMethod: 'claude-code-jsonl-readback' }, pkg };
})();

test('W3 P2 fix 1 (3) a multi-turn record over 2000 characters renders its whole transcript, through the answer component', async () => {
  assert.ok(TRANSCRIPT.length > 2000 && TURNS.length > 2, `premise: a transcript of ${TURNS.length} turns, ${TRANSCRIPT.length} characters`);
  const html = await renderWithInstance(MULTI_TURN_CASE, INSTANCE);
  assert.ok(html.includes('org.civicaitools.multi-turn'), 'premise: the extension is present (listed under Additional Artifacts)');
  const words = (text: string) => unescapeHtml(text.replace(/<[^>]*>/g, ' ')).replace(/###/g, ' ').replace(/\s+/g, ' ').trim();
  const answers = occurrences(html, '<div data-part="answer"').map((s) => html.slice(s, elementEnd(html, s, 'div')));
  assert.equal(answers.length, 2, 'the answer, first and as F');
  for (const a of answers) {
    assert.ok(a.startsWith('<div data-part="answer" class="response-markdown">'), 'rendered by the answer component');
    assert.equal(words(a), words(TRANSCRIPT), 'the transcript is rendered whole');
  }
});

// --- The W3 fix ------------------------------------------------------------------
//
// (1) The blob note says "verified" only after the bytes verify. The page
// fetches the output blob once and checks those bytes with verify-core's own
// check; the bytes it renders are the bytes it checked. Bytes that do not verify
// are not shown: the answer states, in the site's words and under no author
// line, that the stored copy does not match the record's reference.
//   The two fixtures that do not verify can each fail one check only: the first
//   has the reference's size and a different SHA-256, so a size check alone
//   passes it; the second has the SHA-256 of its own bytes and a different size,
//   so a hash check alone passes it.
// (2) Ruling 1: a record answers from its executed synthesis cell only when the
// cell's text is byte-equal to its signed `output`; otherwise from `output`,
// under the model's line, and the cell stays in E.
// (4) The record's `none` carries no author line, in the answer or in F.

const OUTPUT_DOES_NOT_MATCH = 'The answer is not shown: the stored copy of this record’s output does not match the record’s reference to it. The package hash below identifies the record for audit.';

function blobCase(slug: string, url: string, bytes: Buffer, ref: { hash: string; size: number }): Case {
  BLOB_BYTES.set(url, bytes);
  const pkg = structuredClone(OLD_PACKAGE) as Omit<typeof OLD_PACKAGE, 'output'> & { output: unknown };
  pkg.output = { ref: `blob:sha256:${ref.hash}`, url, contentType: 'text/markdown', size: ref.size };
  return { ...OLD, record: { ...OLD.record, slug }, pkg };
}

const HASH_MISMATCH_TEXT = 'UNVERIFIEDHASH-w3fix';
const HASH_MISMATCH_BYTES = Buffer.from(HASH_MISMATCH_TEXT.padEnd(OLD_OUTPUT_BYTES.length, '.'), 'utf8');
const SIZE_MISMATCH_BYTES = Buffer.from('UNVERIFIEDSIZE-w3fix: these bytes are their own hash’s.', 'utf8');
const NOT_VERIFYING: Array<[string, string, Case]> = [
  ['the reference’s size, a different SHA-256', HASH_MISMATCH_TEXT, blobCase(
    'hash-mismatch-w3fix', 'https://blobs.example.test/evidence-refs/hash-mismatch-w3fix.md', HASH_MISMATCH_BYTES,
    { hash: OLD_OUTPUT_HASH, size: OLD_OUTPUT_BYTES.length },
  )],
  ['the SHA-256 of its own bytes, a different size', 'UNVERIFIEDSIZE-w3fix', blobCase(
    'size-mismatch-w3fix', 'https://blobs.example.test/evidence-refs/size-mismatch-w3fix.md', SIZE_MISMATCH_BYTES,
    { hash: createHash('sha256').update(SIZE_MISMATCH_BYTES).digest('hex'), size: SIZE_MISMATCH_BYTES.length + 7 },
  )],
];

/**
 * The page without its citation part. The citation block's deliberative-process
 * format read "[Verified: <the record's date>]" on every record, blob or not,
 * naming no check of the output blob, so the word was read everywhere else.
 * Since LAYOUT-WEB W4 P1 (ruling D1) it reads "[Published: <date>]", which the
 * premise below reads; the citation's own text is pinned in
 * `src/lib/evidence/record-citation.test.ts` and by W4 P1 (9) below.
 */
function outsideCitation(html: string): string {
  const citation = partOf(html, 'citation');
  assert.ok(citation !== null && citation.markup.includes('[Published: '), 'premise: the citation block is where the format’s date word sits');
  return html.slice(0, citation.start) + html.slice(citation.end);
}

const answerParts = (html: string) => occurrences(html, '<div data-part="answer"').map((s) => html.slice(s, elementEnd(html, s, 'div')));
const plain = (markup: string) => unescapeHtml(markup.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ''));

test('W3 fix (1) fixtures: the two blobs that do not verify each fail one check only', () => {
  assert.equal(HASH_MISMATCH_BYTES.length, OLD_OUTPUT_BYTES.length, 'the first has the reference’s size');
  assert.notEqual(createHash('sha256').update(HASH_MISMATCH_BYTES).digest('hex'), OLD_OUTPUT_HASH, 'and a different SHA-256');
  const second = NOT_VERIFYING[1][2].pkg as { output: { ref: string; size: number } };
  assert.equal(second.output.ref, `blob:sha256:${createHash('sha256').update(SIZE_MISMATCH_BYTES).digest('hex')}`, 'the second carries its bytes’ own SHA-256');
  assert.notEqual(second.output.size, SIZE_MISMATCH_BYTES.length, 'and a different size');
});

test('W3 fix (1) bytes whose SHA-256 and size match: one fetch, the note says verified, and the answer renders those bytes under the model’s line', async () => {
  BLOB_REQUESTS.clear();
  const html = await renderWithInstance(OLD, INSTANCE);
  assert.equal(BLOB_REQUESTS.get(OLD_OUTPUT_URL), 1, 'the page fetches the blob once');
  assert.ok(html.includes(`Output stored as blob (verified) · ${OLD_OUTPUT_BYTES.length.toLocaleString()} bytes`), 'the note says verified');
  const answers = answerParts(html);
  assert.equal(answers.length, 2, 'the answer, first and as F');
  for (const a of answers) assert.ok(plain(a).includes(`${OLD_ANSWER}: 17 permits`), 'the answer renders the verified bytes');
  assert.deepEqual(authorLines(html).filter((l) => l.key === 'answer').map((l) => l.text), [W3P2.answer(OLD_PACKAGE), W3P2.answer(OLD_PACKAGE)], 'under the model’s line, over the answer and over F');
});

for (const [name, marker, c] of NOT_VERIFYING) {
  test(`W3 fix (1) bytes that do not verify (${name}): "verified" nowhere, the bytes not shown, the site’s sentence under no author line`, async () => {
    BLOB_REQUESTS.clear();
    const url = (c.pkg as { output: { url: string } }).output.url;
    const html = await renderWithInstance(c, INSTANCE);
    assert.equal(BLOB_REQUESTS.get(url), 1, 'premise: the page fetched the bytes, once');
    assert.match(outsideCitation(await renderWithInstance(OLD, INSTANCE)), /\bverified\b/i, 'premise: the instrument sees the word on a blob that verifies');
    assert.doesNotMatch(html, /\(verified\)/i, 'the blob note’s "(verified)" appears nowhere on the page');
    assert.doesNotMatch(outsideCitation(html), /\bverified\b/i, '"verified" appears nowhere on the page outside the citation block');
    assert.equal(html.includes(marker), false, 'the bytes that did not verify are not rendered');
    const answers = answerParts(html);
    assert.equal(answers.length, 2, 'the answer part is placed first and as F');
    for (const a of answers) assert.ok(plain(a).includes(OUTPUT_DOES_NOT_MATCH), 'the answer states that the stored copy does not match');
    assert.deepEqual(authorLines(html).filter((l) => l.key === 'answer' || l.key === 'computed'), [], 'no line names the model over the site’s words');
    assert.ok(authorLines(html).some((l) => l.key === 'question'), 'premise: the other author lines stay');
  });
}

// R10 P1b (#694) moved the check out of the page, unchanged, into
// `src/lib/evidence/blob-text.ts` (`resolveBlobText`), so section B's system
// prompt is checked by the same code as the output. The test follows it: the
// page calls the shared helper, and the helper checks with verifyBlobRef.
test('W3 fix (1) read from the source: the page checks the blob with verify-core’s verifyBlobRef and computes no hash of its own', () => {
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const page = strip(fs.readFileSync(path.join(HERE, 'page.tsx'), 'utf8'));
  assert.match(page, /import\s*\{[^}]*\bresolveBlobText\b[^}]*\}\s*from\s*'@\/lib\/evidence\/blob-text'/, 'the page imports the shared check');
  assert.match(page, /\bresolveBlobText\(/, 'and calls it');
  const helper = strip(fs.readFileSync(path.join(SRC, 'lib', 'evidence', 'blob-text.ts'), 'utf8'));
  for (const [name, code] of [['page.tsx', page], ['blob-text.ts', helper]] as const) {
    assert.doesNotMatch(code, /createHash|sha256Hex|node:crypto|subtle\.digest/, `${name} computes no hash itself`);
    assert.doesNotMatch(code, /\bfetchBlobRefText\(/, `${name} does not fetch the blob as text a second time`);
  }
  assert.match(helper, /import\s*\{[^}]*\bverifyBlobRef\b[^}]*\}\s*from\s*'\.\/blob-ref\.ts'/, 'the helper imports verifyBlobRef through the site’s blob-ref module');
  assert.match(helper, /\bverifyBlobRef\(/, 'and calls it');
});

const CELL_MARK = 'CELLMARK-w3fix: the cell’s text, which differs from the output.';
const OUTPUT_MARK = 'OUTPUTMARK-w3fix: the record’s signed output.';

test('W3 fix (2) a record whose executed synthesis cell differs from its output: the answer and F render the output under the model’s line, and the cell stays in E', async () => {
  for (const [name, outputs] of [
    ['one markdown output', [markdownOutput(CELL_MARK)]],
    ['a markdown output and a table the cell computed', [markdownOutput(CELL_MARK), CELL_TABLE]],
  ] as const) {
    const c = recordCarrying(executedNotebook([...outputs]), OUTPUT_MARK);
    const html = await renderWithInstance(c, INSTANCE);
    const answers = answerParts(html);
    assert.equal(answers.length, 2, `${name}: the answer, first and as F`);
    for (const a of answers) {
      assert.ok(plain(a).includes('OUTPUTMARK-w3fix'), `${name}: the answer renders the signed output`);
      assert.equal(a.includes('CELLMARK-w3fix'), false, `${name}: and not the cell’s text`);
      assert.equal(a.includes('CELLTABLE-w3p2'), false, `${name}: nor the cell’s table`);
    }
    assert.deepEqual(
      authorLines(html).filter((l) => l.key === 'answer' || l.key === 'computed').map((l) => l.text),
      [W3P2.answer(c.pkg as typeof AGF_PACKAGE), W3P2.answer(c.pkg as typeof AGF_PACKAGE)],
      `${name}: the model’s line alone, over the answer and over F`,
    );
    const d = requireDisclosure(html);
    const e = sectionBody(html, 'E · Answer notebook', d.end);
    assert.ok(e.includes('Preview cells (1 code, 2 total)'), `${name}: E renders the notebook, its synthesis cell counted`);
  }
});

test('W3 fix (4) the record’s none: the site’s sentence, and no "written by the model" line in the answer or in F', async () => {
  const pkg = structuredClone(OLD_PACKAGE) as Partial<typeof OLD_PACKAGE>;
  delete pkg.output;
  const html = await renderWithInstance({ ...OLD, record: { ...OLD.record, slug: 'none-record-w3fix' }, pkg }, INSTANCE);
  const answers = answerParts(html);
  assert.equal(answers.length, 2, 'the answer part is placed first and as F');
  for (const a of answers) assert.ok(plain(a).includes('No synthesis was produced for this analysis.'), 'the answer part renders the site’s sentence');
  assert.doesNotMatch(html, /Answer, written by the model/, 'no line names the model over it');
  assert.ok(authorLines(html).some((l) => l.key === 'question'), 'premise: the other author lines stay');
});

// --- LAYOUT-WEB W4 P1: the layout, the toggle, the page's line -----------------------
//
// The record page renders the answer view; the view places its parts by a
// layout (`src/lib/answer-layout/`). Each record is rendered with no layout
// setting (the built-ins, `answer-first` the default) and with the instance's
// layouts handed to the view's provider: `envelope-order` as the default, and
// fixture layouts. The reader's choice is read from the session in the
// browser only; the server renders the instance's default, which is what a
// chosen layout is driven as here.
//
// THE INSTRUMENT. `viewChildren` splits the view's root into its top-level
// elements and names the part each belongs to (Status History travels with the
// disclosure, which it follows). Every part carries the fixture's own content,
// so a part dropped, doubled or changed shows as a different list or element.

const { ANSWER_FIRST, ENVELOPE_ORDER, BUILT_IN_LAYOUTS } = await import('@/lib/answer-layout');
type Layout = typeof ANSWER_FIRST;

const instanceWith = (layout: Layout) => ({
  default: layout,
  offered: [layout, ...BUILT_IN_LAYOUTS.filter((l) => l.name !== layout.name)],
});

const VIEW_ROOT = '<div style="max-width:900px;margin:0 auto">';

function partOfChild(markup: string): string {
  if (/^<div data-part="(status-row|refused-requests)"/.test(markup)) return 'status';
  if (markup.startsWith('<div style="margin-bottom:24px">') || markup.startsWith('<h2')) return 'answer';
  if (markup.startsWith('<div data-part="citation"')) return 'citation';
  if (markup.startsWith('<div data-part="steps"')) return 'steps';
  if (markup.startsWith('<div data-part="sources"')) return 'sources';
  if (markup.startsWith('<details data-part="disclosure"')) return 'disclosure';
  if (markup.startsWith('<section') && markup.includes(heading('Status History'))) return 'disclosure';
  if (markup.startsWith('<div data-part="actions"')) return 'actions';
  if (markup.startsWith('<div data-part="layout-foot"')) return 'foot';
  assert.fail(`the view holds an element no part accounts for: ${markup.slice(0, 120)}`);
}

function viewChildren(html: string): Array<{ part: string; markup: string }> {
  const root = html.lastIndexOf(VIEW_ROOT, at(html, 'data-part="status-row"'));
  assert.ok(root >= 0, 'no view root before the status row');
  const close = elementEnd(html, root, 'div') - '</div>'.length;
  const children: Array<{ part: string; markup: string }> = [];
  for (let i = root + VIEW_ROOT.length; i < close;) {
    const tag = /^<(\w+)\b/.exec(html.slice(i));
    assert.ok(tag !== null, `the view holds text of its own at ${i}: ${html.slice(i, i + 80)}`);
    const end = elementEnd(html, i, tag[1]);
    children.push({ part: partOfChild(html.slice(i, end)), markup: html.slice(i, end) });
    i = end;
  }
  return children;
}

const sequence = (children: Array<{ part: string }>) =>
  children.map((c) => c.part).filter((p, i, all) => i === 0 || all[i - 1] !== p);
const elements = (children: Array<{ part: string; markup: string }>) =>
  children.filter((c) => c.part !== 'foot').map((c) => c.markup).sort();

function withoutLayoutFoot(html: string): string {
  const start = html.indexOf('<div data-part="layout-foot"');
  if (start < 0) return html;
  return html.slice(0, start) + html.slice(elementEnd(html, start, 'div'));
}

/** The disclosure's section headings, in order. */
function sectionTitles(html: string): string[] {
  const d = requireDisclosure(html);
  return [...html.slice(d.start, d.end).matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
}

// A record has no sources line: the part is empty, so it is absent from both sequences.
const RECORD_ANSWER_FIRST = ['status', 'answer', 'citation', 'steps', 'disclosure', 'actions', 'foot'];
const RECORD_ENVELOPE_ORDER = ['status', 'disclosure', 'steps', 'answer', 'citation', 'actions', 'foot'];

const W4_RECORDS: Array<[string, Case]> = [['A-G record', AGF], ['legacy record', OLD]];

for (const [name, c] of W4_RECORDS) {
  test(`W4 P1 (4) ${name}: with no setting, the parts render in the built-in default's order, then the foot`, async () => {
    assert.deepEqual(sequence(viewChildren(await renderWithInstance(c, INSTANCE))), RECORD_ANSWER_FIRST);
  });

  test(`W4 P1 (4) ${name}: with envelope-order chosen, the order changes and every part is still present, byte for byte`, async () => {
    const byDefault = viewChildren(await renderWithInstance(c, INSTANCE));
    const envelope = viewChildren(await renderWithInstance(c, INSTANCE, instanceWith(ENVELOPE_ORDER)));
    assert.deepEqual(sequence(envelope), RECORD_ENVELOPE_ORDER);
    assert.deepEqual(elements(envelope), elements(byDefault), 'the same elements, reordered: none dropped, doubled or changed');
  });

  test(`W4 P1 (4) ${name}: rules 1 to 4 hold under both built-ins`, async () => {
    const stored = JSON.stringify(c.pkg);
    const renders: string[] = [];
    for (const layouts of [undefined, instanceWith(ENVELOPE_ORDER)]) {
      renders.push(await renderWithInstance(c, INSTANCE, layouts));
      // Rule 1: the package the page read is the stored one, unchanged; the hash it states is the record's.
      assert.equal(JSON.stringify(globals.__p2Package), stored, 'the package the page read is unchanged');
    }
    for (const html of renders) assert.equal(occurrences(html, `Package hash: ${c.record.basePackageHash}`).length, 1, 'the record’s hash, once');
    // Rule 2: the disclosure holds the same sections, in the same order, and the answer is placed twice.
    const [first, second] = renders;
    assert.ok(sectionTitles(first).length >= 10, `premise: the disclosure holds its sections (${sectionTitles(first).join(', ')})`);
    assert.deepEqual(sectionTitles(second), sectionTitles(first), 'the disclosure’s sections');
    for (const html of renders) {
      assert.equal(occurrences(html, '<div data-part="answer"').length, 2, 'the answer, first and as F');
      // Rule 3: the banners, the status row's reading and the refused-request lines sit outside the disclosure.
      const d = requireDisclosure(html);
      const sentences = c === AGF
        ? ['Executed in a signed sandbox', '1 of 3 requests did not complete.']
        : ['Whether this notebook ran is not stated', 'This record was withdrawn by the author on'];
      for (const marker of ['data-part="status-row"', ...sentences]) {
        const i = at(html, marker);
        assert.ok(i < d.start || i > d.end, `${marker} sits outside the disclosure`);
      }
    }
    // Rule 4: every author line, word for word, as many times.
    const authors = (html: string) => authorLines(html).map((l) => `${l.key}: ${l.text}`).sort();
    assert.ok(authors(first).length >= 4, 'premise: the record carries its author lines');
    assert.deepEqual(authors(second), authors(first), 'the author lines');
  });

  test(`W4 P1 (5) ${name}: the foot line names the layout and its version under each built-in, outside the disclosure`, async () => {
    for (const layout of [ANSWER_FIRST, ENVELOPE_ORDER]) {
      const html = await renderWithInstance(c, INSTANCE, instanceWith(layout));
      const line = `Shown under layout ${layout.name} v${layout.version}`;
      assert.equal(occurrences(html, line).length, 1, `"${line}" once`);
      const children = viewChildren(html);
      assert.equal(children.at(-1)?.part, 'foot', 'the foot closes the view');
      assert.ok(at(html, line) > requireDisclosure(html).end, 'outside the disclosure');
      assert.ok(at(html, line) < at(html, 'Package hash: '), 'above the package hash, the page’s last line');
    }
    assert.ok((await renderWithInstance(c, INSTANCE)).includes('Shown under layout answer-first v1'), 'with no setting, the default’s line');
  });
}

test('W4 P1 (4) rule 3 under envelope-order: the unsigned and sealed banners still render before the disclosure', async () => {
  const html = await renderWithInstance(SKELETON, INSTANCE, instanceWith(ENVELOPE_ORDER));
  assert.equal(sequence(viewChildren(html))[1], 'disclosure', 'premise: the disclosure comes second under envelope-order');
  for (const banner of ['Unsigned package — no cryptographic commitment', 'Sealed — not published', 'Analysis notebook (not executed)']) {
    before(html, banner);
  }
});

const FIXTURE_OMITS_CITATION: Layout = { ...ENVELOPE_ORDER, name: 'fixture-omits-citation', order: ENVELOPE_ORDER.order.filter((n) => n !== 'citation') };
const FIXTURE_UNKNOWN_PART: Layout = {
  ...ENVELOPE_ORDER,
  name: 'fixture-unknown-part',
  order: ['status', 'TIMELINE-w4p1', ...ENVELOPE_ORDER.order.slice(1)],
  disclosure: { ...ENVELOPE_ORDER.disclosure, order: ['A', 'APPENDIX-w4p1', ...ENVELOPE_ORDER.disclosure.order.slice(1)] },
};

test('W4 P1 (8) a record under a layout that omits a part renders it at its default place, every part present', async () => {
  const byDefault = viewChildren(await renderWithInstance(AGF, INSTANCE));
  const omits = viewChildren(await renderWithInstance(AGF, INSTANCE, instanceWith(FIXTURE_OMITS_CITATION)));
  assert.deepEqual(sequence(omits), ['status', 'disclosure', 'steps', 'answer', 'citation', 'actions', 'foot'], 'the citation directly after the answer, its default place');
  assert.deepEqual(elements(omits), elements(byDefault), 'the same elements: none dropped');
});

test('W4 P1 (8) a record under a layout naming an unknown part renders the seven parts and nothing else', async () => {
  const envelope = await renderWithInstance(AGF, INSTANCE, instanceWith(ENVELOPE_ORDER));
  const unknown = await renderWithInstance(AGF, INSTANCE, instanceWith(FIXTURE_UNKNOWN_PART));
  assert.deepEqual(sequence(viewChildren(unknown)), RECORD_ENVELOPE_ORDER);
  assert.equal(withoutLayoutFoot(unknown), withoutLayoutFoot(envelope), 'the markup is envelope-order’s, but for the foot');
  assert.doesNotMatch(unknown, /TIMELINE-w4p1|APPENDIX-w4p1/, 'an unknown name renders nothing');
});

test('W4 P1 (8) the record’s own sections are placed by name: one moved first, one omitted and kept at its default place', async () => {
  const layout: Layout = {
    ...ANSWER_FIRST,
    name: 'fixture-record-sections',
    disclosure: { ...ANSWER_FIRST.disclosure, order: ['verification', 'A', 'B', 'C', 'D', 'E', 'G', 'signers'] },
  };
  const titles = sectionTitles(await renderWithInstance(AGF, INSTANCE, instanceWith(layout)));
  assert.deepEqual(titles, ['Verification Status', ...ENVELOPE, ...AFTER_ENVELOPE.filter((t) => t !== 'Verification Status')]);
});

test('W4 P1 fix 1 (F7) appliesTo and rendererVersion change nothing yet: a layout for another profile still applies to the record', async () => {
  const other: Layout = { ...ENVELOPE_ORDER, name: 'fixture-other-profile', appliesTo: ['OTHERPROFILE-w4p1fix1'], rendererVersion: 'OTHER-RENDERER-w4p1fix1' };
  const envelope = await renderWithInstance(AGF, INSTANCE, instanceWith(ENVELOPE_ORDER));
  const html = await renderWithInstance(AGF, INSTANCE, instanceWith(other));
  assert.deepEqual(sequence(viewChildren(html)), RECORD_ENVELOPE_ORDER, 'the layout applies, whatever the record’s profile');
  assert.equal(withoutLayoutFoot(html), withoutLayoutFoot(envelope), 'and nothing else moves');
});

test('W4 P1 the server markup is the instance’s default: its line, and the toggle with the default chosen', async () => {
  const foot = viewChildren(await renderWithInstance(AGF, INSTANCE)).at(-1)?.markup ?? '';
  assert.ok(foot.includes('<span data-part="layout-line">Shown under layout answer-first v1</span>'), foot);
  const options = [...foot.matchAll(/<option value="([^"]+)"( selected="")?>([^<]*)<\/option>/g)];
  assert.deepEqual(options.map((m) => [m[1], m[2] !== undefined]), [['answer-first@1', true], ['envelope-order@1', false]]);
});

test('W4 P2 the server markup with a publication attestation naming a node: the page looks it up among the nodes it holds', async () => {
  // The page reads the id from `resolveRecordAttestations` (stubbed above) and
  // looks it up among the nodes this site holds: the one committed node
  // (`770ed52e…`), and no URL node, since none is set here. This test's id is
  // its own fixture, not the committed node's, so it is one the site does not hold.
  globals.__p2PublishedLayoutNodeId = '9'.repeat(64);
  let named: string;
  try {
    named = viewChildren(await renderWithInstance(AGF, INSTANCE)).at(-1)?.markup ?? '';
  } finally {
    delete globals.__p2PublishedLayoutNodeId;
  }
  assert.ok(named.includes('<span data-part="layout-line">Shown under layout answer-first v1. This site does not hold the layout this record was published under.</span>'), named);
  const none = viewChildren(await renderWithInstance(AGF, INSTANCE)).at(-1)?.markup ?? '';
  assert.ok(none.includes('<span data-part="layout-line">Shown under layout answer-first v1</span>'), 'no id named: W4 P1’s line');
});

// --- W4 P1 (9): the record citation's word ---------------------------------------------
//
// Ruling D1: the deliberative-process citation dates the record with the word
// the plain text beside it uses for the same date. At the base it read
// "[Verified: <date>]", which names no check the record passed.

test('W4 P1 (9) the citation block reads "Record: <title> [Published: <date>] <url>", and says "Verified" nowhere', () => {
  const citation = partOf(HTML.agf, 'citation');
  assert.ok(citation !== null, 'premise: the record renders its citation block');
  const expected = `Record: ${AGF.record.title} [Published: May 2, 2026] https://${HOST}/records/${AGF.record.slug}`;
  assert.ok(citation.markup.includes(escaped(expected)), `the block carries "${expected}"`);
  assert.ok(citation.markup.includes(escaped('Published: May 2, 2026.')), 'premise: the plain text uses the same word for the same date');
  assert.doesNotMatch(citation.markup, /Verified/, 'the block says "Verified"');
});

// --- W4 P1 (11): nothing moves without a setting -----------------------------------------
//
// With no setting, each record's page, without the view's foot, equals the
// base's. THE GOLDENS WERE NOT WRITTEN BY HAND: each is this block's output on
// the base (website main 641a82f), the base tree running this block with
// `W4P1_UNCHANGED_OUT` set, where `withoutLayoutFoot` removes nothing.
// Rendered in UTC, so a date the page states reads the same on every host.
// RE-CAPTURED, NOT EDITED, on the UX pass branch (row 12): both goldens by
// this block, after section C's servers row was relabelled "Data sources this
// site could use" and its "Data sources" row "Data sources used". The diff
// from the base's capture is those two labels (the legacy record has only the
// second), plus the one change W4 P1 ruled and used to apply to the base by
// name: its (9) changed the citation block's "[Verified: " to "[Published: "
// (ruling D1), which the re-capture now carries as rendered. Re-captured again
// for row 23 (a duration in seconds): that diff is the duration strings alone.
// Re-captured again for R10 P1 (#682): the diff is one card inserted at the end
// of section C, "Sources chosen by: not recorded" (neither record states
// routing). Re-captured again for R10 P1b fix round 1 (#694, the research
// check's words): both records carry inline skill text, and the diff is
// section B alone — its intro, the "System prompt hash: <hash>" line and the
// sentence on what a hash is, the button row's top margin, and the button's
// "Show full system prompt (N bytes)". And again for fix round 1 item 9: the
// diff is section C's one label, "Skill hash" renamed "System prompt hash".
// Re-captured again for R10 P5 (the owner's ruling on section C): the diff is
// section C's "Content profile" card, now "Content shape" reading "full record
// (A to G envelope)" (the A-G record) or "plain record" (the legacy record),
// followed by one inserted item, "Content profile", with the raw value as
// small print. Neither record declares the subtype, so the Verification
// Status label is unchanged.
// Re-captured again for R10 P5 fix round 1 item 4: the A-G record's diff is
// the §8.7 link's fragment alone, `#87-content-profile-dathere` to
// `#87-profile-requirements-dathere-and-scripted-recomputation`.
// And for fix round 1 W4: the legacy record (no content profile) diff is its
// small-print value alone, `default` to `not stated`.

const UNCHANGED_OUT = process.env.W4P1_UNCHANGED_OUT;

async function inUtc<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

for (const [name, file, c] of [
  ['the A-G record', 'w4p1-unchanged-record-agf.golden.txt', AGF],
  ['the legacy record', 'w4p1-unchanged-record-legacy.golden.txt', OLD],
] as const) {
  test(`W4 P1 (11) ${name}: with no setting, the page without the view's foot equals the base’s`, async () => {
    const actual = withoutLayoutFoot(await inUtc(() => renderWithInstance(c, INSTANCE)));
    if (UNCHANGED_OUT !== undefined) {
      fs.writeFileSync(path.join(UNCHANGED_OUT, file), actual);
      return;
    }
    const goldenPath = path.join(HERE, file);
    assert.ok(fs.existsSync(goldenPath), `no golden at ${goldenPath}; it is captured on the base, never written by hand`);
    const golden = fs.readFileSync(goldenPath, 'utf8');
    assert.equal(occurrences(golden, '[Verified: ').length, 0, 'premise: the capture carries ruling D1’s word, not the base’s');
    if (actual === golden) return;
    let i = 0;
    while (i < golden.length && golden[i] === actual[i]) i++;
    assert.fail(`${name} differs from the base at character ${i}:\n  base: …${golden.slice(Math.max(0, i - 60), i + 80)}…\n  head: …${actual.slice(Math.max(0, i - 60), i + 80)}…`);
  });
}
