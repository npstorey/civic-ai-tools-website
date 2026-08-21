// The two-name expand for the publisher-identity variables (#160 P3).
//
// Group A of the 2026-08-19 vocabulary settlement (Appendix J of the Typed
// Standards specification) moves thirteen variables from the `EVIDENCE_`
// prefix to `PUBLISHER_`, under the `expand-then-flip` migration class. (A
// fourteenth, `TRUST_REGISTRY_URL`, was also moved at the time — it was
// retired outright, not renamed, by civic-ai-tools#155 P1b; see
// `PUBLISHER_ENV_SUFFIXES`'s docstring in `publisher-env.ts`.) This file pins
// the expand half: both names are read, the canonical one wins, the
// prior-era one warns exactly once, and nothing that already worked stops.
//
// WHY THE PRECEDENCE RULE IS TESTED SO HARD. It is `defined`, not `truthy`,
// and getting that wrong is silent. `EVIDENCE_TRUST_REGISTRY_LEGACY_URL=""` is
// the documented way to OMIT the legacy registry URL from signed output, so
// empty is a VALUE in this set. A resolver that fell through on empty would
// resurrect a URL an operator deliberately suppressed — inside a signed
// artifact, where it cannot be taken back.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_ENV_PREFIX,
  PRIOR_ERA_ENV_NAMES,
  PRIOR_ERA_ENV_PREFIX,
  PUBLISHER_ENV_NAMES,
  PUBLISHER_ENV_SUFFIXES,
  canonicalEnvName,
  lookupPublisherEnv,
  priorEraEnvName,
  priorEraEnvNamesWarned,
  readPublisherEnv,
  resetPriorEraEnvWarnings,
} from './publisher-env.ts';
// The scripts side carries the same rule in its own idiom because
// `scripts/preflight-env.mjs` is run as a bare `node …` and cannot import
// TypeScript. Two implementations of one rule is exactly the shape that
// drifts, so the two censuses are pinned against each other below.
import { ENV_SPEC, resolveEnvName } from '../../scripts/preflight-env.mjs';

/** Run `fn` with `console.warn` captured. Restores the real one after. */
function captureWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

// --- The census ---------------------------------------------------------------

// civic-ai-tools#155 P1b: Appendix J's shipped environment row still says
// fourteen and still lists `EVIDENCE_TRUST_REGISTRY_URL`; that variable was
// retired outright (not renamed) here, dropping this census to thirteen.
// Reconciling the spec's count is a follow-up owner decision, not this test's.
test('the census is Appendix J\'s thirteen variables (post-#155-P1b), with no duplicates', () => {
  assert.equal(PUBLISHER_ENV_SUFFIXES.length, 13);
  assert.equal(new Set(PUBLISHER_ENV_SUFFIXES).size, 13, 'no suffix appears twice');
  assert.deepEqual(
    [...PUBLISHER_ENV_NAMES].sort(),
    [...PUBLISHER_ENV_SUFFIXES].map((s) => `${CANONICAL_ENV_PREFIX}${s}`).sort(),
  );
  assert.deepEqual(
    [...PRIOR_ERA_ENV_NAMES].sort(),
    [...PUBLISHER_ENV_SUFFIXES].map((s) => `${PRIOR_ERA_ENV_PREFIX}${s}`).sort(),
  );
  // The two names differ only by prefix — no per-variable renaming rode along
  // with the prefix change, which is what makes the whole set mechanical.
  for (const suffix of PUBLISHER_ENV_SUFFIXES) {
    assert.equal(canonicalEnvName(suffix).replace(/^PUBLISHER_/, ''), suffix);
    assert.equal(priorEraEnvName(suffix).replace(/^EVIDENCE_/, ''), suffix);
  }
});

