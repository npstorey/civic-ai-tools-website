// CKAN-1 P3 fix round 2, F8: on the run path, a pack's call is the pack's by the decision the loop core made for it,
// never by splitting the called name. A bare upstream name that the run's selection resolves to a pack is that pack's
// call (S2-B F1; `dispatchTargetOf`, `../mcp/registry.ts`, which the loop core reads for `mcp.pack_id`).
//
// WHAT IS DRIVEN. `whereItWentFromCalls` as `/api/compare-stream` feeds it on an all-sources run: each call's source
// by `routedSourceId` under the run's configuration and selection, and its pack by the dispatch target under the same
// (`resolvePack`, the same decision). Two packs: NYC City Record's bare `get_data` with only the pack offered, and the
// Boston pack's bare `ckan_datastore_search` with only the pack offered. The hosted CKAN server's address is a fake
// `.example.test` one; nothing is sent.
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
  {
    pack: 'boston-ckan', base: 'ckan-server', name: 'ckan_datastore_search', args: { server_url: 'https://data.boston.gov', resource_id: 'r-1' },
    selection: ['boston-ckan'],
    offered: [
      { sourceId: 'data-commons', alias: 'data_commons', reason: 'reader-off' },
      { sourceId: 'ckan-server', alias: 'ckan', reason: 'reader-off' },
      { sourceId: 'boston-ckan', alias: 'boston', reason: 'selected' },
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
