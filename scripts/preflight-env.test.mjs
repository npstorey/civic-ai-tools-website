// Unit tests for the demo-day env preflight.
//
// Run with:  node --test scripts/preflight-env.test.mjs
//
// (The repo's `npm test` globs src/**/*.test.ts; this scripts/ test is run
// explicitly — and would be wired into the cross-repo CI bundle, brief #5.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILT_IN_MODEL_BASE_URL,
  evaluateEnv,
  evaluateGroups,
  renderReport,
  resolveDrivers,
  resolveEnvName,
  resolveSpec,
  ENV_SPEC,
  ENV_GROUPS,
  DRIVER_SEAMS,
  OIDC_PROVIDER_SET,
} from './preflight-env.mjs';

const REQUIRED = ENV_SPEC.filter((s) => s.tier === 'required').map((s) => s.name);
const RECOMMENDED = ENV_SPEC.filter((s) => s.tier === 'recommended').map((s) => s.name);
// web#194 #6: a recommended variable with a coded fallback is not a degraded
// feature and is not nagged about, so the two sets are counted separately.
const RECOMMENDED_WITH_FALLBACK = ENV_SPEC.filter((s) => s.tier === 'recommended' && s.hasFallback).map((s) => s.name);
const RECOMMENDED_NO_FALLBACK = ENV_SPEC.filter((s) => s.tier === 'recommended' && !s.hasFallback).map((s) => s.name);

/** Build an env object with every required var present (non-empty). */
function envWithAllRequired() {
  const env = {};
  for (const name of REQUIRED) env[name] = 'present';
  return env;
}

test('ok=true when every required variable is present', () => {
  const result = evaluateEnv(envWithAllRequired());
  assert.equal(result.ok, true);
  assert.equal(result.missingRequired.length, 0);
});

test('ok=false and the missing required var is reported when one is absent', () => {
  const env = envWithAllRequired();
  delete env.DATABASE_URL;
  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRequired.map((r) => r.name), ['DATABASE_URL']);
});

test('empty string and whitespace-only count as absent (not present)', () => {
  const env = envWithAllRequired();
  // Two required vars with NO coded fallback, so they count as hard misses.
  env.PUBLISHER_SIGNING_KEY = '';
  env.NEXTAUTH_SECRET = '   ';
  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  const names = result.missingRequired.map((r) => r.name).sort();
  assert.deepEqual(names, ['NEXTAUTH_SECRET', 'PUBLISHER_SIGNING_KEY']);
});

test('a required var with a coded fallback is soft when absent (fallbk, run still passes)', () => {
  const env = envWithAllRequired();
  delete env.KV_REST_API_URL; // required, but hasFallback (in-process memory store)
  const result = evaluateEnv(env);
  assert.equal(result.ok, true, 'a fallback-backed required var does not fail the run');
  assert.equal(result.missingRequired.length, 0);
  assert.deepEqual(result.requiredOnFallback.map((r) => r.name), ['KV_REST_API_URL']);
  const report = renderReport(result);
  assert.match(report, /fallbk/);
  assert.match(report, /built-in fallback/);
});

test('#258 C4: SOCRATA_MCP_URL has NO coded fallback — absent, it is a hard miss that fails the run', () => {
  // The entry used to carry `hasFallback: true`, pointing at a coded default
  // of the reference deployment's hosted endpoint — which silently routed an
  // unconfigured instance's queries through infrastructure it does not
  // operate. That fallback is gone: the query path refuses per-request,
  // naming this variable, so preflight must fail rather than soft-note.
  const entry = ENV_SPEC.find((s) => s.name === 'SOCRATA_MCP_URL');
  assert.equal(entry.tier, 'required');
  assert.ok(!entry.hasFallback, 'SOCRATA_MCP_URL must not claim a coded fallback');

  const env = envWithAllRequired();
  delete env.SOCRATA_MCP_URL;
  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRequired.map((r) => r.name), ['SOCRATA_MCP_URL']);
  assert.ok(!result.requiredOnFallback.some((r) => r.name === 'SOCRATA_MCP_URL'));
});

test('#258 C5: NEXT_PUBLIC_SOCRATA_MCP_URL is no longer part of the environment inventory', () => {
  // The client reads the server-resolved SOCRATA_MCP_URL through
  // McpRoutingProvider; a second NEXT_PUBLIC_* name for the same routing
  // decision is exactly the split #258 C5 closed.
  assert.ok(!ENV_SPEC.some((s) => s.name === 'NEXT_PUBLIC_SOCRATA_MCP_URL'));
});

test('the signing key id has NO coded fallback: absent, it is a hard miss that fails the run', () => {
  // The kid used to carry `hasFallback: true`, pointing at a hardcoded
  // default in signing.ts that substituted the reference deployment's kid.
  // That default is gone — an instance emits the kid it declared or none —
  // so an absent kid is a real miss, not a soft note.
  const entry = ENV_SPEC.find((s) => s.name === 'PUBLISHER_KEY_ID');
  assert.equal(entry.tier, 'required');
  assert.ok(!entry.hasFallback, 'the key id must not claim a coded fallback');

  const env = envWithAllRequired();
  delete env.PUBLISHER_KEY_ID;
  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRequired.map((r) => r.name), ['PUBLISHER_KEY_ID']);
  assert.ok(!result.requiredOnFallback.some((r) => r.name === 'PUBLISHER_KEY_ID'));

  // ...and the prior-era spelling satisfies it, because the app still reads
  // that name (civic-ai-tools#160 P3). An instance that has not renamed
  // anything must not be told it is unconfigured.
  env[entry.priorEraName] = 'present';
  const viaPriorEra = evaluateEnv(env);
  assert.equal(viaPriorEra.ok, true);
  assert.ok(!viaPriorEra.missingRequired.some((r) => r.canonicalName === 'PUBLISHER_KEY_ID'));
});

// --- The two-name expand (civic-ai-tools#160 P3) ------------------------------
//
// Group A of the 2026-08-19 vocabulary settlement moves the publisher-identity
// set from `EVIDENCE_*` to `PUBLISHER_*`. Everything that READS these accepts
// both names; this preflight has to agree with the readers exactly, or it
// passes configurations the app refuses (and refuses ones the app accepts).

test('two-name expand: either spelling satisfies presence, and the report names the one found', () => {
  const env = {};
  for (const entry of ENV_SPEC.filter((e) => e.tier === 'required')) {
    // Deliberately the PRIOR-ERA spelling wherever there is one — the state
    // every existing instance is in on the day this ships.
    env[entry.priorEraName ?? entry.name] = 'present';
  }
  const result = evaluateEnv(env);
  assert.equal(result.ok, true, 'an entirely prior-era instance still passes');

  // The row reports the name that ANSWERED, so an operator sees what they set.
  const keyIdRow = result.rows.find((r) => r.canonicalName === 'PUBLISHER_KEY_ID');
  assert.equal(keyIdRow.present, true);
  assert.equal(keyIdRow.name, 'EVIDENCE_KEY_ID');
  assert.equal(keyIdRow.viaPriorEra, true);

  // And the deprecation notice lists every one of them, with its successor.
  assert.ok(result.deprecatedNames.length > 0);
  // Only prior-era names are listed as deprecated. Asserted against each
  // entry's DECLARED `priorEraName` rather than against the `EVIDENCE_`
  // prefix: since website#30 P1 the mechanism carries a second rename
  // (MODEL_API_KEY ← OPENROUTER_API_KEY) that shares no prefix with the first.
  const priorEraNames = new Set(
    ENV_SPEC.filter((s) => typeof s.priorEraName === 'string').map((s) => s.priorEraName),
  );
  assert.ok(
    result.deprecatedNames.every((r) => priorEraNames.has(r.name)),
    'only prior-era names are listed as deprecated',
  );
  // Both renames are represented, so the assertion above cannot pass vacuously
  // on a single-prefix census.
  assert.ok(result.deprecatedNames.some((r) => r.name.startsWith('EVIDENCE_')));
  assert.ok(result.deprecatedNames.some((r) => r.canonicalName === 'MODEL_API_KEY'));
  const report = renderReport(result);
  assert.match(report, /EVIDENCE_KEY_ID → rename to PUBLISHER_KEY_ID/);
  assert.match(report, /removed at a future/);
  // A NOTE, never a failure: the value reached the app.
  assert.ok(!report.includes('RESULT: FAIL'));
});

