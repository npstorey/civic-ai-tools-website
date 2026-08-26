import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { getModelClient, classifyModelError, getGenAiSystem, includeStreamUsage, getModelApiKind } from './model-client.ts';
import type { ModelIdentity } from './model-catalog.ts';
import { formatToolProgress, formatToolResult, generateToolReason, describeToolFailureForLlm, classifyStreamError, streamErrorPayload, type PanelType, type ProgressPhase, type StreamErrorCode, type StreamErrorKind } from './streaming.ts';
import type { TraceBuilder } from './evidence/trace.ts';
import { hash as traceHash } from './evidence/trace.ts';
import { deriveOperationType } from './mcp/operation-types.ts';
import type { ToolFailureKind } from './notebook-author/tool-to-cell.ts';

export interface TraceContext {
  builder: TraceBuilder;
  parentSpanId: string;
  systemPromptHash?: string;
  /**
   * Optional hook that maps a tool name to its MCP source id (e.g. "socrata",
   * "data-commons"). When provided, the source is recorded on each
   * `mcp_tool_call` span so the PROV-O builder can distinguish servers.
   */
  resolveToolSource?: (toolName: string) => string | undefined;
}

export interface ProgressOpts {
  duration_ms?: number;
  phase?: ProgressPhase;
  iteration?: number;
  args?: Record<string, unknown>;
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
  tokens_used: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  token_limit_exceeded?: boolean;
  tools_called?: {
    name: string;
    args: Record<string, unknown>;
    resultSummary?: { rows: number; columns: number };
    duration_ms?: number;
    operationType?: string;
    reason?: string;
    /** Set when the tool call threw; see the catch block below (#321). */
    failed?: boolean;
    failureKind?: ToolFailureKind;
  }[];
}

/**
 * Map a thrown tool-call error onto the notebook's failure vocabulary (#321).
 *
 * `classifyStreamError` is already this file's classifier for the same error
 * shapes (`reportStreamFailure` uses it), so failure is classified ONCE, in
 * one place, rather than re-derived downstream from prose. The mapping is
 * narrowing and deliberately lossy: `ToolFailureKind` describes what a
 * notebook reader needs to know about ONE request, so the six kinds that
 * describe a whole query rather than a single tool call — this app's own rate
 * limit, the two model-credential kinds, notebook execution — collapse into
 * `unknown` rather than being asserted as something more specific than was
 * measured (design-principles.md Principle 3).
 *
 * `connection` joins `mcp_unavailable`: to a reader deciding whether to re-run
 * the notebook, "the source could not be reached" is the same fact either way.
 */
function toolFailureKindOf(error: unknown): ToolFailureKind {
  switch (classifyStreamError(error)) {
    case 'mcp_timeout':
      return 'timeout';
    case 'mcp_unavailable':
    case 'connection':
      return 'unavailable';
    case 'mcp_not_configured':
      return 'not_configured';
    default:
      return 'unknown';
  }
}

// Token safety limits (configurable via env vars)
const MAX_TOKENS_PER_REQUEST = Number(process.env.TOKEN_LIMIT_PER_REQUEST) || 200_000;
const MAX_TOOL_RESULT_CHARS = Number(process.env.MAX_TOOL_RESULT_CHARS) || 50_000;

/**
 * The span attributes recording what the endpoint said it used, next to what
 * this instance declared (website#30 P3, E5 — G0 D3: record both, warn, never
 * gate).
 *
 * `gen_ai.request.model` carries the DECLARED identity, not the wire string.
 * The trace is inside the signed package, so the rule that governs
 * `cost.model` governs it too: a deployment alias is the operator's private
 * label and does not go into a public record. `gen_ai.response.model` is the
 * endpoint's own report, which is the only half of the pair this app does not
 * choose — and having both under one signature is what lets a reader check the
 * declaration against the report without trusting either of us.
 *
 * A mismatch is a disclosure, not a failure. It is normal and benign (an
 * endpoint answering `gpt-4o-2024-11-20` for a request that said `gpt-4o`),
 * and where it is not benign the record now carries the evidence either way.
 * Gating on it would turn a routing detail into a lost answer.
 */
export function responseModelAttributes(
  declared: string,
  reported: string | undefined,
  context: string,
): Record<string, string> {
  if (!reported) return {};
  if (reported !== declared) {
    console.warn(
      `[stream:${context}] endpoint reported a different model than this instance declares`,
      { declared, reported },
    );
  }
  return { 'gen_ai.response.model': reported };
}

