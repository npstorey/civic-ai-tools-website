// #552 (anchor #555, P1, criteria 1 and 2) — SITE_SEAL_ONLY, driven through
// the REAL route handlers.
//
// `src/lib/evidence/seal-only.test.ts` drives the decisions;
// `seal-only-ordering.test.ts` pins where each handler makes them. This file
// runs the handlers themselves — `POST` of `src/app/api/evidence/route.ts`
// and of `src/app/api/evidence/[slug]/publish/route.ts`, the functions both
// `/api/records` segments re-export — and records every storage put, signing
// call, database write, record lookup and evaluation they reach:
//
//   - ON (`SITE_SEAL_ONLY=1`): `POST /api/records` with `visibility` "public",
//     "published" and absent, and `POST /api/records/:slug/publish`, each
//     answer `403 { code: "seal_only" }` and reach NONE of them (on
//     `/publish`, not even the lookup). "sealed" still reaches the sealed
//     put and the insert.
//   - OFF (unset, "", "0", "false"): the same requests reach them, as before.
//
// WHAT MAKES IT ABLE TO FAIL. The off half proves the recorder sees the calls:
// the same requests, with the setting off, do reach the put, the signing call,
// the insert, the lookup and the evaluation, so an empty record under "on" is
// the refusal and not a blind instrument. Run against the routes as they were
// before the gates were wired (the phase's first commit), every "on" case
// fails — shown in the phase report.
//
// STUBS, and why each is a stub. `module.registerHooks()` in-file, the
// harness of `src/lib/errors-out-of-logs-driven.test.ts`:
//   - `next/headers`, `next-auth`, `@/lib/auth`, `@/lib/api-auth`: no request
//     scope or sign-in provider outside Next — a signed-in account allowed to
//     publish;
//   - `@/lib/evidence/unsigned-tier`: no signing key is handled in a session
//     (CLAUDE.md); the gate answers "can sign", so the drive reaches this
//     setting's gate, which sits after it;
//   - `@/lib/evidence/signing`, `@/lib/storage`, `@/lib/db`,
//     `@/lib/evidence/publication`, `@/lib/evidence/lifecycle`,
//     `@/lib/evidence/adversarial-eval`: recorders. Each call is written to
//     one list, so "reached" and "not reached" are read from the same place;
//   - `@/lib/model-resolver`, `@/lib/model-catalog`, `@/lib/model-client`: no
//     model catalog or credential — the evaluator resolves to a fixture.
// The setting itself is NOT stubbed: `@/lib/site-config` and
// `@/lib/evidence/seal-only` are the real modules, read through
// `process.env.SITE_SEAL_ONLY`.
//
// WHAT IS NOT REACHED. No Next runtime (this is unbundled TypeScript under
// `node --test`), no database, no storage, no signing service, no model.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/seal-only-handlers-driven.test.ts)

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../..');