test('the scripts-side census matches this one, name for name', () => {
  // `scripts/preflight-env.mjs` cannot import this module (it runs as a bare
  // `node scripts/preflight-env.mjs`), so it declares the pairs itself. This
  // is the only thing standing between the two lists and silent divergence —
  // and divergence here means the preflight passes a configuration the app
  // refuses, or nags about one it accepts.
  const specPairs: { name: string; priorEraName?: string }[] = ENV_SPEC.filter(
    (s: { name: string }) => s.name.startsWith(CANONICAL_ENV_PREFIX),
  );

  assert.deepEqual(
    specPairs.map((s) => s.name).sort(),
    [...PUBLISHER_ENV_NAMES].sort(),
    'ENV_SPEC and PUBLISHER_ENV_SUFFIXES declare different canonical names.\n' +
      'FIX: add or remove the entry on whichever side is behind. Both lists are\n' +
      'the same census (Appendix J, environment row) written twice because the\n' +
      'preflight script cannot import TypeScript.',
  );
  for (const { name, priorEraName } of specPairs) {
    assert.equal(
      priorEraName,
      name.replace(CANONICAL_ENV_PREFIX, PRIOR_ERA_ENV_PREFIX),
      `${name} declares a prior-era spelling this module would not produce`,
    );
  }
});

// --- Precedence ---------------------------------------------------------------

test('the canonical name is read first', () => {
  resetPriorEraEnvWarnings();
  const env = {
    PUBLISHER_SITE_ORIGIN: 'https://canonical.example.org',
    EVIDENCE_SITE_ORIGIN: 'https://prior-era.example.org',
  };
  const hit = lookupPublisherEnv('SITE_ORIGIN', env);
  assert.equal(hit.value, 'https://canonical.example.org');
  assert.equal(hit.name, 'PUBLISHER_SITE_ORIGIN');
  assert.equal(hit.viaPriorEra, false);
});

test('the prior-era name answers when the canonical one is entirely unset', () => {
  resetPriorEraEnvWarnings();
  const hit = lookupPublisherEnv('KEY_ID', { EVIDENCE_KEY_ID: 'platform:prior-era' });
  assert.equal(hit.value, 'platform:prior-era');
  assert.equal(hit.name, 'EVIDENCE_KEY_ID');
  assert.equal(hit.viaPriorEra, true);
});

test('neither name set resolves to undefined, reported under the canonical name', () => {
  resetPriorEraEnvWarnings();
  const hit = lookupPublisherEnv('KEY_ID', {});
  assert.equal(hit.value, undefined);
  assert.equal(hit.name, 'PUBLISHER_KEY_ID');
  assert.equal(hit.viaPriorEra, false);
});

test('DEFINED wins, not truthy: an empty canonical name shadows a set prior-era one', () => {
  resetPriorEraEnvWarnings();
  const hit = lookupPublisherEnv('TRUST_REGISTRY_LEGACY_URL', {
    PUBLISHER_TRUST_REGISTRY_LEGACY_URL: '',
    EVIDENCE_TRUST_REGISTRY_LEGACY_URL: 'https://example.org/.well-known/legacy.json',
  });
  assert.equal(hit.value, '', 'empty is a value in this set, not an absence');
  assert.equal(hit.viaPriorEra, false);
  // The consequence, stated: the caller that reads this omits the legacy URL
  // from the signed sidecar, which is exactly what the operator asked for.
});

test('an empty PRIOR-ERA name is still an answer — the same reason, other side', () => {
  resetPriorEraEnvWarnings();
  const hit = lookupPublisherEnv('TRUST_REGISTRY_LEGACY_URL', {
    EVIDENCE_TRUST_REGISTRY_LEGACY_URL: '',
  });
  assert.equal(hit.value, '');
  assert.equal(hit.viaPriorEra, true);
});

test('values are returned verbatim — never trimmed, normalized, or inspected', () => {
  resetPriorEraEnvWarnings();
  // Presence conventions (whitespace-only counts as absent) belong to the
  // CALLERS; a resolver that trimmed would silently rewrite a value that
  // lands in a signed field.
  assert.equal(readPublisherEnv('SIGNER_IDENTIFIER', { PUBLISHER_SIGNER_IDENTIFIER: '  x  ' }), '  x  ');
});

// --- The deprecation warning ---------------------------------------------------

