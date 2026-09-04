// The signed graph states what the span carried — read back from a package
// this repository built (Wave N9 #384, criterion 6; family F2, #378 + C4).
//
// SCOPE, and against what universe. One package, built end-to-end by THIS
// repository's `buildEvidencePackage` from a trace written by THIS
// repository's own span builder (`./trace.ts` → the harness `TraceBuilder`,
// with `CIVICAITOOLS_TRACE_CONFIG`), then serialized and parsed back the way
// storage round-trips it. The assertions read the STORED bytes' `provenance`
// graph, `dataSources` and `queries` — not the builder's return value in
// isolation, and not a hand-written graph fragment. What they cover is the
// four `mcp_tool_call` spans a `get_data` + `search` + `fetch` + one-rejected
// run writes, and the nodes the graph derives from each. They do not cover
// the published read-back on a running instance, which is an owner-run leg.
//
// THE SPAN SHAPE IS THE PRODUCER'S, NOT THIS FILE'S. Every attribute below is
// written the way `src/lib/model-loop/run-tool-loop.ts` writes it. The line
// numbers were re-read in the tree by Wave N10 P1, which moved one of these
// sites; every one of them was stale before that (the file had carried the
// numbers `:799`, `:815-821`, `:816`, `:821`, `:834-841`, `:858-859` and
// `:861-864` since before Wave N9 P8 shifted the whole block down):
//   - `:825-832` opens the span with `tool.name` (`:826`),
//     `tool.operation_type`, `tool.arguments`, `mcp.source`,
//     `tool.dataset_id` only when the arguments carry one, and
//     `tool.portal_domain` (`:831`) only when they carry a portal;
//   - `:809` injects the run's portal into `get_data` arguments and NO other
//     tool's, which is why a `search` or `fetch` span carries no portal at
//     all;
//   - `:847-852` ends a successful span with `tool.response_hash`,
//     `tool.response_size_bytes`, `tool.duration_ms` and `tool.response_rows`;
//   - `:892-895` ends a rejected one with `error: true` and `error.kind` — the
//     classified `ToolFailureKind`, never the source's raw message (#404) —
//     and no response hash, while `:871-872` sets `failed` / `failureKind` on
//     the tool-call record. The span and the record therefore state the same
//     classified value and nothing else about the cause.
// The operation types come from `deriveOperationType` and the sources from
// `sourceIdForToolName`, so `fetch`'s honest `'unknown'` is derived here, not
// asserted by hand.
//
// THE CROSS-REPO PIN (rider 9). The behaviour asserted here is the one hub
// PR #188 (merged `ef93331`) landed and hub PR #191 (merged `fd9afae`)
// released as `@typedstandards/civic-typed-harness@0.3.1`. The fixed source
// is `packages/civic-typed-harness/src/capture/provenance.ts` at `fd9afae`:
// `:339` ("Absent when the span carried none — never defaulted") and `:343`
// ("Absent when the span carried none — never the run's portal"), the
// description at `:387-389`, and the dataset keys at `:403-414`; plus
// `src/capture/data-sources.ts` at `fd9afae`, whose `fallbackPortal` is
// "accepted and NOT consulted since 0.3.1". Before the fix those defaults
// read, at `ef93331^`, `provenance.ts:316` (`|| 'get_data'`) and `:319`
// (`|| portal`) — shipped in 0.3.0 as `dist/capture/provenance.js:177` and
// `:180`, the lines the wave's census names. The spans this file drives are
// the shape the harness's own tests drive: `src/capture/provenance.test.ts`
// "the graph states what the span carried: …" (three cases) and
// `src/capture/data-sources.test.ts` "dataSources states what the call
// carried: …", including their `nodesDerivedFromToolSpan` /
// `assertNoPortalClaim` helpers, mirrored below.
//
// WHAT IS RED AT `c342fe0` (harness 0.3.0 installed) AND WHAT IS A CONTROL.
//   RED — the search's data-response entity is described "Data response from
//         <the run's portal>", and so is the fetch's. That is
//         `dist/capture/provenance.js:180` substituting `input.portal` for an
//         attribute the span never carried, inside bytes this instance signs.
//   CONTROL, green at base and still green after — `civic:portalDomain` and
//         `civic:datasetUrl` are absent on those two entities even at 0.3.0,
//         because `:218-225` gates them on `tool.dataset_id`, which a
//         `search` / `fetch` span has no reason to carry. Asserted anyway:
//         the fix must not start emitting them.
//   CONTROL — the portal embedded in the `fetch` id never reaches the graph,
//         at 0.3.0 or after: the builder hashes `tool.arguments` and never
//         parses them.
//   CONTROL — every query entity carries its own span's `tool.name`. The
//         `|| 'get_data'` default at `:177` is latent for this producer
//         (`run-tool-loop.ts:826` always writes the name), so this pins the
//         honest shape rather than showing the defect; it goes red the day a
//         producer stops writing one.
//   CONTROL — `queries` (P3's `failed` / `failureKind`), honest at base.
//   CONTROL — verification passes over the round-tripped package. The wave's
//         own note: `src/lib/evidence/verify.ts` reads no tool-call field, so
//         every defect in this family verifies GREEN. Verification is not a
//         backstop for any of this, and this assertion exists to say so out
//         loud, before and after.
//
// AMENDED BY P8 (the cold read's F1, measured at `4ec45c0`). As first
// written, the rejected call (iv) hit the SAME dataset as the successful (i),
// "so `dataSources` still de-duplicates to one entry" — the one configuration
// in which `dataSources` cannot be seen asserting a rejected call's dataset,
// because the answered call had already minted the entry. `packager.ts:424`
// hands every tool call, `failed: true` included, to the harness's
// `buildDataSources`, whose input type is `{ name; args }` and which reads
// `args.dataset_id` and `args.portal` alone. The rejected call now names a
// DIFFERENT dataset, and (e) — unchanged in what it asserts, "exactly one
// dataset-keyed entry, the get_data's" — is RED at `4ec45c0`: the read-back
// package says `queries[3]` failed and that `queries[3]`'s dataset was
// accessed. Every other assertion in this file keeps its verdict.
//
// AMENDED BY WAVE N10 P1 (#404), and what P1 deliberately did NOT touch. P1
// changed one thing here: the rejected span now ends with `error.kind`, the
// classified `ToolFailureKind`, where it used to end with `error.message` and
// the source's raw text. It re-pointed every `run-tool-loop.ts` citation
// above, having re-read each site in the tree. It left the two
// `packager.ts:424` citations — this paragraph and the failure message on
// (e) — alone: that line is `:449-450` today and no longer hands the rejected
// call through unchanged (P8 added the `rejectedCallStandIn` at `:397-402`
// that intervenes), so the sentence needs rewriting, not renumbering, and the
// rewrite belongs to P4, which deletes the stand-in and takes the harness pin
// that makes it unnecessary. Both citations are stale as they stand; they are
// flagged here rather than half-fixed.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePackage, type PackageInput, type ToolCallInput } from './packager.ts';
import { TraceBuilder, hash as traceHash, CIVICAITOOLS_TRACE_CONFIG } from './trace.ts';
import { recomputePackageHash, resolveContentCanonicalization, verifyContentHash } from './verify.ts';
import { deriveOperationType, sourceIdForToolName } from '../mcp/operation-types.ts';
import { CIVIC_URN_PREFIX } from '@typedstandards/civic-typed-harness';
import { REFERENCE_IDENTITY_ENV } from './reference-identity-fixture.ts';

