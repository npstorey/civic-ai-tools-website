// A catalog entry's request settings (#548): `reasoningEffort` and
// `tokenLimitParameter`, their validation, the rule that names the token
// limit, and how they ride on the identity pair to every call site.
//
// ENVIRONMENT OF VERIFICATION. In-process under Node, against `process.env`;
// no model endpoint. What each request actually SENDS, at every call site and
// under both dialects, is measured on the wire in
// `model-request-settings-driven.test.ts`. Test names carry their scope, as in
// `model-catalog.test.ts`:
//   CATALOG:  pure schema facts, no environment read.
//   INSTANCE: resolved through `process.env`, with the memo reset per case.
//
// Run with: npm test

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_CATALOG,
  REASONING_EFFORTS,
  TOKEN_LIMIT_PARAMETERS,
  carriedModelIdentity,
  modelIdentity,
  modelRequestParameters,
  modelRequestSettings,
  projectServedModel,
  summaryDraftTokenLimit,
  validateCatalog,
  type CatalogEntry,
  type ModelRequestSettings,
} from './model-catalog.ts';
import {
  _resetModelCatalogForTests,
  getOfferedModels,
  getSummarizerModel,
  modelIdentityForDeclared,
  modelIdentityForValue,
  resolveModel,
  resolveModelIdentity,
} from './model-resolver.ts';
import { ModelConfigurationError } from './model-client.ts';

const ENV_KEYS = ['MODEL_CATALOG', 'MODEL_CATALOG_PATH', 'MODEL_API_BASE_URL', 'MODEL_API_KIND', 'MODEL_API_VERSION'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  _resetModelCatalogForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  _resetModelCatalogForTests();
});

/** One well-formed entry, plus whatever a case adds to it. */
function entry(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'reasoner',
    name: 'Reasoning Model',
    provider: 'Example Provider',
    supports_tools: true,
    endpointModel: 'example-reasoning-deployment',
    model: 'vendor/reasoning-model-1',
    default: true,
    evaluator: 1,
    ...extra,
  };
}

function validate(document: unknown, kind: 'openai-compatible' | 'azure-openai' = 'azure-openai') {
  return validateCatalog(document, { source: 'MODEL_CATALOG', kind });
}

// --- Validation: refused at parse, naming the entry --------------------------

test('CATALOG: every value the SDK accepts as reasoning_effort is accepted, on both dialects', () => {
  for (const kind of ['openai-compatible', 'azure-openai'] as const) {
    for (const value of REASONING_EFFORTS) {
      const result = validate([entry({ reasoningEffort: value })], kind);
      assert.equal(result.ok, true, `${kind}: "${value}" should be accepted: ${JSON.stringify(result)}`);
    }
    for (const value of TOKEN_LIMIT_PARAMETERS) {
      const result = validate([entry({ tokenLimitParameter: value })], kind);
      assert.equal(result.ok, true, `${kind}: "${value}" should be accepted: ${JSON.stringify(result)}`);
    }
  }
  assert.deepEqual([...REASONING_EFFORTS], ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
});

test('CATALOG: a reasoningEffort outside the set is refused, naming the entry, the field and the accepted values', () => {
  for (const value of ['maximum', 'None', 'off', '', 0, false, null, {}, ['none']]) {
    const result = validate([entry({ reasoningEffort: value })]);
    assert.equal(result.ok, false, `${JSON.stringify(value)} should be refused`);
    const { message } = result as { message: string };
    assert.match(message, /entry "reasoner"/);
    assert.match(message, /"reasoningEffort"/);
    assert.match(message, /none, minimal, low, medium, high, xhigh/);
  }
});

test('CATALOG: a tokenLimitParameter outside the set is refused, naming the entry, the field and the accepted values', () => {
  for (const value of ['max_output_tokens', 'maxTokens', 'MAX_TOKENS', '', 4000, null]) {
    const result = validate([entry({ tokenLimitParameter: value })]);
    assert.equal(result.ok, false, `${JSON.stringify(value)} should be refused`);
    const { message } = result as { message: string };
    assert.match(message, /entry "reasoner"/);
    assert.match(message, /"tokenLimitParameter"/);
    assert.match(message, /max_tokens, max_completion_tokens/);
  }
});

test('CATALOG: a misspelt field name is refused as unknown, not ignored', () => {
  const result = validate([entry({ reasoning_effort: 'none' })]);
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /unknown field "reasoning_effort"/);
});

