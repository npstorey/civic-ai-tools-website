// S4 W2b (npstorey/civic-ai-tools#335): a class answer in the run (criterion B3's "a later load of another member in
// that run does not pause"; C3 = A), what the run's trace and "Where this question went" then say (B7), and the pause's
// hosts read through the statement's test hook (W1's cost).
//
//   - `allow-class` ("Enable all {n} {group phrase}") at a member's pause loads that source, and a later load of another
//     member in the same run loads with no pause and writes no entry. The member is recorded loaded, and no question was
//     put about it (`tool.load_asked: false`).
//   - `off-class` ("Don't enable any of the {n}") declines that source, and a later load of another member in the run
//     is declined with no pause, whether the member was Ask first or On at the run's start (the class answer turns it
//     Off, and S18 says nothing is sent to them); a member set on its own keeps its setting in the run, as in the store.
//
// WHAT IS DRIVEN. `runToolLoop` with the options an in-loop run is given (`createInLoopRouting`) and the pause a
// streaming route hands it (`createConsentPause`), against the scripted model endpoint and the fake store, on a fake
// clock, as `consent-pause-off-allow-all.test.ts` drives them (its harness is copied here). Socrata and NYC City Record
// are one class (City Record is a pack over Socrata).
//
// THE SHAPE THAT CAN FAIL. Two members of one class, loaded in turn, the class answer given at the first pause only.
// THE DECOY: the same run with `allow`, not `allow-class`, pauses on the second load, so the instrument reads a second
// pause when one happens. For B7, a run whose loads end three different ways, so the reasons cannot coincide.
//
// RED AT W2a's HEAD (e783f69): the run reads a class answer as Allow or Don't allow (`runDecisionOf`), so the second
// member pauses; and the pause's hosts are read from `CIVIC_MANIFEST`, so a source only the hook's manifest lists has
// none.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { FakeDecisionKv } from '../sources/decision-store-for-tests.ts';

type Mod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;

// --- The loopback MCP sources ----------------------------------------------------------------