const STUB_PREFIX = 'file:///civic-seal-only-stub/';
const rec = (name: string) => `globalThis.__sealOnlyCalls.push(${JSON.stringify(name)});`;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `export async function headers() { return new Headers(); }`,
  'next-auth': `export async function getServerSession() { return { user: { id: 'fixture-account' } }; }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/api-auth': `
    export async function resolveRequestUser() { return { userId: 'fixture-account', scopes: ['records:publish'], method: 'bearer' }; }
    export function hasPublishScope() { return true; }`,
  '@/lib/evidence/unsigned-tier': `
    export function evaluateSealCommitGate() { return null; }
    export function evaluateUnsignedRecordPublishGate() { return null; }`,
  '@/lib/evidence/signing': `
    export function getActiveSigner() { return { bindingTier: 'self-asserted', identifier: 'fixture.invalid', displayName: 'Fixture' }; }
    export function signPackage() { ${rec('signPackage')} return null; }
    export async function getRfc3161Timestamp() { ${rec('getRfc3161Timestamp')} return null; }
    export async function publishToRekor() { ${rec('publishToRekor')} return null; }`,
  '@/lib/storage': `
    export async function getPackage() { ${rec('getPackage')} return globalThis.__sealOnlyPackage; }
    export async function putPackage() { ${rec('putPackage')} return 'https://storage.invalid/pkg.json'; }
    export async function putCommittedPackage() { ${rec('putCommittedPackage')} return 'https://storage.invalid/sealed.json'; }
    export async function deletePackageBlob() { ${rec('deletePackageBlob')} }`,
  '@/lib/db': `
    const done = (value) => ({ then: (resolve) => resolve(value), returning: async () => [{ id: 'rec-1' }] });
    const selectChain = { from: () => selectChain, where: () => selectChain, limit: async () => globalThis.__sealOnlyRows };
    export const db = {
      select() { ${rec('db.select')} return selectChain; },
      insert() { ${rec('db.insert')} return { values: async () => undefined }; },
      update() { ${rec('db.update')} return { set: () => ({ where: () => done(undefined) }) }; },
    };`,
  '@/lib/evidence/publication': `
    export async function emitPublicationPair() { ${rec('emitPublicationPair')} return { publishesNodeId: 'p', locatedAtNodeId: 'l' }; }`,
  '@/lib/evidence/lifecycle': `
    export async function resolveLifecycle() { ${rec('resolveLifecycle')} return { status: 'active' }; }`,
  '@/lib/evidence/adversarial-eval': `
    export async function runAdversarialEval() { ${rec('runAdversarialEval')} return { ok: true, results: {} }; }
    export async function emitEvaluationAttestation() { ${rec('emitEvaluationAttestation')} return { evaluationNodeId: 'e' }; }`,
  '@/lib/model-resolver': `
    export class ModelNotOfferedError extends Error {}
    export function modelIdentityForValue(value) { return { declared: value, endpointModel: value }; }
    export function resolveModelIdentity(value) { return { declared: value, endpointModel: value }; }
    export function resolveEvaluatorModel() { return 'fixture-judge'; }`,
  '@/lib/model-catalog': `
    export function modelIdentity(id) { return { declared: id, endpointModel: id }; }`,
  '@/lib/model-client': `
    export class ModelConfigurationError extends Error {}
    export function getMissingModelCredentialError() { return null; }`,
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
      throw new Error(`#552 test hook: cannot resolve ${specifier}`);
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

const globals = globalThis as unknown as {
  __sealOnlyCalls: string[];
  __sealOnlyRows: unknown[];
  __sealOnlyPackage: unknown;
};
globals.__sealOnlyCalls = [];
globals.__sealOnlyRows = [];

// The packager names the instance in the signed provenance graph and refuses
// to without an identity; fixture values, as in the precedent harness. No
// signing key is set: signing is stubbed above.
process.env.PUBLISHER_PLATFORM_AGENT_TITLE = 'Fixture Instance';
process.env.PUBLISHER_SITE_ORIGIN = 'https://fixture.invalid';
process.env.PUBLISHER_KEY_ID = 'fixture-kid';

const { buildEvidencePackage } = await import('../../lib/evidence/packager.ts');
const recordsRoute = await import('./evidence/route.ts');
const publishRoute = await import('./evidence/[slug]/publish/route.ts');
const recordsAlias = await import('./records/route.ts');
const publishAlias = await import('./records/[slug]/publish/route.ts');

const ON = ['1', 'true', ' TRUE '];
const OFF: (string | undefined)[] = [undefined, '', '0', 'false'];

afterEach(() => {
  delete process.env.SITE_SEAL_ONLY;
});

function setSetting(value: string | undefined): void {
  if (value === undefined) delete process.env.SITE_SEAL_ONLY;
  else process.env.SITE_SEAL_ONLY = value;
}

const ABSENT = Symbol('absent');
function publishBody(visibility: string | typeof ABSENT): Record<string, unknown> {
  return {
    trace: { resourceSpans: [] },
    prompt: 'How many noise complaints were filed last week?',
    output: 'Twelve.',
    toolCalls: [],
    model: 'vendor/model-fixture-1',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    duration_ms: 1000,
    promptVisibility: 'full_text',
    captureMethod: 'chat-flow-stream',
    title: 'Noise complaints',
    summary: 'Twelve complaints.',
    ...(visibility === ABSENT ? {} : { visibility }),
  };
}

