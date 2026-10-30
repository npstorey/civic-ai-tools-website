// The harness pin — @typedstandards/civic-typed-harness must be a version
// that carries the signed-surface fixes named below (Wave N9 #384, family F2,
// C4; Wave N10 #409, criterion 6; Wave N12 #470, criteria 7-9; sprint R2 #599
// W4; sprint R6 #632 W2; sprint R8 #644 W1; sprint R10 civic-ai-tools#289 P5).
//
// WHAT THE PIN PROTECTS, PART SEVEN — 0.11.0, and why the range moved to it
// (sprint R10 P5, hub ADR-0038). One thing this instance's publish route now
// relies on, in bytes it signs, on new records only:
//
//   1. `CIVICAITOOLS_V1_PRODUCER_PROFILE`
//      (`ai-assisted-analysis/civicaitools-v1`), the Producer Profile subtype
//      this host declares on every record its own runs publish
//      (`captureMethod: 'chat-flow-stream'`), full-text (`datHere`) and
//      hash-only (`default`) alike. Below 0.11.0 the constant does not exist.
//      `deriveProducerProfile` is unchanged: an explicit value wins under
//      every content profile, which is what lets a hash-only record carry it.
//
// 0.11.0 changed no derivation and kept produce-core `^0.9.0`. The subtype's
// table row (the content profiles it admits and its bundle) is verify-core
// 0.15.0's, which is why this repository's verify-core pin moves with this
// one; produce-core 0.9.1, which `^0.9.0` admits, requires verify-core
// `^0.15.0`, so the lockfile resolves one copy of each core. A record packaged
// without the constant has the same bytes.
//
// Where it is driven through this repository's route and packager:
// `src/app/api/producer-profile-driven.test.ts` (a hash-only and a full-text
// publish through the real dialog each carry it; a `datHere` record declaring
// it returns 200, and an inconsistent pair 400).
//
// WHAT THE PIN PROTECTS, PART SIX — 0.10.0, and why the range moved to it
// (#644 W1, hub ADR-0033's amendment 2). Two things this instance's packager
// now relies on, each in bytes it signs, on new records of an in-loop run
// only (`SOURCE_ROUTING=in-loop`):
//
//   1. The composition block's `routing: { method, version }` and
//      `definitionHash`, after `flowsStatement`, each only when passed, read
//      from the root-span attributes `analysis.routing` (JSON text of exactly
//      the two strings) and `analysis.definition_hash`, and refused in any
//      other shape. Below 0.10.0 neither attribute is read, so a record could
//      not state how its run's sources were chosen.
//   2. The load span: a tool span whose `tool.operation_type` is
//      `load_source` states `tool.load_outcome` as `civic:loadOutcome`, mints
//      no server agent and no data-response entity, and `buildDataSources`
//      skips its call in place. A load span with no outcome, or another
//      value, is refused (`LoadSpanError`). Below 0.10.0 such a span was
//      attributed to an `unknown` source agent.
//
// 0.10.0 changed no dependency, so this repository's core pins stay. A record
// packaged without either input, and with no load span, has the same bytes.
//
// Where each is driven through this repository's packager:
//   - 1 — `src/app/api/in-loop-routing-driven.test.ts` (an in-loop run's
//     record states both after `flowsStatement`; an all-sources record
//     states neither);
//   - 2 — the same file (one load span `loaded` and one `not-offered`,
//     `civic:loadOutcome` on each activity, `dataSources[]` from the data
//     calls only), and through the loop core in
//     `src/lib/model-loop/in-loop-routing.test.ts` (each load span's
//     outcome, never `error`, no source attribute).
//
// WHAT THE PIN PROTECTS, PART FIVE — 0.9.0, and why the range moved to it
// (#632 W2, hub ADR-0033's 2026-10-18 amendment). Two things this instance's
// packager now relies on, each in bytes it signs, on new records only:
//
//   1. `sourcesOffered[].reason` accepts `reader-off` and `not-consented`
//      (`SOURCE_OFFERED_REASONS`, six), so a record states the reader's own
//      states rather than the router's coarser `not-selected`. Below 0.9.0
//      the derivation refuses both, and a consented run could not be
//      packaged.
//   2. The composition block's `flowsStatement: { url, hash, date }`, read
//      from the root-span attribute `analysis.flows_statement` and refused in
//      any other shape. Below 0.9.0 the attribute is not read, so a record
//      could not refer to the flows statement in force.
//
// 0.8.0 changed no harness source: it raised the produce-core floor to
// `^0.9.0` (verify-core `^0.14.0`, the version produce-core 0.9.0 resolves),
// which is why this repository's two core pins move with this one. Both are
// driven in `src/lib/evidence/run-record-flows-statement.test.ts` and, at the
// routes, `src/app/api/consent-gate-driven.test.ts`.
//
// WHAT THE PIN PROTECTS, PART FOUR — 0.7.0, and why the range moved to it
// (#599 W4, hub ADR-0033). Five things this instance's packager now relies
// on, each in bytes it signs:
//
//   1. Every call is attributed to its own source (ADR-0033 §A). Below 0.7.0 a
//      call whose span named a source the registry lacks, or that nothing
//      identified, was associated with the Socrata agent — in a run that never
//      called Socrata, an agent the graph did not contain — and an unknown
//      call defaulted to `socrata` in `dataSources[]` too. 0.7.0 attributes it
//      to its own source, or to an agent named `unknown`, and takes the
//      packager's resolver for an untagged span (`ProvenanceConfig.resolver`).
//   2. The datHere environment block states `temperature` and
//      `toolDefinitions` only when passed (§C, hub #240). Below 0.7.0 it
//      stated `temperature: 0` — a value no request sent — and
//      `toolDefinitions: []` for runs that offered tools.
//   3. The servers the RUN had win (§D, #495): `runMcpServers` is preferred
//      over the packaging-time list, and `withRunServerAddresses` gives the
//      graph's source agents the run's addresses. Below 0.7.0 neither exists,
//      and a record names the servers configured when it was published.
//   4. The `org.civicaitools.composition` block (§E, #475): the date the
//      prompt asserted, each source's offered-reason and the components.
//      Below 0.7.0 the date was hashed and never stated.
//   5. `extractRunAttributes` reads all of it back from the trace's root
//      span, and refuses a present attribute it cannot parse rather than
//      reading it as absent.
//
// 0.7.0 also moved the harness's produce-core floor to `^0.8.0` (verify-core
// `^0.13.0` with it), which is why this repository's two cores move with it:
// a higher core pin would nest a second copy of each under the harness. The
// last test below measures that topology for both cores.
//
// Where each of the five is driven through this repository's packager:
//   - 1 — `a-record-between-w3-and-w4-attributes-each-call.test.ts` (a call
//     nothing identifies goes to `unknown`, never Socrata),
//     `data-sources.test.ts` ("Unknown tool with no trace span resolves to
//     unknown"), and `a-record-states-what-its-run-had.test.ts` (an untagged
//     aliased call resolves by the app's resolver in the graph);
//   - 2 — `packager.test.ts` (the environment block's keys) and
//     `a-record-states-what-its-run-had.test.ts` (no temperature; the tools
//     as offered);
//   - 3, 4, 5 — `a-record-states-what-its-run-had.test.ts`, and at the routes
//     `src/app/api/a-run-records-its-inputs-driven.test.ts`.
//
// WHAT THE PIN PROTECTS, PART THREE — 0.5.0, and why the range moved to it.
// Two things this instance's packager now relies on, both in bytes it signs
// (civic-ai-tools#205 and this repository's #449, the harness halves):
//
//   1. A source agent's `civic:serverUrl` is the address the caller's registry
//      carries, or no key at all. `CivicSourceInfo.serverUrl` became optional,
//      the graph builder omits the key when an entry has no address, and the
//      0.4.x fallback — an agent for a source outside the registry carried its
//      own source id as `civic:serverUrl`, a string that was never an address —
//      is gone. Below 0.5.0 that fallback is emitted whatever the packager
//      passes, so a record names a server that does not exist.
//   2. `deriveDatHereEnvelopeFields` accepts `mcpServers`, a list of
//      `{ url, name? }` emitted in the caller's order, in place of the one
//      skill-fetch URL. Below 0.5.0 the input is not read and the environment
//      extension lists one server (or none) whatever the run had.
//
// The packager passes a registry built from this instance's configuration and
// the full server list only for a capture this instance made
// (`serverAddressPolicy` in `packager.ts`); the harness is what makes either
// reach the bytes.
//
// WHAT THE PIN PROTECTS, PART TWO — 0.4.0.
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
//     `graph-states-what-the-span-carried.test.ts`, case (g);
//   - 0.5.0 / hub #205, no source-id fallback: an agent for a source the
//     registry does not know carries no `civic:serverUrl` —
//     `a-record-names-the-configured-servers.test.ts`, the second (7b) case;
//   - 0.5.0 / #449, `mcpServers` as a list, in the caller's order, with names —
//     same file, (8), and the notebook-shaped run in
//     `server-address-policy.test.ts`.
//
//   Measured with 0.4.1 installed under this repository's 0.5.0-era packager:
//   those three cases go red, as does that file's API-key case through its
//   list-length check, and every other case in both files stays green. A
//   configured address reaching an agent (7a), and an entry with no address
//   yielding an agent
//   with no key (the first (7b) case, and the captures made elsewhere), are
//   the WEBSITE's registry at work: the registry was caller-supplied before
//   0.5.0, and 0.4.1's `civic:serverUrl: undefined` is dropped by
//   `JSON.stringify`. What 0.5.0 adds there is the type — at 0.4.1 an entry
//   without `serverUrl`, and the `mcpServers` input, do not type-check.
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

