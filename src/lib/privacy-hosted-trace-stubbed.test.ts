// R8 W3 criterion 5 (a), the stubbed half: the switch-trace check over a
// manifest holding TWO hosted entries, so it can be shown red on code that
// configures only one hosted source.
//
// WHY A STUB. `privacy-page.test.ts` renders the real page with the real router.
// On the base's code every hosted statement traces `NYC_CHARTER_HOSTING`
// whichever source it states, which is wrong for a second hosted source, and
// the base's router and reader can configure no second one. So this file
// serves `@typedstandards/civic-typed-router` from a stub that re-exports the
// real package with two overrides: `CIVIC_MANIFEST` holds a second hosted
// entry, NYC Charter's variant under an id, a source id, an alias and a switch
// that none of the real entries has (the registry keys `hosted` by source id
// and silently keeps the last of two, and refuses only a shared alias), and
// `configuredSources` answers its switch. The environment is handed straight
// to the statement builders (`readMcpEnvFromProcess` reads only the real
// switches).
//
// WHAT IS CHECKED. Every `RECIPIENT_STATEMENTS` entry and every
// `PLATFORM_HELD_RECIPIENTS` entry is called with the stubbed configuration,
// and the statements whose ids are per-source are kept (never looked up by a
// row's key: W3 renames one), and `sourceRow` is driven for the fixture,
// Charter and Data Commons. The check is `./privacy-hosted-switch-trace.ts`,
// shared with the page test: red on the base's code, green on W3's.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

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
const SRC = path.resolve(HERE, '..');
const ROUTER = '@typedstandards/civic-typed-router';
// Resolved BEFORE the hooks are registered: resolved after, the hook below
// would answer with the stub's own address and the stub would import itself.
const REAL_ROUTER_URL = import.meta.resolve(ROUTER);
const STUB_URL = 'file:///r8-w3-privacy-stub/civic-typed-router.mjs';

/** The second hosted entry: Charter's variant under names no real entry has. */
const FIXTURE = { sourceId: 'r8w3-fixture', alias: 'r8w3_fixture', variable: 'R8W3_FIXTURE_HOSTING', envKey: 'r8w3FixtureHosting' };
const STUB = `
  export * from ${JSON.stringify(REAL_ROUTER_URL)};
  import * as real from ${JSON.stringify(REAL_ROUTER_URL)};
  const charter = real.CIVIC_MANIFEST.find((entry) => entry.sourceId === 'nyc-charter');
  const fixture = {
    ...charter,
    id: 'r8w3-fixture-hosted@https://example.test/r8w3-fixture',
    sourceId: ${JSON.stringify(FIXTURE.sourceId)},
    alias: ${JSON.stringify(FIXTURE.alias)},
    displayName: 'R8 W3 Fixture Hosted MCP Server',
    configuration: { addressVariable: ${JSON.stringify(FIXTURE.variable)}, requirement: 'optional' },
    hostings: charter.hostings.map((variant) => ({ ...variant, package: '@fixture/r8w3-hosted', version: '9.9.9', commit: 'f'.repeat(40) })),
  };
  export const CIVIC_MANIFEST = [...real.CIVIC_MANIFEST, fixture];
  export function configuredSources(configured) {
    return { ...real.configuredSources(configured), ...(configured.${FIXTURE.envKey} === 'sandbox' ? { ${JSON.stringify(FIXTURE.sourceId)}: 'sandbox' } : {}) };
  }
`;

function candidatesFor(base: string): string[] {
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
}
function firstFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}

// The loader `privacy-page.test.ts` uses, copied (that file is not edited),
// with one addition: the router is served from the stub.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === ROUTER) return { url: STUB_URL, format: 'module', shortCircuit: true };
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`stubbed privacy test hook: cannot resolve ${specifier}`);
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
    if (loadUrl === STUB_URL) return { format: 'module', source: STUB, shortCircuit: true };
    if (loadUrl.startsWith('file:')) {
      const file = fileURLToPath(loadUrl);
      if (file.startsWith(SRC) && /\.tsx?$/.test(file)) {
        const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
          fileName: file,
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        });
        return { format: 'module', source: out.outputText, shortCircuit: true };
      }
    }
    return nextLoad(loadUrl, context);
  },
});

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const facts = (await import(pathToFileURL(path.join(SRC, 'lib', 'privacy-facts.ts')).href)) as Mod;
const check = (await import(pathToFileURL(path.join(SRC, 'lib', 'privacy-hosted-switch-trace.ts')).href)) as Mod;
const router = (await import(ROUTER)) as Mod;
const registry = (await import(pathToFileURL(path.join(SRC, 'lib', 'mcp', 'registry.ts')).href)) as Mod;

/** Two hosted sources on: Charter and the fixture. */
const MCP = {
  socrataUrl: 'https://socrata.example.test',
  dataCommonsUrl: 'https://api.datacommons.org/mcp',
  nycCharterHosting: 'sandbox',
  [FIXTURE.envKey]: 'sandbox',
};
const CONTEXT = { mcp: MCP, executor: 'vercel-sandbox', signing: false };

