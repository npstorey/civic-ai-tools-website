// CKAN-1 P3 (npstorey/civic-ai-tools#314), stage R: criterion A-C6. A record made before router 0.11.0 names Boston
// OpenContext by the alias it had then, `boston`, which since 0.11.0 is the Boston pack's. The record still names
// its own source.
//
// THE FIXTURE is a record in the pre-bump shape: an in-loop run (router 0.10.0) that loaded `boston` and called
// `boston__ckan__query_data`, as every run between #599 W3 and the bump named Boston OpenContext's tools. What it
// carries that tells the two sources apart, each of them the record's own: its `sourcesOffered` row
// (`boston-opencontext`, alias `boston`), its call span's `mcp.source` (`boston-opencontext`) and `mcp.server.id`
// (OpenContext's id), and its router component (0.10.0, before the pack existed).
//
// WHAT IS DRIVEN. The five sites G0 measured as reading a recorded alias through the live manifest, each through
// the reader a record reaches it by:
//   1. `replay-loop.ts` (the loads a record shows, `loadedUnstated`), through `replayOfferedSet`;
//   2. and 5. `flows/source-chooser.ts`'s `loadAliasReaderName`, read by `answer-view/steps.ts`'s load-step label,
//      through the record page's adapter (`adaptRecord`);
//   3. `streaming.ts`'s `loadedSourceName`, read by the step sentence, through the same adapter;
//   4. `notebook-author/tool-to-cell.ts`'s load note, through `renderDiscoverySummaryCell`.
// Then the old-alias tool name's operation type and notebook cell, and the OpenContext cell's citation id.
//
// RED AT STAGE L (`a9f092b`): sites 1, 2, 3 and 5 read `boston` as the pack (Analyze Boston), the old-alias name
// derives no operation type and renders no OpenContext cell, and the OpenContext SQL cell cites `boston-ckan`, the
// pack's `sourceId`. Site 4 states the alias as the record states it and is green at L: it names no source.
//
// SHAPED TO FAIL. The live manifest held an entry for `boston` (the pack) through router 0.11.0, so a reader that
// resolves through it found a source and named it; only a reader that reads the record's own rows names Boston
// OpenContext. The contrast test drives a record made under router 0.11.0, which loaded `boston` as the pack, and must
// read Analyze Boston.
//
// CKAN-2-WEB P1 (W12): router 0.12.0 retired the pack, and under D7 = A no manifest entry holds `boston`. The pack is
// read from the router's `retiredPack`, and the contrast record still reads Analyze Boston: a recorded load alias reads
// as recorded, through the record's own rows and the retired pack, never as no source.
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
const SRC = path.resolve(HERE, '..', '..');

function firstFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next candidate */ }
  }
  return null;
}
const candidatesFor = (base: string) => [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];

