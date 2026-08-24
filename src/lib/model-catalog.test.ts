// Tests for the model catalog and its resolver (civic-ai-tools-website#30 P2).
//
// ENVIRONMENT OF VERIFICATION. Every claim below is checked in-process under
// Node on macOS, against `process.env` and a real temp file — never against a
// live model endpoint. No test here makes an upstream call, which is itself
// half the point: the refusals this phase adds all fire BEFORE one. Test names
// carry their scope so a later reader cannot mistake the scope for more than it
// is:
//   CATALOG:  pure schema/projection facts, no environment read at all.
//   INSTANCE: resolved through `process.env` (and, for the file form, a real
//             file on disk) with the module's memo reset between cases.
//
// Run with: npm test

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILT_IN_CATALOG,
  catalogDefaultEntry,
  catalogEvaluatorOrder,
  declaredModelIdentity,
  modelIdentity,
  selectableModels,
  validateCatalog,
  type CatalogEntry,
} from './model-catalog.ts';
import {
  endpointModelForDeclared,
  getDefaultModel,
  getModelCatalog,
  getOfferedModels,
  getSummarizerModel,
  modelIdentityForValue,
  resolveEvaluatorModel,
  resolveModel,
  ModelNotOfferedError,
  _resetModelCatalogForTests,
} from './model-resolver.ts';
import {
  ModelConfigurationError,
  getMissingModelCredentialError,
  createModelClient,
  _resetDefaultModelClientForTests,
} from './model-client.ts';

/**
 * The exact `/api/models` body this repo served at `b95c768`, the commit this
 * phase branched from, captured by running `JSON.stringify` over the
 * pre-catalog `availableModels`. Criterion 1 of the phase: the reference
 * instance sees ZERO change. Not a snapshot to be regenerated — a frozen
 * literal. If a change makes this fail, the change altered what the selector
 * offers, which is civic-ai-tools-website#302's question and not this one's.
 */
const FROZEN_MODELS_BODY =
  '{"models":[{"id":"openai/gpt-4o","name":"GPT-4o","tag":"recommended","provider":"OpenAI","supports_tools":true,"description":"Best balance of quality and speed"},{"id":"openai/gpt-5.4","name":"GPT-5.4","tag":"premium","provider":"OpenAI","supports_tools":true,"description":"Highest quality analysis, newest model"},{"id":"google/gemini-3.5-flash-lite","name":"Gemini 3.5 Flash Lite","tag":"fastest","provider":"Google","supports_tools":true,"description":"Fast and budget-friendly","maxTokenBudget":150000}]}';

/** Every variable these tests touch, cleared before and after each one. */
const ENV_KEYS = [
  'MODEL_CATALOG',
  'MODEL_CATALOG_PATH',
  'MODEL_API_BASE_URL',
  'MODEL_API_KIND',
  'MODEL_API_VERSION',
  'MODEL_API_AUTH',
  'MODEL_API_KEY',
  'OPENROUTER_API_KEY',
];

const saved: Record<string, string | undefined> = {};
let tmp: string | null = null;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  _resetModelCatalogForTests();
  _resetDefaultModelClientForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  _resetModelCatalogForTests();
  _resetDefaultModelClientForTests();
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

/** A minimal well-formed catalog, as an operator would write it. */
function sampleCatalog(overrides: Partial<CatalogEntry>[] = []): unknown[] {
  const base: unknown[] = [
    {
      id: 'fast',
      name: 'Fast Model',
      provider: 'Example Provider',
      supports_tools: true,
      endpointModel: 'example-fast-deployment',
      model: 'vendor/model-fast-1',
      default: true,
      evaluator: 2,
    },
    {
      id: 'careful',
      name: 'Careful Model',
      provider: 'Example Provider',
      supports_tools: true,
      endpointModel: 'example-careful-deployment',
      model: 'vendor/model-careful-1',
      evaluator: 1,
    },
  ];
  return overrides.length === 0 ? base : overrides;
}

