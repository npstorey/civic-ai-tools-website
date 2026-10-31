// R10 P5 (civic-ai-tools#289, hub ADR-0038) — this host declares the Producer
// Profile subtype `ai-assisted-analysis/civicaitools-v1` on the records its own
// runs publish, full-text (`datHere`) and hash-only (`default`) alike, and its
// publish route reads the §8.1.1 invariant from verify-core's subtype table.
//
// WHAT IS DRIVEN. The REAL publish handler (`/api/records`, which re-exports
// `/api/evidence`) with the real packager, the real harness derivation and
// produce-core's envelope assembly. Criterion 1 posts the body a programmatic
// publisher would. Criterion 2 goes through the REAL publish dialog
// (`PublishEvidenceDialog.tsx`, mounted by
// `src/components/publish-dialog-test-harness.ts`): the reader picks the
// prompt visibility and presses the button, the dialog builds the body, and
// its `POST /api/records` is answered by the real handler. The stored package
// is read back as the storage stand-in received it, and verify-core's own
// check #16 reads it.
//
// The seams replaced, each where the real one would leave this machine or
// needs a request scope: `next/headers`, `next-auth`, `@/lib/auth`,
// `@/lib/api-auth`, `@/lib/evidence/unsigned-tier`, `@/lib/evidence/signing`,
// `@/lib/storage` (keeps the package it was handed, serialized), `@/lib/db`
// (keeps the row it was asked to insert) and `@/lib/evidence/publication`.
// No network: `fetch` answers the dialog's own paths and refuses the rest.
//
// WHAT MAKES EACH ASSERTION ABLE TO FAIL.
//   - Criterion 1: the `datHere` record declaring the subtype is refused by a
//     route that reads `startsWith('ai-assisted-analysis/datHere')`, so it
//     returns 400 at the base; the controls (the datHere subtype, and the
//     inconsistent pairs) return the same on both sides.
//   - Criterion 2: at the base the dialog sends no `producerProfile`, so a
//     hash-only record carries none and a full-text one carries the
//     harness's auto-derived `ai-assisted-analysis/datHere`; both differ from
//     the subtype. A publish of another capture method keeps what it carried,
//     so the seam is seen not to reach it.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/producer-profile-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkContentProfile, isContentProfileConsistent } from '@typedstandards/verify-core';

// `module.registerHooks()` is Node 22.15+ but not in the pinned `@types/node`.
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

/** The subtype, spelled out: the assertions must not lean on the constant they test. */
const SUBTYPE = 'ai-assisted-analysis/civicaitools-v1';
const DATHERE_SUBTYPE = 'ai-assisted-analysis/datHere';

// --- Module hooks ------------------------------------------------------------