function post(route: string, body: unknown): Request {
  return new Request(`http://localhost${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface Driven { status: number; body: Record<string, unknown>; calls: string[] }

async function drive(run: () => Promise<Response>): Promise<Driven> {
  globals.__sealOnlyCalls = [];
  const response = await run();
  return { status: response.status, body: await response.json() as Record<string, unknown>, calls: [...globals.__sealOnlyCalls] };
}

const driveRecords = (visibility: string | typeof ABSENT) =>
  drive(() => recordsRoute.POST(post('/api/records', publishBody(visibility)) as never));

// A sealed record the creator owns, signed, with a stored package.
const { pkg, hash } = buildEvidencePackage({ ...publishBody('sealed'), signer: undefined } as never);
globals.__sealOnlyPackage = pkg;
const SEALED_ROW = {
  id: 'rec-1', slug: 'noise', creatorId: 'fixture-account', visibility: 'sealed',
  basePackageHash: hash, basePackageStorageKey: 'https://storage.invalid/sealed.json',
  basePackageSignature: '{"signature":"fixture"}',
};

const drivePublish = () => {
  globals.__sealOnlyRows = [SEALED_ROW];
  return drive(() => publishRoute.POST(post('/api/records/noise/publish', {}) as never, { params: Promise.resolve({ slug: 'noise' }) }));
};

const label = (v: string | typeof ABSENT) => (v === ABSENT ? 'an absent visibility' : JSON.stringify(v));
const REACHED_BY_A_PUBLIC_PUBLISH = ['putPackage', 'signPackage', 'getRfc3161Timestamp', 'db.insert', 'emitPublicationPair'];
const REACHED_BY_A_PROMOTION = ['db.select', 'resolveLifecycle', 'getPackage', 'runAdversarialEval', 'emitEvaluationAttestation', 'db.update', 'putPackage', 'emitPublicationPair'];

test('#552: both /api/records segments dispatch to the handlers driven here', () => {
  assert.equal(recordsAlias.POST, recordsRoute.POST);
  assert.equal(publishAlias.POST, publishRoute.POST);
});

test('#552 C1 (driven): on, POST /api/records refuses "public", "published" and an absent visibility, reaching no put, signing call or write', async () => {
  for (const on of ON) {
    setSetting(on);
    for (const visibility of ['public', 'published', ABSENT] as const) {
      const r = await driveRecords(visibility);
      assert.equal(r.status, 403, `SITE_SEAL_ONLY=${JSON.stringify(on)}, ${label(visibility)}: status ${r.status}`);
      assert.equal(r.body.code, 'seal_only');
      assert.match(String(r.body.error), /visibility "sealed"/);
      assert.deepEqual(r.calls, [], `SITE_SEAL_ONLY=${JSON.stringify(on)}, ${label(visibility)}: reached ${r.calls.join(', ')}`);
    }
  }
});

test('#552 C1 (driven): on, POST /api/records still seals', async () => {
  for (const on of ON) {
    setSetting(on);
    for (const visibility of ['sealed', 'committed']) {
      const r = await driveRecords(visibility);
      assert.equal(r.status, 200, `SITE_SEAL_ONLY=${JSON.stringify(on)}, ${JSON.stringify(visibility)}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.visibility, 'sealed');
      for (const call of ['putCommittedPackage', 'signPackage', 'db.insert']) {
        assert.ok(r.calls.includes(call), `a sealed publish did not reach ${call}`);
      }
      assert.ok(!r.calls.includes('putPackage') && !r.calls.includes('emitPublicationPair'), 'a sealed publish reached the public path');
    }
  }
});

test('#552 C1 (driven): on, POST /api/records/:slug/publish is refused before the lookup and the evaluation', async () => {
  for (const on of ON) {
    setSetting(on);
    const r = await drivePublish();
    assert.equal(r.status, 403, `SITE_SEAL_ONLY=${JSON.stringify(on)}: status ${r.status}`);
    assert.equal(r.body.code, 'seal_only');
    assert.match(String(r.body.error), /stays sealed/);
    assert.deepEqual(r.calls, [], `SITE_SEAL_ONLY=${JSON.stringify(on)}: reached ${r.calls.join(', ')}`);
  }
});

test('#552 C2 (driven): off, both handlers reach what they reached before', async () => {
  for (const off of OFF) {
    setSetting(off);
    for (const visibility of ['public', 'published', ABSENT] as const) {
      const r = await driveRecords(visibility);
      assert.equal(r.status, 200, `SITE_SEAL_ONLY=${JSON.stringify(off)}, ${label(visibility)}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.visibility, 'public');
      for (const call of REACHED_BY_A_PUBLIC_PUBLISH) {
        assert.ok(r.calls.includes(call), `SITE_SEAL_ONLY=${JSON.stringify(off)}, ${label(visibility)}: did not reach ${call}`);
      }
    }
    const p = await drivePublish();
    assert.equal(p.status, 200, `SITE_SEAL_ONLY=${JSON.stringify(off)}: publish answered ${JSON.stringify(p.body)}`);
    assert.equal(p.body.published, true);
    for (const call of REACHED_BY_A_PROMOTION) {
      assert.ok(p.calls.includes(call), `SITE_SEAL_ONLY=${JSON.stringify(off)}: the promotion did not reach ${call}`);
    }
  }
});
