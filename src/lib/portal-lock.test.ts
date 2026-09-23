// #436 (Wave N16 P4) — the one-portal switch, driven: the resolver the three
// query routes call, the loop core's refusal of a call naming another portal,
// the record built from such a run, the tool and prompt text, the form's
// examples, and replay's exemption.
//
// WHAT IS DRIVEN, AND WHAT MAKES EACH ASSERTION ABLE TO FAIL.
//
//   Resolver (criterion 1). `resolveRunPortal` is called with the switch and
//   `SITE_DEFAULT_PORTAL` set per case. Lock off is compared, input by input,
//   with the exact expression the routes carried before this phase
//   (`rawPortal || getDefaultPortal() || undefined`), over values that expression
//   treats differently — a portal, `""`, absent, a non-string — with the default
//   set and unset.
//
//   Loop (criterion 3). One scripted run makes nine calls. Five name another
//   portal, one per shape the lock reads: `get_data` by `portal`, by its alias
//   `domain`, and `fetch` by a `dataset:` id, a `record:` id, a URL and a
//   `host:dataset` id. Each is on a dataset NO other call in the run touches, so
//   the built package's `dataSources[]` cannot de-duplicate an access entry
//   away (CLAUDE.md, "a fixture shaped so it cannot fail"). The same script is
//   then run with the lock OFF, and that control must show every call sent and
//   the get_data datasets listed as accessed — the proof the locked assertions
//   are reading something that is there when the lock is not. Two calls the
//   lock must let through ride along: a bare-id `fetch` (outside the lock, D7)
//   and a `get_data` naming the locked portal in other case and spacing.
//
//   Replay. Run through replay's own factory with the switch ON in the
//   environment: its call naming another portal is SENT, because nothing in the
//   loop reads the environment and replay never passes a locked portal.
//
// No live endpoint, no credential: the model is a scripted loopback server, the
// data source is an in-process transport, every key is a placeholder, and both
// portal hostnames are synthetic (`.example`), outside the shapes
// `portal-default-is-configured.test.ts` matches.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/portal-lock.test.ts)

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { CompletionResult } from './openrouter-streaming.ts';
import type { EvidencePackage, PackageInput, ToolCallInput } from './evidence/packager.ts';
import type { ToolCallRecord } from './model-loop/run-tool-loop.ts';
import type { ScriptedReply } from './model-loop/test-harness.ts';

const LOCKED = 'records.city-a.example';
const FOREIGN = 'records.city-b.example';
const QUESTION = 'How many noise complaints were filed last year?';
const ANSWER = 'One figure was retrieved from the portal this instance serves.';
const ONE_ROW = JSON.stringify({ data: [{ count: '4812' }], total_rows: 1 });

const ENV_KEYS = [
  'SITE_PORTAL_LOCKED',
  'SITE_DEFAULT_PORTAL',
  'MODEL_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'MODEL_API_BASE_URL',
  'MODEL_API_KIND',
  'MODEL_API_AUTH',
  'MODEL_API_VERSION',
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
for (const k of ENV_KEYS) delete process.env[k];

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

// Instance identity for the packager, as the other package-building suites set it.
const { REFERENCE_IDENTITY_ENV } = await import('./evidence/reference-identity-fixture.ts');
process.env.PUBLISHER_KEY_ID = 'platform:test-suite-kid';
process.env.EVIDENCE_KEY_ID = 'platform:test-suite-kid';
for (const [name, value] of Object.entries(REFERENCE_IDENTITY_ENV)) process.env[name] ??= value;

const { resolveRunPortal, getDefaultPortal, isPortalLocked } = await import('./site-config.ts');
const { PortalLockedCallError, portalNamedByFetchId, portalOutsideLock, PORTAL_LOCK_NOT_CONFIGURED_MESSAGE } = await import('./portal-lock.ts');
const { describeToolFailureForLlm, portalLockRefusalForLlm, classifyStreamError } = await import('./streaming.ts');
const { mcpTools, mcpToolsFor } = await import('./mcp/tools.ts');
const { withPortalLockGuidance, portalLockGuidance } = await import('./mcp/socrata-skill.ts');
const { buildMcpRegistry } = await import('./mcp/registry.ts');
const { EXAMPLE_QUERIES, offeredExampleQueries } = await import('./query-presentation.ts');
const { startScriptedModelServer } = await import('./model-loop/test-harness.ts');
const { runToolLoop } = await import('./model-loop/run-tool-loop.ts');
const { compareLoopOptions } = await import('./model-loop/compare-loop.ts');
const { replayLoopOptions, replayLoopOptionsForPackage } = await import('./model-loop/replay-loop.ts');
const { queryWithMcpStreaming } = await import('./openrouter-streaming.ts');
const { createModelClient, _resetDefaultModelClientForTests } = await import('./model-client.ts');
const { carriedModelIdentity } = await import('./model-catalog.ts');
const { encodeSSE } = await import('./streaming.ts');
const { buildEvidencePackage } = await import('./evidence/packager.ts');
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } = await import('./evidence/trace.ts');
const { sourceIdForToolName } = await import('./mcp/operation-types.ts');
const { describeQueryOutcome } = await import('./evidence/query-step.ts');

