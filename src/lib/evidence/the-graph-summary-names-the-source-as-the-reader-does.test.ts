// The provenance graph's reader-facing summary calls a data source what the
// rest of the page calls it (Wave N11 #434 P5, hub #194, ruling D4 = B).
//
// THE GAP, and where it is NOT. The record page's "Data sources" row has been
// mapped since the display helpers shipped: it reads "Socrata · Data Commons ·
// Boston OpenContext". That row is not the defect, and the first premise below
// pins it so this file cannot be mistaken for covering it.
//
// The leak is `ProvenanceGraphSection`'s Summary tab, which rendered
// `dcterms:description` (falling back to `dcterms:title`) VERBATIM from the
// signed graph. The graph names each source by its AGENT TITLE, so an Agent
// node reads "Socrata MCP Server" and a data response the builder could not
// describe by a portal reads "Data response from Socrata MCP Server" — the
// agent's title, in front of a reader, on the one page that is otherwise
// careful to say "Socrata" (docs/design-principles.md, Principle 9).
//
// NO SIGNED BYTE MOVES. The map is applied at render time. The assertions
// below check that too, from both sides: the graph the packager produced still
// carries the agent titles it always carried, and only the mapped reading of
// it does not.
//
// WHAT IS DRIVEN. A package built by this repository's `buildEvidencePackage`
// from a trace written by its own span builder, with two calls that reach the
// agent-title branch of the harness's description builder for two DIFFERENT
// sources:
//
//   - a `search` (source `socrata`, dataset-keyed, span carries no portal), and
//   - a `get_observations` (source `data-commons`, an aggregate source, which
//     takes the agent-title form whatever the span carries).
//
// TWO sources, because a map that handled one and not the other would pass a
// one-source fixture — the shape in which this criterion could not fail. A
// third premise asserts the two titles differ from each other and from their
// display names, so the mapped assertion has something to do.
//
// THE DERIVED SCAN (D10). Every tracked non-test component that reads a graph
// description maps it. The universe is derived from the tree, not from the one
// component that does so today.
//
// BLIND SPOT, stated: the scan reads source text, so it sees that a file calls
// the map, not that every one of its three render sites goes through the one
// helper that does. That is why the helper is a single function in this file's
// sibling module and the component has one `getDescription`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildEvidencePackage, type PackageInput, type ToolCallInput } from './packager.ts';
import { TraceBuilder, hash as traceHash, CIVICAITOOLS_TRACE_CONFIG } from './trace.ts';
import { deriveOperationType, sourceIdForToolName } from '../mcp/operation-types.ts';
import {
  CIVIC_SOURCE_REGISTRY,
  displayNameForSource,
  formatDataSourcesSummary,
  readerFacingSourceNames,
} from './data-sources.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';

// Test input only; no signing key is generated, displayed or handled here.
process.env.EVIDENCE_KEY_ID ??= 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

const RUN_PORTAL = 'data.cityofnewyork.us';

interface SpanFixture {
  call: ToolCallInput;
  result: string;
}

/**
 * Three calls. Two land on the agent-title description, for two DIFFERENT
 * sources; the third is a `get_data` whose span carries a portal, which takes
 * the portal form instead — the control that the map leaves alone, and the
 * only call shaped to mint a dataset-keyed `dataSources` entry, which the
 * "already mapped" premise needs in order to assert anything about Socrata.
 */
const FIXTURES: SpanFixture[] = [
  {
    call: {
      name: 'get_data',
      args: { type: 'query', portal: RUN_PORTAL, dataset_id: 'erm2-nwe9', select: 'count(*)' },
      resultSummary: { rows: 1, columns: 1 },
    },
    result: '[{"count":"412093"}]',
  },
  {
    call: { name: 'search', args: { query: 'noise complaints' }, resultSummary: { rows: 3, columns: 4 } },
    result: '[{"id":"erm2-nwe9","name":"311 Service Requests"}]',
  },
  {
    call: {
      name: 'get_observations',
      args: { variable: 'Count_Person', place: 'geoId/36061' },
      resultSummary: { rows: 1, columns: 2 },
    },
    result: '[{"value":1694251}]',
  },
];

function buildTrace(): Record<string, unknown> {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', { 'analysis.portal': RUN_PORTAL });
  for (const fixture of FIXTURES) {
    const { name, args } = fixture.call;
    const spanId = builder.startSpan('mcp_tool_call', undefined, {
      'tool.name': name,
      'tool.operation_type': deriveOperationType(name, args) || 'unknown',
      'tool.arguments': JSON.stringify(args),
      'mcp.source': sourceIdForToolName(name) ?? 'unknown',
      ...(args.dataset_id ? { 'tool.dataset_id': String(args.dataset_id) } : {}),
      ...(args.portal ? { 'tool.portal_domain': String(args.portal) } : {}),
    });
    builder.endSpan(spanId, {
      'tool.response_hash': traceHash(fixture.result),
      'tool.response_size_bytes': fixture.result.length,
      'tool.duration_ms': 120,
      ...(fixture.call.resultSummary ? { 'tool.response_rows': fixture.call.resultSummary.rows } : {}),
    });
  }
  builder.endRoot();
  return builder.finalize() as unknown as Record<string, unknown>;
}

const BUILT = buildEvidencePackage({
  trace: buildTrace() as unknown as PackageInput['trace'],
  prompt: 'How many 311 noise complaints were filed last year?',
  output: 'About 412,000.',
  toolCalls: FIXTURES.map((f) => f.call),
  model: 'openai/gpt-4o',
  portal: RUN_PORTAL,
  tokenUsage: { promptTokens: 100, completionTokens: 20 },
  promptVisibility: 'full_text',
  title: 'Noise complaints, 2025',
  summary: 'About 412,000 noise complaints were filed.',
  type: 'content/analysis/v1',
});