test('two-name expand: the canonical name wins whenever it is DEFINED, empty included', () => {
  // The precedence rule is `defined`, not `truthy`, and it must match
  // src/lib/publisher-env.ts exactly. Empty is a VALUE in this set —
  // TRUST_REGISTRY_LEGACY_URL='' omits a URL from signed output — so a
  // preflight that fell through on empty would report PASS for a
  // configuration the app treats as unset.
  const entry = ENV_SPEC.find((s) => s.name === 'PUBLISHER_SITE_ORIGIN');
  assert.equal(
    resolveEnvName(entry, { PUBLISHER_SITE_ORIGIN: 'a', EVIDENCE_SITE_ORIGIN: 'b' }).name,
    'PUBLISHER_SITE_ORIGIN',
  );
  const shadowed = resolveEnvName(entry, {
    PUBLISHER_SITE_ORIGIN: '',
    EVIDENCE_SITE_ORIGIN: 'https://prior-era.example.org',
  });
  assert.equal(shadowed.name, 'PUBLISHER_SITE_ORIGIN');
  assert.equal(shadowed.raw, '');
  assert.equal(shadowed.viaPriorEra, false);

  const env = envWithAllRequired();
  env.PUBLISHER_SITE_ORIGIN = '';
  env.EVIDENCE_SITE_ORIGIN = 'https://prior-era.example.org';
  const result = evaluateEnv(env);
  assert.equal(result.ok, false, 'an emptied canonical name is a miss, not a fall-through');
  assert.deepEqual(result.missingRequired.map((r) => r.name), ['PUBLISHER_SITE_ORIGIN']);
});

test('two-name expand: every publisher variable in the census is declared with both names', () => {
  // The census is Appendix J's environment row (typed-standards-specification.md
  // §Appendix J): fourteen variables at the time the vocabulary settlement
  // shipped. This inventory used to hold thirteen — PUBLIC_KEY is written by
  // the keygen script and never read, so an inventory derived from
  // `process.env.*` reads could not see it — then fourteen once PUBLIC_KEY
  // was added.
  //
  // civic-ai-tools#155 P1b retired PUBLISHER_TRUST_REGISTRY_URL /
  // EVIDENCE_TRUST_REGISTRY_URL outright (it fed a dead on-disk-read/
  // HTTP-fetch fallback in loadTrustRegistry that P1 measured as unreachable
  // on every real call path; the owner ruled to retire rather than repair).
  // That drops this inventory to thirteen. Appendix J's shipped census still
  // says fourteen and still lists EVIDENCE_TRUST_REGISTRY_URL — this test
  // now diverges from that normative table on purpose, tracking the
  // reference implementation's actual (smaller) surface. Reconciling
  // Appendix J's census with the retirement is an owner-level spec decision
  // out of scope for P1b; flagged at the P1b gate, not resolved here.
  const publisherEntries = ENV_SPEC.filter((s) => s.name.startsWith('PUBLISHER_'));
  assert.equal(publisherEntries.length, 13, 'civic-ai-tools#155 P1b retired PUBLISHER_TRUST_REGISTRY_URL, dropping the census from fourteen to thirteen');
  for (const entry of publisherEntries) {
    assert.equal(
      entry.priorEraName,
      entry.name.replace(/^PUBLISHER_/, 'EVIDENCE_'),
      `${entry.name} must declare its prior-era spelling`,
    );
  }
  // Nothing is left behind under the old prefix.
  assert.deepEqual(
    ENV_SPEC.filter((s) => s.name.startsWith('EVIDENCE_')).map((s) => s.name),
    [],
  );
});

// --- The model credential's two names (website#30 P1, D4) --------------------

test('MODEL_API_KEY alone satisfies the run', () => {
  const env = envWithAllRequired(); // sets the canonical name
  assert.ok(env.MODEL_API_KEY, 'the canonical name is the one the spec declares');
  assert.equal(env.OPENROUTER_API_KEY, undefined);
  const result = evaluateEnv(env);
  assert.equal(result.ok, true);
  assert.ok(!result.missingRequired.some((r) => r.canonicalName === 'MODEL_API_KEY'));
  // Nothing deprecated is reported when only the canonical name is set.
  assert.ok(!result.deprecatedNames.some((r) => r.canonicalName === 'MODEL_API_KEY'));
});

test('OPENROUTER_API_KEY alone satisfies the run and warns via viaPriorEra', () => {
  const env = envWithAllRequired();
  delete env.MODEL_API_KEY;
  env.OPENROUTER_API_KEY = 'present';
  const result = evaluateEnv(env);
  assert.equal(result.ok, true, 'an instance that never renamed still passes');

  const row = result.rows.find((r) => r.canonicalName === 'MODEL_API_KEY');
  assert.equal(row.present, true);
  assert.equal(row.name, 'OPENROUTER_API_KEY', 'the report names the variable the operator set');
  assert.equal(row.viaPriorEra, true);

  const deprecated = result.deprecatedNames.find((r) => r.canonicalName === 'MODEL_API_KEY');
  assert.ok(deprecated, 'the prior-era spelling is reported as deprecated');
  assert.equal(deprecated.name, 'OPENROUTER_API_KEY');

  const report = renderReport(result);
  assert.match(report, /OPENROUTER_API_KEY → rename to MODEL_API_KEY/);
  // A NOTE, never a failure — expand-before-flip: nothing flips in this phase.
  assert.ok(!report.includes('RESULT: FAIL'));
});

test('both names set resolves to the canonical one, without error', () => {
  const env = envWithAllRequired();
  env.OPENROUTER_API_KEY = 'prior-era';
  const result = evaluateEnv(env);
  assert.equal(result.ok, true);
  const row = result.rows.find((r) => r.canonicalName === 'MODEL_API_KEY');
  assert.equal(row.name, 'MODEL_API_KEY');
  assert.equal(row.viaPriorEra, false);
  assert.ok(!result.deprecatedNames.some((r) => r.canonicalName === 'MODEL_API_KEY'));

  // Same DEFINED-not-truthy precedence as the publisher set: an emptied
  // canonical name shadows a prior-era name that still holds a value. The rule
  // must match src/lib/model-client.ts, which resolves the credential the same
  // way — a preflight that fell through on empty would PASS a configuration
  // the app refuses.
  const entry = ENV_SPEC.find((s) => s.name === 'MODEL_API_KEY');
  const shadowed = resolveEnvName(entry, { MODEL_API_KEY: '', OPENROUTER_API_KEY: 'prior-era' });
  assert.equal(shadowed.name, 'MODEL_API_KEY');
  assert.equal(shadowed.raw, '');
  assert.equal(shadowed.viaPriorEra, false);

  env.MODEL_API_KEY = '';
  assert.equal(evaluateEnv(env).ok, false, 'an emptied canonical name is a miss, not a fall-through');
});

// --- The model seam (website#30 P1) -----------------------------------------