test('INSTANCE: an unknown value is refused when the catalog is read, before any upstream call', () => {
  process.env.MODEL_API_KIND = 'azure-openai';
  process.env.MODEL_API_BASE_URL = 'https://example-resource.example.net';
  process.env.MODEL_API_VERSION = '2024-12-01-preview';
  process.env.MODEL_CATALOG = JSON.stringify([entry({ reasoningEffort: 'maximum' })]);
  assert.throws(
    () => resolveModel('reasoner'),
    (error: unknown) =>
      error instanceof ModelConfigurationError &&
      /entry "reasoner"/.test(error.message) &&
      /"reasoningEffort"/.test(error.message),
  );
});

// --- The rule that names the token limit -------------------------------------

test('CATALOG: the token-limit rule — explicit wins, then any reasoning setting, then max_tokens', () => {
  const cases: Array<[ModelRequestSettings | undefined, Record<string, unknown>]> = [
    [undefined, { max_tokens: 300 }],
    [{}, { max_tokens: 300 }],
    [{ reasoningEffort: 'none' }, { max_completion_tokens: 300, reasoning_effort: 'none' }],
    [{ reasoningEffort: 'high' }, { max_completion_tokens: 300, reasoning_effort: 'high' }],
    [{ tokenLimitParameter: 'max_completion_tokens' }, { max_completion_tokens: 300 }],
    [{ tokenLimitParameter: 'max_tokens' }, { max_tokens: 300 }],
    // Explicit wins over the derivation, in both directions.
    [{ tokenLimitParameter: 'max_tokens', reasoningEffort: 'none' }, { max_tokens: 300, reasoning_effort: 'none' }],
    [
      { tokenLimitParameter: 'max_completion_tokens', reasoningEffort: 'low' },
      { max_completion_tokens: 300, reasoning_effort: 'low' },
    ],
  ];
  for (const [settings, expected] of cases) {
    assert.deepEqual(modelRequestParameters(settings, 300), expected, JSON.stringify(settings));
  }
});

test('CATALOG: with no settings the fields are byte-for-byte the max_tokens the requests always sent', () => {
  // The bytes, not only the value: one key, that name. Spread where
  // `max_tokens` sat, this keeps every request's key order.
  assert.equal(JSON.stringify(modelRequestParameters(undefined, 4000)), '{"max_tokens":4000}');
  assert.equal(JSON.stringify(modelRequestParameters({}, 2000)), '{"max_tokens":2000}');
  // With a setting, the limit comes first and the reasoning setting after it.
  assert.equal(
    JSON.stringify(modelRequestParameters({ reasoningEffort: 'none' }, 4000)),
    '{"max_completion_tokens":4000,"reasoning_effort":"none"}',
  );
});

// --- The settings on the identity pair ---------------------------------------

test('CATALOG: an entry setting neither field yields the two-member pair it always did', () => {
  // Until the October 2026 roster this walked the built-in catalog, which set
  // neither field. Every built-in entry now sets a reasoning effort, so the
  // property is held on an entry that sets neither.
  const plain = entry({ model: undefined }) as unknown as CatalogEntry;
  const identity = modelIdentity(plain);
  assert.deepEqual(identity, { endpointModel: plain.endpointModel, declared: plain.endpointModel });
  assert.equal('requestSettings' in identity, false, 'an entry setting neither field grew a requestSettings key');
});

test('CATALOG: the summary draft leaves a reasoning summariser room to reason, and keeps 300 otherwise', () => {
  // A reasoning model counts its reasoning against the limit, so a 300-token
  // draft limit can be spent before any text comes back.
  assert.equal(summaryDraftTokenLimit(undefined), 300);
  assert.equal(summaryDraftTokenLimit({}), 300);
  assert.equal(summaryDraftTokenLimit({ tokenLimitParameter: 'max_completion_tokens' }), 300);
  assert.equal(summaryDraftTokenLimit({ reasoningEffort: 'none' }), 300, '`none` does not reason');
  for (const effort of REASONING_EFFORTS.filter((e) => e !== 'none')) {
    assert.equal(summaryDraftTokenLimit({ reasoningEffort: effort }), 2000, effort);
  }
  // The built-in summariser (Haiku 5.5 at low effort) is one that reasons.
  const builtInSummariser = BUILT_IN_CATALOG.find((e) => e.summarizer);
  assert.ok(builtInSummariser, 'the built-in catalog declares a summariser');
  assert.equal(summaryDraftTokenLimit(modelRequestSettings(builtInSummariser)), 2000);
});