function refusalFrom(fn: () => unknown): ModelConfigurationError {
  try {
    fn();
  } catch (error) {
    assert.ok(
      error instanceof ModelConfigurationError,
      `expected a typed ModelConfigurationError, got ${String(error)}`,
    );
    return error as ModelConfigurationError;
  }
  assert.fail('expected a refusal, got a value');
}

// --- Criterion 1: the reference instance sees zero change -------------------

test('INSTANCE: with no catalog and the default endpoint, /api/models is byte-identical to b95c768', () => {
  assert.equal(JSON.stringify({ models: getOfferedModels() }), FROZEN_MODELS_BODY);
});

test('CATALOG: the projection omits absent optionals rather than emitting them', () => {
  const served = selectableModels([
    {
      id: 'bare',
      name: 'Bare',
      provider: 'Example Provider',
      supports_tools: false,
      endpointModel: 'bare',
    },
  ]);
  assert.deepEqual(Object.keys(served[0]), ['id', 'name', 'provider', 'supports_tools']);
});

test('CATALOG: `endpointModel` and `model` are never served — a deployment alias is internal', () => {
  for (const served of selectableModels(BUILT_IN_CATALOG)) {
    assert.ok(!('endpointModel' in served), 'endpointModel leaked into /api/models');
    assert.ok(!('model' in served), 'model leaked into /api/models');
    assert.ok(!('pricing' in served), 'pricing leaked into /api/models');
    assert.ok(!('evaluator' in served), 'evaluator leaked into /api/models');
    assert.ok(!('default' in served), 'default leaked into /api/models');
    assert.ok(!('selectable' in served), 'selectable leaked into /api/models');
  }
});

test('CATALOG: the built-in default and evaluator are resolvable but not served', () => {
  const served = selectableModels(BUILT_IN_CATALOG).map((m) => m.id);
  const defaultId = catalogDefaultEntry(BUILT_IN_CATALOG).id;
  assert.ok(!served.includes(defaultId), 'the notebook default has never been in the selector');
  assert.equal(defaultId, 'anthropic/claude-sonnet-4-6', 'the pre-catalog DEFAULT_MODEL, unchanged');
});

test('INSTANCE: the notebook default resolves by id even though it is not selectable', () => {
  const entry = resolveModel('anthropic/claude-sonnet-4-6');
  assert.equal(entry.id, 'anthropic/claude-sonnet-4-6');
  assert.equal(getDefaultModel().id, 'anthropic/claude-sonnet-4-6');
});

test('CATALOG: the built-in evaluator order reproduces the two literals it replaced', () => {
  const order = catalogEvaluatorOrder(BUILT_IN_CATALOG).map((e) => e.id);
  assert.deepEqual(order, ['anthropic/claude-sonnet-4-6', 'openai/gpt-4o']);
});

test('INSTANCE: evaluator independence picks the same model the two literals did', () => {
  // Pre-catalog: DEFAULT_EVALUATOR_MODEL unless it collides with the analysis
  // model, in which case FALLBACK_EVALUATOR_MODEL.
  assert.equal(resolveEvaluatorModel('openai/gpt-4o')?.id, 'anthropic/claude-sonnet-4-6');
  assert.equal(resolveEvaluatorModel('anthropic/claude-sonnet-4-6')?.id, 'openai/gpt-4o');
  assert.equal(resolveEvaluatorModel('openai/gpt-5.4')?.id, 'anthropic/claude-sonnet-4-6');
});

