import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { getModelClient, classifyModelError, includeStreamUsage, getModelApiKind } from './model-client.ts';
import type { ModelIdentity } from './model-catalog.ts';
import { formatToolProgress, formatToolResult, classifyStreamError, streamErrorPayload, type PanelType, type ProgressPhase, type StreamErrorCode, type StreamErrorKind } from './streaming.ts';
import { runToolLoop, type LoopEvent, type ToolCallRecord, type TraceContext } from './model-loop/run-tool-loop.ts';
import { describeQueryOutcome } from './evidence/query-step.ts';
import type { ToolFailureKind } from './notebook-author/tool-to-cell.ts';

/**
 * The tool-calling loop itself lives in `model-loop/run-tool-loop.ts` (#345):
 * three callers used to carry three copies of it, and every defect fixed in
 * one survived in the other two. This module is now the SSE-facing caller —
 * it binds the panel, renders reader-facing progress copy, paces the
 * pass-through answer and classifies failures for the wire. Nothing about
 * what the loop does lives here any more.
 *
 * The three names below stay exported from this module because callers and
 * tests import them from here; they are re-exports, not second copies.
 */
export { announcesUnrunWork, responseModelAttributes } from './model-loop/run-tool-loop.ts';
export type { TraceContext };

export interface ProgressOpts {
  duration_ms?: number;
  phase?: ProgressPhase;
  iteration?: number;
  args?: Record<string, unknown>;
  /** See `ProgressEvent` in ./streaming.ts (#384): the recorded tool name and
   *  the operation type the loop derived, on every tool-phase event. */
  toolName?: string;
  operationType?: string;
  /**
   * The loop recorded the call as rejected (#384 P8, F2): on the end event
   * of that call and on the outcome event that follows it, never on an
   * event of a call that was answered — absent is absent.
   */
  failed?: boolean;
  failureKind?: ToolFailureKind;
}

export interface StreamCallbacks {
  onProgress: (panel: PanelType, message: string, opts?: ProgressOpts) => void;
  onToken: (panel: PanelType, content: string) => void;
  onComplete: (panel: PanelType, result: CompletionResult) => void;
  /**
   * `error` is reader-facing copy, never a raw error string, and `code` carries
   * the classified kind for every failure — not just the typed configuration
   * refusals of #178 and #258 C4 (#154). It stays optional because callers
   * other than `reportStreamFailure` may still omit it.
   */
  onError: (panel: PanelType, error: string, code?: StreamErrorCode) => void;
}

/**
 * The wire dialect, for the operator log line below. Never throws: an
 * unrecognized `MODEL_API_KIND` is a typed refusal from `getModelApiKind()`,
 * and although that state cannot produce an upstream 429 (the client refuses
 * to be built at all), a failure handler must not fail on its own account.
 */
function dialectNote(kind: StreamErrorKind): string {
  if (kind !== 'model_rate_limited') return '';
  try {
    return ` [model endpoint dialect: ${getModelApiKind()}]`;
  } catch {
    return '';
  }
}

/**
 * Shared failure tail for both streaming query functions: classify the error,
 * log it server-side (previously this path was silent — the error only went to
 * the SSE callback), and forward a sanitized payload to the caller.
 *
 * #154: this used to forward `error.message`. Every render site maps that
 * through `friendlyStreamError`, so nothing raw was ever displayed — but the
 * raw string still travelled on the SSE `error` event, where MCP server names,
 * status codes and timeout text were readable in devtools. Both streaming
 * functions funnel their failures through here, so classifying ONCE at this
 * single chokepoint is enough: the wire now carries reader-facing copy plus
 * the classified kind, and the raw error goes only to the server log above.
 *
 * `classifyModelError` runs first because it classifies structurally (a
 * `ModelConfigurationError` instance, a 401/403 status, a 429 from the
 * endpoint) where the text matcher could only guess from wording;
 * `classifyStreamError` covers everything else. That ordering is what keeps an
 * upstream 429 (`model_rate_limited`) apart from this app's own per-day limiter
 * (`rate_limit`) — see `classifyModelError` for why the split lives there.
 *
 * The operator log names the wire dialect on an upstream rate limit
 * (website#30 P4). It is the fact an operator needs first and cannot get from
 * the reader-facing copy, which deliberately carries no infrastructure detail:
 * under a deployment-routed dialect the quota being hit is per-model and
 * per-region, so "which endpoint is refusing us" is the start of the diagnosis.
 */
function reportStreamFailure(panel: PanelType, error: unknown, callbacks: StreamCallbacks): void {
  const kind: StreamErrorKind = classifyModelError(error) ?? classifyStreamError(error);
  console.error(`[stream:${panel}] query failed (${kind})${dialectNote(kind)}:`, error);
  const { message, code } = streamErrorPayload(kind);
  callbacks.onError(panel, message, code);
}

export interface CompletionResult {
  content: string;
  duration_ms: number;
  // #374: absent, not `0`, when the endpoint's stream carried no usage total.
  tokens_used?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  token_limit_exceeded?: boolean;
  tools_called?: ToolCallRecord[];
}

