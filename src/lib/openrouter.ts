import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

export interface CompletionResult {
  content: string;
  duration_ms: number;
  tokens_used: number;
  tools_called?: {
    name: string;
    args: Record<string, unknown>;
  }[];
}

export async function queryWithoutMcp(
  query: string,
  model: string,
  systemPrompt?: string
): Promise<CompletionResult> {
  const startTime = Date.now();

  const messages: ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: query });

  const response = await openrouter.chat.completions.create({
    model,
    messages,
  });

  const duration_ms = Date.now() - startTime;
  const content = response.choices[0]?.message?.content || '';
  const tokens_used = response.usage?.total_tokens || 0;

  return {
    content,
    duration_ms,
    tokens_used,
  };
}

export async function queryWithMcp(
  query: string,
  model: string,
  tools: ChatCompletionTool[],
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>,
  systemPrompt?: string
): Promise<CompletionResult> {
  const startTime = Date.now();
  const toolsCalled: { name: string; args: Record<string, unknown> }[] = [];

  const messages: ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: query });

  let response = await openrouter.chat.completions.create({
    model,
    messages,
    tools,
    tool_choice: 'auto',
  });

  // Handle tool calls iteratively
  let iterations = 0;
  const maxIterations = 5; // Prevent infinite loops

  while (response.choices[0]?.message?.tool_calls && iterations < maxIterations) {
    const assistantMessage = response.choices[0].message;
    const toolCalls = assistantMessage.tool_calls;
    messages.push(assistantMessage);

    // Execute each tool call
    if (!toolCalls) break;
    for (const toolCall of toolCalls) {
      // Handle both function and custom tool call types
      if (toolCall.type === 'function') {
        const args = JSON.parse(toolCall.function.arguments);
        toolsCalled.push({ name: toolCall.function.name, args });

        try {
          const result = await executeToolCall(toolCall.function.name, args);
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

    // Get next response
    response = await openrouter.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto',
    });

    iterations++;
  }

  const duration_ms = Date.now() - startTime;
  const content = response.choices[0]?.message?.content || '';
  const tokens_used = response.usage?.total_tokens || 0;

  return {
    content,
    duration_ms,
    tokens_used,
    tools_called: toolsCalled.length > 0 ? toolsCalled : undefined,
  };
}

export { openrouter };
