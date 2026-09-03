// Guard: this repository's hand-shaped mirror of the Socrata skill agrees
// with the hub's source of truth about which tool takes a portal (#186's
// website mirror, F7, Wave N9).
//
// THE SOURCE, PINNED BY COMMIT AND QUOTE. `civic-ai-tools/docs/skills/base.md`
// is the source of truth; it was rewritten at civic-ai-tools `8efcfeb`, now on
// its `main` at commit `fd9afae` (re-fetched and confirmed at that commit
// while writing this guard). The server's schemas are the ground truth behind
// that rewrite: `socrata-mcp-server/src/tools/socrata-tools.ts` at `c207f55`
// gives `search` a JSON schema with exactly one property, `query`
// (`:408-418`, `additionalProperties: false`), and `fetch` exactly one
// property, `id` (`:420-430`, same). Neither carries `portal`, `type`,
// `domain`, or `dataset_id`.
//
// The hub's own sentences, quoted verbatim as fixtures below (not fetched —
// this suite is credential-free and runs offline, so the pin is a quoted
// string plus a commit hash, never a network call):
//
//   base.md:181 — "**`get_data` is the only tool that takes a portal.**
//                  Settle that before choosing a tool:"
//   base.md:184 — "**`search`** takes exactly one argument, `query`, and
//                  searches **only the portal this server is configured
//                  for**. It has no portal argument, and anything else sent
//                  with it is rejected. Reach for it when the portal you
//                  want is the configured one; use `get_data` with
//                  `type: "catalog"` for every other portal."
//   base.md:185 — "**`fetch`** takes exactly one argument, `id`, and the
//                  portal travels inside that identifier. A `search` hit
//                  hands you `dataset:<portal>:<dataset_id>` (or
//                  `record:<portal>:<dataset_id>:<row_id>` for a single
//                  row), and a full dataset URL is also accepted — both name
//                  their portal. A **bare 4x4 ID names no portal**, so it
//                  resolves against the portal this server is configured
//                  for."
//   base.md:342-344 — the tool table: search → "`query` only — no portal
//                  argument"; fetch → "`id` only — the portal travels in the
//                  identifier; a bare 4x4 resolves against the configured
//                  portal"; get_data → "the only tool that reaches a portal
//                  other than the configured one".
//
// A CHANGE THERE IS A CHANGE HERE. These fixtures are a snapshot of the hub
// at `fd9afae`. If the hub's wording moves, this guard does not know — it
// checks this repository's mirror against the CLAIMS quoted above, not
// against a live fetch of the hub. Re-quoting the fixtures on a hub change is
// a manual step, stated so it isn't assumed automatic.
//
// WHAT THE MIRROR IS. `src/lib/mcp/socrata-skill.ts`'s `SOCRATA_SKILL_FALLBACK`
// and `getSkillForPortal` are GENERIC-ONLY and HAND-SHAPED by design (read
// their own header comments, and `scripts/sync-fallback.mjs`'s header, which
// explains why that script must never be run: a verbatim paste of the hub's
// composed text would re-import deployment posture and break the escaped
// template-literal body). So this guard checks CLAIMS, not bytes — it never
// asserts the mirror's text equals a hub quote, only that the mirror makes
// the same claims the hub does, in whatever wording the mirror already uses.
//
// WHAT'S WRONG TODAY, measured at `c342fe0` (P3 touched only `:599-612`,
// outside this range): `socrata-skill.ts` lines `151`, `153`, `157`,
// `159-165` (a compatibility table with per-portal `search`/`fetch` columns
// and `Limited`/`Fails`/`Unknown` cells), `169`, `181-182`, `185-186`, `216`,
// `268`, `304-308` (a tool table naming no arguments), and `412` inside
// `getSkillForPortal` ("SF search sometimes returns incorrect results" — a
// site with no hub counterpart, reached on the HEALTHY path: the composer
// calls `getSkillForPortal(ctx.portal)` whether or not the skill fetch
// succeeded, per `prompt-advertised-tools.test.ts`'s header) all still
// describe `search` and `fetch` as portal-variable — sometimes working,
// sometimes not, sometimes needing "the city name" — rather than as
// single-portal-argument, single-portal-scope tools.
//
// BLIND SPOT, STATED. Every assertion below is a text-level claim check: a
// sentence containing certain words in proximity, or a literal phrase's
// presence/absence. It cannot verify the mirror's claims are TRUE (that is
// the server schema's job, pinned by commit above, and
// `prompt-advertised-tools.test.ts`'s job for "is every named tool
// callable") — only that the mirror's prose agrees with the hub's. A
// rewrite that removes every quoted bad phrase but introduces a new sentence
// making the same wrong claim in different words can slip past the KNOWN_
// STALE_PHRASES check (byte-level, necessarily narrow) but not past the
// positive claim checks (word-proximity, broader) unless it also avoids
// stating the correct claim at all — which is exactly the failure mode this
// guard is red against right now.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOCRATA_SKILL_FALLBACK, getSkillForPortal } from './socrata-skill.ts';

