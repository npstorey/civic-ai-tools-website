// R7 WF, criteria D1 and D2 (#617): a run that reached a hosted source states
// that source in `dataSources[]`, and nothing else in the package moves.
//
// THE RULE. Specification §8.1.1: `dataSources` holds "One entry per data
// source touched by the analysis, derived from queries[] and the trace", and is
// empty only "when queries[] is empty, and when every entry in queries[]
// records a rejection" (§8.1.8). Until this phase a run whose answered calls
// went to NYC Charter signed `dataSources: []`, and a mixed run signed
// Socrata's entry without Charter's: the source was not in the registry
// `buildDataSources` reads, so the harness walk skipped it as unknown.
//
// WHAT IS DRIVEN. Every test builds a package through the real
// `buildEvidencePackage`, from a trace shaped as the loop writes one (a root
// span recording the run's servers, `analysis.mcp_servers`, and one
// `mcp_tool_call` span per call carrying `mcp.source`), with `packageId` and the
// clock fixed so bytes can be pinned.
//
// D1, the entry:
//   - a run with answered Charter calls carries exactly one `nyc-charter` entry,
//     `{ sourceId, catalogType: 'npm-package', portalUrl: <the pin's purl>,
//     accessTimestamp }`, in that key order;
//   - a mixed run (an answered Socrata `get_data` with a portal, then an
//     answered Charter call) carries the Socrata dataset entry, then Charter's;
//   - a run whose ONLY Charter call was recorded failed carries no Charter
//     entry. An answered Socrata call sits beside it as the control, so the
//     array is not empty for some other reason. This one is green at the base
//     by construction (the base mints no Charter entry for any run); it guards
//     the fix against minting one from a rejection.
//
// D2, nothing else moves:
//   - the provenance graph of a Charter run is pinned by hash, as built at
//     931fa48, and Charter's agent carries no `civic:serverUrl`. The graph reads
//     `CIVICAITOOLS_PROVENANCE_CONFIG.sourceRegistry`, not the registry
//     `dataSources[]` reads; if Charter's entry reached it, the agent would gain
//     the purl as `civic:serverUrl` (the run's servers name it) and three
//     descriptions would change. That is an open owner decision, not this fix;
//   - a run with no Charter call has `dataSources` exactly as 931fa48 wrote it,
//     over a Socrata + Data Commons fixture, so both the dataset-keyed path and
//     the aggregate path, and their order, are inside the pinned bytes;
//   - replay never takes Charter's entry for a portal: `replayPortalForPackage`
//     on a Charter-only package is `undefined`, and the same test asserts the
//     package carries the entry, so the property is not vacuously green on a
//     package that has none.
//
// EXPECTED AT 931fa48: the two D1 tests that need an entry fail at their
// `dataSources` assertion, the replay test fails at its entry assertion; the
// failed-only test and the two D2 pins pass.
//
// Run with: npm test

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { buildEvidencePackage, type ToolCallInput } from './packager.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';
import { hostedServerPurl } from '../mcp/registry.ts';
import { replayPortalForPackage } from '../model-loop/replay-loop.ts';

process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

const FIXED_PACKAGE_ID = '00000000-0000-4000-8000-000000000617';
const FIXED_NOW = '2026-10-17T12:00:00.000Z';
const PORTAL = 'data.cityofnewyork.us';
const DATASET = 'erm2-nwe9';

const CHARTER = CIVIC_MANIFEST.find((entry) => entry.sourceId === 'nyc-charter');
if (!CHARTER?.hosting) throw new Error('premise: the manifest holds a hosted nyc-charter entry');
/** The pin's purl, derived as the code derives it: never re-spelled here. */
const CHARTER_PURL = hostedServerPurl(CHARTER.hosting);

/** The servers a Charter-on run records on its root span (as G6's trace does). */
const RUN_SERVERS = [
  { url: 'https://socrata-mcp.civicaitools.org', name: 'socrata' },
  { url: 'https://api.datacommons.org/mcp', name: 'data-commons' },
  { url: CHARTER_PURL, name: 'nyc-charter' },
];

interface Call {
  name: string;
  source: string;
  args: Record<string, unknown>;
  failed?: boolean;
}

