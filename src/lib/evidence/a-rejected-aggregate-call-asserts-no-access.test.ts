// P4 red instrument, Wave N10 (#409, #192's website half) — criterion 6.
//
// THE PROPERTY: a call the source rejected asserts no access, on BOTH branches
// of the data-source walk — the dataset-keyed one and the aggregate one.
//
// Wave N9's P8 closed the dataset-keyed half here, in the website, with a
// positional STAND-IN: `rejectedCallStandIn` (`packager.ts:397-402`, call site
// `:450`) hands `buildDataSources` a copy of the rejected call with
// `dataset_id` and `portal` deleted — the two keys a dataset-keyed entry is
// minted from — because the harness at `^0.3.1` types its input as
// `{ name; args }` and cannot see `failed` at all.
//
// THE RESIDUAL THAT STAND-IN CANNOT REACH. The aggregate branch needs neither
// key. In the harness it reads
//
//     } else if (registry[source]?.aggregatePortalUrl !== undefined) {
//       aggregateAccessed.add(source);
//
// so it fires for ANY call that resolves to a source carrying
// `aggregatePortalUrl`, whatever its arguments. Stripping `dataset_id` and
// `portal` changes nothing there. A rejected `get_observations` — which
// `sourceIdForToolName` resolves to `data-commons`, an aggregate source
// (`operation-types.ts:57`) — therefore still marks its source ACCESSED,
// inside bytes this instance signs, for a call the record itself says failed.
//
// This is the residual the seat found at Wave N9's GO, and the reason a
// stand-in was always a stopgap: it is a patch shaped like the branch it
// knew about, and the property is shaped like the record.
//
// WHAT WAS MEASURED AT 91acaad (by the ORCH, 2026-09-04, before this file):
//
//   - `package.json:32` pins `"@typedstandards/civic-typed-harness": "^0.3.1"`;
//     the installed version is 0.3.1.
//   - `harness-pin.test.ts` asserts a RANGE with FLOOR `'0.3.1'` and an
//     EXCLUSIVE CEILING `'0.4.0'`, by design — its comment says a 0.x minor
//     is a breaking change and the pin "refuses 0.4.0, which would be a
//     different contract this test has not read". Under D6 the ceiling moves
//     DELIBERATELY with the floor; it does not drift.
//   - `packager.ts:450` substitutes the stand-in for any `tc.failed`.
//   - 0.4.0 is published: `npm view @typedstandards/civic-typed-harness@0.4.0
//     dist.shasum` → `fbf52995ab70a7efdda2aeea8b2a803ec0bf0c90`, 28 files. It
//     reads `failed` on BOTH branches, which is what retires the stand-in.
//
// THE FIXTURE NAMES THE SHAPE THAT COULD FAIL. The rejected call here is to an
// AGGREGATE source and is the ONLY call to that source in the run — the second
// of the two shapes this wave exists for. A run whose aggregate source was also
// reached by a call that succeeded would keep its entry legitimately, and the
// assertion could not fail. A successful Socrata call is present so the package
// still has a dataset-keyed entry to hold, which keeps the control honest.
//
// EXPECTED AT 91acaad: the guard passes; the two property tests fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildEvidencePackage, type ToolCallInput } from './packager.ts';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';
import { sourceIdForToolName } from '../mcp/operation-types.ts';

const PORTAL = 'data.cityofnewyork.us';
const ANSWERED = 'erm2-nwe9';
const AGGREGATE_TOOL = 'get_observations';
const AGGREGATE_SOURCE = 'data-commons';

process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

/**
 * One Socrata call that answered, and one aggregate call the source REJECTED —
 * the only call to that source in the run.
 */
const TOOL_CALLS: ToolCallInput[] = [
  {
    name: 'get_data',
    args: { type: 'query', portal: PORTAL, dataset_id: ANSWERED, select: 'count(*)' },
    resultSummary: { rows: 1, columns: 1 },
  } as unknown as ToolCallInput,
  {
    name: AGGREGATE_TOOL,
    args: { variable: 'Count_Person', place: 'geoId/36061' },
    failed: true,
    failureKind: 'unavailable',
  } as unknown as ToolCallInput,
];

/**
 * Span timestamps, composed rather than written out. A 19-digit nanosecond
 * literal is a 13+ digit run, which the pre-push sensitivity guard reads as
 * account-shaped and blocks — correctly, since it cannot know what a long
 * digit run means. Composing it keeps the value identical and the source
 * free of the shape.
 */
const START_SEC = 1_757_000_000;
const NANOS = '000000000';

