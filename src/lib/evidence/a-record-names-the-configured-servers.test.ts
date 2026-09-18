// A record names the MCP servers this instance was configured with — read
// back from packages this repository built (Wave N12 W5: website #449's and
// hub #205's website halves, anchor #470 criteria 7 and 8).
//
// SCOPE. Packages built end-to-end by `buildEvidencePackage` from a trace
// written the way the producer writes it: the skill-fetch span carries
// `skillRoutingTraceAttributes(readMcpEnvFromProcess())`, exactly as
// `src/app/api/compare-stream/route.ts` records it, and each `mcp_tool_call`
// span carries the attributes `src/lib/model-loop/run-tool-loop.ts` writes.
// Every package here is a `chat-flow-stream` capture — a run this instance
// made, so its routing IS this process's configuration. What a capture made
// elsewhere should carry is not asserted here.
//
// WHAT IS RED AT `b3ec208` (harness 0.4.1 installed) AND WHAT IS A CONTROL.
//   RED — (7a) with the Data Commons address at an unreachable loopback port
//         (the issue's measured shape), the Data Commons agent's
//         `civic:serverUrl` names the harness constant, a server the run
//         never contacted: the packager spreads `CIVIC_SOURCE_REGISTRY`.
//   RED — (8) the datHere environment extension lists one server, the skill
//         span's, where the registry holds three; and none where it holds two
//         and the skill span names no Socrata address.
//   RED — (7b) with no Socrata address configured, the Socrata agent still
//         names the constant; and an agent for a source the registry does not
//         know names its own source id as a server URL (the 0.4.x fallback).
//   CONTROL — at the defaults the Data Commons agent names the public
//         endpoint, before and after: the lookup finds the node.
//   CONTROL — with no Socrata address the Socrata agent keeps the registry's
//         title: the entry is kept, with its address omitted, not dropped.
//   CONTROL — a package without the datHere profile carries no environment
//         extension, before and after.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePackage, type PackageInput, type ToolCallInput } from './packager.ts';
import { TraceBuilder, hash as traceHash, CIVICAITOOLS_TRACE_CONFIG } from './trace.ts';
import { deriveOperationType, sourceIdForToolName } from '../mcp/operation-types.ts';
import { buildMcpRegistry, readMcpEnvFromProcess, skillRoutingTraceAttributes } from '../mcp/registry.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';

process.env.EVIDENCE_KEY_ID ??= 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

const MCP_VARIABLES = [
  'SOCRATA_MCP_URL',
  'DATA_COMMONS_MCP_URL',
  'BOSTON_OPENCONTEXT_MCP_URL',
  'DATA_COMMONS_API_KEY',
] as const;
type McpVariable = (typeof MCP_VARIABLES)[number];

/** The issue's measured shape: Data Commons at an unreachable loopback port. */
const UNREACHABLE_DATA_COMMONS = 'http://127.0.0.1:9/mcp';
/** A Socrata address that is not the harness constant, as a bare host — the
 *  shape the variable carries on the reference deployment's own records. */
const CONFIGURED_SOCRATA = 'https://socrata-mcp.instance.example';
/** The harness constant, which only a registry spread from it can name. */
const CONSTANT_DATA_COMMONS = 'https://api.datacommons.org/mcp';

