// #503 WF — the carriers, driven through the real paths into the log.
//
// `errors-out-of-logs.test.ts` holds the property over every server-side log
// call and runs each site's own call text with every carrier. What it cannot
// show is that a real failure ARRIVES at the site carrying a reader's words.
// This file shows that, through the real handlers and library functions, for
// the sites where the carrier can be produced on loopback:
//
//   THE MODEL SDK. A loopback model endpoint refuses every request with 400 and
//   echoes the request's last message back in the refusal body — which is what
//   a real endpoint's content filter does. The reader's question travels the
//   real path: request → route → model client → endpoint → the SDK's own
//   `APIError` → the route's `catch` → the log. Driven into
//   `/api/compare`, `/api/evidence/generate-summary`,
//   `/api/evidence/[slug]/evaluate` and `/api/evidence/[slug]/replay`.
//
//   THE ORM. `DB_DRIVER=node-postgres` with `DATABASE_URL` on a loopback socket
//   that hangs up on connect: the real driver, the real `drizzle` wrapper,
//   every query failing as a connection drop does. The wrapper writes every
//   bound parameter into the error's message. Driven into
//   `/api/auth/device/code` (#506: the client's name, bound beside both
//   generated codes), `/api/evidence` (the reader's title, as the slug the
//   route queries for) and `resolveLifecycle`.
//
//   A MALFORMED BODY. `JSON.parse` quotes what it rejects. Driven into
//   `/api/compare` and `/api/compare-stream`.
//
//   A SOURCE'S OWN TEXT. A loopback MCP source answers with a reason phrase, a
//   malformed body or an error status the source chose. Driven into
//   `src/lib/mcp/client.ts` (the server-error line and the instructions
//   parse), `src/lib/mcp/socrata-skill.ts` (the skill fetch and the composer)
//   and `src/lib/mcp/directory-data.ts`.
//
// WHAT IS NOT REACHED. No live database — the ORM's wrapper is driven, not
// Postgres or Neon; the `neon-http` driver shares the wrapper (both extend
// `PgPreparedQuery`) but is not the one run here. No live model endpoint. No
// Turbopack artifact: this is unbundled TypeScript under `node --test`. The
// publish route (`/api/evidence/[slug]/publish`), the attestation route, the
// blob sweep, the rate-limit route, storage deletes and the signing services'
// failures are covered by the other file's matrix only — reaching them here
// needs a signing key, storage and a record already in a database.
//
// STUBS, and why each is a stub rather than the real module. `module.
// registerHooks()` in-file, as in `logs-carry-no-reader-content.test.ts`
// (#503's rider forbids a CLI flag in `package.json`):
//   - `next/headers`, `next-auth`, `@/lib/auth`: no request scope and no
//     sign-in provider outside Next — a signed-in fixture account;
//   - `@/lib/api-auth`, `@/lib/evidence/sealed-access`: the same account,
//     allowed to publish and to read its own record;
//   - `@/lib/evidence/unsigned-tier`, `@/lib/evidence/signing`: no signing key
//     is handled in a session (CLAUDE.md), and the timestamp and transparency
//     services are real third-party hosts — never called from a test;
//   - `@/lib/storage`: no object storage; it hands back the package under test;
//   - `@/lib/db`: switchable. The ORM drives run the REAL module; the SDK
//     drives, which need a record to exist, read one row from a fake.
// No sandbox, no signing key and no non-loopback address is involved.
//
// THE INSTRUMENT HAS BEEN SEEN WORKING. Run unmodified against the base
// (`0b8079c`), every `canary` assertion here fails with the canary on the
// line — shown in #503 WF's gate record.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/errors-out-of-logs-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import * as nodeModule from 'node:module';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/** The reader's words. Lower-case alphanumerics, so it survives being made into a slug. */
const CANARY = 'wq3ytr8nreadercanary';
/** `JSON.parse` quotes at most ten characters of what it rejects. */
const JSON_CANARY = 'Jz4qWv7k';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const url = (rel: string) => JSON.stringify(pathToFileURL(path.join(SRC, rel)).href);