test('the model seam is a declared driver seam whose default is the current behavior', () => {
  assert.deepEqual(DRIVER_SEAMS.model, {
    env: 'MODEL_API_KIND',
    default: 'openai-compatible',
    values: ['openai-compatible', 'azure-openai'],
  });
  // Unset, the profile is still the default one: no banner, nothing promoted.
  const result = evaluateEnv(envWithAllRequired());
  assert.equal(result.profile.drivers.model, 'openai-compatible');
  assert.equal(result.profile.isDefault, true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.notApplicable, []);
});

test('MODEL_API_KIND=azure-openai promotes the version, the resource endpoint and the catalog to HARD misses', () => {
  const env = { ...envWithAllRequired(), MODEL_API_KIND: 'azure-openai' };
  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  const missing = result.missingRequired.map((r) => r.name).sort();
  // The catalog joins the promotion in website#30 P2: off the built-in
  // endpoint the coded model list names slugs that may resolve to nothing, and
  // the identity it would put in a signed record would be a guess.
  assert.deepEqual(missing, [
    'MODEL_API_BASE_URL',
    'MODEL_API_VERSION',
    'MODEL_CATALOG',
    'MODEL_CATALOG_PATH',
  ]);
  // MODEL_API_BASE_URL declares hasFallback for the DEFAULT dialect. The
  // promotion must drop that claim, or the row lands in the soft
  // `requiredOnFallback` bucket and the run PASSES a configuration
  // src/lib/model-client.ts refuses at the first request. Same for the catalog.
  for (const name of ['MODEL_API_BASE_URL', 'MODEL_CATALOG', 'MODEL_CATALOG_PATH']) {
    assert.ok(!result.requiredOnFallback.some((r) => r.name === name), `${name} is a hard miss`);
  }

  env.MODEL_API_BASE_URL = 'https://example-resource.example.net';
  env.MODEL_API_VERSION = '2099-01-01-preview';
  env.MODEL_CATALOG = '[]';
  const configured = evaluateEnv(env);
  assert.equal(configured.ok, true);
  assert.match(renderReport(configured), /PROFILE:.*model=azure-openai/);
});

test('either catalog delivery satisfies the azure promotion — the alternative blocks it', () => {
  // The two forms carry one schema and the app REFUSES both being set, so a
  // promotion that demanded both would fail a correctly-configured instance.
  const base = {
    ...envWithAllRequired(),
    MODEL_API_KIND: 'azure-openai',
    MODEL_API_BASE_URL: 'https://example-resource.example.net',
    MODEL_API_VERSION: '2099-01-01-preview',
  };
  for (const delivered of ['MODEL_CATALOG', 'MODEL_CATALOG_PATH']) {
    const result = evaluateEnv({ ...base, [delivered]: 'present' });
    assert.equal(result.ok, true, `${delivered} alone should satisfy the promotion`);
    assert.deepEqual(result.missingRequired.map((r) => r.name), []);
  }
  // Neither delivered: both are named, so the operator can see both options.
  const neither = evaluateEnv(base);
  assert.equal(neither.ok, false);
  assert.deepEqual(neither.missingRequired.map((r) => r.name).sort(), [
    'MODEL_CATALOG',
    'MODEL_CATALOG_PATH',
  ]);
});

test('REGRESSION: the catalog rows are inert in the default profile', () => {
  // The CONSTRAINT on ENV_SPEC: with every selector at its default, resolveSpec
  // is the identity transform, so neither the promotion nor its blocker fires.
  const result = evaluateEnv(envWithAllRequired());
  assert.equal(result.ok, true);
  for (const name of ['MODEL_CATALOG', 'MODEL_CATALOG_PATH']) {
    const row = result.rows.find((r) => r.name === name);
    assert.equal(row.tier, 'optional', `${name} stays optional under the built-in endpoint`);
    assert.equal(row.hasFallback, true, `${name} keeps its fallback claim there`);
    assert.ok(!result.missingRequired.some((r) => r.name === name));
    assert.ok(!result.missingRecommended.some((r) => r.name === name));
  }
});

test('the promotion is inert for every row that does not declare both fields', () => {
  // The `hasFallback`-dropping promotion is a shared code path. It can only
  // change a row that declares a promotion AND a fallback claim, and every
  // such row belongs to the model seam this sprint added. Both promotion
  // fields are counted since website#30 P6 added the second one.
  const both = ENV_SPEC.filter(
    (s) => (s.requiredWhen || s.requiredWhenCustomized) && s.hasFallback,
  ).map((s) => s.name);
  assert.deepEqual(both, ['MODEL_API_BASE_URL', 'MODEL_CATALOG', 'MODEL_CATALOG_PATH']);
});

test('the catalog rows are declared as the two deliveries of one document', () => {
  const inline = ENV_SPEC.find((s) => s.name === 'MODEL_CATALOG');
  const file = ENV_SPEC.find((s) => s.name === 'MODEL_CATALOG_PATH');
  assert.deepEqual(inline.requiredUnlessAllPresent, ['MODEL_CATALOG_PATH']);
  assert.deepEqual(file.requiredUnlessAllPresent, ['MODEL_CATALOG']);
  // Read by the server process, not at build time and not by an external tool.
  assert.equal(inline.readBy, undefined);
  assert.equal(file.readBy, undefined);
});

// --- website#30 P6 F2: preflight refuses what the app refuses -------------
//
// THE MEASURED DEFECT. The app requires a catalog for ANY endpoint that is not
// the built-in default, under BOTH dialects (`isBuiltInEndpoint` and
// `loadCatalog` in src/lib/model-resolver.ts). The seam expressed only the
// azure half, and a seam is the only thing `conditionMet` can read — so
// `openai-compatible` + a custom MODEL_API_BASE_URL + no catalog reported
// `RESULT: PASS` here and was refused by the app at the first request, with
// `MODEL_CATALOG is required…`. That is the exact failure a preflight exists
// to prevent, on the check docs/instance-setup.md §5.3 makes step 1.

const CUSTOM_ENDPOINT = 'https://gateway.example.net/v1';

test('#30 P6 F2: a custom endpoint under the DEFAULT dialect promotes the catalog', () => {
  const env = { ...envWithAllRequired(), MODEL_API_BASE_URL: CUSTOM_ENDPOINT };
  const result = evaluateEnv(env);

  // The run fails, which is the whole point: this configuration cannot answer
  // a query, and the operator learns it here instead of at the first request.
  assert.equal(result.ok, false);
  for (const name of ['MODEL_CATALOG', 'MODEL_CATALOG_PATH']) {
    assert.ok(
      result.missingRequired.some((r) => r.name === name),
      `${name} is a hard miss against an endpoint the built-in list does not describe`,
    );
    const row = result.rows.find((r) => r.canonicalName === name);
    assert.equal(row.tier, 'required');
    // The promotion drops the fallback claim exactly as the seam's does — the
    // built-in catalog IS the fallback, and it is not admissible here. Left in
    // place, the row lands in the soft `requiredOnFallback` bucket below and
    // the run PASSES the configuration the app refuses.
    assert.equal(row.hasFallback, false);
    assert.ok(
      !result.requiredOnFallback.some((r) => r.name === name),
      `${name} must not land in the soft bucket, which would PASS the run`,
    );
  }

  // The dialect is still the default one: this promotion is not a disguised
  // driver change, and the profile line still reads openai-compatible.
  assert.equal(result.profile.drivers.model, 'openai-compatible');

  const report = renderReport(result);
  assert.ok(report.includes('RESULT: FAIL'));
  // SECRET HYGIENE. The condition is the one place this script reads a value
  // other than a driver selector. It is compared and discarded: the endpoint
  // must not appear anywhere in the output.
  assert.ok(!report.includes(CUSTOM_ENDPOINT), 'the endpoint value is never echoed');
  assert.ok(!report.includes('gateway.example.net'), 'not even its host');
});