afterEach(() => {
  delete process.env.SITE_PORTAL_LOCKED;
  delete process.env.SITE_DEFAULT_PORTAL;
});

function withEnv<T>(env: { locked?: string; portal?: string }, run: () => T): T {
  if (env.locked === undefined) delete process.env.SITE_PORTAL_LOCKED;
  else process.env.SITE_PORTAL_LOCKED = env.locked;
  if (env.portal === undefined) delete process.env.SITE_DEFAULT_PORTAL;
  else process.env.SITE_DEFAULT_PORTAL = env.portal;
  try {
    return run();
  } finally {
    delete process.env.SITE_PORTAL_LOCKED;
    delete process.env.SITE_DEFAULT_PORTAL;
  }
}

// --- Criterion 1: the resolver -----------------------------------------------

test('#436 C1: lock off — the resolver is the line the routes carried, input for input', () => {
  const requests: unknown[] = [FOREIGN, LOCKED, '', undefined, null, '   ', 0];
  for (const portal of [undefined, LOCKED, '   ']) {
    for (const locked of [undefined, '', '0', 'false', 'yes', 'on']) {
      withEnv({ locked, portal }, () => {
        assert.equal(isPortalLocked(), false, `SITE_PORTAL_LOCKED=${JSON.stringify(locked)} must read as off`);
        for (const requested of requests) {
          const before = (requested as string | undefined) || getDefaultPortal() || undefined;
          const resolution = resolveRunPortal(requested);
          assert.ok(resolution.ok, `lock off refused ${JSON.stringify(requested)}`);
          assert.equal(resolution.portal, before, `lock off, default ${JSON.stringify(portal)}, request ${JSON.stringify(requested)}`);
          assert.equal(resolution.lockedPortal, undefined);
        }
      });
    }
  }
});

test('#436 C1: lock on — absent, "", or the configured portal in any case or spacing runs on the configured portal', () => {
  for (const locked of ['1', 'true', ' TRUE ', 'True']) {
    withEnv({ locked, portal: LOCKED }, () => {
      assert.equal(isPortalLocked(), true, `SITE_PORTAL_LOCKED=${JSON.stringify(locked)} must read as on`);
      for (const requested of [undefined, null, '', '   ', LOCKED, '  RECORDS.City-A.EXAMPLE  ']) {
        const resolution = resolveRunPortal(requested);
        assert.ok(resolution.ok, `lock on refused ${JSON.stringify(requested)}`);
        assert.equal(resolution.portal, LOCKED);
        assert.equal(resolution.lockedPortal, LOCKED);
      }
    });
  }
});

test('#436 C1 (D1): lock on — a foreign portal is refused with a 400 whose reason names both portals', () => {
  withEnv({ locked: '1', portal: LOCKED }, () => {
    for (const requested of [FOREIGN, `${LOCKED}.evil.example`, 42]) {
      const resolution = resolveRunPortal(requested);
      assert.equal(resolution.ok, false, `lock on accepted ${JSON.stringify(requested)}`);
      if (resolution.ok) return;
      assert.equal(resolution.refusal.reason, 'foreign_portal');
      assert.equal(resolution.refusal.status, 400);
      assert.ok(resolution.refusal.message.includes(LOCKED), resolution.refusal.message);
      assert.ok(resolution.refusal.message.includes(String(requested)), resolution.refusal.message);
      // It is the caller's copy: it must not read as a data-source or configuration failure.
      assert.equal(classifyStreamError(resolution.refusal.message), 'generic');
    }
  });
});