test('the prior-era name warns ONCE per variable, naming its successor', () => {
  resetPriorEraEnvWarnings();
  const env = { EVIDENCE_SITE_ORIGIN: 'https://prior-era.example.org' };
  const { warnings } = captureWarnings(() => {
    readPublisherEnv('SITE_ORIGIN', env);
    readPublisherEnv('SITE_ORIGIN', env);
    readPublisherEnv('SITE_ORIGIN', env);
  });
  assert.equal(
    warnings.length,
    1,
    'once per VARIABLE, not once per read — these getters run several times ' +
      'per request, and a line each would bury the signal it exists to raise',
  );
  assert.match(warnings[0], /EVIDENCE_SITE_ORIGIN/);
  assert.match(warnings[0], /PUBLISHER_SITE_ORIGIN/);
  assert.match(warnings[0], /Both\s+names work today/);
  assert.deepEqual(priorEraEnvNamesWarned(), ['EVIDENCE_SITE_ORIGIN']);
});

test('the warning is per variable, so a second variable still warns', () => {
  resetPriorEraEnvWarnings();
  const { warnings } = captureWarnings(() => {
    readPublisherEnv('SITE_ORIGIN', { EVIDENCE_SITE_ORIGIN: 'a' });
    readPublisherEnv('KEY_ID', { EVIDENCE_KEY_ID: 'b' });
  });
  assert.equal(warnings.length, 2);
  assert.deepEqual(priorEraEnvNamesWarned(), ['EVIDENCE_KEY_ID', 'EVIDENCE_SITE_ORIGIN']);
});

test('the canonical name never warns, and neither does an unset variable', () => {
  resetPriorEraEnvWarnings();
  const { warnings } = captureWarnings(() => {
    readPublisherEnv('SITE_ORIGIN', { PUBLISHER_SITE_ORIGIN: 'a', EVIDENCE_SITE_ORIGIN: 'b' });
    readPublisherEnv('KEY_ID', {});
  });
  assert.deepEqual(warnings, []);
});

test('the warning never echoes a value — these variables include a private key', () => {
  resetPriorEraEnvWarnings();
  const { warnings } = captureWarnings(() => {
    readPublisherEnv('SIGNING_KEY', { EVIDENCE_SIGNING_KEY: 'SENTINEL-DO-NOT-LEAK' });
  });
  assert.equal(warnings.length, 1);
  assert.ok(
    !warnings[0].includes('SENTINEL'),
    'the deprecation notice must name the variable, never its value',
  );
});

test('warn:false resolves without emitting — for probes that inspect config', () => {
  resetPriorEraEnvWarnings();
  const { warnings } = captureWarnings(() => {
    lookupPublisherEnv('SITE_ORIGIN', { EVIDENCE_SITE_ORIGIN: 'a' }, false);
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual(priorEraEnvNamesWarned(), [], 'a silent probe does not consume the once');
});

// --- Agreement with the scripts-side resolver ---------------------------------

test('both resolvers answer identically across the whole precedence matrix', () => {
  // The rule is implemented twice (TypeScript here, plain JS in the preflight)
  // because the script cannot import this module. A disagreement is not a
  // cosmetic drift: the preflight would pass a configuration the app refuses.
  const suffix = 'SITE_ORIGIN' as const;
  const entry = ENV_SPEC.find(
    (s: { name: string }) => s.name === canonicalEnvName(suffix),
  ) as { name: string; priorEraName?: string };

  const cases: Record<string, string | undefined>[] = [
    {},
    { PUBLISHER_SITE_ORIGIN: 'canonical' },
    { EVIDENCE_SITE_ORIGIN: 'prior-era' },
    { PUBLISHER_SITE_ORIGIN: 'canonical', EVIDENCE_SITE_ORIGIN: 'prior-era' },
    { PUBLISHER_SITE_ORIGIN: '', EVIDENCE_SITE_ORIGIN: 'prior-era' },
    { PUBLISHER_SITE_ORIGIN: '   ', EVIDENCE_SITE_ORIGIN: 'prior-era' },
    { EVIDENCE_SITE_ORIGIN: '' },
  ];
  resetPriorEraEnvWarnings();
  captureWarnings(() => {
    for (const env of cases) {
      const here = lookupPublisherEnv(suffix, env);
      const there = resolveEnvName(entry, env);
      assert.equal(here.name, there.name, `name disagreement for ${JSON.stringify(env)}`);
      assert.equal(here.value, there.raw, `value disagreement for ${JSON.stringify(env)}`);
      assert.equal(
        here.viaPriorEra,
        there.viaPriorEra,
        `provenance disagreement for ${JSON.stringify(env)}`,
      );
    }
  });
});
