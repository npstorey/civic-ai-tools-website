// #516 WF — the served record page carries no creator account key.
//
// THE RULE THIS HOLDS. The record page decides on the server whether the
// viewer is the record's creator, and shows the dashboard link from that
// decision. Nothing the page serves to a viewer, creator or not, carries the
// creator's account key (`users.githubId`): not the HTML, and not the payload
// Next streams beside it for the browser to rebuild the page from.
//
// WHY THE PAYLOAD IS DRIVEN, NOT ONLY THE HTML. A prop a server component
// hands a client component (a `'use client'` module) is serialized into the
// streamed payload, which static markup does not show. So the page is
// rendered twice per viewer, in child processes:
//   - FLIGHT: under the `react-server` condition, through the serializer Next
//     itself uses for that payload (`next/dist/compiled/react-server-dom-
//     webpack/server.node.js`, with Next's compiled React), in production
//     mode. Every `'use client'` module the page imports is replaced by a
//     client reference, as Next's bundler does, so its props are serialized
//     exactly as they would be served;
//   - HTML: with the app's React and `renderToStaticMarkup`, inside the
//     sign-in library's `SessionProvider` holding the viewer's session.
// The key is searched raw, JSON-escaped and HTML-escaped; the fixture key
// contains `"`, `<`, `&` and `>`, so the three forms differ.
//
// STUBS, each where the real module needs a database, storage or a request
// scope: `@/lib/db` (answers the record, then its creator), `@/lib/storage`,
// `@/lib/evidence/lifecycle`, `@/lib/evidence/adversarial-eval`,
// `@/lib/evidence/sealed-access` (`sessionUserIsCreator` answers whether this
// run's viewer is the creator), `next/headers`, `next/navigation` (`notFound`
// throws a marker). The page, its server components and the decision it makes
// are the real ones.
//
// WHAT MAKES IT ABLE TO FAIL. A premise test requires the payload to carry
// the client references and the props the page hands them (the creator's
// display name reaches the citation block), so an empty payload cannot pass;
// any prop that carried the key to a client component would be found.
//
// WHAT IS OUTSIDE THIS FILE. The record's attestations load
// in the browser from the attestations route after the page arrives; they are
// outside the served page and its payload, and outside this file.
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

// --- The driver, written out per run -------------------------------------------

