/**
 * `/api/compare`'s loop configuration, in one place (#345 P4).
 *
 * WHY THIS IS A MODULE AND NOT A LITERAL IN THE ROUTE — the same reason
 * `replay-loop.ts` gives, and it applies unchanged here. `compare/route.ts` is
 * a Next route handler: `node --test` cannot invoke one, and no test file in
 * this tree resolves the `@/` alias the route imports through. A test that
 * hand-rolled compare's options in its own body would be measuring a copy, and
 * configuration written twice diverges in exactly the direction that matters —
 * a cap the route raised, a portal the route stopped injecting. So the
 * configuration lives here, under relative imports only, and both the route and
 * its tests obtain it from the same call.
 *
 * WHAT THE ROUTE STILL OWNS. Everything about being a route: the request body,
 * the credential and MCP-routing refusals, the strict model resolution and its
 * 400/503 pair, this app's own per-day rate limit, both system prompts, the
 * no-tools A-side of the comparison, and the whole error-classification tail.
 * This module owns only what the LOOP is given.
 *
 * WHY THE CAPS ARE LOWER THAN THE CORE'S DEFAULTS. `/api/compare` is a
 * rate-limited public endpoint and the documented operator smoke test
 * (`docs/deploy.md`, `docs/instance-setup.md`): a new instance's first real
 * query is an anonymous POST to it. Ten rounds at `max_tokens` 2000 is what it
 * has always cost; adopting the core's 20 and 4000 would double the worst-case
 * cost of a call anyone can make. The caps are this caller's, not the core's,
 * which is precisely why they are parameters.
 *
 * PORTAL INJECTION AND THE TOOL BOUND ARE THE CORE'S NOW (#359, #352). This
 * factory used to inject `portal` inside its own `executeToolCall` closure —
 * which the core invokes after it has recorded the call, emitted `tool_start`
 * and stringified the arguments onto the `mcp_tool_call` span, so the span
 * disagreed with the record on every injected call. Both are options the core
 * reads before it builds any of that; this module supplies the two values and
 * nothing else. The args-identity constraint they rest on is unchanged and
 * still stated in `run-tool-loop.ts`'s header: the recorded object IS the
 * injected one, and `tools_called[].args` is what an API client reads.
 */

import type OpenAI from 'openai';
import { mcpTools } from '../mcp/tools.ts';
import { callMcpTool } from '../mcp/client.ts';
import type { ToolCallRecord, ToolLoopOptions, ToolLoopResult } from './run-tool-loop.ts';

/**
 * Tool-calling rounds before the loop stops and asks for an answer. Ten, as
 * this caller has always used — half the core's default, deliberately.
 */
export const COMPARE_MAX_ITERATIONS = 10;
/** `max_tokens` on every request this comparison makes. Half the core's default. */
export const COMPARE_MAX_TOKENS = 2000;
/**
 * Bound on one tool result fed back to the model as context.
 *
 * NEW FOR THIS CALLER. Its own loop had no bound at all (#344), so an oversized
 * result was handed to the next turn whole. The core's shared bound applies
 * here now, and an oversized paginated envelope reaches the model as parseable
 * JSON with a row marker rather than as a fragment cut mid-record (#331).
 */
export const COMPARE_MAX_TOOL_RESULT_CHARS = 50_000;
/**
 * Per-tool-call timeout. NEW FOR THIS CALLER (#352): `/api/compare` has never
 * had one, so a source that accepted the connection and then stopped
 * responding held the request open until the platform killed the invocation —
 * and the caller, who is waiting on one JSON body with nothing streamed, got a
 * platform error page naming no tool. With the bound, the hung call fails on
 * its own account, is recorded `failed`/`timeout` like any other tool failure,
 * and the comparison still answers from what did come back.
 *
 * 45 seconds, the same bound the three other callers use. The counterweight,
 * stated because it is real: this is the blocking caller, so the bound is a
 * hard ceiling with no partial output already delivered — a legitimately slow
 * query that today would eventually succeed now fails instead.
 */
export const COMPARE_MCP_TOOL_TIMEOUT_MS = 45_000;