/** The package as storage hands it back. */
const READ_BACK = JSON.parse(JSON.stringify(BUILT.pkg)) as Record<string, unknown>;

type GraphNode = { '@id': string; [k: string]: unknown };

/** Exactly what `ProvenanceGraphSection.getDescription` reads, before the map. */
function statedDescriptions(): string[] {
  const graph = (READ_BACK.provenance as { '@graph': GraphNode[] })['@graph'];
  return graph
    .map((n) => (n['dcterms:description'] as string) || (n['dcterms:title'] as string) || '')
    .filter(Boolean);
}

const AGENT_TITLES = Object.values(CIVIC_SOURCE_REGISTRY)
  .map((e) => e.agentTitle)
  .filter(Boolean) as string[];

// --- Premises ---------------------------------------------------------------

test('PREMISE: the registry carries both names for each source, and they differ', () => {
  const registry = CIVIC_SOURCE_REGISTRY as Record<string, { displayName: string; agentTitle: string }>;
  for (const id of ['socrata', 'data-commons']) {
    assert.ok(registry[id]?.displayName, `${id} has a display name`);
    assert.ok(registry[id]?.agentTitle, `${id} has an agent title`);
    assert.notEqual(registry[id].displayName, registry[id].agentTitle, `${id}: the two must differ`);
  }
  assert.notEqual(registry['socrata'].agentTitle, registry['data-commons'].agentTitle);
  assert.equal(displayNameForSource('socrata'), 'Socrata');
});

test('PREMISE: the "Data sources" row is ALREADY mapped — that row is not the gap', () => {
  const summary = formatDataSourcesSummary(
    (READ_BACK.dataSources ?? []) as never,
  );
  assert.ok(summary, 'the fixture minted data sources');
  assert.match(String(summary), /Socrata/);
  assert.match(String(summary), /Data Commons/);
  assert.doesNotMatch(String(summary), /MCP Server/);
});

test('PREMISE: the built graph really states agent titles — for TWO different sources', () => {
  // Without this, the mapped assertion below would be a green over a fixture
  // that could not have failed.
  const stated = statedDescriptions();
  const leaked = AGENT_TITLES.filter((title) => stated.some((d) => d.includes(title)));
  assert.ok(
    leaked.length >= 2,
    'the fixture must reach the agent-title branch for at least two sources, or the map has ' +
      `nothing to prove. Stated descriptions: ${JSON.stringify(stated)}`,
  );
  assert.ok(
    stated.some((d) => /^Data response from .*MCP Server$/.test(d)),
    `a data-response description must take the agent-title form: ${JSON.stringify(stated)}`,
  );
});

// --- The map, driven --------------------------------------------------------

test('the reader-facing reading of the graph names no agent title', () => {
  const mapped = statedDescriptions().map((d) => readerFacingSourceNames(d));
  const leaked = mapped.filter((d) => AGENT_TITLES.some((t) => d.includes(t)));
  assert.deepEqual(leaked, [], 'these still name a source by its agent title');
  assert.ok(
    mapped.includes('Data response from Socrata'),
    `the socrata data response must read as the page's own name: ${JSON.stringify(mapped)}`,
  );
  assert.ok(
    mapped.includes('Data response from Data Commons'),
    `and so must the aggregate source's: ${JSON.stringify(mapped)}`,
  );
  assert.ok(mapped.includes('Socrata'), 'the Agent node reads as the display name');
  assert.ok(mapped.includes('Data Commons'));
});

test('the map changes nothing it was not asked to', () => {
  // The control from the fixture itself: the `get_data` response is described
  // by the portal the span carried, and that form is not a source name.
  assert.ok(
    statedDescriptions().includes(`Data response from ${RUN_PORTAL}`),
    'PREMISE: the portal-form description is in the fixture',
  );
  assert.equal(
    readerFacingSourceNames(`Data response from ${RUN_PORTAL}`),
    `Data response from ${RUN_PORTAL}`,
  );
  assert.equal(readerFacingSourceNames('MCP tool arguments (query)'), 'MCP tool arguments (query)');
  assert.equal(readerFacingSourceNames('User query prompt'), 'User query prompt');
  assert.equal(readerFacingSourceNames(''), '');
});

test('NO SIGNED BYTE MOVES: the package still carries the titles it always did', () => {
  // The map is a rendering decision. The bytes the signature covers are not
  // touched, and the JSON-LD escape hatch must keep showing exactly them.
  const raw = JSON.stringify(READ_BACK.provenance);
  for (const title of ['Socrata MCP Server', 'Google Data Commons MCP Server']) {
    assert.ok(raw.includes(title), `the signed graph must still state "${title}"`);
  }
});

// --- The derived scan -------------------------------------------------------

test('every component that reads a graph description maps the source name', () => {
  const components = execFileSync('git', ['ls-files', '--', 'src/**/*.tsx'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('.test.'));

  const readers = components.filter((f) => /dcterms:description/.test(readFileSync(f, 'utf8')));
  assert.ok(
    readers.length >= 1,
    'PREMISE: no component reading a graph description was found, so this scan is not reading ' +
      'the tree it thinks it is',
  );

  const unmapped = readers.filter((f) => !/readerFacingSourceNames\s*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(
    unmapped,
    [],
    'These render a signed graph description with no render-time source-name map, so an agent ' +
      'title reaches the reader — implementation language on a reader-facing surface ' +
      '(docs/design-principles.md, Principle 9; hub #194, ruling D4 = B).',
  );
});