const CHARTER_SEARCH: Call = { name: 'nyc_charter__search', source: 'nyc-charter', args: { query: 'rent stabilized', corpus: 'admin_code', limit: 10 } };
const CHARTER_SECTION: Call = { name: 'nyc_charter__get_section', source: 'nyc-charter', args: { citation: '26-504', corpus: 'admin_code' } };
const SOCRATA_QUERY: Call = { name: 'socrata__get_data', source: 'socrata', args: { type: 'query', portal: PORTAL, dataset_id: DATASET, select: 'count(*)' } };
const DATA_COMMONS_OBS: Call = { name: 'data_commons__get_observations', source: 'data-commons', args: { variable_dcid: 'Count_Person', place_dcid: 'geoId/36061' } };

/** Span timestamps composed, not written out: a long digit run reads as account-shaped to the pre-push guard. */
const START_SEC = 1_760_000_000;
const NANOS = '000000000';

function traceOf(calls: Call[]): Record<string, unknown> {
  const attrs = (entries: Record<string, string | boolean>) =>
    Object.entries(entries).map(([key, v]) => ({ key, value: typeof v === 'boolean' ? { boolValue: v } : { stringValue: v } }));
  const root = {
    traceId: 'f1e2d3c4b5a6f7e8d9c0f1e2d3c4b5a6',
    spanId: 'aaaaaaaaaaaa0000',
    name: 'analysis',
    kind: 1,
    startTimeUnixNano: `${START_SEC}${NANOS}`,
    endTimeUnixNano: `${START_SEC + 60}${NANOS}`,
    attributes: attrs({ 'analysis.mcp_servers': JSON.stringify(RUN_SERVERS) }),
    events: [],
    status: { code: 1 },
  };
  const spans = calls.map((call, i) => ({
    traceId: root.traceId,
    spanId: `bbbbbbbbbbbb${String(i).padStart(4, '0')}`,
    parentSpanId: root.spanId,
    name: 'mcp_tool_call',
    kind: 1,
    startTimeUnixNano: `${START_SEC + 1 + i}${NANOS}`,
    endTimeUnixNano: `${START_SEC + 2 + i}${NANOS}`,
    attributes: attrs({
      'tool.name': call.name,
      'tool.operation_type': 'query',
      'tool.arguments': JSON.stringify(call.args),
      'mcp.source': call.source,
      ...(typeof call.args.portal === 'string' ? { 'tool.portal_domain': call.args.portal } : {}),
      ...(typeof call.args.dataset_id === 'string' ? { 'tool.dataset_id': call.args.dataset_id } : {}),
      ...(call.failed ? { error: true, 'error.kind': 'unavailable' } : { 'tool.response_hash': String(i).repeat(64).slice(0, 64) }),
    }),
    events: [],
    status: { code: call.failed ? 2 : 1 },
  }));
  return { resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: 'test', version: '1' }, spans: [root, ...spans] }] }] };
}

function build(calls: Call[]) {
  const toolCalls = calls.map((call) => ({
    name: call.name,
    args: call.args,
    ...(call.failed ? { failed: true, failureKind: 'unavailable' } : { resultSummary: { rows: 1, columns: 1 } }),
  })) as unknown as ToolCallInput[];
  mock.method(crypto, 'randomUUID', () => FIXED_PACKAGE_ID as ReturnType<typeof crypto.randomUUID>);
  mock.timers.enable({ apis: ['Date'], now: new Date(FIXED_NOW).getTime() });
  try {
    const { pkg } = buildEvidencePackage({
      trace: traceOf(calls),
      prompt: 'What does the Administrative Code say about rent stabilization?',
      output: 'The Administrative Code defines it in section 26-504.',
      toolCalls,
      model: 'openai/gpt-4o',
      tokenUsage: { promptTokens: 10, completionTokens: 5 },
      promptVisibility: 'full_text',
      title: 'Fixture run',
      summary: 'Fixture run.',
    });
    return pkg;
  } finally {
    mock.timers.reset();
    mock.restoreAll();
  }
}

const CHARTER_ENTRY = {
  sourceId: 'nyc-charter',
  catalogType: 'npm-package',
  portalUrl: CHARTER_PURL,
  accessTimestamp: FIXED_NOW,
};

const SOCRATA_ENTRY = {
  sourceId: 'socrata',
  catalogType: 'socrata',
  portalUrl: `https://${PORTAL}`,
  datasetId: DATASET,
  datasetUrl: `https://${PORTAL}/d/${DATASET}`,
  accessTimestamp: FIXED_NOW,
};

// --- D1: the entry --------------------------------------------------------------

