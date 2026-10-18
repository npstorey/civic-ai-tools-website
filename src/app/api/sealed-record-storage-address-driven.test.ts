// #516 WF — no public route carries a sealed record's storage address.
//
// THE RULE THIS HOLDS. A sealed record's package is stored at an address that
// cannot be derived from anything public (`putCommittedPackage`,
// `src/lib/storage/index.ts`: `evidence-packages/committed/<128 random
// bits>.json`), and that address is the only way to fetch it. So nothing any
// visitor can request returns that address (`evidence_records.
// base_package_storage_key`), in any form: raw, JSON-escaped or
// `encodeURIComponent`-ed, in a body or a header.
//
// WHAT IS PUBLIC BY DESIGN, AND STATED HERE AS SUCH. A sealed record's package
// hash (its fingerprint) is public: ADR-0010 §4 to §6 (civic-ai-tools,
// `docs/adr/0010-visibility-lifecycle-location-attestations.md`). The
// commitment route answers an unauthenticated request for it, by the record's
// slug or by the hash, and the slug ends in a prefix of the hash
// (`resolveSlug`, `src/app/api/evidence/route.ts`). The privacy page states
// the first (`SEALED_FINGERPRINT_LOOKUP`); a test below holds it.
//
// WHAT IS DRIVEN. Every `GET` the record API serves, derived from the tree:
// each `route.ts` under `src/app/api/records/` that exports `GET` (each
// re-exports the handler its `/api/evidence/` alias serves), called with the
// sealed record's slug, and the commitment route also by hash and with
// `?inline=1`. Then the routes that name records without a slug: the list,
// the signing status, the trust registry and `robots`. The visitor is not
// signed in. The records index page (`/records`) hands its client component
// no record data, which a test below pins: its records come from the list
// route driven here. The record page itself is driven in
// `src/app/(app)/evidence/[slug]/record-page-creator-key.test.ts`, which
// shows it not found for anyone but the creator.
//
// STUBS, each where the real module needs a request scope, a database or
// storage: `next/headers`, `next-auth`, `@/lib/auth`, `@/lib/api-auth` (no
// session, no token); `@/lib/db` answers a select with the rows the test set
// for the table it reads from, whatever the filter (so a route that filters
// sealed records in SQL is still handed the sealed row, the harder case);
// `@/lib/storage` answers the stored package. `fetch` refuses every network
// address. The route handlers, the commitment builder and the visibility and
// access gates are the real ones.
//
// WHAT MAKES IT ABLE TO FAIL. The same routes, for a PUBLIC record whose
// stored address has the same shape, must find the address in the
// commitment's `packageUrl`: the search is seen finding it. And the phase
// report carries a run of this file under a local mutation that serves the
// address on the sealed view, failing here.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/app/api/sealed-record-storage-address-driven.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { execFileSync } from 'node:child_process';
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
const REPO = path.resolve(SRC, '..');

// Never on disk: served by the load hook. Under `src/` so a stub's own imports
// (`drizzle-orm`) resolve to this repository's packages.
const stubUrl = (specifier: string) => pathToFileURL(path.join(SRC, `__r3-wf-sealed-stub-${specifier.replace(/[^A-Za-z0-9]/g, '_')}.mjs`)).href;
const STUB_SOURCE: Record<string, string> = {
  'next/headers': `
    export async function headers() { return new Headers({ host: 'records.example.test' }); }
    export async function cookies() { return { get() { return undefined; }, getAll() { return []; }, has() { return false; } }; }`,
  'next-auth': `export async function getServerSession() { return null; } export default function NextAuth() { return () => new Response(null, { status: 404 }); }`,
  '@/lib/auth': `export const authOptions = {};`,
  '@/lib/api-auth': `
    export async function resolveRequestUser() { return null; }
    export function hasPublishScope() { return false; }`,
  '@/lib/db': `
    import { getTableName } from 'drizzle-orm';
    function chain(rows) {
      const c = {
        from(table) { return chain((globalThis.__sealedTables ?? {})[getTableName(table)] ?? []); },
        where() { return c; }, orderBy() { return c; }, innerJoin() { return c; }, leftJoin() { return c; },
        groupBy() { return c; }, limit() { return c; }, offset() { return c; },
        then(resolve, reject) { return Promise.resolve(rows).then(resolve, reject); },
      };
      return c;
    }
    export const db = { select() { return chain([]); } };`,
  // The real module's other exports (the writers) stay, unused by a GET;
  // the two readers a GET reaches are replaced.
  '@/lib/storage': `
    export * from ${JSON.stringify(pathToFileURL(path.join(SRC, 'lib', 'storage', 'index.ts')).href)};
    export async function getPackage() { return globalThis.__sealedPackage ?? null; }
    export async function getPackageText() { return globalThis.__sealedPackage ? JSON.stringify(globalThis.__sealedPackage) : null; }`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.prototype.hasOwnProperty.call(STUB_SOURCE, specifier)) {
      return { url: stubUrl(specifier), format: 'module', shortCircuit: true };
    }
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const base = path.join(SRC, specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        try {
          if (fs.statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch { /* next candidate */ }
      }
      throw new Error(`#516 WF test hook: cannot resolve ${specifier}`);
    }
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
    const stubbed = Object.keys(STUB_SOURCE).find((specifier) => stubUrl(specifier) === loadUrl);
    if (stubbed !== undefined) return { format: 'module', source: STUB_SOURCE[stubbed], shortCircuit: true };
    if (loadUrl.startsWith('file:') && loadUrl.endsWith('.json')) {
      const json = fs.readFileSync(fileURLToPath(loadUrl), 'utf8');
      return { format: 'module', source: `export default ${json};`, shortCircuit: true };
    }
    return nextLoad(loadUrl, context);
  },
});

