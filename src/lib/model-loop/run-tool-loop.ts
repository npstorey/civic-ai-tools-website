/**
 * The shared tool-calling loop — one implementation, several callers (#345).
 *
 * WHY THIS MODULE EXISTS. Three copies of this loop existed independently
 * (`openrouter-streaming.ts`, `evidence/[slug]/replay/route.ts`,
 * `openrouter.ts`), and every defect found in one survived in the other two:
 * the exit condition that published an announcement as an answer (#319 /
 * #338 / #344), raw error text fed to the model instead of
 * `describeToolFailureForLlm`, tool-call records with no failure fields
 * (#321), a truncation that hands the model malformed JSON (#331), an
 * unguarded argument parse (#349). A blast zone scoped by file cannot see a
 * defect scoped to a class, so the class gets one implementation.
 *
 * WHAT IS CORE BEHAVIOUR AND WHAT IS A PARAMETER. Anything a caller could
 * opt out of that would reintroduce one of those defects is core behaviour
 * and has no switch: the three-way exit condition, the failure vocabulary on
 * tool records, the error-to-model path, transcript well-formedness, the
 * truncation, the single statement of the output contract. What a caller is
 * given (client, model, tools, budgets, the tool transport) and what it does
 * with the result (progress rendering, streaming, error surfacing) are
 * parameters.
 *
 * THE ONE HARD CONSTRAINT: this loop never clones or freezes a tool call's
 * `args`. The object recorded on the tool-call entry is the SAME object
 * handed to `executeToolCall`, because callers inject fields into it inside
 * that closure (a portal, for one) and the recorded arguments — which reach a
 * signed package and the replay identity key — must show what was actually
 * sent. Cloning or freezing here changes those recorded arguments with
 * nothing in the diff pointing at the cause. `run-tool-loop.test.ts` holds a
 * probe on the identity.
 *
 * SSE is not a concept here. The loop reports through `onEvent`/`onDelta`;
 * panels, event encoding and reader-facing progress copy belong to whichever
 * caller has a reader.
 */

import type OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { getGenAiSystem, includeStreamUsage } from '../model-client.ts';
import { classifyStreamError, describeToolFailureForLlm, generateToolReason } from '../streaming.ts';
import type { TraceBuilder } from '../evidence/trace.ts';
import { hash as traceHash } from '../evidence/trace.ts';
import { deriveOperationType } from '../mcp/operation-types.ts';
import type { ToolFailureKind } from '../notebook-author/tool-to-cell.ts';

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

/**
 * One attempted tool call, as every caller records it. `failed`/`failureKind`
 * are set at the catch site where the rejection is already known: nothing
 * downstream can recover the fact, because a failed call is not
 * distinguishable from a successful zero-row one by its `resultSummary`
 * (#321).
 */
export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  duration_ms?: number;
  operationType?: string;
  reason?: string;
  failed?: boolean;
  failureKind?: ToolFailureKind;
}

/**
 * What the loop reports while it runs. Deliberately structural rather than
 * pre-rendered: reader-facing copy is a caller's concern, and two of the
 * three callers have no reader at all. `priorCalls` is the tool-call list as
 * it stood BEFORE the call being reported, which is what the progress
 * formatters take as context — carrying it means a caller can render
 * `tool_start` and `tool_complete` to the same string without keeping its own
 * shadow copy of the list.
 */
export type LoopEvent =
  | { type: 'tool_start'; iteration: number; call: ToolCallRecord; priorCalls: ToolCallRecord[] }
  | { type: 'tool_complete'; iteration: number; call: ToolCallRecord; priorCalls: ToolCallRecord[]; durationMs: number }
  | { type: 'tool_result'; iteration: number; call: ToolCallRecord }
  | { type: 'thinking'; iteration: number }
  | { type: 'token_budget_exhausted'; cumulativeTokens: number }
  | { type: 'answering_turn'; tokenLimitExceeded: boolean }
  | { type: 'pass_through' };