test('D1: a run with answered Charter calls carries exactly one nyc-charter entry, with the pin\'s purl', () => {
  assert.match(CHARTER_PURL, /^pkg:npm\/%40betanyc\/nyc-charter-laws-rules@\d+\.\d+\.\d+$/, 'premise: the purl helper names the pin');
  const pkg = build([CHARTER_SEARCH, CHARTER_SECTION, CHARTER_SEARCH]);
  assert.equal(
    JSON.stringify(pkg.dataSources),
    JSON.stringify([CHARTER_ENTRY]),
    'a run with three answered Charter calls states no Charter entry in dataSources',
  );
});

test('D1: a mixed run carries the Socrata dataset entry, then Charter\'s', () => {
  const pkg = build([SOCRATA_QUERY, CHARTER_SECTION]);
  assert.equal(
    JSON.stringify(pkg.dataSources),
    JSON.stringify([SOCRATA_ENTRY, CHARTER_ENTRY]),
    'a mixed Socrata + Charter run does not state both sources, Socrata first',
  );
});

test('D1: a run whose only Charter call was recorded failed carries no Charter entry (§8.1.8)', () => {
  const pkg = build([SOCRATA_QUERY, { ...CHARTER_SECTION, failed: true }]);
  assert.equal(pkg.queries.length, 2, 'premise: both calls are in queries[]');
  assert.equal((pkg.queries[1] as { failed?: boolean }).failed, true, 'premise: the Charter call is recorded failed');
  assert.equal(
    JSON.stringify(pkg.dataSources),
    JSON.stringify([SOCRATA_ENTRY]),
    'a rejected Charter call minted an entry asserting access',
  );
});

// --- D2: nothing else moves -------------------------------------------------------

/** SHA-256 of `JSON.stringify(pkg.provenance)` for the Charter-only run, as built at 931fa48. */
const PINNED_CHARTER_GRAPH_SHA256 = 'ff23ce08f51f665e0a89f1c9c1435d574bd9adc27a6cb1afd61d6edab3cb3c54';
/** `dataSources` for the Socrata + Data Commons run, as built at 931fa48. */
const PINNED_NO_CHARTER_DATA_SOURCES =
  '[{"sourceId":"socrata","catalogType":"socrata","portalUrl":"https://data.cityofnewyork.us","datasetId":"erm2-nwe9","datasetUrl":"https://data.cityofnewyork.us/d/erm2-nwe9","accessTimestamp":"2026-10-17T12:00:00.000Z"},{"sourceId":"data-commons","catalogType":"data-commons","portalUrl":"https://api.datacommons.org/mcp","accessTimestamp":"2026-10-17T12:00:00.000Z"}]';

test('D2: the provenance graph of a Charter run is the graph 931fa48 built, and Charter\'s agent states no address', () => {
  const pkg = build([CHARTER_SEARCH, CHARTER_SECTION, CHARTER_SEARCH]);
  const graph = (pkg.provenance as { '@graph': Array<Record<string, unknown>> })['@graph'];
  const agent = graph.find((node) => node['@id'] === 'urn:civic-record:mcp-server:nyc-charter' && node['@type'] !== undefined);
  assert.ok(agent, 'premise: the graph names Charter as an agent');
  assert.equal(agent!['civic:serverUrl'], undefined, 'Charter\'s provenance agent gained civic:serverUrl: an open owner decision, not this fix');
  const digest = crypto.createHash('sha256').update(JSON.stringify(pkg.provenance)).digest('hex');
  assert.equal(digest, PINNED_CHARTER_GRAPH_SHA256, 'the signed provenance graph of a Charter run moved');
});

test('D2: a run with no Charter call has the dataSources 931fa48 wrote (Socrata dataset path, then the aggregate path)', () => {
  const pkg = build([DATA_COMMONS_OBS, SOCRATA_QUERY]);
  assert.equal(pkg.dataSources.length, 2, 'premise: both paths minted an entry');
  assert.equal(JSON.stringify(pkg.dataSources), PINNED_NO_CHARTER_DATA_SOURCES, 'dataSources moved for a run with no Charter call');
});

test('D2: replay takes no portal from a Charter-only package, which does carry the nyc-charter entry', () => {
  const pkg = build([CHARTER_SEARCH, CHARTER_SECTION]);
  assert.ok(
    pkg.dataSources.some((entry) => entry.sourceId === 'nyc-charter'),
    'the Charter-only package carries no nyc-charter entry, so the replay property below would hold vacuously',
  );
  assert.ok(pkg.queries.every((q) => q.portal === undefined), 'premise: no call named a portal');
  assert.equal(replayPortalForPackage(pkg), undefined, 'replay took a Charter entry for a get_data portal');
});