test('#436 C1: lock on, no portal configured — the typed refusal names SITE_DEFAULT_PORTAL, whatever the request said', () => {
  for (const portal of [undefined, '', '   ']) {
    withEnv({ locked: '1', portal }, () => {
      for (const requested of [undefined, '', FOREIGN]) {
        const resolution = resolveRunPortal(requested);
        assert.equal(resolution.ok, false, 'a locked instance with no portal must refuse');
        if (resolution.ok) return;
        assert.equal(resolution.refusal.reason, 'portal_not_configured');
        assert.equal(resolution.refusal.status, 503);
        assert.equal(resolution.refusal.name, 'PortalLockError');
        assert.match(resolution.refusal.message, /SITE_DEFAULT_PORTAL/);
        assert.equal(resolution.refusal.message, PORTAL_LOCK_NOT_CONFIGURED_MESSAGE);
      }
    });
  }
});

// --- Criterion 3: which calls the lock reads ---------------------------------

test('#436 C3: the fetch-identifier reading follows the server\'s grammar', () => {
  assert.equal(portalNamedByFetchId(`dataset:${FOREIGN}:dddd-4444`), FOREIGN);
  assert.equal(portalNamedByFetchId(`record:${FOREIGN.toUpperCase()}:dddd-4444:7`), FOREIGN);
  assert.equal(portalNamedByFetchId(`https://${FOREIGN}/Public-Safety/x/eeee-5555`), FOREIGN);
  assert.equal(portalNamedByFetchId(`${FOREIGN}/d/eeee-5555`), FOREIGN);
  assert.equal(portalNamedByFetchId(`${FOREIGN}:hhhh-8888`), FOREIGN);
  // Names no portal: resolved by the server against its own configuration, outside the lock (D7).
  assert.equal(portalNamedByFetchId('ffff-6666'), null);
  assert.equal(portalNamedByFetchId('ffff-6666:12'), null);
  assert.equal(portalNamedByFetchId(''), null);
  assert.equal(portalNamedByFetchId(undefined), null);
});

test('#436 C3: portalOutsideLock reads get_data by portal and by domain, fetch by its id, and nothing else', () => {
  assert.equal(portalOutsideLock('get_data', { portal: FOREIGN }, LOCKED), FOREIGN);
  assert.equal(portalOutsideLock('get_data', { portal: LOCKED, domain: FOREIGN }, LOCKED), FOREIGN);
  assert.equal(portalOutsideLock('get_data', { portal: ` ${LOCKED.toUpperCase()} ` }, LOCKED), null);
  assert.equal(portalOutsideLock('get_data', {}, LOCKED), null);
  assert.equal(portalOutsideLock('fetch', { id: `dataset:${FOREIGN}:dddd-4444` }, LOCKED), FOREIGN);
  assert.equal(portalOutsideLock('fetch', { id: `dataset:${LOCKED}:dddd-4444` }, LOCKED), null);
  assert.equal(portalOutsideLock('search', { query: FOREIGN }, LOCKED), null);
  assert.equal(portalOutsideLock('get_observations', { portal: FOREIGN }, LOCKED), null);
});

// --- Criterion 3: driven through the loop and into the record ------------------

interface Planned { id: string; name: string; args: Record<string, unknown>; dataset: string; refused: boolean }

const PLAN: Planned[] = [
  { id: 'c1', name: 'get_data', args: { type: 'query', dataset_id: 'aaaa-1111', select: 'count(*)' }, dataset: 'aaaa-1111', refused: false },
  { id: 'c2', name: 'get_data', args: { type: 'query', dataset_id: 'bbbb-2222', select: 'count(*)', portal: FOREIGN }, dataset: 'bbbb-2222', refused: true },
  { id: 'c3', name: 'get_data', args: { type: 'query', dataset_id: 'cccc-3333', select: 'count(*)', domain: FOREIGN }, dataset: 'cccc-3333', refused: true },
  { id: 'c4', name: 'fetch', args: { id: `dataset:${FOREIGN}:dddd-4444` }, dataset: 'dddd-4444', refused: true },
  { id: 'c5', name: 'fetch', args: { id: `https://${FOREIGN}/Public-Safety/x/eeee-5555` }, dataset: 'eeee-5555', refused: true },
  { id: 'c6', name: 'fetch', args: { id: 'ffff-6666' }, dataset: 'ffff-6666', refused: false },
  { id: 'c7', name: 'get_data', args: { type: 'query', dataset_id: 'gggg-7777', select: 'count(*)', portal: '  RECORDS.City-A.example ' }, dataset: 'gggg-7777', refused: false },
  { id: 'c8', name: 'fetch', args: { id: `${FOREIGN}:hhhh-8888` }, dataset: 'hhhh-8888', refused: true },
  { id: 'c9', name: 'fetch', args: { id: `record:${FOREIGN}:iiii-9999:7` }, dataset: 'iiii-9999', refused: true },
];