// Every envelope carries `metadata.signingKeyId` and there is no coded
// default (signing.ts); #258 also refuses to build without a declared
// instance identity. `node --test` runs each file in its own process, so both
// are local to this suite. The reference fixture is test input — no signing
// key is generated, displayed or handled anywhere in this file.
process.env.EVIDENCE_KEY_ID ??= 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) {
  process.env[name] ??= value;
}

/** The portal the RUN selected — the value `PackageInput.portal` carries and
 *  the one `run-tool-loop.ts:809` injects into `get_data` arguments. */
const RUN_PORTAL = 'data.cityofnewyork.us';
/** A portal that appears only inside a `fetch` id's server-side grammar. The
 *  graph must adopt it no more than it adopts the run's. */
const OTHER_PORTAL = 'data.other-portal.example';
const DATASET_ID = 'erm2-nwe9';
/** The dataset the REJECTED call named. No data came from it, so no entry may
 *  be minted for it — a request the source did not answer accessed nothing. */
const REJECTED_DATASET_ID = 'efgh-5678';

type GraphNode = { '@id': string; [k: string]: unknown };

interface SpanFixture {
  /** The tool call as the loop records it (`toolCalls[]` → `queries[]`). */
  call: ToolCallInput;
  /** The tool result string the loop hashes, or `undefined` for a rejection. */
  result?: string;
  /** Filled in when the trace is built. */
  spanId?: string;
}

