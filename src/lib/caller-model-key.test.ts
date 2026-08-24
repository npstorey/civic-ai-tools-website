// The caller-supplied model key on the replay and evaluate routes
// (civic-ai-tools-website#30 P4, G0 D7).
//
// WHAT THESE GUARD. `modelApiKey` is the canonical wire field and
// `openRouterApiKey` is its prior-era name, accepted INDEFINITELY — the same
// migration class as `/api/evidence/*` beside `/api/records/*`, and explicitly
// not an expand-then-flip. There is therefore a test here for something that
// is normally invisible: that nothing warns, deprecates, or errors on the old
// name. A rename with a permanent alias fails silently in exactly that
// direction — someone "finishes" it later — so the promise is pinned rather
// than left in a comment.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CALLER_MODEL_KEY_FIELD,
  CALLER_MODEL_KEY_PRIOR_ERA_FIELD,
  CALLER_MODEL_KEY_REJECTED_MESSAGE,
  CALLER_MODEL_RATE_LIMITED_MESSAGE,
  callerModelKeyFailure,
  resolveCallerModelKey,
} from './caller-model-key.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

const OBVIOUSLY_FAKE_KEY = 'caller-supplied-obviously-fake-key';
const OTHER_FAKE_KEY = 'a-second-obviously-fake-key';

// --- Both names, and the precedence between them ---------------------------

test('CALLER KEY: the canonical field name is accepted', () => {
  const r = resolveCallerModelKey({ [CALLER_MODEL_KEY_FIELD]: OBVIOUSLY_FAKE_KEY });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.apiKey, OBVIOUSLY_FAKE_KEY);
  assert.equal(r.ok && r.field, 'modelApiKey');
});

test('CALLER KEY: the prior-era field name is accepted, and is not deprecated', () => {
  const r = resolveCallerModelKey({ [CALLER_MODEL_KEY_PRIOR_ERA_FIELD]: OBVIOUSLY_FAKE_KEY });
  assert.equal(r.ok, true, 'the old field still works');
  assert.equal(r.ok && r.apiKey, OBVIOUSLY_FAKE_KEY);
  assert.equal(r.ok && r.field, 'openRouterApiKey');
});

test('CALLER KEY: both set prefers the canonical name', () => {
  const r = resolveCallerModelKey({
    [CALLER_MODEL_KEY_PRIOR_ERA_FIELD]: OTHER_FAKE_KEY,
    [CALLER_MODEL_KEY_FIELD]: OBVIOUSLY_FAKE_KEY,
  });
  assert.equal(r.ok && r.apiKey, OBVIOUSLY_FAKE_KEY);
  assert.equal(r.ok && r.field, 'modelApiKey');
});

test('CALLER KEY: precedence is by DEFINED, not by truthy — mirroring the env-side rule', () => {
  // `model-client.ts` and `publisher-env.ts` both resolve a two-name variable
  // this way. Reaching past a defined-but-empty canonical field to the other
  // one would authenticate with a key the caller did not nominate.
  const r = resolveCallerModelKey({
    [CALLER_MODEL_KEY_FIELD]: '',
    [CALLER_MODEL_KEY_PRIOR_ERA_FIELD]: OBVIOUSLY_FAKE_KEY,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /modelApiKey/);
});

// --- Refusals --------------------------------------------------------------

test('CALLER KEY: a body with neither name is refused, naming both', () => {
  const r = resolveCallerModelKey({ evaluatorModel: 'example/model' });
  assert.equal(r.ok, false);
  const error = r.ok ? '' : r.error;
  assert.match(error, /modelApiKey/);
  assert.match(error, /openRouterApiKey/);
});

test('CALLER KEY: the refusal says which key is wanted, without naming a vendor', () => {
  const r = resolveCallerModelKey({});
  const error = r.ok ? '' : r.error;
  assert.match(error, /model API key/i);
  assert.match(error, /endpoint this instance is configured to call/i);
  // The whole point of the rename: the copy must not tell a caller to fetch a
  // key from a service this instance may never contact. The prior-era FIELD
  // name is spelled out (a caller integrating against it needs to see it named
  // and unretired), so the check is against everything else — a vendor
  // mentioned as a place to get a key, rather than as a JSON key.
  const withoutFieldNames = error.split(CALLER_MODEL_KEY_PRIOR_ERA_FIELD).join('');
  assert.doesNotMatch(withoutFieldNames, /OpenRouter/i);
});

test('CALLER KEY: non-string and whitespace-only values are refused, not coerced', () => {
  for (const bad of [123, null, true, {}, [], '   ']) {
    const r = resolveCallerModelKey({ [CALLER_MODEL_KEY_FIELD]: bad });
    assert.equal(r.ok, false, `refused: ${JSON.stringify(bad)}`);
  }
});

test('CALLER KEY: a non-object body is refused rather than throwing', () => {
  for (const bad of [null, undefined, 'a string', 42]) {
    const r = resolveCallerModelKey(bad);
    assert.equal(r.ok, false, `refused: ${JSON.stringify(bad)}`);
  }
});

// --- The permanent-alias promise, pinned -----------------------------------

test('CALLER KEY: nothing warns or deprecates the prior-era field (G0 D7)', () => {
  const source = readFileSync(join(SRC, 'lib/caller-model-key.ts'), 'utf8');
  const executable = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/console\.warn/.test(executable), 'no deprecation warning is emitted');
  assert.ok(!/deprecat/i.test(executable), 'nothing in the code path calls it deprecated');
});