function script(): ScriptedReply[] {
  return [
    { toolCalls: PLAN.map(({ id, name, args }) => ({ id, name, args: { ...args } })) },
    { content: ANSWER },
  ];
}

/** Which dataset a call is about, whatever shape it took. */
function datasetOf(name: string, args: Record<string, unknown>): string {
  if (typeof args.dataset_id === 'string') return args.dataset_id;
  const id = String(args.id ?? '');
  return PLAN.find((p) => id.includes(p.dataset))?.dataset ?? `unknown:${name}`;
}

interface Run {
  completion: CompletionResult;
  trace: Record<string, unknown>;
  sent: string[];
  requests: Record<string, unknown>[];
}

/** The /api/compare-stream and /api/query-notebook path: `queryWithMcpStreaming`, 9th argument. */
async function driveStreaming(lockedPortal: string | undefined): Promise<Run> {
  const { server, url, requests } = await startScriptedModelServer(script());
  try {
    process.env.OPENROUTER_API_KEY = 'placeholder-model-key-p4-portal-lock';
    process.env.MODEL_API_BASE_URL = url;
    _resetDefaultModelClientForTests();
    const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
    builder.startRoot('analysis', { 'analysis.portal': LOCKED });
    const sent: string[] = [];
    let completion: CompletionResult | undefined;
    await queryWithMcpStreaming(
      QUESTION,
      carriedModelIdentity('fake/model'),
      mcpToolsFor(lockedPortal),
      async (name, args) => {
        sent.push(datasetOf(name, args));
        return name === 'fetch' ? JSON.stringify({ id: args.id, title: 'A dataset' }) : ONE_ROW;
      },
      'You are a fixture system prompt.',
      {
        onProgress: () => {},
        onToken: () => {},
        onComplete: (_panel, result) => { completion = result; },
        onError: (_panel, message) => assert.fail(`unexpected onError: ${message}`),
      },
      { builder, parentSpanId: builder.rootSpanId, resolveToolSource: sourceIdForToolName },
      { portal: LOCKED, toolTimeoutMs: 10_000 },
      lockedPortal,
    );
    builder.endRoot();
    assert.ok(completion, 'onComplete must fire');
    return { completion: completion!, trace: builder.finalize() as unknown as Record<string, unknown>, sent, requests };
  } finally {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.MODEL_API_BASE_URL;
    _resetDefaultModelClientForTests();
    await new Promise((resolve) => server.close(resolve));
  }
}

function recordOf(run: Run, dataset: string): ToolCallRecord {
  const record = (run.completion.tools_called ?? []).find((c) => datasetOf(c.name, c.args) === dataset);
  assert.ok(record, `no recorded call for ${dataset}`);
  return record!;
}

/** `encodeSSE` → bytes → `JSON.parse`, as the client reads the complete event. */
function throughTheWire(completion: CompletionResult): ToolCallInput[] {
  const frame = encodeSSE({ type: 'complete', panel: 'withMcp', data: completion });
  const event = JSON.parse(frame.slice('data: '.length).trimEnd()) as { data: CompletionResult };
  return (event.data.tools_called ?? []) as ToolCallInput[];
}

function packageOf(run: Run): EvidencePackage {
  const input: PackageInput = {
    trace: run.trace as unknown as PackageInput['trace'],
    prompt: QUESTION,
    output: ANSWER,
    toolCalls: throughTheWire(run.completion),
    model: 'fake/model',
    tokenUsage: { promptTokens: 10, completionTokens: 5 },
    promptVisibility: 'full_text',
    title: 'P4 portal lock',
    summary: 'P4 portal lock.',
    type: 'content/analysis/v1',
    captureMethod: 'chat-flow-stream',
  };
  return buildEvidencePackage(input).pkg;
}