test('#30 P6 F2: either catalog delivery satisfies the custom-endpoint promotion', () => {
  for (const delivered of ['MODEL_CATALOG', 'MODEL_CATALOG_PATH']) {
    const env = {
      ...envWithAllRequired(),
      MODEL_API_BASE_URL: CUSTOM_ENDPOINT,
      [delivered]: delivered === 'MODEL_CATALOG' ? '[]' : '/etc/civicaitools/models.json',
    };
    const result = evaluateEnv(env);
    assert.equal(result.ok, true, `${delivered} alone satisfies the need`);
    // The sibling is demoted rather than demanded: the app REFUSES both being
    // set, so promoting the absent one would fail a correct instance.
    assert.ok(!result.missingRequired.some((r) => r.name.startsWith('MODEL_CATALOG')));
  }
});

test('#30 P6 F2: the comparison agrees with the app’s own read of the variable', () => {
  // `getModelApiBaseUrl()` is `process.env.MODEL_API_BASE_URL || DEFAULT`, so:
  // unset and empty both mean the default, and every other string — the
  // default written out, a trailing slash, whitespace — is read literally.
  // A preflight that resolved any of these differently would pass a
  // configuration the app refuses, or fail one it accepts.
  const base = envWithAllRequired();
  const promoted = (env) =>
    evaluateEnv(env).rows.find((r) => r.canonicalName === 'MODEL_CATALOG').tier === 'required';

  assert.equal(promoted({ ...base }), false, 'unset is the built-in endpoint');
  assert.equal(promoted({ ...base, MODEL_API_BASE_URL: '' }), false, 'empty falls back');
  assert.equal(
    promoted({ ...base, MODEL_API_BASE_URL: BUILT_IN_MODEL_BASE_URL }),
    false,
    'the default written out explicitly is still the default',
  );
  assert.equal(
    promoted({ ...base, MODEL_API_BASE_URL: `${BUILT_IN_MODEL_BASE_URL}/` }),
    true,
    'a trailing slash is a different string to the app, so it is one here',
  );
  assert.equal(promoted({ ...base, MODEL_API_BASE_URL: CUSTOM_ENDPOINT }), true);
});

test('#30 P6 F2: the coded default this script compares against is the app’s', () => {
  // A DUPLICATED LITERAL — this script is .mjs and cannot import TypeScript.
  // A stale copy would promote the catalog for an instance the app considers
  // default, or fail to promote for one it does not, which is the same class
  // of disagreement the two-name precedence rule is written to avoid. So it is
  // asserted against the source of record rather than kept in step by hand.
  const source = readFileSync(
    new URL('../src/lib/model-client.ts', import.meta.url),
    'utf8',
  );
  const match = source.match(/export const DEFAULT_BASE_URL = '([^']+)'/);
  assert.ok(match, 'model-client.ts should declare DEFAULT_BASE_URL');
  assert.equal(BUILT_IN_MODEL_BASE_URL, match[1]);
});

test('#30 P6 F2: the default profile is untouched by the new condition', () => {
  // The standing constraint on every conditional field: with no selector set
  // and nothing customized, the resolved spec is the declared one.
  const { applicable, notApplicable } = resolveSpec(
    resolveDrivers({}).drivers,
    ENV_SPEC,
    envWithAllRequired(),
  );
  assert.equal(notApplicable.length, 0);
  assert.deepEqual(
    applicable.map((s) => `${s.name}:${s.tier}:${s.hasFallback ?? false}`),
    ENV_SPEC.map((s) => `${s.name}:${s.tier}:${s.hasFallback ?? false}`),
  );
});

test('an unrecognized MODEL_API_KIND fails the run and is never echoed', () => {
  const env = { ...envWithAllRequired(), MODEL_API_KIND: 'anthropic-native-SENTINEL' };
  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  assert.ok(result.driverErrors.includes('MODEL_API_KIND'));
  const report = renderReport(result);
  assert.ok(!report.includes('anthropic-native-SENTINEL'), 'the offending value never reaches the report');
  assert.ok(report.includes('MODEL_API_KIND'));
  // Resolution falls back to the seam default so the rest of the table renders.
  assert.equal(result.profile.drivers.model, 'openai-compatible');
});

test('missing recommended variables do not fail the run', () => {
  const env = envWithAllRequired(); // recommended vars all absent
  const result = evaluateEnv(env);
  assert.equal(result.ok, true);
  assert.equal(result.missingRecommended.length, RECOMMENDED_NO_FALLBACK.length);
});

test('web#194 #6: a recommended variable with a coded fallback is not nagged as degraded', () => {
  // A fallback-backed variable is not a degraded feature — the code runs on
  // its built-in default. The report used to list these anyway.
  const result = evaluateEnv(envWithAllRequired());
  const named = result.missingRecommended.map((r) => r.name);
  for (const name of RECOMMENDED_WITH_FALLBACK) {
    assert.ok(!named.includes(name), `${name} has a coded fallback and must not be nagged`);
  }
  // …and the ones that genuinely degrade are still named.
  assert.deepEqual(named.sort(), [...RECOMMENDED_NO_FALLBACK].sort());
  assert.ok(RECOMMENDED_WITH_FALLBACK.length > 0, 'the exclusion is exercised, not vacuous');
  assert.ok(RECOMMENDED_NO_FALLBACK.length > 0, 'the nag still has something to say');
  // The two sets partition the recommended tier — nothing is counted twice or
  // dropped by the split.
  assert.deepEqual(
    [...RECOMMENDED_WITH_FALLBACK, ...RECOMMENDED_NO_FALLBACK].sort(),
    [...RECOMMENDED].sort(),
  );
});

test('web#194 #2: CRON_SECRET is recommended, and its purpose names the job that exists', () => {
  // The only scheduled job in the tree is the orphan-blob sweep
  // (vercel.json → src/app/api/cron/blob-gc/route.ts), which fails closed on
  // an absent secret. The prior purpose text also named a "portal refresh"
  // endpoint that does not exist.
  const entry = ENV_SPEC.find((s) => s.name === 'CRON_SECRET');
  assert.equal(entry.tier, 'recommended');
  assert.ok(!entry.hasFallback, 'a dead cron job is not a coded fallback');
  assert.ok(!/portal refresh/i.test(entry.purpose), 'the phantom endpoint is gone');
  assert.match(entry.purpose, /orphan-blob GC/);
  // Absent, it is named as a degraded feature — and never fails the run.
  const result = evaluateEnv(envWithAllRequired());
  assert.equal(result.ok, true);
  assert.ok(result.missingRecommended.some((r) => r.name === 'CRON_SECRET'));
});

test('web#194 #5: the DB_DRIVER hazard renders in the report, not only in a code comment', () => {
  const entry = ENV_SPEC.find((s) => s.name === 'DB_DRIVER');
  assert.match(entry.purpose, /Unset silently selects the managed serverless driver/);
  assert.ok(renderReport(evaluateEnv(envWithAllRequired())).includes('Unset silently selects'));
});

test('D9: NEXTAUTH_URL stays required and declares no fallback', () => {
  // Ruled at sprint #30 G0. The three app-side origins (api-auth.ts,
  // device-flow.ts, evidence/verify.ts) are request-derived values, not
  // configuration, and NextAuth's own inference covers only one platform — so
  // a declared fallback would pass an instance whose OAuth callbacks are
  // broken.
  const entry = ENV_SPEC.find((s) => s.name === 'NEXTAUTH_URL');
  assert.equal(entry.tier, 'required');
  assert.ok(!entry.hasFallback);
  assert.match(entry.purpose, /request-derived, not configuration/);

  const env = envWithAllRequired();
  delete env.NEXTAUTH_URL;
  const result = evaluateEnv(env);
  assert.equal(result.ok, false, 'an absent callback URL is a hard miss, not a soft note');
  assert.ok(result.missingRequired.some((r) => r.name === 'NEXTAUTH_URL'));
  assert.ok(!result.requiredOnFallback.some((r) => r.name === 'NEXTAUTH_URL'));
});

