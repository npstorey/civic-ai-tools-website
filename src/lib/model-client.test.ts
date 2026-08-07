// Tests for the request-path model-credential guard (#178).
//
// A fresh instance with no model API key must fail fast and typed — never
// hang. The factory stays lazy (no import-time validation); these tests cover
// the guard check, the typed construction failure (including the empty-string
// key the SDK constructor would otherwise silently accept), and error
// classification. All key values are obviously fake fixtures.
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/model-client.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelConfigurationError,
  getMissingModelCredentialError,
  createModelClient,
  getModelClient,
  classifyModelError,
  _resetDefaultModelClientForTests,
} from './model-client.ts';

const FAKE_KEY = 'sk-or-test-obviously-fake-key-do-not-use';

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'MODEL_API_BASE_URL'];

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  _resetDefaultModelClientForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetDefaultModelClientForTests();
});

test('guard returns a typed error when the key is unset', () => {
  const err = getMissingModelCredentialError();
  assert.ok(err instanceof ModelConfigurationError);
  assert.equal(err!.code, 'model_not_configured');
  assert.match(err!.message, /OPENROUTER_API_KEY/);
});

test('guard returns a typed error when the key is empty or whitespace', () => {
  process.env.OPENROUTER_API_KEY = '';
  assert.ok(getMissingModelCredentialError() instanceof ModelConfigurationError);
  process.env.OPENROUTER_API_KEY = '   ';
  assert.ok(getMissingModelCredentialError() instanceof ModelConfigurationError);
});

test('guard returns null when a key is present', () => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  assert.equal(getMissingModelCredentialError(), null);
});

test('createModelClient throws the typed error when no key resolves', () => {
  assert.throws(() => createModelClient(), ModelConfigurationError);
  // Empty string: the SDK constructor would accept this and send a blank
  // bearer token upstream — the typed throw must catch it too.
  process.env.OPENROUTER_API_KEY = '';
  assert.throws(() => createModelClient(), ModelConfigurationError);
});

test('createModelClient accepts a per-call key even when the env is empty', () => {
  const client = createModelClient({ apiKey: FAKE_KEY });
  assert.ok(client);
});

test('getModelClient throws typed when unconfigured, builds once configured', () => {
  assert.throws(() => getModelClient(), ModelConfigurationError);
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  _resetDefaultModelClientForTests();
  assert.ok(getModelClient());
});

test('classifyModelError distinguishes not-configured from auth-rejected', () => {
  assert.equal(classifyModelError(new ModelConfigurationError('x')), 'model_not_configured');
  // The SDK constructor's own message shape (belt and braces).
  assert.equal(
    classifyModelError(new Error('Missing credentials. Please pass an `apiKey`.')),
    'model_not_configured',
  );
  // Upstream auth rejections carry a status on the SDK's APIError.
  assert.equal(classifyModelError({ status: 401, message: '401 Invalid API key' }), 'model_auth_rejected');
  assert.equal(classifyModelError({ status: 403, message: 'Forbidden' }), 'model_auth_rejected');
  // Everything else keeps its existing handling.
  assert.equal(classifyModelError({ status: 500, message: 'Internal' }), null);
  assert.equal(classifyModelError(new Error('fetch failed')), null);
  assert.equal(classifyModelError(null), null);
});
