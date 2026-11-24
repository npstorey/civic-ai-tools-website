// OF2 (Sprint OF-1, website #810; the seat's S4 and S8): the format a run was asked for, in the record.
//
// THE RULE THIS HOLDS. A run in a format other than "Auto" states the format asked in its root span, as
// `analysis.output_format` (`{ id, version }`, JSON text), and the packager writes it into the record as
// `extensions["org.civicaitools.output-format"].preset`. The key is written from the run's root span and from nothing
// else: a key of that name in the publish request's extensions is replaced by the root span's, and under "Auto" (no
// attribute) it is absent from the record even when the request carries one (criterion 7). Every other extension the
// request carries passes through as it came.
//
// WHAT IS DRIVEN. The real packager (`buildEvidencePackage`), over a fixed trace whose root span carries the run's
// attributes, built deterministically (`packageId` and the clock mocked, as `packager.failed-call.test.ts` does).
//
// THE PINS (criteria 1 and 3, the record's half): an "Auto" run's package, with no extensions and with another
// extension, on both hash chains, has the envelope hash measured at the base (`407b68c`). The key cannot be in those
// bytes by construction, so the pins hold the bytes; the reds below hold the key.
//
// WHAT MAKES THE REDS ABLE TO FAIL. At the base the packager copies the request's extensions through whole: a forged key
// reaches the record, and a root span's attribute reaches nothing. Each red is shown failing at its assertion there.
//
// The route half (the browser's publish body, the real `/api/records` handler, the routes' traces) is driven in
// `src/app/api/output-format-driven.test.ts`.
//
// Run with: npm test

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildEvidencePackage, type EvidencePackage, type PackageInput } from '../evidence/packager.ts';
import { recomputePackageHash } from '../evidence/verify.ts';
import { REFERENCE_IDENTITY_ENV } from '../evidence/reference-identity-fixture.ts';

const FIXTURE_KID = 'platform:test-suite-kid';
process.env.PUBLISHER_KEY_ID = FIXTURE_KID;
process.env.EVIDENCE_KEY_ID = FIXTURE_KID;
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] = value;

const HERE = path.dirname(fileURLToPath(import.meta.url));
type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** The format module, once it exists (absent at the base, where every red below fails at its assertion). */
const registry: Mod | null = await import(pathToFileURL(path.join(HERE, 'registry.ts')).href).catch(() => null);

const KEY = 'org.civicaitools.output-format';
const ATTRIBUTE = 'analysis.output_format';
/** A format this test registers for itself (test doubles live in test files). */
const FORMAT = { id: 'fixture-format', version: '1' } as const;
const FORGED = { preset: { id: 'forged-format', version: '9' } };

type Attribute = { key: string; value: { stringValue: string } };
/** A trace whose root span carries the given attributes, and one child span. Fixed ids and times. */
function traceWith(attributes: Record<string, string>): Record<string, unknown> {
  const attr = (key: string, value: string): Attribute => ({ key, value: { stringValue: value } });
  return {
    resourceSpans: [{
      resource: { attributes: [attr('service.name', 'fixture')] },
      scopeSpans: [{
        scope: { name: 'fixture', version: '0' },
        spans: [
          {
            traceId: '0af7651916cd43dd8448eb211c80319c',
            spanId: 'b7ad6b7169203331',
            name: 'analysis',
            kind: 1,
            startTimeUnixNano: '1764000000000000000',
            endTimeUnixNano: '1764000001000000000',
            attributes: [
              attr('analysis.prompt_hash', 'a'.repeat(64)),
              attr('analysis.model', 'vendor/model-fixture-1'),
              ...Object.entries(attributes).map(([k, v]) => attr(k, v)),
            ],
            status: { code: 1 },
          },
          {
            traceId: '0af7651916cd43dd8448eb211c80319c',
            spanId: '00f067aa0ba902b7',
            parentSpanId: 'b7ad6b7169203331',
            name: 'skill_fetch',
            kind: 1,
            startTimeUnixNano: '1764000000100000000',
            endTimeUnixNano: '1764000000200000000',
            attributes: [attr('skill.text_hash', 'b'.repeat(64))],
            status: { code: 1 },
          },
        ],
      }],
    }],
  };
}
const AUTO_TRACE = traceWith({});
const FORMAT_TRACE = traceWith({ [ATTRIBUTE]: JSON.stringify(FORMAT) });

function packageInput(overrides: Partial<PackageInput> = {}): PackageInput {
  return {
    trace: AUTO_TRACE,
    prompt: 'How many permits were issued last year?',
    output: 'One figure was retrieved.',
    toolCalls: [],
    model: 'vendor/model-fixture-1',
    tokenUsage: { promptTokens: 100, completionTokens: 20 },
    promptVisibility: 'full_text',
    title: 'Fixture',
    summary: 'Fixture summary.',
    ...overrides,
  };
}

const FIXED_PACKAGE_ID = '00000000-0000-4000-8000-000000000810';
const FIXED_NOW = '2026-11-24T12:00:00.000Z';
function buildDeterministically(input: PackageInput): { pkg: EvidencePackage; hash: string } {
  mock.method(crypto, 'randomUUID', () => FIXED_PACKAGE_ID as ReturnType<typeof crypto.randomUUID>);
  mock.timers.enable({ apis: ['Date'], now: new Date(FIXED_NOW).getTime() });
  try {
    return buildEvidencePackage(input);
  } finally {
    mock.timers.reset();
    mock.restoreAll();
  }
}
const extensionsOf = (pkg: EvidencePackage): Record<string, unknown> | undefined =>
  (pkg as unknown as { extensions?: Record<string, unknown> }).extensions;

