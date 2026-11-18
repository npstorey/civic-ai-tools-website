// CKAN-1 P3 fix round 2, F8: on the run path, a pack's call is the pack's by the decision the loop core made for it,
// never by splitting the called name. A bare upstream name that the run's selection resolves to a pack is that pack's
// call (S2-B F1; `dispatchTargetOf`, `../mcp/registry.ts`, which the loop core reads for `mcp.pack_id`).
//
// WHAT IS DRIVEN. `whereItWentFromCalls` as `/api/compare-stream` feeds it on an all-sources run: each call's source
// by `routedSourceId` under the run's configuration and selection, and its pack by the dispatch target under the same
// (`resolvePack`, the same decision): NYC City Record's bare `get_data` with only the pack offered. The hosted CKAN
// server's address is a fake `.example.test` one; nothing is sent.
//
// CKAN-2-WEB P1: router 0.12.0 retired the Boston pack, so its bare-name case is retired here; the rule is City
// Record's case's. W7 takes its place: a record made while the pack was offered names it by `mcp.pack_id`
// (`boston-ckan@https://data.boston.gov`), and "Where this question went" still reads that call as the pack's,
// through the router's `retiredPack`, answered by the CKAN server.
//
// SHAPED TO FAIL. The called names carry no alias, so a reading that splits the name finds no pack and counts the
// call under the base; a source the run did not call (Data Commons) must still read not used.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

for (const name of ['BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'SITE_PORTAL_LOCKED', 'SITE_DEFAULT_PORTAL']) delete process.env[name];
process.env.SOCRATA_MCP_URL = 'https://socrata.example.test/mcp';
process.env.DATA_COMMONS_MCP_URL = 'https://dc.example.test/mcp';
process.env.CKAN_MCP_URL = 'https://ckan.example.test/mcp';

const { dispatchTargetOf, readMcpEnvFromProcess, routedSourceId } = await import('../mcp/registry.ts');
const whereItWent = await import('./where-it-went.ts');
const { WHERE_IT_WENT_REASONS } = await import('../sources/copy.ts');

type Row = { kind: string; sourceId?: string; calls?: number; answeredBy?: { sourceId: string } };
const configured = readMcpEnvFromProcess();

/** One all-sources run's flows, as the route builds them, under `selection`, for one answered call named `name`. */
function flowsOf(name: string, args: Record<string, unknown>, selection: string[], offered: Array<{ sourceId: string; alias: string; reason: string }>) {
  const fromCalls = whereItWent.whereItWentFromCalls as unknown as (input: Record<string, unknown>) => ReturnType<typeof whereItWent.whereItWentFromCalls>;
  return fromCalls({
    toolCalls: [{ name, args, operationType: 'query' }],
    resolveSource: (called: string) => routedSourceId(called, configured, selection),
    resolvePack: (called: string) => (whereItWent as unknown as { packOfDispatchTarget?: (target: string | undefined) => string | undefined }).packOfDispatchTarget?.(dispatchTargetOf(called, configured, selection)),
    sourcesOffered: offered,
    statement: null,
    model: 'fixture/model',
    service: 'fixture service',
  });
}

const cases = [
  {
    pack: 'nyc-record', base: 'socrata', name: 'get_data', args: { type: 'query', dataset_id: 'dg92-zbpx' },
    selection: ['nyc-record'],
    offered: [
      { sourceId: 'socrata', alias: 'socrata', reason: 'reader-off' },
      { sourceId: 'data-commons', alias: 'data_commons', reason: 'reader-off' },
      { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'selected' },
    ],
  },
];

for (const c of cases) {
  test(`F8: a bare ${c.name} the selection resolves to ${c.pack} is that pack's call, answered by ${c.base}`, () => {
    const target = dispatchTargetOf(c.name, configured, c.selection);
    assert.ok(target?.startsWith(`${c.pack === 'nyc-record' ? 'nyc_record' : 'boston'}__`), `premise: the dispatch sends the bare ${c.name} to the pack (${target})`);
    assert.equal(routedSourceId(c.name, configured, c.selection), c.base, 'premise: the call is routed to the base\'s server');
    const flows = flowsOf(c.name, c.args, c.selection, c.offered);
    const pack = (flows.reached as Row[]).find((r) => r.kind === 'source' && r.sourceId === c.pack);
    assert.deepEqual(pack && { calls: pack.calls, answeredBy: pack.answeredBy?.sourceId }, { calls: 1, answeredBy: c.base }, `the bare-named call is not the pack's: ${JSON.stringify(flows.reached)}`);
    assert.equal(Object.fromEntries(flows.notReached.map((r) => [r.sourceId, r.whyNotSent]))['data-commons'], WHERE_IT_WENT_REASONS.off, 'a source the run did not call no longer reads not used');
  });
}

/** A call span as a record made under router 0.11.0 states a pack's call: attributed to the base, the pack named. */
const span = (attrs: Record<string, string>) => ({
  name: 'mcp_tool_call',
  parentSpanId: 'root',
  attributes: Object.entries(attrs).map(([key, value]) => ({ key, value: { stringValue: value } })),
});

test('W7: a record\'s call whose mcp.pack_id is boston-ckan@https://data.boston.gov reads as the retired pack\'s, answered by ckan-server', () => {
  const model = whereItWent.whereItWentFromSpans({
    spans: [span({ 'tool.name': 'boston__ckan_datastore_search', 'tool.operation_type': 'query', 'mcp.source': 'ckan-server', 'mcp.pack_id': 'boston-ckan@https://data.boston.gov' })],
    sourcesOffered: [
      { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
      { sourceId: 'ckan-server', alias: 'ckan', reason: 'selected' },
      { sourceId: 'boston-ckan', alias: 'boston', reason: 'selected' },
    ],
  });
  const reached = model.reached as Row[];
  const pack = reached.find((r) => r.kind === 'source' && r.sourceId === 'boston-ckan');
  assert.deepEqual(pack && { calls: pack.calls, answeredBy: pack.answeredBy?.sourceId }, { calls: 1, answeredBy: 'ckan-server' }, `the pack's call is not read as the pack's: ${JSON.stringify(reached)}`);
  assert.equal(Object.fromEntries(model.notReached.map((r) => [r.sourceId, r.whyNotSent]))['boston-ckan'], undefined, 'the retired pack reads as not used');
});