// --- The run: get_data, search, fetch, and one rejected get_data ---
//
// (i)  a `get_data` whose arguments carry the injected portal and a dataset
//      id — the only tool that gets either.
// (ii) a `search`: one argument, `query`; no portal, no dataset id.
// (iii) a `fetch`: one argument, `id`, whose `record:` grammar embeds
//      ANOTHER portal; no portal attribute, no dataset id.
// (iv) a second `get_data` on a DIFFERENT dataset, rejected on a timeout
//      (amended by P8 — see the header). A dataset id the answered call did
//      not name, so the only way it reaches `dataSources` is through the
//      rejected call itself; its query entity is a distinct node.
function runFixtures(): SpanFixture[] {
  return [
    {
      call: {
        name: 'get_data',
        args: { type: 'query', portal: RUN_PORTAL, dataset_id: DATASET_ID, select: 'count(*)' },
        resultSummary: { rows: 1, columns: 1 },
      },
      result: '[{"count":"412093"}]',
    },
    {
      call: { name: 'search', args: { query: 'noise complaints' }, resultSummary: { rows: 3, columns: 4 } },
      result: '[{"id":"erm2-nwe9","name":"311 Service Requests"}]',
    },
    {
      call: {
        name: 'fetch',
        args: { id: `record:${OTHER_PORTAL}:abcd-1234:a0b1` },
        resultSummary: { rows: 1, columns: 9 },
      },
      result: '{"unique_key":"a0b1","complaint_type":"Noise - Street/Sidewalk"}',
    },
    {
      call: {
        name: 'get_data',
        args: {
          type: 'query',
          portal: RUN_PORTAL,
          dataset_id: REJECTED_DATASET_ID,
          select: 'complaint_type, count(*)',
          group: 'complaint_type',
        },
        failed: true,
        failureKind: 'timeout',
      },
    },
  ];
}

/** Write the trace exactly as `run-tool-loop.ts` writes it, mutating each
 *  fixture with the span id the builder assigned. */
function buildTrace(fixtures: SpanFixture[]): Record<string, unknown> {
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', { 'analysis.portal': RUN_PORTAL });

  const inferenceSpanId = builder.startSpan('llm_inference', undefined, {
    'gen_ai.inference_index': '0',
  });
  builder.endSpan(inferenceSpanId, {
    'gen_ai.response.prompt_tokens': 100,
    'gen_ai.response.completion_tokens': 20,
  });

  for (const fixture of fixtures) {
    const { name, args } = fixture.call;
    const operationType = deriveOperationType(name, args);
    const toolSource = sourceIdForToolName(name) ?? 'unknown';

    // run-tool-loop.ts:825-832, attribute for attribute.
    const spanId = builder.startSpan('mcp_tool_call', undefined, {
      'tool.name': name,
      'tool.operation_type': operationType || 'unknown',
      'tool.arguments': JSON.stringify(args),
      'mcp.source': toolSource,
      ...(args.dataset_id ? { 'tool.dataset_id': String(args.dataset_id) } : {}),
      ...(args.portal ? { 'tool.portal_domain': String(args.portal) } : {}),
    });
    fixture.spanId = spanId;

    if (fixture.result !== undefined) {
      // run-tool-loop.ts:847-852.
      builder.endSpan(spanId, {
        'tool.response_hash': traceHash(fixture.result),
        'tool.response_size_bytes': fixture.result.length,
        'tool.duration_ms': 120,
        ...(fixture.call.resultSummary ? { 'tool.response_rows': fixture.call.resultSummary.rows } : {}),
      });
    } else {
      // run-tool-loop.ts:892-895 — a rejection ends with no response hash,
      // and with the CLASSIFIED kind rather than the source's raw text
      // (#404, Wave N10 P1). `error.kind` carries the same `ToolFailureKind`
      // value the catch site writes onto the record at `:871-872`, so it is
      // read off the fixture's own call rather than restated: a fixture that
      // could state one kind on the span and another on the record is not the
      // producer's shape.
      const failureKind = fixture.call.failureKind;
      assert.ok(failureKind, 'a rejected fixture states the kind the loop classified');
      builder.endSpan(spanId, {
        error: true,
        'error.kind': failureKind,
      });
    }
  }

  builder.endRoot();
  return builder.finalize() as unknown as Record<string, unknown>;
}

