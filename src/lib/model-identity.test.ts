// The split, end to end (civic-ai-tools-website#30 P3).
//
// P2 built a catalog that separates `endpointModel` — the string sent to the
// endpoint — from `model`, the identity a signed record asserts, and
// deliberately did NOT thread the first onto the wire, because doing so before
// the second had a home would have pushed an operator's deployment alias into
// signed output. This suite is the proof that the split happened and that it
// runs in both directions at once: one request, one package, two strings, each
// reaching exactly one audience.
//
// ENVIRONMENT OF VERIFICATION: every wire claim below is measured against a
// LOCAL FAKE HTTP SERVER under Node, in this repository's test runner, with a
// catalog supplied as an environment variable. None of it is a claim about a
// real Azure OpenAI resource — the fixture proves the request this app builds
// and the bytes it packages, not that any resource accepts either. Every
// hostname, key, deployment name and model id here is an obviously fake
// placeholder; the resource endpoint is a loopback address.
//
// Run with: npm test   (or: node --test --experimental-strip-types src/lib/model-identity.test.ts)

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import canonicalize from 'canonicalize';
import {
  queryWithMcpStreaming,
  queryWithoutMcpStreaming,
  type StreamCallbacks,
} from './openrouter-streaming.ts';
import { modelIdentity } from './model-catalog.ts';
import { resolveModel, _resetModelCatalogForTests } from './model-resolver.ts';
import { _resetDefaultModelClientForTests, getGenAiSystem } from './model-client.ts';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from './evidence/trace.ts';
import { buildEvidencePackage } from './evidence/packager.ts';

// --- Obviously fake fixtures ------------------------------------------------

const FAKE_KEY = 'azure-test-obviously-fake-key-do-not-use';
const FAKE_API_VERSION = '2099-01-01-preview';

/** The operator's private label for a resource. Must never be recorded. */
const DEPLOYMENT_NAME = 'example-deployment-alias';
/** What the operator declares that deployment actually is. Must be recorded. */
const DECLARED_MODEL = 'vendor/model-1';
/** What the fake endpoint reports back — deliberately neither of the above. */
const REPORTED_MODEL = 'vendor-model-1-2099-01-01';

const AZURE_CATALOG = JSON.stringify([
  {
    id: 'fast',
    name: 'Fast',
    provider: 'Example Vendor',
    supports_tools: true,
    endpointModel: DEPLOYMENT_NAME,
    model: DECLARED_MODEL,
    default: true,
    evaluator: 1,
  },
]);

// A fake instance identity, deliberately NOT the reference deployment's: this
// suite says nothing about where civicaitools.org runs.
const INSTANCE_IDENTITY_ENV: Record<string, string> = {
  EVIDENCE_KEY_ID: 'platform:test-suite-kid',
  EVIDENCE_SITE_ORIGIN: 'https://records.example.org',
  EVIDENCE_PLATFORM_AGENT_TITLE: 'Example Records',
  EVIDENCE_PLATFORM_AGENT_ID: 'example-records',
};

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'MODEL_API_KEY',
  'OPENROUTER_API_KEY',
  'MODEL_API_KIND',
  'MODEL_API_BASE_URL',
  'MODEL_API_VERSION',
  'MODEL_API_AUTH',
  'MODEL_CATALOG',
  'MODEL_CATALOG_PATH',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_VERSION',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  ...Object.keys(INSTANCE_IDENTITY_ENV),
];

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(INSTANCE_IDENTITY_ENV)) process.env[k] = v;
  _resetDefaultModelClientForTests();
  _resetModelCatalogForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetDefaultModelClientForTests();
  _resetModelCatalogForTests();
});

// --- The fake endpoint ------------------------------------------------------

interface CapturedRequest {
  url: string;
  headers: Record<string, string | undefined>;
  body: Record<string, unknown>;
}

/**
 * Answers a chat-completions request, streaming or not, and records what
 * arrived. `model` in every response is REPORTED_MODEL, which is the endpoint's
 * own claim about what answered — the one half of the pair this app does not
 * choose.
 */
