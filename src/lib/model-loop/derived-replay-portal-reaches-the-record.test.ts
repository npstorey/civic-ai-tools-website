/**
 * The portal a replay DERIVES is the portal its recorded calls carry — driven
 * end to end, package to identity key (Wave N10 P8, #409, cold-read F1).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE UNIT CASES. F1's harm was never
 * "`replayPortalForPackage` returns the wrong string"; a string is not a
 * defect. The harm is where that string goes: the replay route hands it to
 * `buildSystemPrompt`, which writes "Default portal: …" into the model's
 * instructions, and to `replayLoopOptions` as `portal`, which the core injects
 * into any `get_data` the replay makes without one — so it reaches the
 * recorded arguments, the `mcp_tool_call` span's `tool.portal_domain`, and
 * through `canonicalizeToolCall` the identity keys a SIGNED consistency
 * attestation is computed over. `replay-portal-is-addressable.test.ts` asserts
 * the derivation; this file asserts the journey, because a fix to the
 * derivation that stopped composing with the loop would leave that file green.
 *
 * WHAT THE COLD READ HAD, AND WHAT IT DID NOT. It measured the PROMPT half by
 * driving `buildSystemPrompt` with the endpoint an aggregate-only record
 * resolved to and reading the line back. The INJECTION half — that a replayed
 * `get_data` omitting a portal actually receives the derived value — was
 * REASONED from `run-tool-loop.ts:809` rather than driven. That is the half
 * driven here, and it is driven through the same three surfaces the injection
 * family (`injection-and-bound.test.ts`) reads, so a regression in either the
 * derivation or the injection lands in one of them.
 *
 * THE TWO PACKAGES ARE THE LIVE SHAPES, NOT INVENTED ONES. Both are the
 * `queries[]`/`dataSources[]` skeleton of records published at the reference
 * deployment, read on 2026-09-06:
 *   - the aggregate one is `median-household-income-for-manhattan-255b8e`:
 *     two queries naming no portal, one `data-commons` data source whose
 *     `portalUrl` is the Data Commons MCP endpoint. Four of the 34 published
 *     records have this shape and a fifth is its CKAN twin.
 *   - the Socrata one is the ordinary case, and it is the CONTROL: the fix
 *     must not be "derive `undefined` more often". A record whose source a
 *     `get_data` call can address must still replay on that portal, and that
 *     portal must still reach all three surfaces.
 *
 * RED AT THE BASE COMMIT (`255b58d`): the aggregate case recorded
 * `args.portal = 'api.datacommons.org/mcp'`, the span reported it as
 * `tool.portal_domain`, and `canonicalizeToolCall` folded it into the key.
 *
 * No live endpoint, no credential, no MCP server, no network. The model is an
 * in-process function and the tool transport returns a fixture string.
 *
 * Run with: npm test
 *   (or: node --test --experimental-strip-types
 *        src/lib/model-loop/derived-replay-portal-reaches-the-record.test.ts)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type OpenAI from 'openai';

import { runToolLoop, type ToolCallRecord } from './run-tool-loop.ts';
import { replayLoopOptions, replayPortalForPackage } from './replay-loop.ts';
import { TraceBuilder, CIVICAITOOLS_TRACE_CONFIG } from '../evidence/trace.ts';
import { canonicalizeToolCall } from '../evidence/tool-call-identity.ts';

type Pkg = Parameters<typeof replayPortalForPackage>[0];

const AGGREGATE_ENDPOINT = 'api.datacommons.org/mcp';
const SOCRATA_PORTAL = 'data.cityofnewyork.us';
const ANSWER = 'Median household income in Manhattan was about $99,900 in 2023.';
const ONE_ROW = JSON.stringify({ data: [{ value: 99880 }], total_rows: 1 });

/** `median-household-income-for-manhattan-255b8e`, in the two fields the
 *  derivation reads. Its calls named no portal, because the tool that made
 *  them (`get_observations`) takes none. */
const AGGREGATE_PACKAGE = {
  queries: [{}, {}],
  dataSources: [
    {
      sourceId: 'data-commons',
      catalogType: 'data-commons',
      portalUrl: `https://${AGGREGATE_ENDPOINT}`,
    },
  ],
} as unknown as Pkg;

/** The ordinary Socrata record — the control the fix must not break. */
const SOCRATA_PACKAGE = {
  queries: [{}],
  dataSources: [
    {
      sourceId: 'socrata',
      catalogType: 'socrata',
      portalUrl: `https://${SOCRATA_PORTAL}`,
      datasetId: 'erm2-nwe9',
    },
  ],
} as unknown as Pkg;

/** An in-process model that emits one `get_data` carrying NO portal of its
 *  own — the only call shape the core injects into — and then answers. */
