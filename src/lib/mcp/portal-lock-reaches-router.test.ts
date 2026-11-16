// S3-B W2, F1 (npstorey/civic-ai-tools#318; the seat's ruling 6897785696, ASK 1, conditions a to d): the one-portal
// lock reaches the router's configuration, so a Socrata pack fixed to another portal is not offered, listed or found
// (G0-6 = A), and every surface that reads the configuration reads one lock.
//
// THE ONE PLACE. `readMcpEnvFromProcess` (`registry.ts`) builds the configuration every caller reads, and sets router
// 0.10.0's `McpRegistryEnv.lockedPortal` from the same two readers `resolveRunPortal` reads: `isPortalLocked()`
// (`SITE_PORTAL_LOCKED`) and `getDefaultPortal()` (`SITE_DEFAULT_PORTAL`). It is set only when the lock resolves to a
// portal, so an unlocked configuration keeps its shape.
//
// WHAT IS READ, per condition, through the site's own exports: the directory set, `load_source`'s enum, the offered
// tools, the lock text, City Record's reason in `sourcesOffered`, the flows statement's sources (which the consent card
// shows and the consent gate keys its states by), and the router's search with and without a space.
//
// (b) THE LOCK ON WITH NO PORTAL. `resolveRunPortal` refuses every query (`portal_not_configured`), and the preflight
// requires `SITE_DEFAULT_PORTAL` when the lock is on. The configuration then carries no `lockedPortal`, so every
// surface reads as an unlocked instance's: measured at stage 1, the statement lists the same three sources, with the
// same hash.
//
// THE DECOYS can fail: each unlocked or own-portal condition is pinned to the fingerprint measured at the base
// (2d649c4, router 0.9.0, no F1), so a fix keyed on `SITE_PORTAL_LOCKED` alone moves the no-portal row, and one keyed
// on `SITE_DEFAULT_PORTAL` alone moves the default-portal row.
//
// (d) A FUTURE CALL SITE. Two guards: the agreement test below (the configuration's lock equals `resolveRunPortal`'s
// over the whole matrix), and a scan of every tracked JS/TS source file (tests excluded, `git ls-files`): the
// router's raw reader `readMcpEnv(` is called only in `registry.ts`, and only `scripts/eval-models.mjs` overrides the
// configuration's lock (the harness is never locked, A3), each by an exact count, in both directions.
//
// RED at 2d649c4: City Record is offered, listed and named under a lock to another portal, `searchSources` does not
// exist, and the configuration carries no lock.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

for (const name of ['SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL', 'BOSTON_OPENCONTEXT_MCP_URL', 'DATA_COMMONS_MCP_URL', 'DATA_COMMONS_API_KEY',
  'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING']) {
  delete process.env[name];
}
process.env.SOCRATA_MCP_URL = 'https://socrata.example.test/mcp';

const routerModule = (await import('@typedstandards/civic-typed-router')) as unknown as Record<string, unknown>;
const civicRouter = routerModule.civicRouter as {
  sourcesOffered(configured: unknown, selection: unknown): Array<{ sourceId: string; reason: string }>;
  manifest: ReadonlyArray<{ sourceId: string }>;
  searchSources?: (input: { configured: unknown; query: string; space?: readonly string[] }) => Array<{ sourceId: string }>;
};
const { readMcpEnvFromProcess } = await import('./registry.ts');
const { directorySet } = await import('./routing-mode.ts');
const { loadSourceTool, offeredMcpTools, mcpToolsFor } = await import('./tools.ts');
const { withPortalLockGuidance } = await import('./socrata-skill.ts');
const { resolveRunPortal } = await import('../site-config.ts');
const { buildFlowsStatementFor } = await import('../flows/statement.ts');

type Condition = 'off' | 'off-with-default' | 'own' | 'other' | 'on-no-portal';
const OWN = 'data.cityofnewyork.us';
const OTHER = 'data.cityofchicago.org';
const QUERY = 'city record procurement notices contract awards';

function setCondition(condition: Condition): void {
  delete process.env.SITE_PORTAL_LOCKED;
  delete process.env.SITE_DEFAULT_PORTAL;
  if (condition === 'off-with-default') process.env.SITE_DEFAULT_PORTAL = OTHER;
  if (condition === 'own') { process.env.SITE_PORTAL_LOCKED = '1'; process.env.SITE_DEFAULT_PORTAL = OWN; }
  if (condition === 'other') { process.env.SITE_PORTAL_LOCKED = '1'; process.env.SITE_DEFAULT_PORTAL = OTHER; }
  if (condition === 'on-no-portal') process.env.SITE_PORTAL_LOCKED = '1';
}

