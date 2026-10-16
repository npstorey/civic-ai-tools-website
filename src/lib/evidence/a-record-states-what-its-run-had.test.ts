// #599 W4 — a record states what its RUN had, read from the trace, not what
// the instance has when the record is published (#495, #475; hub ADR-0033).
//
// The query routes write five facts onto the trace's root span at run time:
// `analysis.asserted_date`, `analysis.mcp_servers`, `analysis.tool_definitions`,
// `analysis.sources_offered` and `analysis.components`. The packager reads them
// back with the harness's `extractRunAttributes` and states them: the servers
// in the datHere environment block and in the graph's agent addresses, the
// tools in the environment block, and the rest in the
// `org.civicaitools.composition` block. No temperature is stated, because no
// request this app makes sends one (#548).
//
// The trace is made as a query route makes it — the real loop core, the real
// trace builder, the routes' `routedSourceId` — with the five attributes
// written by their ADR-0033 names, spelled here rather than imported, so this
// file pins the names the harness reads. The route side is driven in
// `src/app/api/a-run-records-its-inputs-driven.test.ts`.
//
// THE SHAPES THAT CAN FAIL:
//   - #495: the instance is RESTARTED with a different Boston address between
//     the run and the publish. A packager that reads its own configuration at
//     publish names the new address; the record must name the run's. The run
//     calls Boston, so the graph carries a Boston agent whose address can be
//     wrong. The run's server list also leaves Data Commons out, which the
//     publish-time configuration has, so a list taken from publish time is
//     visible twice over.
//   - #475: two packages whose prompts ask about calendar 2025 and whose
//     queries filter on 2025, one run in 2026 and one in 2025. Before W4 the
//     date was only hashed (`skillMetadata.systemPromptHash`), so the two
//     packages state the same window and no date at all.
//   - A present but malformed attribute is refused, never read as absent:
//     absence would hand the packager back to publish-time state.
//
// RED at the base (a787452, harness 0.5.0): the packager reads none of the
// five attributes, so every assertion on a stated field fails, the graph
// carries the publish-time Boston address, and the malformed trace packages
// without complaint.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type OpenAI from 'openai';
import { runToolLoop } from '../model-loop/run-tool-loop.ts';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from './trace.ts';
import { buildEvidencePackage, type PackageInput, type ToolCallInput } from './packager.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';
import { routedSourceId, type McpRegistryEnv } from '../mcp/registry.ts';

process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

// --- The run ----------------------------------------------------------------

const RUN_SOCRATA = 'https://socrata-mcp.run.example/mcp';
const RUN_DATA_COMMONS = 'https://data-commons.run.example/mcp';
const RUN_BOSTON = 'https://boston-mcp.run.example/mcp';
const PUBLISH_BOSTON = 'https://boston-mcp.after-restart.example/mcp';
const PUBLISH_DATA_COMMONS = 'https://data-commons.after-restart.example/mcp';

const RUN_CONFIG: McpRegistryEnv = {
  socrataUrl: RUN_SOCRATA,
  dataCommonsUrl: RUN_DATA_COMMONS,
  bostonOpencontextUrl: RUN_BOSTON,
};

/** The servers the run's configuration had, as the route writes them. Data
 *  Commons is left out on purpose: the publish-time configuration has it, so
 *  a list read at publish shows it. */
const RUN_SERVERS = [
  { url: RUN_SOCRATA, name: 'socrata' },
  { url: RUN_BOSTON, name: 'boston-opencontext' },
];

/** A tools array as offered: two aliased tools, verbatim, in order. Key order
 *  and a nested `required` are part of what must survive. */
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'socrata__get_data',
      description: 'Query a Socrata dataset.',
      parameters: { type: 'object', properties: { dataset_id: { type: 'string' }, where: { type: 'string' } }, required: ['dataset_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'boston__ckan__query_data',
      description: 'Query a Boston CKAN resource.',
      parameters: { type: 'object', properties: { resource_id: { type: 'string' } }, required: ['resource_id'] },
    },
  },
];

