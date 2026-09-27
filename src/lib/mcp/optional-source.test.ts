// Sprint 238, ruling D2 — the optional-source rule, at the seams it lives in.
//
// `an-unconfigured-source-is-absent.test.ts` drives the unset case through the
// three query routes. This file holds the pieces that decide it, over explicit
// configurations rather than this process's environment, and in BOTH
// directions: configured, each seam returns exactly what it returned before the
// rule (the same array, the same constants); unconfigured, it drops the source.
//
// What makes the set-case assertions able to fail: they compare against the
// pre-rule values themselves — `CROSS_SOURCE_PREAMBLE`, which
// `prompt-advertised-tools.test.ts` still reads as three sources, the pinned
// outro text `skill-composition.test.ts` asserts, and `mcpTools` by identity.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMcpRegistry,
  configuredMcpServers,
  isSourceOffered,
  routedSourceId,
  withheldToolNames,
  type McpRegistryEnv,
} from './registry.ts';
import { mcpTools, mcpToolsFor, offeredMcpTools } from './tools.ts';
import {
  CROSS_SOURCE_PREAMBLE,
  crossSourcePreamble,
  offeredSkillSources,
  outroFor,
  portalLockGuidance,
} from './socrata-skill.ts';

const CKAN_TOOLS = [
  'ckan__search_datasets',
  'ckan__get_dataset',
  'ckan__query_data',
  'ckan__get_schema',
  'ckan__execute_sql',
  'ckan__aggregate_data',
];

const UNSET: McpRegistryEnv = { socrataUrl: 'https://socrata.invalid', dataCommonsUrl: 'https://data-commons.invalid' };
const SET: McpRegistryEnv = { ...UNSET, bostonOpencontextUrl: 'https://opencontext.invalid/mcp' };
const NEEDLES = ['Boston OpenContext', 'ckan__', 'data-mcp.boston.gov'];

const names = (tools: typeof mcpTools) => tools.map((t) => (t.type === 'function' ? t.function.name : t.type));

test('the registry: configured, the Boston server routes its six tools; unset, they resolve to no server and name the variable', () => {
  const set = buildMcpRegistry(SET);
  assert.equal(set.servers['boston-opencontext']?.endpointUrl, 'https://opencontext.invalid/mcp');
  assert.deepEqual(set.unconfiguredTools, {});
  const unset = buildMcpRegistry(UNSET);
  assert.equal(unset.servers['boston-opencontext'], undefined);
  for (const tool of CKAN_TOOLS) {
    assert.equal(unset.toolIndex[tool], undefined, `${tool} is routable with the source unset`);
    assert.equal(unset.unconfiguredTools[tool], 'BOSTON_OPENCONTEXT_MCP_URL', `${tool} does not name its variable`);
  }
  assert.deepEqual(Object.keys(unset.servers), ['socrata', 'data-commons']);
  assert.deepEqual(Object.keys(set.servers), ['socrata', 'data-commons', 'boston-opencontext'], 'insertion order moved');
  // An empty string is unset, as `configuredAddressForSource` reads it.
  assert.equal(buildMcpRegistry({ ...UNSET, bostonOpencontextUrl: '' }).servers['boston-opencontext'], undefined);
});

test('offered and withheld agree with the registry, and only optional sources are ever withheld', () => {
  assert.equal(isSourceOffered(SET, 'boston-opencontext'), true);
  assert.equal(isSourceOffered(UNSET, 'boston-opencontext'), false);
  assert.equal(isSourceOffered(UNSET, 'data-commons'), true);
  // Socrata is required, not optional: its absence refuses the query up front.
  assert.equal(isSourceOffered({ dataCommonsUrl: 'https://data-commons.invalid' }, 'socrata'), true);
  assert.deepEqual(withheldToolNames(SET), []);
  assert.deepEqual(withheldToolNames(UNSET), CKAN_TOOLS);
  assert.deepEqual(withheldToolNames({ dataCommonsUrl: 'https://data-commons.invalid' }), CKAN_TOOLS, 'Socrata tools were withheld');
});