export interface ToolLoopOptions {
  /** Resolved by the caller, inside the caller's own error handling. */
  client: OpenAI;
  /** The string sent to the endpoint. */
  endpointModel: string;
  /** The identity this instance declares; trace attributes only. Defaults to `endpointModel`. */
  declaredModel?: string;
  prompt: string;
  systemPrompt?: string;
  tools: ChatCompletionTool[];
  /**
   * The seam every caller-side tool concern goes through: portal injection, a
   * per-call timeout race, source routing. Receives the SAME args object the
   * record holds — see the constraint in this file's header.
   */
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Tool-calling rounds before the loop gives up and asks for an answer. */
  maxIterations?: number;
  /** `max_tokens` on every request this loop makes. */
  maxTokens?: number;
  /** Cumulative token budget. Omitted = unbounded. */
  maxCumulativeTokens?: number;
  /** Bound on a single tool result fed back as context. */
  maxToolResultChars?: number;
  /** Whether the final answering turn streams. Only that turn is affected. */
  finalTurn?: 'blocking' | 'stream';
  /**
   * Optional pacing for the pass-through path — the run that ended with a
   * genuine answer and needs no extra model call. A caller with a reader
   * delivers that answer in chunks so it arrives like the streamed one;
   * omitted, the content is simply returned.
   */
  passThroughDelivery?: { chunkChars: number; delayMs: number };
  onDelta?: (delta: string) => void;
  onEvent?: (event: LoopEvent) => void;
  trace?: TraceContext;
  /** Label for this loop's operator log lines. */
  logContext?: string;
}

