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
 * This test does not hardcode the expected tool list. It imports the real
 * `CROSS_SOURCE_PREAMBLE` constant, extracts every `Tools: a, b, c.` list
 * out of it via regex, and checks each extracted name against the real
 * `mcpTools` export. Re-adding any uncallable name to the preamble in the
 * future — not just `search` or `fetch` specifically — fails this test.
 *
 * Composing the full system prompt (`composeSkillPrompt` /
 * `buildSystemPrompt`) was considered and rejected here: the property under
 * test is a relation between the preamble text and `mcpTools`, and building
 * intro + preamble + stub source bodies + outro around it doesn't strengthen
 * that assertion — it only reintroduces a stray-"Tools:" hazard from
 * whatever stub text stands in for the other sources. Importing the
 * constant directly and asserting on it is the whole test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CROSS_SOURCE_PREAMBLE } from './socrata-skill.ts';
import { mcpTools } from './tools.ts';

/**
 * Extracts every tool name out of every "Tools: a, b, c." list in the given
 * text. Tool names in this codebase never contain periods or commas, so a
 * comma-separated run up to the next period is a reliable list boundary.
 */
function extractAdvertisedToolLists(preambleText: string): string[][] {
  const lists: string[][] = [];
  const listRegex = /Tools:\s*([^.\n]+)\./g;
  let listMatch: RegExpExecArray | null;
  while ((listMatch = listRegex.exec(preambleText)) !== null) {
    lists.push(listMatch[1].split(',').map((name) => name.trim()));
  }
  return lists;
}

test('every tool name the cross-source preamble advertises exists in mcpTools', () => {
  const advertisedLists = extractAdvertisedToolLists(CROSS_SOURCE_PREAMBLE);

  // Structural guard: the preamble describes exactly three sources (Socrata,
  // Data Commons, Boston OpenContext), each with its own "Tools:" list. If
  // this count changes — a source added, removed, or a list reworded past
  // what the regex recognizes — that is a deliberate change this test
  // should be updated for, not something it should silently pass through.
  assert.equal(
    advertisedLists.length,
    3,
    `Expected exactly 3 "Tools:" lists in CROSS_SOURCE_PREAMBLE (one per MCP source), found ${advertisedLists.length}: ${JSON.stringify(advertisedLists)}`,
  );

  const callableToolNames = new Set(
    mcpTools
      .filter((tool): tool is Extract<typeof tool, { type: 'function' }> => tool.type === 'function')
      .map((tool) => tool.function.name),
  );

  for (const advertisedName of advertisedLists.flat()) {
    assert.ok(
      callableToolNames.has(advertisedName),
      `Preamble advertises tool "${advertisedName}" but it is not in mcpTools (src/lib/mcp/tools.ts) — the model will plan around a capability that does not exist.`,
    );
  }
});
