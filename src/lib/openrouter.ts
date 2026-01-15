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
    max_tokens: 2000,
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
    max_tokens: 2000,
  });

  // Handle tool calls iteratively
  let iterations = 0;
  const maxIterations = 10; // Prevent infinite loops

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
      max_tokens: 2000,
    });

    iterations++;
  }

  // If we hit max iterations or the response still has tool_calls but no content,
  // force a final response without tools
  const lastMessage = response.choices[0]?.message;
  if (!lastMessage?.content && (iterations >= maxIterations || lastMessage?.tool_calls)) {
    // Add the last assistant message if it has tool calls
    if (lastMessage?.tool_calls) {
      messages.push(lastMessage);
      // Add placeholder tool responses for any pending calls
      for (const toolCall of lastMessage.tool_calls) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: 'Tool call limit reached. Please provide a summary based on the data already collected.',
        });
      }
    }

    // Make final call without tools to force a text response
    response = await openrouter.chat.completions.create({
      model,
      messages: [
        ...messages,
        {
          role: 'user',
          content: 'Based on all the data you have collected from the tool calls above, please provide a comprehensive answer to my original question. Summarize the key findings.',
        },
      ],
      max_tokens: 2000,
      // No tools - forces text response
    });
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
