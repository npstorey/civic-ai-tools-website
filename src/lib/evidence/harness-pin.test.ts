// The harness pin — @typedstandards/civic-typed-harness must be a version
// that carries the P-H1 signed-surface fixes (Wave N9 #384, family F2, C4).
//
// WHAT THE PIN PROTECTS. Two asserting defaults inside the PROV-O graph
// builder, both of which put a value the producer never wrote into bytes this
// instance SIGNS:
//
//   1. `tool.name` defaulted to `get_data`. Hub source before the fix:
//      `packages/civic-typed-harness/src/capture/provenance.ts:316` at
//      commit `ef93331^` (the merge-base of hub PR #188) —
//        const toolName = getAttr(span.attributes, 'tool.name') || 'get_data';
//      Shipped as `dist/capture/provenance.js:177` in 0.3.0, which is the
//      line the wave's census names.
//   2. `tool.portal_domain` defaulted to the RUN's portal
//      (`ProvenanceInput.portal`). Hub source before the fix:
//      `provenance.ts:319` at `ef93331^` —
//        const portalDomain = getAttr(span.attributes, 'tool.portal_domain') || portal;
//      Shipped as `dist/capture/provenance.js:180` in 0.3.0, used at `:207-209`
//      (the data-response `dcterms:description`) and `:218-225`
//      (`civic:portalDomain` / `civic:datasetUrl`).
//
// A third surface travels with them: `buildDataSources` minted a dataset-keyed
// entry on `fallbackPortal` — again the run's portal — for a call that carried
// a dataset id and no portal
// (`packages/civic-typed-harness/src/capture/data-sources.ts` at `ef93331^`).
//
// THE FIX, and the commits that carry it:
//   - hub PR #188, merged `ef93331`: `provenance.ts` and `data-sources.ts`
//     state what the span carried and state absence as absence.
//   - hub PR #191, merged `fd9afae`: `release: civic-typed-harness 0.3.1`.
//   - the fixed source reads, at `fd9afae`,
//     `packages/civic-typed-harness/src/capture/provenance.ts:339` (tool name,
//     "Absent when the span carried none — never defaulted"), `:343` (portal,
//     "Absent when the span carried none — never the run's portal"), `:387-389`
//     (the description) and `:403-414` (`civic:datasetId` always,
//     `civic:portalDomain` / `civic:datasetUrl` only with a portal); and
//     `data-sources.ts` at `fd9afae` (`fallbackPortal` "accepted and NOT
//     consulted since 0.3.1").
//
// SCOPE. This file pins the DEPENDENCY — the version installed, the range
// declared, and the resulting node_modules topology. It deliberately asserts
// nothing about graph bytes: the behaviour is driven end-to-end through this
// repository's own packager in
// `graph-states-what-the-span-carried.test.ts`, so a version bump that did not
// change behaviour, and a behaviour change that did not bump the version, each
// fail in the file that can see it.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HARNESS = '@typedstandards/civic-typed-harness';
const HARNESS_DIR = path.join(REPO_ROOT, 'node_modules', ...HARNESS.split('/'));

/** The lowest version carrying the P-H1 fixes. */
const FLOOR = '0.3.1';
/** Exclusive ceiling: under semver a 0.x MINOR bump is a breaking change, so
 *  the pin admits later 0.3.x PATCHES (a fix that is still this behaviour)
 *  and refuses 0.4.0, which would be a different contract this test has not
 *  read. The assertion is therefore a RANGE (`>=0.3.1 <0.4.0`) rather than
 *  equality to `0.3.1`: pinning the exact string would turn red on a patch
 *  release that changed nothing this file cares about, which is a criterion
 *  that fails for the wrong reason. */
const CEILING = '0.4.0';

type Semver = [number, number, number];

/** Parse `X.Y.Z`. Prerelease/build metadata is rejected rather than ignored —
 *  a `0.3.1-rc.1` is not the published release this pin names. */
function parseSemver(value: string, what: string): Semver {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  assert.ok(m, `${what}: "${value}" is not a plain X.Y.Z version this pin can compare`);
  return [Number(m![1]), Number(m![2]), Number(m![3])];
}

