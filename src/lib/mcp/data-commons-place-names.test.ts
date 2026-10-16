/**
 * Guard: nothing that reaches the model tells it to pass a DCID in
 * `search_indicators`' `places` (#543).
 *
 * The hosted Data Commons server resolves each `places` entry as a place NAME.
 * Read at the deployed commit (datacommonsorg/mixer ce391f7,
 * internal/agent/search_indicators.go `resolvePlaces`), and driven on
 * 2026-10-11 through this app's own client with the production key:
 * `places: ["geoId/3651000"]` came back `isError: true`, "no place found
 * matching name: geoId/3651000"; `places: ["Kings County, New York"]` came back
 * with results; `get_observations` with `place_dcid: "geoId/3651000"` came back
 * with the 2024 value. So a DCID is right for `get_observations` and wrong for
 * `places`. The example in the tool description and the skill's worked example
 * both taught the wrong one, and the model copied it on every run.
 *
 * WHAT IS READ. The `search_indicators` schema in `mcpTools` (its description's
 * JSON examples and the `places` description) and `DATA_COMMONS_SKILL`, the two
 * texts that tell the model what to put in `places`.
 *
 * BLIND SPOTS. A DCID offered for `places` in prose that does not name
 * `search_indicators` in the same sentence is not seen. A prompt that never
 * mentions `places` at all passes, which is why the last test also asserts that
 * the schema still says "name".
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

// Since #599 W3 the tool is offered, and the skill names it, as
// `data_commons__search_indicators`; this reads either spelling.
const SEARCH_INDICATORS = /(?<![A-Za-z0-9_])(?:data_commons__)?search_indicators(?![A-Za-z0-9_])/;

// A Data Commons place DCID: `geoId/36061`, `country/USA`, `zip/10001`, …
const PLACE_DCID = /^(?:geoId|country|zip|wikidataId|nuts|earth)\/\S+$/;
const PLACE_DCID_IN_PROSE = /\b(?:geoId|country|zip)\/[A-Za-z0-9]+/;

function searchIndicators() {
  const tool = mcpTools.find((t) => t.type === 'function' && SEARCH_INDICATORS.test(t.function.name));
  assert.ok(tool && tool.type === 'function', 'mcpTools carries search_indicators');
  return tool.function;
}

test('#543: no search_indicators example in the tool description passes a DCID in places', () => {
  const description = searchIndicators().description ?? '';
  const examples = [...description.matchAll(/^- (\{.*\})/gm)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
  assert.ok(examples.length >= 2, `the description's examples were read (${examples.length})`);
  const withPlaces = examples.filter((e) => Array.isArray(e.places));
  assert.ok(withPlaces.length >= 1, 'at least one example scopes the search to a place');
  for (const example of withPlaces) {
    for (const place of example.places as string[]) {
      assert.doesNotMatch(place, PLACE_DCID, `example passes a DCID in places: ${JSON.stringify(example)}`);
    }
  }
});

test('#543: no sentence of the Data Commons skill that names search_indicators offers it a place DCID', () => {
  const sentences = DATA_COMMONS_SKILL.split(/(?<=[.!?])\s+|\n/).filter((s) => SEARCH_INDICATORS.test(s));
  assert.ok(sentences.length >= 3, `the skill's search_indicators sentences were read (${sentences.length})`);
  for (const sentence of sentences) {
    assert.doesNotMatch(sentence, PLACE_DCID_IN_PROSE, `offers search_indicators a DCID: ${sentence.trim()}`);
  }
});

test('#543: the places parameter and the skill both say a place is passed by name', () => {
  const places = (searchIndicators().parameters as { properties: Record<string, { description?: string }> }).properties.places;
  assert.match(places.description ?? '', /\bnames?\b/i);
  assert.doesNotMatch(places.description ?? '', /list of place DCIDs/i);
  assert.match(DATA_COMMONS_SKILL, /data_commons__search_indicators[^\n]*\bby name\b/);
});