// Truncate large tool results to limit input token growth
function truncateToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;

  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Keep enough rows to stay under the limit
      const sampleRow = JSON.stringify(parsed[0]);
      const rowSize = sampleRow.length + 2; // comma + newline
      const maxRows = Math.max(5, Math.floor(MAX_TOOL_RESULT_CHARS / rowSize));
      const truncated = parsed.slice(0, maxRows);
      return JSON.stringify(truncated) +
        `\n[Truncated: showing ${truncated.length} of ${parsed.length} rows]`;
    }
  } catch {
    // Not JSON — fall through to raw truncation
  }

  return result.slice(0, MAX_TOOL_RESULT_CHARS) +
    `\n[Truncated: result was ${result.length} characters]`;
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

    const stream = await getModelClient().chat.completions.create({
      model: model.endpointModel,
      messages,
      max_tokens: 4000,
      stream: true,
      ...(includeStreamUsage() ? { stream_options: { include_usage: true } } : {}),
    });

    let content = '';
    let tokensUsed = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        content += delta;
        callbacks.onToken(panel, delta);
      }
      // Track usage from final chunk
      if (chunk.usage?.total_tokens) {
        tokensUsed = chunk.usage.total_tokens;
      }
    }

    const duration_ms = Date.now() - startTime;

    callbacks.onComplete(panel, {
      content,
      duration_ms,
      tokens_used: tokensUsed,
    });
  } catch (error) {
    reportStreamFailure(panel, error, callbacks);
  }
}

