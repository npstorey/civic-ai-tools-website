// R9 P1a (#681): the consent gate's `no_sources_on` rule, as a unit, branch
// by branch.
//
// THE RULE. A consent in force whose selection (configured ∩ On) is empty is
// refused `no_sources_on` only when the run could reach no source: every
// configured source Off; or the run cannot ask the reader about an Ask-first
// source, which is every run under `all-sources` routing, every run under
// `in-loop` routing on an instance with no decision store (each Ask-first
// load records `no-answer` at once), and every run of a route that holds no
// pause (the JSON compare route and replay, which pass the gate nothing).
// Under `in-loop` with the store set, a run whose configured sources include
// one that is not Off proceeds with the empty selection, and the loop asks.
//
// WHAT IS DRIVEN. The real gate, the real flows statement, the real consent
// cookie and states; the consent row store is an in-memory stub. Each branch
// is driven on the cookie and on the row: the two stores reach the same line
// of the gate, and both are shown.
//
// WHAT MAKES IT ABLE TO FAIL. At the base the gate reads no mode and no store
// flag, so the two "in-loop with a store and no source On" branches are
// refused `no_sources_on`. The refusal's bytes are pinned against the base's
// shape for every branch that still refuses.
//
// Run with: npm test

import { test } from 'node:test';
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

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', '..');
const CONSENT_STORE_FILE = path.join(SRC, 'lib', 'sources', 'consent-store.ts');

const globals = globalThis as unknown as { __r9p1aGate: { rows: Map<string, unknown> } };
globals.__r9p1aGate = { rows: new Map() };

const STUB_PREFIX = 'file:///r9-p1a-gate-stub/';
const STUB_SOURCE: Record<string, string> = {
  'consent-store': `
    const rows = () => globalThis.__r9p1aGate.rows;
    export async function readConsentRow(userId) { return rows().get(userId) ?? null; }
    export async function writeConsentRow(userId, row) { rows().set(userId, { userId, ...row }); }
    export async function deleteConsentRow(userId) { rows().delete(userId); }`,
};
const stub = (key: string): ResolveResult => ({ url: `${STUB_PREFIX}${encodeURIComponent(key)}.mjs`, format: 'module', shortCircuit: true });

function firstFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let file: string | null = null;
    if (specifier.startsWith('@/')) {
      file = firstFile(path.join(SRC, specifier.slice(2)));
      if (file === null) throw new Error(`r9-p1a gate test hook: cannot resolve ${specifier}`);
    } else {
      const parent = (context as { parentURL?: string }).parentURL;
      if (specifier.startsWith('.') && parent?.startsWith('file:') && !parent.startsWith(STUB_PREFIX)) {
        file = firstFile(path.resolve(path.dirname(fileURLToPath(parent)), specifier));
      }
    }
    if (file === CONSENT_STORE_FILE) return stub('consent-store');
    if (file !== null) return { url: pathToFileURL(file).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_PREFIX)) {
      const key = decodeURIComponent(url.slice(STUB_PREFIX.length).replace(/\.mjs$/, ''));
      return { format: 'module', source: STUB_SOURCE[key], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// --- The configuration: three sources -------------------------------------------------

for (const name of [
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYC_RECORD_HOSTING', 'NYS_LEGISLATION_HOSTING', 'DATA_COMMONS_API_KEY',
  'APP_HOST', 'NEXTAUTH_URL', 'SITE_DEPLOYMENT_GUIDE_URL', 'SOURCE_ROUTING',
  'NEXT_PUBLIC_ANALYTICS_SERVICE', 'NEXT_PUBLIC_ANALYTICS_ID', 'NEXT_PUBLIC_GA_MEASUREMENT_ID',
]) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.fixture.example';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.fixture.example/mcp';
process.env.BOSTON_OPENCONTEXT_MCP_URL = 'https://boston.fixture.example/mcp';

const load = async (rel: string): Promise<Mod> => (await import(pathToFileURL(path.join(SRC, rel)).href)) as Mod;
// Typed `any`, so a call with the third argument type-checks on the base, whose gate takes two.
const gate = await load('lib/sources/consent-gate.ts');
const { buildFlowsStatement, statementHash } = await load('lib/flows/statement.ts');
const { CONSENT_COOKIE_NAME, encodeConsentCookie } = await load('lib/sources/consent.ts');
const { friendlyStreamError } = await load('lib/streaming.ts');

const DB_ID = '9a1e0000-0000-4000-8000-0000000000a1';
const statement = await buildFlowsStatement();
const CONFIGURED: string[] = statement.sources.map((s: { sourceId: string }) => s.sourceId);

test('premise: three sources are configured, so every branch below has an Ask-first source to keep or lose', () => {
  assert.deepEqual(CONFIGURED, ['socrata', 'data-commons', 'boston-opencontext']);
});

// --- Driving the gate ------------------------------------------------------------------------

type States = Record<string, 'on' | 'ask-first' | 'off'>;
type Ask = { routing: 'in-loop' | 'all-sources'; store: boolean } | undefined;

/** The cookie a reader with `states` sends; a source missing from `states` has no stored state. */
function cookieFor(states: States): string {
  const versionOf = (id: string) => statement.sources.find((s: { sourceId: string }) => s.sourceId === id).version;
  const value = encodeConsentCookie({
    v: 1,
    flows: statement.version,
    states: Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state, since: '2026-10-28', version: versionOf(id) }])),
  });
  return `${CONSENT_COOKIE_NAME}=${value}`;
}

function setRow(states: States): void {
  globals.__r9p1aGate.rows.set(DB_ID, {
    userId: DB_ID,
    states: Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state, since: '2026-10-28' }])),
    flowsHash: statementHash(statement),
    flowsStatement: statement,
    consentedAt: new Date('2026-10-28T00:00:00Z'),
    updatedAt: new Date('2026-10-28T00:00:00Z'),
  });
}