test('#4b (already shipped): CIVICAITOOLS_SESSION_TOKEN is untouched by this pass', () => {
  const entry = ENV_SPEC.find((s) => s.name === 'CIVICAITOOLS_SESSION_TOKEN');
  assert.deepEqual(entry, {
    name: 'CIVICAITOOLS_SESSION_TOKEN',
    readBy: 'external-tool',
    tier: 'optional',
    purpose: 'publish-record skill (Claude Code) auth',
  });
});

test('renderReport never emits a variable value — only names and statuses', () => {
  const env = envWithAllRequired();
  // Use a recognizable sentinel value; it must never appear in the report.
  env.MODEL_API_KEY = 'sk-SECRET-SENTINEL-DO-NOT-LEAK';
  const report = renderReport(evaluateEnv(env));
  assert.ok(!report.includes('SECRET-SENTINEL'), 'report must not contain any env value');
  assert.ok(report.includes('MODEL_API_KEY'), 'report should list the variable name');
  assert.ok(report.includes('PASS'), 'report should show an overall PASS');
});

test('every spec entry has a known tier and a purpose', () => {
  for (const s of ENV_SPEC) {
    assert.ok(['required', 'recommended', 'optional'].includes(s.tier), `${s.name} has a valid tier`);
    assert.ok(typeof s.purpose === 'string' && s.purpose.length > 0, `${s.name} has a purpose`);
  }
});

// `readBy` is what scripts/check-compose-env.mjs uses to decide HOW a
// deployment must deliver a variable (container environment, build argument,
// or neither). An unrecognized value would be read as the default — "the
// server reads this at run time" — and could send a build-time variable down
// a path that cannot deliver it: documented, and inert.
test('every readBy marker is one of the known consumption sites', () => {
  for (const s of ENV_SPEC) {
    if (s.readBy === undefined) continue;
    assert.ok(
      ['build', 'build-and-runtime', 'external-tool'].includes(s.readBy),
      `${s.name}.readBy is a known value (got ${s.readBy})`,
    );
  }
});

// Both build tiers can arrive as an unpassed build argument, which the code
// must be able to treat as absence. Every NEXT_PUBLIC_* value is inlined at
// build by definition, so none of them may be marked run-time-only.
test('every NEXT_PUBLIC_ variable is marked as read at build time', () => {
  for (const s of ENV_SPEC) {
    if (!s.name.startsWith('NEXT_PUBLIC_')) continue;
    assert.equal(s.readBy, 'build', `${s.name} is inlined at build and must say so`);
  }
});

test('readBy does not disturb the report: the default profile is unchanged by it', () => {
  const stripped = ENV_SPEC.map((s) => {
    const copy = { ...s };
    delete copy.readBy;
    return copy;
  });
  assert.equal(renderReport(evaluateEnv({}, stripped)), renderReport(evaluateEnv({})));
});

// --- Driver-aware resolution (instance profiles) ---------------------------

/** Env selecting the plain-Postgres + S3 + container profile. */
function selfHostedDrivers() {
  return { DB_DRIVER: 'node-postgres', BLOB_DRIVER: 's3', EXECUTOR_DRIVER: 'container' };
}

/** Names the S3 driver hard-throws on (src/lib/storage/s3.ts:67-69). */
const S3_CREDENTIALS = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
/** Variables only the vercel-sandbox executor driver reads. */
const SANDBOX_ONLY = ['SANDBOX_SNAPSHOT_ID', 'VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'];

function tierOf(rows, name) {
  return rows.find((r) => r.name === name)?.tier;
}

test('every conditional field names a known seam and a known driver value', () => {
  for (const s of ENV_SPEC) {
    for (const field of ['onlyWhen', 'requiredWhen']) {
      if (!s[field]) continue;
      for (const [seam, driver] of Object.entries(s[field])) {
        assert.ok(DRIVER_SEAMS[seam], `${s.name}.${field} names a known seam (${seam})`);
        assert.ok(
          DRIVER_SEAMS[seam].values.includes(driver),
          `${s.name}.${field}.${seam} names a known driver (${driver})`,
        );
      }
    }
  }
});

test('unset selectors resolve to the coded defaults and report as the default profile', () => {
  const { drivers, errors, isDefault } = resolveDrivers({});
  assert.equal(isDefault, true);
  assert.deepEqual(errors, []);
  for (const [seam, def] of Object.entries(DRIVER_SEAMS)) {
    assert.equal(drivers[seam], def.default, `${seam} defaults to ${def.default}`);
  }
});

test('REGRESSION: the default profile resolves the spec unchanged (identity transform)', () => {
  const { drivers } = resolveDrivers({});
  const { applicable, notApplicable } = resolveSpec(drivers);
  assert.deepEqual(applicable, ENV_SPEC, 'no entry is dropped, retiered, or reordered');
  assert.deepEqual(notApplicable, [], 'nothing is suppressed under the default profile');
});

test('REGRESSION: selectors set explicitly to their defaults match unset, byte for byte', () => {
  const base = envWithAllRequired();
  const explicit = { ...base };
  for (const def of Object.values(DRIVER_SEAMS)) explicit[def.env] = def.default;

  const unsetResult = evaluateEnv(base);
  const explicitResult = evaluateEnv(explicit);
  assert.equal(explicitResult.profile.isDefault, true);
  assert.deepEqual(
    explicitResult.rows.map((r) => [r.name, r.tier]),
    unsetResult.rows.map((r) => [r.name, r.tier]),
  );
  // The profile banner must not appear for a default profile — that is what
  // keeps the report identical to the pre-driver-awareness output.
  assert.ok(!renderReport(unsetResult).includes('PROFILE:'));
  assert.ok(!renderReport(explicitResult).includes('PROFILE:'));
});

test('BLOB_DRIVER=s3 promotes the S3 credentials to required', () => {
  const env = { ...envWithAllRequired(), BLOB_DRIVER: 's3' };
  const result = evaluateEnv(env);
  for (const name of S3_CREDENTIALS) {
    assert.equal(tierOf(result.rows, name), 'required', `${name} is required under the s3 driver`);
  }
  // Absent (envWithAllRequired only fills base-tier required vars) ⇒ hard miss.
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRequired.map((r) => r.name).sort(), [...S3_CREDENTIALS].sort());
});

test('BLOB_DRIVER=s3 passes once the S3 credentials are present', () => {
  const env = { ...envWithAllRequired(), BLOB_DRIVER: 's3' };
  for (const name of S3_CREDENTIALS) env[name] = 'present';
  const result = evaluateEnv(env);
  assert.equal(result.ok, true);
});

test('the tier flip reverses: under the default blob driver the S3 credentials stay optional', () => {
  const result = evaluateEnv(envWithAllRequired()); // BLOB_DRIVER unset
  for (const name of S3_CREDENTIALS) {
    assert.equal(tierOf(result.rows, name), 'optional', `${name} is optional off the s3 driver`);
  }
  assert.equal(result.ok, true, 'absent S3 credentials do not fail the default profile');
});

