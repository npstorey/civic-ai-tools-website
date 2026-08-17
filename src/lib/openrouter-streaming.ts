import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { getModelClient, classifyModelError } from './model-client.ts';
import { formatToolProgress, formatToolResult, generateToolReason, describeToolFailureForLlm, type PanelType, type ProgressPhase, type StreamErrorCode } from './streaming.ts';
import type { TraceBuilder } from './evidence/trace.ts';
import { hash as traceHash } from './evidence/trace.ts';
import { deriveOperationType } from './mcp/operation-types.ts';

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
  /** `code` is set for typed configuration failures (#178, #258 C4); undefined otherwise. */
  onError: (panel: PanelType, error: string, code?: StreamErrorCode) => void;
}

/**
 * Shared failure tail for both streaming query functions: classify the error,
 * log it server-side (previously this path was silent — the error only went to
 * the SSE callback), and forward message + typed code to the caller.
 */
function reportStreamFailure(panel: PanelType, error: unknown, callbacks: StreamCallbacks): void {
  const code = classifyModelError(error) ?? undefined;
  console.error(`[stream:${panel}] query failed${code ? ` (${code})` : ''}:`, error);
  callbacks.onError(panel, error instanceof Error ? error.message : 'Unknown error', code);
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
  }[];
}

// Token safety limits (configurable via env vars)
const MAX_TOKENS_PER_REQUEST = Number(process.env.TOKEN_LIMIT_PER_REQUEST) || 200_000;
const MAX_TOOL_RESULT_CHARS = Number(process.env.MAX_TOOL_RESULT_CHARS) || 50_000;

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
  model: string,
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
      model,
      messages,
      max_tokens: 4000,
      stream: true,
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
  model: string,
  tools: ChatCompletionTool[],
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>,
  systemPrompt: string | undefined,
  callbacks: StreamCallbacks,
  trace?: TraceContext,
): Promise<void> {
  const startTime = Date.now();
  const panel: PanelType = 'withMcp';
  const toolsCalled: { name: string; args: Record<string, unknown>; resultSummary?: { rows: number; columns: number }; duration_ms?: number; operationType?: string; reason?: string }[] = [];

  try {
    callbacks.onProgress(panel, 'Reading your question...', { phase: 'analyze' });

    const messages: ChatCompletionMessageParam[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: query });

    // First call - check if tools needed (non-streaming to check for tool_calls)
    let llmSpanId = trace?.builder.startSpan('llm_inference', trace.parentSpanId, {
      'gen_ai.system': 'openrouter',
      'gen_ai.request.model': model,
      ...(trace.systemPromptHash ? { 'gen_ai.system_prompt_hash': trace.systemPromptHash } : {}),
      'gen_ai.inference_index': 0,
    });
    let response = await getModelClient().chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 4000,
    });
    if (llmSpanId) {
      trace!.builder.endSpan(llmSpanId, {
        'gen_ai.response.prompt_tokens': response.usage?.prompt_tokens || 0,
        'gen_ai.response.completion_tokens': response.usage?.completion_tokens || 0,
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

            // Parse result to extract row/column counts
            try {
              const parsed = JSON.parse(result);
              if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
                toolEntry.resultSummary = {
                  rows: parsed.length,
                  columns: Object.keys(parsed[0]).length,
                };
              }
            } catch {
              // Not JSON or not an array - skip
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
        'gen_ai.system': 'openrouter',
        'gen_ai.request.model': model,
        'gen_ai.inference_index': currentIteration,
      });
      response = await getModelClient().chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 4000,
      });
      if (llmSpanId) {
        trace!.builder.endSpan(llmSpanId, {
          'gen_ai.response.prompt_tokens': response.usage?.prompt_tokens || 0,
          'gen_ai.response.completion_tokens': response.usage?.completion_tokens || 0,
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
        model,
        messages: [
          ...messages,
          {
            role: 'user',
            content: 'Based on all the data you have collected from the tool calls above, please provide a comprehensive answer to my original question. Summarize the key findings.',
          },
        ],
        max_tokens: 4000,
        stream: true,
      });

      let content = '';
      let finalCallTokens = 0;
      let finalPromptTokens = 0;
      let finalCompletionTokens = 0;

      for await (const chunk of finalStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          callbacks.onToken(panel, delta);
        }
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
        model,
        messages,
        max_tokens: 4000,
        stream: true,
      });

      let content = '';
      let finalCallTokens = 0;
      let finalPromptTokens = 0;
      let finalCompletionTokens = 0;

      for await (const chunk of finalStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          callbacks.onToken(panel, delta);
        }
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
