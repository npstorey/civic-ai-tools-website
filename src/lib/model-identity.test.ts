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
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import canonicalize from 'canonicalize';
import {
  queryWithMcpStreaming,
  queryWithoutMcpStreaming,
  type StreamCallbacks,
} from './openrouter-streaming.ts';
import { modelIdentity } from './model-catalog.ts';
import {
  ModelNotOfferedError,
  modelIdentityForValue,
  resolveModel,
  resolveModelIdentity,
  _resetModelCatalogForTests,
} from './model-resolver.ts';
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

/** Point this process at the fake endpoint with the azure-shaped catalog. */
function configureFakeAzureInstance(baseUrl: string): void {
  process.env.MODEL_API_KIND = 'azure-openai';
  process.env.MODEL_API_BASE_URL = baseUrl;
  process.env.MODEL_API_VERSION = FAKE_API_VERSION;
  process.env.MODEL_API_KEY = FAKE_KEY;
  process.env.MODEL_CATALOG = AZURE_CATALOG;
  _resetDefaultModelClientForTests();
  _resetModelCatalogForTests();
}

/**
 * Run one MCP-shaped query against the fake endpoint and return its trace.
 *
 * `identity` defaults to what the catalog resolves for the offered id — the
 * correct path. It is a parameter so the P6 probe below can run the SAME
 * pipeline with the identity the tolerant resolver used to produce, which is
 * how the defect is reproduced rather than described.
 */
