// THROWAWAY — Wave N11 (#434) P6's red, part 2. Not for merge.
//
// Part 1 of this branch put the N10 defect back in the replay route and CI was
// GREEN (run 34757822135, `# pass 1554 / # fail 0`). This file is the other
// half: an assertion that CATCHES it, so the green above is shown to be a
// coverage gap and not an absence of defects.
//
// WHAT THE COMMITTED GUARD ACTUALLY ASSERTS. `replay-portal.test.ts:121-132`
// reads the route as TEXT and asks two things: that no literal
// `data.cityofnewyork.us` appears, and that the string
// `replayPortalForPackage(` does. A route that calls the derivation and then
// ignores what it returned satisfies both. The derivation itself is well
// covered — `replay-portal-is-addressable.test.ts` drives it behaviourally and
// reddens on five assertions if the aggregate filter is removed there — so the
// gap is not the function. It is the route's USE of the function, which no
// test drives at all.
//
// WHY THIS IS STILL A SOURCE SCAN AND NOT A DRIVEN CALL. `node --test` cannot
// invoke a Next route handler, and the route's portal decision is not
// extractable without changing the route — which is P6's job, not this
// instrument's. So this asserts the one property a scan CAN establish
// honestly: the value the route derives is the value it uses. The real fix is
// to lift that decision into a `.ts` the suite can drive; this red only has to
// show that today nothing would notice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROUTE_PATH = fileURLToPath(
  new URL('../../app/api/evidence/[slug]/replay/route.ts', import.meta.url),
);

/** Comments blanked in place, newlines preserved, so a line number stays true
 *  and a `??` inside a docstring is not read as code. */
function code(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank);
}

const ROUTE = code(readFileSync(ROUTE_PATH, 'utf8'));

test('PREMISE: the route reads its portal from replayPortalForPackage', () => {
  assert.match(ROUTE, /replayPortalForPackage\s*\(/, 'the route calls the derivation at all');
  assert.doesNotMatch(
    ROUTE,
    /['"]data\.cityofnewyork\.us['"]/,
    'and names no literal portal — both of the committed guard\'s textual checks pass here, ' +
      'which is the point: they pass on the defective route too',
  );
});

test('RED: the portal the route DERIVES is the portal the route USES', () => {
  // Find the binding the derivation's result is assigned to, then check that
  // nothing coalesces, reassigns or shadows it before it is handed on.
  const assignment = ROUTE.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*replayPortalForPackage\s*\([^)]*\)\s*;/);
  assert.ok(assignment, 'the derivation\'s result must be bound to a name');
  const derivedName = assignment![1];

  // Any `?? …` or `|| …` applied to that name is a fallback around the
  // derivation — the shape #432 exists to forbid, and the shape the N10
  // defect took.
  const coalesced = new RegExp(`\\b${derivedName}\\b\\s*(\\?\\?|\\|\\|)`);
  assert.doesNotMatch(
    ROUTE,
    coalesced,
    `the route binds the derivation to \`${derivedName}\` and then falls back around it. ` +
      'A record that named no portal is supposed to replay with nothing injected; a fallback ' +
      'here hands a replay a host the record never addressed — an aggregate endpoint, in the ' +
      'N10 case — and the replay\'s arguments are what a SIGNED consistency attestation is ' +
      'computed over.',
  );

  // And the name that reaches the loop must be the derived one, not a second
  // binding computed from it.
  const handedOn = ROUTE.match(/portal\s*[,:]/g) ?? [];
  assert.ok(handedOn.length >= 1, 'PREMISE: a `portal` is handed on somewhere in this route');
  assert.equal(
    derivedName,
    'portal',
    `the derivation is bound to \`${derivedName}\` but the route hands on \`portal\` — two ` +
      'names for what should be one value, which is how a fallback gets between them.',
  );
});