function packageInput(fixtures: SpanFixture[], trace: Record<string, unknown>): PackageInput {
  return {
    trace,
    prompt: 'How many 311 noise complaints were filed last year?',
    output: 'About 412,000.',
    toolCalls: fixtures.map((f) => f.call),
    model: 'openai/gpt-4o',
    portal: RUN_PORTAL,
    tokenUsage: { promptTokens: 100, completionTokens: 20 },
    promptVisibility: 'full_text',
    title: 'Noise complaints, 2025',
    summary: 'About 412,000 noise complaints were filed.',
    // v0.1 so the package carries `contentHash` and the verification control
    // exercises the JCS chain rather than the legacy relabel.
    type: 'content/analysis/v1',
  };
}

// Built once: `buildEvidencePackage` mints a random packageId, so every
// assertion below must read the same package.
const FIXTURES = runFixtures();
const TRACE = buildTrace(FIXTURES);
const BUILT = buildEvidencePackage(packageInput(FIXTURES, TRACE));
/** The package as storage hands it back — the read-back the criterion names. */
const READ_BACK = JSON.parse(JSON.stringify(BUILT.pkg)) as Record<string, unknown>;

function graphNodes(): GraphNode[] {
  const provenance = READ_BACK.provenance as { '@graph'?: GraphNode[] } | undefined;
  assert.ok(provenance, 'the read-back package carries no provenance graph');
  const nodes = provenance!['@graph'];
  assert.ok(Array.isArray(nodes), "the read-back package's provenance carries no @graph array");
  return nodes!;
}

function packageId(): string {
  const metadata = READ_BACK.metadata as { packageId?: string } | undefined;
  assert.ok(metadata?.packageId, 'the read-back package carries no metadata.packageId');
  return metadata!.packageId!;
}

/** Mirrors the harness's own `nodesDerivedFromToolSpan`: the tool-call
 *  activity (asserted present — absence is stated on the span's nodes, the
 *  span is not dropped), the query entities it `prov:used`, and the
 *  data-response entities it generated. */
function nodesDerivedFromToolSpan(spanId: string): GraphNode[] {
  const nodes = graphNodes();
  const toolCallUrn = `${CIVIC_URN_PREFIX}:${packageId()}:tool-call:${spanId}`;
  const activity = nodes.find((n) => n['@id'] === toolCallUrn);
  assert.ok(activity, `${toolCallUrn}: the tool-call activity must be on the graph — the span is walked, not dropped`);
  const used = (activity!['prov:used'] as Array<{ '@id': string }> | undefined) ?? [];
  const usedIds = new Set(used.map((ref) => ref['@id']));
  const queries = nodes.filter((n) => usedIds.has(n['@id']));
  const responses = nodes.filter(
    (n) => (n['prov:wasGeneratedBy'] as { '@id'?: string } | undefined)?.['@id'] === toolCallUrn,
  );
  return [activity!, ...queries, ...responses];
}

/** Mirrors the harness's own `assertNoPortalClaim`. No node derived from the
 *  span may name `portal`: not in `dcterms:description`, not as
 *  `civic:portalDomain`, not inside `civic:datasetUrl`, not anywhere else. */
function assertNoPortalClaim(nodes: GraphNode[], portal: string, why: string): void {
  for (const node of nodes) {
    const description = node['dcterms:description'];
    if (typeof description === 'string') {
      assert.ok(
        !description.includes(portal),
        `${node['@id']}: dcterms:description "${description}" names ${portal} — ${why}`,
      );
    }
    assert.notEqual(
      node['civic:portalDomain'],
      portal,
      `${node['@id']}: civic:portalDomain asserts ${portal} — ${why}`,
    );
    const datasetUrl = node['civic:datasetUrl'];
    if (typeof datasetUrl === 'string') {
      assert.ok(
        !datasetUrl.includes(portal),
        `${node['@id']}: civic:datasetUrl "${datasetUrl}" is minted on ${portal} — ${why}`,
      );
    }
    assert.ok(
      !JSON.stringify(node).includes(portal),
      `${node['@id']}: a node derived from the span carries ${portal} — ${why}`,
    );
  }
}

function spanIdFor(index: number): string {
  const id = FIXTURES[index].spanId;
  assert.ok(id, `fixture ${index} has no span id — the trace was not built`);
  return id!;
}