function toolMessage(run: Run, callId: string): string {
  const messages = (run.requests.at(-1)?.messages ?? []) as Array<{ role?: string; tool_call_id?: string; content?: unknown }>;
  const m = messages.find((x) => x.role === 'tool' && x.tool_call_id === callId);
  assert.ok(m, `the model was never sent a tool message for ${callId}`);
  return typeof m!.content === 'string' ? m!.content : JSON.stringify(m!.content);
}

const LOCKED_RUN = await driveStreaming(LOCKED);
const OPEN_RUN = await driveStreaming(undefined);
const LOCKED_PKG = packageOf(LOCKED_RUN);
const OPEN_PKG = packageOf(OPEN_RUN);

test('#436 C3 control: with the lock off the same calls run as today — every one sent, none failed, the get_data datasets listed as accessed', () => {
  assert.deepEqual(OPEN_RUN.sent, PLAN.map((p) => p.dataset), 'the lock-off run sends every call');
  for (const p of PLAN) assert.equal(recordOf(OPEN_RUN, p.dataset).failed, undefined, `${p.id} failed with the lock off`);
  const accessed = JSON.stringify(OPEN_PKG.dataSources);
  for (const dataset of ['bbbb-2222', 'cccc-3333']) {
    assert.ok(accessed.includes(dataset), `the instrument cannot see ${dataset} in dataSources[] even when it was answered:\n${accessed}`);
  }
  assert.ok(accessed.includes(FOREIGN), 'the instrument cannot see the foreign portal in dataSources[] even when it was answered');
  // The unlocked run is handed `mcpTools` itself: nothing about the tool text moves.
  assert.equal(mcpToolsFor(undefined), mcpTools);
  assert.deepEqual(OPEN_RUN.requests[0].tools, JSON.parse(JSON.stringify(mcpTools)));
});

test('#436 C3: with the lock on, every call naming another portal is refused as a rejected call and never sent', () => {
  const refused = PLAN.filter((p) => p.refused);
  assert.deepEqual(OPEN_RUN.sent.filter((d) => refused.some((p) => p.dataset === d)).length, refused.length, 'premise: the control sent them');
  assert.deepEqual(LOCKED_RUN.sent, PLAN.filter((p) => !p.refused).map((p) => p.dataset), 'a refused call reached the transport');
  for (const p of PLAN) {
    const record = recordOf(LOCKED_RUN, p.dataset);
    if (p.refused) {
      assert.equal(record.failed, true, `${p.id} (${p.name} ${JSON.stringify(p.args)}) was recorded as answered`);
      assert.equal(record.failureKind, 'unknown');
    } else {
      assert.equal(record.failed, undefined, `${p.id} (${JSON.stringify(p.args)}) is outside the lock and must run`);
    }
  }
  // The record states what the model asked for: the arguments are not rewritten.
  assert.equal(recordOf(LOCKED_RUN, 'bbbb-2222').args.portal, FOREIGN);
  assert.equal(recordOf(LOCKED_RUN, 'cccc-3333').args.domain, FOREIGN);
});

test('#436 C3: the model is sent describeToolFailureForLlm\'s lock copy for each refused call, and nothing that invites a retry', () => {
  const expected = describeToolFailureForLlm('get_data', new PortalLockedCallError(LOCKED));
  assert.equal(expected, portalLockRefusalForLlm(LOCKED));
  assert.match(expected, /Do not estimate, guess, or fabricate/);
  assert.doesNotMatch(expected, /\btr(y|ying|ies|ied) again\b|\bretry/i);
  assert.ok(!expected.includes(FOREIGN));
  for (const p of PLAN) {
    const sent = toolMessage(LOCKED_RUN, p.id);
    if (p.refused) assert.equal(sent, expected, `${p.id} was told something else:\n${sent}`);
    else assert.notEqual(sent, expected);
  }
});

