// The rule: the record page escapes its structured data.
//
// WHAT IS DRIVEN. The record page itself (`page.tsx`, which `/records/[slug]`
// re-exports), rendered in a child process with the app's React and
// `renderToStaticMarkup`, as `record-page-creator-key.test.ts` renders it. Each
// case stores one value that would end a script element, in the title, the
// summary or the creator's display name. The structured-data element is read
// as an HTML parser reads it, up to the first `</script`: the value stays
// inside the element, and the element's JSON parses back equal to the input.
//
// STUBS, each where the real module needs a database, storage or a request
// scope: `@/lib/db` (answers the record, then its creator), `@/lib/storage`,
// `@/lib/evidence/lifecycle`, `@/lib/evidence/adversarial-eval`,
// `@/lib/evidence/sealed-access`, `next/headers`, `next/navigation`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..', '..');

const DRIVER = String.raw`
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [, , REPO, INPUT] = process.argv;
const SRC = path.join(REPO, 'src');
const req = nodeModule.createRequire(path.join(REPO, 'package.json'));
const ts = req('typescript');

const STUB_PREFIX = 'file:///record-page-structured-data-stub/';
const STUB_SOURCE = {
  '@/lib/db': 'const chain = { from() { return chain; }, where() { return chain; }, orderBy() { return chain; }, async limit() { return (globalThis.__rows ?? []).shift() ?? []; } };\n' +
    'export const db = { select() { return chain; } };',
  '@/lib/storage': 'export async function getPackage() { return null; }',
  '@/lib/evidence/lifecycle': "export async function resolveRecordAttestations() { return { lifecycle: { status: 'active', source: 'legacy-columns', chain: [] }, publishedLayoutNodeId: null }; }",
  '@/lib/evidence/adversarial-eval': 'export async function loadEvaluationViews() { return []; }',
  '@/lib/evidence/sealed-access': 'export async function sessionUserIsCreator() { return false; }',
  'next/headers': "export async function headers() { const h = { host: 'records.example.test', 'x-forwarded-proto': 'https' }; return { get(name) { return h[name] ?? null; } }; }",
  'next/navigation': "export function notFound() { throw new Error('STRUCTURED_DATA_NOT_FOUND'); }",
};

function firstFile(candidates) {
  for (const c of candidates) { try { if (fs.statSync(c).isFile()) return c; } catch {} }
  return null;
}
const candidatesFor = (b) => [b, b + '.ts', b + '.tsx', path.join(b, 'index.ts'), path.join(b, 'index.tsx')];

nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(STUB_SOURCE, specifier)) return { url: STUB_PREFIX + encodeURIComponent(specifier) + '.mjs', format: 'module', shortCircuit: true };
    if (specifier === 'next/link') return nextResolve('next/link.js', context);
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (!found) throw new Error('record page driver: cannot resolve ' + specifier);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    const parent = context.parentURL;
    if (specifier.startsWith('.') && parent?.startsWith('file:') && fileURLToPath(parent).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(parent)), specifier)));
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) {
      return { format: 'module', source: STUB_SOURCE[decodeURIComponent(url.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''))], shortCircuit: true };
    }
    if (url.startsWith('file:')) {
      const file = fileURLToPath(url);
      if (file.startsWith(SRC) && /\.tsx?$/.test(file)) {
        const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          fileName: file,
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        return { format: 'module', source: out, shortCircuit: true };
      }
    }
    return nextLoad(url, context);
  },
});

const input = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
input.record.createdAt = new Date(input.record.createdAt);
input.creator.createdAt = new Date(input.creator.createdAt);
globalThis.__rows = [[input.record], [input.creator]];
globalThis.fetch = async (u) => { throw new Error('record page driver: no network (' + u + ')'); };

const { default: EvidencePage } = await import(pathToFileURL(path.join(SRC, 'app', '(app)', 'evidence', '[slug]', 'page.tsx')).href);
const element = await EvidencePage({ params: Promise.resolve({ slug: input.record.slug }) });
const fromRepo = (specifier) => import(pathToFileURL(req.resolve(specifier)).href);
const { createElement } = await fromRepo('react');
const { renderToStaticMarkup } = await fromRepo('react-dom/server');
const { SessionProvider } = await fromRepo('next-auth/react');
process.stdout.write(renderToStaticMarkup(createElement(SessionProvider, { session: null }, element)));
`;

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'record-page-structured-data-'));
const DRIVER_FILE = path.join(WORK, 'driver.mjs');
fs.writeFileSync(DRIVER_FILE, DRIVER);

