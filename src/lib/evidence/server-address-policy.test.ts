// Which server addresses a record states depends on who made the run
// (Wave N12 W5, ruling A of the ORCH's G13 on #470; website #449 and
// civic-ai-tools#205).
//
// The packager reads THIS process's MCP configuration, and it packages runs
// this process did not make: `POST /api/evidence` accepts every
// `captureMethod`. `serverAddressPolicy` (packager.ts) is the one decision:
// a `chat-flow-stream` capture is a run this instance made, so its record
// names this instance's configured servers; any other capture's record names
// none from here, and keeps the skill-fetch URL its own trace carries.
//
// THE SHAPE THAT CAN FAIL. Every package below is built with this process
// configured AWAY from the defaults — Socrata at one address, Data Commons at
// an unreachable loopback port — so a record that took this instance's
// configuration for a run made elsewhere would carry one of those two strings
// somewhere in its bytes, and the assertions search the whole package for
// them, not one field. The trace shapes are the two a `claude-code-*` capture
// arrives with (a skill span naming a local stdio server, and no skill span)
// and, for this instance's own runs, the notebook route's shape: no skill
// span at all (`/api/query-notebook` writes none).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIVIC_SOURCE_REGISTRY } from '@typedstandards/civic-typed-harness';
import {
  buildEvidencePackage,
  serverAddressPolicy,
  sourceRegistryForPolicy,
  mcpServersForPolicy,
  type CaptureMethod,
  type PackageInput,
  type ToolCallInput,
} from './packager.ts';
import { TraceBuilder, hash as traceHash, CIVICAITOOLS_TRACE_CONFIG } from './trace.ts';
import { deriveOperationType, sourceIdForToolName } from '../mcp/operation-types.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';

process.env.EVIDENCE_KEY_ID ??= 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

const MCP_VARIABLES = ['SOCRATA_MCP_URL', 'DATA_COMMONS_MCP_URL', 'BOSTON_OPENCONTEXT_MCP_URL'] as const;

const CONFIGURED_SOCRATA = 'https://socrata-mcp.instance.example';
const UNREACHABLE_DATA_COMMONS = 'http://127.0.0.1:9/mcp';
/** What a Claude Code capture's skill span records (measured on published
 *  `claude-code-jsonl-readback` records, G13 premise 2). */
const LOCAL_STDIO = 'local-stdio (civic-ai-tools/.mcp.json: socrata)';