// WHAT THE PACKAGE CAN AND CANNOT SHOW HERE, measured on the control. With the
// lock off, the two refused `get_data` datasets and the foreign portal appear in
// `dataSources[]` and in the provenance graph, so their absence under the lock
// is a reading that could have failed. An answered `fetch` mints no access
// entry in either place even with the lock off (measured: the control's
// `dataSources[]` is aaaa, bbbb, cccc, gggg), so for the four `fetch` shapes
// the absence below cannot fail; what shows the lock acting on them is that
// they were never sent and are recorded, and stated in `queries[]`, as failed.
test('#436 C3: the package built from the locked run lists no refused dataset as accessed and the foreign portal as no source', () => {
  const accessed = JSON.stringify(LOCKED_PKG.dataSources);
  const graph = JSON.stringify(LOCKED_PKG.provenance);
  const openGraph = JSON.stringify(OPEN_PKG.provenance);
  for (const needle of ['bbbb-2222', 'cccc-3333', FOREIGN]) {
    assert.ok(openGraph.includes(needle), `premise: the control's provenance graph names ${needle}`);
  }
  for (const p of PLAN.filter((x) => x.refused)) {
    assert.ok(!accessed.includes(p.dataset), `dataSources[] asserts access to ${p.dataset}, which the lock refused:\n${accessed}`);
    assert.ok(!graph.includes(p.dataset), `the provenance graph names ${p.dataset}, which the lock refused`);
  }
  assert.ok(!accessed.includes(FOREIGN), `dataSources[] names the refused portal:\n${accessed}`);
  assert.ok(!graph.includes(FOREIGN), 'the provenance graph names the refused portal');
  assert.ok(accessed.includes('aaaa-1111'), 'premise: the answered call is listed');
  // queries[] keeps every attempt — the refused ones stated as failed, which is
  // how the record page reads them.
  const queries = LOCKED_PKG.queries as Array<EvidencePackage['queries'][number] & { failed?: boolean; arguments?: Record<string, unknown> }>;
  for (const p of PLAN.filter((x) => x.refused)) {
    const entry = queries.find((q) => JSON.stringify(q.arguments ?? {}).includes(p.dataset));
    assert.ok(entry, `queries[] carries no entry for ${p.dataset}`);
    assert.equal(entry!.failed, true, `queries[] states ${p.id} as answered`);
    assert.equal(describeQueryOutcome(entry!).kind, 'failed');
  }
});

test('#436 C3: the /api/compare path — the factory hands the core the lock and the locked tool text', async () => {
  const run = async (lockedPortal: string | undefined) => {
    const { server, url, requests } = await startScriptedModelServer(script());
    const sent: string[] = [];
    try {
      process.env.MODEL_API_BASE_URL = url;
      const result = await runToolLoop(compareLoopOptions({
        client: createModelClient({ apiKey: 'placeholder-model-key-p4-compare' }),
        endpointModel: 'fake/model',
        prompt: QUESTION,
        systemPrompt: 'fixture',
        portal: LOCKED,
        lockedPortal,
        callTool: async (name, args) => { sent.push(datasetOf(name, args)); return ONE_ROW; },
      }));
      return { result, sent, requests };
    } finally {
      delete process.env.MODEL_API_BASE_URL;
      await new Promise((resolve) => server.close(resolve));
    }
  };
  const locked = await run(LOCKED);
  const open = await run(undefined);
  assert.deepEqual(open.sent, PLAN.map((p) => p.dataset));
  assert.deepEqual(locked.sent, PLAN.filter((p) => !p.refused).map((p) => p.dataset));
  assert.deepEqual(locked.result.toolCalls.filter((c) => c.failed).length, PLAN.filter((p) => p.refused).length);
  const getData = (locked.requests[0].tools as Array<{ function: { name: string; parameters: { properties: { portal: { enum?: string[] } } } } }>)
    .find((t) => t.function.name === 'get_data');
  assert.deepEqual(getData?.function.parameters.properties.portal.enum, [LOCKED], 'the model was offered a portal argument that takes any portal');
});

// --- The tool and prompt text under the lock (D7) ----------------------------

test('#436 D7: the locked tool text names no other portal and does not send the model to one; the callable set is unchanged', () => {
  const locked = mcpToolsFor(LOCKED);
  const names = (tools: typeof mcpTools) => tools.map((t) => (t.type === 'function' ? t.function.name : t.type));
  assert.deepEqual(names(locked), names(mcpTools));
  const socrata = locked.filter((t) => t.type === 'function' && ['get_data', 'search', 'fetch'].includes(t.function.name));
  assert.equal(socrata.length, 3);
  const text = JSON.stringify(socrata);
  const unlockedText = JSON.stringify(mcpTools.filter((t) => t.type === 'function' && ['get_data', 'search', 'fetch'].includes(t.function.name)));
  // A portal-shaped hostname: the unlocked text's worked examples carry several.
  const HOST = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\.(?:gov|us|org|com|net|io)\b/gi;
  assert.ok((unlockedText.match(HOST) ?? []).length > 0, 'premise: the unlocked text names portals, so the check below can fail');
  assert.deepEqual(text.match(HOST) ?? [], [], 'the locked Socrata tool text still names a portal other than the locked one');
  assert.match(unlockedText, /any OTHER portal/, 'premise: the unlocked search text sends the model to other portals');
  assert.doesNotMatch(text, /any OTHER portal/);
  assert.ok(text.includes(LOCKED));
});