/** The tool transport. Substitutable so a test can drive the real loop. */
export type CompareToolTransport = (
  name: string,
  args: Record<string, unknown>,
) => Promise<string>;

export interface CompareLoopInputs {
  /** Resolved by the route, inside the route's own error handling. */
  client: OpenAI;
  /** The wire string this instance reaches the requested model with. */
  endpointModel: string;
  /** The caller's question, verbatim. */
  prompt: string;
  /** Built by the route for the requested portal. */
  systemPrompt: string;
  /** The requested portal, injected into Socrata calls that omit one. */
  portal: string;
  /**
   * The tool transport, for tests. Defaults to the live MCP client — the ONLY
   * seam this factory exposes, and deliberately one level below the loop:
   * substituting it restates no loop configuration at all.
   */
  callTool?: CompareToolTransport;
}

/**
 * Everything `runToolLoop` needs to run the MCP half of one comparison. The
 * caps, the tool set, the portal and the tool bound are all fixed here; the
 * route supplies only what it read off the request.
 */
export function compareLoopOptions(inputs: CompareLoopInputs): ToolLoopOptions {
  const { client, endpointModel, prompt, systemPrompt, portal, callTool = callMcpTool } = inputs;

  return {
    client,
    endpointModel,
    prompt,
    systemPrompt,
    tools: mcpTools,
    maxIterations: COMPARE_MAX_ITERATIONS,
    maxTokens: COMPARE_MAX_TOKENS,
    // No cumulative token budget: this caller has never had one, and the cap
    // above already bounds a run. Omitted rather than set to some number
    // nothing measured — `undefined` is unbounded in the core.
    maxToolResultChars: COMPARE_MAX_TOOL_RESULT_CHARS,
    // The route answers with one JSON body; there is no reader attached to the
    // model call to stream an answer to.
    finalTurn: 'blocking',
    logContext: 'compare',
    // The core injects this into a Socrata `get_data` call that omits a
    // portal, above the record and the span; Data Commons tools are untouched.
    portal,
    toolTimeoutMs: COMPARE_MCP_TOOL_TIMEOUT_MS,
    executeToolCall: callTool,
  };
}

/**
 * The `withMcp` half of the `POST /api/compare` response body.
 *
 * Same four fields, same names, same order as before the migration. What
 * changed is inside `tools_called[]`, which now carries the shared record
 * (`operationType`, `reason`, `resultSummary`, `duration_ms` and, for a call
 * that failed, `failed`/`failureKind`) instead of `{name, args}` alone — the
 * shape #321 gave every other caller, because a failed call is otherwise
 * indistinguishable from a zero-row one. `docs/project-plan.md` documents the
 * body and was updated with this change.
 */
export interface CompareCompletionResult {
  content: string;
  duration_ms: number;
  // #374: optional so this declaration agrees with its siblings
  // (openrouter-streaming.ts's CompletionResult, streaming.ts's CompleteEvent).
  // The value below is unaffected: `result.usage.totalTokens` is a SUM over
  // the loop's turns and stays a definite `number` (absence contributes
  // nothing to a sum) per Wave N8 P4b's ruling in absent-usage.test.ts — this
  // caller never actually produces `undefined` here, this is a type-shape
  // consistency change only.
  tokens_used?: number;
  tools_called?: ToolCallRecord[];
}

/**
 * Adapt one `ToolLoopResult` into that body.
 *
 * `tokens_used` is the run's CUMULATIVE total. The deleted loop reported the
 * last call's `usage.total_tokens` only, which under-reported a multi-round
 * query by every round but the last — the same field on `/api/compare-stream`
 * and on a replay has always been cumulative.
 *
 * `tools_called` is omitted rather than empty when no tool ran, exactly as
 * before: an API client distinguishing "no tools" from "an empty list" sees
 * what it saw.
 */
export function compareCompletionResult(result: ToolLoopResult): CompareCompletionResult {
  return {
    content: result.content,
    duration_ms: result.durationMs,
    tokens_used: result.usage.totalTokens,
    tools_called: result.toolCalls.length > 0 ? result.toolCalls : undefined,
  };
}