test('the offered tools: configured, the very same array; unset, the list without the six ckan__ tools', () => {
  for (const locked of [undefined, 'records.city-a.example']) {
    const all = mcpToolsFor(locked);
    assert.equal(offeredMcpTools(all, SET), all, 'a configured instance is not handed the same array');
    const offered = offeredMcpTools(all, UNSET);
    assert.deepEqual(names(offered), names(all).filter((n) => !n.startsWith('ckan__')));
    assert.equal(names(all).length - names(offered).length, 6);
    assert.deepEqual(offered, all.filter((t) => t.type === 'function' && !t.function.name.startsWith('ckan__')), 'the kept schemas changed');
  }
});

test('the prompt pieces: configured, the pre-rule text; unset, the same lines less the source', () => {
  assert.deepEqual(offeredSkillSources(SET), ['socrata', 'data-commons', 'boston-opencontext']);
  assert.deepEqual(offeredSkillSources(UNSET), ['socrata', 'data-commons']);
  assert.equal(crossSourcePreamble(offeredSkillSources(SET)), CROSS_SOURCE_PREAMBLE);
  assert.equal(
    outroFor(offeredSkillSources(SET)),
    'When you get results, summarize clearly and cite the dataset ID (for Socrata), the variable DCID + source dataset (for Data Commons), or the resource UUID + dataset title (for Boston OpenContext).',
  );

  const unset = crossSourcePreamble(offeredSkillSources(UNSET));
  for (const needle of NEEDLES) assert.ok(!unset.includes(needle), `the unset preamble carries ${needle}`);
  assert.match(unset, /^You have access to TWO MCP data sources/);
  // Every other line is a line of the three-source preamble, so every tool it
  // names is one `prompt-advertised-tools.test.ts` already holds callable.
  const threeSourceLines = new Set(CROSS_SOURCE_PREAMBLE.split('\n'));
  const foreign = unset.split('\n').slice(1).filter((line) => !threeSourceLines.has(line));
  assert.deepEqual(foreign, [], 'the unset preamble has a line the three-source preamble does not');
  assert.equal([...unset.matchAll(/Tools:\s*([^.\n]+)\./g)].length, 2);

  const outro = outroFor(offeredSkillSources(UNSET));
  assert.equal(outro, 'When you get results, summarize clearly and cite the dataset ID (for Socrata) or the variable DCID + source dataset (for Data Commons).');
});

test('the lock section names Boston OpenContext only where it is configured', () => {
  assert.match(portalLockGuidance('records.city-a.example', SET), /\(Data Commons, and Boston OpenContext for Boston\) are separate, remain available/);
  const unset = portalLockGuidance('records.city-a.example', UNSET);
  for (const needle of NEEDLES) assert.ok(!unset.includes(needle), `the unset lock section carries ${needle}`);
  assert.match(unset, /the other data source described above \(Data Commons\) is separate, remains available, and keeps its own scope\.$/);
});

test('trace attribution: the routed source, or none — never a throw', () => {
  assert.equal(routedSourceId('ckan__query_data', SET), 'boston-opencontext');
  assert.equal(routedSourceId('get_data', SET), 'socrata');
  assert.equal(routedSourceId('get_observations', UNSET), 'data-commons');
  assert.equal(routedSourceId('ckan__query_data', UNSET), undefined);
  assert.equal(routedSourceId('no_such_tool', SET), undefined);
});

test('the record: configured, the Boston entry as configured; unset, none', () => {
  assert.deepEqual(configuredMcpServers(SET).at(-1), { url: 'https://opencontext.invalid/mcp', name: 'boston-opencontext' });
  assert.deepEqual(configuredMcpServers(UNSET).map((s) => s.name), ['socrata', 'data-commons']);
});