test('BLOB_DRIVER=s3 suppresses the Vercel Blob token entirely (not merely demotes it)', () => {
  const env = { ...envWithAllRequired(), BLOB_DRIVER: 's3' };
  delete env.BLOB_READ_WRITE_TOKEN;
  for (const name of S3_CREDENTIALS) env[name] = 'present';
  const result = evaluateEnv(env);

  assert.equal(result.ok, true, 'an instance off Vercel Blob is not failed for its token');
  assert.equal(tierOf(result.rows, 'BLOB_READ_WRITE_TOKEN'), undefined, 'no row at all');
  assert.ok(result.notApplicable.includes('BLOB_READ_WRITE_TOKEN'));
  // "Reports nothing irrelevant": the name must not reach the rendered output.
  assert.ok(
    !renderReport(result).includes('BLOB_READ_WRITE_TOKEN'),
    'a not-applicable variable is never named in the report',
  );
});

test('EXECUTOR_DRIVER=container suppresses the sandbox-only variables', () => {
  const env = { ...envWithAllRequired(), EXECUTOR_DRIVER: 'container' };
  const result = evaluateEnv(env);
  const report = renderReport(result);
  for (const name of SANDBOX_ONLY) {
    assert.equal(tierOf(result.rows, name), undefined, `${name} has no row`);
    assert.ok(result.notApplicable.includes(name), `${name} is marked not applicable`);
    assert.ok(!report.includes(name), `${name} is not named in the report`);
  }
  // Fallback-backed under both drivers, so it stays listed either way.
  assert.equal(tierOf(result.rows, 'EXECUTOR_CONTAINER_IMAGE'), 'optional');
  // A suppressed recommended var must not be counted as a degraded feature.
  assert.ok(!result.missingRecommended.some((r) => r.name === 'SANDBOX_SNAPSHOT_ID'));
});

test('the default executor driver keeps the sandbox-only variables listed', () => {
  const result = evaluateEnv(envWithAllRequired()); // EXECUTOR_DRIVER unset
  for (const name of SANDBOX_ONLY) {
    assert.notEqual(tierOf(result.rows, name), undefined, `${name} is listed under the sandbox driver`);
  }
  assert.deepEqual(result.notApplicable, []);
});

test('the self-hosted profile passes with no platform-specific variables set', () => {
  const env = { ...envWithAllRequired(), ...selfHostedDrivers() };
  delete env.BLOB_READ_WRITE_TOKEN;
  delete env.KV_REST_API_URL;
  delete env.KV_REST_API_TOKEN;
  for (const name of S3_CREDENTIALS) env[name] = 'present';

  const result = evaluateEnv(env);
  assert.equal(result.ok, true);
  assert.equal(result.profile.isDefault, false);

  const report = renderReport(result);
  assert.match(report, /PROFILE: db=node-postgres {2}blob=s3 {2}executor=container/);
  assert.match(report, /5 variable\(s\) not applicable to this profile/);
  for (const name of ['BLOB_READ_WRITE_TOKEN', ...SANDBOX_ONLY]) {
    assert.ok(!report.includes(name), `${name} is never mentioned to a self-hosted instance`);
  }
});

test('the self-hosted profile fails, naming S3_BUCKET, when the bucket is absent', () => {
  const env = { ...envWithAllRequired(), ...selfHostedDrivers() };
  delete env.BLOB_READ_WRITE_TOKEN;
  env.S3_ACCESS_KEY_ID = 'present';
  env.S3_SECRET_ACCESS_KEY = 'present'; // S3_BUCKET deliberately absent

  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRequired.map((r) => r.name), ['S3_BUCKET']);
  assert.match(renderReport(result), /RESULT: FAIL — 1 required variable\(s\) missing:/);
  assert.match(renderReport(result), /- S3_BUCKET/);
});

test('an unrecognized selector value fails the run and is never echoed', () => {
  const env = { ...envWithAllRequired(), BLOB_DRIVER: 'gopher-SENTINEL-DO-NOT-LEAK' };
  const result = evaluateEnv(env);

  assert.equal(result.ok, false, 'the app throws on this value, so preflight must not pass');
  assert.deepEqual(result.driverErrors, ['BLOB_DRIVER']);
  // Resolution falls back to the seam default so the rest of the table renders.
  assert.equal(result.profile.drivers.blob, DRIVER_SEAMS.blob.default);

  const report = renderReport(result);
  assert.ok(!report.includes('SENTINEL'), 'the offending value is never echoed');
  assert.match(report, /BLOB_DRIVER \(expected one of: vercel-blob, s3\)/);
});

// --- Alternative sets (sign-in providers; #193) -----------------------------

/** The pair that gates the GitHub provider in src/lib/auth-providers.ts. */
const GITHUB_PAIR = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'];

/** Env with a complete generic-OIDC provider triple. */
function withOidcProvider(env) {
  const out = { ...env };
  for (const name of OIDC_PROVIDER_SET) out[name] = 'present';
  return out;
}

test('every requiredUnlessAllPresent names variables the spec itself declares', () => {
  const declared = new Set(ENV_SPEC.map((s) => s.name));
  for (const s of ENV_SPEC) {
    if (!s.requiredUnlessAllPresent) continue;
    assert.ok(Array.isArray(s.requiredUnlessAllPresent), `${s.name}.requiredUnlessAllPresent is a list`);
    assert.ok(s.requiredUnlessAllPresent.length > 0, `${s.name}.requiredUnlessAllPresent is non-empty`);
    // Demotion has to be able to change something, or the field is decoration
    // that misleads a reader of the spec. It can in two shapes: the declared
    // tier is 'required' and the alternative lowers it (the sign-in
    // providers), or a `requiredWhen` promotion exists for the alternative to
    // block (the model catalog's two delivery forms, website#30 P2).
    assert.ok(
      s.tier === 'required' || s.requiredWhen,
      `${s.name} declares 'required', or a requiredWhen the alternative can block, so the demotion is meaningful`,
    );
    for (const name of s.requiredUnlessAllPresent) {
      assert.ok(declared.has(name), `${s.name} names a declared variable (${name})`);
    }
  }
});

test('the GitHub pair carries the OIDC alternative condition', () => {
  for (const name of GITHUB_PAIR) {
    const entry = ENV_SPEC.find((s) => s.name === name);
    assert.deepEqual(entry.requiredUnlessAllPresent, OIDC_PROVIDER_SET);
  }
});

test('REGRESSION: an incomplete OIDC triple leaves the GitHub pair required', () => {
  // Every strict subset of the triple, plus none of it at all.
  const partials = [
    {},
    { OIDC_ISSUER: 'present' },
    { OIDC_ISSUER: 'present', OIDC_CLIENT_ID: 'present' },
    { OIDC_CLIENT_ID: 'present', OIDC_CLIENT_SECRET: 'present' },
  ];
  for (const partial of partials) {
    const env = { ...envWithAllRequired(), ...partial };
    for (const name of GITHUB_PAIR) delete env[name];
    const result = evaluateEnv(env);
    const which = JSON.stringify(Object.keys(partial));
    for (const name of GITHUB_PAIR) {
      assert.equal(tierOf(result.rows, name), 'required', `${name} stays required for ${which}`);
    }
    assert.equal(result.ok, false, `an instance with no working provider fails for ${which}`);
    assert.deepEqual(result.missingRequired.map((r) => r.name).sort(), [...GITHUB_PAIR].sort());
  }
});