function dataResponseOf(nodes: GraphNode[]): GraphNode {
  const response = nodes.find((n) => n['@id'].includes(':data:'));
  assert.ok(response, 'the data-response entity must be on the graph — the span carried a response hash');
  return response!;
}

// --- (a) RED at base: the search's response is attributed to the run portal ---

test('read-back (a) RED: the search span carried no portal, so no node derived from it names the run portal', () => {
  const derived = nodesDerivedFromToolSpan(spanIdFor(1));
  assert.ok(
    derived.some((n) => n['@id'].includes(':data:')),
    'the data-response entity must be on the graph — the span carried a response hash',
  );
  assertNoPortalClaim(
    derived,
    RUN_PORTAL,
    "the span carried no tool.portal_domain (run-tool-loop.ts:831 writes one only when the arguments do, " +
      "and :809 injects a portal for get_data alone), so the run's portal is not what this call addressed",
  );
});

test('read-back (a) CONTROL: the search response entity carries neither civic:portalDomain nor civic:datasetUrl', () => {
  const response = dataResponseOf(nodesDerivedFromToolSpan(spanIdFor(1)));
  assert.equal(
    Object.prototype.hasOwnProperty.call(response, 'civic:portalDomain'),
    false,
    'a search response states no portal domain — the span carried none',
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(response, 'civic:datasetUrl'),
    false,
    'a dataset URL needs a host the span did not carry',
  );
});

// --- (b) RED at base: the fetch's response, likewise; and the id's portal ---

test('read-back (b) RED: the fetch span carried no portal, so no node derived from it names the run portal', () => {
  const derived = nodesDerivedFromToolSpan(spanIdFor(2));
  assert.ok(
    derived.some((n) => n['@id'].includes(':data:')),
    'the data-response entity must be on the graph — the span carried a response hash',
  );
  assertNoPortalClaim(
    derived,
    RUN_PORTAL,
    "the span carried no tool.portal_domain, and the run's portal is not what this call addressed",
  );
});

test('read-back (b) CONTROL: the portal embedded in the fetch id reaches no node — the graph never parses arguments', () => {
  const derived = nodesDerivedFromToolSpan(spanIdFor(2));
  assertNoPortalClaim(
    derived,
    OTHER_PORTAL,
    "the record: id grammar belongs to the MCP server, the only party that resolves it; the span carried " +
      'the id as opaque arguments and no portal attribute',
  );
  const response = dataResponseOf(derived);
  assert.equal(
    Object.prototype.hasOwnProperty.call(response, 'civic:portalDomain'),
    false,
    'a fetch response states no portal domain — the span carried none',
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(response, 'civic:datasetUrl'),
    false,
    'a dataset URL needs a host the span did not carry',
  );
});

// --- (c) CONTROL: the honest shape survives for the call that DID carry one ---

test('read-back (c) CONTROL: the get_data span carried a portal and a dataset id, so its response states both', () => {
  const response = dataResponseOf(nodesDerivedFromToolSpan(spanIdFor(0)));
  assert.equal(response['dcterms:description'], `Data response from ${RUN_PORTAL}`);
  assert.equal(response['civic:datasetId'], DATASET_ID);
  assert.equal(response['civic:portalDomain'], RUN_PORTAL);
  assert.equal(response['civic:datasetUrl'], `https://${RUN_PORTAL}/d/${DATASET_ID}`);
  assert.equal(response['civic:sourceId'], 'socrata');
});

// --- (d) CONTROL: every query entity names its own span's tool ---

test('read-back (d) CONTROL: each of the four query entities carries its own span’s civic:toolName, never get_data by default', () => {
  const expected = ['get_data', 'search', 'fetch', 'get_data'];
  for (let i = 0; i < FIXTURES.length; i++) {
    const derived = nodesDerivedFromToolSpan(spanIdFor(i));
    const query = derived.find((n) => n['@id'].includes(':query:'));
    assert.ok(query, `span ${i}: the query entity must be on the graph`);
    assert.equal(
      query!['civic:toolName'],
      expected[i],
      `span ${i}: the query entity names ${String(query!['civic:toolName'])}, not the ${expected[i]} the span carried`,
    );
  }
  // The two tools whose spans could reach the 0.3.0 default are named
  // explicitly, so a regression that reintroduces it is unmistakable.
  const searchQuery = nodesDerivedFromToolSpan(spanIdFor(1)).find((n) => n['@id'].includes(':query:'));
  const fetchQuery = nodesDerivedFromToolSpan(spanIdFor(2)).find((n) => n['@id'].includes(':query:'));
  assert.notEqual(searchQuery!['civic:toolName'], 'get_data', 'a search is not a get_data');
  assert.notEqual(fetchQuery!['civic:toolName'], 'get_data', 'a fetch is not a get_data');
});