export interface ToolLoopResult {
  content: string;
  toolCalls: ToolCallRecord[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  durationMs: number;
  iterations: number;
  tokenLimitExceeded: boolean;
  /** Content was delivered through `onDelta` as it was produced. */
  streamed: boolean;
  /** The #334 answering turn was needed — an extra model call was made. */
  answeringTurnTaken: boolean;
}

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 50_000;

/**
 * A final turn that ANNOUNCES a query instead of answering it (#319).
 *
 * The tool-call loop treats any assistant message carrying no `tool_calls` as
 * the final answer. When the model narrates its next step in prose instead of
 * emitting the call, that narration becomes the published answer. The measured
 * case: eight tool calls completed, then 235 characters ending "...I'll query
 * the fraction of records that close within 14 and 30 days per type". The
 * notebook validated. The record was publishable. It is a statement of intent
 * to run a query that was never run, published under the same signature and
 * the same visual treatment as a real finding, and a reader cannot tell the
 * two apart.
 *
 * THE RULE. A final message fails the output contract when BOTH hold:
 *
 *   1. it COMMITS, in the first person, to a data step it has not taken
 *      ("I'll query...", "Let me check...", "Next I'll compute..."), and
 *   2. the whole message is shorter than `ANNOUNCEMENT_MAX_CHARS`.
 *
 * Commitment rather than offer is the first half's whole point. "I can pull
 * the 30-day rates too" and "would you like me to..." offer further work
 * AFTER answering; they are not matched, and must not be. Only forms that
 * assert the model is about to act are.
 *
 * The length bound is the conservatism. A long answer that closes with an
 * aside has already answered, and re-asking it would cost a model call and a
 * rewrite for nothing. The measured narration was 235 characters; 600 leaves
 * room for a wordier one while sitting below any message that has actually
 * summarized findings and cited a source.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is inspect the answer's substance — no
 * citation check, no "must reference a computed value" (#333). The output
 * contract's only concrete requirement is citation, and a citation gate has no
 * measured definition yet; a wrong one re-asks correct answers, which is a
 * failure that looks like rigour. The distinction drawn here is the narrower
 * one #319 is actually about: answering rather than announcing.
 *
 * COST WHEN WRONG, in each direction. A false positive costs one extra model
 * call and a re-worded answer — a real cost, which is why both conjuncts are
 * required rather than either alone. A false negative publishes a statement of
 * intent as a signed finding. The second is much worse, but not so much worse
 * that the rule should be loose.
 *
 * Not to be confused with `detectIncompleteResponse` in
 * components/shared/McpResponseDisplay.tsx, which is display-only and matches
 * the opposite admission — a model saying it could NOT finish. None of its
 * patterns fire on a confident announcement, which is why #319 reached the
 * reader with no banner at all. If a second caller ever needs this predicate,
 * export it toward that one rather than growing a parallel matcher.
 */
const ANNOUNCEMENT_MAX_CHARS = 600;

/**
 * First-person commitment, then a data-acquisition or computation verb within
 * two words. `let me` carries a negative lookahead for "know", because "let me
 * know if you want the monthly breakdown" is a courtesy at the end of a real
 * answer, not a plan. No `g` flag: this is shared module state and `test()`
 * would otherwise carry `lastIndex` between calls.
 */
const DATA_STEP_COMMITMENT =
  /(?:\bi['’]?ll\b|\bi\s+will\b|\bi['’]?m\s+going\s+to\b|\bi\s+am\s+going\s+to\b|\bi\s+need\s+to\b|\bi\s+plan\s+to\b|\bi\s+intend\s+to\b|\bi['’]?m\s+about\s+to\b|\bi\s+am\s+about\s+to\b|\blet\s+me\b(?!\s+know)|\blet['’]?s\b|\bnext,?\s+i\b|\bnow\s+i\b|\bthen\s+i\b)(?:\s+\w+){0,2}\s+(?:quer(?:y|ies|ying)|fetch(?:ing)?|retriev\w*|re-?run(?:ning)?|run(?:ning)?|pull(?:ing)?|request(?:ing)?|check(?:ing)?|search(?:ing)?|count(?:ing)?|calculat\w*|comput\w*|analyz\w*|analys\w*|examin\w*|inspect(?:ing)?|compar\w*|aggregat\w*|cross-?\s?referenc\w*|look(?:ing)?\s+(?:at|up|into))\b/i;

/**
 * True when `content` announces work the model has not done rather than
 * answering. An absent or blank message is NOT this: "no answer at all" is a
 * separate condition at the call site, handled by the same path but for its
 * own reason.
 */
export function announcesUnrunWork(content: string | null | undefined): boolean {
  const text = content?.trim();
  if (!text) return false;
  if (text.length >= ANNOUNCEMENT_MAX_CHARS) return false;
  return DATA_STEP_COMMITMENT.test(text);
}

/**
 * The output contract, stated ONCE (#343).
 *
 * The previous wording ("Based on all the data you have collected from the
 * tool calls above, please provide a comprehensive answer to my original
 * question. Summarize the key findings.") asked for an answer but never said
 * that announcing one does not count — which is the exact failure being
 * corrected, so it is now said outright, along with the fact that this turn is
 * the published one.
 *
 * It is the only place this loop tells the model what an answer must be. The
 * abort message below deliberately reports a FACT (a tool call was not run)
 * and says nothing about what to write: two paraphrases of one contract meant
 * editing either gave no reason to look at the other, and the older paraphrase
 * was the wording this one was written to replace.
 *
 * Source identifiers are named by KIND, not by source: this string is the
 * app's own copy and stays free of any particular server's vocabulary.
 */
const FINAL_ANSWER_REQUEST =
  'This is the final turn: no further tool calls will be made, and what you write now is the ' +
  'published answer. Answer my original question using only the data already collected above. ' +
  'Do not describe a query you plan to run or a step you intend to take next — a statement of ' +
  'intent is not an answer. State the findings themselves, and cite the source of each figure ' +
  '(dataset ID, variable DCID plus source dataset, or resource UUID plus dataset title). If the ' +
  'data collected is not enough to answer, say so plainly and state what it does show.';

/**
 * What a `tool_call_id` the loop never ran gets answered with. A statement of
 * fact only — see `FINAL_ANSWER_REQUEST` above for why it says nothing about
 * how to answer.
 *
 * #343 measured the arm this replaces: a `'Token budget exceeded'` variant
 * could never be selected, because the token-limit break can only happen after
 * the assistant turn is already in the transcript with its tool calls already
 * answered by real results, which is exactly the condition under which no
 * abort message is written at all. One live arm, one reachable state.
 */
const UNRUN_TOOL_CALL_NOTE =
  'This tool call was not run: the tool-call limit for this query was reached.';

/**
 * Map a thrown tool-call error onto the notebook's failure vocabulary (#321).
 *
 * `classifyStreamError` is the app's classifier for the same error shapes, so
 * failure is classified ONCE, in one place, rather than re-derived downstream
 * from prose. The mapping is narrowing and deliberately lossy:
 * `ToolFailureKind` describes what a notebook reader needs to know about ONE
 * request, so the six kinds that describe a whole query rather than a single
 * tool call — this app's own rate limit, the two model-credential kinds,
 * notebook execution — collapse into `unknown` rather than being asserted as
 * something more specific than was measured (design-principles.md Principle 3).
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

/**
 * The failure raised for a tool call whose arguments the endpoint sent as
 * something other than valid JSON (#349).
 *
 * The text is this app's own, not the parser's. A `SyntaxError` message quotes
 * the malformed bytes back, and those bytes are endpoint-supplied: routing
 * them through `classifyStreamError` would let them steer the classification,
 * and any of them reaching a `tool` message would put raw text in front of the
 * model. Neither happens — this Error classifies to `generic`/`unknown`, which
 * is the honest answer for "the model sent something we could not read".
 */
function malformedToolArgumentsError(): Error {
  return new Error('The tool call arguments could not be parsed.');
}

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

/**
 * Bound one tool result before it is fed back as context, keeping what is fed
 * back READABLE (#331).
 *
 * A bare JSON array was the only shape this recognised. A paginated envelope —
 * `{"data": [...], "total_rows": N}` — is not an array, so an oversized one
 * fell through to raw character truncation and was cut mid-record: the model
 * received a fragment ending inside a string, with no marker telling it that
 * anything had been dropped, and built its answer on whatever it made of that.
 * Measured on the issue's own 296,028-character envelope: 50,042 characters
 * out, not parseable, no marker.
 *
 * Both structured branches drop whole rows and say so. The envelope branch
 * re-emits the envelope with its other fields intact, so `total_rows` still
 * tells the model how large the matching set upstream was while `data` shows
 * how much of it is actually here.
 *
 * The output contract, for every branch: a body the model can read, followed
 * by one `[Truncated: ...]` line saying what was dropped. The character bound
 * is on the body, not on the marker.
 */
function truncateToolResult(result: string, maxChars: number): string {
  if (result.length <= maxChars) return result;

  try {
    const parsed: unknown = JSON.parse(result);

    if (Array.isArray(parsed) && parsed.length > 0) {
      const kept = keepRowsWithinBudget(parsed, maxChars);
      return `${JSON.stringify(kept)}\n[Truncated: showing ${kept.length} of ${parsed.length} rows]`;
    }

    if (parsed && typeof parsed === 'object') {
      const envelope = parsed as Record<string, unknown>;
      const rows = envelope.data;
      if (Array.isArray(rows) && rows.length > 0) {
        const kept = keepRowsWithinBudget(rows, maxChars);
        return `${JSON.stringify({ ...envelope, data: kept })}\n[Truncated: showing ${kept.length} of ${rows.length} rows]`;
      }
    }
  } catch {
    // Not JSON — fall through to raw truncation
  }

  return result.slice(0, maxChars) +
    `\n[Truncated: result was ${result.length} characters]`;
}

/** How many whole rows fit in the budget, never fewer than five. */
function keepRowsWithinBudget(rows: unknown[], maxChars: number): unknown[] {
  const sampleRow = JSON.stringify(rows[0]);
  const rowSize = (sampleRow ? sampleRow.length : 0) + 2; // comma + newline
  const maxRows = Math.max(5, Math.floor(maxChars / Math.max(rowSize, 1)));
  return rows.slice(0, maxRows);
}

/**
 * Extract `{rows, columns}` from a tool result. Socrata (and any MCP server
 * that paginates) answers with an envelope — `{ data: [...], total_rows: N }`
 * — not a bare array, so a bare-array-only check silently reported nothing for
 * every such call (#322).
 *
 * `rows` is what THIS CALL actually delivered — `data.length` — never
 * `total_rows`. `total_rows` is the size of the matching set upstream; a capped
 * page can return far fewer rows than that, and every downstream reader of
 * `resultSummary.rows` means "how much data flowed through this call," not
 * "how large is the source dataset." Reporting `total_rows` there would claim
 * the model analyzed rows it never saw.
 */
function summarizeToolResult(result: string): { rows: number; columns: number } | undefined {
  try {
    const parsed: unknown = JSON.parse(result);
    const rows: unknown[] | undefined = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).data)
        ? (parsed as Record<string, unknown>).data as unknown[]
        : undefined;