const STUB_PREFIX = 'file:///r10-p5-producer-profile-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.150' }); }`,
  'next-auth': `export async function getServerSession() { return null; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/api-auth': `
    export async function resolveRequestUser() { return { userId: 'fixture-account', scopes: ['records:publish'], method: 'bearer' }; }
    export function hasPublishScope() { return true; }`,
  '@/lib/evidence/unsigned-tier': `
    export function evaluateSealCommitGate() { return null; }
    export function evaluateUnsignedRecordPublishGate() { return null; }`,
  '@/lib/evidence/signing': `
    export function getConfiguredKeyId() { return 'fixture-kid'; }
    export function getActiveSigner() { return { bindingTier: 'self-asserted', identifier: 'fixture.invalid', displayName: 'Fixture' }; }
    export function signPackage() { return null; }
    export async function getRfc3161Timestamp() { return null; }
    export async function publishToRekor() { return null; }`,
  '@/lib/storage': `
    export async function putPackage(hash, pkg) { globalThis.__p5.stored.push(JSON.stringify(pkg)); return 'https://storage.invalid/pkg.json'; }
    export async function putCommittedPackage(pkg) { globalThis.__p5.stored.push(JSON.stringify(pkg)); return 'https://storage.invalid/sealed.json'; }`,
  '@/lib/db': `
    const selectChain = { from: () => selectChain, where: () => selectChain, limit: async () => [] };
    export const db = {
      select() { return selectChain; },
      insert() { return { values: async (row) => { globalThis.__p5.rows.push(JSON.parse(JSON.stringify(row))); } }; },
    };`,
  '@/lib/evidence/publication': `
    export async function emitPublicationPair() { return { publishesNodeId: 'p', locatedAtNodeId: 'l' }; }`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    if (specifier === 'next/server' || specifier === 'next/navigation') return nextResolve(`${specifier}.js`, context);
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`R10 P5 test hook: cannot resolve ${specifier}`);
    }
    // Next's bundler resolves an extensionless relative import; Node's does not.
    const parent = (context as { parentURL?: string }).parentURL;
    if (specifier.startsWith('.') && !path.extname(specifier) && parent?.startsWith('file:')) {
      const base = path.resolve(path.dirname(fileURLToPath(parent)), specifier);
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(loadUrl.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      const json = fs.readFileSync(fileURLToPath(loadUrl), 'utf8');
      return { format: 'module', source: `export default ${json};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

interface P5Globals { stored: string[]; rows: Array<Record<string, unknown>> }
const P5: P5Globals = { stored: [], rows: [] };
(globalThis as unknown as { __p5: P5Globals }).__p5 = P5;

// --- Environment, before any app module loads ----------------------------------

for (const name of ['SITE_SEAL_ONLY', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[name];
const { REFERENCE_IDENTITY_ENV } = await import('../../lib/evidence/reference-identity-fixture.ts');
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;
process.env.PUBLISHER_KEY_ID = 'fixture-kid';

const recordsRoute = (await import('./records/route.ts')) as unknown as { POST: (request: Request) => Promise<Response> };

type Json = Record<string, unknown>;

interface DialogRequest { url: string; body: Json | null }
let DIALOG_REQUESTS: DialogRequest[] = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (raw.startsWith('/')) {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Json) : null;
    DIALOG_REQUESTS.push({ url: raw, body });
    if (raw === '/api/records/signing-status') return Response.json({ signingConfigured: true, sealOnly: false });
    if (raw === '/api/records/generate-summary') return Response.json({ summary: 'A fixture analysis of one city dataset.' });
    if (raw === '/api/records') {
      return recordsRoute.POST(new Request('http://localhost/api/records', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: init?.body as string,
      }));
    }
    return Response.json({ error: 'not answered here' }, { status: 404 });
  }
  throw new TypeError(`R10 P5 test: no network (${raw})`);
}) as typeof fetch;

// --- A publish, as a programmatic publisher posts it --------------------------------

const QUESTION = 'How many street trees were planted in 2025?';
const ANSWER = 'The dataset records 1,204 plantings in 2025.';
const TOOL_CALLS = [
  { name: 'get_data', args: { type: 'query', dataset_id: 'abcd-1234', portal: 'data.example.org' }, resultSummary: { rows: 1, columns: 1 } },
];

/** A notebook, as the dialog sends one: a datHere record requires it (§8.7.1). */
const NOTEBOOK = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells: [{ cell_type: 'markdown', metadata: {}, source: ['# Street trees planted in 2025'] }],
};

interface Posted { status: number; body: Json; pkg: Json | null }

async function post(fields: Json): Promise<Posted> {
  P5.stored = [];
  P5.rows = [];
  const response = await recordsRoute.POST(new Request('http://localhost/api/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace: { resourceSpans: [] },
      prompt: QUESTION,
      output: ANSWER,
      toolCalls: TOOL_CALLS,
      model: 'openai/gpt-4o',
      tokenUsage: { promptTokens: 10, completionTokens: 5 },
      promptVisibility: 'full_text',
      title: 'Street trees planted in 2025',
      summary: 'A count of street-tree plantings in one year.',
      captureMethod: 'chat-flow-stream',
      visibility: 'public',
      extensions: { 'org.civicaitools.notebook': NOTEBOOK },
      ...fields,
    }),
  }));
  const stored = P5.stored[0];
  return { status: response.status, body: (await response.json()) as Json, pkg: stored ? (JSON.parse(stored) as Json) : null };
}

const contentProfileOf = (pkg: Json | null) => (pkg?.metadata as Json | undefined)?.contentProfile;

// --- Criterion 1: the invariant is read from the subtype's table row ---------------

/** The rule the 400 states (fix round 1, W5), as `docs/api/records-publish.md` and
 *  verify-core 0.15.0's `isContentProfileConsistent` (`dist/profiles.js`) state it. */