// --- Module hooks -------------------------------------------------------------

const STUB_PREFIX = 'file:///civic-wf-stub/';
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers({ 'x-forwarded-for': '203.0.113.7' }); }`,
  'next-auth': `export async function getServerSession() { return { user: { id: 'fixture-account' } }; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/api-auth': `
    export async function resolveRequestUser() { return { userId: 'fixture-account', scopes: ['records:publish'], via: 'bearer' }; }
    export function hasPublishScope() { return true; }`,
  '@/lib/evidence/sealed-access': `export async function canReadRecord() { return true; }`,
  '@/lib/evidence/unsigned-tier': `export function evaluateSealCommitGate() { return null; }`,
  '@/lib/evidence/signing': `
    import { getActiveSigner } from ${url('lib/evidence/signing.ts')};
    export { getActiveSigner };
    export function signPackage() { return null; }
    export async function getRfc3161Timestamp() { return null; }
    export async function publishToRekor() { return null; }`,
  '@/lib/storage': `
    export async function getPackage() { return globalThis.__wfPackage ?? null; }
    export async function putPackage() { return 'https://storage.invalid/pkg.json'; }
    export async function putCommittedPackage() { return 'https://storage.invalid/sealed.json'; }
    export async function deletePackageBlob() {}`,
  '@/lib/db': `
    import { db as realDb } from ${url('lib/db/index.ts')};
    export const db = new Proxy({}, {
      get(_target, prop) {
        const target = globalThis.__wfDbMode === 'fake' ? globalThis.__wfFakeDb : realDb;
        return Reflect.get(target, prop);
      },
    });`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: `${STUB_PREFIX}${encodeURIComponent(specifier)}.mjs`, format: 'module', shortCircuit: true };
    }
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`#503 WF test hook: cannot resolve ${specifier}`);
    }
    // Next's bundler resolves an extensionless relative import; Node's ESM
    // resolver does not. The route tree has a few (`./host-routing` in
    // `device-flow.ts`), so they are resolved the way the bundler would.
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
    // `import data from './x.json'` with no import attribute, as the bundler
    // accepts it (`directory-data.ts`'s bundled snapshot).
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      const json = fs.readFileSync(fileURLToPath(loadUrl), 'utf8');
      return { format: 'module', source: `export default ${json};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

const globals = globalThis as unknown as Record<string, unknown>;

// --- Console capture ----------------------------------------------------------

async function captureConsole(run: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const methods = ['log', 'error', 'warn', 'info', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(util.format(...args)); };
  try {
    await run();
  } finally {
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
  return lines;
}

function leaked(lines: string[], canary: string): string[] {
  return lines.filter((l) => l.includes(canary)).map((l) => `  | ${l.slice(0, 400).replace(/\n/g, '\n  | ')}`);
}

// --- Loopback: a model endpoint that refuses and echoes -------------------------

const modelRequests: string[] = [];
const refusingModel = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  modelRequests.push(body);
  const parsed = JSON.parse(body) as { messages?: Array<{ content?: unknown }> };
  const last = parsed.messages?.at(-1)?.content;
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `Input flagged by the content filter: ${String(last)}`, type: 'invalid_request_error' } }));
});
await new Promise<void>((resolve) => refusingModel.listen(0, '127.0.0.1', () => resolve()));
refusingModel.unref();

// --- Loopback: a database that hangs up ---------------------------------------

const hangUp = net.createServer((socket) => socket.destroy());
await new Promise<void>((resolve) => hangUp.listen(0, '127.0.0.1', () => resolve()));
hangUp.unref();

// --- Loopback: an MCP source whose answers the test chooses --------------------

type SourceMode = 'ok' | 'bad-initialize-body' | 'tool-reason-phrase' | 'prompt-reason-phrase';
let sourceMode: SourceMode = 'ok';
const source = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-wf-session' });
    // A body the client cannot parse, opening with the canary: JSON.parse
    // quotes it back in the error it throws.
    if (sourceMode === 'bad-initialize-body') { res.end(`data: ${JSON_CANARY}\n\n`); return; }
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'wf', version: '0' } } }));
    return;
  }
  if (msg.method === 'tools/call' && sourceMode === 'tool-reason-phrase') {
    res.writeHead(502, `Upstream refused the query about ${CANARY}`);
    res.end();
    return;
  }
  if (msg.method === 'prompts/get' && sourceMode === 'prompt-reason-phrase') {
    res.writeHead(500, `Prompt failed for ${CANARY}`);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  if (msg.method === 'prompts/get') {
    res.end(`event: message\ndata: ${reply({ result: { messages: [{ content: { type: 'text', text: 'Guidance.' } }] } })}\n\n`);
    return;
  }
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: '{"data":[]}' }] } })}\n\n`);
});
await new Promise<void>((resolve) => source.listen(0, '127.0.0.1', () => resolve()));
source.unref();
const SOURCE_URL = `http://127.0.0.1:${(source.address() as AddressInfo).port}/mcp`;