/** Run `fn` with this process configured away from the defaults. */
function configuredAway<T>(fn: () => T): T {
  const saved = MCP_VARIABLES.map((name) => [name, process.env[name]] as const);
  process.env.SOCRATA_MCP_URL = CONFIGURED_SOCRATA;
  process.env.DATA_COMMONS_MCP_URL = UNREACHABLE_DATA_COMMONS;
  delete process.env.BOSTON_OPENCONTEXT_MCP_URL;
  try {
    return fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const CALLS: ToolCallInput[] = [
  {
    name: 'get_data',
    args: { type: 'query', dataset_id: 'erm2-nwe9', select: 'count(*)' },
    resultSummary: { rows: 1, columns: 1 },
  },
  {
    name: 'get_observations',
    args: { variable_dcids: ['Count_Person'], place_dcid: 'geoId/36' },
    resultSummary: { rows: 1, columns: 2 },
  },
];

/** A trace with a tool span per call, and a skill span only when given one. */
function trace(skillServerUrl: string | undefined): Record<string, unknown> {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  if (skillServerUrl !== undefined) {
    const skill = builder.startSpan('skill_fetch');
    builder.endSpan(skill, {
      'skill.text_hash': traceHash('composed system prompt'),
      'skill.mcp_server_url': skillServerUrl,
    });
  }
  for (const call of CALLS) {
    const span = builder.startSpan('mcp_tool_call', undefined, {
      'tool.name': call.name,
      'tool.operation_type': deriveOperationType(call.name, call.args) || 'unknown',
      'tool.arguments': JSON.stringify(call.args),
      'mcp.source': sourceIdForToolName(call.name) ?? 'unknown',
    });
    builder.endSpan(span, { 'tool.response_hash': traceHash('[]'), 'tool.duration_ms': 50 });
  }
  builder.endRoot();
  return builder.finalize() as unknown as Record<string, unknown>;
}

function build(captureMethod: CaptureMethod | undefined, skillServerUrl: string | undefined) {
  const input: PackageInput = {
    trace: trace(skillServerUrl),
    prompt: 'How many noise complaints, and how many people?',
    output: 'About 412,000.',
    toolCalls: CALLS,
    model: 'openai/gpt-4o',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 't',
    summary: 's',
    ...(captureMethod ? { captureMethod } : {}),
    contentProfile: 'datHere',
    extensions: { 'org.civicaitools.notebook': { nbformat: 4, nbformat_minor: 5, cells: [], metadata: {} } },
  };
  const json = JSON.stringify(configuredAway(() => buildEvidencePackage(input).pkg));
  return { json, pkg: JSON.parse(json) as Record<string, unknown> };
}

type GraphNode = { '@id': string; [key: string]: unknown };

function agent(pkg: Record<string, unknown>, sourceId: string): GraphNode {
  const graph = (pkg.provenance as { '@graph': GraphNode[] })['@graph'];
  const found = graph.filter((n) => n['@id'].endsWith(`:mcp-server:${sourceId}`));
  assert.equal(found.length, 1, `expected one agent for "${sourceId}"`);
  return found[0];
}

function mcpServers(pkg: Record<string, unknown>): unknown {
  return (pkg.extensions as Record<string, { mcpServers: unknown }>)['org.civicaitools.environment'].mcpServers;
}

test('the policy: only a chat-flow-stream capture is a run this instance made', () => {
  assert.equal(serverAddressPolicy('chat-flow-stream'), 'configured');
  assert.equal(serverAddressPolicy('claude-code-jsonl-readback'), 'unknown');
  assert.equal(serverAddressPolicy('claude-code-self-report'), 'unknown');
  assert.equal(serverAddressPolicy(undefined), 'unknown');
});

test('a claude-code-jsonl-readback package names none of this instance\'s configured servers', () => {
  const { json, pkg } = build('claude-code-jsonl-readback', LOCAL_STDIO);
  for (const address of [UNREACHABLE_DATA_COMMONS, CONFIGURED_SOCRATA]) {
    assert.equal(
      json.includes(address),
      false,
      `a run made in a Claude Code session carries this instance's configured address "${address}"`,
    );
  }
  assert.equal(
    Object.hasOwn(agent(pkg, 'data-commons'), 'civic:serverUrl'),
    false,
    'the Data Commons agent asserts an address for a run this instance did not make',
  );
  // The capture's own trace still names the skill source, as before W5.
  assert.equal(agent(pkg, 'socrata')['civic:serverUrl'], LOCAL_STDIO);
  assert.deepEqual(mcpServers(pkg), [{ url: LOCAL_STDIO }]);
});

test('a self-report capture, and a package with no capture method, take the same branch', () => {
  for (const method of ['claude-code-self-report', undefined] as const) {
    const { json, pkg } = build(method, LOCAL_STDIO);
    assert.equal(json.includes(UNREACHABLE_DATA_COMMONS), false, String(method));
    assert.equal(Object.hasOwn(agent(pkg, 'data-commons'), 'civic:serverUrl'), false, String(method));
    assert.deepEqual(mcpServers(pkg), [{ url: LOCAL_STDIO }], String(method));
  }
});

test('a capture made elsewhere with no skill span names no server at all', () => {
  const { json, pkg } = build('claude-code-jsonl-readback', undefined);
  assert.equal(json.includes('civic:serverUrl'), false);
  assert.deepEqual(mcpServers(pkg), []);
});

test('this instance\'s notebook-shaped run (no skill span) still lists every server and names each address', () => {
  const { pkg } = build('chat-flow-stream', undefined);
  assert.deepEqual(mcpServers(pkg), [
    { url: CONFIGURED_SOCRATA, name: 'socrata' },
    { url: UNREACHABLE_DATA_COMMONS, name: 'data-commons' },
    { url: 'https://data-mcp.boston.gov/mcp', name: 'boston-opencontext' },
  ]);
  // No skill span to override it: the Socrata agent names the configured
  // address, where before W5 it named the harness constant.
  assert.equal(agent(pkg, 'socrata')['civic:serverUrl'], CONFIGURED_SOCRATA);
  assert.equal(agent(pkg, 'data-commons')['civic:serverUrl'], UNREACHABLE_DATA_COMMONS);
});

test('the registries: vocabulary kept on every branch; the reference branch is ruling A\'s alternative C', () => {
  const unknown = sourceRegistryForPolicy('unknown');
  const configured = configuredAway(() => sourceRegistryForPolicy('configured'));
  assert.deepEqual(Object.keys(unknown), Object.keys(CIVIC_SOURCE_REGISTRY));
  assert.deepEqual(Object.keys(configured), Object.keys(CIVIC_SOURCE_REGISTRY));
  for (const [id, info] of Object.entries(CIVIC_SOURCE_REGISTRY)) {
    const { serverUrl: _reference, ...vocabulary } = info;
    void _reference;
    assert.deepEqual(unknown[id], vocabulary, `${id}: the unknown branch carries no address and every other field`);
    const { serverUrl, ...rest } = configured[id];
    assert.deepEqual(rest, vocabulary, `${id}: the configured branch keeps every vocabulary field`);
    assert.equal(typeof serverUrl, 'string', `${id}: configured, and so addressed`);
  }
  assert.equal(configured['data-commons'].serverUrl, UNREACHABLE_DATA_COMMONS);
  assert.equal(sourceRegistryForPolicy('reference'), CIVIC_SOURCE_REGISTRY);
  assert.equal(mcpServersForPolicy('reference'), undefined);
  assert.equal(mcpServersForPolicy('unknown'), undefined);
});

test('the Data Commons API key never reaches the record, though it sits beside the address it is configured with', () => {
  const DECOY_KEY = 'decoy-data-commons-key-449';
  const saved = process.env.DATA_COMMONS_API_KEY;
  process.env.DATA_COMMONS_API_KEY = DECOY_KEY;
  try {
    const { json, pkg } = build('chat-flow-stream', undefined);
    // The instrument can see the configured addresses — so it would see the key.
    assert.equal(json.includes(UNREACHABLE_DATA_COMMONS), true);
    assert.equal(json.includes(DECOY_KEY), false, 'the Data Commons API key is in the signed bytes');
    assert.equal((mcpServers(pkg) as unknown[]).length, 3);
  } finally {
    if (saved === undefined) delete process.env.DATA_COMMONS_API_KEY;
    else process.env.DATA_COMMONS_API_KEY = saved;
  }
});
