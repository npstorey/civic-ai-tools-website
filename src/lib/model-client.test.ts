// Tests for the endpoint-configuration layer and the request-path guard
// (#178, and the endpoint-generic model layer, website#30 P1).
//
// A fresh instance with no model API key must fail fast and typed — never
// hang. The factory stays lazy (no import-time validation); these tests cover
// the guard check, the typed construction failure (including the empty-string
// key the SDK constructor would otherwise silently accept), error
// classification, the two accepted credential names, and — on the wire,
// against a local fake server — what each dialect actually emits.
//
// ENVIRONMENT OF VERIFICATION: every wire claim below is verified against a
// LOCAL FAKE HTTP SERVER under Node, in this repository's test runner. None of
// it is a claim about a real Azure OpenAI resource: the fixture proves the
// request this app constructs, not that any resource accepts it.
//
// All key values are obviously fake fixtures.
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/model-client.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ModelConfigurationError,
  getMissingModelCredentialError,
  createModelClient,
  getModelClient,
  getModelApiBaseUrl,
  getModelApiKind,
  getModelApiAuth,
  classifyModelError,
  _resetDefaultModelClientForTests,
} from './model-client.ts';

const FAKE_KEY = 'sk-or-test-obviously-fake-key-do-not-use';
const FAKE_AZURE_KEY = 'azure-test-obviously-fake-key-do-not-use';
const FAKE_API_VERSION = '2099-01-01-preview';

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  // The credential, both accepted names.
  'MODEL_API_KEY',
  'OPENROUTER_API_KEY',
  // The endpoint settings this layer reads.
  'MODEL_API_KIND',
  'MODEL_API_BASE_URL',
  'MODEL_API_VERSION',
  'MODEL_API_AUTH',
  // Variables the SDK itself defaults from. Cleared so a developer's shell
  // cannot change what these tests measure.
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_VERSION',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
];

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

// --- The request-path guard (#178) -----------------------------------------

test('guard returns a typed error when the key is unset', () => {
  const err = getMissingModelCredentialError();
  assert.ok(err instanceof ModelConfigurationError);
  assert.equal(err!.code, 'model_not_configured');
  // The message names the canonical variable AND the prior-era name that is
  // still accepted, so an operator on either spelling reads an actionable fix.
  assert.match(err!.message, /MODEL_API_KEY/);
  assert.match(err!.message, /OPENROUTER_API_KEY/);
});

test('guard returns a typed error when the key is empty or whitespace', () => {
  process.env.MODEL_API_KEY = '';
  assert.ok(getMissingModelCredentialError() instanceof ModelConfigurationError);
  process.env.MODEL_API_KEY = '   ';
  assert.ok(getMissingModelCredentialError() instanceof ModelConfigurationError);
  delete process.env.MODEL_API_KEY;
  process.env.OPENROUTER_API_KEY = '';
  assert.ok(getMissingModelCredentialError() instanceof ModelConfigurationError);
  process.env.OPENROUTER_API_KEY = '   ';
  assert.ok(getMissingModelCredentialError() instanceof ModelConfigurationError);
});

test('guard returns null when a key is present', () => {
  process.env.MODEL_API_KEY = FAKE_KEY;
  assert.equal(getMissingModelCredentialError(), null);
  delete process.env.MODEL_API_KEY;
  // The prior-era name satisfies the guard on its own — nothing flips here.
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  assert.equal(getMissingModelCredentialError(), null);
});

test('createModelClient throws the typed error when no key resolves', () => {
  assert.throws(() => createModelClient(), ModelConfigurationError);
  // Empty string: the SDK constructor would accept this and send a blank
  // bearer token upstream — the typed throw must catch it too.
  process.env.MODEL_API_KEY = '';
  assert.throws(() => createModelClient(), ModelConfigurationError);
  delete process.env.MODEL_API_KEY;
  process.env.OPENROUTER_API_KEY = '';
  assert.throws(() => createModelClient(), ModelConfigurationError);
});

test('createModelClient accepts a per-call key even when the env is empty', () => {
  const client = createModelClient({ apiKey: FAKE_KEY });
  assert.ok(client);
});

test('getModelClient throws typed when unconfigured, builds once configured', () => {
  assert.throws(() => getModelClient(), ModelConfigurationError);
  process.env.MODEL_API_KEY = FAKE_KEY;
  _resetDefaultModelClientForTests();
  assert.ok(getModelClient());
});

