// A run-level `portal` reaches no byte of a record package (#421, ruled D5 = A
// in Wave N11, #434 P1).
//
// WHAT THIS DRIVES. One input, built three times through `buildEvidencePackage`
// — with `portal: 'data.run-level.example'`, with `portal:
// 'data.other.example'`, and with no `portal` at all — yields one package hash.
// The field is now optional and the publish route no longer passes it, so this
// pins the claim both of those changes rest on: whatever a caller sends there,
// the signed bytes are the same.
//
// WHY THIS FIXTURE CAN FAIL. A fixture whose calls all named the run-level
// portal could not tell "the packager ignored the run-level value" from "the
// packager used it and it happened to match". So neither run-level value
// appears on any call, and the two calls are on two datasets, so they cannot
// de-duplicate into one entry:
//   - the first names a third portal, `data.call-level.example`, and reaches
//     `dataSources` — so a run-level value that displaced the call's portal
//     there would move bytes;
//   - the second names NO portal. That is the call a regressed packager would
//     fill in: a run-level portal used to be the fallback for a call that
//     named none, and a fallback like it would stamp whichever run-level value
//     a build was given onto this call's `queries[]` entry, splitting the
//     three hashes. MEASURED, not assumed: this call does NOT reach
//     `dataSources` — the harness mints no dataset-keyed Socrata entry for a
//     call that names no portal — so `queries[]` is the surface it exercises.
// Both shapes are asserted below, so the fixture cannot quietly stop being the
// shape that could fail; and the canonical bytes are searched for both
// run-level values, so a read anywhere else is named.
//
// A REGRESSION GUARD, NOT A RED. At `ea1164c` this passes: nothing in the
// packager has read `input.portal` since #192's website half. It could fail —
// the phase report shows it red under a one-line mutation that lets
// `queries[]` fall back to `input.portal`.
//
// Determinism: `packageId` and `createdAt` come from `crypto.randomUUID()` and
// the clock, so both are mocked for each build, as in
// `packager.failed-call.test.ts`.
//
// Run with: npm test

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { buildEvidencePackage, type PackageInput } from './packager.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';

// The packager refuses without a declared key id and instance identity (#258);
// the reference identity is injected, as in packager.test.ts. `node --test`
// runs each file in its own process, so this is local to this file.
process.env.EVIDENCE_KEY_ID ??= 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

const FIXED_PACKAGE_ID = '00000000-0000-4000-8000-000000000421';
const FIXED_NOW = '2026-09-11T12:00:00.000Z';

const RUN_LEVEL = 'data.run-level.example';
const OTHER_RUN_LEVEL = 'data.other.example';
const CALL_PORTAL = 'data.call-level.example';
const DATASET_WITH_PORTAL = 'abcd-1234';
const DATASET_WITHOUT_PORTAL = 'wxyz-5678';

function input(): Omit<PackageInput, 'portal'> {
  return {
    trace: { resourceSpans: [] },
    prompt: 'How many permits were filed last year, and how many inspections?',
    output: 'About 1,200 permits and 300 inspections.',
    toolCalls: [
      {
        name: 'get_data',
        args: { type: 'query', portal: CALL_PORTAL, dataset_id: DATASET_WITH_PORTAL, select: 'count(*)' },
        resultSummary: { rows: 1, columns: 1 },
        operationType: 'query',
      },
      {
        name: 'get_data',
        args: { type: 'query', dataset_id: DATASET_WITHOUT_PORTAL, select: 'count(*)' },
        resultSummary: { rows: 1, columns: 1 },
        operationType: 'query',
      },
    ],
    model: 'openai/gpt-4o',
    tokenUsage: { promptTokens: 100, completionTokens: 20 },
    promptVisibility: 'full_text',
    title: 'Permits and inspections',
    summary: 'A fixture for the deprecated run-level portal.',
  };
}

function buildWith(portal: string | undefined) {
  mock.method(crypto, 'randomUUID', () => FIXED_PACKAGE_ID as ReturnType<typeof crypto.randomUUID>);
  mock.timers.enable({ apis: ['Date'], now: new Date(FIXED_NOW).getTime() });
  try {
    return buildEvidencePackage(portal === undefined ? input() : { ...input(), portal });
  } finally {
    mock.timers.reset();
    mock.restoreAll();
  }
}

test('the fixture is the shape that could fail: a call-level portal in dataSources, a portal-less call in queries[]', () => {
  const { pkg } = buildWith(RUN_LEVEL);
  const sources = JSON.stringify(pkg.dataSources);
  const withPortal = pkg.dataSources.filter((s) => JSON.stringify(s).includes(DATASET_WITH_PORTAL));
  assert.equal(withPortal.length, 1, `the call that names a portal did not reach dataSources: ${sources}`);
  assert.ok(
    JSON.stringify(withPortal[0]).includes(CALL_PORTAL),
    `its dataSources entry does not state the portal the call carried: ${sources}`,
  );

  const portalLess = pkg.queries.filter((q) => q.datasetId === DATASET_WITHOUT_PORTAL);
  assert.equal(portalLess.length, 1, `the call that names no portal did not reach queries[]: ${JSON.stringify(pkg.queries)}`);
  assert.equal(portalLess[0].portal, undefined, 'the portal-less call must carry no portal in queries[] — the absence a fallback would fill');
  assert.ok(!sources.includes(DATASET_WITHOUT_PORTAL), 'measured at base: the portal-less call mints no dataSources entry; if it now does, restate the header');
});

test('two run-level portals and none build one package hash, and neither value is in the bytes', () => {
  const a = buildWith(RUN_LEVEL);
  const b = buildWith(OTHER_RUN_LEVEL);
  const none = buildWith(undefined);

  assert.equal(a.hash, none.hash, `a run-level portal of ${RUN_LEVEL} moved the package hash`);
  assert.equal(b.hash, none.hash, `a run-level portal of ${OTHER_RUN_LEVEL} moved the package hash`);

  for (const [value, built] of [[RUN_LEVEL, a], [OTHER_RUN_LEVEL, b]] as const) {
    assert.ok(
      !JSON.stringify(built.pkg).includes(value),
      `the run-level portal ${value} reached the package bytes`,
    );
  }
});