test('CATALOG: an omitted `model` under the default dialect declares the endpoint string', () => {
  // Which is what makes the built-in list safe there: the slug called is the
  // slug recorded.
  //
  // WHAT THIS TEST MEANT IN P2, AND WHAT IT MEANS NOW (website#30 P3). P2 wrote
  // the third assertion as a LICENCE: its call sites kept sending `entry.id` on
  // the wire rather than `entry.endpointModel`, and this test was the standing
  // proof that doing so was harmless, because under the built-in catalog the
  // two are the same string. Its comment said that if the assertion ever
  // failed, the split was overdue rather than the test wrong.
  //
  // The split has now happened, so the licence is spent and this test's job
  // changes rather than ending. The same three assertions now pin something
  // else: that the built-in catalog is the case where the split is a NO-OP, and
  // therefore that the reference instance's canonical JSON does not move. If
  // one of them fails now, the built-in list has started asserting a model
  // identity distinct from the slug it calls — a deliberate act, and one that
  // changes what every new reference-instance record says.
  for (const entry of BUILT_IN_CATALOG) {
    assert.equal(entry.model, undefined);
    assert.equal(declaredModelIdentity(entry), entry.id);
    assert.equal(entry.endpointModel, entry.id);
    // The pair every call site now carries. Both halves equal here — which is
    // exactly why nothing about the reference instance changed.
    assert.deepEqual(modelIdentity(entry), { endpointModel: entry.id, declared: entry.id });
  }
});

test('CATALOG: the identity pair separates the two audiences when an entry declares one', () => {
  const azure: CatalogEntry = {
    id: 'fast',
    name: 'Fast',
    provider: 'Example Vendor',
    supports_tools: true,
    endpointModel: 'example-deployment-alias',
    model: 'vendor/model-1',
  };
  assert.deepEqual(modelIdentity(azure), {
    endpointModel: 'example-deployment-alias',
    declared: 'vendor/model-1',
  });
});

// --- Criterion 2: both delivery forms, one schema, both together refuse -----

test('INSTANCE: MODEL_CATALOG alone loads the declared catalog', () => {
  process.env.MODEL_CATALOG = JSON.stringify(sampleCatalog());
  const catalog = getModelCatalog();
  assert.deepEqual(catalog.map((e) => e.id), ['fast', 'careful']);
  assert.equal(getDefaultModel().id, 'fast');
  assert.equal(resolveModel('careful').endpointModel, 'example-careful-deployment');
});

test('INSTANCE: MODEL_CATALOG_PATH alone loads the same catalog from a real file', () => {
  tmp = mkdtempSync(join(tmpdir(), 'model-catalog-'));
  const file = join(tmp, 'catalog.json');
  writeFileSync(file, JSON.stringify(sampleCatalog()), 'utf8');

  process.env.MODEL_CATALOG = JSON.stringify(sampleCatalog());
  const viaEnv = getModelCatalog();

  delete process.env.MODEL_CATALOG;
  process.env.MODEL_CATALOG_PATH = file;
  _resetModelCatalogForTests();
  const viaFile = getModelCatalog();

  assert.deepEqual(viaFile, viaEnv, 'one schema — the two delivery forms differ only in transport');
});

test('INSTANCE: both delivery variables set is a refusal naming both', () => {
  tmp = mkdtempSync(join(tmpdir(), 'model-catalog-'));
  const file = join(tmp, 'catalog.json');
  writeFileSync(file, JSON.stringify(sampleCatalog()), 'utf8');
  process.env.MODEL_CATALOG = JSON.stringify(sampleCatalog());
  process.env.MODEL_CATALOG_PATH = file;

  const err = refusalFrom(getModelCatalog);
  assert.match(err.message, /MODEL_CATALOG\b/);
  assert.match(err.message, /MODEL_CATALOG_PATH/);
  assert.match(err.message, /refused|Unset one/i);
});

test('INSTANCE: a MODEL_CATALOG_PATH that cannot be read is a refusal naming the variable', () => {
  process.env.MODEL_CATALOG_PATH = join(tmpdir(), 'no-such-model-catalog-file.json');
  const err = refusalFrom(getModelCatalog);
  assert.match(err.message, /MODEL_CATALOG_PATH/);
});

test('INSTANCE: a catalog that is not JSON is a refusal naming where it came from', () => {
  process.env.MODEL_CATALOG = 'not json at all';
  const err = refusalFrom(getModelCatalog);
  assert.match(err.message, /MODEL_CATALOG/);
  assert.match(err.message, /valid JSON/i);
});