test('classifyModelError distinguishes not-configured from auth-rejected', () => {
  assert.equal(classifyModelError(new ModelConfigurationError('x')), 'model_not_configured');
  // The SDK constructor's own message shape (belt and braces). Both the
  // OpenAI and the Azure constructor use this wording.
  assert.equal(
    classifyModelError(new Error('Missing credentials. Please pass an `apiKey`.')),
    'model_not_configured',
  );
  assert.equal(
    classifyModelError(
      new Error('Missing credentials. Please pass one of `apiKey` and `azureADTokenProvider`.'),
    ),
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

// --- The default dialect is untouched --------------------------------------

test('with no new variables set, the default endpoint resolves exactly as before', () => {
  assert.equal(getModelApiBaseUrl(), 'https://openrouter.ai/api/v1');
  assert.equal(getModelApiKind(), 'openai-compatible');
  assert.equal(getModelApiAuth(), 'bearer');
  // An explicit base URL still overrides it, dialect unchanged.
  process.env.MODEL_API_BASE_URL = 'https://gateway.example.net/v1';
  assert.equal(getModelApiBaseUrl(), 'https://gateway.example.net/v1');
  assert.equal(getModelApiKind(), 'openai-compatible');
});

// --- The two accepted credential names -------------------------------------

test('the credential resolves under either name, canonical winning when DEFINED', async () => {
  const server = await startCapturingServer();
  try {
    process.env.MODEL_API_BASE_URL = server.baseUrl;

    // Prior-era name alone answers.
    process.env.OPENROUTER_API_KEY = 'prior-era-obviously-fake-key';
    await createModelClient().chat.completions.create({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(server.requests.at(-1)!.headers.authorization, 'Bearer prior-era-obviously-fake-key');

    // Canonical name wins when both are set.
    process.env.MODEL_API_KEY = 'canonical-obviously-fake-key';
    await createModelClient().chat.completions.create({
      model: 'test/model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(server.requests.at(-1)!.headers.authorization, 'Bearer canonical-obviously-fake-key');

    // …and it wins even when DEFINED-but-empty, which is a refusal rather than
    // a fall-through. The rule mirrors src/lib/publisher-env.ts and
    // scripts/preflight-env.mjs exactly; a reader that disagreed with the
    // preflight would accept a configuration the other refuses.
    process.env.MODEL_API_KEY = '';
    assert.throws(() => createModelClient(), ModelConfigurationError);
  } finally {
    await server.close();
  }
});

// --- On the wire: what each dialect actually emits --------------------------
//
// Built from the request the SDK emits, captured — not from a description of
// it. The assertions below were written after standing this server and reading
// what arrived (openai@6.16.0, Node 22, macOS).

test('WIRE (local fake, Node): the default dialect sends bearer auth to the plain path', async () => {
  const server = await startCapturingServer();
  try {
    process.env.MODEL_API_BASE_URL = server.baseUrl;
    process.env.MODEL_API_KEY = FAKE_KEY;

    await createModelClient().chat.completions.create({
      model: 'test/model-slug',
      messages: [{ role: 'user', content: 'hi' }],
    });

    assert.equal(server.requests.length, 1);
    const req = server.requests[0];
    const url = new URL(req.url, 'http://127.0.0.1');
    assert.equal(url.pathname, '/chat/completions');
    assert.equal(url.searchParams.get('api-version'), null);
    assert.equal(req.headers.authorization, `Bearer ${FAKE_KEY}`);
    assert.equal(req.headers['api-key'], undefined);
    // The model slug rides in the body, not the path.
    assert.equal(JSON.parse(req.body).model, 'test/model-slug');
  } finally {
    await server.close();
  }
});

test('WIRE (local fake, Node): the azure dialect sends api-key auth, no Authorization, a deployment path and an api-version', async () => {
  const server = await startCapturingServer();
  try {
    process.env.MODEL_API_KIND = 'azure-openai';
    process.env.MODEL_API_BASE_URL = server.baseUrl;
    process.env.MODEL_API_VERSION = FAKE_API_VERSION;
    process.env.MODEL_API_KEY = FAKE_AZURE_KEY;

    await createModelClient().chat.completions.create({
      model: 'example-deployment',
      messages: [{ role: 'user', content: 'hi' }],
    });

    assert.equal(server.requests.length, 1);
    const req = server.requests[0];
    const url = new URL(req.url, 'http://127.0.0.1');

    // 1. Deployment-name routing: the `model` parameter becomes the path
    //    segment. This is what makes the deployment name the wire identity.
    assert.equal(url.pathname, '/openai/deployments/example-deployment/chat/completions');
    // 2. The api-version rides as a query parameter, not a header or a path.
    assert.equal(url.searchParams.get('api-version'), FAKE_API_VERSION);
    // 3. `api-key` header auth — and NO bearer token. Both halves matter: a
    //    client that sent both would leak the key to a second auth channel.
    assert.equal(req.headers['api-key'], FAKE_AZURE_KEY);
    assert.equal(req.headers.authorization, undefined);
    // 4. The body is unchanged, deployment name included as `model`.
    assert.equal(JSON.parse(req.body).model, 'example-deployment');
  } finally {
    await server.close();
  }
});

test('WIRE (local fake, Node): a resource endpoint written with a trailing slash or an /openai suffix resolves the same', async () => {
  const server = await startCapturingServer();
  try {
    process.env.MODEL_API_KIND = 'azure-openai';
    process.env.MODEL_API_VERSION = FAKE_API_VERSION;
    process.env.MODEL_API_KEY = FAKE_AZURE_KEY;

    for (const written of [`${server.baseUrl}/`, `${server.baseUrl}/openai`, `${server.baseUrl}/openai/`]) {
      process.env.MODEL_API_BASE_URL = written;
      await createModelClient().chat.completions.create({
        model: 'example-deployment',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const url = new URL(server.requests.at(-1)!.url, 'http://127.0.0.1');
      assert.equal(
        url.pathname,
        '/openai/deployments/example-deployment/chat/completions',
        `resource endpoint written as ${written}`,
      );
    }
  } finally {
    await server.close();
  }
});

// --- Every refusal is typed, names its variable, and precedes any call ------

test('an unrecognized MODEL_API_KIND is refused by name, before any upstream call', async () => {
  const server = await startCapturingServer();
  try {
    process.env.MODEL_API_BASE_URL = server.baseUrl;
    process.env.MODEL_API_KEY = FAKE_KEY;
    process.env.MODEL_API_KIND = 'anthropic-native';

    const guard = getMissingModelCredentialError();
    assert.ok(guard instanceof ModelConfigurationError);
    assert.match(guard!.message, /MODEL_API_KIND/);
    // The accepted values are named, so the fix does not require the docs.
    assert.match(guard!.message, /openai-compatible/);
    assert.match(guard!.message, /azure-openai/);

    assert.throws(() => createModelClient(), ModelConfigurationError);
    assert.throws(() => getModelClient(), ModelConfigurationError);
    assert.equal(server.requests.length, 0, 'nothing reached the endpoint');
  } finally {
    await server.close();
  }
});

test('azure-openai without MODEL_API_VERSION is refused by name, before any upstream call', async () => {
  const server = await startCapturingServer();
  try {
    process.env.MODEL_API_KIND = 'azure-openai';
    process.env.MODEL_API_BASE_URL = server.baseUrl;
    process.env.MODEL_API_KEY = FAKE_AZURE_KEY;
    // MODEL_API_VERSION deliberately unset.

    const guard = getMissingModelCredentialError();
    assert.ok(guard instanceof ModelConfigurationError);
    assert.equal(guard!.code, 'model_not_configured');
    assert.match(guard!.message, /MODEL_API_VERSION/);
    assert.match(guard!.message, /azure-openai/);

    assert.throws(() => createModelClient(), ModelConfigurationError);
    assert.equal(server.requests.length, 0, 'nothing reached the endpoint');

    // Empty and whitespace-only are absent too.
    process.env.MODEL_API_VERSION = '   ';
    assert.throws(() => createModelClient(), ModelConfigurationError);

    // Set, and the refusal lifts.
    process.env.MODEL_API_VERSION = FAKE_API_VERSION;
    assert.equal(getMissingModelCredentialError(), null);
  } finally {
    await server.close();
  }
});

test('azure-openai without MODEL_API_BASE_URL is refused by name — the built-in default is never borrowed', () => {
  process.env.MODEL_API_KIND = 'azure-openai';
  process.env.MODEL_API_VERSION = FAKE_API_VERSION;
  process.env.MODEL_API_KEY = FAKE_AZURE_KEY;

  const guard = getMissingModelCredentialError();
  assert.ok(guard instanceof ModelConfigurationError);
  assert.match(guard!.message, /MODEL_API_BASE_URL/);
  assert.throws(() => createModelClient(), ModelConfigurationError);
});

test('MODEL_API_AUTH derives from the kind, and an explicit contradiction is refused by name', () => {
  assert.equal(getModelApiAuth('openai-compatible'), 'bearer');
  assert.equal(getModelApiAuth('azure-openai'), 'api-key');

  process.env.MODEL_API_AUTH = 'bearer';
  assert.equal(getModelApiAuth('openai-compatible'), 'bearer');
  assert.throws(
    () => getModelApiAuth('azure-openai'),
    (err: unknown) =>
      err instanceof ModelConfigurationError &&
      /MODEL_API_AUTH/.test(err.message) &&
      /MODEL_API_KIND/.test(err.message),
  );
});

test('MODEL_API_AUTH=entra is reserved in the enum with no code behind it', () => {
  process.env.MODEL_API_AUTH = 'entra';
  assert.throws(
    () => getModelApiAuth('azure-openai'),
    (err: unknown) =>
      err instanceof ModelConfigurationError &&
      /MODEL_API_AUTH/.test(err.message) &&
      /reserved/i.test(err.message),
  );
  // An unrecognized value is a different refusal, and names the enum.
  process.env.MODEL_API_AUTH = 'basic';
  assert.throws(
    () => getModelApiAuth('openai-compatible'),
    (err: unknown) => err instanceof ModelConfigurationError && /MODEL_API_AUTH/.test(err.message),
  );
});

// --- Fake endpoint -----------------------------------------------------------

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: string;
}

/**
 * A local HTTP server that records every inbound request and answers with a
 * minimal chat-completion body. Bound to 127.0.0.1 on an ephemeral port: it
 * never leaves the machine and reads nothing from the environment.
 */
async function startCapturingServer(): Promise<{
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers as Record<string, string | undefined>,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-fixture',
          object: 'chat.completion',
          created: 1,
          model: 'fixture',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