// --- (e) RED at 4ec45c0 (P8, F1): dataSources mints an entry only from what a call that was ANSWERED carried ---

test('read-back (e) RED: dataSources holds exactly one dataset-keyed entry — the answered get_data’s — and none for the search, the fetch, or the rejected get_data', () => {
  const entries = READ_BACK.dataSources as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(entries), 'the read-back package carries no dataSources array');
  const datasetKeyed = entries.filter((e) => typeof e.datasetId === 'string');
  const rejected = datasetKeyed.find((e) => e.datasetId === REJECTED_DATASET_ID);
  assert.equal(
    rejected,
    undefined,
    `the package says queries[3] failed and that its dataset was accessed: ${JSON.stringify(rejected)} — ` +
      'packager.ts:424 hands the rejected call to buildDataSources, which reads args.dataset_id/args.portal and never failed',
  );
  assert.equal(
    datasetKeyed.length,
    1,
    `expected one dataset-keyed entry, got ${datasetKeyed.length}: ${JSON.stringify(datasetKeyed)}`,
  );
  assert.equal(datasetKeyed[0].sourceId, 'socrata');
  assert.equal(datasetKeyed[0].datasetId, DATASET_ID);
  assert.equal(datasetKeyed[0].portalUrl, `https://${RUN_PORTAL}`);
  assert.equal(datasetKeyed[0].datasetUrl, `https://${RUN_PORTAL}/d/${DATASET_ID}`);
  // Neither the search nor the fetch carried a dataset id, so neither may
  // mint an entry — and nothing may name the portal buried in the fetch id.
  assert.equal(entries.length, 1, `dataSources holds an entry no call earned: ${JSON.stringify(entries)}`);
  assert.ok(
    !JSON.stringify(entries).includes(OTHER_PORTAL),
    'no dataSources entry may carry the portal embedded in a fetch id',
  );
});

// --- (f) CONTROL (P3): the rejected call is a rejected call in the package ---

test('read-back (f) CONTROL: queries holds four entries and the rejected one carries failed / failureKind', () => {
  const queries = READ_BACK.queries as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(queries), 'the read-back package carries no queries array');
  assert.equal(queries.length, 4, `expected four queries, got ${queries.length}`);
  assert.deepEqual(
    queries.map((q) => q.tool),
    ['get_data', 'search', 'fetch', 'get_data'],
  );
  // `fetch` derives to no operation type by design (operation-types.ts) — the
  // packager records the honest 'unknown' rather than guessing.
  assert.equal(queries[1].operationType, 'search');
  assert.equal(queries[2].operationType, 'unknown');

  assert.equal(queries[3].failed, true, 'the rejected call must be marked failed in the package');
  assert.equal(queries[3].failureKind, 'timeout');
  assert.equal(queries[3].datasetId, REJECTED_DATASET_ID, 'the rejected attempt still names the dataset it was made against');
  for (const i of [0, 1, 2]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(queries[i], 'failed'),
      false,
      `query ${i} was not recorded as failed — absent stays absent, never false`,
    );
  }
});

// --- The verification control ---

test('read-back CONTROL: verification passes over the round-tripped package — and is not a backstop for any of the above', () => {
  // `src/lib/evidence/verify.ts` reads no tool-call field. A graph that named
  // a portal the span never carried would verify exactly as green as one that
  // did not, which is why the assertions above read the graph directly. This
  // control holds the other half: the instrument must not be changing bytes
  // in a way that breaks the integrity chain.
  assert.equal(
    recomputePackageHash(READ_BACK),
    BUILT.hash,
    'the round-tripped package must recompute to the hash it was built under',
  );
  const resolution = resolveContentCanonicalization(READ_BACK);
  assert.equal(resolution.status, 'ok', `content-canonicalization rule unresolved: ${JSON.stringify(resolution)}`);
  const contentHash = verifyContentHash(READ_BACK, resolution);
  assert.equal(contentHash.status, 'ok', `content hash did not verify: ${JSON.stringify(contentHash)}`);
});