const SOURCES_OFFERED = [
  { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
  { sourceId: 'data-commons', alias: 'data_commons', reason: 'not-selected' },
  { sourceId: 'boston-opencontext', alias: 'boston', reason: 'selected' },
];

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const COMPONENTS = [
  { id: 'socrata-mcp-server@https://github.com/npstorey/socrata-mcp-server', guidanceHash: sha('socrata block'), guidanceOrigin: 'fallback' },
  { id: 'opencontext@https://data-mcp.boston.gov/mcp', guidanceHash: sha('boston block'), guidanceOrigin: 'endpoint' },
  { id: '@typedstandards/civic-typed-router', version: '0.2.0' },
];

/** The five root-span attributes by their ADR-0033 names. */
function runAttributes(assertedDate: string): Record<string, string> {
  return {
    'analysis.asserted_date': assertedDate,
    'analysis.mcp_servers': JSON.stringify(RUN_SERVERS),
    'analysis.tool_definitions': JSON.stringify(TOOL_DEFINITIONS),
    'analysis.sources_offered': JSON.stringify(SOURCES_OFFERED),
    'analysis.components': JSON.stringify(COMPONENTS),
  };
}

const WINDOW_2025 = "issue_date between '2025-01-01T00:00:00' and '2025-12-31T23:59:59'";
const CALLS = [
  { id: 'a', name: 'socrata__get_data', args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'pvqr-7yc4', where: WINDOW_2025, select: 'count(*)' } },
  { id: 'b', name: 'boston__ckan__query_data', args: { resource_id: 'r-311', filters: { type: 'pothole' } } },
];

function stubClient(calls: typeof CALLS): OpenAI {
  let served = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const first = served++ === 0;
          return {
            id: 'chatcmpl-w4-record',
            object: 'chat.completion',
            created: 1,
            model: 'fake/model',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: first ? null : 'About 1.2 million parking violations were issued in 2025.',
                ...(first
                  ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
                  : {}),
              },
              finish_reason: first ? 'tool_calls' : 'stop',
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          };
        },
      },
    },
  } as unknown as OpenAI;
}

/** One run the way a query route makes it, with `rootAttributes` on its root
 *  span (written when the root ends, as `/api/compare-stream` writes them). */
async function makeRun(rootAttributes: Record<string, string>, calls = CALLS) {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', { 'analysis.model': 'fake/model' });
  const result = await runToolLoop({
    client: stubClient(calls),
    endpointModel: 'fake/model',
    requestSettings: undefined,
    prompt: 'How many parking violations were issued in calendar year 2025?',
    systemPrompt: 'Fixture system prompt.',
    tools: [],
    executeToolCall: async () => JSON.stringify({ data: [{ count: '1200000' }], total_rows: 1 }),
    trace: { builder, parentSpanId: builder.rootSpanId, resolveToolSource: (name) => routedSourceId(name, RUN_CONFIG) },
  });
  builder.endRoot(rootAttributes);
  return { toolCalls: result.toolCalls as unknown as ToolCallInput[], trace: builder.finalize() as unknown as Record<string, unknown> };
}

// --- The publish ------------------------------------------------------------

const MCP_VARIABLES = ['SOCRATA_MCP_URL', 'DATA_COMMONS_MCP_URL', 'BOSTON_OPENCONTEXT_MCP_URL'] as const;

/** Run `fn` on an instance restarted with a different Boston and Data
 *  Commons address: the configuration a packager would read at publish. */
