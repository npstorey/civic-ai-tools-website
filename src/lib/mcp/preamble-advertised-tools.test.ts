/**
 * Guard: every tool name the cross-source preamble advertises to the model
 * is actually callable — present in `mcpTools` (src/lib/mcp/tools.ts).
 *
 * `CROSS_SOURCE_PREAMBLE` (src/lib/mcp/socrata-skill.ts) tells the model, in
 * plain English, which tools each MCP source offers. That text is decoupled
 * from the tool schemas actually sent to the model — nothing enforces that a
 * name mentioned in the preamble is one the model can call. A name that is
 * advertised but not callable is not an error: the model plans around having
 * a capability it does not have, and the resulting worse plan is invisible
 * in the output (civic-ai-tools-website#323 — the preamble told the model it
 * had `search` and `fetch` Socrata tools; only `get_data` was ever wired up).
 *
 * This test does not hardcode the expected tool list. It reads the preamble
 * source text directly, extracts every `Tools: a, b, c.` list via regex, and
 * checks each extracted name against the real `mcpTools` export. Re-adding
 * any uncallable name to the preamble in the future — not just `search` or
 * `fetch` specifically — fails this test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpTools } from './tools.ts';

const HERE = fileURLToPath(import.meta.url);
const MCP_ROOT = path.dirname(HERE);
const SOCRATA_SKILL_SOURCE = path.join(MCP_ROOT, 'socrata-skill.ts');

/**
 * Pulls the `CROSS_SOURCE_PREAMBLE` template literal's body out of the raw
 * source text. Scoping the search to just this declaration (rather than
 * scanning the whole file for "Tools:") keeps the extraction from picking up
 * an unrelated "Tools:" mention elsewhere in the module.
 */
function extractCrossSourcePreamble(sourceText: string): string {
  const match = sourceText.match(/const CROSS_SOURCE_PREAMBLE = `([\s\S]*?)`;/);
  assert.ok(
    match,
    'Expected to find `const CROSS_SOURCE_PREAMBLE = `...`;` in socrata-skill.ts — has the declaration moved or been renamed?',
  );
  return match![1];
}

/**
 * Extracts every tool name out of every "Tools: a, b, c." list in the given
 * text. Tool names in this codebase never contain periods or commas, so a
 * comma-separated run up to the next period is a reliable list boundary.
 */
function extractAdvertisedToolNames(preambleText: string): string[] {
  const names: string[] = [];
  const listRegex = /Tools:\s*([^.\n]+)\./g;
  let listMatch: RegExpExecArray | null;
  while ((listMatch = listRegex.exec(preambleText)) !== null) {
    for (const rawName of listMatch[1].split(',')) {
      names.push(rawName.trim());
    }
  }
  return names;
}

test('every tool name the cross-source preamble advertises exists in mcpTools', () => {
  const sourceText = fs.readFileSync(SOCRATA_SKILL_SOURCE, 'utf8');
  const preambleText = extractCrossSourcePreamble(sourceText);
  const advertisedNames = extractAdvertisedToolNames(preambleText);

  // Sanity check on the extraction itself: the preamble names three source
  // sections ("1.", "2.", "3."), each with its own "Tools:" list. If this
  // count changes, the regex is no longer matching what the preamble says
  // and the test below would pass vacuously.
  assert.ok(
    advertisedNames.length >= 3,
    `Expected to extract at least 3 tool names from the preamble's "Tools:" lists, got ${advertisedNames.length}: ${JSON.stringify(advertisedNames)}`,
  );

  const callableToolNames = new Set(
    mcpTools
      .filter((tool): tool is Extract<typeof tool, { type: 'function' }> => tool.type === 'function')
      .map((tool) => tool.function.name),
  );

  for (const advertisedName of advertisedNames) {
    assert.ok(
      callableToolNames.has(advertisedName),
      `Preamble advertises tool "${advertisedName}" but it is not in mcpTools (src/lib/mcp/tools.ts) — the model will plan around a capability that does not exist.`,
    );
  }
});