test('a complete OIDC triple demotes the GitHub pair to optional and passes without it', () => {
  const env = withOidcProvider(envWithAllRequired());
  for (const name of GITHUB_PAIR) delete env[name];

  const result = evaluateEnv(env);
  assert.equal(result.ok, true, 'an OIDC-only instance has a working provider and must pass');
  for (const name of GITHUB_PAIR) {
    assert.equal(tierOf(result.rows, name), 'optional', `${name} is optional for an OIDC-only instance`);
  }
  // Demoted to 'optional', NOT 'recommended': an absent GitHub pair on an
  // OIDC-only instance is a configuration choice, not a degraded feature, so
  // it must not appear in the "feature(s) will degrade" note.
  assert.ok(!result.missingRecommended.some((r) => GITHUB_PAIR.includes(r.name)));
  const report = renderReport(result);
  // The degrade note exists (other recommended vars are absent in this env);
  // what matters is that neither GitHub variable is named inside it.
  const degradeNote = report.slice(report.indexOf('will degrade'));
  for (const name of GITHUB_PAIR) {
    assert.ok(!degradeNote.includes(name), `${name} is not nagged about as a degraded feature`);
  }
  // Still listed in the table, so the operator can see GitHub remains
  // available to add alongside OIDC.
  assert.match(report, /GITHUB_CLIENT_ID/);
});

test('the demotion is presence-driven, not order-driven: whitespace-only OIDC vars do not count', () => {
  const env = { ...envWithAllRequired(), ...withOidcProvider({}) };
  env.OIDC_CLIENT_SECRET = '   '; // present-but-blank is absent everywhere else too
  for (const name of GITHUB_PAIR) delete env[name];

  const result = evaluateEnv(env);
  assert.equal(result.ok, false);
  for (const name of GITHUB_PAIR) {
    assert.equal(tierOf(result.rows, name), 'required');
  }
});

test('REGRESSION: resolveSpec without an env argument never demotes (identity preserved)', () => {
  const { drivers } = resolveDrivers({});
  const { applicable } = resolveSpec(drivers); // no env passed
  assert.deepEqual(applicable, ENV_SPEC);
});

// --- The app front door's two new knobs -------------------------------------

test('the sign-in gate and app-tier knobs are optional with coded fallbacks', () => {
  // Both reproduce today's behavior when unset — SIGN_IN_ALLOWLIST leaves
  // sign-in open, APP_TIER_RATE_LIMIT falls back to the authenticated limit —
  // so neither may ever fail or nag a run.
  for (const name of ['SIGN_IN_ALLOWLIST', 'APP_TIER_RATE_LIMIT']) {
    const entry = ENV_SPEC.find((s) => s.name === name);
    assert.ok(entry, `${name} is enumerated`);
    assert.equal(entry.tier, 'optional', `${name} is optional`);
    assert.equal(entry.hasFallback, true, `${name} has a coded fallback`);
  }
  const result = evaluateEnv(envWithAllRequired()); // both absent
  assert.equal(result.ok, true);
  assert.ok(!result.missingRecommended.some((r) => r.name === 'SIGN_IN_ALLOWLIST'));
  assert.ok(!result.missingRecommended.some((r) => r.name === 'APP_TIER_RATE_LIMIT'));
});

test('all four host-topology variables are optional with coded fallbacks (unset = the portable default)', () => {
  // All four have coded defaults, so none may ever fail or nag a run (the P3
  // seam convention, same shape as the sign-in gate above). What unset MEANS
  // changed in #259 P3 — the default is now app-only rather than passthrough —
  // but it still means a working instance, which is what this asserts.
  // SERVE_MARKETING joins the loop here: it was enumerated in the spec module
  // and exercised by the compose-env check, but sat outside this assertion.
  const TOPOLOGY = ['APP_HOST', 'MARKETING_HOST', 'APP_ONLY', 'SERVE_MARKETING'];
  for (const name of TOPOLOGY) {
    const entry = ENV_SPEC.find((s) => s.name === name);
    assert.ok(entry, `${name} is enumerated`);
    assert.equal(entry.tier, 'optional', `${name} is optional`);
    assert.equal(entry.hasFallback, true, `${name} has a coded fallback`);
  }
  const result = evaluateEnv(envWithAllRequired()); // all four absent
  assert.equal(result.ok, true);
  for (const name of TOPOLOGY) {
    assert.ok(!result.missingRequired.some((r) => r.name === name));
    assert.ok(!result.missingRecommended.some((r) => r.name === name));
  }
});

test('a configured allowlist is never echoed — only the variable name', () => {
  const env = { ...envWithAllRequired(), SIGN_IN_ALLOWLIST: '4242,oidc:https://idp.example.org:SENTINEL' };
  const report = renderReport(evaluateEnv(env));
  assert.ok(!report.includes('SENTINEL'), 'allowlist entries are identities — never printed');
  assert.ok(!report.includes('4242'));
  assert.ok(report.includes('SIGN_IN_ALLOWLIST'));
});

test('the durable rate-limit counter is soft: absent, the run still passes', () => {
  // rate-limit.ts:53-63 takes an in-process memory store when either is absent.
  const env = envWithAllRequired();
  delete env.KV_REST_API_URL;
  delete env.KV_REST_API_TOKEN;
  const result = evaluateEnv(env);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.requiredOnFallback.map((r) => r.name).filter((n) => n.startsWith('KV_')),
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  );
});

// --- All-or-nothing groups (#195) -------------------------------------------

test('every group member is declared in ENV_SPEC and every group condition names a known seam/driver', () => {
  const declared = new Set(ENV_SPEC.map((s) => s.name));
  for (const g of ENV_GROUPS) {
    assert.ok(typeof g.name === 'string' && g.name.length > 0, 'group has a name');
    assert.ok(typeof g.feature === 'string' && g.feature.length > 0, `${g.name} names its feature`);
    assert.ok(Array.isArray(g.members) && g.members.length >= 2, `${g.name} has at least two members`);
    for (const name of g.members) {
      assert.ok(declared.has(name), `${g.name} member ${name} is declared in ENV_SPEC`);
    }
    if (!g.onlyWhen) continue;
    for (const [seam, driver] of Object.entries(g.onlyWhen)) {
      assert.ok(DRIVER_SEAMS[seam], `${g.name}.onlyWhen names a known seam (${seam})`);
      assert.ok(
        DRIVER_SEAMS[seam].values.includes(driver),
        `${g.name}.onlyWhen.${seam} names a known driver (${driver})`,
      );
    }
  }
});

test('a partially set group warns, naming exactly the missing members, and never fails the run', () => {
  const env = envWithAllRequired();
  env.VERCEL_TOKEN = 'present';
  env.VERCEL_TEAM_ID = 'present'; // VERCEL_PROJECT_ID deliberately absent
  const result = evaluateEnv(env);

  assert.equal(result.ok, true, 'a partial group warns; it must not fail the run');
  const partial = result.partialGroups.find((g) => g.name === 'Vercel Sandbox off-platform auth');
  assert.ok(partial, 'the sandbox trio is reported as partial');
  assert.equal(partial.total, 3);
  assert.deepEqual(partial.present.sort(), ['VERCEL_TEAM_ID', 'VERCEL_TOKEN']);
  assert.deepEqual(partial.missing, ['VERCEL_PROJECT_ID']);

  const report = renderReport(result);
  assert.match(report, /WARN: 1 all-or-nothing variable group\(s\) partially set/);
  assert.match(report, /Vercel Sandbox off-platform auth: 2 of 3 present; off until all 3 are set\. Missing: VERCEL_PROJECT_ID/);
});

test('complete groups and untouched groups do not warn (the default full-required env is warning-free)', () => {
  // envWithAllRequired sets the GitHub pair and the KV pair completely and
  // leaves the OIDC triple and the sandbox trio empty — no group is partial.
  const result = evaluateEnv(envWithAllRequired());
  assert.deepEqual(result.partialGroups, []);
  assert.ok(!renderReport(result).includes('WARN'), 'no WARN block when no group is partial');
});

