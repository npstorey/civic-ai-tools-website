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
//   - `globalThis.fetch`: answers the one blob URL the blob fixture names, and
//     refuses everything else, so no test reaches a network.
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
  '@/lib/evidence/lifecycle': `export async function resolveLifecycle() { return globalThis.__p2Lifecycle; }`,
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

registerHooks({
  resolve(specifier, context, nextResolve) {
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

globals.fetch = async (input: unknown) => {
  const url = String(input instanceof URL ? input.href : (input as { url?: string }).url ?? input);
  if (url === OLD_OUTPUT_URL) {
    return new Response(OLD_OUTPUT_BYTES, { status: 200, headers: { 'Content-Type': 'text/markdown' } });
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

async function render(c: Case): Promise<string> {
  globals.__p2Rows = [[c.record], [CREATOR]];
  // As stored: a fresh copy per render, so nothing one render does reaches the next.
  globals.__p2Package = c.pkg === null ? null : structuredClone(c.pkg);
  globals.__p2Lifecycle = c.lifecycle;
  globals.__p2Evaluations = c.evaluations;
  globals.__p2Headers = { host: HOST, 'x-forwarded-proto': 'https' };
  const element = await EvidencePage({ params: Promise.resolve({ slug: c.record.slug }) });
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

test('P2 (3) read from the source: the answer has one render site', () => {
  assert.equal(PAGE_SOURCE.match(/<ReactMarkdown\b/g)?.length ?? 0, 1, 'one <ReactMarkdown render site in page.tsx');
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
    assert.doesNotMatch(source, /Record Package\.|\[Verified: /, `${name} writes no citation format of its own`);
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
    [returned, 'aaaa-1111', escaped("created_date > '2026-10-01'"), 'Returned 12 rows × 3 columns · 410ms'],
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
// sentence states it for a returned call (" · 410ms") and a failed one ("The
// attempt took 1,200ms."); for a call whose outcome is unrecorded it states none,
// so the card shows the raw field as a "Duration" label beside Dataset/Portal.
// No label on a returned or failed card: beside "did not complete" a bare number
// reads as how long the call took to succeed (#413).
const cardText = (card: string) => card.replace(/<[^>]*>/g, '');

test('P3 a call with no stated outcome shows its signed duration; a returned or failed call states it once, in its outcome', () => {
  const [returned, failed, unrecorded] = callCards(HTML.agf);
  assert.ok(cardText(unrecorded).includes('No result summary was recorded for this request.'), 'the A-G unrecorded card is unrecorded');
  assert.ok(cardText(unrecorded).includes('Duration 95ms'), 'the A-G unrecorded card shows Duration 95ms');

  assert.ok(cardText(returned).includes('Returned 12 rows × 3 columns · 410ms'), 'the returned card states its duration in its outcome');
  assert.doesNotMatch(returned, /Duration/, 'no Duration label on a returned card');

  assert.equal(occurrences(cardText(failed), '1,200ms').length, 1, 'the failed card states its duration once');
  assert.ok(cardText(failed).includes('The attempt took 1,200ms.'), 'in the outcome sentence\'s words');
  assert.doesNotMatch(failed, /Duration|1200/, 'no Duration label and no bare number on a failed card');

  const [withDuration, withoutDuration] = callCards(HTML.old);
  assert.ok(cardText(withDuration).includes('No result summary was recorded for this request.'), 'the old-format card is unrecorded');
  assert.ok(cardText(withDuration).includes('Duration 222ms'), 'the old-format unrecorded card shows Duration 222ms');
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

test('P2 (5) C states the content profile, data sources, skill hash, total tokens, tool calls and blob-stored fields', async () => {
  const agf = cItems(HTML.agf);
  const old = cItems(HTML.old);
  assert.equal(agf.get('Content profile'), 'datHere');
  assert.equal(old.get('Content profile'), 'default', 'a record with no profile reads default');
  const { formatDataSourcesSummary } = await import('@/lib/evidence/data-sources');
  for (const [items, pkg] of [[agf, AGF_PACKAGE], [old, OLD_PACKAGE]] as const) {
    const expected = formatDataSourcesSummary(pkg.dataSources as never);
    assert.ok(expected !== null && expected.length > 0, 'the fixture names a data source');
    assert.equal(items.get('Data sources'), expected, 'data sources, as the shared formatter states them');
  }
  assert.notEqual(agf.get('Data sources'), old.get('Data sources'), 'each record states its own sources');
  assert.equal(agf.get('Skill hash'), 'e'.repeat(12));
  assert.equal(agf.get('Total tokens'), (34321).toLocaleString());
  assert.equal(agf.get('Tool calls'), '3');
  assert.equal(old.get('Tool calls'), '2');
  assert.equal(old.get('Blob-stored fields'), 'output');
  assert.equal(agf.has('Blob-stored fields'), false, 'no blob-stored fields when none is a blob');
  // A hash-only skill prompt: no section B, and its hash is disclosed in C.
  const skeleton = cItems(HTML.skeleton);
  assert.equal(skeleton.get('Skill hash'), '555555555555');
  assert.equal(occurrences(HTML.skeleton, heading('B · System prompts')).length, 0, 'no B for a hash-only skill prompt');
});

// #617 P4 (ruling a2, the named exception to this file's ownership): a hosted
// source is listed in `mcpServers` by the purl of the package it ran, whose
// URL parses with an empty host. The "MCP servers" line shows it as written,
// beside an addressed server's host, never as an empty entry.
test('R7 P4 a2: C\'s MCP servers line shows a hosted source\'s purl, not an empty host', async () => {
  const PURL = 'pkg:npm/%40betanyc/nyc-charter-laws-rules@0.3.1';
  assert.equal(new URL(PURL).host, '', 'premise: the purl parses with an empty host');
  const pkg = structuredClone(AGF_PACKAGE) as typeof AGF_PACKAGE & { extensions: Record<string, Record<string, unknown>> };
  pkg.extensions['org.civicaitools.environment'].mcpServers = [
    { url: 'https://mcp.example.test', name: 'example' },
    { url: PURL, name: 'nyc-charter' },
  ];
  const html = await render({ ...AGF, pkg });
  assert.equal(cItems(html).get('MCP servers'), `mcp.example.test, ${PURL}`);
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