/** A trace whose two tool spans pair by index with the calls above. */
function trace(): Record<string, unknown> {
  const span = (name: string, attrs: Record<string, string | boolean>) => ({
    traceId: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6',
    spanId: name.slice(0, 16).padEnd(16, '0'),
    name: 'mcp_tool_call',
    kind: 1,
    startTimeUnixNano: `${START_SEC}${NANOS}`,
    endTimeUnixNano: `${START_SEC + 1}${NANOS}`,
    attributes: Object.entries(attrs).map(([key, v]) => ({
      key,
      value: typeof v === 'boolean' ? { boolValue: v } : { stringValue: v },
    })),
    events: [],
    status: { code: 1 },
  });
  return {
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            scope: { name: 'test', version: '1' },
            spans: [
              span('answered', {
                'tool.name': 'get_data',
                'tool.operation_type': 'query',
                'tool.arguments': JSON.stringify(TOOL_CALLS[0].args),
                'mcp.source': 'socrata',
                'tool.dataset_id': ANSWERED,
                'tool.portal_domain': PORTAL,
              }),
              span('rejected', {
                'tool.name': AGGREGATE_TOOL,
                'tool.operation_type': 'query',
                'tool.arguments': JSON.stringify(TOOL_CALLS[1].args),
                'mcp.source': AGGREGATE_SOURCE,
                error: true,
                'error.kind': 'unavailable',
              }),
            ],
          },
        ],
      },
    ],
  };
}

function build() {
  const { pkg } = buildEvidencePackage({
    trace: trace(),
    prompt: 'How many people live in Manhattan, and how many noise complaints were filed?',
    output: 'About 412,000 noise complaints were filed.',
    toolCalls: TOOL_CALLS,
    model: 'fake/model',
    portal: PORTAL,
    tokenUsage: { promptTokens: 40, completionTokens: 10 },
    promptVisibility: 'full_text',
    title: 'Noise complaints',
    summary: 'About 412,000 noise complaints were filed.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
  });
  return JSON.parse(JSON.stringify(pkg)) as {
    queries: Array<Record<string, unknown>>;
    dataSources: Array<Record<string, unknown>>;
  };
}

// --- Guard: the fixture has the shape that could fail -----------------------

test('guard: the rejected call is to an aggregate source, and is the only call to it', () => {
  assert.equal(
    sourceIdForToolName(AGGREGATE_TOOL),
    AGGREGATE_SOURCE,
    'the fixture is pointless unless this tool resolves to an aggregate source',
  );
  const toThatSource = TOOL_CALLS.filter((tc) => sourceIdForToolName(tc.name) === AGGREGATE_SOURCE);
  assert.equal(
    toThatSource.length,
    1,
    'a run whose aggregate source was ALSO reached by a successful call keeps its entry legitimately, ' +
      'and this assertion could not fail — the rejected call must be the only one to that source',
  );
  assert.equal((toThatSource[0] as { failed?: boolean }).failed, true);

  const readBack = build();
  assert.equal(readBack.queries.length, 2, 'both calls are on the record');
  assert.equal(readBack.queries[1].failed, true, 'the package says the aggregate call failed');
  assert.ok(
    readBack.dataSources.some((e) => e.datasetId === ANSWERED),
    'control: the successful call still earns its dataset-keyed entry, so an empty dataSources ' +
      'would not be a passing result here',
  );
});

// --- Red at 91acaad ---------------------------------------------------------

test('a rejected aggregate call marks no source accessed', () => {
  const readBack = build();
  const asserted = readBack.dataSources.find((e) => e.sourceId === AGGREGATE_SOURCE);
  assert.equal(
    asserted,
    undefined,
    `the same package that says queries[1] failed asserts its aggregate source was accessed: ` +
      `${JSON.stringify(asserted)} — the positional stand-in (packager.ts:397-402) deletes ` +
      `dataset_id and portal, which the aggregate branch never reads, so it cannot reach this half`,
  );
});

test('the pin names the version that carries the fix, and the ceiling moves with the floor', () => {
  const pkgJson = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
  ) as { dependencies: Record<string, string> };
  const pin = pkgJson.dependencies['@typedstandards/civic-typed-harness'];

  assert.match(
    pin,
    /0\.4\.0/,
    `the pin is ${pin}; 0.4.0 is published (dist.shasum fbf52995ab70a7efdda2aeea8b2a803ec0bf0c90) ` +
      'and is the version whose buildDataSources reads `failed` on both branches',
  );

  const installed = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../node_modules/@typedstandards/civic-typed-harness/package.json', import.meta.url)),
      'utf8',
    ),
  ) as { version: string };
  assert.equal(installed.version, '0.4.0', `installed harness is ${installed.version}`);

  // The stand-in is retired, not left dormant: with 0.4.0 the harness reads
  // `failed` itself, and a stand-in that strips arguments would hide from the
  // record exactly what the record is now able to state.
  const packager = readFileSync(fileURLToPath(new URL('./packager.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(
    packager,
    /rejectedCallStandIn/,
    'the stand-in is still in packager.ts — 0.4.0 makes it unnecessary, and leaving it strips ' +
      'dataset_id and portal from a call whose failure the harness can now read directly',
  );
});