// --- Hub fixtures, quoted verbatim at fd9afae -------------------------------

const HUB_SOURCE_NOTE = 'civic-ai-tools/docs/skills/base.md @ fd9afae';

const HUB_GET_DATA_ONLY_PORTAL = // base.md:181
  '**`get_data` is the only tool that takes a portal.** Settle that before choosing a tool:';

const HUB_SEARCH_SENTENCE = // base.md:184
  '**`search`** takes exactly one argument, `query`, and searches **only the portal this server ' +
  'is configured for**. It has no portal argument, and anything else sent with it is rejected. ' +
  'Reach for it when the portal you want is the configured one; use `get_data` with ' +
  '`type: "catalog"` for every other portal.';

const HUB_FETCH_SENTENCE = // base.md:185
  '**`fetch`** takes exactly one argument, `id`, and the portal travels inside that identifier. ' +
  'A `search` hit hands you `dataset:<portal>:<dataset_id>` (or `record:<portal>:<dataset_id>:' +
  '<row_id>` for a single row), and a full dataset URL is also accepted — both name their portal. ' +
  'A **bare 4x4 ID names no portal**, so it resolves against the portal this server is ' +
  'configured for.';

// --- Claim-level matching ----------------------------------------------------

/** Split into rough sentences so word-proximity checks stay near each other. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True if some sentence contains every word in `words` (case-insensitive). */
function anySentenceMatches(text: string, words: string[]): boolean {
  return sentences(text).some((s) => words.every((w) => new RegExp(`\\b${w}\\b`, 'i').test(s)));
}

// --- (a) search: only `query`, scoped to the configured portal --------------

test('F7: search is documented as taking only `query` (hub base.md:184)', () => {
  assert.ok(
    anySentenceMatches(SOCRATA_SKILL_FALLBACK, ['search', 'only', 'query']),
    `no sentence in SOCRATA_SKILL_FALLBACK states search takes only \`query\`. ${HUB_SOURCE_NOTE} ` +
      `says: ${JSON.stringify(HUB_SEARCH_SENTENCE)}`,
  );
});

test('F7: search is documented as scoped to the configured portal (hub base.md:184)', () => {
  assert.ok(
    anySentenceMatches(SOCRATA_SKILL_FALLBACK, ['search', 'configured', 'portal']),
    `no sentence in SOCRATA_SKILL_FALLBACK scopes search to "the configured portal". ` +
      `${HUB_SOURCE_NOTE} says: ${JSON.stringify(HUB_SEARCH_SENTENCE)}`,
  );
});

// --- (b) fetch: only `id`, portal travels in the identifier -----------------

test('F7: fetch is documented as taking only `id` (hub base.md:185)', () => {
  assert.ok(
    anySentenceMatches(SOCRATA_SKILL_FALLBACK, ['fetch', 'only', 'id']),
    `no sentence in SOCRATA_SKILL_FALLBACK states fetch takes only \`id\`. ${HUB_SOURCE_NOTE} ` +
      `says: ${JSON.stringify(HUB_FETCH_SENTENCE)}`,
  );
});

test('F7: fetch is documented as carrying the portal inside the identifier (hub base.md:185)', () => {
  assert.ok(
    anySentenceMatches(SOCRATA_SKILL_FALLBACK, ['portal', 'identifier']) ||
      anySentenceMatches(SOCRATA_SKILL_FALLBACK, ['portal', 'travels']),
    `no sentence in SOCRATA_SKILL_FALLBACK says the portal travels inside fetch's identifier. ` +
      `${HUB_SOURCE_NOTE} says: ${JSON.stringify(HUB_FETCH_SENTENCE)}`,
  );
});

