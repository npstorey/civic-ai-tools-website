/**
 * Guard: the Data Commons tool schemas offer the model exactly the arguments
 * the deployed server reads (#543 follow-up).
 *
 * The hosted server (api.datacommons.org/mcp) is datacommonsorg/mixer; its
 * `serverInfo.version` read `ce391f7` on 2026-10-11 ("Route Apigee /mcp to
 * Mixer", 2026-10-01). Its tools bind their arguments into the Go structs in
 * internal/server/mcp/types.go through mark3labs/mcp-go v0.48.0, whose
 * `BindArguments` is a plain `json.Unmarshal`: an argument the struct does not
 * name is DROPPED, not refused. So a schema that offers more than the struct
 * reads does not fail loudly; it changes the question. Driven on production
 * the same day: "Median household income for every census tract in Manhattan"
 * sent get_observations with `child_place_type: "CensusTract"`, the server
 * answered with New York County's own value (a 725-byte result, the size of a
 * single place), and the answer reported that one figure as every tract's.
 *
 * SERVER_READS below is copied from that commit's types.go. It is a pin on
 * another system's contract: when the server's version changes, re-read the
 * structs before re-running this, because a green here only says the schema
 * matches the copy.
 *
 * Both directions are asserted. Offering an argument the server drops is the
 * defect above; dropping one it reads from the schema would silently take a
 * capability away from the model, so the two sets must be equal.
 *
 * BLIND SPOTS. Only the schema, the description's JSON examples and the Data
 * Commons skill are read; an argument named in free prose elsewhere in a
 * prompt is not seen by the first three tests (the fourth reads the removed
 * names as words in the descriptions and the skill).
 *
 * WHERE THE TEXT LIVES (#599 W2). The constants this guard reads are
 * `@typedstandards/civic-typed-router`'s, re-exported unchanged by
 * `src/lib/mcp/`; their text is no longer in this repository. The guard reads
 * them through the website's exports, so it reads exactly what the app hands
 * the model, and a change to the package's text (a version bump) fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpTools } from './tools.ts';
import { DATA_COMMONS_SKILL } from './data-commons-skill.ts';

// datacommonsorg/mixer ce391f7, internal/server/mcp/types.go, the json tags of
// SearchIndicatorsInput and GetObservationsInput.
const SERVER_READS: Record<string, string[]> = {
  search_indicators: ['query', 'places', 'per_search_limit', 'include_topics'],
  get_observations: ['variable_dcid', 'place_dcid', 'source_override', 'date', 'date_range_start', 'date_range_end'],
};

// Offered before this guard, dropped by the server: the names must not come back.
const DROPPED_BY_SERVER = ['parent_place', 'maybe_bilateral', 'child_place_type'];

function dataCommonsTool(name: string) {
  const tool = mcpTools.find((t) => t.type === 'function' && t.function.name === name);
  assert.ok(tool && tool.type === 'function', `mcpTools carries ${name}`);
  return tool.function;
}

test('#543: each Data Commons tool schema offers exactly the arguments the deployed server reads', () => {
  for (const [name, reads] of Object.entries(SERVER_READS)) {
    const offered = Object.keys((dataCommonsTool(name).parameters as { properties: Record<string, unknown> }).properties);
    const notRead = offered.filter((a) => !reads.includes(a));
    const notOffered = reads.filter((a) => !offered.includes(a));
    assert.deepEqual(notRead, [], `${name} offers arguments the server drops: ${notRead.join(', ')}`);
    assert.deepEqual(notOffered, [], `${name} no longer offers arguments the server reads: ${notOffered.join(', ')}`);
  }
});

test('#543: every JSON example in a Data Commons tool description uses only arguments the server reads', () => {
  for (const [name, reads] of Object.entries(SERVER_READS)) {
    const description = dataCommonsTool(name).description ?? '';
    const examples = [...description.matchAll(/^\s*(?:- )?(\{.*\})/gm)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
    assert.ok(examples.length >= 2, `${name}: the description's examples were read (${examples.length})`);
    for (const example of examples) {
      const extra = Object.keys(example).filter((k) => !reads.includes(k));
      assert.deepEqual(extra, [], `${name} example uses ${extra.join(', ')}: ${JSON.stringify(example)}`);
    }
  }
});

test('#543: the descriptions and the skill never name an argument the server drops', () => {
  const texts: Record<string, string> = {
    'search_indicators description': dataCommonsTool('search_indicators').description ?? '',
    'get_observations description': dataCommonsTool('get_observations').description ?? '',
    DATA_COMMONS_SKILL,
  };
  for (const [label, text] of Object.entries(texts)) {
    for (const arg of DROPPED_BY_SERVER) {
      assert.doesNotMatch(text, new RegExp(`\\b${arg}\\b`), `${label} names ${arg}`);
    }
  }
});

test('#543: get_observations and the skill say one call returns one place, not its children', () => {
  assert.match(dataCommonsTool('get_observations').description ?? '', /cannot list a place's children/);
  assert.match(DATA_COMMONS_SKILL, /cannot list a place's children/);
});