// --- Criterion 3: the built-in retention rule, both directions --------------

test('INSTANCE: the default base URL with no catalog keeps the built-in list', () => {
  assert.deepEqual(getModelCatalog(), BUILT_IN_CATALOG);
});

test('INSTANCE: the default base URL set EXPLICITLY still keeps the built-in list', () => {
  // D2 is written against the RESOLVED base URL, not against "the variable is
  // unset" — an operator who pins the default endpoint by hand has the same
  // endpoint and the same guarantee.
  process.env.MODEL_API_BASE_URL = 'https://openrouter.ai/api/v1';
  assert.deepEqual(getModelCatalog(), BUILT_IN_CATALOG);
});

test('INSTANCE: any other base URL with no catalog is a refusal naming MODEL_CATALOG', () => {
  process.env.MODEL_API_BASE_URL = 'https://example-gateway.example.net/v1';
  const err = refusalFrom(getModelCatalog);
  assert.match(err.message, /MODEL_CATALOG/);
  assert.match(err.message, /MODEL_CATALOG_PATH/, 'the file form is offered as the alternative');
});

test('INSTANCE: the azure dialect with no catalog is a refusal even before a base URL is set', () => {
  // The built-in list names public slugs in another dialect; it can never be
  // the right answer under azure-openai, whatever the URL resolves to.
  process.env.MODEL_API_KIND = 'azure-openai';
  const err = refusalFrom(getModelCatalog);
  assert.match(err.message, /MODEL_CATALOG/);
});

test('INSTANCE: a declared catalog is used under a non-default endpoint', () => {
  process.env.MODEL_API_BASE_URL = 'https://example-gateway.example.net/v1';
  process.env.MODEL_CATALOG = JSON.stringify(sampleCatalog());
  assert.deepEqual(getModelCatalog().map((e) => e.id), ['fast', 'careful']);
});

// --- Criterion 4: every refusal is typed and names what to fix --------------

test('INSTANCE: an unknown model id is a typed not-offered error, raised before any upstream call', () => {
  let thrown: unknown;
  try {
    resolveModel('vendor/model-nobody-offers');
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ModelNotOfferedError, 'a caller error, not a configuration error');
  const err = thrown as ModelNotOfferedError;
  assert.equal(err.code, 'model_not_offered');
  assert.equal(err.modelId, 'vendor/model-nobody-offers');
  assert.match(err.message, /not offered by this instance/);
  assert.match(err.message, /openai\/gpt-4o/, 'the message lists what IS offered');
  assert.ok(
    !(err instanceof ModelConfigurationError),
    'a bad request must not be reported as a broken instance',
  );
});

test('CATALOG: an invalid entry names the entry and the field', () => {
  const result = validateCatalog(
    [{ id: 'fast', name: 'Fast', provider: 'Example Provider', supports_tools: true }],
    { source: 'MODEL_CATALOG', kind: 'openai-compatible' },
  );
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /entry "fast"/);
  assert.match((result as { message: string }).message, /"endpointModel"/);
});

test('CATALOG: an entry with no usable id is named by position', () => {
  const result = validateCatalog([{ name: 'Nameless' }], {
    source: 'MODEL_CATALOG',
    kind: 'openai-compatible',
  });
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /entry #1/);
  assert.match((result as { message: string }).message, /"id"/);
});

test('CATALOG: duplicate ids are refused rather than resolved by position', () => {
  const dup = [
    { id: 'same', name: 'A', provider: 'P', supports_tools: true, endpointModel: 'a', default: true, evaluator: 1 },
    { id: 'same', name: 'B', provider: 'P', supports_tools: true, endpointModel: 'b' },
  ];
  const result = validateCatalog(dup, { source: 'MODEL_CATALOG', kind: 'openai-compatible' });
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /"same"/);
  assert.match((result as { message: string }).message, /more than one entry/);
});