async function startFakeEndpoint(): Promise<{
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push({
        url: req.url ?? '',
        headers: req.headers as Record<string, string | undefined>,
        body,
      });

      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (payload: Record<string, unknown>) =>
          `data: ${JSON.stringify({
            id: 'chatcmpl-fixture',
            object: 'chat.completion.chunk',
            created: 1,
            model: REPORTED_MODEL,
            ...payload,
          })}\n\n`;
        res.write(chunk({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] }));
        res.write(
          chunk({
            choices: [],
            usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
          }),
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-fixture',
          object: 'chat.completion',
          created: 1,
          model: REPORTED_MODEL,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Around 400,000.' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
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

function silentCallbacks(): { callbacks: StreamCallbacks; errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    callbacks: {
      onProgress: () => {},
      onToken: () => {},
      onComplete: () => {},
      onError: (_panel, message) => errors.push(message),
    },
  };
}

/** Run one MCP-shaped query against the fake endpoint and return its trace. */
async function runTracedQuery(baseUrl: string): Promise<{
  trace: Record<string, unknown>;
  warnings: unknown[][];
  errors: string[];
}> {
  process.env.MODEL_API_KIND = 'azure-openai';
  process.env.MODEL_API_BASE_URL = baseUrl;
  process.env.MODEL_API_VERSION = FAKE_API_VERSION;
  process.env.MODEL_API_KEY = FAKE_KEY;
  process.env.MODEL_CATALOG = AZURE_CATALOG;
  _resetDefaultModelClientForTests();
  _resetModelCatalogForTests();

  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', { 'analysis.model': DECLARED_MODEL });

  const { callbacks, errors } = silentCallbacks();
  const warnings: unknown[][] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await queryWithMcpStreaming(
      'How many 311 noise complaints last year?',
      modelIdentity(resolveModel('fast')),
      [],
      async () => {
        assert.fail('no tools are offered in this fixture');
      },
      'system prompt',
      callbacks,
      { builder, parentSpanId: builder.rootSpanId },
    );
  } finally {
    console.warn = realWarn;
  }
  builder.endRoot();
  return { trace: builder.finalize() as unknown as Record<string, unknown>, warnings, errors };
}

interface Span {
  name: string;
  attributes: { key: string; value: { stringValue?: string; intValue?: string } }[];
}

function spans(trace: Record<string, unknown>): Span[] {
  const resourceSpans = trace.resourceSpans as { scopeSpans: { spans: Span[] }[] }[];
  return resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans));
}

function attr(span: Span, key: string): string | undefined {
  const found = span.attributes.find((a) => a.key === key);
  return found?.value?.stringValue ?? found?.value?.intValue;
}

// --- Criterion 2: the wire gets `endpointModel` ----------------------------

test('WIRE (local fake, Node): the request carries the deployment name, never the declared identity', async () => {
  const server = await startFakeEndpoint();
  try {
    await runTracedQuery(server.baseUrl);

    assert.ok(server.requests.length >= 1, 'the fixture should have been called');
    for (const req of server.requests) {
      // Deployment-name routing: the alias is the path segment and the body's
      // `model`, exactly as P1 measured the SDK to emit.
      assert.equal(
        new URL(req.url, 'http://127.0.0.1').pathname,
        `/openai/deployments/${DEPLOYMENT_NAME}/chat/completions`,
      );
      assert.equal(req.body.model, DEPLOYMENT_NAME);
      // The negative half. An endpoint that received the declared identity
      // would answer 404 for a deployment that does not exist under that name.
      assert.notEqual(req.body.model, DECLARED_MODEL);
    }
  } finally {
    await server.close();
  }
});

// --- Criterion 3: both strings live in one signed artifact ------------------

