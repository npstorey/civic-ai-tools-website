/**
 * Guard: no surface reaching the model names a tool it cannot call (#323).
 *
 * WHY THE PROPERTY AND NOT ONE CONSTANT. The first version of this file read
 * `CROSS_SOURCE_PREAMBLE` and nothing else, because that is the constant the
 * issue named. #323 was closed against it and reopened, and the reopen was
 * right: `SOCRATA_SKILL_FALLBACK` — the text used when the skill fetch fails —
 * described `search` and `fetch` at ten sites the guard could not see, and
 * `getSkillForPortal` named one on the path where the fetch SUCCEEDS, which is
 * the healthy path and the one nothing had ever guarded. A guard that reads one
 * constant cannot see a defect that lives in a class. So the corpus below is
 * every constant `composeSkillPrompt` can put in front of the model, and adding
 * a new one to that composition without adding it here is the regression this
 * file's own coverage assertion reports.
 *
 * WHAT COUNTS AS "NAMING A TOOL". A tool name that is advertised but not
 * callable is not an error the reader ever sees: the model plans around a
 * capability it does not have, and the worse plan is invisible in the output.
 * The two directions that produces are checked separately, because they fail
 * differently.
 *
 *   A. AN INVENTED NAME. Text can name a tool that exists nowhere. Only the
 *      text can be read for that, so the extractor below pulls names out of
 *      three ANCHORED positions and checks each against `mcpTools`:
 *
 *        1. a `Tools: a, b, c.` list         (the cross-source preamble's form)
 *        2. a bold token that is a lowercase identifier   (**search**, **ckan__get_schema**)
 *        3. a markdown table cell that is a lowercase identifier, bold or bare
 *           (| get_data | search | fetch |, and the Data Commons tool table)
 *
 *      plus a snake_case word immediately before "tool"/"tools". The anchors
 *      are stated here rather than inferred because an instrument states its
 *      scope in the same sentence it makes its claim. Measured against the
 *      current corpus they extract eleven names and NOTHING else: every
 *      rejected candidate is a prose label (Domain, Status, Tool, Purpose,
 *      Volume, DCID, Concern, ...), which is what the lowercase-identifier
 *      filter is doing — every tool name in this codebase is a lowercase
 *      identifier and every column heading in this corpus is capitalised.
 *
 *   B. A KNOWN NAME THAT IS NOT CALLABLE. This is what #323 actually was:
 *      `registry.ts` has routed `get_data`, `search` and `fetch` since it was
 *      written, the skill text described all three, and only two ever had a
 *      schema. Prose says "start with search to discover datasets" with no
 *      markup to anchor on, so no extractor was ever going to catch it. The
 *      check that does is structural and needs no regex: every tool name the
 *      routing registry can dispatch must have a schema in `mcpTools`, and no
 *      prompt-reaching constant may contain, as a word, a routable name that
 *      does not.
 *
 * THE SECOND ASSERTION IN B IS VACUOUS WHILE THE FIRST HOLDS, and that is
 * stated rather than hidden: routing ⊆ schemas is what keeps the not-callable
 * set empty, and the word sweep is what names the prose sites on the day it
 * stops holding. At `f117665` — before this phase added the two schemas — the
 * not-callable set was {search, fetch} and the sweep reported sites in both
 * `SOCRATA_SKILL_FALLBACK` and `getSkillForPortal`.
 *
 * The sweep is a plain word match, so when it does run it also reports ordinary
 * English uses of a name — "search first, then fetch" in the Data Commons text.
 * That over-reporting is the right trade at the moment it fires: the set it
 * sweeps for is non-empty only when a real tool is uncallable, and an author
 * reading the list needs every candidate site, not a filtered one.
 *
 * WHAT THIS DOES NOT CATCH, so nobody has to infer it. An invented BARE word in
 * prose with no markup and no underscore ("use the grab tool") is reachable by
 * neither direction: A has no anchor to see it and B does not know the name.
 * Closing that would take a stoplist of the English words that legitimately
 * precede "tool" in this corpus (what, without, any, three, these, local, few,
 * two, burns, making, captures), and a guard that depends on a list of English
 * words is a guard that fails on the first rewording. The gap is named instead.
 *
 * The live skill text fetched from the MCP server at runtime is likewise out of
 * reach — it is not a constant in this repository. The fallback is what this
 * repository ships and is what this file can hold to account.
 *
 * THE FILENAME MOVED WITH THE SCOPE. This was `preamble-advertised-tools.test.ts`
 * while it read one constant. A guard whose name states a narrower reach than
 * it has is the failure this wave is named for, one level down.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSS_SOURCE_PREAMBLE,
  SOCRATA_SKILL_FALLBACK,
  getSkillForPortal,
} from './socrata-skill.ts';
import { DATA_COMMONS_SKILL } from './data-commons-skill.ts';
import { BOSTON_OPENCONTEXT_SKILL } from './boston-skill.ts';
import { mcpTools } from './tools.ts';
import { buildMcpRegistry } from './registry.ts';

/**
 * Every constant `composeSkillPrompt` can compose into the system prompt, each
 * named as a reader would find it. `getSkillForPortal` is a function, so it is
 * represented by its output for every portal it knows — the composer calls it
 * with `ctx.portal` on the success path as well as the fallback path, so its
 * text reaches the model whether or not the skill fetch worked.
 */