test('CATALOG: zero default entries is a refusal', () => {
  const none = [
    { id: 'a', name: 'A', provider: 'P', supports_tools: true, endpointModel: 'a', evaluator: 1 },
  ];
  const result = validateCatalog(none, { source: 'MODEL_CATALOG', kind: 'openai-compatible' });
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /no default model/);
});

test('CATALOG: more than one default entry is a refusal naming both', () => {
  const two = [
    { id: 'a', name: 'A', provider: 'P', supports_tools: true, endpointModel: 'a', default: true, evaluator: 1 },
    { id: 'b', name: 'B', provider: 'P', supports_tools: true, endpointModel: 'b', default: true },
  ];
  const result = validateCatalog(two, { source: 'MODEL_CATALOG', kind: 'openai-compatible' });
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /"a"/);
  assert.match((result as { message: string }).message, /"b"/);
});

test('CATALOG: an evaluator preference that resolves to nothing is a refusal', () => {
  const none = [
    { id: 'a', name: 'A', provider: 'P', supports_tools: true, endpointModel: 'a', default: true },
  ];
  const result = validateCatalog(none, { source: 'MODEL_CATALOG', kind: 'openai-compatible' });
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /no evaluator/);
});

test('CATALOG: two entries claiming the same evaluator rank are refused', () => {
  const tie = [
    { id: 'a', name: 'A', provider: 'P', supports_tools: true, endpointModel: 'a', default: true, evaluator: 1 },
    { id: 'b', name: 'B', provider: 'P', supports_tools: true, endpointModel: 'b', evaluator: 1 },
  ];
  const result = validateCatalog(tie, { source: 'MODEL_CATALOG', kind: 'openai-compatible' });
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /rank 1/);
});

test('CATALOG: under azure-openai an entry without `model` is refused, naming entry and field', () => {
  const noIdentity = [
    {
      id: 'fast',
      name: 'Fast',
      provider: 'Example Provider',
      supports_tools: true,
      endpointModel: 'example-fast-deployment',
      default: true,
      evaluator: 1,
    },
  ];
  const result = validateCatalog(noIdentity, { source: 'MODEL_CATALOG', kind: 'azure-openai' });
  assert.equal(result.ok, false);
  const message = (result as { message: string }).message;
  assert.match(message, /entry "fast"/);
  assert.match(message, /"model"/);
  assert.match(message, /azure-openai/);
  assert.match(message, /deployment name/, 'the message says WHY, not just what');
});

test('CATALOG: the same entry is accepted under openai-compatible, where omission is true', () => {
  const noIdentity = [
    {
      id: 'fast',
      name: 'Fast',
      provider: 'Example Provider',
      supports_tools: true,
      endpointModel: 'vendor/model-fast-1',
      default: true,
      evaluator: 1,
    },
  ];
  const result = validateCatalog(noIdentity, {
    source: 'MODEL_CATALOG',
    kind: 'openai-compatible',
  });
  assert.equal(result.ok, true);
  assert.equal(
    declaredModelIdentity((result as { catalog: CatalogEntry[] }).catalog[0]),
    'vendor/model-fast-1',
  );
});

test('INSTANCE: the azure rule fires through the resolver, not only the validator', () => {
  process.env.MODEL_API_KIND = 'azure-openai';
  process.env.MODEL_API_BASE_URL = 'https://example-resource.example.net';
  process.env.MODEL_API_VERSION = '2026-01-01';
  process.env.MODEL_CATALOG = JSON.stringify([
    {
      id: 'fast',
      name: 'Fast',
      provider: 'Example Provider',
      supports_tools: true,
      endpointModel: 'example-fast-deployment',
      default: true,
      evaluator: 1,
    },
  ]);
  const err = refusalFrom(getModelCatalog);
  assert.match(err.message, /entry "fast"/);
  assert.match(err.message, /"model"/);
});