// Token safety limits (configurable via env vars)
const MAX_TOKENS_PER_REQUEST = Number(process.env.TOKEN_LIMIT_PER_REQUEST) || 200_000;
const MAX_TOOL_RESULT_CHARS = Number(process.env.MAX_TOOL_RESULT_CHARS) || 50_000;

/** Tool-calling rounds, and `max_tokens` on every request this caller makes. */
const MAX_ITERATIONS = 20;
const MAX_TOKENS_PER_RESPONSE = 4000;

/**
 * A pass-through answer — one the model produced on its own account, needing
 * no answering turn — arrives whole. It is paced onto the wire so a reader
 * sees it build the way a streamed answer does, rather than appearing at once
 * after a long silence.
 */
const PASS_THROUGH_DELIVERY = { chunkChars: 20, delayMs: 10 };

/**
 * The recorded identity of a tool call, as every tool-phase progress event
 * carries it (#384). Before this, `reportLoopEvent` had `event.call.name` in
 * hand and passed only `{ phase, iteration, args }`, so every reader of the
 * stream had to infer the tool from `args.type` — which only `get_data`
 * carries. `operationType` is omitted, not set to `undefined`, when the loop
 * derived none (`fetch`, by design): in-process consumers see the object as-is,
 * and an absent key and an undefined one should read the same way.
 */
function toolIdentity(call: ToolCallRecord): Pick<ProgressOpts, 'toolName' | 'operationType'> {
  return {
    toolName: call.name,
    ...(call.operationType !== undefined ? { operationType: call.operationType } : {}),
  };
}

/**
 * Render one loop event as the SSE progress this panel's reader sees. The loop
 * reports structurally and knows nothing about panels; the copy and the
 * formatters live here, on the side that has a reader.
 */
function reportLoopEvent(panel: PanelType, event: LoopEvent, callbacks: StreamCallbacks): void {
  switch (event.type) {
    case 'tool_start':
      callbacks.onProgress(
        panel,
        formatToolProgress(event.call.name, event.call.args, event.priorCalls),
        { phase: 'tool_start', iteration: event.iteration, args: event.call.args, ...toolIdentity(event.call) },
      );
      return;
    case 'tool_complete':
      callbacks.onProgress(
        panel,
        formatToolProgress(event.call.name, event.call.args, event.priorCalls),
        { phase: 'tool_complete', iteration: event.iteration, duration_ms: event.durationMs, ...toolIdentity(event.call) },
      );
      return;
    case 'tool_failed': {
      // The END event keeps the phase every consumer pairs to the start by
      // (`tool_complete`, message) — the hooks and the replay read the
      // failure off the entry they already build, and no pairing changes —
      // and the OUTCOME event that follows says it in the reader's words.
      // Those words are the one formatter's (`describeQueryOutcome`, the
      // record page's and the card's): one sentence for one fact.
      const failure = { failed: true as const, failureKind: event.failureKind };
      callbacks.onProgress(
        panel,
        formatToolProgress(event.call.name, event.call.args, event.priorCalls),
        { phase: 'tool_complete', iteration: event.iteration, duration_ms: event.durationMs, ...toolIdentity(event.call), ...failure },
      );
      callbacks.onProgress(
        panel,
        describeQueryOutcome({ failed: true, failureKind: event.failureKind }).text,
        { phase: 'tool_result', iteration: event.iteration, args: event.call.args, ...toolIdentity(event.call), ...failure },
      );
      return;
    }
    case 'tool_result': {
      const resultMessage = formatToolResult(event.call.args, event.call.resultSummary, event.call.name);
      if (resultMessage) {
        callbacks.onProgress(panel, resultMessage, {
          phase: 'tool_result',
          iteration: event.iteration,
          args: event.call.args,
          ...toolIdentity(event.call),
        });
      }
      return;
    }
    case 'thinking':
      callbacks.onProgress(panel, 'Analyzing results and deciding next step...', {
        phase: 'thinking',
        iteration: event.iteration,
      });
      return;
    case 'token_budget_exhausted':
      callbacks.onProgress(
        panel,
        `Token limit reached (${event.cumulativeTokens.toLocaleString()} tokens used). Generating response with data collected so far...`,
        { phase: 'synthesize' },
      );
      return;
    case 'answering_turn':
      if (!event.tokenLimitExceeded) {
        callbacks.onProgress(panel, 'Generating final response...', { phase: 'synthesize' });
      }
      return;
    case 'pass_through':
      callbacks.onProgress(panel, 'Synthesizing findings into response...', { phase: 'synthesize' });
      return;
  }
}