test('TRACE (local fake, Node): the span records the declared identity AND what the endpoint reported', async () => {
  const server = await startFakeEndpoint();
  try {
    const { trace, warnings, errors } = await runTracedQuery(server.baseUrl);
    const inference = spans(trace).find((s) => s.name === 'llm_inference');
    assert.ok(inference, 'an llm_inference span should exist');

    // `gen_ai.request.model` is the DECLARED identity, not the wire string:
    // the trace is inside the signed package, so the rule that keeps a
    // deployment alias out of `cost.model` keeps it out of here too.
    assert.equal(attr(inference!, 'gen_ai.request.model'), DECLARED_MODEL);
    assert.notEqual(attr(inference!, 'gen_ai.request.model'), DEPLOYMENT_NAME);
    // …and the endpoint's own report sits beside it. Having both under one
    // signature is what lets a reader compare them without trusting either
    // party's summary of the other.
    assert.equal(attr(inference!, 'gen_ai.response.model'), REPORTED_MODEL);
    // The semconv-registered system value for this dialect (OTel 1.30.0, the
    // version CIVICAITOOLS_TRACE_CONFIG declares).
    assert.equal(attr(inference!, 'gen_ai.system'), 'az.ai.openai');

    // G0 D3: a mismatch warns and records both. It does NOT gate — the query
    // completed and reported no error.
    assert.deepEqual(errors, [], 'a mismatch must not surface as a stream error');
    const mismatchWarnings = warnings.filter((w) =>
      String(w[0]).includes('endpoint reported a different model'),
    );
    assert.ok(mismatchWarnings.length >= 1, 'a mismatch should warn server-side');
    assert.deepEqual(mismatchWarnings[0][1], {
      declared: DECLARED_MODEL,
      reported: REPORTED_MODEL,
    });
  } finally {
    await server.close();
  }
});

test('TRACE (local fake, Node): an agreeing endpoint is recorded without a warning', async () => {
  const server = await startFakeEndpoint();
  try {
    // Declare exactly what the fixture reports, so declared === reported.
    process.env.MODEL_API_KIND = 'azure-openai';
    process.env.MODEL_API_BASE_URL = server.baseUrl;
    process.env.MODEL_API_VERSION = FAKE_API_VERSION;
    process.env.MODEL_API_KEY = FAKE_KEY;
    process.env.MODEL_CATALOG = AZURE_CATALOG.replace(DECLARED_MODEL, REPORTED_MODEL);
    _resetDefaultModelClientForTests();
    _resetModelCatalogForTests();

    const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
    builder.startRoot('analysis', {});
    const { callbacks } = silentCallbacks();
    const warnings: unknown[][] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      await queryWithMcpStreaming(
        'q',
        modelIdentity(resolveModel('fast')),
        [],
        async () => assert.fail('no tools'),
        undefined,
        callbacks,
        { builder, parentSpanId: builder.rootSpanId },
      );
    } finally {
      console.warn = realWarn;
    }
    builder.endRoot();

    const inference = spans(builder.finalize() as unknown as Record<string, unknown>).find(
      (s) => s.name === 'llm_inference',
    );
    assert.equal(attr(inference!, 'gen_ai.response.model'), REPORTED_MODEL);
    assert.equal(
      warnings.filter((w) => String(w[0]).includes('endpoint reported a different model')).length,
      0,
    );
  } finally {
    await server.close();
  }
});

// --- Criteria 2 + 4: the package carries the identity and nothing else ------