test('CATALOG: an unknown field is refused rather than ignored, so a typo cannot do nothing', () => {
  const typo = [
    {
      id: 'a',
      name: 'A',
      provider: 'P',
      supports_tools: true,
      endpointModel: 'a',
      default: true,
      evaluator: 1,
      endpointmodel: 'a',
    },
  ];
  const result = validateCatalog(typo, { source: 'MODEL_CATALOG', kind: 'openai-compatible' });
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /"endpointmodel"/);
});

test('CATALOG: a document that is not an array, and an empty array, are both refused', () => {
  for (const document of [{ models: [] }, 'a string', 42, null]) {
    const result = validateCatalog(document, {
      source: 'MODEL_CATALOG',
      kind: 'openai-compatible',
    });
    assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(document)}`);
    assert.match((result as { message: string }).message, /JSON array/);
  }
  const empty = validateCatalog([], { source: 'MODEL_CATALOG', kind: 'openai-compatible' });
  assert.equal(empty.ok, false);
  assert.match((empty as { message: string }).message, /empty array/);
});

test('CATALOG: malformed pricing is refused; absent pricing is fine', () => {
  const bad = [
    { id: 'a', name: 'A', provider: 'P', supports_tools: true, endpointModel: 'a', default: true, evaluator: 1, pricing: { input: 1 } },
  ];
  assert.equal(validateCatalog(bad, { source: 'MODEL_CATALOG', kind: 'openai-compatible' }).ok, false);

  const none = [
    { id: 'a', name: 'A', provider: 'P', supports_tools: true, endpointModel: 'a', default: true, evaluator: 1 },
  ];
  assert.equal(validateCatalog(none, { source: 'MODEL_CATALOG', kind: 'openai-compatible' }).ok, true);
});

// --- Criterion 5: the routed defect is closed ------------------------------

test('INSTANCE: the publication gate credential check passes on MODEL_API_KEY alone', () => {
  // The exact predicate the publish route now calls. Before this phase the
  // route read the prior-era variable straight out of `process.env`, so this
  // configuration produced 502 Evaluation unavailable from a fully configured
  // instance (#30 P1's flag, routed to P2).
  process.env.MODEL_API_KEY = 'obviously-fake-test-key';
  assert.equal(getMissingModelCredentialError(), null);
  // And the client the evaluator builds resolves that key without being handed
  // one — which is why the route no longer threads a credential as a string.
  assert.doesNotThrow(() => createModelClient({ apiKey: undefined }));
});

test('INSTANCE: the genuine no-credential case still refuses, naming both accepted names', () => {
  const err = getMissingModelCredentialError();
  assert.ok(err instanceof ModelConfigurationError);
  assert.match(err!.message, /MODEL_API_KEY/);
  assert.match(err!.message, /OPENROUTER_API_KEY/);
});

test('INSTANCE: the publish route holds no direct read of the prior-era key variable', () => {
  // A mechanical guard for a defect defined by absence (ADR-0024 §E): review
  // does not reliably see a variable read that bypasses the resolver, and this
  // one survived a whole phase before being flagged.
  const source = readFileSync(
    new URL('../app/api/evidence/[slug]/publish/route.ts', import.meta.url),
    'utf8',
  );
  assert.ok(
    !/process\.env\.OPENROUTER_API_KEY/.test(source),
    'the publication gate must resolve its credential through the endpoint layer',
  );
});

// --- The five consolidated sites now have one home -------------------------

test('CATALOG: every built-in entry carries pricing, so no offered model reports a null cost', () => {
  // The #232 guard, kept: the roster and the pricing table used to be two maps
  // synchronized by hand, and an id in one and not the other silently produced
  // no cost estimate. They are now one record per model, which is what makes
  // that class of drift unrepresentable rather than merely tested.
  for (const entry of BUILT_IN_CATALOG) {
    assert.ok(entry.pricing, `${entry.id} has no pricing`);
  }
});

// --- The sixth site: the summary-draft route (website#30 P3) ---------------

test('INSTANCE: the built-in summariser is the id the route used to hardcode', () => {
  // `SUMMARY_MODEL = 'google/gemini-3.5-flash-lite'` lived in
  // api/evidence/generate-summary/route.ts — the fifth hardcoded table, missed
  // by P2's inventory and routed to P3. Same model, now a catalog role: this
  // instance's behaviour is unchanged and the choice is configurable.
  assert.equal(getSummarizerModel().id, 'google/gemini-3.5-flash-lite');
});

test('INSTANCE: a catalog that declares no summariser falls back to its default', () => {
  // Not the absent-or-error case ADR-0024 §A governs: the draft is a
  // convenience the publisher edits before anything is signed, so refusing to
  // publish over an undeclared summariser would be out of all proportion. Every
  // catalog written before this field existed keeps working.
  process.env.MODEL_CATALOG = JSON.stringify(sampleCatalog());
  assert.equal(getSummarizerModel().id, 'fast');
  assert.equal(getDefaultModel().id, 'fast');
});

test('INSTANCE: a catalog claiming the summariser role names it', () => {
  const catalog = sampleCatalog() as Record<string, unknown>[];
  catalog[1].summarizer = true;
  process.env.MODEL_CATALOG = JSON.stringify(catalog);
  assert.equal(getSummarizerModel().id, 'careful');
});

test('CATALOG: two entries claiming the summariser role are refused, both named', () => {
  const catalog = sampleCatalog() as Record<string, unknown>[];
  catalog[0].summarizer = true;
  catalog[1].summarizer = true;
  const result = validateCatalog(catalog, { source: 'MODEL_CATALOG', kind: 'azure-openai' });
  assert.equal(result.ok, false);
  const message = (result as { message: string }).message;
  assert.match(message, /"fast"/);
  assert.match(message, /"careful"/);
  assert.match(message, /summarizer/);
});

// --- The identity pair at the resolver boundary (website#30 P3) ------------

test('INSTANCE: an offered id resolves to both strings; anything else is carried through', () => {
  process.env.MODEL_CATALOG = JSON.stringify(sampleCatalog());

  assert.deepEqual(modelIdentityForValue('careful'), {
    endpointModel: 'example-careful-deployment',
    declared: 'vendor/model-careful-1',
  });

  // A model string this instance does not offer — the shape `POST
  // /api/evidence` receives from an external publisher, and one that has never
  // been validated against a catalog. Carried, not refused: an id the catalog
  // does not describe has no second string to be wrong about.
  assert.deepEqual(modelIdentityForValue('anthropic/claude-opus-5'), {
    endpointModel: 'anthropic/claude-opus-5',
    declared: 'anthropic/claude-opus-5',
  });
});