// --- (c) get_data: the only tool that takes a portal; catalog = cross-portal

test('F7: get_data is documented as the only tool that takes a portal (hub base.md:181)', () => {
  assert.ok(
    anySentenceMatches(SOCRATA_SKILL_FALLBACK, ['get_data', 'only', 'portal']),
    `no sentence in SOCRATA_SKILL_FALLBACK states get_data is the only tool that takes a portal. ` +
      `${HUB_SOURCE_NOTE} says: ${JSON.stringify(HUB_GET_DATA_ONLY_PORTAL)}`,
  );
});

test('F7: cross-portal discovery is documented as get_data + catalog (hub base.md:181-183)', () => {
  assert.ok(
    anySentenceMatches(SOCRATA_SKILL_FALLBACK, ['catalog', 'portal']),
    'no sentence in SOCRATA_SKILL_FALLBACK names get_data with type: "catalog" as the cross-portal ' +
      `discovery path. ${HUB_SOURCE_NOTE} names it at base.md:181-183.`,
  );
});

// --- (d) the specific stale claims must be gone ------------------------------

/**
 * Exact phrases present in SOCRATA_SKILL_FALLBACK at `c342fe0` that couple
 * search/fetch to a specific portal, city, or domain, or claim they fail on
 * one — the opposite of "search covers only the configured portal, always,
 * uniformly" and "fetch always resolves however you name the portal in the
 * identifier". Byte-level on purpose: these are today's known-bad sentences,
 * named so stage 2 knows exactly what to rewrite (socrata-skill.ts lines
 * 151, 153, 169, 181, 185, 216, 268).
 */
const KNOWN_STALE_PHRASES = [
  'use the search tool to discover datasets on that domain',
  'use the search tool with the city name',
  'start with search to discover available datasets',
  'If search or fetch fails on a particular portal',
  'Search tool sometimes returns NYC data instead of SF',
  'Only get_data works; search and fetch tools fail',
  'Use the MCP search tool for datasets not listed here',
  'Note: Only get_data works for LA — search and fetch tools fail.',
];

test('F7: the fallback no longer carries the superseded per-portal search/fetch claims', () => {
  const hits = KNOWN_STALE_PHRASES.filter((phrase) => SOCRATA_SKILL_FALLBACK.includes(phrase));
  assert.deepEqual(
    hits,
    [],
    `SOCRATA_SKILL_FALLBACK still contains: ${JSON.stringify(hits, null, 2)} — search takes only ` +
      '`query` and covers only the configured portal; it is not a per-city or per-domain tool.',
  );
});

test('F7: no table gives search or fetch a per-portal compatibility column', () => {
  const header = SOCRATA_SKILL_FALLBACK.split('\n').find(
    (line) =>
      line.trim().startsWith('|') &&
      /\bdomain\b/i.test(line) &&
      /\bsearch\b/i.test(line) &&
      /\bfetch\b/i.test(line),
  );
  assert.equal(
    header,
    undefined,
    `found a per-portal table header naming search/fetch as variable-compatibility columns: ${header}`,
  );
});

test('F7: no table cell rates search or fetch "Limited" or "Fails" for a portal', () => {
  const badCell = SOCRATA_SKILL_FALLBACK.split('\n').find(
    (line) => line.trim().startsWith('|') && /\b(Limited|Fails)\b/.test(line),
  );
  assert.equal(
    badCell,
    undefined,
    `found a per-portal compatibility cell rating search/fetch: ${JSON.stringify(badCell)} — ` +
      'search/fetch behave uniformly: query-only / id-only, scoped to the configured portal.',
  );
});

test('F7: getSkillForPortal for SF no longer casts doubt on search accuracy', () => {
  const sf = getSkillForPortal('data.sfgov.org');
  assert.ok(
    !/search[^.]{0,60}(incorrect|wrong|NYC)/i.test(sf),
    `getSkillForPortal('data.sfgov.org') still says: ${JSON.stringify(sf)} — this site has no hub ` +
      'counterpart and is reached on the healthy path (composer calls getSkillForPortal(ctx.portal) ' +
      'whether or not the skill fetch succeeded).',
  );
});