const DRIVER = String.raw`
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [, , REPO, MODE, INPUT] = process.argv;
const SRC = path.join(REPO, 'src');
const req = nodeModule.createRequire(path.join(REPO, 'package.json'));
const ts = req('typescript');
const FLIGHT_MODE = MODE === 'flight';

const STUB_PREFIX = 'file:///r3-wf-record-page-stub/';
const STUB_SOURCE = {
  '@/lib/db': 'const chain = { from() { return chain; }, where() { return chain; }, orderBy() { return chain; }, async limit() { return (globalThis.__rows ?? []).shift() ?? []; } };\n' +
    'export const db = { select() { return chain; } };',
  '@/lib/storage': 'export async function getPackage() { return globalThis.__pkg ?? null; }',
  '@/lib/evidence/lifecycle': "export async function resolveLifecycle() { return { status: 'active', source: 'legacy-columns', chain: [] }; }",
  '@/lib/evidence/adversarial-eval': 'export async function loadEvaluationViews() { return []; }',
  '@/lib/evidence/sealed-access': 'export async function sessionUserIsCreator() { return globalThis.__viewerIsCreator === true; }',
  'next/headers': "export async function headers() { const h = { host: 'records.example.test', 'x-forwarded-proto': 'https' }; return { get(name) { return h[name] ?? null; } }; }",
  'next/navigation': "export function notFound() { throw new Error('R3WF_NOT_FOUND'); }",
};

const FLIGHT = pathToFileURL(req.resolve('next/dist/compiled/react-server-dom-webpack/server.node.js')).href;
// Next aliases React to its compiled copy; under react-server, its server builds.
const REACT_SERVER = {
  react: 'react/react.react-server.js',
  'react/jsx-runtime': 'react/jsx-runtime.react-server.js',
  'react/jsx-dev-runtime': 'react/jsx-dev-runtime.react-server.js',
  'react-dom': 'react-dom/react-dom.react-server.js',
  'next/dist/compiled/react': 'react/react.react-server.js',
  'next/dist/compiled/react/jsx-runtime': 'react/jsx-runtime.react-server.js',
  'next/dist/compiled/react-dom': 'react-dom/react-dom.react-server.js',
};
// An ES module importing 'react' gets every name the client build exports,
// read off the server build: a name the server build lacks is undefined, as a
// bundler leaves it, rather than a link error.
const REACT_ESM_URL = 'file:///r3-wf-record-page-react-esm.mjs';
const REACT_SERVER_FILE = pathToFileURL(req.resolve('next/dist/compiled/react/react.react-server.js')).href;
const REACT_ESM = FLIGHT_MODE
  ? 'import R from ' + JSON.stringify(REACT_SERVER_FILE) + ';\nexport default R;\n' +
    Object.keys(req('next/dist/compiled/react/index.js')).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
      .map((n) => 'export const ' + n + ' = R[' + JSON.stringify(n) + '];').join('\n')
  : '';
const LINK_URL = 'file:///r3-wf-record-page-next-link.mjs';

const CLIENT_DIRECTIVE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"]/;

function transpile(file, source) {
  return ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function clientReference(id, name) {
  return 'registerClientReference(function () { throw new Error("client"); }, ' + JSON.stringify(id) + ', ' + JSON.stringify(name) + ')';
}

/** A 'use client' module, as the bundler hands it to a server component: a client reference per export. */
function clientReferenceModule(file, source) {
  const out = transpile(file, source);
  const names = new Set();
  if (/export default\b/.test(out)) names.add('default');
  for (const m of out.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of out.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  }
  const id = pathToFileURL(file).href;
  return ['import { registerClientReference } from ' + JSON.stringify(FLIGHT) + ';',
    ...[...names].map((n) => n === 'default' ? 'export default ' + clientReference(id, n) + ';' : 'export const ' + n + ' = ' + clientReference(id, n) + ';'),
  ].join('\n');
}

function firstFile(candidates) {
  for (const c of candidates) { try { if (fs.statSync(c).isFile()) return c; } catch {} }
  return null;
}
const candidatesFor = (b) => [b, b + '.ts', b + '.tsx', path.join(b, 'index.ts'), path.join(b, 'index.tsx')];

nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(STUB_SOURCE, specifier)) return { url: STUB_PREFIX + encodeURIComponent(specifier) + '.mjs', format: 'module', shortCircuit: true };
    if (FLIGHT_MODE) {
      if ((specifier === 'react' || specifier === 'next/dist/compiled/react') && context.conditions?.includes('import')) {
        return { url: REACT_ESM_URL, format: 'module', shortCircuit: true };
      }
      if (Object.hasOwn(REACT_SERVER, specifier)) {
        return { url: pathToFileURL(req.resolve('next/dist/compiled/' + REACT_SERVER[specifier])).href, shortCircuit: true };
      }
      // next/link is a 'use client' module (next/dist/client/app-dir/link.js).
      if (specifier === 'next/link') return { url: LINK_URL, format: 'module', shortCircuit: true };
    } else if (specifier === 'next/link') {
      return nextResolve('next/link.js', context);
    }
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
    if (url === REACT_ESM_URL) return { format: 'module', source: REACT_ESM, shortCircuit: true };
    if (url === LINK_URL) {
      return { format: 'module', source: 'import { registerClientReference } from ' + JSON.stringify(FLIGHT) + ';\nexport default ' + clientReference('next/link', 'default') + ';', shortCircuit: true };
    }
    if (url.startsWith(STUB_PREFIX)) {
      return { format: 'module', source: STUB_SOURCE[decodeURIComponent(url.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''))], shortCircuit: true };
    }
    if (url.startsWith('file:')) {
      const file = fileURLToPath(url);
      if (file.startsWith(SRC) && /\.tsx?$/.test(file)) {
        const source = fs.readFileSync(file, 'utf8');
        if (FLIGHT_MODE && CLIENT_DIRECTIVE.test(source)) return { format: 'module', source: clientReferenceModule(file, source), shortCircuit: true };
        return { format: 'module', source: transpile(file, source), shortCircuit: true };
      }
    }
    return nextLoad(url, context);
  },
});

const input = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
input.record.createdAt = new Date(input.record.createdAt);
input.creator.createdAt = new Date(input.creator.createdAt);
globalThis.__rows = [[input.record], [input.creator]];
globalThis.__pkg = null;
globalThis.__viewerIsCreator = input.viewerIsCreator;
globalThis.fetch = async (u) => { throw new Error('record page driver: no network (' + u + ')'); };

const { default: EvidencePage } = await import(pathToFileURL(path.join(SRC, 'app', '(app)', 'evidence', '[slug]', 'page.tsx')).href);
let element;
try {
  element = await EvidencePage({ params: Promise.resolve({ slug: input.record.slug }) });
} catch (err) {
  if (err instanceof Error && err.message === 'R3WF_NOT_FOUND') { process.stdout.write('R3WF_NOT_FOUND'); process.exit(0); }
  throw err;
}

if (FLIGHT_MODE) {
  const { renderToPipeableStream } = await import(FLIGHT);
  const { Writable } = await import('node:stream');
  // The client manifest: any client reference resolves to a module id of its own name.
  const manifest = new Proxy({}, { get: (_target, key) => ({ id: String(key), chunks: [], name: '*' }) });
  const chunks = [];
  await new Promise((resolve, reject) => {
    const sink = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); }, final(cb) { resolve(); cb(); } });
    renderToPipeableStream(element, manifest, { onError: reject }).pipe(sink);
  });
  process.stdout.write(Buffer.concat(chunks));
} else {
  // Resolved from the repository, as the page's own imports are.
  const fromRepo = (specifier) => import(pathToFileURL(req.resolve(specifier)).href);
  const { createElement } = await fromRepo('react');
  const { renderToStaticMarkup } = await fromRepo('react-dom/server');
  const { SessionProvider } = await fromRepo('next-auth/react');
  process.stdout.write(renderToStaticMarkup(createElement(SessionProvider, { session: input.session }, element)));
}
`;

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-wf-record-page-'));
const DRIVER_FILE = path.join(WORK, 'driver.mjs');
fs.writeFileSync(DRIVER_FILE, DRIVER);