function compareSemver(a: Semver, b: Semver): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** The minimum version a `^X.Y.Z` range admits. Only the caret form is
 *  understood; any other range shape fails loudly rather than being waved
 *  through, because a pin that silently passes on a shape it cannot read is a
 *  criterion that cannot fail. */
function caretRangeFloor(range: string, what: string): Semver {
  assert.ok(
    range.startsWith('^'),
    `${what}: "${range}" is not a caret range — teach this pin the new range shape rather than deleting the assertion`,
  );
  return parseSemver(range.slice(1), what);
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

test('harness pin: the INSTALLED civic-typed-harness satisfies >=0.3.1 <0.4.0 (it carries the P-H1 signed-surface fixes)', () => {
  const pkgJson = path.join(HARNESS_DIR, 'package.json');
  assert.ok(fs.existsSync(pkgJson), `${HARNESS} is not installed at ${pkgJson} — run npm ci`);

  const version = readJson(pkgJson).version;
  assert.equal(typeof version, 'string', `${HARNESS}/package.json declares no version string`);

  const installed = parseSemver(version as string, `installed ${HARNESS}`);
  assert.ok(
    compareSemver(installed, parseSemver(FLOOR, 'floor')) >= 0,
    `installed ${HARNESS} is ${version as string}; ${FLOOR} is the first release whose graph builder ` +
      "states what the span carried (hub provenance.ts:339/:343 at fd9afae). Below it, dist/capture/provenance.js:177 " +
      "defaults tool.name to 'get_data' and :180 defaults the portal to the run's — inside bytes this instance signs.",
  );
  assert.ok(
    compareSemver(installed, parseSemver(CEILING, 'ceiling')) < 0,
    `installed ${HARNESS} is ${version as string}, at or above ${CEILING}; a 0.x minor bump is a breaking change ` +
      'under semver, so re-read the harness contract and move this pin deliberately.',
  );
});

test('harness pin: this repository DECLARES a range that excludes 0.3.0', () => {
  const rootPkg = readJson(path.join(REPO_ROOT, 'package.json'));
  const deps = rootPkg.dependencies as Record<string, string> | undefined;
  assert.ok(deps, 'package.json declares no dependencies block');

  const range = deps![HARNESS];
  assert.equal(typeof range, 'string', `package.json does not depend on ${HARNESS}`);

  const floor = caretRangeFloor(range, `package.json dependency range for ${HARNESS}`);
  assert.ok(
    compareSemver(floor, parseSemver('0.3.0', '0.3.0')) > 0,
    `package.json pins ${HARNESS} at "${range}", a range that still admits 0.3.0 — the version whose ` +
      'graph builder invents a portal and a tool name the span never carried. An installed tree can be ' +
      'correct while the declared range lets the next fresh install regress; both are pinned here.',
  );
  assert.ok(
    compareSemver(floor, parseSemver(FLOOR, 'floor')) >= 0,
    `package.json pins ${HARNESS} at "${range}"; the declared floor must be at least ${FLOOR}.`,
  );
});

test('harness pin: exactly one produce-core copy — the harness carries no nested @typedstandards/produce-core', () => {
  // 0.3.0 depended on `@typedstandards/produce-core: ^0.3.0`, a range that
  // excludes the 0.4.0 this repository moved to, so npm nested a SECOND
  // produce-core under the harness. 0.3.1 widened the range to
  // `^0.3.0 || ^0.4.0`, which lets one copy serve both. Two copies is not a
  // cosmetic duplication here: produce-core owns envelope assembly and the
  // PROV-O node helpers whose insertion order is the signed byte contract, so
  // "which copy assembled these bytes" is a question a record system should
  // never have to ask.
  const nested = path.join(HARNESS_DIR, 'node_modules', '@typedstandards', 'produce-core');
  assert.equal(
    fs.existsSync(nested),
    false,
    `a second produce-core is nested at ${nested}; the harness's dependency range must admit the ` +
      "root copy (0.3.1 widened it to '^0.3.0 || ^0.4.0'), so npm install resolves one.",
  );
});