async function runTracedQuery(
  baseUrl: string,
  identity?: { endpointModel: string; declared: string },
): Promise<{
  trace: Record<string, unknown>;
  warnings: unknown[][];
  errors: string[];
}> {
  configureFakeAzureInstance(baseUrl);
  const model = identity ?? modelIdentity(resolveModel('fast'));

  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', { 'analysis.model': model.declared });

  const { callbacks, errors } = silentCallbacks();
  const warnings: unknown[][] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await queryWithMcpStreaming(
      'How many 311 noise complaints last year?',
      model,
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

// --- P6 F1: the cold read's probe, run both ways over canonical bytes ------
//
// WHAT WAS MEASURED, AND WHY IT IS RUN HERE. The cold read on the merged wave
// pointed `/api/compare-stream` at an azure-shaped catalog and named the
// DEPLOYMENT ALIAS as the request's `model`. The route resolved it tolerantly,
// the alias became its own "declared identity", the deployment answered, and
// the alias was signed: seven occurrences in the package's canonical JSON.
//
// The routes cannot be imported under `node --test` (they pull in
// `next/server`), so this reproduces the defect at the seam the routes call:
// the two resolvers. The tolerant one is what they used; the strict one is
// what they use now. Both halves run the same pipeline against the same fake
// endpoint and are asserted over the SERIALIZED canonical form, because a
// field-by-field check only finds leaks in fields somebody thought to check.

/** How many times a needle occurs in a string. Non-overlapping, exact. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function packageFrom(trace: Record<string, unknown>, model: string): string {
  const { pkg } = buildEvidencePackage({
    trace,
    prompt: 'How many 311 noise complaints last year?',
    output: 'Around 400,000.',
    toolCalls: [],
    model,
    portal: 'data.cityofnewyork.us',
    tokenUsage: { promptTokens: 11, completionTokens: 3 },
    promptVisibility: 'full_text',
    title: 'Test',
    summary: 'Test summary.',
    contentProfile: 'datHere',
  });
  return canonicalize(pkg) as string;
}

test('#30 P6 F1: the tolerant resolver DID sign a caller-named deployment alias', async () => {
  const server = await startFakeEndpoint();
  try {
    configureFakeAzureInstance(server.baseUrl);

    // What the compare routes used to do with a caller's `model` field. The
    // alias is not an offered id, so it was carried on BOTH sides — becoming
    // the wire string (correct, by accident) and the recorded identity (the
    // defect).
    const tolerant = modelIdentityForValue(DEPLOYMENT_NAME);
    assert.deepEqual(tolerant, {
      endpointModel: DEPLOYMENT_NAME,
      declared: DEPLOYMENT_NAME,
    });

    const { trace } = await runTracedQuery(server.baseUrl, tolerant);
    assert.ok(server.requests.length >= 1, 'the deployment answered — the request succeeded');

    const canonical = packageFrom(trace, tolerant.declared);
    const occurrences = countOccurrences(canonical, DEPLOYMENT_NAME);
    assert.ok(
      occurrences > 0,
      'this half exists to PIN the defect: the alias reaching canonical JSON',
    );
    // Named sites, so the count above is not the only thing standing between
    // this test and a silent change of shape.
    for (const marker of [
      `"model":"${DEPLOYMENT_NAME}"`,
      `"modelVersion":"${DEPLOYMENT_NAME}"`,
      `"gen_ai.request.model"`,
    ]) {
      assert.ok(canonical.includes(marker), `expected ${marker} in the counterfactual bytes`);
    }
  } finally {
    await server.close();
  }
});

test('#30 P6 F1: the strict resolver refuses it before any upstream call', async () => {
  const server = await startFakeEndpoint();
  try {
    configureFakeAzureInstance(server.baseUrl);

    // The same request, through the resolver both compare routes now use.
    assert.throws(
      () => resolveModelIdentity(DEPLOYMENT_NAME),
      (error: unknown) => {
        assert.ok(error instanceof ModelNotOfferedError);
        // The refusal names what IS offered, which is what makes it usable
        // without a second round trip. It does not echo an endpoint or a key.
        assert.match((error as Error).message, /is not offered by this instance/);
        assert.match((error as Error).message, /fast/);
        return true;
      },
    );

    // BEFORE ANY UPSTREAM CALL, measured rather than reasoned: the fake
    // endpoint recorded nothing. No deployment answered, so nothing was
    // billed, and there is no trace for a publish dialog to carry.
    assert.equal(server.requests.length, 0, 'nothing reached the endpoint');

    // And the offered id still resolves — the refusal is not a blanket one.
    assert.deepEqual(resolveModelIdentity('fast'), {
      endpointModel: DEPLOYMENT_NAME,
      declared: DECLARED_MODEL,
    });
  } finally {
    await server.close();
  }
});

test('#30 P6 F1: what the fixed path signs contains the identity and not the alias', async () => {
  const server = await startFakeEndpoint();
  try {
    // The positive control, over canonical bytes: a request naming the OFFERED
    // id — which is all the UI can send, since its selector lists /api/models
    // — carries the declared identity into the package and the alias into
    // nothing.
    const { trace } = await runTracedQuery(server.baseUrl);
    const canonical = packageFrom(trace, DECLARED_MODEL);

    assert.equal(countOccurrences(canonical, DEPLOYMENT_NAME), 0);
    assert.ok(countOccurrences(canonical, DECLARED_MODEL) > 0);
    assert.ok(canonical.includes(`"model":"${DECLARED_MODEL}"`));
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

test('gen_ai.system uses a well-known value where 1.30.0 has one', () => {
  // Default dialect at the built-in endpoint: `openrouter`. NOT one of the
  // fourteen well-known values in 1.30.0 — and kept anyway, because the same
  // document's rule for a system with no listed value is that "a custom value
  // MAY be used", and the provider's name in lowercase is what that produces.
  // It is also the value emitted before this phase, so the reference
  // instance's traces do not move on this attribute.
  assert.equal(getGenAiSystem(), 'openrouter');

  // OpenAI's own host: the well-known `openai`, which here is a statement
  // about the configuration rather than a guess about it.
  process.env.MODEL_API_BASE_URL = 'https://api.openai.com/v1';
  assert.equal(getGenAiSystem(), 'openai');

  // The azure dialect: the well-known `az.ai.openai`.
  process.env.MODEL_API_KIND = 'azure-openai';
  assert.equal(getGenAiSystem(), 'az.ai.openai');
});

// --- P6 F4: the correction, and the two premises behind it -----------------
//
// PREMISES, VERIFIED AGAINST THE DECLARED VERSION before this was written
// (v1.30.0 of the semantic conventions, `docs/gen-ai/gen-ai-spans.md`, read
// 2026-08-24 — the version `CIVICAITOOLS_TRACE_CONFIG` declares and every span
// carries as `otel.semconv.version`):
//
//   1. `gen_ai.system` is **Required** in the `span.gen_ai.client` table.
//      Omission — the first instinct, on the honest-omission precedent P3 set
//      for the model-agent description — is therefore not available.
//   2. Its well-known list is fourteen vendor names and does NOT include
//      `_OTHER`; that value is in the table for `error.type`. The escape the
//      document gives for this attribute is "otherwise, a custom value MAY be
//      used", plus, in the attribute's own note, "For custom model, a custom
//      friendly name SHOULD be used". (The note does also offer `_OTHER` as a
//      last resort "if none of these options apply" — a friendly custom name
//      applies here, so that last resort is not reached.)
//
// The defect: for ANY non-default OpenAI-compatible base URL the value was
// `openai`, so a self-hosted gateway's signed public traces named a vendor
// nobody configured. Semconv does sanction that reading for a client speaking
// OpenAI's protocol — but it sanctions it alongside `server.address`, which
// this app deliberately never records (a resource hostname is the deployer's
// infrastructure). With the disambiguating attribute absent by design, the
// vendor name stands alone and uncorrected, which is why the default-to-
// `openai` reading is the wrong one HERE.

test('#30 P6 F4: an unnameable endpoint gets the dialect, never a vendor', () => {
  // A self-hosted OpenAI-compatible gateway: nothing about this configuration
  // says OpenAI, so the span says what the operator declared — MODEL_API_KIND.
  process.env.MODEL_API_BASE_URL = 'https://gateway.example.net/v1';
  assert.equal(getGenAiSystem(), 'openai-compatible');
  assert.notEqual(getGenAiSystem(), 'openai');
  // Derived from configuration, not from an inference about the URL: the value
  // IS the declared dialect.
  assert.equal(getGenAiSystem(), process.env.MODEL_API_KIND ?? 'openai-compatible');

  // A lookalike host does not buy the vendor name either.
  process.env.MODEL_API_BASE_URL = 'https://api.openai.com.example.net/v1';
  assert.equal(getGenAiSystem(), 'openai-compatible');

  // …and neither does something unparseable as a URL.
  process.env.MODEL_API_BASE_URL = 'not-a-url';
  assert.equal(getGenAiSystem(), 'openai-compatible');
});

test('#30 P6 F4: `openai` survives exactly where the endpoint IS OpenAI', () => {
  for (const base of [
    'https://api.openai.com/v1',
    'https://api.openai.com',
    'https://API.OpenAI.com/v1/',
  ]) {
    process.env.MODEL_API_BASE_URL = base;
    assert.equal(getGenAiSystem(), 'openai');
  }
});

test('#30 P6 F4: the built-in default is unchanged, so reference bytes do not move', () => {
  // No MODEL_API_BASE_URL and no MODEL_API_KIND — the reference instance's
  // profile. This is the assertion that keeps F4 from being a bytes change on
  // the one instance whose bytes this sprint promised not to move.
  assert.equal(process.env.MODEL_API_BASE_URL, undefined);
  assert.equal(getGenAiSystem(), 'openrouter');
  process.env.MODEL_API_BASE_URL = 'https://openrouter.ai/api/v1';
  assert.equal(getGenAiSystem(), 'openrouter', 'the default written out explicitly is still the default');
});

test('#30 P6 F4: every value emitted is non-empty and names no host', () => {
  // `gen_ai.system` is Required, so whatever the configuration, a value must
  // come out — and it must never be the base URL itself, which is how a
  // resource hostname would reach a signed package by the back door.
  const profiles: [string, Record<string, string | undefined>][] = [
    ['built-in', {}],
    ['openai', { MODEL_API_BASE_URL: 'https://api.openai.com/v1' }],
    ['self-hosted', { MODEL_API_BASE_URL: 'https://gateway.example.net/v1' }],
    ['azure', { MODEL_API_KIND: 'azure-openai', MODEL_API_BASE_URL: 'https://example-resource.example.net' }],
  ];
  for (const [label, env] of profiles) {
    delete process.env.MODEL_API_KIND;
    delete process.env.MODEL_API_BASE_URL;
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    const value = getGenAiSystem();
    assert.ok(value && value.trim() !== '', `${label}: a Required attribute needs a value`);
    assert.ok(!value.includes('example.net'), `${label}: no hostname in the value`);
    assert.ok(!value.includes('://'), `${label}: no URL in the value`);
  }
});

// --- Criterion 4: `gen_ai.system` is on EVERY inference span ---------------

test('#30 P6 F4: every inference span carries gen_ai.system (measured on a trace)', async () => {
  const server = await startFakeEndpoint();
  try {
    const { trace } = await runTracedQuery(server.baseUrl);
    const inferenceSpans = spans(trace).filter((s) => s.name === 'llm_inference');
    assert.ok(inferenceSpans.length >= 1, 'the run should have produced an inference span');
    for (const span of inferenceSpans) {
      const value = attr(span, 'gen_ai.system');
      assert.ok(value, 'gen_ai.system is Required in the declared semconv version');
      assert.equal(value, 'az.ai.openai');
    }
  } finally {
    await server.close();
  }
});

test('#30 P6 F4: no inference span is started without gen_ai.system', () => {
  // The drift guard the trace test cannot give: a THIRD `llm_inference` span
  // added later without the attribute would not show up in a fixture that
  // never takes that branch. Both current sites are in this one file.
  const source = readFileSync(
    new URL('./openrouter-streaming.ts', import.meta.url),
    'utf8',
  );
  const starts = [...source.matchAll(/startSpan\('llm_inference'[\s\S]{0,240}?\}\)/g)];
  assert.ok(starts.length >= 2, 'both inference sites should be found');
  for (const match of starts) {
    assert.ok(
      match[0].includes("'gen_ai.system': getGenAiSystem()"),
      'an inference span without gen_ai.system breaks conformance with the declared version',
    );
  }
});