test('CATALOG: the built-in catalog sends each model the settings it was evaluated at', () => {
  // The October 2026 evaluation ran each Claude model at this effort
  // (docs/model-evaluation-2026-10.md); the limit's name stays derived, which
  // is max_completion_tokens once a reasoning effort is set. The November 2026
  // evaluation sent MiMo-V2.6-Flash no reasoning setting and its limit as
  // max_tokens (docs/model-evaluation-2026-11.md, the models table).
  assert.deepEqual(
    Object.fromEntries(BUILT_IN_CATALOG.map((e) => [e.id, [e.reasoningEffort, e.tokenLimitParameter]])),
    {
      'anthropic/claude-haiku-5.5': ['low', undefined],
      'anthropic/claude-sonnet-5.5': ['medium', undefined],
      'anthropic/claude-opus-5.5': ['medium', undefined],
      'xiaomi/mimo-v2.6-flash': [undefined, 'max_tokens'],
    },
  );
  // The request fields, as the November run's models table writes them, with
  // MiMo-V2.6-Flash's provider object restricted to three providers (OA-863 = B).
  assert.deepEqual(
    Object.fromEntries(BUILT_IN_CATALOG.map((e) => [e.id, JSON.stringify(modelRequestParameters(modelRequestSettings(e), 4000))])),
    {
      'anthropic/claude-haiku-5.5': '{"max_completion_tokens":4000,"reasoning_effort":"low"}',
      'anthropic/claude-sonnet-5.5': '{"max_completion_tokens":4000,"reasoning_effort":"medium"}',
      'anthropic/claude-opus-5.5': '{"max_completion_tokens":4000,"reasoning_effort":"medium"}',
      'xiaomi/mimo-v2.6-flash':
        '{"max_tokens":4000,"provider":{"max_price":{"prompt":0.15,"completion":0.6},"require_parameters":true,"data_collection":"deny","only":["cohere","gmicloud","xiaomi"]}}',
    },
  );
});

// --- The provider routing (#740 P3, ruling R3 and OA-863 = B) -------------------

/**
 * MiMo-V2.6-Flash's routing: R3, the November 2026 run's provider object,
 * then OA-863's restriction to the three providers that served the run's
 * MiMo-V2.6-Flash requests, by OpenRouter's base slugs (`only`).
 */
const MIMO_ROUTING =
  '{"max_price":{"prompt":0.15,"completion":0.6},"require_parameters":true,"data_collection":"deny","only":["cohere","gmicloud","xiaomi"]}';

test('CATALOG: the routing is sent as `provider`, after the limit and the reasoning setting, and only when set', () => {
  const routing = JSON.parse(MIMO_ROUTING) as ModelRequestSettings['providerRouting'];
  assert.equal(
    JSON.stringify(modelRequestParameters({ tokenLimitParameter: 'max_tokens', providerRouting: routing }, 300)),
    `{"max_tokens":300,"provider":${MIMO_ROUTING}}`,
  );
  assert.equal(
    JSON.stringify(modelRequestParameters({ reasoningEffort: 'low', providerRouting: routing }, 300)),
    `{"max_completion_tokens":300,"reasoning_effort":"low","provider":${MIMO_ROUTING}}`,
  );
  // Routing alone does not move the limit's name: it is not a reasoning setting.
  assert.equal(JSON.stringify(modelRequestParameters({ providerRouting: routing }, 300)), `{"max_tokens":300,"provider":${MIMO_ROUTING}}`);
  for (const settings of [undefined, {}, { reasoningEffort: 'none' as const }, { tokenLimitParameter: 'max_completion_tokens' as const }]) {
    assert.equal('provider' in modelRequestParameters(settings, 300), false, JSON.stringify(settings));
  }
});

test('CATALOG: the MiMo-V2.6-Flash entry carries its routing, restriction included, to its requests, and no Claude entry carries any routing', () => {
  const sent = Object.fromEntries(
    BUILT_IN_CATALOG.map((e) => {
      const fields = modelRequestParameters(modelRequestSettings(e), 4000);
      return [e.id, 'provider' in fields ? JSON.stringify(fields.provider) : null];
    }),
  );
  assert.deepEqual(sent, {
    'anthropic/claude-haiku-5.5': null,
    'anthropic/claude-sonnet-5.5': null,
    'anthropic/claude-opus-5.5': null,
    'xiaomi/mimo-v2.6-flash': MIMO_ROUTING,
  });
  // On the identity every call site carries.
  const mimo = BUILT_IN_CATALOG.find((e) => e.id === 'xiaomi/mimo-v2.6-flash');
  assert.ok(mimo, 'the built-in catalog carries xiaomi/mimo-v2.6-flash');
  assert.equal(JSON.stringify(modelIdentity(mimo).requestSettings), `{"tokenLimitParameter":"max_tokens","providerRouting":${MIMO_ROUTING}}`);
});