/** The lowest version carrying ALL SEVEN sets of fixes this file names: the
 *  0.3.1 graph-builder fixes, the 0.4.0 data-source fix, the 0.5.0
 *  configured-server fixes, 0.7.0's record fields, 0.9.0's two reasons and
 *  flows-statement reference, 0.10.0's routing statement and load span, and
 *  0.11.0's subtype constant above. */
const FLOOR = '0.11.0';
/** Exclusive ceiling: under semver a 0.x MINOR bump is a breaking change, so
 *  the pin admits later 0.11.x PATCHES (a fix that is still this behaviour)
 *  and refuses 0.12.0, which would be a contract this test has not read. The
 *  assertion is therefore a RANGE (`>=0.11.0 <0.12.0`) rather than equality to
 *  `0.11.0`: pinning the exact string would turn red on a patch release that
 *  changed nothing this file cares about, which is a criterion that fails for
 *  the wrong reason.
 *
 *  MOVED DELIBERATELY, NOT DRIFTED. The pair was `>=0.3.1 <0.4.0` until Wave
 *  N10 P4, `>=0.4.0 <0.5.0` until Wave N12 W5, `>=0.5.0 <0.6.0` until
 *  sprint R2 W4, which read 0.6.0's and 0.7.0's entries together (0.6.0
 *  changed no harness source; it raised the core floors), `>=0.7.0
 *  <0.8.0` until sprint R6 W2, which read 0.8.0's and 0.9.0's together (0.8.0,
 *  again, changed no harness source and raised the core floors), and `>=0.9.0
 *  <0.10.0` until sprint R8 W1, which read 0.10.0's entry (no dependency
 *  change, so the core floors stay), and `>=0.10.0 <0.11.0` until sprint R10
 *  P5, which read 0.11.0's entry (no derivation change; verify-core moved to
 *  `^0.15.0` for the subtype's table row). Each ceiling did its
 *  job: it held the next minor out until someone read the new contract and
 *  said what changed. Both numbers move together, in one commit, with the
 *  paragraph above rewritten — a floor raised without its ceiling would
 *  silently readmit the next unread minor. */
