/**
 * Replay's loop configuration, in one place (#345 P3).
 *
 * WHY THIS IS A MODULE AND NOT A LITERAL IN THE ROUTE. `replay/route.ts` is a
 * Next route handler: `node --test` cannot invoke one, and 0 of the 74 test
 * files in this tree resolve the `@/` alias the route imports through. A test
 * that hand-rolled replay's options in its own body would therefore be
 * measuring a copy — configuration written twice diverges, and the divergence
 * would be invisible in exactly the direction that matters (a cap the route
 * raised, a portal the route stopped injecting). So the configuration lives
 * here, under relative imports only, and both the route and its tests obtain
 * it from the same call.
 *
 * WHAT THE ROUTE STILL OWNS. Everything about being a route: the session
 * check, the caller-supplied key, the MCP routing refusal, the record and
 * package reads, the hash-only-visibility refusal, the declared→endpoint model
 * mapping, the portal derivation, the system prompt, and the whole
 * error-classification tail. This module owns only what the LOOP is given.
 *
 * THE ARGS-IDENTITY CONSTRAINT, restated because this is the caller it bites.
 * The core injects `portal` into the very `args` object it records — the same
 * object, by reference (see the header of `run-tool-loop.ts`).
 * `AttestationDialog.canonicalizeToolCall` keys a replay run on
 * `name:args.type:args.dataset_id:args.portal`, and those keys are an input to
 * a signed consistency attestation. Clone or freeze that object anywhere on
 * this path and the injected portal stops reaching the record, every key
 * changes, and nothing in the diff points at the cause.
 */

import type OpenAI from 'openai';
import { mcpTools } from '../mcp/tools.ts';
import { callMcpTool } from '../mcp/client.ts';
import type { ToolLoopOptions } from './run-tool-loop.ts';

/** Tool-calling rounds before the loop stops and asks for an answer. */
export const REPLAY_MAX_ITERATIONS = 20;
/** `max_tokens` on every request a replay makes. */
export const REPLAY_MAX_TOKENS = 4000;
/** Cumulative token budget for one replay run. */
export const REPLAY_MAX_CUMULATIVE_TOKENS = 200_000;
/** Bound on one tool result fed back to the model as context. */
export const REPLAY_MAX_TOOL_RESULT_CHARS = 50_000;
/**
 * Per-tool-call timeout. A replay is one leg of an N-run consistency test, so
 * one unresponsive source must fail its own call rather than hold the whole
 * run — and the caller of the route is a browser waiting on a response.
 */
export const REPLAY_MCP_TOOL_TIMEOUT_MS = 45_000;

/** The tool transport. Substitutable so a test can drive the real loop. */
export type ReplayToolTransport = (
  name: string,
  args: Record<string, unknown>,
) => Promise<string>;

export interface ReplayLoopInputs {
  /** Built by the route from the caller-supplied key, in the route's own error handling. */
  client: OpenAI;
  /** The wire string this instance reaches the record's model with. */
  endpointModel: string;
  /** The record's prompt text, verbatim. */
  prompt: string;
  /** Regenerated fresh for the record's portal by the route. */
  systemPrompt: string;
  /** The record's portal, injected into Socrata calls that omit one. */
  portal: string;
  /**
   * The tool transport, for tests. Defaults to the live MCP client —
   * deliberately one level below the loop: substituting it restates no loop
   * configuration at all.
   */
  callTool?: ReplayToolTransport;
  /**
   * The per-tool-call timeout, in milliseconds. Overridable for ONE reason
   * (#357): a case that drives a transport which genuinely never settles
   * cannot wait 45 real seconds, and a case that fakes the timeout by throwing
   * its wording measures `classifyStreamError`'s text mapping instead of the
   * race — which is why the test named for this behaviour stayed green with
   * the whole race deleted.
   *
   * Production passes nothing and gets `REPLAY_MCP_TOOL_TIMEOUT_MS`. The
   * source-drift guard in this file's tests asserts the route supplies neither
   * this nor `callTool`: both seams exist for tests, not for production.
   */
  toolTimeoutMs?: number;
}

/**
 * Everything `runToolLoop` needs to run one replay. The caps, the tool set,
 * the portal and the per-call timeout are all fixed here; the route supplies
 * only what it read off the record.
 *
 * The portal and the timeout are now VALUES this factory hands the core
 * rather than behaviour it performs (#359, #352). This module held the
 * reference implementation of both — the `get_data` guard three other callers
 * copied, and the only timer of the four that was cleared — and what it kept
 * is the two numbers and the one portal that are genuinely replay's. The
 * injection had to move because it ran inside `executeToolCall`, which the
 * core invokes after it has already recorded the call and stringified the
 * arguments onto the `mcp_tool_call` span: the span disagreed with the record,
 * and on a replay the record is what a signed consistency attestation is
 * computed over.
 */
export function replayLoopOptions(inputs: ReplayLoopInputs): ToolLoopOptions {
  const {
    client,
    endpointModel,
    prompt,
    systemPrompt,
    portal,
    callTool = callMcpTool,
    toolTimeoutMs = REPLAY_MCP_TOOL_TIMEOUT_MS,
  } = inputs;

  return {
    client,
    endpointModel,
    prompt,
    systemPrompt,
    tools: mcpTools,
    maxIterations: REPLAY_MAX_ITERATIONS,
    maxTokens: REPLAY_MAX_TOKENS,
    maxCumulativeTokens: REPLAY_MAX_CUMULATIVE_TOKENS,
    maxToolResultChars: REPLAY_MAX_TOOL_RESULT_CHARS,
    // A replay has no reader attached to the model call: the client that
    // started it is waiting on one JSON body, and the answering turn is the
    // published output of this run.
    finalTurn: 'blocking',
    logContext: 'replay',
    // Injected by the core into a Socrata `get_data` call that omits a portal,
    // above the record and the span; Data Commons tools are untouched.
    portal,
    // Raced and cleared by the core, so one unresponsive source fails its own
    // call rather than holding the replay open.
    toolTimeoutMs,
    executeToolCall: callTool,
  };
}
