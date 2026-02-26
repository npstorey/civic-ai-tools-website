import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { formatToolProgress, formatToolResult, generateToolReason, type PanelType, type ProgressPhase } from './streaming';

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

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
  onError: (panel: PanelType, error: string) => void;
}

export interface CompletionResult {
  content: string;
  duration_ms: number;
  tokens_used: number;
  tools_called?: {
    name: string;
    args: Record<string, unknown>;
    resultSummary?: { rows: number; columns: number };
    duration_ms?: number;
    operationType?: string;
    reason?: string;
  }[];
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

    const stream = await openrouter.chat.completions.create({
      model,
      messages,
      max_tokens: 2000,
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
    callbacks.onError(panel, error instanceof Error ? error.message : 'Unknown error');
  }
}

export async function queryWithMcpStreaming(
  query: string,
  model: string,
  tools: ChatCompletionTool[],
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>,
  systemPrompt: string | undefined,
  callbacks: StreamCallbacks
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
    let response = await openrouter.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 2000,
    });

    let iterations = 0;
    const maxIterations = 10;

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
          const operationType = (args.type as string) || undefined;
          const reason = generateToolReason(args);
          const toolEntry: typeof toolsCalled[number] = { name: toolCall.function.name, args, operationType, reason };

          // Send progress update with human-readable message (pass previous calls for context)
          const progressMessage = formatToolProgress(toolCall.function.name, args, toolsCalled);
          toolsCalled.push(toolEntry);
          callbacks.onProgress(panel, progressMessage, { phase: 'tool_start', iteration: currentIteration, args });

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

            // Send a completion progress event with timing
            callbacks.onProgress(panel, progressMessage, { phase: 'tool_complete', iteration: currentIteration, duration_ms: toolDuration });

            // Send a result narration message
            const resultMessage = formatToolResult(args, toolEntry.resultSummary);
            if (resultMessage) {
              callbacks.onProgress(panel, resultMessage, { phase: 'tool_result', iteration: currentIteration, args });
            }

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            });
          } catch (error) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error executing tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
          }
        }
      }

      // Narrate the thinking step
      callbacks.onProgress(panel, 'Analyzing results and deciding next step...', { phase: 'thinking', iteration: currentIteration });

      // Get next response
      response = await openrouter.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 2000,
      });

      iterations++;
    }

    // Handle max iterations case
    const lastMessage = response.choices[0]?.message;
    if (!lastMessage?.content && (iterations >= maxIterations || lastMessage?.tool_calls)) {
      if (lastMessage?.tool_calls) {
        messages.push(lastMessage);
        for (const toolCall of lastMessage.tool_calls) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Tool call limit reached. Please provide a summary based on the data already collected.',
          });
        }
      }

      callbacks.onProgress(panel, 'Generating final response...', { phase: 'synthesize' });

      // Make final streaming call without tools
      const finalStream = await openrouter.chat.completions.create({
        model,
        messages: [
          ...messages,
          {
            role: 'user',
            content: 'Based on all the data you have collected from the tool calls above, please provide a comprehensive answer to my original question. Summarize the key findings.',
          },
        ],
        max_tokens: 2000,
        stream: true,
      });

      let content = '';
      let tokensUsed = 0;

      for await (const chunk of finalStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          callbacks.onToken(panel, delta);
        }
        if (chunk.usage?.total_tokens) {
          tokensUsed = chunk.usage.total_tokens;
        }
      }

      const duration_ms = Date.now() - startTime;
      callbacks.onComplete(panel, {
        content,
        duration_ms,
        tokens_used: tokensUsed,
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
      callbacks.onComplete(panel, {
        content,
        duration_ms,
        tokens_used: response.usage?.total_tokens || 0,
        tools_called: toolsCalled.length > 0 ? toolsCalled : undefined,
      });
    } else {
      // No content - make a final streaming call
      callbacks.onProgress(panel, 'Synthesizing findings into response...', { phase: 'synthesize' });

      const finalStream = await openrouter.chat.completions.create({
        model,
        messages,
        max_tokens: 2000,
        stream: true,
      });

      let content = '';
      let tokensUsed = 0;

      for await (const chunk of finalStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          callbacks.onToken(panel, delta);
        }
        if (chunk.usage?.total_tokens) {
          tokensUsed = chunk.usage.total_tokens;
        }
      }

      const duration_ms = Date.now() - startTime;
      callbacks.onComplete(panel, {
        content,
        duration_ms,
        tokens_used: tokensUsed,
        tools_called: toolsCalled.length > 0 ? toolsCalled : undefined,
      });
    }
  } catch (error) {
    callbacks.onError(panel, error instanceof Error ? error.message : 'Unknown error');
  }
}