/** Run `fn` with exactly these MCP variables set and every other one unset. */
function withMcpEnv<T>(env: Partial<Record<McpVariable, string>>, fn: () => T): T {
  const saved = MCP_VARIABLES.map((name) => [name, process.env[name]] as const);
  for (const name of MCP_VARIABLES) {
    const value = env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

interface Call {
  call: ToolCallInput;
  /** The result string the loop hashes; absent for a rejected call. */
  result?: string;
}

const SOCRATA_CALL: Call = {
  call: {
    name: 'get_data',
    args: { type: 'query', dataset_id: 'erm2-nwe9', select: 'count(*)' },
    resultSummary: { rows: 1, columns: 1 },
  },
  result: '[{"count":"412093"}]',
};

/** The issue's Data Commons call: refused, the server unreachable. */
const DATA_COMMONS_CALL: Call = {
  call: {
    name: 'get_observations',
    args: { variable_dcids: ['Count_Person'], place_dcid: 'geoId/36' },
    failed: true,
    failureKind: 'unavailable',
    duration_ms: 31,
  },
};

/** A tool the source map does not know: the producer writes `'unknown'`. */
const UNMAPPED_CALL: Call = {
  call: { name: 'describe_portal', args: { id: 'a0b1' }, resultSummary: { rows: 1, columns: 2 } },
  result: '{"id":"a0b1"}',
};

/** The trace as the producer writes it, under the CURRENT process env. */
function buildTrace(calls: Call[]): Record<string, unknown> {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  const skillSpan = builder.startSpan('skill_fetch');
  builder.endSpan(skillSpan, {
    'skill.text_hash': traceHash('composed system prompt'),
    ...skillRoutingTraceAttributes(readMcpEnvFromProcess()),
  });
  for (const { call, result } of calls) {
    const spanId = builder.startSpan('mcp_tool_call', undefined, {
      'tool.name': call.name,
      'tool.operation_type': deriveOperationType(call.name, call.args) || 'unknown',
      'tool.arguments': JSON.stringify(call.args),
      'mcp.source': sourceIdForToolName(call.name) ?? 'unknown',
      ...(call.args.dataset_id ? { 'tool.dataset_id': String(call.args.dataset_id) } : {}),
    });
    if (result !== undefined) {
      builder.endSpan(spanId, {
        'tool.response_hash': traceHash(result),
        'tool.response_size_bytes': result.length,
        'tool.duration_ms': 120,
        ...(call.resultSummary ? { 'tool.response_rows': call.resultSummary.rows } : {}),
      });
    } else {
      builder.endSpan(spanId, {
        error: true,
        'error.kind': String(call.failureKind),
        'tool.duration_ms': Number(call.duration_ms),
      });
    }
  }
  builder.endRoot();
  return builder.finalize() as unknown as Record<string, unknown>;
}

/** Build and read back (as storage round-trips it) a chat-flow-stream package. */
function readBack(calls: Call[], datHere: boolean): Record<string, unknown> {
  const input: PackageInput = {
    trace: buildTrace(calls),
    prompt: 'How many 311 noise complaints were filed, and how many people live in New York?',
    output: 'About 412,000; the population figure could not be retrieved.',
    toolCalls: calls.map((c) => c.call),
    model: 'openai/gpt-4o',
    tokenUsage: { promptTokens: 100, completionTokens: 20 },
    promptVisibility: 'full_text',
    title: 'Noise complaints and population',
    summary: 'About 412,000 noise complaints; the Data Commons server was unreachable.',
    captureMethod: 'chat-flow-stream',
    // The publish dialog always supplies the executed notebook with the
    // datHere profile; the v0.1 chain refuses to hash that profile without it.
    ...(datHere
      ? {
          contentProfile: 'datHere' as const,
          extensions: { 'org.civicaitools.notebook': { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} } },
        }
      : {}),
    type: 'content/analysis/v1',
  };
  return JSON.parse(JSON.stringify(buildEvidencePackage(input).pkg)) as Record<string, unknown>;
}

type GraphNode = { '@id': string; [key: string]: unknown };

function sourceAgent(pkg: Record<string, unknown>, sourceId: string): GraphNode {
  const graph = (pkg.provenance as { '@graph'?: GraphNode[] } | undefined)?.['@graph'];
  assert.ok(Array.isArray(graph), 'the read-back package carries no provenance @graph');
  const agents = graph.filter((n) => n['@id'].endsWith(`:mcp-server:${sourceId}`));
  assert.equal(agents.length, 1, `expected one agent for source "${sourceId}", found ${agents.length}`);
  return agents[0];
}

function mcpServers(pkg: Record<string, unknown>): unknown {
  const extensions = pkg.extensions as Record<string, { mcpServers?: unknown }> | undefined;
  const environment = extensions?.['org.civicaitools.environment'];
  assert.ok(environment, 'the datHere package carries no org.civicaitools.environment extension');
  return environment.mcpServers;
}

test('(7a) the Data Commons agent names the configured address, not the harness constant', () => {
  const pkg = withMcpEnv(
    { SOCRATA_MCP_URL: CONFIGURED_SOCRATA, DATA_COMMONS_MCP_URL: UNREACHABLE_DATA_COMMONS },
    () => readBack([SOCRATA_CALL, DATA_COMMONS_CALL], true),
  );
  assert.equal(
    sourceAgent(pkg, 'data-commons')['civic:serverUrl'],
    UNREACHABLE_DATA_COMMONS,
    'this instance routed Data Commons to the configured address; a record naming any other ' +
      'server asserts, in signed bytes, a server the run never contacted',
  );
});

test('(8) the datHere environment lists every registry server, in registry order, named by source id', () => {
  for (const env of [
    { SOCRATA_MCP_URL: CONFIGURED_SOCRATA, DATA_COMMONS_MCP_URL: UNREACHABLE_DATA_COMMONS },
    { DATA_COMMONS_MCP_URL: UNREACHABLE_DATA_COMMONS },
  ]) {
    const { pkg, expected } = withMcpEnv(env, () => {
      const configured = readMcpEnvFromProcess();
      const addressOf: Record<string, string | undefined> = {
        socrata: configured.socrataUrl,
        'data-commons': configured.dataCommonsUrl,
        'boston-opencontext': configured.bostonOpencontextUrl,
      };
      const registryOrder = Object.keys(buildMcpRegistry(configured).servers);
      return {
        pkg: readBack([DATA_COMMONS_CALL], true),
        expected: registryOrder.map((name) => ({ url: addressOf[name], name })),
      };
    });
    assert.deepEqual(
      mcpServers(pkg),
      expected,
      `with ${Object.keys(env).join(' + ')} set the registry holds ${expected.length} servers; ` +
        'the extension must list each, in registry order, with its configured address and its source id',
    );
  }
});

// (7b) Asserted as no key at all (`Object.hasOwn`), not merely a falsy value.
test('(7b) with no Socrata address configured, the Socrata agent carries no server URL', () => {
  const pkg = withMcpEnv({}, () => readBack([SOCRATA_CALL, UNMAPPED_CALL], false));
  const socrata = sourceAgent(pkg, 'socrata');
  assert.equal(
    Object.hasOwn(socrata, 'civic:serverUrl'),
    false,
    `no Socrata address is configured, yet the agent names "${String(socrata['civic:serverUrl'])}"`,
  );
});

test('(7b) an agent for a source the registry does not know carries no server URL', () => {
  const pkg = withMcpEnv({}, () => readBack([SOCRATA_CALL, UNMAPPED_CALL], false));
  const unknown = sourceAgent(pkg, 'unknown');
  assert.equal(
    Object.hasOwn(unknown, 'civic:serverUrl'),
    false,
    `a source the registry does not know names "${String(unknown['civic:serverUrl'])}" as its server`,
  );
});

test('CONTROL: with no Socrata address the Socrata agent keeps the registry title — kept, not dropped', () => {
  const pkg = withMcpEnv({}, () => readBack([SOCRATA_CALL, UNMAPPED_CALL], false));
  assert.equal(sourceAgent(pkg, 'socrata')['dcterms:title'], 'Socrata MCP Server');
});

test('CONTROL: at the defaults the Data Commons agent names the public endpoint', () => {
  const pkg = withMcpEnv({ SOCRATA_MCP_URL: CONFIGURED_SOCRATA }, () =>
    readBack([SOCRATA_CALL, DATA_COMMONS_CALL], true),
  );
  assert.equal(sourceAgent(pkg, 'data-commons')['civic:serverUrl'], CONSTANT_DATA_COMMONS);
});

test('CONTROL: a package without the datHere profile carries no environment extension', () => {
  const pkg = withMcpEnv(
    { SOCRATA_MCP_URL: CONFIGURED_SOCRATA, DATA_COMMONS_MCP_URL: UNREACHABLE_DATA_COMMONS },
    () => readBack([SOCRATA_CALL, DATA_COMMONS_CALL], false),
  );
  const extensions = pkg.extensions as Record<string, unknown> | undefined;
  assert.equal(extensions?.['org.civicaitools.environment'], undefined);
});
