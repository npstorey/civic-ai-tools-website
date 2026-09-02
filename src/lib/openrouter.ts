/**
 * The A-side of `/api/compare`: one model call, no tools, no loop.
 *
 * WHAT USED TO BE HERE. This file held the ORIGINAL tool-calling loop — the
 * January implementation `openrouter-streaming.ts` was forked from, and the one
 * every defect in the family was written in first: the exit condition that
 * returned an announcement as the answer (#319 / #344), raw error text fed to
 * the model instead of `describeToolFailureForLlm`, tool-call records with no
 * failure fields (#321), no truncation at all, an unguarded argument parse
 * (#349). Wave #345 P4 deleted it: `/api/compare`'s MCP side now runs on the
 * shared core (`model-loop/run-tool-loop.ts`), configured by
 * `model-loop/compare-loop.ts`.
 *
 * WHY WHAT IS LEFT STAYS. `queryWithoutMcp` is the control half of the
 * comparison — the same model, the same question, no data source — and it is
 * deliberately not loop-class: one completion, no `tools`, nothing to
 * consolidate. It keeps its entry on `model-call-registry.test.ts`'s
 * ALLOWED_MODEL_CALLERS for exactly that reason, and has none on
 * ALLOWED_TOOL_LOOPS.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getModelClient } from './model-client.ts';
import type { ModelIdentity } from './model-catalog.ts';

/**
 * The `withoutMcp` half of the `POST /api/compare` response body. The `withMcp`
 * half is `CompareCompletionResult` in `model-loop/compare-loop.ts`; it carries
 * a `tools_called[]` as well, which this side never has.
 */
export interface CompletionResult {
  content: string;
  duration_ms: number;
  // #374: absent, not `0`, when the endpoint reported no usage total.
  tokens_used?: number;
}

export async function queryWithoutMcp(
  query: string,
  model: ModelIdentity,
  systemPrompt?: string
): Promise<CompletionResult> {
  const startTime = Date.now();

  const messages: ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: query });

  const response = await getModelClient().chat.completions.create({
    model: model.endpointModel,
    messages,
    max_tokens: 2000,
  });

  const duration_ms = Date.now() - startTime;
  const content = response.choices[0]?.message?.content || '';
  // #374: keyed on the endpoint having REPORTED a total, not on the total
  // being truthy — a reported 0 must survive as 0, and an unreported total
  // must be absent from the result rather than sent as 0.
  const reported = response.usage?.total_tokens;

  return {
    content,
    duration_ms,
    ...(typeof reported === 'number' ? { tokens_used: reported } : {}),
  };
}