const CEILING = '0.12.0';

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

test('harness pin: the INSTALLED civic-typed-harness satisfies >=0.11.0 <0.12.0 (it carries all seven sets of signed-surface fixes)', () => {
  const pkgJson = path.join(HARNESS_DIR, 'package.json');
  assert.ok(fs.existsSync(pkgJson), `${HARNESS} is not installed at ${pkgJson} — run npm ci`);

  const version = readJson(pkgJson).version;
  assert.equal(typeof version, 'string', `${HARNESS}/package.json declares no version string`);

  const installed = parseSemver(version as string, `installed ${HARNESS}`);
  assert.ok(
    compareSemver(installed, parseSemver(FLOOR, 'floor')) >= 0,
    `installed ${HARNESS} is ${version as string}; ${FLOOR} is the first release that exports the ` +
      'Producer Profile subtype this host declares (`CIVICAITOOLS_V1_PRODUCER_PROFILE`; hub ADR-0038; ' +
      'civic-ai-tools#289 P5). 0.10.0 is the floor that states how a run\'s ' +
      'sources were chosen (`routing`, `definitionHash`) and what each `load_source` call did ' +
      '(`civic:loadOutcome`; hub ADR-0033 amendment 2; #644). 0.9.0 is the floor that states the reader\'s ' +
      'own states as reasons (`reader-off`, `not-consented`) and refers to the flows statement in force ' +
      '(hub ADR-0033, amended 2026-10-18; #632). 0.7.0 is the floor that attributes every call ' +
      'to its own source, states no temperature or tool list it was not given, prefers the servers the run ' +
      'recorded, and states the composition block (#475, #495); below it a record names the ' +
      'servers configured at publish and a temperature no request sent. 0.5.0 is the floor for source agents ' +
      'that omit `civic:serverUrl` rather than assert a source id as an address (civic-ai-tools#205, #449); ' +
      '0.4.0 the floor for `failed` in buildDataSources (hub ' +
      'data-sources.ts:153-159 at a6d6f77); 0.3.1 the floor for the graph half (hub provenance.ts:339/:343 at ' +
      "fd9afae), below which dist/capture/provenance.js:177 defaults tool.name to 'get_data'.",
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

test('harness pin: exactly one copy of each core — no nested @typedstandards/produce-core or verify-core', () => {
  // 0.3.0 depended on `@typedstandards/produce-core: ^0.3.0`, a range that
  // excludes the 0.4.0 this repository moved to, so npm nested a SECOND
  // produce-core under the harness. 0.3.1 widened the range to
  // `^0.3.0 || ^0.4.0`, which lets one copy serve both. Two copies is not a
  // cosmetic duplication here: produce-core owns envelope assembly and the
  // PROV-O node helpers whose insertion order is the signed byte contract, so
  // "which copy assembled these bytes" is a question a record system should
  // never have to ask.
  //
  // RE-READ AT 0.4.0 (Wave N10 P4) AND AT 0.5.0 (Wave N12 W5). The harness's
  // own dependency range is still `^0.3.0 || ^0.4.0` — at each move the
  // lockfile entry for the harness changed only its version, resolved URL and
  // integrity, and no `node_modules/@typedstandards/civic-typed-harness/
  // node_modules` appeared. One copy still serves both, and the assertion
  // below still measures that rather than trusting the range.
  //
  // RE-READ AT 0.7.0 (sprint R2 W4). The harness's range is `^0.8.0`, so this
  // repository's produce-core pin moved to `^0.8.0` and verify-core's to
  // `^0.13.0`, the range produce-core 0.8.0 declares. A higher pin on either
  // (produce-core 0.9.0, verify-core 0.14.0) would nest a second copy of the
  // core below it, so both nests are measured.
  //
  // RE-READ AT 0.9.0 (sprint R6 W2). The harness's range has been `^0.9.0`
  // since 0.8.0, so this repository's produce-core pin moved to `^0.9.0` and
  // verify-core's to `^0.14.0`, the range produce-core 0.9.0 declares. The
  // lockfile moved exactly the four entries and nested no copy; the assertion
  // below measures that rather than trusting the ranges.
  //
  // RE-READ AT 0.10.0 (sprint R8 W1). 0.10.0 still declares produce-core
  // `^0.9.0` and nothing else, so neither core pin moves. The lockfile moved
  // exactly the harness and router entries and nested no copy.
  //
  // RE-READ AT 0.11.0 (sprint R10 P5). 0.11.0 still declares produce-core
  // `^0.9.0` and nothing else. This repository's verify-core pin moved to
  // `^0.15.0` (the subtype table), and produce-core 0.9.0 declares verify-core
  // `^0.14.0`, so `npm install --package-lock-only` alone kept produce-core at
  // 0.9.0 and nested verify-core 0.14.0 under it — measured, and the case the
  // loop below exists for. `npm update @typedstandards/produce-core
  // --package-lock-only` moved it, within its unchanged `^0.9.0`, to 0.9.1,
  // which declares `^0.15.0`; the lockfile then holds one copy of each.
  const nested = path.join(HARNESS_DIR, 'node_modules', '@typedstandards', 'produce-core');
  assert.equal(
    fs.existsSync(nested),
    false,
    `a second produce-core is nested at ${nested}; the harness's dependency range must admit the ` +
      "root copy (0.11.0 declares '^0.9.0'), so npm install resolves one.",
  );
  const PRODUCE_DIR = path.join(REPO_ROOT, 'node_modules', '@typedstandards', 'produce-core');
  for (const owner of [HARNESS_DIR, PRODUCE_DIR]) {
    const nestedVerify = path.join(owner, 'node_modules', '@typedstandards', 'verify-core');
    assert.equal(
      fs.existsSync(nestedVerify),
      false,
      `a second verify-core is nested at ${nestedVerify}; this repository's verify-core range must admit ` +
        "the one produce-core declares (produce-core 0.9.1 declares '^0.15.0'), so npm install resolves one.",
    );
  }
});