const ONE_ROW = JSON.stringify({ data: [{ count: '512' }], total_rows: 1 });
const mcp = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = body ? (JSON.parse(body) as { id?: unknown; method?: string }) : {};
  if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
  const reply = (payload: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...payload });
  if (msg.method === 'initialize') {
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'civic-s4-w2b' });
    res.end(reply({ result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'civic-s4-w2b-fixture', version: '0' } } }));
    return;
  }
  if (msg.method === 'prompts/get') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply({ error: { code: -32603, message: 'fixture: no skill guidance here' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(`event: message\ndata: ${reply({ result: { content: [{ type: 'text', text: ONE_ROW }] } })}\n\n`);
});
await new Promise<void>((resolve) => mcp.listen(0, '127.0.0.1', () => resolve()));
mcp.unref();
const MCP_ORIGIN = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}`;

// --- Environment, before any app module loads ----------------------------------------

for (const name of ['DATA_COMMONS_API_KEY', 'NYC_CHARTER_HOSTING', 'MODEL_API_KIND', 'MODEL_API_AUTH', 'MODEL_API_VERSION', 'SOURCE_ROUTING', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'SITE_DEPLOYMENT_GUIDE_URL']) {
  delete process.env[name];
}
process.env.SOCRATA_MCP_URL = `${MCP_ORIGIN}/socrata/mcp`;
process.env.DATA_COMMONS_MCP_URL = `${MCP_ORIGIN}/dc/mcp`;
process.env.BOSTON_OPENCONTEXT_MCP_URL = `${MCP_ORIGIN}/boston/mcp`;
process.env.RATE_LIMIT_SECRET = 'fixture';

const { readMcpEnvFromProcess } = await import('../mcp/registry.ts');
const flows = (await import('../flows/statement.ts')) as Mod;
const { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG, hash } = await import('../evidence/trace.ts');
const routingMode = (await import('../mcp/routing-mode.ts')) as Mod;
const decision = (await import('../sources/decision.ts')) as Mod;
const { recordSourcesOffered } = await import('../sources/consent.ts');
const { whereItWentFromSpans } = await import('../flows/where-it-went.ts');
const { runToolLoop } = await import('./run-tool-loop.ts');
const { startScriptedModelServer } = await import('./test-harness.ts');
const { createModelClient } = await import('../model-client.ts');
const { CIVIC_MANIFEST } = await import('@typedstandards/civic-typed-router');

const configured = readMcpEnvFromProcess();
const statement = flows.buildFlowsStatementFor(null);
const PROMPT = 'How many potholes were reported in 2025?';

// --- The fake clock and the drive ------------------------------------------------------------

interface Clock { now: () => number; sleep: (ms: number) => Promise<void>; at: Array<{ t: number; act: () => Promise<void> | void }>; t: number }

function clock(): Clock {
  const c: Clock = {
    t: 1_800_000_000_000,
    at: [],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += ms;
      for (const due of c.at.filter((a) => a.t <= c.t)) {
        c.at.splice(c.at.indexOf(due), 1);
        await due.act();
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    },
  };
  return c;
}

type Decision = 'allow' | 'off' | 'allow-all' | 'allow-class' | 'off-class';

interface Drive {
  result: Awaited<ReturnType<typeof runToolLoop>>;
  trace: { spans: unknown[] };
  pauses: Json[];
  kv: FakeDecisionKv;
  sourcesOffered: Array<{ sourceId: string; alias: string; reason: string }>;
}

async function drive(options: {
  states: Record<string, string>;
  own?: string[];
  script: Parameters<typeof startScriptedModelServer>[0];
  decide?: Array<{ afterMs: number; decision: Decision } | null>;
}): Promise<Drive> {
  const c = clock();
  const kv = new FakeDecisionKv(c.now);
  const directory = routingMode.directorySet(configured, { enforced: true, states: options.states, ...(options.own ? { own: options.own } : {}) });
  const selection = Object.entries(options.states).filter(([, s]) => s === 'on').map(([id]) => id);
  const pauses: Json[] = [];
  const pause = decision.createConsentPause({ store: kv, statement, configured, secret: process.env.RATE_LIMIT_SECRET, now: c.now, sleep: c.sleep });
  const session = await routingMode.createInLoopRouting({ configured, directory, searchable: directory, rule: routingMode.DIRECTORY_SET_RULE, selection, pause } as Parameters<typeof routingMode.createInLoopRouting>[0]);
  const scripted = await startScriptedModelServer(options.script);
  process.env.MODEL_API_BASE_URL = scripted.url;
  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  try {
    const result = await runToolLoop({
      client: createModelClient({ apiKey: 'placeholder-model-key-s4-w2b' }),
      endpointModel: 'fake/model',
      requestSettings: undefined,
      prompt: PROMPT,
      systemPrompt: session.firstSystemPrompt,
      tools: session.firstTools,
      executeToolCall: session.executeToolCall,
      loadStep: session.loadStep,
      trace: { builder, parentSpanId: builder.rootSpanId, systemPromptHash: hash(session.firstSystemPrompt), resolveToolSource: session.resolveToolSource },
      onEvent: (event) => {
        const e = event as unknown as Json;
        if (e.type !== 'consent_pause') return;
        const payload = e.pause as Json;
        pauses.push(payload);
        const plan = options.decide?.[pauses.length - 1];
        if (plan && typeof payload.key === 'string') {
          const name = `${decision.DECISION_KEY_PREFIX}${payload.key}`;
          c.at.push({
            t: c.t + plan.afterMs,
            act: async () => {
              const entry = JSON.parse(kv.entries.get(name)!.value) as Json;
              await kv.set(name, { ...entry, decision: plan.decision }, { xx: true, keepTtl: true });
            },
          });
        }
      },
    });
    builder.endRoot();
    const sourcesOffered = recordSourcesOffered(session.sourcesOffered as Array<{ sourceId: string; alias: string; reason: string }>, options.states);
    // The OTLP document the builder ends with: one resource, one scope, every span.
    const otlp = builder.finalize() as unknown as { resourceSpans: Array<{ scopeSpans: Array<{ spans: unknown[] }> }> };
    const spans = otlp.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));
    assert.ok(spans.length > 0, 'premise: the trace holds spans');
    return { result, trace: { spans }, pauses, kv, sourcesOffered };
  } finally {
    delete process.env.MODEL_API_BASE_URL;
    await new Promise<void>((resolve) => scripted.server.close(() => resolve()));
  }
}

const outcomes = (d: Drive) => d.result.toolCalls.filter((c) => c.operationType === 'load_source').map((c) => c.loadOutcome);
/** Each load span's alias, outcome and `tool.load_asked`, in the order the run made them. */
function loadSpans(d: Drive): Array<{ alias: string; outcome: unknown; asked: unknown }> {
  return (d.trace.spans as Json[]).flatMap((span) => {
    const attrs = new Map(((span.attributes ?? []) as Array<{ key: string; value: Json }>).map((a) => [a.key, Object.values(a.value)[0]]));
    if (attrs.get('tool.operation_type') !== 'load_source') return [];
    const args = JSON.parse(String(attrs.get('tool.arguments') ?? '{}')) as Json;
    return [{ alias: String(args.alias), outcome: attrs.get('tool.load_outcome'), asked: attrs.get('tool.load_asked') }];
  });
}

const load = (id: string, alias: string) => ({ toolCalls: [{ id, name: 'load_source', args: { alias } }] });
const ANSWER = { content: 'The answer, with what could not be checked.' };
const BOTH_ASK_FIRST = { socrata: 'ask-first', 'nyc-record': 'ask-first', 'data-commons': 'on', 'boston-opencontext': 'off' };
const TWO_MEMBERS = [load('load-socrata', 'socrata'), load('load-record', 'nyc_record'), ANSWER];

test('premise: Socrata and NYC City Record are one class, both in the directory', () => {
  const directory = routingMode.directorySet(configured, { enforced: true, states: BOTH_ASK_FIRST }) as Array<{ sourceId: string }>;
  const ids = directory.map((e) => e.sourceId);
  assert.ok(ids.includes('socrata') && ids.includes('nyc-record'), `the directory: ${ids.join(', ')}`);
  assert.equal(CIVIC_MANIFEST.find((e) => e.sourceId === 'nyc-record')?.base, 'socrata');
});

// --- allow-class --------------------------------------------------------------------------------

test('B3 (red): allow-class at the first member\'s pause loads it, and the second member loads with no pause and no entry', async () => {
  const d = await drive({ states: BOTH_ASK_FIRST, script: TWO_MEMBERS, decide: [{ afterMs: 2_000, decision: 'allow-class' }] });
  assert.equal(d.pauses.length, 1, `the run paused ${d.pauses.length} times after a class answer`);
  assert.equal(d.kv.decisionKeys().length, 1, 'the second load wrote an entry after a class answer');
  assert.deepEqual(outcomes(d), ['loaded', 'loaded']);
  // The trace (B7): the second member loaded on the class answer, and no question was put about it.
  assert.deepEqual(loadSpans(d), [{ alias: 'socrata', outcome: 'loaded', asked: true }, { alias: 'nyc_record', outcome: 'loaded', asked: false }]);
});

test('B3 (decoy): the same run with allow, not allow-class, pauses on the second load', async () => {
  const d = await drive({ states: BOTH_ASK_FIRST, script: TWO_MEMBERS, decide: [{ afterMs: 2_000, decision: 'allow' }] });
  assert.equal(d.pauses.length, 2, 'the decoy did not pause on the second load: the instrument cannot see a second pause');
  assert.deepEqual(outcomes(d), ['loaded', 'no-answer']);
});

test('B3 (pin): a class answer does not reach another class: Data Commons, Ask first, still pauses after allow-class on Socrata', async () => {
  const d = await drive({
    states: { ...BOTH_ASK_FIRST, 'data-commons': 'ask-first' },
    script: [load('load-socrata', 'socrata'), load('load-dc', 'data_commons'), ANSWER],
    decide: [{ afterMs: 2_000, decision: 'allow-class' }],
  });
  assert.equal(d.pauses.length, 2, 'a class answer reached a source outside the class');
});

// --- off-class ----------------------------------------------------------------------------------

test('B3 (red; C3 = A): off-class at the first member\'s pause declines it, and the second member, Ask first, is declined with no pause', async () => {
  const d = await drive({ states: BOTH_ASK_FIRST, script: TWO_MEMBERS, decide: [{ afterMs: 2_000, decision: 'off-class' }] });
  assert.equal(d.pauses.length, 1, `the run paused ${d.pauses.length} times after a class refusal`);
  assert.deepEqual(outcomes(d), ['declined', 'declined']);
  assert.deepEqual(loadSpans(d), [{ alias: 'socrata', outcome: 'declined', asked: true }, { alias: 'nyc_record', outcome: 'declined', asked: false }]);
});

test('B3 (red; S18): off-class declines a later load of a member that was On at the run\'s start and not set on its own', async () => {
  const d = await drive({
    states: { ...BOTH_ASK_FIRST, 'nyc-record': 'on' },
    script: TWO_MEMBERS,
    decide: [{ afterMs: 2_000, decision: 'off-class' }],
  });
  assert.deepEqual(outcomes(d), ['declined', 'declined'], 'a member On at the start was loaded after "Don\'t enable any"');
});

test('B3 (pin; premise 7, "Honoured"): off-class leaves a member set on its own to On as it is: it loads', async () => {
  const d = await drive({
    states: { ...BOTH_ASK_FIRST, 'nyc-record': 'on' },
    own: ['nyc-record'],
    script: TWO_MEMBERS,
    decide: [{ afterMs: 2_000, decision: 'off-class' }],
  });
  assert.deepEqual(outcomes(d), ['declined', 'loaded']);
});

// --- B7: "Where this question went" for one fixed run --------------------------------------------

test('B7 (red at the words; pin at the sources and outcomes): one fixed run lists the same sources with the same outcomes, in S125\'s words', async () => {
  const d = await drive({
    states: { socrata: 'ask-first', 'nyc-record': 'ask-first', 'data-commons': 'on', 'boston-opencontext': 'off' },
    script: [load('load-socrata', 'socrata'), load('load-record', 'nyc_record'), ANSWER],
    decide: [{ afterMs: 2_000, decision: 'allow' }, { afterMs: 2_000, decision: 'off' }],
  });
  assert.deepEqual(outcomes(d), ['loaded', 'declined'], 'premise: the run\'s two loads');
  const model = whereItWentFromSpans({ spans: d.trace.spans, sourcesOffered: d.sourcesOffered, statement });
  const why = Object.fromEntries(model.notReached.map((row) => [row.sourceId, row.whyNotSent]));
  // The sources and their outcomes: the same at the base (the pin).
  assert.deepEqual(model.reached.map((row) => row.kind), ['model'], 'the sources reached moved');
  assert.deepEqual(Object.keys(why).sort(), d.sourcesOffered.map((o) => o.sourceId).sort(), 'the sources listed moved');
  // The words (C3-O = B: S125[4], S125[5], S125[7], S125[8]).
  assert.equal(why.socrata, 'Accepted when asked, but not used for this question.', 'socrata, allowed when asked (S125[7])');
  assert.equal(why['nyc-record'], 'Declined when asked, so not used for this question.', 'nyc-record, declined when asked (S125[8])');
  assert.equal(why['data-commons'], 'Enabled, not used for this question.', 'data-commons, On and not used (S125[4])');
  assert.equal(why['boston-opencontext'], 'Disabled.', 'boston-opencontext, Off (S125[5])');
});

// --- The pause's hosts at 200, through the hook (W1's cost) -------------------------------------

test('W1\'s cost (red): the pause\'s hosts are read through the statement\'s test hook, so a source only the hook\'s manifest lists shows its hosts', async () => {
  const npm = CIVIC_MANIFEST.find((e) => e.hostings.some((v) => v.kind === 'npm-package' && v.outbound.length > 0));
  assert.ok(npm, 'premise: the manifest has a hosted source with hosts beyond its address');
  const variant = npm!.hostings.find((v) => v.kind === 'npm-package' && v.outbound.length > 0)! as { outbound: readonly string[] };
  const entry = { ...npm!, sourceId: 'example-hosted-source', alias: 'example_hosted_source', displayName: 'Example hosted source', base: undefined, hostings: [variant] };
  const manifest = [...CIVIC_MANIFEST.filter((e) => e.sourceId !== npm!.sourceId), entry];
  flows.setFlowsSourceInputsForTests({ manifest, variantInForce: (e: Mod) => e.hostings[0], addressFor: () => undefined });
  try {
    const hooked = await flows.buildFlowsStatement();
    assert.ok(hooked.sources.some((s: Json) => s.sourceId === 'example-hosted-source'), 'premise: the hook\'s statement lists the source');
    const facts = decision.pauseFacts(hooked, configured, 'example-hosted-source');
    assert.ok(facts, 'premise: the pause has facts for it');
    assert.deepEqual(facts.outbound, [...variant.outbound], 'the pause\'s hosts ignore the hook');
  } finally {
    flows.setFlowsSourceInputsForTests(null);
  }
});
