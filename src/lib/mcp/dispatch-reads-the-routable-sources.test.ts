// R6 W1, criterion 4 (#632, D8 = A, part ii), and the selection at the unit.
//
// THE EDGE. The registry counts Socrata as offered when `SOCRATA_MCP_URL` is
// unset, because the router offers a required source always. Beside NYC
// Charter, which also hosts a tool called `search`, a bare `search` was then
// refused as AMBIGUOUS, naming `socrata__search` and `nyc_charter__search`,
// when what is wrong is that Socrata is not configured here. D8 rules that the
// dispatch's offered set reads the sources this instance can route, so the
// refusal names the variable: `not-configured`, `SOCRATA_MCP_URL`. With both
// configured the bare name stays ambiguous, naming both aliased forms (R7 P2's
// criterion 3b (ii), unchanged).
//
// No route reaches this edge: every route refuses an instance with
// `SOCRATA_MCP_URL` unset before any dispatch (`getMissingMcpRoutingError`).
// It is a unit-level consistency, asserted on `routeToolCall` directly.
//
// THE SELECTION, at the same seam. `buildMcpRegistry`'s selection argument is
// added by the fix; the red commit passes it through a typed view so it
// type-checks at the base, where the argument is ignored.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AmbiguousToolNameError,
  buildMcpRegistry,
  McpConfigurationError,
  routeToolCall,
  routedSourceId,
  type McpRegistryEnv,
} from './registry.ts';
import { classifyStreamError } from '../streaming.ts';

const DC = 'https://api.datacommons.org/mcp';
const SOCRATA = 'https://socrata-mcp.example.org';
const CHARTER_ON_SOCRATA_UNSET = { dataCommonsUrl: DC, nycCharterHosting: 'sandbox' } as McpRegistryEnv;
const CHARTER_ON_SOCRATA_SET = { socrataUrl: SOCRATA, dataCommonsUrl: DC, nycCharterHosting: 'sandbox' } as McpRegistryEnv;

type Selection = readonly string[] | undefined;
const buildWithSelection = buildMcpRegistry as unknown as (env: McpRegistryEnv, selection?: Selection) => ReturnType<typeof buildMcpRegistry>;
const routedWithSelection = routedSourceId as unknown as (name: string, configured?: McpRegistryEnv, selection?: Selection) => string | undefined;

function refusalOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

test('criterion 4: SOCRATA_MCP_URL unset and Charter on, a bare search is refused not-configured, naming SOCRATA_MCP_URL', () => {
  const registry = buildMcpRegistry(CHARTER_ON_SOCRATA_UNSET);
  assert.ok(registry.hosted['nyc-charter'] && !registry.servers.socrata, 'premise: Charter is routable here and Socrata is not');
  const caught = refusalOf(() => routeToolCall(registry, 'search'));
  assert.ok(!(caught instanceof AmbiguousToolNameError), `a bare search was refused as ambiguous: ${(caught as Error | undefined)?.message}`);
  assert.ok(caught instanceof McpConfigurationError, `a bare search was not refused as not configured: ${String(caught)}`);
  assert.match(caught.message, /SOCRATA_MCP_URL/);
  assert.equal(routedSourceId('search', CHARTER_ON_SOCRATA_UNSET), undefined, 'the span would attribute the refused call to a source');
});

test('criterion 4, unchanged: with both configured, a bare search is ambiguous, naming both aliased forms (green at the base)', () => {
  const caught = refusalOf(() => routeToolCall(buildMcpRegistry(CHARTER_ON_SOCRATA_SET), 'search'));
  assert.ok(caught instanceof AmbiguousToolNameError, `not refused as ambiguous: ${String(caught)}`);
  assert.deepEqual([...caught.candidates], ['socrata__search', 'nyc_charter__search']);
});

test('criterion 4, controls (green at the base): the aliased names still route, and Socrata\'s own bare name is refused not-configured', () => {
  const registry = buildMcpRegistry(CHARTER_ON_SOCRATA_UNSET);
  assert.equal(routeToolCall(registry, 'nyc_charter__search').server.sourceId, 'nyc-charter');
  for (const name of ['fetch', 'socrata__search']) {
    const caught = refusalOf(() => routeToolCall(registry, name));
    assert.ok(caught instanceof McpConfigurationError, `${name}: ${String(caught)}`);
    assert.match(caught.message, /SOCRATA_MCP_URL/);
  }
});

test('criterion 1, at the unit: a selection refuses a configured source it leaves out, as not_offered, and its span names no source', () => {
  const registry = buildWithSelection(CHARTER_ON_SOCRATA_SET, ['socrata']);
  assert.ok(registry.servers['data-commons'], 'premise: Data Commons is configured here');
  for (const name of ['data_commons__search_indicators', 'search_indicators', 'nyc_charter__get_section', 'get_section']) {
    const caught = refusalOf(() => routeToolCall(registry, name));
    assert.ok(caught instanceof Error, `${name} was routed though the selection leaves its source out`);
    assert.equal(classifyStreamError(caught), 'not_offered', `${name}: refused as ${classifyStreamError(caught)}`);
    assert.equal(routedWithSelection(name, CHARTER_ON_SOCRATA_SET, ['socrata']), undefined, `${name}: the span would name a source`);
  }
  // Inside the selection, the bare name a not-selected source also has is no
  // longer ambiguous: only one OFFERED source has it.
  assert.equal(routeToolCall(registry, 'search').server.sourceId, 'socrata');
});

test('criterion 1, at the unit: configuration comes first — an unconfigured source a selection names is still not-configured (green at the base)', () => {
  const registry = buildWithSelection(CHARTER_ON_SOCRATA_SET, ['socrata', 'boston-opencontext']);
  const caught = refusalOf(() => routeToolCall(registry, 'boston__ckan__search_datasets'));
  assert.ok(caught instanceof McpConfigurationError, `${String(caught)}`);
  assert.match(caught.message, /BOSTON_OPENCONTEXT_MCP_URL/);
});

test('criterion 5, at the unit: with no selection the registry is the base\'s, key for key (green at the base)', () => {
  for (const env of [CHARTER_ON_SOCRATA_SET, CHARTER_ON_SOCRATA_UNSET]) {
    const a = buildMcpRegistry(env);
    const b = buildWithSelection(env, undefined);
    assert.deepEqual(Object.keys(a).sort(), ['hosted', 'offeredSources', 'servers', 'toolIndex', 'unconfiguredTools']);
    assert.deepEqual(b, a);
  }
});