const PROMPT_REACHING_CONSTANTS: Record<string, string> = {
  CROSS_SOURCE_PREAMBLE,
  SOCRATA_SKILL_FALLBACK,
  DATA_COMMONS_SKILL,
  BOSTON_OPENCONTEXT_SKILL,
  ...Object.fromEntries(
    portalsWithGuidance().map((portal) => [
      `getSkillForPortal('${portal}')`,
      getSkillForPortal(portal),
    ]),
  ),
};

/**
 * The portals `getSkillForPortal` has guidance for. Derived rather than listed,
 * so a portal added to it is covered on the day it is added: candidates are
 * every `data.*` domain the fallback names, and the function itself decides —
 * it returns '' for a portal it has nothing to say about. The count is asserted
 * below, because a derivation that quietly returns nothing is indistinguishable
 * from a function with no portal-specific text at all.
 */
function portalsWithGuidance(): string[] {
  const candidates = new Set(
    [...SOCRATA_SKILL_FALLBACK.matchAll(/\bdata\.[a-z0-9.-]+\b/g)].map((m) => m[0]),
  );
  return [...candidates].filter((portal) => getSkillForPortal(portal) !== '');
}

/** A lowercase identifier — the shape every tool name in this codebase has. */
const TOOL_NAME_SHAPE = /^[a-z][a-z0-9_]*$/;

/** The tool names the model is actually given schemas for. */
function callableToolNames(): Set<string> {
  return new Set(
    mcpTools
      .filter((tool): tool is Extract<typeof tool, { type: 'function' }> => tool.type === 'function')
      .map((tool) => tool.function.name),
  );
}

/**
 * Every tool name the routing registry can dispatch. Built with all three
 * endpoints configured so no source's tools are missing from the vocabulary —
 * the Socrata entry is absent from an unconfigured registry by design (#258
 * C4), and this is a question about names, not about one instance's env.
 */
function routableToolNames(): Set<string> {
  const registry = buildMcpRegistry({
    socrataUrl: 'https://socrata.invalid',
    dataCommonsUrl: 'https://data-commons.invalid',
    bostonOpencontextUrl: 'https://boston.invalid',
  });
  return new Set(Object.keys(registry.toolIndex));
}

/**
 * Every tool name the given text presents as a tool, by the four anchors the
 * header names. Returns names in encounter order, deduplicated per text.
 */
export function extractToolMentions(text: string): string[] {
  const found = new Set<string>();

  // 1. `Tools: a, b, c.` — comma-separated up to the next period. Tool names
  //    here never contain a period or a comma, so that is a reliable boundary.
  for (const list of text.matchAll(/Tools:\s*([^.\n]+)\./g)) {
    for (const name of list[1].split(',')) found.add(name.trim());
  }

  // 2. A bold token that is a lowercase identifier: **search**, **ckan__get_schema**.
  for (const bold of text.matchAll(/\*\*([^*\s]+)\*\*/g)) {
    if (TOOL_NAME_SHAPE.test(bold[1])) found.add(bold[1]);
  }

  // 3. A markdown table cell that is a lowercase identifier, bold markers
  //    stripped. Catches both a tool table's first column and a compatibility
  //    table's per-tool headings.
  for (const line of text.split('\n')) {
    const row = line.trim();
    if (!row.startsWith('|') || !row.endsWith('|')) continue;
    for (const cell of row.slice(1, -1).split('|')) {
      const value = cell.trim().replace(/^\*\*/, '').replace(/\*\*$/, '');
      if (TOOL_NAME_SHAPE.test(value)) found.add(value);
    }
  }

  // 4. A snake_case word immediately before "tool"/"tools". Restricted to names
  //    carrying an underscore on purpose: without it this anchor matches every
  //    English word that can precede "tool", and a guard resting on a stoplist
  //    of English words is one rewording from wrong. Bare-word tool names are
  //    reached by anchors 2 and 3, and by the routable-name sweep below.
  for (const before of text.matchAll(/([a-z][a-z0-9_]*)\s+tools?\b/g)) {
    if (before[1].includes('_')) found.add(before[1]);
  }

  return [...found];
}