function scriptedClient(): OpenAI {
  const replies = [
    {
      toolCalls: [
        {
          id: 'call_1',
          name: 'get_data',
          args: { type: 'query', dataset_id: 'abcd-1234', select: 'count(*)' },
        },
      ],
    },
    { content: ANSWER },
  ];
  let served = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const reply = replies[Math.min(served++, replies.length - 1)] as {
            content?: string;
            toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
          };
          return {
            id: 'chatcmpl-p8-stub',
            object: 'chat.completion',
            created: 1,
            model: 'fake/model',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: reply.content ?? null,
                  ...(reply.toolCalls
                    ? {
                        tool_calls: reply.toolCalls.map((tc) => ({
                          id: tc.id,
                          type: 'function',
                          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                        })),
                      }
                    : {}),
                },
                finish_reason: reply.toolCalls ? 'tool_calls' : 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          };
        },
      },
    },
  } as unknown as OpenAI;
}

interface Span {
  name: string;
  attributes: { key: string; value: { stringValue?: string; intValue?: string } }[];
}

function attr(span: Span, key: string): string | undefined {
  const found = span.attributes.find((a) => a.key === key);
  return found?.value?.stringValue ?? found?.value?.intValue;
}

interface Driven {
  /** What the derivation handed the route. */
  derived: string | undefined;
  record: ToolCallRecord;
  span: Span;
  /** The consistency attestation's key for that call. */
  identityKey: string;
}

/**
 * The whole path in one call: derive the portal off the package exactly as
 * `replay/route.ts:113` does, hand it to `replayLoopOptions` exactly as
 * `:127-133` does, run the real core, and read back the three surfaces the
 * injected value reaches.
 */
async function driveReplay(pkg: Pkg): Promise<Driven> {
  const derived = replayPortalForPackage(pkg);

  const builder = new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG);
  builder.startRoot('analysis', {});
  const result = await runToolLoop({
    ...replayLoopOptions({
      client: scriptedClient(),
      endpointModel: 'fake/model',
      prompt: 'What was median household income in Manhattan?',
      systemPrompt: 'You are a fixture system prompt.',
      portal: derived,
      callTool: async () => ONE_ROW,
    }),
    trace: { builder, parentSpanId: builder.rootSpanId },
  });
  builder.endRoot();

  const trace = builder.finalize() as unknown as Record<string, unknown>;
  const resourceSpans = trace.resourceSpans as { scopeSpans: { spans: Span[] }[] }[];
  const toolSpans = resourceSpans
    .flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans))
    .filter((s) => s.name === 'mcp_tool_call');
  assert.equal(toolSpans.length, 1, 'the drive must produce exactly one tool-call span');
  assert.equal(result.toolCalls.length, 1, 'the drive must produce exactly one recorded call');

  return {
    derived,
    record: result.toolCalls[0],
    span: toolSpans[0],
    identityKey: canonicalizeToolCall(result.toolCalls[0]),
  };
}

// --- RED at 255b58d: the aggregate endpoint reached all three surfaces ------

test('an aggregate-only record: the Data Commons endpoint reaches no recorded argument, no span and no identity key', async () => {
  const { derived, record, span, identityKey } = await driveReplay(AGGREGATE_PACKAGE);

  assert.equal(
    derived,
    undefined,
    `the replay derived ${String(derived)} as a Socrata portal from a data-commons data source`,
  );
  assert.equal(
    record.args.portal,
    undefined,
    `the replayed get_data recorded portal=${String(record.args.portal)} — a host reached by ` +
      'get_observations, not by get_data, written into the arguments a consistency attestation ' +
      'is computed over',
  );
  assert.equal(
    attr(span, 'tool.portal_domain'),
    undefined,
    'the mcp_tool_call span reports a portal domain the call was not made against',
  );
  assert.ok(
    !identityKey.includes(AGGREGATE_ENDPOINT),
    `canonicalizeToolCall folded ${AGGREGATE_ENDPOINT} into the replay identity key: ${identityKey}`,
  );
  // The span and the record must still agree with each other — the #359
  // property, which a fix that only edited one of them would break.
  assert.deepEqual(
    JSON.parse(attr(span, 'tool.arguments')!) as Record<string, unknown>,
    record.args,
    'the span serialized different arguments than the record holds (#359)',
  );
});

// --- CONTROL: the fix is not "derive undefined more often" ------------------

test('a Socrata record: the portal it named still reaches the recorded arguments, the span and the identity key', async () => {
  const { derived, record, span, identityKey } = await driveReplay(SOCRATA_PACKAGE);

  assert.equal(derived, SOCRATA_PORTAL, 'a socrata data source still supplies the replay portal');
  assert.equal(
    record.args.portal,
    SOCRATA_PORTAL,
    'the replayed get_data lost the portal the record was made against — a replay that runs on a ' +
      'different portal than the original is not a consistency test of the same thing',
  );
  assert.equal(attr(span, 'tool.portal_domain'), SOCRATA_PORTAL);
  assert.ok(
    identityKey.includes(SOCRATA_PORTAL),
    `the identity key lost the portal: ${identityKey}`,
  );
  assert.deepEqual(
    JSON.parse(attr(span, 'tool.arguments')!) as Record<string, unknown>,
    record.args,
    'the span serialized different arguments than the record holds (#359)',
  );
});
