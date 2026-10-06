// #552 (anchor #555, P1) — SITE_SEAL_ONLY, driven: what the setting reads as,
// what each publish route's gate answers, and what the dialog and the
// dashboard are told.
//
// The decisions live in `seal-only.ts` and `site-config.ts#isSealOnly`, and
// are driven here through the same calls the routes and components make. The
// components are JSX, which `node --test` cannot parse, so for the dialog and
// the dashboard this is the driven half; where each caller sits, and that it
// passes what these tests pass, is pinned by source position in
// `src/app/api/seal-only-ordering.test.ts`. The two route handlers are also
// driven whole, in `src/app/api/seal-only-handlers-driven.test.ts`.
//
// WHAT MAKES THESE ABLE TO FAIL. Every "on" case is paired with the same
// request under every "off" value, so a gate that refuses regardless, or one
// that never refuses, fails one half. The setting is read through
// `process.env` exactly as the routes read it — not handed in as a literal —
// so a parser that disagreed with `parseBooleanFlag` would fail here too.
//
// Run with: npm test

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isSealOnly } from '../site-config.ts';
import { parseBooleanFlag } from '../host-routing.ts';
import { normalizeVisibility } from './visibility.ts';
import {
  SEAL_ONLY_CODE,
  SEAL_ONLY_STATUS,
  evaluateSealOnlyPublishGate,
  evaluateSealOnlyRecordsGate,
  publicStateAvailability,
  resolveRequestedVisibility,
  sealedRecordPublishAffordance,
} from './seal-only.ts';

const ON = ['1', 'true', 'TRUE', ' True ', ' 1 '];
const OFF: (string | undefined)[] = [undefined, '', ' ', '0', 'false', 'FALSE', 'yes', 'on', '2'];

afterEach(() => {
  delete process.env.SITE_SEAL_ONLY;
});

function withSetting<T>(value: string | undefined, run: () => T): T {
  if (value === undefined) delete process.env.SITE_SEAL_ONLY;
  else process.env.SITE_SEAL_ONLY = value;
  try {
    return run();
  } finally {
    delete process.env.SITE_SEAL_ONLY;
  }
}

/** What `POST /api/records` decides for a body's `visibility`, as the route calls it. */
function recordsGate(raw: unknown) {
  return evaluateSealOnlyRecordsGate(isSealOnly(), resolveRequestedVisibility(raw));
}

// Bodies, by what they ask for. `ABSENT` is a body with no `visibility` key.
const ABSENT = Symbol('absent');
const PUBLIC_REQUESTS: (string | typeof ABSENT)[] = ['public', 'published', ABSENT];
const SEALED_REQUESTS = ['sealed', 'committed'];
const raw = (v: string | typeof ABSENT) => (v === ABSENT ? undefined : v);
const label = (v: string | typeof ABSENT) => (v === ABSENT ? 'an absent visibility' : JSON.stringify(v));

test('#552: the setting is parsed exactly as SITE_PORTAL_LOCKED is', () => {
  for (const value of [...ON, ...OFF]) {
    withSetting(value, () => {
      assert.equal(isSealOnly(), parseBooleanFlag(value), `SITE_SEAL_ONLY=${JSON.stringify(value)}`);
    });
  }
  for (const value of ON) withSetting(value, () => assert.equal(isSealOnly(), true, `${JSON.stringify(value)} must read as on`));
  for (const value of OFF) withSetting(value, () => assert.equal(isSealOnly(), false, `${JSON.stringify(value)} must read as off`));
});

test('#552 C1: on, POST /api/records refuses "public", "published" and an absent visibility, with the stated reason and code', () => {
  for (const on of ON) {
    withSetting(on, () => {
      for (const request of PUBLIC_REQUESTS) {
        const refusal = recordsGate(raw(request));
        assert.ok(refusal, `SITE_SEAL_ONLY=${JSON.stringify(on)} accepted ${label(request)}`);
        assert.equal(refusal.status, SEAL_ONLY_STATUS);
        assert.equal(refusal.status, 403);
        assert.equal(refusal.body.code, SEAL_ONLY_CODE);
        assert.equal(refusal.body.code, 'seal_only');
        // The stated reason: what is off, the value this instance accepts
        // (ruling G0-3), why an absent value is caught, and what it does not
        // change.
        assert.match(refusal.body.error, /seals records only/);
        assert.match(refusal.body.error, /SITE_SEAL_ONLY/);
        assert.match(refusal.body.error, /visibility "sealed"/);
        assert.match(refusal.body.error, /omits visibility/);
        assert.match(refusal.body.error, /already public stay public/);
      }
    });
  }
});

test('#552 G0-3: an absent visibility is refused with the same reason as an explicit "public"', () => {
  withSetting('1', () => {
    const absent = recordsGate(undefined);
    assert.ok(absent, 'an absent visibility was not refused');
    assert.deepEqual(absent, recordsGate('public'));
    assert.deepEqual(recordsGate('published'), recordsGate('public'));
  });
});