// --- Fixtures -------------------------------------------------------------------

/** Characters that escape differently in JSON and in HTML, so each form is searched for itself. */
const CREATOR_KEY = 'wf-creator-account-key:7f3a"<&>';
const CREATOR_NAME = 'WFCREATORNAME';
const CREATOR_PROFILE = 'https://profiles.example.test/wf-creator';
const OTHER_ACCOUNT = 'wf-other-account-key';

const RECORD = {
  id: 'id-wf-record', slug: 'wf-record-page-fixture', title: 'WFRECORDTITLE', summary: 'WFRECORDSUMMARY',
  creatorId: 'creator-1', model: 'openai/gpt-4o', promptHash: 'x', promptVisibility: 'full_text',
  jurisdiction: null, civicContext: null, captureMethod: 'chat-flow-stream', verificationStatus: 'unverified',
  consistencyClassification: null, isPublic: true, withdrawnAt: null, withdrawnReason: null,
  reinstatedAt: null, reinstatedReason: null, createdAt: '2026-05-02T10:00:00.000Z', contentProfile: null,
  visibility: 'public', basePackageSignature: 'sig', basePackageHash: '1'.repeat(64), basePackageStorageKey: null,
};
const CREATOR = { id: 'creator-1', displayName: CREATOR_NAME, githubProfileUrl: CREATOR_PROFILE, githubId: CREATOR_KEY, createdAt: '2026-01-01T00:00:00.000Z' };

type Viewer = 'creator' | 'other';
type Mode = 'flight' | 'html';

function session(viewer: Viewer) {
  return { user: { id: viewer === 'creator' ? CREATOR_KEY : OTHER_ACCOUNT, name: 'viewer' }, expires: '2099-01-01T00:00:00.000Z' };
}