const RECORD = {
  id: 'id-sd-record', slug: 'sd-record-page-fixture', title: 'SDTITLE', summary: 'SDSUMMARY',
  creatorId: 'creator-1', model: 'openai/gpt-4o', promptHash: 'x', promptVisibility: 'full_text',
  jurisdiction: null, civicContext: null, captureMethod: 'chat-flow-stream', verificationStatus: 'unverified',
  consistencyClassification: null, isPublic: true, withdrawnAt: null, withdrawnReason: null,
  reinstatedAt: null, reinstatedReason: null, createdAt: '2026-05-02T10:00:00.000Z', contentProfile: null,
  visibility: 'public', basePackageSignature: 'sig', basePackageHash: '1'.repeat(64), basePackageStorageKey: null,
};
const CREATOR = { id: 'creator-1', displayName: 'SDCREATOR', githubProfileUrl: 'https://profiles.example.test/sd', githubId: 'sd-account', createdAt: '2026-01-01T00:00:00.000Z' };

function serve(record: Record<string, unknown>, creator: Record<string, unknown>): Promise<string> {
  const inputFile = path.join(WORK, `input-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(inputFile, JSON.stringify({ record, creator }));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', DRIVER_FILE, REPO, inputFile], { cwd: REPO, env: { ...process.env, NODE_ENV: 'production' } });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`record page driver exited ${code}:\n${Buffer.concat(err).toString('utf8').slice(0, 4000)}`));
    });
  });
}

const OPEN = '<script type="application/ld+json">';

/** The structured-data element's text, read as an HTML parser reads it: up to the first `</script`, in any case. */
function structuredData(markup: string): string {
  const start = markup.indexOf(OPEN);
  assert.ok(start >= 0, 'the page renders no structured-data element');
  const from = start + OPEN.length;
  const end = markup.slice(from).search(/<\/script/i);
  assert.ok(end >= 0, 'the structured-data element does not end');
  return markup.slice(from, from + end);
}

function parsed(text: string): Record<string, unknown> {
  let value: unknown;
  assert.doesNotThrow(() => { value = JSON.parse(text); }, `the structured-data element's text is not JSON: ${text}`);
  const rest = { ...(value as Record<string, unknown>) };
  delete rest.url;
  return rest;
}

const ENDS_THE_ELEMENT = 'A</script><p>B</p>';

const CASES: [field: string, record: Record<string, unknown>, creator: Record<string, unknown>][] = [
  ['the title', { ...RECORD, title: ENDS_THE_ELEMENT }, CREATOR],
  ['the summary', { ...RECORD, summary: ENDS_THE_ELEMENT }, CREATOR],
  ['the creator display name', RECORD, { ...CREATOR, displayName: ENDS_THE_ELEMENT }],
];

const SERVED = await Promise.all(CASES.map(([, record, creator]) => serve(record, creator)));

test('premise: a record with plain values renders one structured-data element that parses', async () => {
  const markup = await serve(RECORD, CREATOR);
  assert.equal(markup.split(OPEN).length - 1, 1, 'one structured-data element');
  assert.deepEqual(parsed(structuredData(markup)), {
    '@context': 'https://schema.org', '@type': 'Dataset', name: 'SDTITLE', description: 'SDSUMMARY',
    creator: { '@type': 'Person', name: 'SDCREATOR' },
  });
});

CASES.forEach(([field, record, creator], i) => {
  test(`the record page escapes its structured data: ${field} stays inside the element and parses back equal`, () => {
    const text = structuredData(SERVED[i]);
    assert.deepEqual(parsed(text), {
      '@context': 'https://schema.org', '@type': 'Dataset', name: record.title, description: record.summary,
      creator: { '@type': 'Person', name: creator.displayName },
    });
    assert.doesNotMatch(text, /</, 'the element text carries a literal <');
  });
});