test('#323: every tool name a prompt-reaching constant presents is callable', () => {
  const callable = callableToolNames();
  const seen: string[] = [];

  for (const [name, text] of Object.entries(PROMPT_REACHING_CONSTANTS)) {
    for (const mentioned of extractToolMentions(text)) {
      seen.push(mentioned);
      assert.ok(
        callable.has(mentioned),
        `${name} names tool "${mentioned}", which has no schema in mcpTools (src/lib/mcp/tools.ts). ` +
          'The model will plan around a capability it does not have, and the worse plan is invisible ' +
          'in the output. Add the schema, or stop naming the tool.',
      );
    }
  }

  // The corpus and the extractor must both still be measuring something. An
  // anchor set that has drifted out of step with how the constants are written
  // extracts nothing, and a portal derivation that returns nothing composes
  // nothing — both look exactly like a corpus with no tool names in it.
  assert.ok(
    portalsWithGuidance().length >= 3,
    `getSkillForPortal was found to have guidance for only ${portalsWithGuidance().length} portals ` +
      '(3 when this guard was written). The derivation has stopped finding them — see the header.',
  );
  assert.ok(
    seen.length >= 11,
    `the extractor found only ${seen.length} tool mentions across ${Object.keys(PROMPT_REACHING_CONSTANTS).length} ` +
      'constants (11 were present when this guard was written). It has stopped measuring — see the header.',
  );
});

test('#323: the cross-source preamble still describes exactly three sources', () => {
  // Kept from the first version of this guard: the preamble's shape is load-
  // bearing for anchor 1, and a source added, removed, or reworded past what
  // the regex recognises is a deliberate change to update this test for, not
  // one to pass through silently.
  const lists = [...CROSS_SOURCE_PREAMBLE.matchAll(/Tools:\s*([^.\n]+)\./g)];
  assert.equal(
    lists.length,
    3,
    `Expected exactly 3 "Tools:" lists in CROSS_SOURCE_PREAMBLE (one per MCP source), found ${lists.length}`,
  );
});

test('#323: every routable tool name has a schema, and no constant names one that does not', () => {
  const callable = callableToolNames();
  const notCallable = [...routableToolNames()].filter((name) => !callable.has(name));

  // The sweep runs BEFORE the structural assertion, and this ordering is
  // load-bearing rather than stylistic. The sweep is non-empty only when
  // `notCallable` is non-empty, which is exactly when the structural assertion
  // fails — so with the structural assertion first, the sweep is unreachable
  // code that no run can ever execute. Reported first, it names the prose sites
  // an author has to go and change; the structural line below then states the
  // root cause once.
  const sites: string[] = [];
  for (const name of notCallable) {
    const word = new RegExp(`\\b${name}\\b`);
    for (const [constant, text] of Object.entries(PROMPT_REACHING_CONSTANTS)) {
      if (word.test(text)) sites.push(`${constant} names "${name}"`);
    }
  }
  assert.deepEqual(
    sites,
    [],
    `these prompt-reaching constants name tools the model cannot call:\n  ${sites.join('\n  ')}\n` +
      'Either give the tool a schema in mcpTools, or stop naming it.',
  );

  assert.deepEqual(
    notCallable,
    [],
    `registry.ts routes ${JSON.stringify(notCallable)} but mcpTools has no schema for them. ` +
      'This is #323 exactly: routing and prose knew the tool, the model was never given a way to call it.',
  );
});

test('#323: the extractor recognises each anchor it claims to', () => {
  // A self-test on a fixture, not on the corpus: it proves the extractor works
  // independently of whether today's constants happen to exercise every anchor.
  // Without it, an extractor that silently matched nothing would pass every
  // assertion above for the same reason a clean tree does.
  const fixture = [
    'Tools: alpha_one, alpha_two.',
    'Prefer **beta_one** for discovery, and **Capitalised** is not a tool name.',
    '',
    '| Tool | Purpose |',
    '|------|---------|',
    '| gamma_one | does a thing |',
    '| **gamma_two** | does another |',
    '',
    'Call the delta_one tool first. The search tool is a bare word this anchor skips.',
  ].join('\n');

  const found = extractToolMentions(fixture).sort();
  assert.deepEqual(found, [
    'alpha_one',
    'alpha_two',
    'beta_one',
    'delta_one',
    'gamma_one',
    'gamma_two',
  ]);
});