function afterRestart<T>(fn: () => T): T {
  const saved = MCP_VARIABLES.map((name) => [name, process.env[name]] as const);
  process.env.SOCRATA_MCP_URL = RUN_SOCRATA;
  process.env.DATA_COMMONS_MCP_URL = PUBLISH_DATA_COMMONS;
  process.env.BOSTON_OPENCONTEXT_MCP_URL = PUBLISH_BOSTON;
  try {
    return fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

type Json = Record<string, unknown>;
interface GraphNode {
  '@id': string;
  '@type': string | string[];
  'civic:sourceId'?: string;
  'civic:serverUrl'?: string;
  'dcterms:description'?: string;
  'prov:wasAssociatedWith'?: { '@id': string };
}
interface Pkg {
  queries: Array<{ tool: string; arguments: Json }>;
  dataSources: Array<{ sourceId: string }>;
  provenance: { '@graph': GraphNode[] };
  extensions?: Record<string, Json>;
  prompt: { text?: string };
}

function publish(toolCalls: ToolCallInput[], trace: Json, overrides: Partial<PackageInput> = {}): Pkg {
  const { pkg } = afterRestart(() => buildEvidencePackage({
    trace,
    prompt: 'How many parking violations were issued in calendar year 2025?',
    output: 'About 1.2 million parking violations were issued in 2025.',
    toolCalls,
    model: 'fake/model',
    tokenUsage: { promptTokens: 40, completionTokens: 10 },
    promptVisibility: 'full_text',
    title: 'Parking violations, 2025',
    summary: 'Parking violations issued in 2025.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
    contentProfile: 'datHere',
    extensions: { 'org.civicaitools.notebook': { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} } },
    ...overrides,
  }));
  return JSON.parse(JSON.stringify(pkg)) as Pkg;
}

const environmentOf = (pkg: Pkg) => pkg.extensions?.['org.civicaitools.environment'] as Json | undefined;
const compositionOf = (pkg: Pkg) => pkg.extensions?.['org.civicaitools.composition'] as Json | undefined;
const agentOf = (pkg: Pkg, sourceId: string) =>
  pkg.provenance['@graph'].find((n) => n['civic:sourceId'] === sourceId && n['@id'].includes(':mcp-server:'));

// --- Tests ------------------------------------------------------------------

test('premise: the run calls Socrata and Boston, so the graph carries both agents', async () => {
  const { toolCalls, trace } = await makeRun(runAttributes('2026-10-15'));
  const pkg = publish(toolCalls, trace);
  assert.deepEqual(toolCalls.map((c) => c.name), CALLS.map((c) => c.name));
  assert.ok(agentOf(pkg, 'socrata'), 'no Socrata agent');
  assert.ok(agentOf(pkg, 'boston-opencontext'), 'no Boston agent');
});

test('#495: after a restart with a different Boston address, the record names the RUN\'s servers in mcpServers', async () => {
  const { toolCalls, trace } = await makeRun(runAttributes('2026-10-15'));
  const environment = environmentOf(publish(toolCalls, trace));
  assert.ok(environment, 'the datHere package carries no environment block');
  assert.deepEqual(environment.mcpServers, RUN_SERVERS, 'mcpServers is not the list the trace carried');
  const text = JSON.stringify(environment);
  assert.ok(!text.includes(PUBLISH_BOSTON), 'the environment block names the Boston address configured at publish');
  assert.ok(!text.includes(PUBLISH_DATA_COMMONS), 'the environment block names a server the run did not have');
});

test('#495: after a restart, the graph\'s source agents carry the run\'s addresses, and none the run did not have', async () => {
  const { toolCalls, trace } = await makeRun(runAttributes('2026-10-15'));
  const pkg = publish(toolCalls, trace);
  assert.equal(agentOf(pkg, 'boston-opencontext')?.['civic:serverUrl'], RUN_BOSTON, 'the Boston agent carries the publish-time address');
  assert.equal(agentOf(pkg, 'socrata')?.['civic:serverUrl'], RUN_SOCRATA);
  const bytes = JSON.stringify(pkg.provenance);
  assert.ok(!bytes.includes(PUBLISH_BOSTON), 'the graph names the Boston address configured at publish');
  assert.ok(!bytes.includes(PUBLISH_DATA_COMMONS), 'the graph names a Data Commons address the run did not have');
});

test('the record states the tools the run offered, verbatim, and no temperature', async () => {
  const { toolCalls, trace } = await makeRun(runAttributes('2026-10-15'));
  const environment = environmentOf(publish(toolCalls, trace));
  assert.ok(environment, 'the datHere package carries no environment block');
  assert.deepEqual(environment.toolDefinitions, TOOL_DEFINITIONS);
  assert.equal(JSON.stringify(environment.toolDefinitions), JSON.stringify(TOOL_DEFINITIONS), 'the tools are not stated byte for byte');
  assert.equal(Object.hasOwn(environment, 'temperature'), false, 'a temperature is stated, and no request sends one');
  assert.deepEqual(Object.keys(environment), ['modelVersion', 'mcpServers', 'toolDefinitions', 'host']);
});

test('the record states the asserted date, each source\'s offered reason and the components, in the composition block', async () => {
  const { toolCalls, trace } = await makeRun(runAttributes('2026-10-15'));
  const pkg = publish(toolCalls, trace);
  assert.deepEqual(compositionOf(pkg), {
    assertedDate: '2026-10-15',
    sourcesOffered: SOURCES_OFFERED,
    components: COMPONENTS,
  });
  // The block is the last extension, after the caller's and the environment.
  assert.deepEqual(Object.keys(pkg.extensions ?? {}), ['org.civicaitools.notebook', 'org.civicaitools.environment', 'org.civicaitools.composition']);
});

test('the composition block is stated under the default content profile too; the tools are not (they belong to the datHere block)', async () => {
  const { toolCalls, trace } = await makeRun(runAttributes('2026-10-15'));
  const pkg = publish(toolCalls, trace, { contentProfile: undefined, extensions: undefined });
  assert.deepEqual(compositionOf(pkg)?.assertedDate, '2026-10-15');
  assert.deepEqual(Object.keys(pkg.extensions ?? {}), ['org.civicaitools.composition']);
});

/**
 * #475's consumer: reads the package alone and says whether the window its
 * queries filtered on is the year before the date its prompt asserted, the
 * same year, or cannot say. It reads two fields: the composition block's
 * `assertedDate`, and each query's `arguments.where`.
 */
function windowAgainstAssertedDate(pkg: Pkg): 'same-year' | 'year-apart' | 'unknown' {
  const asserted = compositionOf(pkg)?.assertedDate;
  if (typeof asserted !== 'string') return 'unknown';
  const assertedYear = Number(asserted.slice(0, 4));
  const years = new Set<number>();
  for (const q of pkg.queries) {
    const where = q.arguments?.where;
    if (typeof where !== 'string') continue;
    for (const m of where.matchAll(/'(\d{4})-\d{2}-\d{2}/g)) years.add(Number(m[1]));
  }
  if (years.size !== 1) return 'unknown';
  const [windowYear] = [...years];
  if (windowYear === assertedYear) return 'same-year';
  return Math.abs(windowYear - assertedYear) === 1 ? 'year-apart' : 'unknown';
}

test('#475: a package whose asserted date and queried window are a year apart is told from one where they agree, from the package alone', async () => {
  const runIn2026 = await makeRun(runAttributes('2026-10-15'));
  const runIn2025 = await makeRun(runAttributes('2025-12-31'));
  const apart = publish(runIn2026.toolCalls, runIn2026.trace);
  const agree = publish(runIn2025.toolCalls, runIn2025.trace);
  // Premise: the two packages ask the same question and filter on the same window.
  assert.equal(apart.prompt.text, agree.prompt.text);
  assert.deepEqual(apart.queries.map((q) => q.arguments.where), agree.queries.map((q) => q.arguments.where));
  assert.equal(windowAgainstAssertedDate(apart), 'year-apart', 'the package states no date its prompt asserted');
  assert.equal(windowAgainstAssertedDate(agree), 'same-year', 'the package states no date its prompt asserted');
});

test('a trace that recorded none of the five states none of them: no composition block, and an environment block of modelVersion, mcpServers and host', async () => {
  const { toolCalls, trace } = await makeRun({});
  const pkg = publish(toolCalls, trace);
  assert.equal(compositionOf(pkg), undefined);
  const environment = environmentOf(pkg);
  assert.ok(environment);
  assert.deepEqual(Object.keys(environment), ['modelVersion', 'mcpServers', 'host']);
  // With nothing recorded, the publish-time configuration is what the
  // 'configured' policy has always stated — the shape #495 is about, kept for
  // a trace made before W4.
  assert.ok(JSON.stringify(environment.mcpServers).includes(PUBLISH_BOSTON));
});

test('a present but malformed attribute is refused, not read as absent', async () => {
  const { toolCalls, trace } = await makeRun({ ...runAttributes('2026-10-15'), 'analysis.mcp_servers': '{not json' });
  assert.throws(
    () => publish(toolCalls, trace),
    (error: unknown) => error instanceof Error && error.name === 'RunAttributeError' && error.message.includes('analysis.mcp_servers'),
    'a malformed server list was packaged, which states publish-time servers for a run that recorded its own',
  );
});

test('a date that is not the YYYY-MM-DD the prompt stated is refused', async () => {
  const { toolCalls, trace } = await makeRun({ ...runAttributes('2026-10-15'), 'analysis.asserted_date': 'October 15, 2026' });
  assert.throws(
    () => publish(toolCalls, trace),
    (error: unknown) => error instanceof Error && error.name === 'RecordFieldError' && error.message.includes('assertedDate'),
  );
});

test('a call with no mcp.source tag is attributed in the graph by the app\'s resolver, as dataSources[] attributes it', async () => {
  const { toolCalls, trace } = await makeRun(runAttributes('2026-10-15'));
  const untagged = JSON.parse(JSON.stringify(trace)) as {
    resourceSpans: { scopeSpans: { spans: { name: string; attributes: { key: string }[] }[] }[] }[];
  };
  for (const rs of untagged.resourceSpans) for (const ss of rs.scopeSpans) for (const span of ss.spans) {
    if (span.name === 'mcp_tool_call') span.attributes = span.attributes.filter((a) => a.key !== 'mcp.source');
  }
  const pkg = publish(toolCalls, untagged as unknown as Json);
  const activities = pkg.provenance['@graph'].filter(
    (n) => n['@type'] === 'prov:Activity' && (n['dcterms:description'] ?? '').startsWith('MCP tool call'),
  );
  assert.deepEqual(
    activities.map((a) => a['prov:wasAssociatedWith']?.['@id'].split(':').pop()),
    ['socrata', 'boston-opencontext'],
    'an untagged aliased call is not attributed to its own source in the graph',
  );
  assert.deepEqual(pkg.dataSources.map((d) => d.sourceId).sort(), ['boston-opencontext', 'socrata']);
});