test('CALLER KEY: both routes resolve the field through this module, not by hand', () => {
  // A second hand-rolled copy of the two-name rule is how the promise above
  // gets half-kept. Neither route may destructure either field directly.
  for (const route of [
    'app/api/evidence/[slug]/replay/route.ts',
    'app/api/evidence/[slug]/evaluate/route.ts',
  ]) {
    const source = readFileSync(join(SRC, route), 'utf8');
    assert.ok(
      source.includes('resolveCallerModelKey'), `${route} uses the shared resolver`,
    );
    assert.ok(
      !/const\s*\{[^}]*openRouterApiKey/.test(source),
      `${route} does not destructure the prior-era field itself`,
    );
    assert.ok(
      !/const\s*\{[^}]*\bmodelApiKey/.test(source),
      `${route} does not destructure the canonical field itself`,
    );
  }
});

test('CALLER KEY: the dialog sends the canonical field name', () => {
  const source = readFileSync(join(SRC, 'components/evidence/AttestationDialog.tsx'), 'utf8');
  const bodies = source.match(/JSON\.stringify\(\{\s*\w+ApiKey[^)]*\)/g) ?? [];
  assert.equal(bodies.length, 2, 'the replay call and the evaluate call');
  for (const body of bodies) {
    assert.ok(body.includes('modelApiKey'), `sends the canonical name: ${body}`);
    assert.ok(!body.includes('openRouterApiKey'), `does not send the prior-era name: ${body}`);
  }
});

// --- Upstream failures, scoped to the caller's key --------------------------

test('CALLER KEY: an upstream 401 answers 401 with copy addressed to the caller', () => {
  const f = callerModelKeyFailure('model_auth_rejected');
  assert.equal(f?.status, 401);
  assert.equal(f?.error, CALLER_MODEL_KEY_REJECTED_MESSAGE);
  assert.equal(f?.code, 'model_auth_rejected');
  // Not the operator-facing copy: the key here is the caller's, so pointing at
  // a server environment variable would send them somewhere they cannot go.
  assert.doesNotMatch(f!.error, /MODEL_API_KEY/);
  assert.match(f!.error, /key you supplied/i);
});

test('CALLER KEY: an upstream 429 answers 502, never 429 (G0 D6)', () => {
  const f = callerModelKeyFailure('model_rate_limited');
  assert.equal(f?.code, 'model_rate_limited');
  assert.equal(f?.error, CALLER_MODEL_RATE_LIMITED_MESSAGE);
  // A 429 from this app means THIS app's per-day limiter. Answering 429 for an
  // upstream limit would recreate on the HTTP layer the exact confusion the
  // new kind exists to end.
  assert.notEqual(f?.status, 429);
  assert.equal(f?.status, 502);
  assert.match(f!.error, /not a limit set by this site/i);
});

test('CALLER KEY: model_not_configured and an unclassified error get no special answer', () => {
  assert.equal(callerModelKeyFailure('model_not_configured'), null);
  assert.equal(callerModelKeyFailure(null), null);
});

test('CALLER KEY: neither upstream message is a raw error string', () => {
  // The rule from #154, applied to these two JSON routes: no status code, no
  // server name, no upstream prose.
  for (const copy of [CALLER_MODEL_KEY_REJECTED_MESSAGE, CALLER_MODEL_RATE_LIMITED_MESSAGE]) {
    for (const fragment of ['429', '401', '403', '502', 'econnrefused', 'stack', 'undefined']) {
      assert.ok(!copy.toLowerCase().includes(fragment), `copy leaks "${fragment}": ${copy}`);
    }
  }
});
