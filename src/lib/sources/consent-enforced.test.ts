// R6 W3 (#632), criterion 6: the consent gate is on. W2 shipped it dormant,
// on the owner's ruling, because no surface could yet ask a reader; W3 ships
// the surfaces that ask — the consent card on the home page, `/explore`,
// `/ask` and replay's dialog, the Sources panel and the dashboard's Sources
// tab — and turns the gate on in the same change. This pins the switch on,
// so it cannot be turned off by accident: a reader is asked before anything
// is sent anywhere (design §4.4). The routes' half is driven in
// `src/app/api/consent-gate-on-driven.test.ts`, with the switch as shipped.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** The switch's module (a specifier typed `string`, as W2's pin read it). */
const SWITCH: string = './consent-enforced.ts';

test('the consent gate is enforced: W3 ships the consent card, and the gate is on with it', async () => {
  const mod = (await import(SWITCH).catch(() => null)) as { CONSENT_GATE_ENFORCED?: unknown } | null;
  assert.ok(mod, `no switch: ${SWITCH} does not exist`);
  assert.equal(mod!.CONSENT_GATE_ENFORCED, true, 'the gate is off: a question would be sent before the reader is asked (#632 W3)');
});