test('#552 C1: on, POST /api/records still accepts "sealed" and "committed"', () => {
  for (const on of ON) {
    withSetting(on, () => {
      for (const request of SEALED_REQUESTS) {
        assert.equal(recordsGate(request), null, `SITE_SEAL_ONLY=${JSON.stringify(on)} refused ${JSON.stringify(request)}`);
      }
    });
  }
});

test('#552 C1: on, a value neither vocabulary accepts is left to the route\'s own 400', () => {
  withSetting('1', () => {
    for (const bogus of ['bogus', '', null, 1, 'PUBLIC']) {
      assert.equal(resolveRequestedVisibility(bogus), null, `${JSON.stringify(bogus)} resolved to a visibility`);
      assert.equal(recordsGate(bogus), null, `the seal-only gate answered ${JSON.stringify(bogus)}`);
    }
  });
});

test('#552 C1: on, POST /api/records/:slug/publish is refused with the stated reason and code', () => {
  for (const on of ON) {
    withSetting(on, () => {
      const refusal = evaluateSealOnlyPublishGate(isSealOnly());
      assert.ok(refusal, `SITE_SEAL_ONLY=${JSON.stringify(on)} let a publish through`);
      assert.equal(refusal.status, 403);
      assert.equal(refusal.body.code, 'seal_only');
      assert.match(refusal.body.error, /seals records only/);
      assert.match(refusal.body.error, /SITE_SEAL_ONLY/);
      assert.match(refusal.body.error, /stays sealed/);
      assert.match(refusal.body.error, /already public stay public/);
    });
  }
});

test('#552 C2: unset, "", "0" and "false" leave both routes as they are', () => {
  for (const off of OFF) {
    withSetting(off, () => {
      for (const request of [...PUBLIC_REQUESTS, ...SEALED_REQUESTS]) {
        assert.equal(recordsGate(raw(request)), null, `SITE_SEAL_ONLY=${JSON.stringify(off)} refused ${label(request)}`);
      }
      assert.equal(evaluateSealOnlyPublishGate(isSealOnly()), null, `SITE_SEAL_ONLY=${JSON.stringify(off)} refused a publish`);
    });
  }
});

test('#552 C2: the route\'s visibility resolution is the line it replaced, input for input', () => {
  // The line `POST /api/records` carried before this change.
  const before = (v: unknown) => (v === undefined ? 'public' : normalizeVisibility(v));
  for (const v of [undefined, 'public', 'published', 'sealed', 'committed', 'bogus', '', null, 0, 1, {}, 'Public']) {
    assert.equal(resolveRequestedVisibility(v), before(v), `the resolution of ${JSON.stringify(v)} changed`);
  }
});

test('#552 C3: on, the dialog\'s public choice is unavailable, with the reason; off, it is available', () => {
  for (const on of ON) {
    withSetting(on, () => {
      const choice = publicStateAvailability(isSealOnly());
      assert.equal(choice.available, false, `SITE_SEAL_ONLY=${JSON.stringify(on)} offered the public choice`);
      assert.ok(choice.explanation, 'no reason is given');
      assert.match(choice.explanation, /seals records only/);
      assert.match(choice.explanation, /already public stay public/);
      // Reader-facing copy speaks the reader's language, not the operator's.
      assert.doesNotMatch(choice.explanation, /SITE_SEAL_ONLY/);
    });
  }
  for (const off of OFF) {
    withSetting(off, () => {
      assert.deepEqual(publicStateAvailability(isSealOnly()), { available: true, explanation: null }, `SITE_SEAL_ONLY=${JSON.stringify(off)}`);
    });
  }
});

test('#552 C3: the dashboard shows Publish disabled with the reason when on, unchanged when off, and the unsigned tier first', () => {
  for (const on of ON) {
    withSetting(on, () => {
      const affordance = sealedRecordPublishAffordance({ signingConfigured: true, sealOnly: isSealOnly() });
      assert.equal(affordance.kind, 'seal_only', `SITE_SEAL_ONLY=${JSON.stringify(on)} offered Publish`);
      if (affordance.kind !== 'seal_only') return;
      assert.match(affordance.label, /^Publish unavailable/);
      assert.match(affordance.explanation, /seals records only/);
      assert.match(affordance.explanation, /already public stay public/);
      // The server refuses an unsigned instance with `unsigned_tier` first;
      // the dashboard says the same.
      assert.deepEqual(sealedRecordPublishAffordance({ signingConfigured: false, sealOnly: isSealOnly() }), { kind: 'unsigned' });
    });
  }
  for (const off of OFF) {
    withSetting(off, () => {
      assert.deepEqual(sealedRecordPublishAffordance({ signingConfigured: true, sealOnly: isSealOnly() }), { kind: 'available' });
      assert.deepEqual(sealedRecordPublishAffordance({ signingConfigured: false, sealOnly: isSealOnly() }), { kind: 'unsigned' });
    });
  }
});