export async function queryWithoutMcpStreaming(
  query: string,
  model: ModelIdentity,
  systemPrompt: string | undefined,
  callbacks: StreamCallbacks
): Promise<void> {
  const startTime = Date.now();
  const panel: PanelType = 'withoutMcp';

  try {
    callbacks.onProgress(panel, 'Generating response...', { phase: 'analyze' });

    const messages: ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: query });

    // The A-side of the comparison: one turn, no tools, no loop. It is not a
    // caller of the shared loop and must not become one — the whole point of
    // this panel is what the model says with no data source at all.
    const stream = await getModelClient().chat.completions.create({
      model: model.endpointModel,
      messages,
      max_tokens: MAX_TOKENS_PER_RESPONSE,
      stream: true,
      ...(includeStreamUsage() ? { stream_options: { include_usage: true } } : {}),
    });

    let content = '';
    // #374: undefined means "the endpoint never reported a total" — distinct
    // from a reported 0, which is a real answer and must survive as 0.
    let tokensUsed: number | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        content += delta;
        callbacks.onToken(panel, delta);
      }
      // Track usage from final chunk. Keyed on the endpoint having REPORTED a
      // total (typeof ... === 'number'), not on the total being truthy — a
      // reported 0 must not be treated the same as "never reported".
      if (typeof chunk.usage?.total_tokens === 'number') {
        tokensUsed = chunk.usage.total_tokens;
      }
    }

    const duration_ms = Date.now() - startTime;

    callbacks.onComplete(panel, {
      content,
      duration_ms,
      // Omit the key entirely when never reported, rather than sending
      // `tokens_used: undefined` — in-process consumers (tests, the SSE
      // route that JSON.stringifies this) see the object as-is, before any
      // serialization step that would drop an undefined-valued key on its
      // own.
      ...(tokensUsed !== undefined ? { tokens_used: tokensUsed } : {}),
    });
  } catch (error) {
    reportStreamFailure(panel, error, callbacks);
  }
}

/**
 * The two tool-call concerns the core owns (#359, #352), forwarded rather than
 * performed here.
 *
 * Both of this module's callers — `/api/compare-stream` and
 * `/api/query-notebook` — used to do these inside the `executeToolCall`
 * closure they hand down, which is two frames below the seam and, worse,
 * below the point where the core has already recorded the call and
 * stringified its arguments onto the `mcp_tool_call` span. Passing them as
 * values means the span and the record agree on this path too, and the
 * per-call timer is armed and cleared once, in the core, instead of being
 * armed per call and never cleared in each route.
 */
export interface ToolCallOptions {
  /** Default portal for a Socrata `get_data` call whose arguments omit one. */
  portal?: string;
  /** Per-tool-call timeout in ms. Omitted = unbounded. */
  toolTimeoutMs?: number;
}

export async function queryWithMcpStreaming(
  query: string,
  model: ModelIdentity,
  tools: ChatCompletionTool[],
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>,
  systemPrompt: string | undefined,
  callbacks: StreamCallbacks,
  trace?: TraceContext,
  toolCallOptions?: ToolCallOptions,
): Promise<void> {
  const startTime = Date.now();
  const panel: PanelType = 'withMcp';

  try {
    callbacks.onProgress(panel, 'Reading your question...', { phase: 'analyze' });

    const result = await runToolLoop({
      client: getModelClient(),
      endpointModel: model.endpointModel,
      declaredModel: model.declared,
      prompt: query,
      systemPrompt,
      tools,
      // Handed straight through: whatever this closure injects into `args`
      // is what the record shows, because the loop hands it the same object
      // it recorded. The portal is no longer one of those things — it is the
      // option below, applied before the record and the span exist.
      executeToolCall,
      portal: toolCallOptions?.portal,
      toolTimeoutMs: toolCallOptions?.toolTimeoutMs,
      maxIterations: MAX_ITERATIONS,
      maxTokens: MAX_TOKENS_PER_RESPONSE,
      maxCumulativeTokens: MAX_TOKENS_PER_REQUEST,
      maxToolResultChars: MAX_TOOL_RESULT_CHARS,
      finalTurn: 'stream',
      passThroughDelivery: PASS_THROUGH_DELIVERY,
      onDelta: (delta) => callbacks.onToken(panel, delta),
      onEvent: (event) => reportLoopEvent(panel, event, callbacks),
      trace,
      logContext: panel,
    });

    const duration_ms = Date.now() - startTime;
    const tools_called = result.toolCalls.length > 0 ? result.toolCalls : undefined;

    if (result.answeringTurnTaken) {
      callbacks.onComplete(panel, {
        content: result.content,
        duration_ms,
        tokens_used: result.usage.totalTokens,
        prompt_tokens: result.usage.promptTokens || undefined,
        completion_tokens: result.usage.completionTokens || undefined,
        // Carried only on this path, and deliberately: a run that took the
        // answering turn is the only one that can have been cut short, and
        // the reader's truncation banner is keyed on the flag being present.
        // The pass-through completion below omits the key rather than
        // asserting `false` on every ordinary answer.
        token_limit_exceeded: result.tokenLimitExceeded,
        tools_called,
      });
      return;
    }

    callbacks.onComplete(panel, {
      content: result.content,
      duration_ms,
      tokens_used: result.usage.totalTokens,
      prompt_tokens: result.usage.promptTokens || undefined,
      completion_tokens: result.usage.completionTokens || undefined,
      tools_called,
    });
  } catch (error) {
    reportStreamFailure(panel, error, callbacks);
  }
}
