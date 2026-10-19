// R6 W2 (#632), the owner's ruling: the consent gate ships dormant, and only
// W3, which ships the consent card, turns it on. This pins the switch, so it
// cannot flip by accident before then: a commit that turns it on fails here,
// and the one that should (W3's) changes this test in the same commit.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** The module the dormant gate adds (a specifier typed `string`, so the red commit type-checks). */
const SWITCH: string = './consent-enforced.ts';

test('the consent gate is not enforced until W3 ships the consent card', async () => {
  const mod = (await import(SWITCH).catch(() => null)) as { CONSENT_GATE_ENFORCED?: unknown } | null;
  assert.ok(mod, `no switch: ${SWITCH} does not exist`);
  assert.equal(mod!.CONSENT_GATE_ENFORCED, false, 'W3 turns the gate on with the consent card (#632)');
});