const globals = globalThis as unknown as { __sealedTables: Record<string, unknown[]>; __sealedPackage: unknown };

// The instance names itself in the views it serves; fixture values.
process.env.PUBLISHER_SITE_ORIGIN = 'https://records.example.test';
process.env.PUBLISHER_PLATFORM_AGENT_TITLE = 'Fixture Instance';
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`#516 WF test: no network (${String(input)})`);
}) as typeof fetch;

const { NextRequest } = await import('next/server.js');

// --- Fixtures -------------------------------------------------------------------

const PACKAGE_HASH = 'c0ffee'.repeat(10) + 'c0ff';
/** 32 hex characters, the shape `putCommittedPackage` writes; an inert value. */
const RANDOM_KEY = '0f'.repeat(16);
const STORAGE_ADDRESS = `https://store.example.test/evidence-packages/committed/${RANDOM_KEY}.json`;
const ADDRESS_FORMS = [STORAGE_ADDRESS, JSON.stringify(STORAGE_ADDRESS).slice(1, -1), encodeURIComponent(STORAGE_ADDRESS), `committed/${RANDOM_KEY}`, RANDOM_KEY];

function recordRow(visibility: 'sealed' | 'public') {
  return {
    id: `id-${visibility}`, slug: `wf-${visibility}-record-${PACKAGE_HASH.slice(0, 6)}`, title: 'WF fixture', summary: 'WF fixture summary',
    creatorId: 'creator-1', model: 'openai/gpt-4o', promptHash: 'x', promptVisibility: 'full_text', promptText: null,
    systemPromptHash: null, mcpServer: null, jurisdiction: null, civicContext: null, captureMethod: 'chat-flow-stream',
    verificationStatus: 'unverified', consistencyClassification: null, isPublic: true, visibility, contentProfile: null,
    withdrawnAt: null, withdrawnReason: null, reinstatedAt: null, reinstatedReason: null,
    basePackageHash: PACKAGE_HASH, basePackageStorageKey: STORAGE_ADDRESS, basePackageSignature: null,
    basePackageRfc3161Timestamp: null, basePackageRekorEntryId: null, basePackageRekorInclusionProof: null, basePackageRekorEntryBody: null,
    createdAt: new Date('2026-10-18T00:00:00.000Z'), updatedAt: new Date('2026-10-18T00:00:00.000Z'),
  };
}

const CREATOR = { id: 'creator-1', githubId: 'fixture-account', displayName: 'Fixture', githubProfileUrl: null, createdAt: new Date('2026-01-01T00:00:00.000Z') };
const PACKAGE = { metadata: { schemaVersion: '0.1.0', packageId: 'wf', createdAt: '2026-10-18T00:00:00.000Z' }, output: 'WF fixture output', queries: [] };

function setRecord(visibility: 'sealed' | 'public') {
  globals.__sealedTables = {
    evidence_records: [recordRow(visibility)],
    users: [CREATOR],
    attestation_packages: [],
    attestation_nodes: [],
  };
  globals.__sealedPackage = structuredClone(PACKAGE);
}

// --- The public GET routes, derived from the tree ---------------------------------

interface Served { route: string; status: number; text: string }

const RECORD_ROUTES = execFileSync('git', ['ls-files', 'src/app/api/records'], { cwd: REPO, encoding: 'utf8' })
  .split('\n')
  .filter((file) => file.endsWith('/route.ts'));