    if (!rows) {
      // Not JSON-parseable as a bare array or a { data: [...] } envelope (e.g.
      // a metadata/metrics payload, or an envelope with no `data` field) —
      // skip, `resultSummary` stays unset.
      return undefined;
    }
    if (rows.length === 0) {
      // A valid, empty result set is a real answer ("no matching records"),
      // not a parse failure — worth distinguishing from the silent-skip cases
      // so a zero-row response is diagnosable rather than indistinguishable
      // from "did not parse."
      return { rows: 0, columns: 0 };
    }
    const firstRow = rows[0];
    if (typeof firstRow === 'object' && firstRow !== null) {
      return { rows: rows.length, columns: Object.keys(firstRow).length };
    }
    // A non-empty array whose elements are not objects (e.g. an array of
    // strings) — not tabular, skip.
    return undefined;
  } catch {
    return undefined;
  }
}

export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const {
    client,
    endpointModel,
    declaredModel = options.endpointModel,
    prompt,
    systemPrompt,
    tools,
    executeToolCall,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    maxTokens = DEFAULT_MAX_TOKENS,
    maxCumulativeTokens,
    maxToolResultChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
    finalTurn = 'blocking',
    passThroughDelivery,
    onDelta,
    onEvent,
    trace,
    logContext = 'model-loop',
  } = options;

  const startTime = Date.now();
  const toolCalls: ToolCallRecord[] = [];
  const emit = (event: LoopEvent) => onEvent?.(event);

  const messages: ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  // First call — check if tools are needed (non-streaming, to see tool_calls)
  let llmSpanId = trace?.builder.startSpan('llm_inference', trace.parentSpanId, {
    'gen_ai.system': getGenAiSystem(),
    'gen_ai.request.model': declaredModel,
    ...(trace.systemPromptHash ? { 'gen_ai.system_prompt_hash': trace.systemPromptHash } : {}),
    'gen_ai.inference_index': 0,
  });
  let response = await client.chat.completions.create({
    model: endpointModel,
    messages,
    tools,
    tool_choice: 'auto',
    max_tokens: maxTokens,
  });
  if (llmSpanId) {
    trace!.builder.endSpan(llmSpanId, {
      'gen_ai.response.prompt_tokens': response.usage?.prompt_tokens || 0,
      'gen_ai.response.completion_tokens': response.usage?.completion_tokens || 0,
      ...responseModelAttributes(declaredModel, response.model, logContext),
    });
  }

  let iterations = 0;
  let cumulativeTokens = response.usage?.total_tokens || 0;
  let cumulativePromptTokens = response.usage?.prompt_tokens || 0;
  let cumulativeCompletionTokens = response.usage?.completion_tokens || 0;
  let tokenLimitExceeded = false;
  /**
   * True when `response`'s message is ALREADY in `messages`. The loop pushes
   * each assistant turn before executing its tools, so the token-limit break
   * below leaves the loop with the final message already in the transcript,
   * its tool calls already answered with real results. The terminal block
   * must not push it a second time: that would duplicate the assistant turn
   * and answer the same `tool_call_id` twice, which is a malformed request.
   */
  let lastMessageAlreadyInTranscript = false;

  // Handle tool calls iteratively
  while (response.choices[0]?.message?.tool_calls && iterations < maxIterations) {
    const assistantMessage = response.choices[0].message;
    const pendingCalls = assistantMessage.tool_calls;
    messages.push(assistantMessage);
    lastMessageAlreadyInTranscript = true;

    if (!pendingCalls) break;

    const currentIteration = iterations + 1;

    for (const toolCall of pendingCalls) {
      if (toolCall.type !== 'function') continue;

      const name = toolCall.function.name;
      /**
       * #349: the parse sits INSIDE the failure path rather than upstream of
       * it. The endpoint chooses these bytes, and an unparseable set used to
       * throw straight out of the loop — past the failure record, past
       * `describeToolFailureForLlm`, ending a query that may already have
       * completed several successful calls. A malformed argument set is now
       * one failed tool call, handled exactly as an unreachable data source
       * is: recorded, described to the model, run continues.
       */
      let argumentsMalformed = false;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch {
        argumentsMalformed = true;
      }

      const operationType = deriveOperationType(name, args);
      const reason = generateToolReason(args);
      // `args` goes onto the record BY REFERENCE and is handed to
      // `executeToolCall` unchanged — see this file's header.
      const toolEntry: ToolCallRecord = { name, args, operationType, reason };
      toolCalls.push(toolEntry);
      const priorCalls = toolCalls.slice(0, -1);
      emit({ type: 'tool_start', iteration: currentIteration, call: toolEntry, priorCalls });

      // Trace: start MCP tool call span.
      // `mcp.source` distinguishes which MCP server handled the call so the
      // PROV-O builder can emit a distinct prov:Agent per source (see
      // provenance.ts). Unknown tools fall back to "unknown".
      const toolSource = trace?.resolveToolSource?.(name) ?? 'unknown';
      const toolTraceSpanId = trace?.builder.startSpan('mcp_tool_call', trace.parentSpanId, {
        'tool.name': name,
        'tool.operation_type': operationType || 'unknown',
        'tool.arguments': JSON.stringify(args),
        'mcp.source': toolSource,
        ...(args.dataset_id ? { 'tool.dataset_id': String(args.dataset_id) } : {}),
        ...(args.portal ? { 'tool.portal_domain': String(args.portal) } : {}),
      });

      try {
        if (argumentsMalformed) throw malformedToolArgumentsError();

        const toolStartTime = Date.now();
        const result = await executeToolCall(name, args);
        const toolDuration = Date.now() - toolStartTime;
        toolEntry.duration_ms = toolDuration;
        toolEntry.resultSummary = summarizeToolResult(result);

        // Trace: end tool call span with response metadata
        if (toolTraceSpanId) {
          trace!.builder.endSpan(toolTraceSpanId, {
            'tool.response_hash': traceHash(result),
            'tool.response_size_bytes': result.length,
            'tool.duration_ms': toolDuration,
            ...(toolEntry.resultSummary ? { 'tool.response_rows': toolEntry.resultSummary.rows } : {}),
          });
        }

        emit({ type: 'tool_complete', iteration: currentIteration, call: toolEntry, priorCalls, durationMs: toolDuration });
        emit({ type: 'tool_result', iteration: currentIteration, call: toolEntry });

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: truncateToolResult(result, maxToolResultChars),
        });
      } catch (error) {
        // #321: record the rejection ON the tool-call entry, here, where it is
        // already known. `toolEntry` was pushed into `toolCalls` before the
        // await, so this mutation reaches every consumer of the record —
        // including the notebook synthesizer, which was rendering this call as
        // an executable fetch cell that then threw on execution. Nothing
        // downstream can recover this fact.
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
          content: describeToolFailureForLlm(name, error),
        });
      }
    }

    // Check the token budget before making the next model call
    if (maxCumulativeTokens !== undefined && cumulativeTokens >= maxCumulativeTokens) {
      tokenLimitExceeded = true;
      emit({ type: 'token_budget_exhausted', cumulativeTokens });
      break;
    }

    emit({ type: 'thinking', iteration: currentIteration });

    llmSpanId = trace?.builder.startSpan('llm_inference', trace.parentSpanId, {
      'gen_ai.system': getGenAiSystem(),
      'gen_ai.request.model': declaredModel,
      'gen_ai.inference_index': currentIteration,
    });
    response = await client.chat.completions.create({
      model: endpointModel,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: maxTokens,
    });
    lastMessageAlreadyInTranscript = false;
    if (llmSpanId) {
      trace!.builder.endSpan(llmSpanId, {
        'gen_ai.response.prompt_tokens': response.usage?.prompt_tokens || 0,
        'gen_ai.response.completion_tokens': response.usage?.completion_tokens || 0,
        ...responseModelAttributes(declaredModel, response.model, logContext),
      });
    }

    cumulativeTokens += response.usage?.total_tokens || 0;
    cumulativePromptTokens += response.usage?.prompt_tokens || 0;
    cumulativeCompletionTokens += response.usage?.completion_tokens || 0;

    iterations++;
  }

  // Trace: start synthesis span (covers final output generation, including a
  // caller's paced delivery of a pass-through answer — which is why the span
  // is opened and closed here rather than around the call to this function).
  const synthesisSpanId = trace?.builder.startSpan('synthesis', trace.parentSpanId);

  const lastMessage = response.choices[0]?.message;
  const pendingToolCalls = lastMessage?.tool_calls;

  // Why this run cannot end on `lastMessage` as it stands. Three reasons, one
  // answering turn — the machinery below already existed, gated on the wrong
  // condition, so this extends that path rather than adding a second.
  //
  // `abortedMidPlan` is the pre-existing reason: a budget stopped the loop
  // instead of the model finishing. It no longer also requires the message to
  // be EMPTY. The old condition led with `!lastMessage?.content`, so a
  // token-limit-exceeded run that happened to carry prose shipped that prose
  // as the answer — mid-run working notes published as a finding, and without
  // even the `token_limit_exceeded` flag that would have banner-ed them,
  // because the content branch never set it (#319).
  //
  // `answeredNothing` is the old else-branch, folded in: an empty final
  // message now gets the same restated contract as every other re-ask instead
  // of a bare re-stream of the same transcript.
  //
  // `announcesUnrunWork` is the one #334 added, and it is why this condition
  // is core behaviour rather than a parameter: a caller able to opt out of it
  // is a caller able to publish an announcement as an answer.
  const abortedMidPlan =
    iterations >= maxIterations || tokenLimitExceeded || Boolean(pendingToolCalls);
  const answeredNothing = !lastMessage?.content?.trim();

  if (abortedMidPlan || answeredNothing || announcesUnrunWork(lastMessage?.content)) {
    // Keep the transcript faithful. The model really did produce this turn,
    // and the re-ask corrects it explicitly; re-asking into a history that no
    // longer contains the turn being corrected would be a silent rewrite, and
    // it would read oddly in the signed trace. Skipped when the loop already
    // pushed this message (see `lastMessageAlreadyInTranscript`) and when
    // there is nothing to push.
    if (!lastMessageAlreadyInTranscript && lastMessage && (lastMessage.content || pendingToolCalls)) {
      messages.push(lastMessage);
    }
    // Only for tool calls the loop did NOT already answer with real results.
    if (pendingToolCalls && !lastMessageAlreadyInTranscript) {
      for (const toolCall of pendingToolCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: UNRUN_TOOL_CALL_NOTE,
        });
      }
    }

    emit({ type: 'answering_turn', tokenLimitExceeded });

    const answeringMessages: ChatCompletionMessageParam[] = [
      ...messages,
      { role: 'user', content: FINAL_ANSWER_REQUEST },
    ];

    let content = '';
    let finalCallTokens = 0;
    let finalPromptTokens = 0;
    let finalCompletionTokens = 0;
    let finalReportedModel: string | undefined;

    if (finalTurn === 'stream') {
      const finalStream = await client.chat.completions.create({
        model: endpointModel,
        messages: answeringMessages,
        max_tokens: maxTokens,
        stream: true,
        ...(includeStreamUsage() ? { stream_options: { include_usage: true } } : {}),
      });

      for await (const chunk of finalStream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          onDelta?.(delta);
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
    } else {
      const finalResponse = await client.chat.completions.create({
        model: endpointModel,
        messages: answeringMessages,
        max_tokens: maxTokens,
      });
      content = finalResponse.choices[0]?.message?.content || '';
      finalReportedModel = finalResponse.model;
      finalCallTokens = finalResponse.usage?.total_tokens || 0;
      finalPromptTokens = finalResponse.usage?.prompt_tokens || 0;
      finalCompletionTokens = finalResponse.usage?.completion_tokens || 0;
    }

    cumulativeTokens += finalCallTokens;
    cumulativePromptTokens += finalPromptTokens;
    cumulativeCompletionTokens += finalCompletionTokens;

    if (synthesisSpanId) {
      trace!.builder.endSpan(synthesisSpanId, {
        'output.hash': traceHash(content),
        'output.length': content.length,
        'gen_ai.response.prompt_tokens': finalPromptTokens,
        'gen_ai.response.completion_tokens': finalCompletionTokens,
        ...responseModelAttributes(declaredModel, finalReportedModel, logContext),
      });
    }

    return {
      content,
      toolCalls,
      usage: {
        promptTokens: cumulativePromptTokens,
        completionTokens: cumulativeCompletionTokens,
        totalTokens: cumulativeTokens,
      },
      durationMs: Date.now() - startTime,
      iterations,
      tokenLimitExceeded,
      streamed: finalTurn === 'stream',
      answeringTurnTaken: true,
    };
  }

  // Everything above returned. What is left is a genuine answer: content the
  // model produced on its own account, that no budget cut short and that does
  // not announce work it has not done. It is published exactly as written,
  // with NO extra model call — the fix for #319 must cost nothing on the
  // common path, which is the great majority of queries.
  const finalContent = lastMessage?.content;
  if (!finalContent) {
    // Unreachable: `answeredNothing` routes a blank final message into the
    // answering turn above, which returns. Kept as a typed refusal rather than
    // a silent fall-through, because a path that reaches the end without
    // producing a result would hang a reader's stream instead of failing
    // visibly. The message never reaches a reader: every caller classifies and
    // sanitizes what it puts on the wire.
    throw new Error('final assistant message had no content after the answering turn');
  }

  emit({ type: 'pass_through' });

  if (passThroughDelivery && onDelta) {
    const { chunkChars, delayMs } = passThroughDelivery;
    for (let i = 0; i < finalContent.length; i += chunkChars) {
      onDelta(finalContent.slice(i, i + chunkChars));
      // Small delay so a reader sees it arrive rather than appear.
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  if (synthesisSpanId) {
    trace!.builder.endSpan(synthesisSpanId, {
      'output.hash': traceHash(finalContent),
      'output.length': finalContent.length,
    });
  }

  return {
    content: finalContent,
    toolCalls,
    // cumulativeTokens already includes this response's tokens from the loop
    usage: {
      promptTokens: cumulativePromptTokens,
      completionTokens: cumulativeCompletionTokens,
      totalTokens: cumulativeTokens,
    },
    durationMs: Date.now() - startTime,
    iterations,
    tokenLimitExceeded,
    streamed: Boolean(passThroughDelivery && onDelta),
    answeringTurnTaken: false,
  };
}