interface Surfaces {
  directory: string[];
  loadEnum: unknown;
  tools: string[];
  lockText: string;
  cityRecordReason: string | undefined;
  statementSources: unknown;
}

/** What each surface reads, under the environment as it stands. */
function surfaces(): Surfaces {
  const configured = readMcpEnvFromProcess();
  const run = resolveRunPortal(undefined);
  const lockedPortal = run.ok ? run.lockedPortal : undefined;
  const directory = directorySet(configured, { enforced: false, states: {} }).map((entry) => entry.sourceId);
  const load = loadSourceTool(configured, directory) as unknown as { function: { parameters: { properties: { alias: { enum: unknown } } } } };
  return {
    directory,
    loadEnum: load.function.parameters.properties.alias.enum,
    tools: offeredMcpTools(mcpToolsFor(lockedPortal), configured, directory).map((tool) => (tool as { function: { name: string } }).function.name),
    lockText: withPortalLockGuidance('', lockedPortal, configured, directory),
    cityRecordReason: civicRouter.sourcesOffered(configured, undefined).find((entry) => entry.sourceId === 'nyc-record')?.reason,
    statementSources: buildFlowsStatementFor(null).sources,
  };
}

const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Each decoy's fingerprint, measured at 2d649c4 (router 0.9.0, no F1). */
const BASE_FINGERPRINT: Record<Exclude<Condition, 'other'>, string> = {
  'off': '8f1c2a44ca80061d1e2194df395226e24d722a82431b35478a0bbaf4e17138e8',
  'off-with-default': '8f1c2a44ca80061d1e2194df395226e24d722a82431b35478a0bbaf4e17138e8',
  'own': '6673be0477d8a016ae9ee64c4094d45f7aba95b87bf50fa8500a5155902a1d31',
  'on-no-portal': '8f1c2a44ca80061d1e2194df395226e24d722a82431b35478a0bbaf4e17138e8',
};

test('F1 (c): under a lock to another Socrata portal, City Record is not offered, listed, named or found', () => {
  setCondition('other');
  const s = surfaces();
  assert.ok(!s.directory.includes('nyc-record'), `the directory lists City Record: ${s.directory.join(', ')}`);
  assert.ok(!(s.loadEnum as string[]).includes('nyc_record'), 'load_source offers nyc_record');
  assert.ok(!s.tools.some((name) => name.startsWith('nyc_record__')), `a City Record tool is offered: ${s.tools.join(', ')}`);
  assert.ok(!s.lockText.includes('City Record'), 'the lock text names City Record');
  assert.equal(s.cityRecordReason, 'not-configured');
  assert.ok(!(s.statementSources as Array<{ sourceId: string }>).some((row) => row.sourceId === 'nyc-record'), 'the flows statement lists City Record');
});

test('F1 (c): under a lock to another Socrata portal, the router\'s search finds no City Record, with a space or without one', () => {
  setCondition('other');
  assert.equal(typeof civicRouter.searchSources, 'function', 'the installed router has no searchSources');
  const configured = readMcpEnvFromProcess();
  const without = civicRouter.searchSources!({ configured, query: QUERY }).map((hit) => hit.sourceId);
  const within = civicRouter.searchSources!({ configured, query: QUERY, space: civicRouter.manifest.map((entry) => entry.sourceId) }).map((hit) => hit.sourceId);
  assert.ok(!without.includes('nyc-record'), `found with no space: ${without.join(', ')}`);
  assert.ok(!within.includes('nyc-record'), `found with a space: ${within.join(', ')}`);
  // Control: unlocked, the same words find it, so the absence above is the lock's.
  setCondition('off');
  assert.ok(civicRouter.searchSources!({ configured: readMcpEnvFromProcess(), query: QUERY }).some((hit) => hit.sourceId === 'nyc-record'), 'control: unlocked, the words do not find City Record');
});