type Handler = (request: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function getRoutes(): Promise<{ file: string; GET: Handler }[]> {
  const out: { file: string; GET: Handler }[] = [];
  for (const file of RECORD_ROUTES) {
    const mod = (await import(pathToFileURL(path.join(REPO, file)).href)) as { GET?: Handler };
    if (typeof mod.GET === 'function') out.push({ file, GET: mod.GET });
  }
  return out;
}

async function call(route: string, handler: Handler, urlPath: string, params: Record<string, string>): Promise<Served> {
  const response = await handler(new NextRequest(`https://records.example.test${urlPath}`), { params: Promise.resolve(params) });
  const headers = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
  return { route, status: response.status, text: `${headers}\n\n${await response.text()}` };
}

async function serveEverything(visibility: 'sealed' | 'public'): Promise<Served[]> {
  setRecord(visibility);
  const slug = recordRow(visibility).slug;
  const served: Served[] = [];
  for (const { file, GET } of await getRoutes()) {
    const segments = file.replace(/^src\/app/, '').replace(/\/route\.ts$/, '');
    const params: Record<string, string> = { slug, id: 'wf-attestation' };
    const urlPath = segments.replace('[slug]', slug).replace('[id]', 'wf-attestation');
    served.push(await call(file, GET, urlPath, params));
    if (file.endsWith('/commitment/route.ts')) {
      served.push(await call(`${file} (by hash)`, GET, urlPath.replace(slug, PACKAGE_HASH), { slug: PACKAGE_HASH }));
      served.push(await call(`${file} (inline)`, GET, `${urlPath}?inline=1`, params));
    }
  }
  const registry = (await import(pathToFileURL(path.join(SRC, 'app', '.well-known', 'typed-publisher.json', 'route.ts')).href)) as { GET: () => Promise<Response> };
  const registryResponse = await registry.GET();
  served.push({ route: '/.well-known/typed-publisher.json', status: registryResponse.status, text: await registryResponse.text() });
  const robots = (await import(pathToFileURL(path.join(SRC, 'app', 'robots.ts')).href)) as { default: () => unknown };
  served.push({ route: '/robots.txt', status: 200, text: JSON.stringify(robots.default()) });
  return served;
}

const SEALED = await serveEverything('sealed');
const PUBLIC = await serveEverything('public');

function findings(served: Served[]): string[] {
  return served.flatMap((s) => ADDRESS_FORMS.filter((form) => s.text.includes(form)).map((form) => `${s.route} (${s.status}): ${form}`));
}

// --- The instrument -------------------------------------------------------------

test('the derivation reads the record API: the commitment, package, bundle, verify and list routes are driven', () => {
  const routes = SEALED.map((s) => s.route);
  for (const expected of ['commitment', 'package', 'bundle', 'verify', 'attestations', 'list']) {
    assert.ok(routes.some((route) => route.includes(`/${expected}/`)), `no ${expected} route was driven: ${routes.join(', ')}`);
  }
  assert.ok(routes.some((route) => route === 'src/app/api/records/[slug]/route.ts'), 'the record read-back route was not driven');
});

test("the search finds a public record's storage address where the public view states it", () => {
  const found = findings(PUBLIC);
  assert.ok(found.some((f) => f.includes('/commitment/')), `the search did not find a public record's address in its commitment:\n${found.join('\n')}`);
});

// --- The rule ---------------------------------------------------------------------

test("no public route carries a sealed record's storage address", () => {
  assert.deepEqual(findings(SEALED), [], "a public route serves a sealed record's storage address");
});

// --- Public by design --------------------------------------------------------------

test("a sealed record's fingerprint can be looked up by its address (the privacy page's statement), and its slug carries a prefix of it", () => {
  const bySlug = SEALED.find((s) => s.route === 'src/app/api/records/[slug]/commitment/route.ts');
  assert.equal(bySlug?.status, 200, 'the commitment route does not answer for a sealed record');
  assert.ok(bySlug?.text.includes(`"packageHash":"${PACKAGE_HASH}"`), "the sealed record's commitment does not carry its fingerprint");
  const route = fs.readFileSync(path.join(SRC, 'app', 'api', 'evidence', 'route.ts'), 'utf8');
  assert.match(route, /buildSlug\(title, packageHash, chars\)/, 'the slug is no longer built from a prefix of the package hash');
});

test('the records index page reads no record on the server: its records come from the list route driven above', () => {
  const page = fs.readFileSync(path.join(SRC, 'app', '(app)', 'evidence', 'page.tsx'), 'utf8');
  assert.doesNotMatch(page, /@\/lib\/db|@\/lib\/storage/, 'the records index page now reads the database or storage itself; drive it here');
  assert.match(page, /<EvidenceIndex \/>/, 'the records index page now hands its client component props; drive it here');
});