export async function queryWithMcpStreaming(
  query: string,
  model: ModelIdentity,
  tools: ChatCompletionTool[],
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>,
  systemPrompt: string | undefined,
  callbacks: StreamCallbacks,
  trace?: TraceContext,
): Promise<void> {
  const startTime = Date.now();
  const panel: PanelType = 'withMcp';
  const toolsCalled: { name: string; args: Record<string, unknown>; resultSummary?: { rows: number; columns: number }; duration_ms?: number; operationType?: string; reason?: string; failed?: boolean; failureKind?: ToolFailureKind }[] = [];

  try {
    callbacks.onProgress(panel, 'Reading your question...', { phase: 'analyze' });

    const messages: ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: query });

    // First call - check if tools needed (non-streaming to check for tool_calls)
    let llmSpanId = trace?.builder.startSpan('llm_inference', trace.parentSpanId, {
      'gen_ai.system': getGenAiSystem(),
      'gen_ai.request.model': model.declared,
      ...(trace.systemPromptHash ? { 'gen_ai.system_prompt_hash': trace.systemPromptHash } : {}),
      'gen_ai.inference_index': 0,
    });
    let response = await getModelClient().chat.completions.create({
      model: model.endpointModel,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 4000,
    });
    if (llmSpanId) {
      trace!.builder.endSpan(llmSpanId, {
        'gen_ai.response.prompt_tokens': response.usage?.prompt_tokens || 0,
        'gen_ai.response.completion_tokens': response.usage?.completion_tokens || 0,
        ...responseModelAttributes(model.declared, response.model, panel),
      });
    }

    let iterations = 0;
    const maxIterations = 20;
    let cumulativeTokens = response.usage?.total_tokens || 0;
    let cumulativePromptTokens = response.usage?.prompt_tokens || 0;
    let cumulativeCompletionTokens = response.usage?.completion_tokens || 0;
    let tokenLimitExceeded = false;

    // Handle tool calls iteratively
    while (response.choices[0]?.message?.tool_calls && iterations < maxIterations) {
      const assistantMessage = response.choices[0].message;
      const toolCalls = assistantMessage.tool_calls;
      messages.push(assistantMessage);

      if (!toolCalls) break;

      const currentIteration = iterations + 1;

      for (const toolCall of toolCalls) {
        if (toolCall.type === 'function') {
          const args = JSON.parse(toolCall.function.arguments);
          const operationType = deriveOperationType(toolCall.function.name, args);
          const reason = generateToolReason(args);
          const toolEntry: typeof toolsCalled[number] = { name: toolCall.function.name, args, operationType, reason };

          // Send progress update with human-readable message (pass previous calls for context)
          const progressMessage = formatToolProgress(toolCall.function.name, args, toolsCalled);
          toolsCalled.push(toolEntry);
          callbacks.onProgress(panel, progressMessage, { phase: 'tool_start', iteration: currentIteration, args });

          // Trace: start MCP tool call span.
          // `mcp.source` distinguishes which MCP server handled the call so the
          // PROV-O builder can emit a distinct prov:Agent per source (see
          // provenance.ts). Unknown tools fall back to "unknown".
          const toolSource = trace?.resolveToolSource?.(toolCall.function.name) ?? 'unknown';
          const toolTraceSpanId = trace?.builder.startSpan('mcp_tool_call', trace.parentSpanId, {
            'tool.name': toolCall.function.name,
            'tool.operation_type': operationType || 'unknown',
            'tool.arguments': JSON.stringify(args),
            'mcp.source': toolSource,
            ...(args.dataset_id ? { 'tool.dataset_id': String(args.dataset_id) } : {}),
            ...(args.portal ? { 'tool.portal_domain': String(args.portal) } : {}),
          });

          try {
            const toolStartTime = Date.now();
            const result = await executeToolCall(toolCall.function.name, args);
            const toolDuration = Date.now() - toolStartTime;
            toolEntry.duration_ms = toolDuration;

            // Parse result to extract row/column counts. Socrata (and any MCP
            // server that paginates) answers with an envelope —
            // { data: [...], total_rows: N, ... } — not a bare array, so the
            // bare-array-only check below always missed it and `resultSummary`
            // was silently null for every Socrata call (#322).
            //
            // `rows` is what THIS CALL actually delivered — `data.length` —
            // never `total_rows`. `total_rows` is the size of the matching set
            // upstream; a capped page can return far fewer rows than that, and
            // every downstream reader of `resultSummary.rows` (the narration
            // copy below, and the "records analyzed" / "rows returned" rollups
            // in buildNarrativeSummary/buildProvenanceLine in streaming.ts)
            // means "how much data flowed through this call," not "how large
            // is the source dataset." Reporting `total_rows` there would claim
            // the model analyzed rows it never saw.
            try {
              const parsed: unknown = JSON.parse(result);
              const rows: unknown[] | undefined = Array.isArray(parsed)
                ? parsed
                : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).data)
                  ? (parsed as Record<string, unknown>).data as unknown[]
                  : undefined;

              if (rows) {
                const firstRow = rows[0];
                if (rows.length === 0) {
                  // A valid, empty result set is a real answer ("no matching
                  // records"), not a parse failure — worth distinguishing from
                  // the silent-skip cases below so a zero-row response is
                  // diagnosable rather than indistinguishable from "did not
                  // parse."
                  toolEntry.resultSummary = { rows: 0, columns: 0 };
                } else if (typeof firstRow === 'object' && firstRow !== null) {
                  toolEntry.resultSummary = {
                    rows: rows.length,
                    columns: Object.keys(firstRow).length,
                  };
                }
                // else: a non-empty array whose elements are not objects
                // (e.g. an array of strings) - not tabular, skip, matching
                // the prior bare-array behavior.
              }
              // else: not JSON-parseable as a bare array or a { data: [...] }
              // envelope (e.g. a metadata/metrics payload, or an envelope with
              // no `data` field) - skip, `resultSummary` stays unset.
            } catch {
              // Not JSON - skip
            }

            // Trace: end tool call span with response metadata
            if (toolTraceSpanId) {
              trace!.builder.endSpan(toolTraceSpanId, {
                'tool.response_hash': traceHash(result),
                'tool.response_size_bytes': result.length,
                'tool.duration_ms': toolDuration,
                ...(toolEntry.resultSummary ? { 'tool.response_rows': toolEntry.resultSummary.rows } : {}),
              });
            }

            // Send a completion progress event with timing
            callbacks.onProgress(panel, progressMessage, { phase: 'tool_complete', iteration: currentIteration, duration_ms: toolDuration });

            // Send a result narration message
            const resultMessage = formatToolResult(args, toolEntry.resultSummary);
            if (resultMessage) {
              callbacks.onProgress(panel, resultMessage, { phase: 'tool_result', iteration: currentIteration, args });
            }

            // Truncate large results before feeding back as context
            const truncatedResult = truncateToolResult(result);

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: truncatedResult,
            });
          } catch (error) {
            // #321: record the rejection ON the tool-call entry, here, where
            // it is already known. `toolEntry` was pushed into `toolsCalled`
            // before the await, so this mutation reaches every consumer of
            // `CompletionResult.tools_called` — including the notebook
            // synthesizer, which was rendering this call as an executable
            // fetch cell that then threw on execution. Nothing downstream can
            // recover this fact: a failed call is not distinguishable from a
            // successful zero-row one by its `resultSummary`.
            toolEntry.failed = true;
            toolEntry.failureKind = toolFailureKindOf(error);
            if (toolTraceSpanId) {
              trace!.builder.endSpan(toolTraceSpanId, {
                'error': true,
                'error.message': error instanceof Error ? error.message : 'Unknown error',
              });
            }
            // Feed the model neutral guidance instead of the raw error string:
            // keep it honest (no invented data) without letting raw infra text
            // (timeouts, status codes, server names) reach the final answer.
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: describeToolFailureForLlm(toolCall.function.name, error),
            });
          }
        }
      }

      // Check token limit before making the next LLM call
      if (cumulativeTokens >= MAX_TOKENS_PER_REQUEST) {
        tokenLimitExceeded = true;
        callbacks.onProgress(panel, `Token limit reached (${cumulativeTokens.toLocaleString()} tokens used). Generating response with data collected so far...`, { phase: 'synthesize' });
        break;
      }

      // Narrate the thinking step
      callbacks.onProgress(panel, 'Analyzing results and deciding next step...', { phase: 'thinking', iteration: currentIteration });

      // Get next response
      llmSpanId = trace?.builder.startSpan('llm_inference', trace.parentSpanId, {
        'gen_ai.system': getGenAiSystem(),
        'gen_ai.request.model': model.declared,
        'gen_ai.inference_index': currentIteration,
      });
      response = await getModelClient().chat.completions.create({
        model: model.endpointModel,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 4000,
      });
      if (llmSpanId) {
        trace!.builder.endSpan(llmSpanId, {
          'gen_ai.response.prompt_tokens': response.usage?.prompt_tokens || 0,
          'gen_ai.response.completion_tokens': response.usage?.completion_tokens || 0,
          ...responseModelAttributes(model.declared, response.model, panel),
        });
      }

      // Track cumulative tokens
      cumulativeTokens += response.usage?.total_tokens || 0;
      cumulativePromptTokens += response.usage?.prompt_tokens || 0;
      cumulativeCompletionTokens += response.usage?.completion_tokens || 0;

      iterations++;
    }

    // Trace: start synthesis span (covers final output generation)
    const synthesisSpanId = trace?.builder.startSpan('synthesis', trace.parentSpanId);

    // Handle max iterations, token limit, or pending tool calls
    const lastMessage = response.choices[0]?.message;
    if (!lastMessage?.content && (iterations >= maxIterations || tokenLimitExceeded || lastMessage?.tool_calls)) {
      if (lastMessage?.tool_calls) {
        messages.push(lastMessage);
        const abortReason = tokenLimitExceeded
          ? 'Token budget exceeded. Please provide a summary based on the data already collected.'
          : 'Tool call limit reached. Please provide a summary based on the data already collected.';
        for (const toolCall of lastMessage.tool_calls) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: abortReason,
          });
        }
      }

      if (!tokenLimitExceeded) {
        callbacks.onProgress(panel, 'Generating final response...', { phase: 'synthesize' });
      }

      // Make final streaming call without tools
      const finalStream = await getModelClient().chat.completions.create({
        model: model.endpointModel,
        messages: [
          ...messages,
          {
            role: 'user',
            content: 'Based on all the data you have collected from the tool calls above, please provide a comprehensive answer to my original question. Summarize the key findings.',
          },
        ],
        max_tokens: 4000,
        stream: true,
        ...(includeStreamUsage() ? { stream_options: { include_usage: true } } : {}),
      });

      let content = '';
      let finalCallTokens = 0;
      let finalPromptTokens = 0;
      let finalCompletionTokens = 0;
      let finalReportedModel: string | undefined;

      for await (const chunk of finalStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          callbacks.onToken(panel, delta);
        }
        // Every chunk repeats the model the endpoint answered with; the last
        // one wins, so the recorded report is the one that finished the answer.
        if (chunk.model) finalReportedModel = chunk.model;
        if (chunk.usage) {
          if (chunk.usage.total_tokens) finalCallTokens = chunk.usage.total_tokens;
          if (chunk.usage.prompt_tokens) finalPromptTokens = chunk.usage.prompt_tokens;
          if (chunk.usage.completion_tokens) finalCompletionTokens = chunk.usage.completion_tokens;
        }
      }

      cumulativeTokens += finalCallTokens;
      cumulativePromptTokens += finalPromptTokens;
      cumulativeCompletionTokens += finalCompletionTokens;
      const duration_ms = Date.now() - startTime;

      if (synthesisSpanId) {
        trace!.builder.endSpan(synthesisSpanId, {
          'output.hash': traceHash(content),
          'output.length': content.length,
          'gen_ai.response.prompt_tokens': finalPromptTokens,
          'gen_ai.response.completion_tokens': finalCompletionTokens,
          ...responseModelAttributes(model.declared, finalReportedModel, panel),
        });
      }

      callbacks.onComplete(panel, {
        content,
        duration_ms,
        tokens_used: cumulativeTokens,
        prompt_tokens: cumulativePromptTokens || undefined,
        completion_tokens: cumulativeCompletionTokens || undefined,
        token_limit_exceeded: tokenLimitExceeded,
        tools_called: toolsCalled.length > 0 ? toolsCalled : undefined,
      });
      return;
    }

    // If we have content, stream the final response
    if (lastMessage?.content) {
      // We already have the content from non-streaming call, send it as tokens
      callbacks.onProgress(panel, 'Synthesizing findings into response...', { phase: 'synthesize' });

      // Send the content in chunks to simulate streaming
      const content = lastMessage.content;
      const chunkSize = 20; // characters per chunk
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        callbacks.onToken(panel, chunk);
        // Small delay to make it feel like streaming
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const duration_ms = Date.now() - startTime;

      if (synthesisSpanId) {
        trace!.builder.endSpan(synthesisSpanId, {
          'output.hash': traceHash(content),
          'output.length': content.length,
        });
      }

      // cumulativeTokens already includes this response's tokens from the loop
      callbacks.onComplete(panel, {
        content,
        duration_ms,
        tokens_used: cumulativeTokens,
        prompt_tokens: cumulativePromptTokens || undefined,
        completion_tokens: cumulativeCompletionTokens || undefined,
        tools_called: toolsCalled.length > 0 ? toolsCalled : undefined,
      });
    } else {
      // No content - make a final streaming call
      callbacks.onProgress(panel, 'Synthesizing findings into response...', { phase: 'synthesize' });

      const finalStream = await getModelClient().chat.completions.create({
        model: model.endpointModel,
        messages,
        max_tokens: 4000,
        stream: true,
        ...(includeStreamUsage() ? { stream_options: { include_usage: true } } : {}),
      });

      let content = '';
      let finalCallTokens = 0;
      let finalPromptTokens = 0;
      let finalCompletionTokens = 0;
      let finalReportedModel: string | undefined;

      for await (const chunk of finalStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          callbacks.onToken(panel, delta);
        }
        // Every chunk repeats the model the endpoint answered with; the last
        // one wins, so the recorded report is the one that finished the answer.
        if (chunk.model) finalReportedModel = chunk.model;
        if (chunk.usage) {
          if (chunk.usage.total_tokens) finalCallTokens = chunk.usage.total_tokens;
          if (chunk.usage.prompt_tokens) finalPromptTokens = chunk.usage.prompt_tokens;
          if (chunk.usage.completion_tokens) finalCompletionTokens = chunk.usage.completion_tokens;
        }
      }

      cumulativeTokens += finalCallTokens;
      cumulativePromptTokens += finalPromptTokens;
      cumulativeCompletionTokens += finalCompletionTokens;
      const duration_ms = Date.now() - startTime;

      if (synthesisSpanId) {
        trace!.builder.endSpan(synthesisSpanId, {
          'output.hash': traceHash(content),
          'output.length': content.length,
          'gen_ai.response.prompt_tokens': finalPromptTokens,
          'gen_ai.response.completion_tokens': finalCompletionTokens,
          ...responseModelAttributes(model.declared, finalReportedModel, panel),
        });
      }

      callbacks.onComplete(panel, {
        content,
        duration_ms,
        tokens_used: cumulativeTokens,
        prompt_tokens: cumulativePromptTokens || undefined,
        completion_tokens: cumulativeCompletionTokens || undefined,
        tools_called: toolsCalled.length > 0 ? toolsCalled : undefined,
      });
    }
  } catch (error) {
    reportStreamFailure(panel, error, callbacks);
  }
}