test('PACKAGE (local fake, Node): declared identity reaches all three sites, and no alias or host reaches any of them', async () => {
  const server = await startFakeEndpoint();
  try {
    const { trace } = await runTracedQuery(server.baseUrl);

    const { pkg } = buildEvidencePackage({
      trace,
      prompt: 'How many 311 noise complaints last year?',
      output: 'Around 400,000.',
      toolCalls: [],
      // The declared identity is the only model string the packager is given —
      // it has no name for the other half. See PackageInput.model.
      model: DECLARED_MODEL,
      portal: 'data.cityofnewyork.us',
      tokenUsage: { promptTokens: 11, completionTokens: 3 },
      promptVisibility: 'full_text',
      title: 'Test',
      summary: 'Test summary.',
      contentProfile: 'datHere',
    });

    // E1 — cost.model.
    assert.equal(pkg.cost.model, DECLARED_MODEL);
    // E2 — environment.modelVersion, derived by the harness from the same input.
    const env = pkg.extensions?.['org.civicaitools.environment'] as Record<string, unknown>;
    assert.equal(env.modelVersion, DECLARED_MODEL);
    // E3 — the PROV-O model agent's title.
    const modelAgent = pkg.provenance!['@graph'].find((n) =>
      (n['@id'] as string).includes(':model:'),
    );
    assert.ok(modelAgent, 'a PROV model agent should exist');
    assert.equal(modelAgent!['dcterms:title'], DECLARED_MODEL);

    // E4 — the description is derived from the dialect, not spread from the
    // harness's reference constant, and names no vendor and no host.
    assert.equal(
      modelAgent!['dcterms:description'],
      'Large language model reached over a deployment-routed chat-completions API',
    );

    // Criterion 4, asserted over the SERIALIZED canonical form rather than
    // field by field — a field-by-field check can only find leaks in fields
    // somebody thought to check, and the trace is nested arbitrarily deep.
    const canonical = canonicalize(pkg) as string;
    const forbidden: [string, string][] = [
      [DEPLOYMENT_NAME, 'the deployment alias — an operator label for a resource'],
      ['127.0.0.1', 'the resource host'],
      [new URL(server.baseUrl).port, 'the resource port'],
      [FAKE_API_VERSION, 'the api-version'],
      [FAKE_KEY, 'the credential'],
      ['azure', 'the provider name'],
      ['Azure', 'the provider name'],
    ];
    for (const [needle, why] of forbidden) {
      assert.equal(
        canonical.includes(needle),
        false,
        `canonical JSON must not contain ${why} ("${needle}")`,
      );
    }

    // What IS present, deliberately: the semconv-registered API-family value.
    // `gen_ai.system` names the API a span talked to, which is disclosure of
    // method; it is a public vocabulary term, not the deployer's naming.
    assert.ok(canonical.includes('az.ai.openai'));
  } finally {
    await server.close();
  }
});

// --- Criterion 5: usage is requested, and absence stays absent -------------

test('WIRE (local fake, Node): a streamed request under the OpenAI dialect asks for usage', async () => {
  const server = await startFakeEndpoint();
  try {
    process.env.MODEL_API_BASE_URL = server.baseUrl;
    process.env.MODEL_API_KEY = 'openai-compatible-test-obviously-fake-key-do-not-use';
    _resetDefaultModelClientForTests();
    _resetModelCatalogForTests();

    const { callbacks, errors } = silentCallbacks();
    await queryWithoutMcpStreaming(
      'q',
      { endpointModel: 'vendor/model-1', declared: 'vendor/model-1' },
      undefined,
      callbacks,
    );

    assert.deepEqual(errors, []);
    assert.equal(server.requests.length, 1);
    const body = server.requests[0].body;
    assert.equal(body.stream, true);
    // Without this, a streaming response carries no `usage` object at all and
    // every published streamed answer records zero tokens used.
    assert.deepEqual(body.stream_options, { include_usage: true });
  } finally {
    await server.close();
  }
});

test('WIRE (local fake, Node): the azure dialect does NOT ask for usage — the parameter is api-version-gated', async () => {
  const server = await startFakeEndpoint();
  try {
    await runTracedQuery(server.baseUrl);
    for (const req of server.requests) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(req.body, 'stream_options'),
        false,
        'an api-version that does not know stream_options refuses the whole request',
      );
    }
  } finally {
    await server.close();
  }
});

// --- The dialect → gen_ai.system mapping, measured against semconv 1.30.0 ---

test('gen_ai.system uses a semconv-registered value where 1.30.0 has one', () => {
  // Default dialect at the built-in endpoint: `openrouter`. NOT registered in
  // 1.30.0 — and kept anyway, because semconv's own rule for a system with no
  // registered value is the provider's name in lowercase, and calling a router
  // `openai` would be less honest, not more. It is also the value emitted
  // before this phase, so the reference instance's traces do not move.
  assert.equal(getGenAiSystem(), 'openrouter');

  // Any other OpenAI-compatible endpoint: the registered `openai`.
  process.env.MODEL_API_BASE_URL = 'https://gateway.example.net/v1';
  assert.equal(getGenAiSystem(), 'openai');

  // The azure dialect: the registered `az.ai.openai`.
  process.env.MODEL_API_KIND = 'azure-openai';
  assert.equal(getGenAiSystem(), 'az.ai.openai');
});