test('a group is not checked when its profile never reads its members (container executor)', () => {
  const env = { ...envWithAllRequired(), EXECUTOR_DRIVER: 'container' };
  env.VERCEL_TOKEN = 'present'; // would be a partial trio under vercel-sandbox
  const result = evaluateEnv(env);
  assert.ok(
    !result.partialGroups.some((g) => g.name === 'Vercel Sandbox off-platform auth'),
    'the sandbox-auth group is skipped for a container-executor instance',
  );
  assert.ok(!renderReport(result).includes('VERCEL_TOKEN'), 'suppressed members stay unmentioned');
});

test('a partial OIDC triple warns and carries the identity-bearing issuer note', () => {
  const env = envWithAllRequired();
  env.OIDC_ISSUER = 'present';
  env.OIDC_CLIENT_ID = 'present'; // OIDC_CLIENT_SECRET deliberately absent
  const result = evaluateEnv(env);

  const partial = result.partialGroups.find((g) => g.name === 'Generic OIDC sign-in');
  assert.ok(partial);
  assert.deepEqual(partial.missing, ['OIDC_CLIENT_SECRET']);

  const report = renderReport(result);
  assert.match(report, /Generic OIDC sign-in: 2 of 3 present/);
  assert.match(report, /not offered on the sign-in screen/);
  // The rider from #195: the issuer is part of every OIDC user's account key.
  assert.match(report, /OIDC_ISSUER is identity-bearing/);
});

test('a half-set GitHub pair on an OIDC-complete instance warns (the genuinely silent case)', () => {
  // With the OIDC triple complete the pair is demoted to optional, so this
  // partial configuration passes every tier check — the group warning is the
  // only surface that catches it.
  const env = withOidcProvider(envWithAllRequired());
  delete env.GITHUB_CLIENT_SECRET;
  const result = evaluateEnv(env);

  assert.equal(result.ok, true);
  const partial = result.partialGroups.find((g) => g.name === 'GitHub sign-in');
  assert.ok(partial, 'the half pair is reported even though its tier is optional');
  assert.deepEqual(partial.missing, ['GITHUB_CLIENT_SECRET']);
  assert.match(renderReport(result), /GitHub sign-in: 1 of 2 present; off until all 2 are set\. Missing: GITHUB_CLIENT_SECRET/);
});

test('a partial KV pair warns that durable rate limiting is off, while the run still passes', () => {
  const env = envWithAllRequired();
  delete env.KV_REST_API_TOKEN; // URL stays set — silently in-memory at run time
  const result = evaluateEnv(env);

  assert.equal(result.ok, true);
  const partial = result.partialGroups.find((g) => g.name === 'Durable rate limiting');
  assert.ok(partial);
  assert.deepEqual(partial.missing, ['KV_REST_API_TOKEN']);
  assert.match(renderReport(result), /falls back to per-process memory/);
});

test('a partially-set signing group warns, naming the missing members and the misattribution risk', () => {
  // #195 left this pair out of ENV_GROUPS because the kid then had a coded
  // fallback, so the set was not all-or-nothing. The fallback is gone and
  // `isSigningConfigured` requires both halves — and as of #258 the group
  // also carries the instance-identity set, which the seal/commit gate
  // requires alongside the pair (key + kid + identity travel together).
  const env = envWithAllRequired();
  delete env.PUBLISHER_KEY_ID; // key + identity set, kid absent — a defect state
  const result = evaluateEnv(env);

  const partial = result.partialGroups.find((g) => g.name === 'Record signing');
  assert.ok(partial, 'the partially-set signing group is reported as partial');
  assert.equal(partial.total, 7);
  assert.ok(partial.present.includes('PUBLISHER_SIGNING_KEY'));
  assert.ok(partial.present.includes('PUBLISHER_SITE_ORIGIN'));
  assert.deepEqual(partial.missing, ['PUBLISHER_KEY_ID']);

  const report = renderReport(result);
  assert.match(report, /Record signing: 6 of 7 present; off until all 7 are set\. Missing: PUBLISHER_KEY_ID/);
  assert.match(report, /cannot sign/);
  assert.match(report, /travel together/);
  // Unlike the other groups, this one ALSO fails the run — every member is
  // required with no fallback, so the warning rides on top of a hard miss.
  assert.equal(result.ok, false);
});

test('#258: the identity members of the signing group are required-tier with no coded fallback', () => {
  const IDENTITY_MEMBERS = [
    'PUBLISHER_SITE_ORIGIN',
    'PUBLISHER_SIGNER_BINDING_TIER',
    'PUBLISHER_SIGNER_IDENTIFIER',
    'PUBLISHER_SIGNER_DISPLAY_NAME',
    'PUBLISHER_PLATFORM_AGENT_TITLE',
  ];
  const group = ENV_GROUPS.find((g) => g.name === 'Record signing');
  for (const name of IDENTITY_MEMBERS) {
    const entry = ENV_SPEC.find((s) => s.name === name);
    assert.ok(entry, `${name} is declared`);
    assert.equal(entry.tier, 'required', `${name} is required (identity has no default)`);
    assert.ok(!entry.hasFallback, `${name} must not claim a coded fallback`);
    assert.ok(group.members.includes(name), `${name} travels with the signing pair`);
  }
  // A signing pair with no identity set is a partial group naming exactly
  // the five identity variables.
  const env = envWithAllRequired();
  for (const name of IDENTITY_MEMBERS) delete env[name];
  const result = evaluateEnv(env);
  const partial = result.partialGroups.find((g) => g.name === 'Record signing');
  assert.ok(partial);
  assert.deepEqual(partial.missing, IDENTITY_MEMBERS);
  assert.equal(result.ok, false, 'missing identity fails the run');
  // The DERIVED identity overrides stay optional-with-fallback: derivation
  // from an operator-set origin is real config, not a reference default.
  for (const name of [
    'PUBLISHER_PUBLICATION_HOST',
    'PUBLISHER_TRUST_REGISTRY_CANONICAL_URL',
    'PUBLISHER_TRUST_REGISTRY_LEGACY_URL',
    'PUBLISHER_PLATFORM_AGENT_ID',
    'PUBLISHER_PLATFORM_AGENT_URL',
  ]) {
    const entry = ENV_SPEC.find((s) => s.name === name);
    assert.equal(entry.tier, 'optional', `${name} stays an optional override`);
    assert.ok(entry.hasFallback, `${name} derives (coded derivation, not a reference value)`);
  }
});

test('group detection uses the same presence test as everything else: whitespace-only is absent', () => {
  const env = envWithAllRequired();
  env.OIDC_ISSUER = 'present';
  env.OIDC_CLIENT_ID = '   '; // whitespace-only must count as absent
  const result = evaluateEnv(env);
  const partial = result.partialGroups.find((g) => g.name === 'Generic OIDC sign-in');
  assert.ok(partial);
  assert.deepEqual(partial.missing.sort(), ['OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']);
});

test('group warnings never echo values — only variable names reach the report', () => {
  const env = envWithAllRequired();
  env.VERCEL_TOKEN = 'vercel-tok-SENTINEL-DO-NOT-LEAK';
  const report = renderReport(evaluateEnv(env));
  assert.ok(!report.includes('SENTINEL'), 'a group member value is never printed');
  assert.ok(report.includes('VERCEL_TEAM_ID'), 'the missing members are named');
});

test('evaluateGroups is pure and driver-aware when called directly', () => {
  const { drivers } = resolveDrivers({ EXECUTOR_DRIVER: 'container' });
  const partial = evaluateGroups({ VERCEL_TOKEN: 'present' }, drivers);
  assert.ok(!partial.some((g) => g.name === 'Vercel Sandbox off-platform auth'));
  const { drivers: defaults } = resolveDrivers({});
  const partialDefault = evaluateGroups({ VERCEL_TOKEN: 'present' }, defaults);
  assert.ok(partialDefault.some((g) => g.name === 'Vercel Sandbox off-platform auth'));
});