// A directory source that answers 200 with a body that is not JSON.
const directory = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON_CANARY);
});
await new Promise<void>((resolve) => directory.listen(0, '127.0.0.1', () => resolve()));
directory.unref();

// --- Environment, before any app module loads ----------------------------------

for (const name of ['MODEL_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'SITE_DEFAULT_PORTAL', 'MODEL_CATALOG_PATH']) {
  delete process.env[name];
}
// All three sources on loopback: `registry.ts` carries literal third-party
// default URLs for two of them.
process.env.SOCRATA_MCP_URL = SOURCE_URL;
process.env.DATA_COMMONS_MCP_URL = SOURCE_URL;
process.env.BOSTON_OPENCONTEXT_MCP_URL = SOURCE_URL;
process.env.DIRECTORY_DATA_URL = `http://127.0.0.1:${(directory.address() as AddressInfo).port}/servers.json`;
process.env.MODEL_API_BASE_URL = `http://127.0.0.1:${(refusingModel.address() as AddressInfo).port}/v1`;
// Presence is all the route's guard checks; the loopback endpoint never authenticates.
process.env.MODEL_API_KEY = 'fixture';
// The packager refuses to build a package for an instance that has not
// declared who it is; these are fixture values for a fixture instance.
process.env.PUBLISHER_PLATFORM_AGENT_TITLE = 'Fixture Instance';
process.env.PUBLISHER_SITE_ORIGIN = 'https://fixture.invalid';
// A key ID is a label naming a trust-registry entry, not key material; no key
// is set, so nothing is signed.
process.env.PUBLISHER_KEY_ID = 'fixture-kid';
process.env.DB_DRIVER = 'node-postgres';
process.env.DATABASE_URL = `postgresql://fixture@127.0.0.1:${(hangUp.address() as AddressInfo).port}/fixture`;
process.env.MODEL_CATALOG = JSON.stringify([
  {
    id: 'fixture-fast', name: 'Fixture Model', provider: 'Example Provider', supports_tools: true,
    endpointModel: 'example-fixture-deployment', model: 'vendor/model-fixture-1', default: true, evaluator: 1,
  },
  {
    id: 'fixture-judge', name: 'Fixture Judge', provider: 'Example Provider', supports_tools: true,
    endpointModel: 'example-judge-deployment', model: 'vendor/model-judge-1', evaluator: 2,
  },
]);

function post(route: string, body: unknown, raw?: string): Request {
  return new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

interface Drive { lines: string[]; status: number; body: string }

async function drive(run: () => Promise<Response>): Promise<Drive> {
  let response: Response | undefined;
  const lines = await captureConsole(async () => { response = await run(); });
  return { lines, status: response!.status, body: await response!.text() };
}

// --- The drives ------------------------------------------------------------------

globals.__wfDbMode = 'real';

// #506 — the device-code insert. The client's NAME is bound beside both codes.
const deviceCode = await import('../app/api/auth/device/code/route.ts');
const DEVICE = await drive(() => deviceCode.POST(post('/api/auth/device/code', { name: `cli on ${CANARY}` }) as never));

// The evidence publish route: the title becomes the slug the route queries for.
const { buildEvidencePackage } = await import('./evidence/packager.ts');
const evidenceRoute = await import('../app/api/evidence/route.ts');
const EVIDENCE = await drive(() => evidenceRoute.POST(post('/api/evidence', {
  trace: { resourceSpans: [] },
  prompt: `How many noise complaints mention ${CANARY}?`,
  output: 'Twelve.',
  toolCalls: [],
  model: 'vendor/model-fixture-1',
  tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  duration_ms: 1000,
  captureMethod: 'chat-flow-stream',
  title: `Noise complaints ${CANARY}`,
  visibility: 'public',
  // Supplied, so the route does not need this instance's signer identity.
  signer: { bindingTier: 'self-asserted', identifier: 'fixture.invalid', displayName: 'Fixture' },
}) as never));

// The lifecycle resolver's attestation query.
const { resolveLifecycle } = await import('./evidence/lifecycle.ts');
const LIFECYCLE_LINES = await captureConsole(() => resolveLifecycle({
  basePackageHash: CANARY, withdrawnAt: null, withdrawnReason: null, reinstatedAt: null, reinstatedReason: null,
}));

// A source's malformed initialize body, then its reason phrase on a tool call.
const mcpClient = await import('./mcp/client.ts');
sourceMode = 'bad-initialize-body';
const INSTRUCTIONS_LINES = await captureConsole(() => mcpClient.getServerInstructions('socrata'));
sourceMode = 'tool-reason-phrase';
const REASON_LINES = await captureConsole(() =>
  mcpClient.callMcpTool('get_data', { type: 'query', dataset_id: 'abcd-1234', portal: 'data.example.org' }).catch(() => null));

// The skill fetch, failing on the source's reason phrase — then the composer
// with a source whose text fetch rejects with the ORM's real error.
const skill = await import('./mcp/socrata-skill.ts');
sourceMode = 'prompt-reason-phrase';
const SKILL_LINES = await captureConsole(() => skill.buildSystemPrompt('data.example.org'));
sourceMode = 'ok';
let ormError: unknown;
try {
  const { db } = await import('./db/index.ts');
  const { evidenceRecords } = await import('./db/schema.ts');
  const { eq } = await import('drizzle-orm');
  await db.select().from(evidenceRecords).where(eq(evidenceRecords.slug, `composer-${CANARY}`));
} catch (err) {
  ormError = err;
}
const COMPOSER_LINES = await captureConsole(() => skill.composeSkillPrompt(
  ['socrata'],
  { today: '2026-09-21' } as never,
  { socrata: { fetchText: async () => { throw ormError; } } } as never,
));

// The directory source's malformed body.
const { getDirectoryData } = await import('./mcp/directory-data.ts');
const DIRECTORY_LINES = await captureConsole(() => getDirectoryData());

// The model SDK, through four routes. The refusing endpoint echoes what it was sent.
const compare = await import('../app/api/compare/route.ts');
const COMPARE = await drive(() => compare.POST(post('/api/compare', {
  query: `How many noise complaints mention ${CANARY}?`, model: 'fixture-fast', portal: 'data.example.org',
}) as never));
const COMPARE_BODY = await drive(() => compare.POST(post('/api/compare', null, JSON_CANARY) as never));
const compareStream = await import('../app/api/compare-stream/route.ts');
const COMPARE_STREAM_BODY = await drive(() => compareStream.POST(post('/api/compare-stream', null, JSON_CANARY) as never));

const summary = await import('../app/api/evidence/generate-summary/route.ts');
const SUMMARY = await drive(() => summary.POST(post('/api/evidence/generate-summary', {
  prompt: `How many noise complaints mention ${CANARY}?`, output: 'Twelve.', toolCalls: [],
}) as never));

// A record that exists, for evaluate and replay: one row from a fake, and a
// package the real packager built, sealed — the case #503 G4 ranked sharpest.
const { pkg } = buildEvidencePackage({
  trace: { resourceSpans: [] } as never,
  prompt: `How many noise complaints mention ${CANARY}?`,
  output: `Twelve complaints mention ${CANARY}.`,
  toolCalls: [],
  model: 'vendor/model-fixture-1',
  tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  duration_ms: 1000,
  promptVisibility: 'full_text',
  title: 'Noise complaints',
  captureMethod: 'chat-flow-stream',
} as never);
globals.__wfPackage = pkg;
const row = { id: 'rec-1', slug: 'noise', basePackageStorageKey: 'sealed/rec-1.json', visibility: 'sealed', creatorId: 'fixture-account' };
const chain = { from: () => chain, where: () => chain, limit: async () => [row] };
globals.__wfFakeDb = { select: () => chain };
globals.__wfDbMode = 'fake';

const evaluate = await import('../app/api/evidence/[slug]/evaluate/route.ts');
const EVALUATE = await drive(() => evaluate.POST(
  post('/api/evidence/noise/evaluate', { modelApiKey: 'fixture', evaluatorModel: 'fixture-judge' }) as never,
  { params: Promise.resolve({ slug: 'noise' }) },
));
const replay = await import('../app/api/evidence/[slug]/replay/route.ts');
const REPLAY = await drive(() => replay.POST(
  post('/api/evidence/noise/replay', { modelApiKey: 'fixture' }) as never,
  { params: Promise.resolve({ slug: 'noise' }) },
));
globals.__wfDbMode = 'real';

// --- Premises: each drive reached the failure it is about ------------------------

test('premise: every drive reached its failure, and the carrier held the canary', () => {
  assert.equal(DEVICE.status, 500, `the device-code insert did not fail: ${DEVICE.status} ${DEVICE.body}`);
  assert.equal(EVIDENCE.status, 500, `the evidence publish did not fail in the database: ${EVIDENCE.status} ${EVIDENCE.body}`);
  assert.equal(COMPARE_BODY.status, 500, `the malformed compare body did not reach the catch: ${COMPARE_BODY.status}`);
  assert.equal(COMPARE_STREAM_BODY.status, 500, `the malformed compare-stream body did not reach the catch: ${COMPARE_STREAM_BODY.status}`);
  assert.ok(COMPARE.status >= 400, `the refused compare did not fail: ${COMPARE.status}`);
  assert.ok(SUMMARY.status >= 400, `the refused summary did not fail: ${SUMMARY.status}`);
  assert.ok(EVALUATE.status >= 400, `the refused evaluation did not fail: ${EVALUATE.status} ${EVALUATE.body}`);
  assert.ok(REPLAY.status >= 400, `the refused replay did not fail: ${REPLAY.status} ${REPLAY.body}`);
  // The SDK carrier really carried it: the endpoint was SENT the canary on
  // every model drive, and echoes whatever it is sent.
  for (const [what, needle] of [['compare', 'noise complaints mention'], ['summary', 'Original question'], ['evaluate', 'Twelve complaints mention'], ['replay', 'noise complaints mention']] as const) {
    assert.ok(
      modelRequests.some((r) => r.includes(needle) && r.includes(CANARY)),
      `the ${what} drive never sent the reader's words to the endpoint, so its refusal could not carry them`,
    );
  }
  assert.ok(ormError instanceof Error && ormError.message.includes(CANARY), 'the ORM error does not carry its bound parameter');
});

// --- The criterion ----------------------------------------------------------------

const DRIVES: Array<[string, string[], string, RegExp]> = [
  ['/api/auth/device/code — ORM, the insert beside both codes (#506)', DEVICE.lines, CANARY, /\[api\/auth\/device\/code\] insert failed after retries/],
  ['/api/evidence — ORM, the slug built from the title', EVIDENCE.lines, CANARY, /Evidence publish error:/],
  ['resolveLifecycle — ORM, the attestation query', LIFECYCLE_LINES, CANARY, /\[lifecycle\] attestation_nodes query failed/],
  ['mcp/client.ts — a source’s malformed initialize body', INSTRUCTIONS_LINES, JSON_CANARY, /Could not parse initialize response body/],
  ['mcp/client.ts — a source’s reason phrase on a tool call', REASON_LINES, CANARY, /Server error:/],
  ['socrata-skill.ts — the skill fetch failing on the source’s reason phrase', SKILL_LINES, CANARY, /\[Skill\] Failed to fetch skill guidance/],
  ['socrata-skill.ts — the composer, a source failing with the ORM’s error', COMPOSER_LINES, CANARY, /\[composeSkillPrompt\] Failed to fetch text for "socrata"/],
  ['directory-data.ts — the directory source’s malformed body', DIRECTORY_LINES, JSON_CANARY, /\[Directory\] Failed to fetch the configured source/],
  ['/api/compare — the model SDK’s refusal', COMPARE.lines, CANARY, /Compare API error:/],
  ['/api/compare — a malformed request body', COMPARE_BODY.lines, JSON_CANARY, /Compare API error:/],
  ['/api/compare-stream — a malformed request body', COMPARE_STREAM_BODY.lines, JSON_CANARY, /Compare stream API error:/],
  ['/api/evidence/generate-summary — the model SDK’s refusal', SUMMARY.lines, CANARY, /\[generate-summary\] Error:/],
  ['/api/evidence/[slug]/evaluate — the SDK’s refusal of a sealed record’s output', EVALUATE.lines, CANARY, /\[evaluate\] Error:/],
  ['/api/evidence/[slug]/replay — the SDK’s refusal of a sealed record’s prompt', REPLAY.lines, CANARY, /\[replay\] Error:/],
];

for (const [what, lines, canary] of DRIVES) {
  test(`${what}: the reader’s or the source’s words are on no log line`, () => {
    const hits = leaked(lines, canary);
    assert.deepEqual(hits, [], `${what} — ${hits.length} log line(s) carry the canary:\n${hits.join('\n')}`);
  });
}

test('every drive: its failure is still logged, with its prefix and the bounded facts', () => {
  const missing: string[] = [];
  for (const [what, lines, , prefix] of DRIVES) {
    const line = lines.find((l) => prefix.test(l));
    if (!line) { missing.push(`${what}: the failure line is gone\n${lines.map((l) => `  | ${l.slice(0, 200)}`).join('\n')}`); continue; }
    // The reason-phrase line is not an error: its fact is the status.
    const fact = what.includes('reason phrase on a tool call') ? /\b502\b/ : /errorClass: '[A-Za-z][A-Za-z0-9]{0,62}'/;
    if (!fact.test(line)) missing.push(`${what}: the line carries no bounded fact\n  | ${line.slice(0, 300)}`);
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('the SDK drives keep the endpoint’s status on the line', () => {
  for (const [what, lines, , prefix] of DRIVES.filter(([w]) => w.includes('SDK'))) {
    const line = lines.find((l) => prefix.test(l)) ?? '';
    assert.match(line, /status: 400/, `${what}: the status is not on the line: ${line.slice(0, 200)}`);
  }
});

test('what the reader sees is unchanged: the malformed-body responses still carry the parse error', () => {
  // #154's territory, and a non-goal here: the wire keeps `error.message`.
  assert.ok(COMPARE_STREAM_BODY.body.includes('not valid JSON'), `the compare-stream response changed: ${COMPARE_STREAM_BODY.body}`);
});