registerHooks({
  resolve(specifier, context, nextResolve) {
    const from = (context as { parentURL?: string }).parentURL;
    if (/^next\/[a-z-]+$/.test(specifier) && specifier !== 'next/server') return nextResolve(`${specifier}.js`, context);
    if (specifier.startsWith('@/')) {
      const found = firstFile(candidatesFor(path.join(SRC, specifier.slice(2))));
      if (found === null) throw new Error(`A-C6 test hook: cannot resolve ${specifier}`);
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    if (specifier.startsWith('.') && from?.startsWith('file:') && fileURLToPath(from).startsWith(SRC)) {
      const found = firstFile(candidatesFor(path.resolve(path.dirname(fileURLToPath(from)), specifier)));
      if (found !== null) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(loadUrl, context, nextLoad) {
    if (loadUrl.startsWith('file:')) {
      const file = fileURLToPath(loadUrl);
      if (file.startsWith(SRC) && /\.tsx$/.test(file)) {
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

for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'CKAN_MCP_URL', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.example.test/mcp';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.example.test/mcp';

type Model = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;
const { adaptRecord } = (await import('@/components/answer-view/adapt-record')) as unknown as { adaptRecord: (input: Json) => Model };
const { replayOfferedSet } = (await import('@/lib/model-loop/replay-loop')) as unknown as { replayOfferedSet: (pkg: unknown, configured: unknown) => { loadedUnstated?: string[] } };
const { readMcpEnvFromProcess } = (await import('@/lib/mcp/registry')) as unknown as { readMcpEnvFromProcess: () => unknown };
const { deriveOperationType } = (await import('@/lib/mcp/operation-types')) as unknown as { deriveOperationType: (name: string, args: Json) => string | undefined };
const cells = (await import('@/lib/notebook-author/tool-to-cell')) as unknown as {
  renderFetchToolCell: (call: Json, ctx: Json) => { cells: Array<{ source: string[] | string }>; citation?: { id: string } } | null;
  renderDiscoverySummaryCell: (calls: Json[]) => { source: string[] | string } | null;
};
const { LOAD_STEP_LABEL } = (await import('@/lib/sources/copy')) as unknown as { LOAD_STEP_LABEL: { closed: (names: string[], count: number) => string } };
const { CIVIC_MANIFEST } = await import('@typedstandards/civic-typed-router');

const OPENCONTEXT = CIVIC_MANIFEST.find((entry) => entry.sourceId === 'boston-opencontext')!;
/** The Boston pack, retired by router 0.12.0 and read from its table of retired packs. */
const PACK = (await import('@typedstandards/civic-typed-router')).retiredPack('boston-ckan')!;

function attr(key: string, value: string) {
  return { key, value: { stringValue: value } };
}

/** A record of an in-loop run: it loaded `alias` and called `tool`, answered by `source` (`sourceId`, `serverId`). */
function recordOf(input: { alias: string; tool: string; source: { sourceId: string; alias: string; serverId: string }; router: string; offeredAlias: string }): Json {
  const offered = [
    { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
    { sourceId: input.source.sourceId, alias: input.offeredAlias, reason: 'not-consented' },
  ];
  const root = {
    name: 'analysis', spanId: 'r0',
    attributes: [
      attr('analysis.sources_offered', JSON.stringify(offered)),
      attr('analysis.components', JSON.stringify([{ id: '@typedstandards/civic-typed-router', version: input.router }])),
      attr('analysis.routing', JSON.stringify({ method: 'in-loop', version: input.router })),
    ],
  };
  const child = (spanId: string, attributes: ReturnType<typeof attr>[]) => ({ name: 'mcp_tool_call', spanId, parentSpanId: 'r0', attributes });
  const callArgs = { resource_id: 'r-1', limit: 1 };
  const spans = [
    root,
    child('s1', [attr('tool.name', 'load_source'), attr('tool.operation_type', 'load_source'), attr('tool.arguments', JSON.stringify({ alias: input.alias })), attr('tool.load_outcome', 'loaded')]),
    child('s2', [
      attr('tool.name', input.tool), attr('tool.operation_type', 'query'), attr('tool.arguments', JSON.stringify(callArgs)),
      attr('mcp.source', input.source.sourceId), attr('mcp.alias', input.source.alias), attr('mcp.server.id', input.source.serverId),
    ]),
  ];
  return {
    version: '0.1', prompt: { text: 'How many 311 requests?', hash: 'h'.repeat(64) }, output: 'An answer.', dataSources: [],
    cost: { model: 'fixture/model-a-c6', promptTokens: 10, completionTokens: 5, totalTokens: 15, durationMs: 1000 },
    metadata: { captureMethod: 'chat-flow-stream' },
    queries: [
      { tool: 'load_source', operationType: 'load_source', arguments: { alias: input.alias }, duration_ms: 3 },
      { tool: input.tool, operationType: 'query', arguments: callArgs, duration_ms: 40, resultRows: 1, resultColumns: 1 },
    ],
    trace: { resourceSpans: [{ scopeSpans: [{ spans }] }] },
    extensions: {
      'org.civicaitools.composition': {
        assertedDate: '2026-11-10',
        sourcesOffered: offered,
        components: [{ id: '@typedstandards/civic-typed-router', version: input.router }],
        routing: { method: 'in-loop', version: input.router },
        definitionHash: '0'.repeat(64),
      },
    },
  };
}

/** Before router 0.11.0: `boston` was Boston OpenContext's alias. */
const PRE_BUMP = recordOf({
  alias: 'boston',
  tool: 'boston__ckan__query_data',
  source: { sourceId: 'boston-opencontext', alias: 'boston', serverId: OPENCONTEXT.id },
  router: '0.10.0',
  offeredAlias: 'boston',
});
/** Since router 0.11.0: `boston` is the Boston pack's, its calls the CKAN server's. */
const POST_BUMP = recordOf({
  alias: 'boston',
  tool: 'boston__ckan_datastore_search',
  source: { sourceId: 'boston-ckan', alias: 'boston', serverId: PACK.id },
  router: '0.11.0',
  offeredAlias: 'boston',
});

const ROW = { slug: 'a-c6-fixture', summary: 'A summary.', contentProfile: null, captureMethod: 'chat-flow-stream' };
const steps = (pkg: Json) => adaptRecord({ stored: pkg, resolution: null, row: ROW, instance: null, servedStatement: null }).steps?.view?.steps as Array<{ label: string; calls: Array<{ sentence?: string }> }> | undefined;
const text = (source: string[] | string | undefined) => (Array.isArray(source) ? source.join('') : String(source ?? ''));

test('A-C6: a record that loaded `boston` before router 0.11.0 names Boston OpenContext at each site that reads a recorded alias, and its old-alias call keeps its operation type and its cell', () => {
  // Sites 1: the loads the record shows, for replay.
  const offered = replayOfferedSet(PRE_BUMP, readMcpEnvFromProcess());
  assert.deepEqual(offered.loadedUnstated, ['boston-opencontext'], 'replay reads the recorded `boston` load as another source');
  // Sites 2 and 5: the load step's label, and site 3: its sentence, on the record page.
  const view = steps(PRE_BUMP);
  assert.ok(view && view.length > 0, 'premise: the record page states the steps');
  const load = view!.find((step) => step.calls.some((c) => /load/i.test(c.sentence ?? '')) || /chose|choos/i.test(step.label));
  assert.ok(load, `premise: the record page states the load step: ${JSON.stringify(view)}`);
  assert.equal(load!.label, LOAD_STEP_LABEL.closed(['Boston OpenContext'], 1), 'the load step\'s label names another source');
  assert.ok(load!.calls.every((c) => c.sentence === undefined || !c.sentence.includes(PACK.displayName)), `the load step's sentence names the pack: ${JSON.stringify(load!.calls)}`);
  // Site 4: the notebook's load note states the alias the record states, and names no source.
  const note = text(cells.renderDiscoverySummaryCell([{ name: 'load_source', args: { alias: 'boston' }, operationType: 'load_source', loadOutcome: 'loaded' }])?.source);
  assert.match(note, /- `boston`: loaded/);
  assert.ok(!note.includes(PACK.displayName), 'the load note names the pack');
  // The old-alias tool name keeps its operation type and its cell, and the record page names no tool by it.
  assert.equal(deriveOperationType('boston__ckan__query_data', {}), 'query', 'the old-alias name lost its operation type');
  const queryStep = view!.find((step) => step !== load);
  assert.ok(queryStep && queryStep.calls.every((c) => !(c.sentence ?? '').includes('boston__')), `the record page names the old-alias call by its exposed name: ${JSON.stringify(queryStep)}`);
  const cell = cells.renderFetchToolCell({ name: 'boston__ckan__query_data', args: { resource_id: 'r-1', limit: 1 }, operationType: 'query' }, { dataFrameIndex: 1, defaultPortal: '' });
  assert.ok(cell && text(cell.cells.map((c) => text(c.source)).join('\n')).includes('fetch_opencontext('), `the old-alias call lost its OpenContext cell: ${JSON.stringify(cell)}`);
});

test('A-C6: the OpenContext cell\'s citation id is not the Boston pack\'s sourceId', () => {
  for (const call of [
    { name: 'ckan__execute_sql', args: { sql: 'SELECT 1' }, operationType: 'query' },
    { name: 'ckan__query_data', args: { resource_id: 'r-1', limit: 1 }, operationType: 'query' },
  ]) {
    const cell = cells.renderFetchToolCell(call, { dataFrameIndex: 1, defaultPortal: '' });
    assert.ok(cell?.citation, `premise: ${call.name} renders a cited cell`);
    assert.notEqual(cell!.citation!.id, PACK.sourceId, `${call.name}'s cell cites the Boston pack's sourceId`);
  }
});

test('A-C6 contrast: a record that loaded `boston` since router 0.11.0 names the Boston pack', () => {
  const view = steps(POST_BUMP);
  const load = view?.find((step) => /chose|choos/i.test(step.label));
  assert.ok(load, `premise: the record page states the load step: ${JSON.stringify(view)}`);
  assert.equal(load!.label, LOAD_STEP_LABEL.closed([PACK.displayName], 1));
});
