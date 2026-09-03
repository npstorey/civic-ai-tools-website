// P8 red instrument, Wave N9 (#384), stage 1 — the cold read's F5: the
// `fetch` tool description the model receives contradicts the server.
//
// THE CLAIM AT 4ec45c0. `src/lib/mcp/tools.ts:131`: "A bare 4x4 dataset ID
// or a Socrata dataset URL is also accepted, and resolves against the
// server's configured portal." The second half is false of the URL form.
//
// THE SERVER'S GRAMMAR, pinned by file, line and commit (rider 9's shape).
// `socrata-mcp-server/src/tools/socrata-tools.ts` at `c207f55`, read with
// `git show c207f55:src/tools/socrata-tools.ts`:
//   - `parseFetchIdentifier` (`:640-711`) resolves, in order:
//       `dataset:`/`record:` prefixed ids → the portal in the id (`:646-673`);
//       a URL, or anything with a `/` retried as `https://…` (`:675-681`) →
//       `tryParseUrlIdentifier` (`:604-638`), whose domain is
//       `url.hostname.toLowerCase()` (`:613`) — the URL's OWN host, never
//       the configured one;
//       a bare 4x4 (`STRICT_DATASET_ID_REGEX`, `:594`) → `getDefaultDomain()`
//       (`:683-688`, the call at `:686`);
//       `4x4:row` → `getDefaultDomain()` (`:691-701`, the call at `:697`);
//       `host:4x4` → that host (`:703-708`).
//   - `handleFetchTool` (`:820-827`) then uses `domain || getDefaultDomain()`,
//     which for a URL is always the URL's host.
// So: a URL names its own portal; ONLY the bare 4x4 and `4x4:row` forms
// resolve against the configured portal.
//
// THE TWO SURFACES IN ONE PROMPT. The skill text composed into the same
// context (`socrata-skill.ts:171`, the mirror of hub `base.md:185` pinned in
// `socrata-skill-mirror.test.ts`) says "a full dataset URL names its portal";
// the tool description says the opposite. The model receives both.
//
// SCOPE. The `fetch` entry of `mcpTools` and the `fetch` sentence of
// `SOCRATA_SKILL_FALLBACK`, as text: claim checks at sentence level (a
// sentence that mentions the URL form must say the URL names its own
// portal/host, and the bare-4x4 sentence must say "configured portal"), plus
// one byte-level check on the false clause. Blind spot: a rewrite that states
// the wrong claim in words this pattern does not recognise passes the
// byte-level check and fails only the positive one — which is the check that
// matters. `prompt-advertised-tools.test.ts` (every named tool is callable)
// and `socrata-skill-mirror.test.ts` (the mirror agrees with the hub) are
// untouched and stay green.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/mcp/fetch-id-grammar.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpTools } from './tools.ts';
import { SOCRATA_SKILL_FALLBACK } from './socrata-skill.ts';

function fetchDescription(): string {
  const tool = mcpTools.find((t) => 'function' in t && t.function.name === 'fetch') as
    | { function: { description?: string } }
    | undefined;
  assert.ok(tool, 'mcpTools no longer carries a `fetch` tool — re-anchor');
  return tool!.function.description ?? '';
}

/** Rough sentences, so the claim checks stay within one statement. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A sentence saying the URL form carries its own portal, in any of the wordings a rewrite might use. */
const URL_NAMES_ITS_OWN_PORTAL =
  /\b(?:its own|that URL'?s|the URL'?s|the link'?s)\s+(?:portal|host|hostname|domain)\b|\bnames?\s+(?:its|the|their)\s+(?:own\s+)?(?:portal|host)\b|\bhostname\b|\bportal\s+(?:in|from|of|inside|named (?:in|by))\s+the\s+URL\b/i;

const SERVER_PIN = 'socrata-mcp-server/src/tools/socrata-tools.ts @ c207f55 — tryParseUrlIdentifier:613 (url.hostname), parseFetchIdentifier:683-688 and :691-701 (getDefaultDomain for bare 4x4 and 4x4:row)';

// --- (a) RED at 4ec45c0 -------------------------------------------------------

test('F5 (a) every sentence of the fetch description that mentions the URL form says the URL names its own portal', () => {
  const urlSentences = sentences(fetchDescription()).filter((s) => /\bURL\b/.test(s));
  assert.ok(urlSentences.length > 0, 'the fetch description no longer mentions the URL form — re-anchor');
  for (const sentence of urlSentences) {
    assert.match(
      sentence,
      URL_NAMES_ITS_OWN_PORTAL,
      `the model is told the URL form resolves against the configured portal; the server resolves it against ` +
        `the URL's own hostname (${SERVER_PIN}). Sentence: ${JSON.stringify(sentence)}`,
    );
  }
});

test('F5 (b) the false clause is gone, byte for byte', () => {
  assert.ok(
    !fetchDescription().includes('or a Socrata dataset URL is also accepted, and resolves against the server\'s configured portal'),
    'tools.ts:131 still says a Socrata dataset URL resolves against the server\'s configured portal',
  );
});

// --- (c) controls, green at base -----------------------------------------------

test('F5 (c) control: the bare 4x4 form is described as resolving against the configured portal', () => {
  const bare = sentences(fetchDescription()).filter((s) => /\bbare 4x4\b/i.test(s));
  assert.ok(bare.length > 0, 'the fetch description no longer mentions the bare 4x4 form');
  assert.ok(
    bare.some((s) => /configured portal/i.test(s)),
    `the bare 4x4 form must be said to resolve against the configured portal (${SERVER_PIN}): ${JSON.stringify(bare)}`,
  );
});

test('F5 (d) control: the skill text in the same prompt says the URL form names its portal — the two surfaces must agree', () => {
  const fetchLines = sentences(SOCRATA_SKILL_FALLBACK).filter((s) => /\bfetch\b/.test(s) && /\bURL\b/.test(s));
  assert.ok(fetchLines.length > 0, 'the skill fallback no longer describes fetch’s URL form — re-anchor');
  assert.ok(
    fetchLines.some((s) => URL_NAMES_ITS_OWN_PORTAL.test(s)),
    `socrata-skill.ts’s fetch sentence no longer says the URL form names its portal: ${JSON.stringify(fetchLines)}`,
  );
});

test('F5 (e) the instrument can fail: the pattern accepts the true wordings and rejects the false one', () => {
  for (const ok of [
    'A Socrata dataset URL is also accepted and names its own portal.',
    'a full dataset URL names its portal',
    'A dataset URL resolves against the hostname in the URL.',
    "A URL resolves against the URL's host, not the configured portal.",
  ]) {
    assert.match(ok, URL_NAMES_ITS_OWN_PORTAL, `must accept: ${ok}`);
  }
  assert.doesNotMatch(
    "A bare 4x4 dataset ID or a Socrata dataset URL is also accepted, and resolves against the server's configured portal.",
    URL_NAMES_ITS_OWN_PORTAL,
  );
});