const RULE = 'producerProfile and contentProfile are inconsistent (spec §8.1.1). contentProfile (absent is "default") must be one the producerProfile subtype admits: "ai-assisted-analysis/datHere" admits "datHere"; "ai-assisted-analysis/civicaitools-v1" admits "datHere" and "default"; any other subtype admits "datHere" if it begins with "ai-assisted-analysis/datHere", and "default" if it does not.';

test('1: a datHere record declaring ai-assisted-analysis/civicaitools-v1 is published (200), and check #16 reads it ok', async () => {
  const result = await post({ contentProfile: 'datHere', producerProfile: SUBTYPE });
  assert.equal(result.status, 200, `the route refused it: ${JSON.stringify(result.body)}`);
  assert.equal(result.pkg?.producerProfile, SUBTYPE, 'the package does not declare the subtype as posted');
  assert.equal(contentProfileOf(result.pkg), 'datHere');
  assert.equal(checkContentProfile(result.pkg as Json).status, 'ok', 'verify-core check #16 does not read the stored package ok');
});

test('1: a datHere record declaring ai-assisted-analysis/datHere is still published (200), its value as posted', async () => {
  const result = await post({ contentProfile: 'datHere', producerProfile: DATHERE_SUBTYPE });
  assert.equal(result.status, 200, `the route refused it: ${JSON.stringify(result.body)}`);
  assert.equal(result.pkg?.producerProfile, DATHERE_SUBTYPE);
});

for (const [label, fields] of [
  ['ai-assisted-analysis/datHere with contentProfile "default"', { contentProfile: 'default', producerProfile: DATHERE_SUBTYPE }],
  ['ai-assisted-analysis/datHere with no contentProfile (absence is "default")', { producerProfile: DATHERE_SUBTYPE }],
  ['a subtype with no row, not beginning ai-assisted-analysis/datHere, with contentProfile "datHere"', { contentProfile: 'datHere', producerProfile: 'ai-assisted-analysis/some-other-v1' }],
] as const) {
  test(`1: an inconsistent pair is still refused (400): ${label}`, async () => {
    const result = await post(fields);
    assert.equal(result.status, 400, `the route accepted an inconsistent pair: ${JSON.stringify(result.body)}`);
    const posted0 = fields as { producerProfile: string; contentProfile?: string };
    assert.equal(
      result.body.error,
      `${RULE} Received: producerProfile "${posted0.producerProfile}", contentProfile ${posted0.contentProfile === undefined ? 'absent' : `"${posted0.contentProfile}"`}.`,
      'the 400 does not state the rule and the two values received',
    );
    assert.equal(result.pkg, null, 'a package was stored for a refused publish');
    const posted = fields as { producerProfile: string; contentProfile?: string };
    assert.equal(isContentProfileConsistent(posted.producerProfile, posted.contentProfile ?? 'default'), false, 'premise: verify-core reads the pair as inconsistent too');
  });
}

// --- Criterion 2: every record this host's own runs publish declares the subtype ----

const { mountPublishDialog, fire } = await import('../../components/publish-dialog-test-harness.ts');

/** The props `McpResponseDisplay` hands the dialog for a chat-flow answer. */
const CHAT_PROPS: Json = {
  queryText: QUESTION,
  output: ANSWER,
  toolCalls: TOOL_CALLS,
  evidenceTrace: { resourceSpans: [] },
  model: 'openai/gpt-4o',
  portal: 'data.example.org',
  promptTokens: 10,
  completionTokens: 5,
  duration_ms: 1200,
};
const ATTRIBUTION = { origin: 'https://fixture.invalid', host: 'fixture.invalid', platformTitle: 'Fixture Instance' };

interface ThroughDialog { sent: Json | null; pkg: Json | null }

async function publishThroughDialog(promptVisibility: 'full_text' | 'hash_only'): Promise<ThroughDialog> {
  P5.stored = [];
  P5.rows = [];
  DIALOG_REQUESTS = [];
  const dialog = await mountPublishDialog(CHAT_PROPS, ATTRIBUTION);
  await dialog.settle();
  if (promptVisibility === 'hash_only') {
    fire(dialog.inputLabelled('Hash only'), 'onChange');
    await dialog.settle();
  }
  await fire(dialog.button('Seal'), 'onClick');
  await dialog.settle();
  const stored = P5.stored[0];
  return {
    sent: DIALOG_REQUESTS.find((r) => r.url === '/api/records')?.body ?? null,
    pkg: stored ? (JSON.parse(stored) as Json) : null,
  };
}