for (const condition of ['off', 'off-with-default', 'own', 'on-no-portal'] as const) {
  test(`F1 decoy (${condition}): every surface reads as at the base`, () => {
    setCondition(condition);
    assert.equal(fingerprint(surfaces()), BASE_FINGERPRINT[condition]);
  });
}

test('F1 (b): the lock on with no portal configured refuses every query, and the configuration carries no lock', () => {
  setCondition('on-no-portal');
  const run = resolveRunPortal(undefined);
  assert.equal(run.ok, false);
  assert.equal((readMcpEnvFromProcess() as { lockedPortal?: string }).lockedPortal, undefined);
  setCondition('off');
  assert.equal(fingerprint(surfaces().statementSources), (() => { setCondition('on-no-portal'); return fingerprint(surfaces().statementSources); })(),
    'the flows statement differs from an unlocked instance\'s');
});

test('F1 (d): the configuration\'s lock is resolveRunPortal\'s, over the whole matrix', () => {
  for (const condition of ['off', 'off-with-default', 'own', 'other', 'on-no-portal'] as const) {
    setCondition(condition);
    const run = resolveRunPortal(undefined);
    const expected = run.ok ? run.lockedPortal : undefined;
    const configured = readMcpEnvFromProcess() as { lockedPortal?: string };
    assert.equal(configured.lockedPortal, expected, `${condition}: the configuration's lock is not the run's`);
    assert.equal(Object.hasOwn(configured, 'lockedPortal'), expected !== undefined, `${condition}: an unlocked configuration carries the key`);
  }
});

// --- (d), the scan --------------------------------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function trackedSourceFiles(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z', '--full-name'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = listing.split('\0').filter((name) => /\.(c|m)?[jt]sx?$/.test(name) && !/\.test\.(c|m)?[jt]sx?$/.test(name));
  assert.ok(files.length > 0, 'git ls-files reported no source files: the scan has stopped measuring');
  return files.filter((name) => existsSync(join(REPO_ROOT, name)));
}

/** Where the router's raw reader may be called, by exact count: the one function that adds the lock. */
const RAW_READER_SITES: Record<string, number> = { 'src/lib/mcp/registry.ts': 2 };
/** Where a configuration's lock may be set from outside `readMcpEnvFromProcess`, by exact count. */
const LOCK_OVERRIDE_SITES: Record<string, number> = {
  // The harness is never portal-locked: its questions name five portals (`LOCKED_PORTAL`), so it states its own lock
  // on the configuration it reads, at its two reads (S3-B W2, A3).
  'scripts/eval-models.mjs': 2,
};

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

test('F1 (d): no file but registry.ts calls the router\'s raw reader, and only the harness overrides the lock', () => {
  const raw: Record<string, number> = {};
  const overrides: Record<string, number> = {};
  for (const file of trackedSourceFiles()) {
    const text = readFileSync(join(REPO_ROOT, file), 'utf8');
    const r = count(text, /(?<![\w.])readMcpEnv\(/g);
    if (r > 0) raw[file] = r;
    const o = count(text, /readMcpEnvFromProcess\(\)[^;\n]*lockedPortal\s*:/g);
    if (o > 0) overrides[file] = o;
  }
  assert.deepEqual(raw, RAW_READER_SITES);
  assert.deepEqual(overrides, LOCK_OVERRIDE_SITES);
});

// --- A4: replay on an instance locked to another portal ----------------------------------------------------------------

test('F1, A4: a replay on an instance locked to another portal does not offer City Record, and says the site does not offer it', async () => {
  const { replayOfferedSet } = await import('../model-loop/replay-loop.ts');
  const pkg = {
    extensions: {
      'org.civicaitools.composition': {
        sourcesOffered: [
          { sourceId: 'socrata', alias: 'socrata', reason: 'configured' },
          { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'configured' },
        ],
      },
    },
  };
  // Control: unlocked, the record's City Record is offered to the replay.
  setCondition('off');
  assert.ok(replayOfferedSet(pkg, readMcpEnvFromProcess(), undefined).sources.includes('nyc-record'), 'control: unlocked, City Record is not offered');
  setCondition('other');
  const offered = replayOfferedSet(pkg, readMcpEnvFromProcess(), undefined);
  assert.deepEqual(offered.sources, ['socrata']);
  assert.ok(offered.lacking.includes('nyc-record'), `City Record is not named as lacking: ${JSON.stringify(offered.lacking)}`);
});