test('INSTANCE: a recorded identity maps back to the wire string that reaches it', () => {
  process.env.MODEL_CATALOG = JSON.stringify(sampleCatalog());
  // The replay path's direction: `pkg.cost.model` is a declared identity, and
  // under this catalog it is not a string any endpoint answers to.
  assert.equal(endpointModelForDeclared('vendor/model-careful-1'), 'example-careful-deployment');
  // A record naming a model this instance no longer offers replays as before.
  assert.equal(endpointModelForDeclared('anthropic/claude-opus-5'), 'anthropic/claude-opus-5');
});

test('INSTANCE: evaluator independence is checked declared-against-declared', () => {
  // The analysis model is only ever read out of `pkg.cost.model`, which holds a
  // DECLARED identity. Comparing it against catalog ids would compare two
  // namespaces, and under this catalog the gate would pick the analysis model
  // to grade its own work.
  process.env.MODEL_CATALOG = JSON.stringify(sampleCatalog());
  assert.equal(resolveEvaluatorModel('vendor/model-careful-1')?.id, 'fast');
  assert.equal(resolveEvaluatorModel('vendor/model-fast-1')?.id, 'careful');
  // Passing the ID rather than the declared identity is what the bug looked
  // like: 'careful' matches no declared identity, so the gate would happily
  // return 'careful' — the model under evaluation.
  assert.equal(resolveEvaluatorModel('careful')?.id, 'careful');
});