function runDriver(mode: Mode, input: Record<string, unknown>): Promise<string> {
  const inputFile = path.join(WORK, `input-${mode}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(inputFile, JSON.stringify(input));
  const args = [...(mode === 'flight' ? ['--conditions=react-server'] : []), '--experimental-strip-types', DRIVER_FILE, REPO, mode, inputFile];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: REPO, env: { ...process.env, NODE_ENV: 'production' } });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(`record page driver (${mode}) exited ${code}:\n${Buffer.concat(err).toString('utf8').slice(0, 4000)}`));
    });
  });
}

function serve(mode: Mode, viewer: Viewer, record: Record<string, unknown> = RECORD): Promise<string> {
  return runDriver(mode, { record, creator: CREATOR, viewerIsCreator: viewer === 'creator', session: session(viewer) });
}

const SERVED: Record<`${Mode}:${Viewer}`, string> = Object.fromEntries(
  await Promise.all(
    (['flight', 'html'] as const).flatMap((mode) => (['creator', 'other'] as const).map(async (viewer) => [`${mode}:${viewer}`, await serve(mode, viewer)] as const)),
  ),
) as Record<`${Mode}:${Viewer}`, string>;

const htmlEscaped = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const KEY_FORMS = [CREATOR_KEY, JSON.stringify(CREATOR_KEY).slice(1, -1), htmlEscaped(CREATOR_KEY)];

// --- The instrument sees the payload ----------------------------------------------

test('the streamed payload is read: it carries client references and the props the page hands them', () => {
  for (const viewer of ['creator', 'other'] as const) {
    const flight = SERVED[`flight:${viewer}`];
    assert.match(flight, /^\d+:I\[/m, `${viewer}: the payload carries no client reference`);
    assert.ok(flight.includes('CitationBlock.tsx#default'), `${viewer}: the citation block is not a client reference in the payload`);
    assert.ok(flight.includes(`"creatorName":"${CREATOR_NAME}"`), `${viewer}: a prop the page hands a client component is not in the payload`);
    assert.ok(flight.includes(RECORD.title), `${viewer}: the payload does not carry the record title`);
    assert.ok(SERVED[`html:${viewer}`].includes(RECORD.title), `${viewer}: the HTML does not carry the record title`);
  }
  assert.equal(new Set(KEY_FORMS).size, 3, 'the key forms searched are not distinct');
});

// --- The rule -----------------------------------------------------------------------

for (const viewer of ['other', 'creator'] as const) {
  test(`the served record page carries no creator account key, viewed by ${viewer === 'creator' ? 'the creator' : 'another account'}`, () => {
    for (const mode of ['flight', 'html'] as const) {
      const served = SERVED[`${mode}:${viewer}`];
      const found = KEY_FORMS.filter((form) => served.includes(form));
      const at = found.length > 0 ? served.slice(Math.max(0, served.indexOf(found[0]) - 120), served.indexOf(found[0]) + found[0].length + 20) : '';
      assert.deepEqual(found, [], `${mode === 'flight' ? 'the streamed payload' : 'the HTML'} carries the creator's account key:\n${at}`);
    }
  });
}

test('the creator sees the dashboard link and another account does not', () => {
  assert.match(SERVED['html:creator'], /<a [^>]*href="\/dashboard"[^>]*>View in Dashboard/, 'the creator is not shown the dashboard link');
  assert.doesNotMatch(SERVED['html:other'], /View in Dashboard|href="\/dashboard"/, 'another account is shown the dashboard link');
});

test("the page shows the creator's name, linked to their profile, to any viewer (the privacy page's attribution statement)", () => {
  for (const viewer of ['creator', 'other'] as const) {
    assert.match(
      SERVED[`html:${viewer}`],
      new RegExp(`<a href="${CREATOR_PROFILE}"[^>]*>${CREATOR_NAME}</a>`),
      `${viewer}: the creator's name is not linked to their profile`,
    );
  }
});

test("a sealed record's page is not found for anyone but its creator", async () => {
  const sealed = { ...RECORD, visibility: 'sealed', slug: 'wf-sealed-fixture', basePackageStorageKey: 'https://store.example.test/evidence-packages/committed/0123456789abcdef0123456789abcdef.json' };
  for (const mode of ['flight', 'html'] as const) {
    assert.equal(await serve(mode, 'other', sealed), 'R3WF_NOT_FOUND', `${mode}: a sealed record's page rendered for another account`);
  }
});