// Published inside the first test that reads them, never at module level:
// node:test starts a test as it is declared, so a module-level publish would
// share the storage stand-in with criterion 1's tests.
let RUNS: { HASH_ONLY: ThroughDialog; FULL_TEXT: ThroughDialog } | null = null;
async function runs() {
  RUNS ??= { HASH_ONLY: await publishThroughDialog('hash_only'), FULL_TEXT: await publishThroughDialog('full_text') };
  return RUNS;
}

test('2: premise: the dialog published both records, as chat-flow-stream, hash-only as "default" and full-text as "datHere"', async () => {
  const { HASH_ONLY, FULL_TEXT } = await runs();
  assert.equal(HASH_ONLY.sent?.captureMethod, 'chat-flow-stream');
  assert.equal(HASH_ONLY.sent?.promptVisibility, 'hash_only');
  assert.equal(HASH_ONLY.sent?.contentProfile, 'default');
  assert.equal(FULL_TEXT.sent?.contentProfile, 'datHere');
  assert.ok(HASH_ONLY.pkg, 'no package was stored for the hash-only publish');
  assert.ok(FULL_TEXT.pkg, 'no package was stored for the full-text publish');
});

test('2: a hash-only publish through the dialog carries producerProfile ai-assisted-analysis/civicaitools-v1', async () => {
  const { HASH_ONLY } = await runs();
  assert.equal(HASH_ONLY.pkg?.producerProfile, SUBTYPE, 'the hash-only record does not declare the subtype');
  assert.equal(contentProfileOf(HASH_ONLY.pkg), 'default', 'the content profile\'s value moved');
  assert.equal(checkContentProfile(HASH_ONLY.pkg as Json).status, 'ok', 'verify-core check #16 does not read it ok');
});

test('2: a full-text publish through the dialog carries producerProfile ai-assisted-analysis/civicaitools-v1', async () => {
  const { FULL_TEXT } = await runs();
  assert.equal(FULL_TEXT.pkg?.producerProfile, SUBTYPE, 'the full-text record does not declare the subtype');
  assert.equal(contentProfileOf(FULL_TEXT.pkg), 'datHere', 'the content profile\'s value moved');
  assert.equal(checkContentProfile(FULL_TEXT.pkg as Json).status, 'ok', 'verify-core check #16 does not read it ok');
});

test('2: the value is set by the route, not sent by the dialog', async () => {
  const { HASH_ONLY, FULL_TEXT } = await runs();
  for (const run of [HASH_ONLY, FULL_TEXT]) {
    assert.equal(run.sent !== null && 'producerProfile' in run.sent, false, 'the dialog sent a producerProfile');
  }
});

for (const [contentProfile, expected] of [['default', undefined], ['datHere', DATHERE_SUBTYPE]] as const) {
  test(`2: a publish of another capture method keeps what it carried (claude-code-jsonl-readback, ${contentProfile})`, async () => {
    const result = await post({ captureMethod: 'claude-code-jsonl-readback', contentProfile });
    assert.equal(result.status, 200, `the route refused it: ${JSON.stringify(result.body)}`);
    assert.equal(result.pkg?.producerProfile, expected);
  });
}

test('1: the 400 quotes a received value without control characters, bounded to 120 characters', async () => {
  const long = `${DATHERE_SUBTYPE}\u0007\n\u001b[31m\u0085${'x'.repeat(200)}`;
  const result = await post({ contentProfile: 'default', producerProfile: long });
  assert.equal(result.status, 400, `the route accepted an inconsistent pair: ${JSON.stringify(result.body)}`);
  const quoted = /Received: producerProfile "([^"]*)", contentProfile "default"\.$/.exec(String(result.body.error))?.[1];
  assert.ok(quoted !== undefined, `the 400 does not quote the values received: ${String(result.body.error)}`);
  assert.doesNotMatch(quoted, /[\u0000-\u001f\u007f-\u009f]/, 'a control character reached the message');
  assert.equal(quoted.length, 120, 'the quoted value is not bounded to 120 characters');
  assert.equal(quoted, `${DATHERE_SUBTYPE}[31m${'x'.repeat(200)}`.slice(0, 120), 'the quoted value is not the received one, control characters removed, then bounded');
});
