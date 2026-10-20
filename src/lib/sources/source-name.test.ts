// R6 W3 (#632), criterion 11: a source's name as the panel and the card show
// it (G0 premise 8). Every manifest `displayName` ends "MCP Server" (router
// 0.4.0), which is implementation language to a reader (design principles,
// P9). The panel and the card show each name with a trailing " MCP Server"
// removed, through one function; a name without the suffix is shown whole,
// and the suffix is removed only at the end.
//
// The panel and the card render through it: `src/components/sources/
// sources-panel.test.ts` and `consent-card.test.ts` read the rendered names.
//
// WHAT MAKES IT ABLE TO FAIL. At the base there is no such function.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';

/** The module W3 adds (a specifier typed `string`, so the red commit type-checks). */
const NAMES: string = './source-name.ts';
const mod = (await import(NAMES).catch(() => null)) as { readerSourceName?: (displayName: string) => string } | null;

function name(): (displayName: string) => string {
  assert.ok(mod, `no source-name function: ${NAMES} does not exist`);
  assert.equal(typeof mod!.readerSourceName, 'function', `${NAMES} exports no readerSourceName`);
  return mod!.readerSourceName!;
}

test('criterion 11: every manifest entry\'s name is shown without its trailing " MCP Server"', () => {
  const readerName = name();
  assert.ok(CIVIC_MANIFEST.length >= 4, 'premise: the manifest has its four entries');
  for (const entry of CIVIC_MANIFEST) {
    assert.ok(entry.displayName.endsWith(' MCP Server'), `premise: ${entry.sourceId}'s name ends " MCP Server" (${entry.displayName})`);
    assert.equal(readerName(entry.displayName), entry.displayName.slice(0, -' MCP Server'.length), entry.sourceId);
  }
});

test('criterion 11: a name without the suffix is shown whole, and the suffix is removed only at the end', () => {
  const readerName = name();
  for (const whole of ['Boston Open Data', 'An MCP Server Directory', 'MCP Server', 'Fixture MCP Servers']) {
    assert.equal(readerName(whole), whole, `"${whole}" was changed`);
  }
});