interface Built { id: string; traces: string[] }
const traced = (statements: Array<{ id: string; traces: string[] }>): Built[] => statements.map((s) => ({ id: s.id, traces: s.traces }));

function hostedStatements(): Built[] {
  const recipients = Object.values(facts.RECIPIENT_STATEMENTS as Record<string, (ctx: unknown) => Array<{ id: string; traces: string[] }>>)
    .flatMap((build) => build(CONTEXT))
    .filter((s) => s.id.startsWith('recipient-hosted-') || s.id.startsWith('recipient-hosted-exchange-'));
  const held = Object.values(facts.PLATFORM_HELD_RECIPIENTS as Record<string, { statements: (ctx: unknown) => Array<{ id: string; traces: string[] }> }>)
    .flatMap((entry) => entry.statements(CONTEXT))
    .filter((s) => s.id.startsWith('held-sandbox-platform-'));
  return traced([...recipients, ...held]);
}

/** A flows statement source as `sourceRow` reads it, for one manifest source. */
function rowSource(sourceId: string, hosted: boolean) {
  const entry = (router.CIVIC_MANIFEST as Array<{ sourceId: string; displayName: string; publisher?: string; freshness: string }>).find((e) => e.sourceId === sourceId)!;
  return {
    sourceId,
    displayName: entry.displayName,
    publisher: entry.publisher ?? 'not stated',
    variant: hosted ? { variant: 'sandbox', kind: 'npm-package', runsAt: 'instance-sandbox' } : { variant: 'remote', kind: 'remote', runsAt: 'other' },
    ...(hosted ? {} : { host: 'api.datacommons.org' }),
    freshness: entry.freshness,
    recipients: [{ id: `source:${sourceId}`, key: 'held:sandbox-platform', role: hosted ? 'sandbox-platform' : 'source', runsAt: 'instance-sandbox', receives: 'fixture', keptBy: [{ holder: 'Fixture holder', keeps: 'not-stated' }] }],
    version: 'fixture',
  };
}

test('R8 W3 criterion 5 (a), stubbed: premise: the stub configures two hosted sources, under names no real entry has', () => {
  const real = (router.CIVIC_MANIFEST as Array<{ sourceId: string; alias: string }>).filter((e) => e.sourceId !== FIXTURE.sourceId);
  assert.ok(!real.some((e) => e.sourceId === FIXTURE.sourceId || e.alias === FIXTURE.alias), 'the fixture shares an id or an alias with a real entry');
  assert.deepEqual(Object.keys(registry.buildMcpRegistry(MCP).hosted).sort(), ['nyc-charter', FIXTURE.sourceId]);
  const ids = hostedStatements().map((s) => s.id).sort();
  for (const family of ['recipient-hosted-', 'recipient-hosted-exchange-', 'held-sandbox-platform-']) {
    assert.deepEqual(ids.filter((id) => check.perSourceStatement(id)?.family === family).map((id) => check.perSourceStatement(id).sourceId).sort(), ['nyc-charter', FIXTURE.sourceId], `${family} states both hosted sources`);
  }
});

test('R8 W3 criterion 5 (a), stubbed: each hosted family\'s statement traces its own source\'s switch and no other\'s', () => {
  assert.deepEqual(check.switchTraceProblems(hostedStatements(), router.CIVIC_MANIFEST), []);
});

test('R8 W3 criterion 5 (a), stubbed: each source row traces its own switch, a remote row none', () => {
  const rows = [rowSource(FIXTURE.sourceId, true), rowSource('nyc-charter', true), rowSource('data-commons', false)].map((source) => facts.sourceRow(source));
  assert.deepEqual(rows.map((r: { id: string }) => r.id), [`source-row-${FIXTURE.sourceId}`, 'source-row-nyc-charter', 'source-row-data-commons']);
  assert.deepEqual(check.switchTraceProblems(traced(rows), router.CIVIC_MANIFEST), []);
});

test('R8 W3 criterion 5 (a), stubbed: the check is red on a source row that lists every switch, as a fixed list would', () => {
  const everySwitch = [...check.hostingSwitches(router.CIVIC_MANIFEST).values()].map((name: string) => `env:${name}`);
  const planted = [{ id: 'source-row-data-commons', traces: ['const:x#y', ...everySwitch] }, { id: `source-row-${FIXTURE.sourceId}`, traces: everySwitch }];
  const problems = check.switchTraceProblems(planted, router.CIVIC_MANIFEST);
  assert.ok(problems.some((p: string) => p.startsWith('source-row-data-commons: traces another source\'s switch')), problems.join('; '));
  assert.ok(problems.some((p: string) => p.startsWith(`source-row-${FIXTURE.sourceId}: traces another source's switch NYC_CHARTER_HOSTING`)), problems.join('; '));
  // And a hosted statement missing its own switch.
  assert.deepEqual(check.switchTraceProblems([{ id: `recipient-hosted-${FIXTURE.sourceId}`, traces: ['const:x#y'] }], router.CIVIC_MANIFEST), [`recipient-hosted-${FIXTURE.sourceId}: does not trace its own switch ${FIXTURE.variable}`]);
});
