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
 * `args`. The object recorded on the tool-call entry is the SAME object the
 * `portal` option is injected into and the SAME object handed to
 * `executeToolCall`, and the recorded arguments — which reach a signed
 * package and the replay identity key — must show what was actually sent.
 * Cloning or freezing here changes those recorded arguments with nothing in
 * the diff pointing at the cause. `run-tool-loop.test.ts` holds a probe on
 * the identity, and a caller may still inject a field of its own inside its
 * `executeToolCall` closure on the same terms.
 *
 * WHAT MOVED IN, AND WHY (#359, #352). Portal injection and the per-tool-call
 * timeout used to live in every caller's `executeToolCall` closure — four
 * copies in `src/`, three different timeout shapes, one of which did not
 * exist. Injection there runs AFTER this loop has already built the record,
 * emitted `tool_start` and opened the `mcp_tool_call` span, so the span
 * serialised arguments the caller was about to change: `tool.portal_domain`
 * was absent on exactly the calls the portal was injected into, while the
 * signed record carried it. Both are now options — injection happens above
 * the record, the timer is cleared in one `finally` — because neither is a
 * caller concern: what differs between callers is the value, not the rule.
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
  /**
   * The source rejected the call (#384 P8, F2). `call` already carries
   * `failed`/`failureKind` — set at the catch site before this is emitted —
   * and `durationMs` is the time until the rejection. A distinct variant, not
   * `tool_complete` with a flag: "complete" is a claim, and a renderer's
   * exhaustive switch cannot compile until it says what a rejection looks
   * like. Until this existed the catch site recorded the failure and emitted
   * nothing, so no reader of these events could know the call had ended.
   */
  | { type: 'tool_failed'; iteration: number; call: ToolCallRecord; priorCalls: ToolCallRecord[]; durationMs: number; failureKind: ToolFailureKind }
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
   * The tool transport: source routing, and whatever else a caller still owns
   * about reaching a server. Portal injection and the per-call timeout are NOT
   * among them any more — they are the two options below. Receives the SAME
   * args object the record holds — see the constraint in this file's header.
   */
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;
  /**
   * Default portal for a Socrata `get_data` call whose arguments omit one.
   * Injected into the SAME args object the record holds, BEFORE the record,
   * the `tool_start` event and the `mcp_tool_call` span are built (#359), so
   * every consumer of the call sees what was actually sent.
   * Omitted = no injection; the loop passes arguments through untouched.
   */
  portal?: string;
  /**
   * Per-tool-call timeout in milliseconds. The call is raced against it and
   * the timer is cleared in a `finally`, once, here (#352).
   * Omitted = unbounded, the same idiom `maxCumulativeTokens` above uses.
   */
  toolTimeoutMs?: number;
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
 * Race one tool call against its bound, and clear the timer in a `finally` —
 * once, here (#352).
 *
 * Three shapes of this existed on the caller side and only one of them was
 * right: `replay-loop.ts` cleared in a `finally`, `compare-stream/route.ts`
 * and `query-notebook/route.ts` armed a 45-second timer per tool call and
 * never cleared it (a call that answered in 200 ms left a timer holding the
 * event loop for the rest of the bound), and `/api/compare` had no bound at
 * all. The timer is a property of making a bounded call, not of being a
 * particular caller, so it lives with the call.
 *
 * No bound is `undefined`, not a number: a default here would hand every
 * caller a ceiling it never chose and make "unbounded" inexpressible.
 *
 * The message keeps the wording every caller-side copy used, because
 * `classifyStreamError` reads it — "timed out" is what makes the recorded
 * failure `timeout` rather than `unknown`. It never reaches a reader or the
 * model: `describeToolFailureForLlm` restates it (#154).
 */
async function boundToolCall(
  call: Promise<string>,
  name: string,
  timeoutMs: number | undefined,
): Promise<string> {
  if (timeoutMs === undefined) return call;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`MCP tool "${name}" timed out after ${timeoutMs / 1000}s`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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
 * The token counts an endpoint actually reported, as span attributes — and
 * NOTHING when it reported none (#312).
 *
 * The trace goes INSIDE the signed record package, so `prompt_tokens: 0` on a
 * call the endpoint said nothing about is a false statement under a signature:
 * it asserts that zero tokens were consumed — a measurement — when the truth
 * is that no measurement was taken. Wave N4 P3 fixed exactly this one layer up
 * for `cost.promptTokens` (`packager.ts`: "Zero is not a measurement… Absent
 * usage is now absent"), which left a package able to carry `cost` with the
 * counts correctly absent while the span beside it claimed zero. This is that
 * same rule, on the span.
 *
 * OMISSION MEANS THE KEY IS NEVER BUILT — not that its value is `undefined`.
 * `TraceBuilder` turns an attribute record into an ARRAY of `{key, value}`
 * pairs via `Object.entries`, so a key whose value is `undefined` does not
 * disappear the way an object property would: it survives as
 * `{"key":"gen_ai.response.prompt_tokens","value":{}}`, measured, and the JCS
 * canonicalizer keeps it, because the only thing it drops is the `undefined`
 * INSIDE the value object. A valueless attribute under the signature is worse
 * than the zero it replaced. Hence the conditional spread: the key exists only
 * when there is a number to put in it.
 *
 * A GENUINE ZERO IS STILL A MEASUREMENT, so the test is presence, not truth.
 * A falsy check here would erase an endpoint that really did report
 * `prompt_tokens: 0` — the same defect pointing the other way.
 * `Number.isFinite` is the outer bound: a count arriving as a string, a `NaN`
 * or an `Infinity` is not a measurement either, and `"NaN"` asserted in a
 * signed trace is the failure this function exists to prevent.
 *
 * The two counts are independent. An endpoint reporting one and not the other
 * gets one attribute — not two, and not none.
 *
 * Deliberately not exported. The loop is the only thing that builds these
 * spans, and the acceptance suite asserts the property over the trace the real
 * loop finalizes rather than over this function's return value: a helper that
 * is right in isolation and called at two of three sites is exactly the shape
 * #312 was in.
 */
function responseTokenAttributes(
  usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined,
): Record<string, number> {
  const promptTokens = reportedCount(usage?.prompt_tokens);
  const completionTokens = reportedCount(usage?.completion_tokens);
  return {
    ...(promptTokens !== undefined ? { 'gen_ai.response.prompt_tokens': promptTokens } : {}),
    ...(completionTokens !== undefined ? { 'gen_ai.response.completion_tokens': completionTokens } : {}),
  };
}

/**
 * One token count as the endpoint reported it, or `undefined` if it reported
 * none. The single place this module decides what counts as "reported" — see
 * `responseTokenAttributes` above for why the bound is `Number.isFinite` and
 * not truthiness.
 */
function reportedCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Bound one tool result before it is fed back as context, keeping what is fed
 * back READABLE (#331) and keeping it INSIDE THE BUDGET (#355).
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
 * is on the body, not on the marker — and the marker appears only when rows
 * were actually dropped.
 *
 * WHY THE BOUND IS MEASURED ON THE ASSEMBLED STRING. The first version of the
 * row-dropping branch sized the kept-row count from `rows[0]` alone. Socrata's
 * SODA JSON omits the columns a record has no value for, so a sparse record at
 * the head of a page of full ones is an ordinary response — and it made every
 * row look that small. Measured at `45aa6c0` with a 50,000-character budget on
 * a 3,000-row page with one 62-character first row and 569-character rows
 * after it: 444,691 characters fed back, 8.9 times the budget. Sizing against
 * a sample can only ever be right for the one shape the sample matches.
 */
function truncateToolResult(result: string, maxChars: number): string {
  if (result.length <= maxChars) return result;

  try {
    const parsed: unknown = JSON.parse(result);

    if (Array.isArray(parsed) && parsed.length > 0) {
      const bounded = boundedRows(parsed, maxChars, (kept) => JSON.stringify(kept));
      if (bounded !== undefined) return bounded;
    } else if (parsed && typeof parsed === 'object') {
      const envelope = parsed as Record<string, unknown>;
      const rows = envelope.data;
      if (Array.isArray(rows) && rows.length > 0) {
        const bounded = boundedRows(rows, maxChars, (kept) =>
          JSON.stringify({ ...envelope, data: kept }),
        );
        if (bounded !== undefined) return bounded;
      }
    }
  } catch {
    // Not JSON — fall through to raw truncation
  }

  return result.slice(0, maxChars) +
    `\n[Truncated: result was ${result.length} characters]`;
}

/**
 * One bounded body plus, if and only if rows were dropped, the marker saying
 * so — or `undefined` when even zero rows will not fit, which sends the caller
 * to raw truncation rather than letting the bound break.
 *
 * THE MARKER IS CONDITIONAL BECAUSE IT IS A CLAIM. A result can exceed the
 * budget as it arrives and fit once re-serialised — a pretty-printed page is
 * the ordinary case — and the earlier version announced `showing 300 of 300
 * rows` on exactly that input. A model told rows were dropped may caveat a
 * complete answer, or spend another call re-querying data it already has.
 */
function boundedRows(
  rows: unknown[],
  maxChars: number,
  render: (kept: unknown[]) => string,
): string | undefined {
  const kept = keepRowsWithinBudget(rows, maxChars, render);
  const body = render(kept);
  if (body.length > maxChars) return undefined;
  if (kept.length === rows.length) return body;
  return `${body}\n[Truncated: showing ${kept.length} of ${rows.length} rows]`;
}

/**
 * The longest leading run of `rows` whose RENDERED body fits `maxChars`.
 *
 * `render` assembles the body the model will actually receive — the bare array
 * or the whole envelope — so the framing and the envelope's other fields are
 * counted, not estimated. Its length grows monotonically with the number of
 * rows, which is what makes the search below valid.
 *
 * The search doubles and then bisects, so its cost tracks the number of rows
 * KEPT rather than the number received: a 200,000-row page that yields 90 rows
 * renders a few hundred rows, not 200,000.
 *
 * ZERO ROWS IS A REAL ANSWER, not a failure. When one row does not fit the
 * budget the model is handed the envelope with an empty `data`, its
 * `total_rows` intact and `showing 0 of N rows`, which is a signal it can act
 * on — narrow the query, ask for fewer columns. The version this replaces kept
 * a floor of five rows that could exceed the budget by any factor, and a floor
 * that breaks the bound is not a floor, it is the defect.
 */
function keepRowsWithinBudget(
  rows: unknown[],
  maxChars: number,
  render: (kept: unknown[]) => string,
): unknown[] {
  const fits = (count: number) => render(rows.slice(0, count)).length <= maxChars;

  if (fits(rows.length)) return rows;

  // Double until a count does not fit; `low` is the largest count known to fit.
  let low = 0;
  let high = 1;
  while (high < rows.length && fits(high)) {
    low = high;
    high *= 2;
  }
  if (high > rows.length) high = rows.length;

  // Bisect (low, high): low fits, high does not.
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return rows.slice(0, low);
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
    portal,
    toolTimeoutMs,
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
      ...responseTokenAttributes(response.usage),
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
        const parsed: unknown = JSON.parse(toolCall.function.arguments);
        if (parsed !== null && typeof parsed === 'object') {
          args = parsed as Record<string, unknown>;
        } else {
          // `null`, a number, a bare string: valid JSON that is not an
          // argument set. It parses and then breaks the first reader that
          // touches a property, which is the same failure one step later.
          argumentsMalformed = true;
        }
      } catch {
        argumentsMalformed = true;
      }

      /**
       * Portal injection, ABOVE everything that reads or serialises `args`
       * (#359). Four callers used to do this inside their `executeToolCall`
       * closure, which the loop invokes below — after the record, after
       * `tool_start`, and thirteen lines after the span stringified `args`.
       * The span therefore reported no `tool.portal_domain` on precisely the
       * calls a portal had been injected into, while the signed package
       * (`packager.ts`) and the replay identity key read the mutated object
       * and did carry it. One site above the record makes the two agree by
       * construction, for every caller, instead of four sites agreeing by
       * luck.
       *
       * `!argumentsMalformed` is load-bearing and is NEW here. A caller's
       * closure never ran on a malformed argument set, because the throw
       * below precedes `executeToolCall`. Injection at this height does run,
       * on the `{}` the failed parse left behind — so without this clause a
       * call whose arguments never parsed would be recorded, spanned and
       * SIGNED carrying a portal it never had. The move creates the exposure;
       * the clause closes it.
       *
       * `name === 'get_data'` stays literal and must not widen to a source
       * lookup. The data-source server does implement `search` and `fetch`,
       * but their input schemas are `additionalProperties: false` with no
       * portal property, so an injected portal would be stripped upstream and
       * would still corrupt the recorded arguments that feed the signed
       * package and the replay identity key.
       *
       * KNOWN LATENT DIVERGENCE, named here because the trigger is
       * foreseeable. The data-source server treats `portal` as an alias for
       * `domain` and resolves them as `domain || portal` — `domain` WINS.
       * This guard looks only at `portal`. So a `get_data` call that supplied
       * `domain` and omitted `portal` would receive an injected portal the
       * server then ignores, and that ignored value would still reach
       * `tool.arguments`, `tool.portal_domain`, the signed package and the
       * replay identity key: a signed record asserting a portal that was not
       * queried. It cannot fire today — this instance's `get_data` schema
       * advertises no `domain` property, so a model cannot supply one — and
       * the guard is deliberately left byte-identical rather than widened to
       * a condition no test could exercise. It becomes live the moment
       * `src/lib/mcp/tools.ts` gains a `domain` property on `get_data`;
       * whoever adds one owes this guard a second look.
       */
      if (portal && !argumentsMalformed && name === 'get_data' && !args.portal) args.portal = portal;

      const operationType = deriveOperationType(name, args);
      const reason = generateToolReason(args, name);
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

      // Started outside the `try`, so the time until a rejection is measured
      // the same way as the time until a result (#384 P8).
      const toolStartTime = Date.now();
      try {
        if (argumentsMalformed) throw malformedToolArgumentsError();

        const result = await boundToolCall(executeToolCall(name, args), name, toolTimeoutMs);
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
        const failureKind = toolFailureKindOf(error);
        toolEntry.failed = true;
        toolEntry.failureKind = failureKind;
        // #404: the span states the CLASSIFIED kind, never the cause. A
        // rejection's raw text is authored by the source, not by this app —
        // it can name a host, a port, a query fragment or a stack frame — and
        // the trace goes INLINE into the package (`packager.ts` assigns
        // `trace: input.trace`), so anything written here is inside the bytes
        // this instance signs, forever, in a record whose whole purpose is
        // that a reader can trust what it asserts. This is CLAUDE.md's rule
        // ("never render a raw `err.message` in a streaming path") one layer
        // down: reader-facing text goes through `friendlyStreamError`,
        // model-facing text through `describeToolFailureForLlm`, and the
        // record — the only one of the three that is permanent — carries
        // `failureKind`, the same value written onto `toolEntry` two lines
        // above. `error.kind` is the attribute name agreed across this
        // repository and the harness (Wave N10 D5): the PROV-O builder reads
        // `error` and `error.kind` to mark the activity for a rejected call.
        // Do not add a second name, and do not reintroduce the raw text —
        // if a consumer needs more than the four `ToolFailureKind` values,
        // the vocabulary widens rather than the span carrying prose.
        if (toolTraceSpanId) {
          trace!.builder.endSpan(toolTraceSpanId, {
            'error': true,
            'error.kind': failureKind,
          });
        }
        // #384 P8 (F2): the rejection is REPORTED, not only recorded. The two
        // fields above reach every reader of the record; this event reaches
        // every reader of the stream — the progress wire, the trace capture,
        // the replay, the cards — which until now saw the call start and
        // never end.
        emit({
          type: 'tool_failed',
          iteration: currentIteration,
          call: toolEntry,
          priorCalls,
          durationMs: Date.now() - toolStartTime,
          failureKind,
        });
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
        ...responseTokenAttributes(response.usage),
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
    /**
     * `undefined` until an endpoint says otherwise — the whole of #312's
     * second mechanism (this phase's C1). These were `0`-initialised numbers,
     * and `0` arriving from "never set" is indistinguishable from `0` arriving
     * from "the endpoint reported zero". The synthesis span is the answering
     * turn — the one that produces the PUBLISHED answer — so that is the span
     * where the difference matters most, and a grep for the `|| 0` shape at
     * the other two sites could not see it.
     *
     * `finalCallTokens` stays a `0`-initialised number on purpose: it is
     * summed into `cumulativeTokens`, and "absent contributes nothing to a
     * sum" is the correct semantic for a total. Only the two counts that
     * become span ATTRIBUTES need to distinguish absent from zero.
     */
    let finalPromptTokens: number | undefined;
    let finalCompletionTokens: number | undefined;
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
        // Last REPORTED value wins, on each count independently — the same
        // rule as `chunk.model` above. The truthy guards this replaces made a
        // genuine `prompt_tokens: 0` indistinguishable from a chunk that
        // carried no count at all, which is #312 in the direction that erases
        // a real measurement rather than inventing one. `reportedCount` keeps
        // the old guard's one useful effect — a `NaN` never lands — while
        // admitting the zero.
        if (chunk.usage) {
          finalCallTokens = reportedCount(chunk.usage.total_tokens) ?? finalCallTokens;
          finalPromptTokens = reportedCount(chunk.usage.prompt_tokens) ?? finalPromptTokens;
          finalCompletionTokens = reportedCount(chunk.usage.completion_tokens) ?? finalCompletionTokens;
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
      finalCallTokens = reportedCount(finalResponse.usage?.total_tokens) ?? 0;
      finalPromptTokens = reportedCount(finalResponse.usage?.prompt_tokens);
      finalCompletionTokens = reportedCount(finalResponse.usage?.completion_tokens);
    }

    cumulativeTokens += finalCallTokens;
    cumulativePromptTokens += finalPromptTokens ?? 0;
    cumulativeCompletionTokens += finalCompletionTokens ?? 0;

    if (synthesisSpanId) {
      trace!.builder.endSpan(synthesisSpanId, {
        'output.hash': traceHash(content),
        'output.length': content.length,
        ...responseTokenAttributes({
          prompt_tokens: finalPromptTokens,
          completion_tokens: finalCompletionTokens,
        }),
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