/** The gate's answer for `states` on `store`, with `ask` passed as the third argument (or none). */
async function decide(store: 'cookie' | 'row', states: States, ask: Ask): Promise<Mod> {
  const headers: Record<string, string> = {};
  let session: unknown = null;
  if (store === 'cookie') headers.cookie = cookieFor(states);
  else {
    setRow(states);
    session = { user: { id: 'gh-fixture-r9', dbId: DB_ID } };
  }
  const request = new Request('https://site.fixture.example/api/compare-stream', { method: 'POST', headers });
  return ask === undefined ? gate.consentInForce(request, session) : gate.consentInForce(request, session, ask);
}

/** The refusal's bytes as the base writes them: key order, reader text, statement hash, empty re-ask. */
const NO_SOURCES_ON_BYTES = JSON.stringify({
  error: friendlyStreamError({ code: 'no_sources_on' }),
  code: 'no_sources_on',
  flowsVersion: statementHash(statement),
  reask: { base: false, sources: [] },
});

const ALL_OFF: States = { socrata: 'off', 'data-commons': 'off', 'boston-opencontext': 'off' };
const ALL_ASK_FIRST: States = { socrata: 'ask-first', 'data-commons': 'ask-first', 'boston-opencontext': 'ask-first' };
const OFF_AND_ASK_FIRST: States = { socrata: 'off', 'data-commons': 'ask-first', 'boston-opencontext': 'off' };
/** No stored state for Boston: Ask first (D6), the only source a run could reach. */
const OFF_AND_NONE: States = { socrata: 'off', 'data-commons': 'off' };
const ONE_ON: States = { socrata: 'ask-first', 'data-commons': 'on', 'boston-opencontext': 'off' };

const IN_LOOP_STORE: Ask = { routing: 'in-loop', store: true };
const IN_LOOP_NO_STORE: Ask = { routing: 'in-loop', store: false };
const ALL_SOURCES_STORE: Ask = { routing: 'all-sources', store: true };
const ALL_SOURCES_NO_STORE: Ask = { routing: 'all-sources', store: false };

const REFUSED: Array<[string, States, Ask]> = [
  ['every source Off, in-loop with a store', ALL_OFF, IN_LOOP_STORE],
  ['every source Off, all-sources', ALL_OFF, ALL_SOURCES_STORE],
  ['every source Off, no run context (the JSON compare route, replay)', ALL_OFF, undefined],
  ['every source Ask first, all-sources with a store', ALL_ASK_FIRST, ALL_SOURCES_STORE],
  ['every source Ask first, all-sources without a store', ALL_ASK_FIRST, ALL_SOURCES_NO_STORE],
  ['every source Ask first, in-loop without a store', ALL_ASK_FIRST, IN_LOOP_NO_STORE],
  ['every source Ask first, no run context (the JSON compare route, replay)', ALL_ASK_FIRST, undefined],
  ['Off and Ask first, in-loop without a store', OFF_AND_ASK_FIRST, IN_LOOP_NO_STORE],
];

for (const store of ['cookie', 'row'] as const) {
  for (const [what, states, ask] of REFUSED) {
    test(`R9 P1a criterion 2 (${store}): ${what} is refused no_sources_on, in the base's bytes`, async () => {
      const decision = await decide(store, states, ask);
      assert.equal(decision.ok, false, `served with selection ${JSON.stringify(decision.selection)}`);
      assert.equal(decision.store, store);
      assert.equal(JSON.stringify(decision.payload), NO_SOURCES_ON_BYTES);
    });
  }

  test(`R9 P1a criterion 2 (${store}): in-loop with a store and a source On is served with configured ∩ On, as before`, async () => {
    const decision = await decide(store, ONE_ON, IN_LOOP_STORE);
    assert.equal(decision.ok, true, `refused ${decision.payload?.code}`);
    assert.equal(decision.enforced, true);
    assert.deepEqual(decision.selection, ['data-commons']);
    assert.deepEqual(decision.states, ONE_ON);
    // The same states with no run context: the same answer, so the routes that hold nothing are unchanged here.
    const bare = await decide(store, ONE_ON, undefined);
    assert.equal(bare.ok, true);
    assert.deepEqual(bare.selection, ['data-commons']);
  });

  for (const [what, states] of [
    ['every source Ask first', ALL_ASK_FIRST],
    ['Off and Ask first', OFF_AND_ASK_FIRST],
    ['Off and no stored state (Ask first)', OFF_AND_NONE],
  ] as Array<[string, States]>) {
    test(`R9 P1a criterion 2 (${store}): in-loop with a store, ${what}, no source On: served with an empty selection, the states as stored`, async () => {
      const decision = await decide(store, states, IN_LOOP_STORE);
      assert.equal(decision.ok, true, `refused ${decision.payload?.code}: ${JSON.stringify(decision.payload)}`);
      assert.equal(decision.enforced, true);
      assert.equal(decision.store, store);
      assert.deepEqual(decision.selection, []);
      assert.deepEqual(decision.states, states);
      assert.equal(decision.reference?.hash, statementHash(statement), 'no flows statement reference for the root span');
      // The record's reasons, from the stored states (D2 = A): Off is reader-off, Ask first or none is not-consented.
      const offered = CONFIGURED.map((sourceId) => ({ sourceId, alias: sourceId, reason: 'not-selected' }));
      const reasons = Object.fromEntries(decision.recordReasons(offered).map((s: { sourceId: string; reason: string }) => [s.sourceId, s.reason]));
      assert.deepEqual(reasons, Object.fromEntries(CONFIGURED.map((id) => [id, states[id] === 'off' ? 'reader-off' : 'not-consented'])));
    });
  }
}
