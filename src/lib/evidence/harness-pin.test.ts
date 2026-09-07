// The harness pin — @typedstandards/civic-typed-harness must be a version
// that carries the signed-surface fixes named below (Wave N9 #384, family F2,
// C4; Wave N10 #409, criterion 6).
//
// WHAT THE PIN PROTECTS, PART TWO — 0.4.0, and why the range moved to it.
// `buildDataSources` could not see that a call had been REJECTED: its input
// type was `{ name; args }`, so a rejected call's dataset was minted as an
// accessed data source, and an aggregate source was marked accessed by any
// call that resolved to it, answered or not — inside bytes this instance
// signs, each entry carrying an `accessTimestamp` (civic-ai-tools#192).
//
// 0.4.0 gives `ToolCallSummary` an optional `failed` (and `failureKind`) and
// skips a failed call before it resolves a source, so BOTH branches see the
// rejection; the walk keeps the call's index rather than filtering the list,
// because a call is paired to `toolSpans[i]` by position. Absence is absence:
// a producer that records no outcome passes neither key and gets exactly the
// entries it got before they existed. The fixed source reads, at hub `a6d6f77`,
// `packages/civic-typed-harness/src/capture/data-sources.ts:30-49` (the two
// fields) and `:153-159` (`if (tc.failed) continue;` above both branches).
//
// This repository compensated between 0.3.1 and 0.4.0 with a positional
// stand-in in `packager.ts` that stripped `dataset_id` and `portal` from a
// rejected call. That patch was shaped like the dataset-keyed branch — the
// only one that reads those keys — so a rejected AGGREGATE call still asserted
// an access. The stand-in is gone; the pin is what replaces it, and
// `a-rejected-aggregate-call-asserts-no-access.test.ts` drives the shape it
// could not reach.
//
// WHAT THE PIN PROTECTS, PART ONE — 0.3.1. Two asserting defaults inside the
// PROV-O graph builder, both of which put a value the producer never wrote
// into bytes this instance SIGNS:
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
// AND THE COMMITS THAT CARRY 0.4.0:
//   - hub PR #196, merged `24fb69e`: `buildDataSources` reads `failed` on both
//     branches (P-H1, hub#192) — the fix this range moved for.
//   - hub PR #198, merged `85c5613`: the PROV-O activity for a span ended with
//     `error: true` carries `civic:failed` / `civic:failureKind`, conditionally
//     spread so a span without them leaves the bytes unchanged (P-H2, #193).
//   - hub PR #200, merged `5819d78`: a second registry field carries the
//     reader-facing source name; the agent node's `dcterms:title` is unchanged
//     (P-H3, #194).
//   - hub PR #202, merged `a6d6f77`: `release: civic-typed-harness 0.4.0`.
//     Published 2026-09-04, `dist.shasum
//     fbf52995ab70a7efdda2aeea8b2a803ec0bf0c90`, 28 files.
//   Two of those four change bytes this instance signs, and both are
//   conditional on something the record carries: a rejected call, or a span
//   ended with `error: true`. A package with neither is byte-identical across
//   the bump, which is what the pinned envelope hashes in
//   `packager.failed-call.test.ts` measure rather than assume.
//
// SCOPE. This file pins the DEPENDENCY — the version installed, the range
// declared, and the resulting node_modules topology. It deliberately asserts
// nothing about graph or package bytes. Each behaviour it names is driven
// end-to-end through this repository's own packager somewhere else, so a
// version bump that did not change behaviour, and a behaviour change that did
// not bump the version, each fail in the file that can see it. NAMED ONE BY
// ONE, because the blanket version of this sentence was false for a year of
// waves and nothing could tell:
//
//   - the 0.3.1 graph-builder fixes (tool name, portal domain, dataset keys) —
//     `graph-states-what-the-span-carried.test.ts`, cases (a)-(d);
//   - 0.4.0 / hub #196, a rejected call minting no dataset-keyed entry —
//     same file, case (e), on a dataset nothing else in the run touched;
//   - 0.4.0 / hub #196, the aggregate half of the same property —
//     `a-rejected-aggregate-call-asserts-no-access.test.ts`;
//   - 0.4.0 / hub #198, `civic:failed` / `civic:failureKind` on the activity
//     for a span ended with `error: true` —
//     `graph-states-what-the-span-carried.test.ts`, case (g).
//
// WHY THAT LIST IS SPELLED OUT (Wave N10 P8, #409, cold-read F6). Until P8 this
// paragraph asserted, in one breath, that all of it was "driven end-to-end" in
// the two files above. For the first three that was true. For hub #198 it was
// not: that file asserted portals, tool names, `dataSources` and `queries`, and
// `civic:failed` appeared nowhere in `src/` outside two comments — one of them
// this one. The marker IS emitted, so the system met the criterion and no
// package was ever wrong; what was missing was any assertion of it in this
// repository, which is exactly the gap a pin is not allowed to leave, because a
// pin's whole claim is that someone else is watching the behaviour. Case (g)
// was added in the same commit as this correction: a corrected pointer over a
// still-absent assertion is the cheaper half and not the point.
//
// A pointer in a header is a claim, and this one had been read as true by two
// waves. Adding a behaviour to the list above without adding the case it names
// puts this file back where it was.
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