// --- The pins: an "Auto" run's record is the base's, byte for byte --------------------------------------------------

/** Measured at the base (`407b68c`) by this file. A change here is a change to the bytes of every "Auto" record. */
const PINNED = {
  legacyNoExtensions: 'bf81ebfcc68a68c5c83a43318a36d680209ee107a3b534ac193dde178fdd5990',
  v01OtherExtension: '5daa0961f53014759f7309cf704d884b2c57ae8f79c7445ae05f4ff216145dbc',
} as const;

test('criteria 1 and 3 (pin): an "Auto" run\'s package with no extensions has the base\'s envelope hash (legacy chain)', () => {
  const { pkg, hash } = buildDeterministically(packageInput());
  assert.equal(pkg.metadata.packageId, FIXED_PACKAGE_ID, 'premise: the id mock reached the packager');
  assert.equal(pkg.metadata.createdAt, FIXED_NOW, 'premise: the clock mock reached the packager');
  assert.equal(recomputePackageHash(pkg as unknown as Record<string, unknown>), hash, 'the verifier recomputes the same hash');
  assert.equal(extensionsOf(pkg), undefined, 'an "Auto" package with no extensions carries none');
  assert.equal(hash, PINNED.legacyNoExtensions);
});

test('criteria 1 and 3 (pin): an "Auto" run\'s package with another extension has the base\'s envelope hash (v0.1 chain)', () => {
  const { pkg, hash } = buildDeterministically(packageInput({
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
    extensions: { 'org.example.other': { kept: true } },
  }));
  assert.ok(pkg.contentHash?.sha256, 'premise: the v0.1 chain');
  assert.deepEqual(Object.keys(extensionsOf(pkg) ?? {}), ['org.example.other']);
  assert.equal(hash, PINNED.v01OtherExtension);
});

// --- Criterion 5: the format asked, in the record --------------------------------------------------------------------

test('criterion 5 (red): a run in a format other than "Auto" carries extensions["org.civicaitools.output-format"].preset = { id, version }', () => {
  const { pkg } = buildDeterministically(packageInput({ trace: FORMAT_TRACE }));
  const extension = extensionsOf(pkg)?.[KEY] as { preset?: unknown } | undefined;
  assert.ok(extension, `the record carries no ${KEY}: ${JSON.stringify(extensionsOf(pkg) ?? null)}`);
  assert.deepEqual(extension!.preset, { id: FORMAT.id, version: FORMAT.version });
  assert.deepEqual(Object.keys(extension!.preset as object), ['id', 'version'], 'exactly the two keys, in that order');
});

test('criterion 5 (red, the decoy beside it): an "Auto" run\'s record has no such key', () => {
  const { pkg } = buildDeterministically(packageInput());
  assert.ok(!(KEY in (extensionsOf(pkg) ?? {})));
  // The same input with the attribute does carry it: the assertion above can see the key when it is there.
  assert.ok(KEY in (extensionsOf(buildDeterministically(packageInput({ trace: FORMAT_TRACE })).pkg) ?? {}), 'the key never appears, so absence proves nothing');
});

// --- Criterion 7: written from the root span, never from the request ------------------------------------------------

test('criterion 7 (red): a key of that name in the request is replaced by the root span\'s', () => {
  const { pkg } = buildDeterministically(packageInput({ trace: FORMAT_TRACE, extensions: { [KEY]: FORGED, 'org.example.other': { kept: true } } }));
  const extensions = extensionsOf(pkg) ?? {};
  assert.deepEqual(extensions[KEY], { preset: { id: FORMAT.id, version: FORMAT.version } });
  assert.deepEqual(extensions['org.example.other'], { kept: true }, 'another extension is passed through as it came');
});

test('criterion 7 (red): under "Auto" the key is absent from the record even when the request carries one', () => {
  for (const extensions of [{ [KEY]: FORGED }, { [KEY]: FORGED, 'org.example.other': { kept: true } }]) {
    const { pkg } = buildDeterministically(packageInput({ extensions }));
    const out = extensionsOf(pkg) ?? {};
    assert.ok(!(KEY in out), `the request's key reached an "Auto" record: ${JSON.stringify(out)}`);
    if ('org.example.other' in extensions) assert.deepEqual(out['org.example.other'], { kept: true });
  }
});

test('criterion 7 (red): a root-span attribute that is present but not { id, version } is refused, not read as absent', () => {
  for (const bad of ['not json', '{"id":"x"}', '{"id":1,"version":"1"}', '[]', '{"id":"x","version":"1","extra":"y"}']) {
    assert.throws(() => buildEvidencePackage(packageInput({ trace: traceWith({ [ATTRIBUTE]: bad }) })), /analysis\.output_format/, bad);
  }
});

test('the module names the key and the attribute as S4 and S8 ruled them', () => {
  assert.ok(registry, 'src/lib/output-format/registry.ts does not exist');
  assert.equal(registry!.OUTPUT_FORMAT_EXTENSION_KEY, KEY);
});