test('CATALOG: an entry setting either field carries exactly what it set', () => {
  const base = entry() as unknown as CatalogEntry;
  assert.deepEqual(modelIdentity({ ...base, reasoningEffort: 'none' }).requestSettings, { reasoningEffort: 'none' });
  assert.deepEqual(
    modelIdentity({ ...base, tokenLimitParameter: 'max_completion_tokens' }).requestSettings,
    { tokenLimitParameter: 'max_completion_tokens' },
  );
  assert.deepEqual(
    modelIdentity({ ...base, reasoningEffort: 'low', tokenLimitParameter: 'max_tokens' }).requestSettings,
    { reasoningEffort: 'low', tokenLimitParameter: 'max_tokens' },
  );
  // A string the catalog does not describe has no entry, so no settings.
  assert.equal('requestSettings' in carriedModelIdentity('vendor/unlisted'), false);
});

test('CATALOG: the settings are not served — /api/models keeps its seven fields', () => {
  const served = projectServedModel({
    ...(entry() as unknown as CatalogEntry),
    reasoningEffort: 'none',
    tokenLimitParameter: 'max_completion_tokens',
    providerRouting: JSON.parse(MIMO_ROUTING),
  });
  assert.deepEqual(Object.keys(served), ['id', 'name', 'provider', 'supports_tools']);
});

test('INSTANCE: every lookup a call site uses carries the entry\'s settings', () => {
  process.env.MODEL_API_KIND = 'azure-openai';
  process.env.MODEL_API_BASE_URL = 'https://example-resource.example.net';
  process.env.MODEL_API_VERSION = '2024-12-01-preview';
  process.env.MODEL_CATALOG = JSON.stringify([
    entry({ reasoningEffort: 'none' }),
    {
      id: 'summariser',
      name: 'Summary Model',
      provider: 'Example Provider',
      supports_tools: true,
      endpointModel: 'example-summary-deployment',
      model: 'vendor/summary-model-1',
      summarizer: true,
      evaluator: 2,
      tokenLimitParameter: 'max_completion_tokens',
    },
  ]);

  const reasoning = { reasoningEffort: 'none' };
  // The query routes and the publication gate.
  assert.deepEqual(resolveModelIdentity('reasoner').requestSettings, reasoning);
  // The interactive evaluation.
  assert.deepEqual(modelIdentityForValue('reasoner').requestSettings, reasoning);
  // A replay, which starts from the declared identity in a signed package.
  assert.deepEqual(modelIdentityForDeclared('vendor/reasoning-model-1').requestSettings, reasoning);
  // The summary draft.
  assert.deepEqual(modelIdentity(getSummarizerModel()).requestSettings, { tokenLimitParameter: 'max_completion_tokens' });
  // A model string no entry describes keeps today's request.
  assert.equal(modelIdentityForValue('vendor/unlisted').requestSettings, undefined);
  assert.equal(modelIdentityForDeclared('vendor/unlisted').requestSettings, undefined);
  // Not served.
  assert.equal(JSON.stringify(getOfferedModels()).includes('reasoning'), false);
});

// --- The recorded attribute (ruling D3) ---------------------------------------

test('CATALOG: the reasoning setting is recorded exactly as sent, and nothing is recorded without one', async () => {
  const { REASONING_EFFORT_ATTRIBUTE, reasoningEffortAttributes } = await import('./model-loop/run-tool-loop.ts');
  // Not a `gen_ai.*` name: the GenAI conventions the spans declare (1.30.0)
  // define no reasoning attribute — see the constant's own note.
  assert.equal(REASONING_EFFORT_ATTRIBUTE, 'civic.request.reasoning_effort');
  for (const value of REASONING_EFFORTS) {
    assert.deepEqual(reasoningEffortAttributes({ reasoningEffort: value }), { [REASONING_EFFORT_ATTRIBUTE]: value });
  }
  // Absence is absence: no key, never a default — including for an entry that
  // names a token-limit parameter and no reasoning setting.
  for (const settings of [undefined, {}, { tokenLimitParameter: 'max_completion_tokens' as const }]) {
    assert.deepEqual(reasoningEffortAttributes(settings), {}, JSON.stringify(settings));
  }
});