/** The lowest version carrying BOTH sets of fixes this file names: the 0.3.1
 *  graph-builder fixes above, and the 0.4.0 data-source fix below. */
const FLOOR = '0.4.0';
/** Exclusive ceiling: under semver a 0.x MINOR bump is a breaking change, so
 *  the pin admits later 0.4.x PATCHES (a fix that is still this behaviour) and
 *  refuses 0.5.0, which would be a contract this test has not read. The
 *  assertion is therefore a RANGE (`>=0.4.0 <0.5.0`) rather than equality to
 *  `0.4.0`: pinning the exact string would turn red on a patch release that
 *  changed nothing this file cares about, which is a criterion that fails for
 *  the wrong reason.
 *
 *  MOVED DELIBERATELY, NOT DRIFTED. The pair was `>=0.3.1 <0.4.0` until Wave
 *  N10 P4. That ceiling did its job: it held 0.4.0 out until someone read the
 *  new contract and said what changed. Both numbers move together, in one
 *  commit, with the paragraph above rewritten — a floor raised without its
 *  ceiling would silently readmit the next unread minor. */
const CEILING = '0.5.0';

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

test('harness pin: the INSTALLED civic-typed-harness satisfies >=0.4.0 <0.5.0 (it carries both sets of signed-surface fixes)', () => {
  const pkgJson = path.join(HARNESS_DIR, 'package.json');
  assert.ok(fs.existsSync(pkgJson), `${HARNESS} is not installed at ${pkgJson} — run npm ci`);

  const version = readJson(pkgJson).version;
  assert.equal(typeof version, 'string', `${HARNESS}/package.json declares no version string`);

  const installed = parseSemver(version as string, `installed ${HARNESS}`);
  assert.ok(
    compareSemver(installed, parseSemver(FLOOR, 'floor')) >= 0,
    `installed ${HARNESS} is ${version as string}; ${FLOOR} is the first release whose buildDataSources ` +
      'reads `failed` (hub data-sources.ts:153-159 at a6d6f77). Below it, a rejected call mints its dataset as ' +
      'an accessed source and marks its aggregate source accessed — inside bytes this instance signs. 0.3.1 is ' +
      'the floor for the graph half (hub provenance.ts:339/:343 at fd9afae); below THAT, ' +
      "dist/capture/provenance.js:177 defaults tool.name to 'get_data' and :180 defaults the portal to the run's.",
  );
  assert.ok(
    compareSemver(installed, parseSemver(CEILING, 'ceiling')) < 0,
    `installed ${HARNESS} is ${version as string}, at or above ${CEILING}; a 0.x minor bump is a breaking change ` +
      'under semver, so re-read the harness contract and move this pin deliberately — both numbers, in one commit.',
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
  //
  // RE-READ AT 0.4.0 (Wave N10 P4). The harness's own dependency range is
  // still `^0.3.0 || ^0.4.0` — the lockfile entry for the harness moved only
  // its version, resolved URL and integrity, and no `node_modules/@typed
  // standards/civic-typed-harness/node_modules` appeared. One copy still
  // serves both, and the assertion below still measures that rather than
  // trusting the range.
  const nested = path.join(HARNESS_DIR, 'node_modules', '@typedstandards', 'produce-core');
  assert.equal(
    fs.existsSync(nested),
    false,
    `a second produce-core is nested at ${nested}; the harness's dependency range must admit the ` +
      "root copy (0.3.1 widened it to '^0.3.0 || ^0.4.0', and 0.4.0 kept it), so npm install resolves one.",
  );
});
