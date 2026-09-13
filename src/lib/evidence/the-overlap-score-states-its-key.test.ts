// A surface that shows a tool-overlap percentage also states the key that
// percentage was computed under (Wave N11 #434 P5, #430 F3).
//
// WHY. `toolCallOverlap` is the tool-call half of a consistency score, it is
// written into bytes this instance SIGNS, and what it means depends entirely
// on what counted as "the same tool call". #363 is the incident: a collapsing
// key made two runs that searched for different things score a Jaccard of 1,
// and a signed attestation reported "Tool overlap: 100%" and
// `highly_reproducible`. #402 wrote the rule down as a sentence
// (`TOOL_CALL_KEY_POLICY`) and put it beside the score in the dialog that
// creates an attestation — but `AttestationSection`, the surface every later
// reader sees, rendered the percentage and never the rule.
//
// WHAT THIS FILE ASSERTS, and against which universe.
//
//  1. PREMISES, so no assertion below can pass for an empty reason: the policy
//     is a real sentence, the dialog submits it inside the attestation `data`,
//     and the POST route stores that `data` at the TOP LEVEL of the package
//     the section later fetches. Without the third, the section could be
//     rendering a field the API path had already dropped.
//  2. BEHAVIOUR, driven: `describeToolCallKeyPolicy` over both shapes an
//     attestation can be in — one that stored the rule, and one written before
//     the field existed. The second must NOT be labelled with this build's
//     rule; it must say it does not state one.
//  3. A DERIVED SCAN, by SITE not by file (D10, and G26's lesson that a guard
//     asking whether a FILE mentions something cannot fail when one of two
//     sites regresses): every tracked non-test component that renders a
//     `toolCallOverlap` percentage carries at least as many key-policy render
//     sites as score sites. Its universe is every tracked `.tsx` under `src/`,
//     so a third surface showing the score is in scope the day it is written.
//
// WHY A SCAN AND NOT A RENDER. `npm test` runs `.ts` and `.mjs` and this
// repository has no component render harness, so a claim about a `.tsx`
// surface is made by driving the `.ts` it renders from — item 2 — or by a
// derived scan over the tree — item 3. The decision itself lives in
// `tool-call-identity.ts` precisely so item 2 can drive it.
//
// BLIND SPOT, stated: the scan reads source text, so it sees that a site
// exists, not that React mounted it. The conditional those two sites sit under
// is the same one, read at review time.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  TOOL_CALL_KEY_POLICY,
  TOOL_CALL_KEY_POLICY_UNRECORDED,
  describeToolCallKeyPolicy,
} from './tool-call-identity.ts';

const DIALOG = 'src/components/evidence/AttestationDialog.tsx';
const SECTION = 'src/components/evidence/AttestationSection.tsx';
const ROUTE = 'src/app/api/evidence/[slug]/attestations/route.ts';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Tracked files, so the universe is the repository's own answer to "what is
 *  in the tree" rather than this file's. */
function tracked(glob: string): string[] {
  return execFileSync('git', ['ls-files', '--', glob], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

// --- 1. Premises ------------------------------------------------------------

test('PREMISE: the key policy is a real sentence, not a token', () => {
  assert.ok(TOOL_CALL_KEY_POLICY.length > 40, TOOL_CALL_KEY_POLICY);
  assert.match(TOOL_CALL_KEY_POLICY, /refused/);
});

test('PREMISE: the dialog submits the policy inside the attestation data', () => {
  assert.match(read(DIALOG), /toolCallKeyPolicy:\s*TOOL_CALL_KEY_POLICY/);
});

test('PREMISE: the route stores the submitted data at the package top level', () => {
  // The section fetches the attestation package from its `storageKey` and
  // reads fields off the top level (`metrics`, `config`). The route builds
  // that package by spreading the submitted `data`, so a field the dialog
  // submits arrives where the section can read it. Asserted as a scan rather
  // than driven because the handler needs a database, a session and a blob
  // store; what is being pinned is the one line that decides the shape.
  const route = read(ROUTE);
  assert.match(route, /typeSpecific = data as Record<string, unknown>/);
  assert.match(route, /createdAt,\s*\n\s*\.\.\.typeSpecific,/);
});

test('PREMISE: the section reads the package it renders from that same blob', () => {
  const section = read(SECTION);
  assert.match(section, /fetch\(attestation\.storageKey\)/);
  assert.match(section, /toolCallOverlap/);
});

// --- 2. Behaviour, driven ---------------------------------------------------

test('an attestation that stored the rule states that rule', () => {
  const described = describeToolCallKeyPolicy({ toolCallKeyPolicy: TOOL_CALL_KEY_POLICY });
  assert.equal(described.recorded, true);
  assert.equal(described.text, TOOL_CALL_KEY_POLICY);
});

test('an attestation that stored no rule says so, and is not given this build\'s', () => {
  // The shape that must be able to fail: every consistency attestation
  // published before #402 is exactly this. Labelling it with the current
  // sentence would assert, on the reader's behalf, a fact its bytes do not
  // carry.
  for (const shape of [{}, { toolCallKeyPolicy: '' }, { toolCallKeyPolicy: '   ' }, { toolCallKeyPolicy: 42 }]) {
    const described = describeToolCallKeyPolicy(shape);
    assert.equal(described.recorded, false, JSON.stringify(shape));
    assert.notEqual(described.text, TOOL_CALL_KEY_POLICY, JSON.stringify(shape));
    assert.equal(described.text, TOOL_CALL_KEY_POLICY_UNRECORDED);
  }
  assert.match(TOOL_CALL_KEY_POLICY_UNRECORDED, /does not state/);
});

test('a rule some other producer wrote is stated as that producer wrote it', () => {
  // The whole point of reading the stored bytes: an attestation made under a
  // different rule must not be relabelled with ours.
  const other = 'Every request counts once, refused or answered.';
  assert.equal(describeToolCallKeyPolicy({ toolCallKeyPolicy: other }).text, other);
});

// --- 3. The derived scan ----------------------------------------------------

/** How many times a file renders the overlap as a percentage. */
function scoreSites(source: string): number {
  return [...source.matchAll(/toolCallOverlap\s*\*\s*100/g)].length;
}

/** How many times a file puts a key-policy sentence on screen. Counts render
 *  sites, not the import that makes one possible. */
function policySites(source: string): number {
  return [...source.matchAll(/\{\s*TOOL_CALL_KEY_POLICY\s*\}|describeToolCallKeyPolicy\s*\(/g)].length;
}

test('every surface that renders the overlap percentage also states the key', () => {
  const components = tracked('src/**/*.tsx').filter((f) => !f.includes('.test.'));
  const withScore = components
    .map((file) => ({ file, source: read(file) }))
    .map((f) => ({ ...f, score: scoreSites(f.source), policy: policySites(f.source) }))
    .filter((f) => f.score > 0);

  assert.ok(
    withScore.length >= 2,
    'PREMISE: the scan found fewer than two surfaces rendering the score, so it is not looking ' +
      `at the tree it thinks it is. Found: ${withScore.map((f) => f.file).join(', ') || 'none'}`,
  );

  const silent = withScore
    .filter((f) => f.policy < f.score)
    .map((f) => `${f.file} (${f.score} score site(s), ${f.policy} key-policy site(s))`);

  assert.deepEqual(
    silent,
    [],
    'These render a tool-overlap percentage without stating the key it was computed under. The ' +
      'number is a claim about reproducibility and the key is what decides what it means — ' +
      '#363 signed a 100% for two runs that read different data. Render ' +
      '`describeToolCallKeyPolicy(pkg).text` beside the score.',
  );
});