test('#436 D7: the prompt gains one section under the lock, naming only callable tools; unlocked it is unchanged', () => {
  assert.equal(withPortalLockGuidance('PROMPT', undefined), 'PROMPT');
  const locked = withPortalLockGuidance('PROMPT', LOCKED);
  assert.ok(locked.startsWith('PROMPT'));
  assert.ok(locked.endsWith(portalLockGuidance(LOCKED)));
  const section = portalLockGuidance(LOCKED);
  const routable = Object.keys(buildMcpRegistry({
    socrataUrl: 'https://socrata.invalid',
    dataCommonsUrl: 'https://data-commons.invalid',
    bostonOpencontextUrl: 'https://boston.invalid',
  }).toolIndex);
  const callable = new Set(mcpTools.map((t) => (t.type === 'function' ? t.function.name : '')));
  const mentioned = routable.filter((name) => new RegExp(`\\b${name}\\b`).test(section));
  assert.deepEqual(mentioned.sort(), ['fetch', 'get_data', 'search']);
  for (const name of mentioned) assert.ok(callable.has(name));
  for (const snake of section.match(/\b[a-z]+_[a-z_]+\b/g) ?? []) assert.ok(callable.has(snake), `the section names ${snake}`);
});

// --- Criterion 4: the form's examples ----------------------------------------

test('#436 C4: unlocked, the form offers its three examples unchanged; locked, none that compares portals', () => {
  // The list as `QueryForm.tsx` carried it at 109eecb, text and order.
  assert.deepEqual(EXAMPLE_QUERIES.map((e) => e.text), [
    'Noise trends in NYC',
    'Top 311 complaints: NYC vs SF',
    'Median household income: NYC vs SF',
  ]);
  assert.deepEqual(EXAMPLE_QUERIES.map((e) => Boolean(e.usesDefaultPortal)), [true, false, false]);
  assert.equal(offeredExampleQueries(false), EXAMPLE_QUERIES);
  const locked = offeredExampleQueries(true);
  assert.deepEqual(locked.map((e) => e.text), ['Noise trends in NYC']);
  for (const e of locked) assert.doesNotMatch(e.text, /\bvs\b/);
});

// --- Replay is outside the lock ----------------------------------------------

test('#436: replay is unaffected — with the switch on in the environment, its call to another portal is sent', async () => {
  process.env.SITE_PORTAL_LOCKED = '1';
  process.env.SITE_DEFAULT_PORTAL = LOCKED;
  const { server, url } = await startScriptedModelServer([
    { toolCalls: [{ id: 'r1', name: 'get_data', args: { type: 'query', dataset_id: 'rrrr-1111' } }] },
    { content: ANSWER },
  ]);
  const sent: Array<Record<string, unknown>> = [];
  try {
    process.env.MODEL_API_BASE_URL = url;
    const composed: Array<string | undefined> = [];
    const options = await replayLoopOptionsForPackage({
      pkg: { queries: [{ portal: FOREIGN }], dataSources: [] },
      client: createModelClient({ apiKey: 'placeholder-model-key-p4-replay' }),
      endpointModel: 'fake/model',
      prompt: QUESTION,
      composeSystemPrompt: async (portal) => { composed.push(portal); return 'fixture'; },
      callTool: async (_name, args) => { sent.push(args); return ONE_ROW; },
    });
    assert.deepEqual(composed, [FOREIGN], 'replay composes for the record\'s portal');
    assert.equal(options.lockedPortal, undefined);
    assert.equal(options.tools, mcpTools);
    assert.equal(replayLoopOptions({ client: options.client, endpointModel: 'fake/model', prompt: QUESTION, systemPrompt: 'x' }).lockedPortal, undefined);
    const result = await runToolLoop(options);
    assert.equal(sent.length, 1, 'the replayed call was not sent');
    assert.equal(sent[0].portal, FOREIGN);
    assert.equal(result.toolCalls[0].failed, undefined);
  } finally {
    delete process.env.MODEL_API_BASE_URL;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('teardown', () => restoreEnv());
