/**
 * The decision agrees with the send (S2-B F1, npstorey/civic-ai-tools#309).
 *
 * A pack's call is decided once, from the target the dispatch sends to. The loop core reads that target through
 * `dispatchTargetOf` (`./registry.ts`); the send resolves the same name through `routeToolCall` over the client's
 * registry narrowed by the run's selection (`withSelection`, `./client.ts` `callMcpTool`). They are two readings of
 * one rule, so this test drives every name down both and fails where they part, as
 * `scripts/outbound-proxy.test.mjs` does for the proxy decision.
 *
 * THE TABLE. Every subset of the installed manifest's source ids as the selection (2^7 at router 0.9.0), and no
 * selection; every name in `civicRouter.dispatchMap`, and every bare upstream name those entries carry. With
 * `SOCRATA_MCP_URL` set:
 *   - when the send routes a name, the resolver returns exactly the exposed name it routed;
 *   - when the resolver returns `undefined`, the send does not route the name to a pack's exposed name.
 * With `SOCRATA_MCP_URL` unset, the one place the two are meant to differ: a bare `get_data` with City Record
 * selected alone resolves to City Record's exposed name, and the send refuses it, not configured. The pack is still
 * the call's target, so the loop core treats it as the pack's call, and nothing is sent.
 *
 * WHAT IT CANNOT SEE. A configuration other than the two above (an optional source's address or switch set), and a
 * manifest other than the installed one: a router bump that adds a pack, or an optional base, re-runs this table but
 * does not widen it. The send here is `routeToolCall` over a registry built from the same configuration; the
 * client's registry is built once, at its module load, from the process environment, and is not read here.
 *
 * Run with: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

for (const k of ['BOSTON_OPENCONTEXT_MCP_URL', 'NYC_CHARTER_HOSTING', 'NYC_CHECKBOOK_HOSTING', 'NYS_LEGISLATION_HOSTING', 'DATA_COMMONS_API_KEY']) delete process.env[k];
process.env.SOCRATA_MCP_URL = 'http://127.0.0.1:9/mcp';
process.env.DATA_COMMONS_MCP_URL = 'http://127.0.0.1:9/dc/mcp';

const { CIVIC_MANIFEST, civicRouter } = await import('@typedstandards/civic-typed-router');
const { buildMcpRegistry, dispatchTargetOf, readMcpEnvFromProcess, routeToolCall, withSelection, McpConfigurationError } = await import('./registry.ts');

const SOURCE_IDS = CIVIC_MANIFEST.map((entry) => entry.sourceId);
const PACK_NAMES = new Set([...civicRouter.dispatchMap.values()].filter((target) => target.base !== undefined).map((target) => target.exposedName));
const NAMES = [...new Set([...civicRouter.dispatchMap.keys(), ...[...civicRouter.dispatchMap.values()].map((target) => target.upstreamName)])];
const SELECTIONS: Array<string[] | undefined> = [
  undefined,
  ...Array.from({ length: 2 ** SOURCE_IDS.length }, (_, mask) => SOURCE_IDS.filter((_, bit) => (mask >> bit) & 1)),
];

/** The send's answer: the exposed name it routes to, or the error it refuses with. */
function send(configured: ReturnType<typeof readMcpEnvFromProcess>, selection: string[] | undefined, name: string): { routed: string } | { refused: unknown } {
  try {
    return { routed: routeToolCall(withSelection(buildMcpRegistry(configured), configured, selection), name).exposedName };
  } catch (error) {
    return { refused: error };
  }
}

test('premise: the table holds every selection, both spellings and at least one pack', () => {
  assert.equal(SELECTIONS.length, 2 ** SOURCE_IDS.length + 1);
  assert.ok(PACK_NAMES.has('nyc_record__get_data') && PACK_NAMES.has('nyc_record__fetch'));
  assert.ok(NAMES.includes('get_data') && NAMES.includes('nyc_record__get_data') && NAMES.includes('socrata__get_data'));
});

test('with the base configured, the resolver and the send agree on every name under every selection', () => {
  const configured = readMcpEnvFromProcess();
  const parted: string[] = [];
  let routedToPack = 0;
  let bareRoutedToPack = 0;
  let unresolved = 0;
  for (const selection of SELECTIONS) {
    for (const name of NAMES) {
      const target = dispatchTargetOf(name, configured, selection);
      const answer = send(configured, selection, name);
      const where = `${name} under ${JSON.stringify(selection ?? null)}`;
      if ('routed' in answer) {
        if (target !== answer.routed) parted.push(`${where}: the send routes ${answer.routed}, the resolver says ${String(target)}`);
        if (PACK_NAMES.has(answer.routed)) {
          routedToPack += 1;
          if (!name.includes('__')) bareRoutedToPack += 1;
        }
      }
      if (target === undefined) {
        unresolved += 1;
        if ('routed' in answer && PACK_NAMES.has(answer.routed)) parted.push(`${where}: the resolver has no target, and the send routes it to the pack's ${answer.routed}`);
      }
    }
  }
  assert.deepEqual(parted, []);
  assert.ok(routedToPack > 0 && bareRoutedToPack > 0 && unresolved > 0, `the table cannot fail: ${routedToPack} pack routes, ${bareRoutedToPack} by a bare name, ${unresolved} unresolved`);
});

test("with the base unconfigured, a bare get_data with City Record alone resolves to City Record, and the send refuses it, not configured", () => {
  const saved = process.env.SOCRATA_MCP_URL;
  delete process.env.SOCRATA_MCP_URL;
  try {
    const configured = readMcpEnvFromProcess();
    assert.equal(dispatchTargetOf('get_data', configured, ['nyc-record']), 'nyc_record__get_data');
    const answer = send(configured, ['nyc-record'], 'get_data');
    assert.ok('refused' in answer, 'the send routed a call whose base is not configured');
    assert.ok(answer.refused instanceof McpConfigurationError, `the send refused it otherwise: ${String(answer.refused)}`);
  } finally {
    process.env.SOCRATA_MCP_URL = saved;
  }
});
