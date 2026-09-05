// Types for streaming events
import { deriveOperationType } from './mcp/operation-types.ts';
import type { ToolFailureKind } from './notebook-author/tool-to-cell.ts';
export type StreamEventType = 'progress' | 'token' | 'complete' | 'error' | 'trace';
export type PanelType = 'withMcp' | 'withoutMcp';

export interface StreamEvent {
  type: StreamEventType;
  panel: PanelType;
  data?: unknown;
}

export type ProgressPhase = 'analyze' | 'tool_start' | 'tool_complete' | 'tool_result' | 'thinking' | 'synthesize';

export interface ProgressEvent extends StreamEvent {
  type: 'progress';
  message: string;
  duration_ms?: number;
  phase?: ProgressPhase;
  iteration?: number;
  args?: Record<string, unknown>;
  /**
   * The tool the loop recorded for a `tool_start` / `tool_complete` /
   * `tool_result` event (`ToolCallRecord.name`), and the operation type it
   * derived once (`ToolCallRecord.operationType`; absent when the loop derived
   * none — `fetch`, by design). Before #384 the stream carried neither, so
   * every reader downstream inferred the tool from `args.type`, which only
   * `get_data` carries, and the replay wrote `get_data` for every call. No
   * reader derives these a second time; a reader that has neither says so
   * rather than guessing.
   */
  toolName?: string;
  operationType?: string;
  /**
   * The loop recorded the call as rejected (#384 P8, F2). Carried on the
   * call's end event (phase `tool_complete`, the one every consumer pairs to
   * its `tool_start`) and on the outcome event that follows it (phase
   * `tool_result`, whose message is the outcome formatter's sentence). Absent
   * on every event of a call that was answered — absent is absent.
   */
  failed?: boolean;
  failureKind?: ToolFailureKind;
}

export interface TokenEvent extends StreamEvent {
  type: 'token';
  content: string;
}

export interface CompleteEvent extends StreamEvent {
  type: 'complete';
  data: {
    content: string;
    duration_ms: number;
    // #374: absent, not `0`, when the endpoint reported no usage total.
    tokens_used?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    token_limit_exceeded?: boolean;
    /**
     * The loop's tool-call records, verbatim (`ToolCallRecord`): a call the
     * source rejected carries `failed`/`failureKind` here exactly as the loop
     * recorded them (#384, F5). This list is what the publish dialog posts,
     * so what this type names is what a consumer can read and the package
     * can carry; absent means the call was not recorded as failed.
     */
    tools_called?: {
      name: string;
      args: Record<string, unknown>;
      resultSummary?: { rows: number; columns: number };
      duration_ms?: number;
      operationType?: string;
      reason?: string;
      failed?: boolean;
      failureKind?: ToolFailureKind;
    }[];
  };
}

/**
 * Machine-readable code for model-credential failures (issue #178). Set by the
 * server on `error` events so the client can render distinct,
 * operator-actionable copy without parsing message strings:
 * - `model_not_configured` — no credential in the environment; detected before
 *   any upstream call.
 * - `model_auth_rejected` — a credential exists but the model endpoint refused
 *   it (401/403).
 * - `model_rate_limited` — the model endpoint is rate-limiting this instance
 *   (429). Distinct from `rate_limit`, which is this app's OWN per-day request
 *   limiter (website#30 G0 D6). Both are "429" somewhere, and conflating them
 *   tells a reader they personally hit a daily cap they did not hit.
 */
export type ModelErrorCode =
  | 'model_not_configured'
  | 'model_auth_rejected'
  | 'model_rate_limited';

/**
 * The value set the `code` field of an `error` event may carry.
 *
 * It began as the three typed pre-flight configuration refusals
 * (`model_not_configured`, `model_auth_rejected` from #178,
 * `mcp_not_configured` from #258 C4). Since #154 it is the full
 * `StreamErrorKind` set: the server classifies every streaming failure once
 * and puts the resulting kind on the wire, which is what lets the `message`
 * field carry reader-facing copy instead of raw error text. This is the app's
 * own streaming wire and carries no protocol vocabulary, so widening the
 * accepted value set renames nothing; every consumer already treats `code` as
 * optional and unrecognized values fall through to message-shape matching.
 */
export type StreamErrorCode = StreamErrorKind;

export interface ErrorEvent extends StreamEvent {
  type: 'error';
  message: string;
  code?: StreamErrorCode;
}

// --- Friendly error copy -----------------------------------------------------
//
// Streaming failures (an unavailable or slow MCP data source, a dropped
// connection, a rate-limit response) must never surface raw error strings,
// status codes, or server names to the reader. These helpers classify any
// error shape into a small set of kinds and map each kind to calm, plain
// user-language copy (design-principles.md P9: "data source", "AI"; no
// implementation jargon; no new trust/status vocabulary). They are the single
// place error-to-copy mapping lives, consumed by every SSE-consuming hook.

/**
 * The ten kinds every streaming failure classifies into. Single-sourced as
 * an array rather than a bare union so the round-trip test can enumerate them
 * (#154): an eleventh kind is covered by that test the moment it is added here.
 *
 * `notebook_execution` (#271) is set explicitly by the server — never derived
 * from message-shape matching below — because its reader-facing copy carries
 * a per-failure correlation id and exit code that no static string can hold.
 *
 * `rate_limit` and `model_rate_limited` are two different limiters and are
 * deliberately two kinds (website#30 G0 D6). `rate_limit` is THIS APP's per-day
 * request budget (`src/lib/rate-limit.ts`), which the query routes answer with
 * their own HTTP 429; `model_rate_limited` is the model endpoint refusing this
 * server. Their copy differs because the reader's next move differs: one is
 * "sign in, or come back tomorrow", the other is "this is not about you, try
 * again shortly".
 */
export const STREAM_ERROR_KINDS = [
  'rate_limit',
  'model_rate_limited',
  'model_not_configured',
  'model_auth_rejected',
  'mcp_not_configured',
  'mcp_timeout',
  'mcp_unavailable',
  'connection',
  'notebook_execution',
  'generic',
] as const;

export type StreamErrorKind = (typeof STREAM_ERROR_KINDS)[number];

/** True for a value that is one of the ten kinds (an unknown code is not). */
export function isStreamErrorKind(value: unknown): value is StreamErrorKind {
  return typeof value === 'string' && (STREAM_ERROR_KINDS as readonly string[]).includes(value);
}

/** Pull a lowercased message string out of any error-ish input. */
function errorMessageOf(input: unknown): string {
  if (input instanceof Error) return input.message;
  if (typeof input === 'string') return input;
  if (input !== null && typeof input === 'object' && 'message' in input) {
    const m = (input as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

/**
 * Classify an error (an `Error`, an SSEError-like object with `status`, a raw
 * message string, or an SSE `error`-event object) into a `StreamErrorKind`.
 * Order matters: an explicit typed `code` first (server-declared, never
 * guessed from text), then rate-limit (status or text), then the more specific
 * MCP timeout before the broader MCP-unavailable, then generic connection.
 */
export function classifyStreamError(input: unknown): StreamErrorKind {
  if (input !== null && typeof input === 'object' && 'code' in input) {
    const code = (input as { code?: unknown }).code;
    // Any kind, not just the three configuration-refusal codes this branch
    // started with (#154). The server classifies once and carries the kind, so
    // a payload that has one is never re-derived from its own prose — which
    // would silently downgrade the kinds whose reader-facing copy was written
    // for readers rather than for the matchers below.
    if (isStreamErrorKind(code)) return code;
  }

  const status =
    input !== null && typeof input === 'object' && 'status' in input
      ? (input as { status?: unknown }).status
      : undefined;
  // website#30 P4 (G0 D6): `rate_limit` here, NOT `model_rate_limited`, and the
  // split is structural rather than a guess. An upstream 429 is an SDK
  // `APIError` thrown server-side, and `classifyModelError` (model-client.ts)
  // classifies it before this function is ever reached — see
  // `reportStreamFailure`. What still arrives here carrying a 429 is this app's
  // OWN limiter answering a request: the query routes reply
  // `{ error: 'Rate limit exceeded', rateLimit }` with HTTP 429, `sse-client.ts`
  // turns that into an `SSEError` with `status: 429`, and the client classifies
  // it here. Two limiters, two paths, two kinds — a reader is told which one
  // stopped them.
  if (status === 429) return 'rate_limit';

  // --- Fallback: matching the shape of the message text --------------------
  // Secondary by design since #154, never the primary path for a payload that
  // carries a kind — but still load-bearing, not vestigial. It runs for every
  // input with no `code`: an `Error` thrown client-side, an `SSEError` built
  // from a non-2xx JSON body, a raw error handed to `describeToolFailureForLlm`
  // server-side, and — during a rollout — a browser still running the previous
  // bundle, whose narrower code branch recognizes only the three configuration
  // refusals and reads the message for the rest. That client renders calm copy
  // in every case (it is now matching against reader-facing copy, not raw
  // text); two of the eight kinds land on the generic message until it
  // reloads.
  // -------------------------------------------------------------------------
  const m = errorMessageOf(input).toLowerCase();
  if (!m) return 'generic';

  // Also `rate_limit` rather than `model_rate_limited`, for the same reason as
  // the status branch above plus one more: message text cannot tell the two
  // limiters apart. "Rate limit exceeded" is this app's own wording; an
  // upstream 429's wording varies by endpoint and never reaches here anyway,
  // having been classified structurally upstream of this fallback. Guessing
  // `model_rate_limited` from prose would misattribute the app's own limit to
  // the model service in exactly the cases where the reader has no other signal.
  if (m.includes('rate limit') || m.includes('429')) return 'rate_limit';
  // Message-shape fallback for the typed configuration failures, for paths
  // that carry only a message (e.g. a JSON error body rethrown as an Error).
  if (m.includes('no model api key') || m.includes('missing credentials')) return 'model_not_configured';
  if (m.includes('invalid api key') || m.includes('incorrect api key')) return 'model_auth_rejected';
  if (m.includes('socrata_mcp_url')) return 'mcp_not_configured';
  if (m.includes('timed out') || m.includes('timeout') || m.includes('did not respond within')) return 'mcp_timeout';
  if (
    m.includes('unavailable') ||
    m.includes('initialization failed') ||
    m.includes('mcp server') ||
    m.includes('mcp tool') ||
    m.includes('econnrefused') ||
    m.includes('enotfound') ||
    m.includes('fetch failed') ||
    m.includes('502') ||
    m.includes('503') ||
    m.includes('504')
  ) {
    return 'mcp_unavailable';
  }
  if (
    m.includes('failed to connect') ||
    m.includes('no response body') ||
    m.includes('network') ||
    m.includes('connection')
  ) {
    return 'connection';
  }
  return 'generic';
}

const FRIENDLY_STREAM_COPY: Record<StreamErrorKind, string> = {
  // THIS APP's own per-day budget — the reader's own allowance, and the only
  // one of the two limits they can do anything about.
  rate_limit: 'You’ve reached today’s request limit. Sign in for more requests, or try again tomorrow.',
  // The MODEL SERVICE's limit, which has nothing to do with the reader's
  // allowance (website#30 G0 D6). Saying so explicitly is the point: without
  // this kind, every upstream limit told a reader they had hit a daily cap they
  // had not hit. No retry time is promised — nothing here knows one, and
  // inventing a number would be false precision (design-principles P3).
  model_rate_limited:
    'The AI model service is limiting how many requests this server can make right now, so this query couldn’t run. This is not your own daily limit — please try again shortly.',
  // The two credential kinds are deliberately operator-actionable (they name
  // the env var): they only appear on self-hosted instances with a broken
  // configuration, where the reader is the person who can fix it (#178).
  // They name `MODEL_API_KEY`, the canonical variable since website#30 P1.
  // `OPENROUTER_API_KEY` still works and is named only where a key demonstrably
  // already exists — telling an operator whose key lives under the prior-era
  // name to check a variable they never set would send them the wrong way.
  model_not_configured:
    'This server has no AI model API key configured, so queries can’t run. If you operate this instance, set MODEL_API_KEY in the server environment and restart.',
  model_auth_rejected:
    'The AI model service rejected this server’s API key, so the query couldn’t run. If you operate this instance, check that the key in MODEL_API_KEY — or in its still-accepted prior-era name OPENROUTER_API_KEY — is valid for the endpoint this instance is configured to call.',
  // Same operator-actionable register as the two credential kinds: this only
  // appears on an instance with no data-source endpoint configured, where the
  // reader is the person who can fix it. There is deliberately no fallback
  // host to route through instead (#258 C4).
  mcp_not_configured:
    'This server has no live data source configured, so queries can’t run. If you operate this instance, set SOCRATA_MCP_URL in the server environment and restart.',
  mcp_timeout:
    'The live data source took too long to respond, so this query couldn’t finish. Try again in a moment, or narrow the question (for example, add a date range).',
  mcp_unavailable:
    'The live data source is temporarily unavailable, so this query couldn’t be completed. Please try again shortly.',
  connection: 'The connection was interrupted before the response finished. Please try again.',
  // Static fallback only — used when a wire payload carries this kind's code
  // without the correlation id (a stale client, or the rollout-window /
  // message-shape fallback tested below). The normal path builds copy with
  // `notebookExecutionErrorMessage()` instead, so a reader can actually trace
  // the failure back to its server log line (#271).
  notebook_execution: 'The notebook could not finish running. Please try again.',
  generic: 'Something went wrong while running this query. Please try again in a moment.',
};

/** Map any streaming error into calm, reader-facing copy. Never leaks raw text. */
export function friendlyStreamError(input: unknown): string {
  return FRIENDLY_STREAM_COPY[classifyStreamError(input)];
}

/**
 * Reader-facing copy for a `/api/models` load failure (#283) — covers both a
 * failed fetch/JSON parse and a 200 response whose body doesn't carry a
 * usable `models` array. Both are the same class of failure to the reader
 * (the model list didn't load), so both route through this one message
 * rather than a raw error or a silent render crash.
 *
 * The send/run control is withdrawn rather than the model picker (where one
 * exists) being marked invalid, per docs/design-principles.md Principle 3
 * and its corollary (a list that failed to load is not a bad selection).
 *
 * Cross-cutting per this file's own rule (CLAUDE.md): shared by every surface
 * that needs an offered model id to submit a query and has nothing to
 * substitute when the catalog can't be read — `QueryForm` (#283, website#30
 * P4) and `/explore`'s live-query form (website#30 P7, which found the
 * identical defect: a cached failed fetch poisoning every later click).
 */
export const MODELS_LOAD_ERROR =
  "Couldn't load the list of AI models this site offers, so a query can't be sent right now. Refresh the page to try again.";

/**
 * Server-side: the sanitized `error`-event payload for an already-classified
 * failure. The message is the reader-facing copy and the code is the kind, so
 * the raw error text never leaves the server (#154) while the render side
 * receives the kind as data instead of re-deriving it from prose. The raw
 * error still goes to the server log, which is where an operator reads it.
 */
export function streamErrorPayload(kind: StreamErrorKind): { message: string; code: StreamErrorCode } {
  return { message: FRIENDLY_STREAM_COPY[kind], code: kind };
}

/**
 * Reader-facing copy for a notebook execution failure (#271). The disclosure
 * ruling: the sandbox's stderr is a debugging surface, not a reader surface —
 * it is logged server-side in full (see `route.ts`'s catch block) but never
 * put on the wire. What the reader gets instead is the exit code (already
 * plain, non-sensitive) and a correlation id that ties their report back to
 * that server log line.
 *
 * Deliberately takes only these two typed, non-sensitive values as
 * parameters — never a free-text message or the stderr itself — so the copy
 * can never carry raw infrastructure text by construction, not just by
 * convention.
 */
export function notebookExecutionErrorMessage(
  exitCode: number | undefined,
  correlationId: string,
): string {
  const exit = typeof exitCode === 'number' ? exitCode : 'n/a';
  return `Notebook execution failed (exit ${exit}). Reference: ${correlationId}. Try again, or include this reference if you report the problem.`;
}

/**
 * Server-side: the neutral text fed back to the model when an MCP tool call
 * fails, in place of the raw `Error executing tool: <message>` string. It (1)
 * preserves the anti-hallucination guard (the model must not invent values to
 * fill the gap), and (2) instructs the model to tell the user plainly that the
 * live data couldn't be retrieved, without echoing raw error text, status
 * codes, or server names into the answer.
 */
export function describeToolFailureForLlm(_toolName: string, input: unknown): string {
  const preamble =
    'This data request returned no data. Do not estimate, guess, or fabricate any values to fill the gap.';
  const tellUser = (detail: string) =>
    `${preamble} ${detail} In your answer, briefly tell the user in plain language that the live data could not be retrieved, and do not include any raw error text, status codes, server names, or system details.`;

  switch (classifyStreamError(input)) {
    case 'mcp_timeout':
      return tellUser(
        'The live data source did not respond in time and the request timed out. Suggest trying again or narrowing the query (for example, adding a date range).',
      );
    case 'mcp_unavailable':
      return tellUser('The live data source is temporarily unavailable. Suggest trying again shortly.');
    case 'mcp_not_configured':
      // Backstop only: the routes refuse up front when no data source is
      // configured (#258 C4), but if a tool call still fires the model must
      // relay honest absence, not raw configuration detail.
      return tellUser(
        'This server has no live data source configured, so no data can be retrieved. Suggest contacting whoever operates this instance.',
      );
    default:
      return tellUser('The request could not be completed. Suggest trying again.');
  }
}

/**
 * The operation type a reader-facing formatter switches on: the one the loop
 * recorded when the record carries it, else the loop's own derivation from
 * the recorded name and arguments (`deriveOperationType` — the single
 * derivation, not a second one), else nothing. A call with no name and no
 * `args.type` has no operation type; the formatters say so.
 */
function resolveOperationType(tool: { name?: string; args: Record<string, unknown>; operationType?: string }): string | undefined {
  if (tool.operationType) return tool.operationType;
  if (tool.name) return deriveOperationType(tool.name, tool.args);
  return undefined;
}

/**
 * What a search-typed tool searches for, in user language. Three registry
 * tools derive to `search`: Socrata's `search` and CKAN's search look for
 * datasets; Data Commons' `search_indicators` looks for statistical
 * indicators (variables and topics, not datasets). The noun follows the
 * recorded name so a Data Commons run is not narrated as a dataset search.
 */
export function searchSubject(toolName?: string): { singular: string; plural: string } {
  return toolName === 'search_indicators'
    ? { singular: 'statistical indicator', plural: 'statistical indicators' }
    : { singular: 'dataset', plural: 'datasets' };
}

/** Reader-facing copy for a call whose tool name the record does not carry. */
export const UNNAMED_STEP_LABEL = 'Unnamed step';

// Format tool call arguments into human-readable progress messages
export function formatToolProgress(
  name: string,
  args: Record<string, unknown>,
  previousCalls?: { args: Record<string, unknown> }[],
): string {
  const type = resolveOperationType({ name, args });
  const portal = args.portal as string;
  const datasetId = args.dataset_id as string;
  const query = args.query as string;
  const id = args.id as string | undefined;

  // Get city name from portal
  const cityName = getPortalCity(portal);
  const datasetName = getDatasetName(datasetId);

  switch (type) {
    case 'catalog':
      return `Searching ${cityName} data catalog${query ? `: "${query}"` : ''}`;
    case 'search':
      return query
        ? `Searching the catalog for ${searchSubject(name).plural} about "${query}"`
        : `Searching the catalog for ${searchSubject(name).plural}`;
    case 'metadata':
      return `Getting metadata for ${query || datasetName}`;
    case 'query': {
      const intent = generateQueryIntentLabel(args, previousCalls);
      return intent.label;
    }
    case 'metrics':
      return `Fetching metrics for ${datasetName}`;
    default:
      // `fetch` derives to no operation type by design (see
      // mcp/operation-types.ts): the identifier's shape decides, server-side,
      // whether it returns a dataset's details or one record. The line names
      // what was asked for and asserts nothing about what came back.
      if (name === 'fetch') return id ? `Looking up ${id}` : 'Looking up one item';
      return `Calling ${name}...`;
  }
}

// Build structured SoQL clauses from tool args
export function buildSoqlClauses(args: Record<string, unknown>): { keyword: string; value: string }[] {
  const clauses: { keyword: string; value: string }[] = [];

  const select = args.select as string | undefined;
  const where = args.where as string | undefined;
  const group = args.group as string | undefined;
  const order = args.order as string | undefined;
  const limit = args.limit as number | undefined;

  if (select) clauses.push({ keyword: 'SELECT', value: select });
  if (where) clauses.push({ keyword: 'WHERE', value: where });
  if (group) clauses.push({ keyword: 'GROUP BY', value: group });
  if (order) clauses.push({ keyword: 'ORDER BY', value: order });
  if (limit) clauses.push({ keyword: 'LIMIT', value: String(limit) });

  return clauses;
}

export function getPortalCity(portal: string | undefined): string {
  if (!portal) return 'data';

  const portalCities: Record<string, string> = {
    'data.cityofnewyork.us': 'NYC',
    'data.cityofchicago.org': 'Chicago',
    'data.sfgov.org': 'San Francisco',
    'data.lacity.org': 'Los Angeles',
    'data.seattle.gov': 'Seattle',
  };

  return portalCities[portal] || 'open data';
}

export function getDatasetName(datasetId: string | undefined): string {
  if (!datasetId) return 'dataset';

  // Known dataset IDs from CLAUDE.md
  const datasetNames: Record<string, string> = {
    'erm2-nwe9': '311 Service Requests',
    '43nn-pn8j': 'Restaurant Inspections',
    'wvxf-dwi5': 'Housing Violations',
    'v6vf-nfxy': '311 Service Requests',
    'vw6y-z8j6': '311 Cases',
  };

  return datasetNames[datasetId] || `dataset ${datasetId}`;
}

// --- Query intent label system ---

const KNOWN_COLUMNS: Record<string, string> = {
  boro: 'borough',
  borough: 'borough',
  critical_flag: 'violation severity',
  violation_code: 'violation type',
  violation_description: 'violation type',
  inspection_date: 'inspection date',
  complaint_type: 'complaint type',
  created_date: 'report date',
  sr_type: 'service request type',
  service_name: 'service type',
  opened: 'open date',
  neighborhood: 'neighborhood',
  grade: 'grade',
  grade_date: 'grade date',
  cuisine_description: 'cuisine type',
  score: 'inspection score',
  zipcode: 'ZIP code',
  dba: 'restaurant name',
  currentstatus: 'status',
  violationid: 'violation ID',
};

function humanizeColumn(col: string): string {
  // Strip aggregate/function wrappers: count(*), date_trunc_ym(field), etc.
  const stripped = col.replace(/\w+\(([^)]*)\)/g, '$1').replace(/\*/g, '').trim();
  // Handle aliases: "count(*) as total" → use the base column
  const base = stripped.split(/\s+as\s+/i)[0].trim();
  return KNOWN_COLUMNS[base.toLowerCase()] || base || col;
}

export function humanizeColumns(columnStr: string): string {
  const cols = columnStr.split(',').map(c => humanizeColumn(c.trim())).filter(Boolean);
  if (cols.length === 0) return columnStr;
  if (cols.length === 1) return cols[0];
  if (cols.length === 2) return `${cols[0]} and ${cols[1]}`;
  return `${cols.slice(0, -1).join(', ')}, and ${cols[cols.length - 1]}`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '\u2026';
}

function shortVerb(aggregation: string): string {
  switch (aggregation) {
    case 'Counting': return 'Count';
    case 'Summing': return 'Sum';
    case 'Averaging': return 'Average';
    default: return aggregation;
  }
}

function pastTense(aggregation: string): string {
  switch (aggregation) {
    case 'Counting': return 'counted';
    case 'Summing': return 'summed';
    case 'Averaging': return 'averaged';
    default: return aggregation.toLowerCase();
  }
}

function detectAggregationType(select: string): string | null {
  if (/\bcount\s*\(/i.test(select)) return 'Counting';
  if (/\bsum\s*\(/i.test(select)) return 'Summing';
  if (/\bavg\s*\(/i.test(select)) return 'Averaging';
  return null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function extractDateDescription(where: string): string | null {
  // Single-day: column = 'YYYY-MM-DD'
  const singleDayMatch = where.match(/\w+\s*=\s*'(\d{4})-(\d{2})-(\d{2})'/);
  if (singleDayMatch) {
    const [, y, m, d] = singleDayMatch;
    return `on ${MONTH_NAMES[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
  }

  // Range: >= 'YYYY-MM-DD' AND column < 'YYYY-MM-DD'
  const rangeMatch = where.match(
    />=?\s*'(\d{4})-(\d{2})-(\d{2})'\s+AND\s+\w+\s*<\s*'(\d{4})-(\d{2})-(\d{2})'/i,
  );
  if (rangeMatch) {
    const [, sy, sm, sd, ey, em, ed] = rangeMatch;
    const startDay = parseInt(sd, 10);
    const endDay = parseInt(ed, 10);
    const startMonth = parseInt(sm, 10);
    const endMonth = parseInt(em, 10);
    const startYear = parseInt(sy, 10);
    const endYear = parseInt(ey, 10);

    // Exact calendar month: 1st of month to 1st of next month
    const isOneMonth =
      startDay === 1 &&
      endDay === 1 &&
      (endYear - startYear) * 12 + (endMonth - startMonth) === 1;
    if (isOneMonth) {
      return `for ${MONTH_NAMES[startMonth - 1]} ${sy}`;
    }

    // Sub-month or arbitrary range — show end as exclusive (day before)
    const endDate = new Date(Date.UTC(endYear, endMonth - 1, endDay));
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    const adjEndMonth = endDate.getUTCMonth(); // 0-indexed
    const adjEndDay = endDate.getUTCDate();
    const adjEndYear = endDate.getUTCFullYear();

    if (startYear === adjEndYear) {
      if (startMonth - 1 === adjEndMonth) {
        // Same month: "from Mar 1–7, 2026"
        return `from ${SHORT_MONTHS[startMonth - 1]} ${startDay}–${adjEndDay}, ${sy}`;
      }
      // Different months, same year: "from Feb 15 – Mar 7, 2026"
      return `from ${SHORT_MONTHS[startMonth - 1]} ${startDay} – ${SHORT_MONTHS[adjEndMonth]} ${adjEndDay}, ${sy}`;
    }
    // Different years: "from Dec 15, 2025 – Jan 7, 2026"
    return `from ${SHORT_MONTHS[startMonth - 1]} ${startDay}, ${sy} – ${SHORT_MONTHS[adjEndMonth]} ${adjEndDay}, ${adjEndYear}`;
  }

  // Open-ended start: >= 'YYYY-MM-DD' with no upper bound
  const openStartMatch = where.match(/>=?\s*'(\d{4})-(\d{2})-(\d{2})'/);
  if (openStartMatch) {
    const [, y, m, d] = openStartMatch;
    const day = parseInt(d, 10);
    const month = parseInt(m, 10);
    if (day === 1) {
      return `since ${MONTH_NAMES[month - 1]} ${y}`;
    }
    return `since ${SHORT_MONTHS[month - 1]} ${day}, ${y}`;
  }

  // Bare year fallback: extract_y(...) = 2026 or just a year in quotes
  const yearMatch = where.match(/(?:'|)(20\d{2})(?:'|)/);
  if (yearMatch) return `for ${yearMatch[1]}`;

  return null;
}

function extractFilterDescription(where: string): string | null {
  const parts: string[] = [];

  const datePart = extractDateDescription(where);
  if (datePart) parts.push(datePart);

  const boroMatch = where.match(/(?:borough|boro|neighborhood)\s*(?:=|ILIKE)\s*'([^']+)'/i);
  if (boroMatch) parts.push(`in ${boroMatch[1].replace(/%/g, '')}`);

  const criticalMatch = where.match(/critical_flag\s*(?:=|ILIKE)\s*'([^']+)'/i);
  if (criticalMatch) {
    const val = criticalMatch[1].toLowerCase();
    parts.push(val === 'critical' ? 'critical only' : 'non-critical');
  }

  const gradeMatch = where.match(/grade\s*=\s*'([^']+)'/i);
  if (gradeMatch) parts.push(`grade ${gradeMatch[1]}`);

  if (!boroMatch && !criticalMatch) {
    const ilikeMatch = where.match(/ILIKE\s+'%([^%]+)%'/i);
    if (ilikeMatch) parts.push(`matching "${ilikeMatch[1]}"`);
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

function extractNewFilter(currentWhere: string, previousWhere: string | undefined): string | null {
  if (!previousWhere) return extractFilterDescription(currentWhere);

  // If current WHERE contains previous WHERE, extract the added part
  if (currentWhere.includes(previousWhere)) {
    const newPart = currentWhere.replace(previousWhere, '')
      .replace(/^\s*AND\s*/i, '').replace(/\s*AND\s*$/i, '').trim();
    if (newPart) {
      return extractFilterDescription(newPart) || newPart;
    }
  }

  return extractFilterDescription(currentWhere);
}

export interface QueryIntent {
  label: string;
  refinedFromIndex?: number;
}

export function generateQueryIntentLabel(
  args: Record<string, unknown>,
  previousCalls?: { args: Record<string, unknown> }[],
): QueryIntent {
  const datasetId = args.dataset_id as string | undefined;
  const datasetName = getDatasetName(datasetId);
  const select = args.select as string | undefined;
  const where = args.where as string | undefined;
  const group = args.group as string | undefined;
  const order = args.order as string | undefined;
  const limit = args.limit as number | undefined;

  // Pattern: SELECT * LIMIT small → previewing data
  if ((!select || select === '*') && limit && limit <= 10 && !where && !group) {
    return { label: `Previewing ${datasetName} data` };
  }

  const aggregation = select ? detectAggregationType(select) : null;

  // Check for refinement vs previous queries on same dataset
  let refinedFromIndex: number | undefined;
  if (previousCalls) {
    for (let i = previousCalls.length - 1; i >= 0; i--) {
      const prev = previousCalls[i].args;
      if (prev.type !== 'query' || prev.dataset_id !== datasetId) continue;

      const prevGroup = prev.group as string | undefined;
      const prevWhere = prev.where as string | undefined;

      // Same grouping + added/changed filter → refinement
      if (group && group === prevGroup && where && where !== prevWhere) {
        const newFilter = extractNewFilter(where, prevWhere);
        if (newFilter) {
          return { label: `Refining: adding ${newFilter}`, refinedFromIndex: i };
        }
      }

      // Same filter, different grouping → different breakdown
      if (where === prevWhere && group && prevGroup && group !== prevGroup) {
        refinedFromIndex = i;
      }

      break;
    }
  }

  // Check for "top N" pattern: ORDER BY ... DESC + LIMIT + GROUP BY
  const hasTopPattern = order && /DESC$/i.test(order) && limit && group;

  let label: string;

  if (hasTopPattern) {
    const groupCols = humanizeColumns(group);
    const plural = groupCols.endsWith('s') ? groupCols : groupCols + 's';
    label = `Top ${plural}`;
  } else if (group) {
    const groupCols = humanizeColumns(group);
    label = aggregation ? `${aggregation} by ${groupCols}` : `Counting by ${groupCols}`;
  } else if (aggregation) {
    label = `${aggregation} ${datasetName} records`;
  } else if (select && select !== '*') {
    const cols = select.split(',').map(c => c.trim());
    if (cols.length <= 3) {
      label = `Getting ${humanizeColumns(select)}`;
    } else {
      label = `Querying ${datasetName} details`;
    }
  } else {
    label = `Querying ${datasetName}`;
  }

  // Append filter context
  if (where) {
    const filterDesc = extractFilterDescription(where);
    if (filterDesc) label += ` ${filterDesc}`;
  }

  return { label, refinedFromIndex };
}

// Format a human-readable message describing tool results. `name` is the
// recorded tool name; without it only `args.type` can say what the call was,
// and only `get_data` carries that (#384).
export function formatToolResult(
  args: Record<string, unknown>,
  resultSummary?: { rows: number; columns: number },
  name?: string,
): string | null {
  const type = resolveOperationType({ name, args }) ?? (args.type as string | undefined);
  const datasetId = args.dataset_id as string | undefined;
  const datasetName = getDatasetName(datasetId);
  const id = args.id as string | undefined;

  switch (type) {
    case 'catalog':
      return resultSummary
        ? `Found ${resultSummary.rows} dataset${resultSummary.rows !== 1 ? 's' : ''} matching the search`
        : 'Catalog search complete';
    case 'search': {
      const subject = searchSubject(name);
      return resultSummary
        ? `Found ${resultSummary.rows} ${resultSummary.rows !== 1 ? subject.plural : subject.singular} matching the search`
        : 'Search complete';
    }
    case 'query':
      return resultSummary
        ? `Retrieved ${resultSummary.rows} record${resultSummary.rows !== 1 ? 's' : ''} from ${datasetName}`
        : `Query to ${datasetName} complete`;
    case 'metadata':
      return `Loaded metadata for ${datasetName}`;
    case 'metrics':
      return `Loaded metrics for ${datasetName}`;
    default:
      // `fetch`: a `record:` identifier answers with data rows, which the
      // loop's `summarizeToolResult` counts; a `dataset:` identifier answers
      // with a description and columns, which it does not. So a row count is
      // stated only when one was measured; otherwise the line says only that
      // the lookup completed — never which of the two the server chose.
      if (name === 'fetch') {
        const what = id ?? 'one item';
        return resultSummary
          ? `Retrieved ${resultSummary.rows} record${resultSummary.rows !== 1 ? 's' : ''} for ${what}`
          : `Looked up ${what}`;
      }
      return null;
  }
}

// Generate a brief "why" reason from tool args for display in progress log and
// tool cards. The loop writes it onto `record.reason`, which both notebook
// generators read, so every `get_data` output here is byte-for-byte what it
// was before `name` arrived (#384): `get_data` is not in the name-keyed table,
// so its operation type is still `args.type`.
export function generateToolReason(args: Record<string, unknown>, name?: string): string {
  const type = resolveOperationType({ name, args }) ?? (args.type as string | undefined);
  const datasetId = args.dataset_id as string | undefined;
  const query = args.query as string | undefined;
  const datasetName = getDatasetName(datasetId);
  const group = args.group as string | undefined;
  const where = args.where as string | undefined;
  const select = args.select as string | undefined;
  const id = args.id as string | undefined;

  switch (type) {
    case 'catalog':
      return query ? `to find datasets about "${query}"` : 'to search for relevant datasets';
    case 'search': {
      const subject = searchSubject(name);
      return query ? `to find ${subject.plural} about "${query}"` : `to search for relevant ${subject.plural}`;
    }
    case 'metadata':
      return `to understand ${datasetName} structure`;
    case 'query':
      if (group) return `to aggregate ${datasetName} by ${group}`;
      if (where) return `to filter ${datasetName} records`;
      if (select) return `to retrieve specific fields from ${datasetName}`;
      return `to query ${datasetName}`;
    case 'metrics':
      return `to check ${datasetName} statistics`;
    default:
      if (name === 'fetch') return id ? `to look up ${id}` : 'to look up one item';
      // A tool whose operation neither its name nor its arguments state: the
      // reason repeats the recorded name. `get_data`'s name in user language
      // is "gather data" — the one string P4 reads off a `get_data` record
      // whose arguments named no operation, unchanged.
      if (name && name !== 'get_data') return `to call ${name}`;
      return 'to gather data';
  }
}

/**
 * A bare identifier inside a reason phrase — `record:…`, `dataset:…`, a URL —
 * matched as a scheme and a non-space, at a word boundary the phrase itself
 * created.
 *
 * Quoted spans are removed before the test rather than excluded by the pattern.
 * Every reason phrase that carries free text carries it in double quotes
 * (`to find datasets about "…"`), and a reader's search phrase is text the
 * document is entitled to show — it is what was asked, not a source that was
 * reached. `../notebook-author/reproduction-claim.ts`'s `markdownProse` strips
 * the same two channels for the same reason and says so in the same place.
 *
 * The colon must be followed by a non-space, so an English colon inside a
 * dataset name ("Requests: 2010-Present") is not an identifier. `getDatasetName`
 * carries none today; the pattern does not depend on that staying true.
 */
const BARE_IDENTIFIER = /(?:^|\s)[a-z][a-z0-9+.-]*:\S/i;

/**
 * A recorded call's `reason` phrase, or NOTHING when the phrase names an
 * identifier (#406).
 *
 * WHY A PHRASE IS DROPPED WHOLE rather than edited. `generateToolReason` writes
 * `to look up ${id}` for a `fetch`, and the loop stores that string on the
 * record. A `record:` identifier embeds a portal, a dataset id and a row id, so
 * printing it under a heading that has just said a step cannot be accounted for
 * puts a source in front of a reader that the document cannot say was read —
 * and, for a call the source REJECTED, a portal the call never reached.
 * Decomposing the identifier to keep the safe part would mean reimplementing the
 * data source's identifier grammar here, where it would drift;
 * `notebook-author/tool-to-cell.ts` states that ruling for the surface it owns
 * and this is the same ruling, in the one place both surfaces can read it.
 *
 * WHY IT NAMES THE PROPERTY AND NOT `fetch`. `fetch` is the only branch above
 * that interpolates an identifier TODAY. A guard written against that name would
 * be a hand-picked list of exactly the kind CLAUDE.md records failing twice, and
 * it would pass silently on the day a new tool's branch writes one. The test is
 * on the string, so a phrase this repository has never seen is held to it.
 *
 * `undefined` in, `undefined` out: a record that carries no reason is stated as
 * carrying none, never given one.
 */
export function reasonWithoutIdentifier(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const unquoted = reason.replace(/"[^"\n]*"/g, ' ');
  return BARE_IDENTIFIER.test(unquoted) ? undefined : reason;
}

// Generate a plain-English translation of a SoQL query from structured args
export function generatePlainEnglishQuery(args: Record<string, unknown>): string | null {
  const type = args.type as string;
  if (type !== 'query') return null;

  const datasetId = args.dataset_id as string | undefined;
  const datasetName = getDatasetName(datasetId);
  const select = args.select as string | undefined;
  const where = args.where as string | undefined;
  const group = args.group as string | undefined;
  const order = args.order as string | undefined;
  const limit = args.limit as number | undefined;

  const parts: string[] = [];
  parts.push(`In the ${datasetName} dataset`);

  if (select && select !== '*') {
    const fields = select.split(',').map(s => s.trim());
    const hasAgg = fields.some(f => /count|sum|avg|min|max/i.test(f));
    if (hasAgg) {
      parts.push('count or aggregate records');
    } else {
      parts.push(`look at ${fields.join(', ')}`);
    }
  }

  if (where) {
    parts.push(humanizeWhereClause(where));
  }

  if (group) {
    parts.push(`grouped by ${group}`);
  }

  if (order) {
    const descMatch = order.match(/^(.+?)\s+DESC$/i);
    if (descMatch) {
      parts.push(`sorted from most to fewest by ${descMatch[1]}`);
    } else {
      parts.push(`sorted by ${order}`);
    }
  }

  if (limit) {
    parts.push(`showing the top ${limit}`);
  }

  return `This asks: "${parts.join(', ')}."`;
}

function humanizeWhereClause(where: string): string {
  let result = where;

  // Replace operators with words
  result = result.replace(/\s*>=\s*/g, ' on or after ');
  result = result.replace(/\s*<=\s*/g, ' on or before ');
  result = result.replace(/\s*>\s*/g, ' greater than ');
  result = result.replace(/\s*<\s*/g, ' less than ');
  result = result.replace(/\s*=\s*/g, ' equal to ');

  // Handle LIKE / ILIKE patterns
  result = result.replace(/\s+ILIKE\s+'%([^%]+)%'/gi, (_, term) => ` containing "${term}"`);
  result = result.replace(/\s+LIKE\s+'%([^%]+)%'/gi, (_, term) => ` containing "${term}"`);
  result = result.replace(/\s+ILIKE\s+'([^']+)%'/gi, (_, term) => ` starting with "${term}"`);

  // Handle AND/OR
  result = result.replace(/\s+AND\s+/gi, ', and ');
  result = result.replace(/\s+OR\s+/gi, ', or ');

  return `where ${result}`;
}

// Get educational annotation text for a given phase and operation type
export function getEducationalAnnotation(phase: string, operationType?: string, queryStepIndex?: number): string | null {
  if (phase === 'analyze') {
    return 'The AI is reading the question and planning which data to look for.';
  }
  if (phase === 'synthesize') {
    return 'The AI has collected its data and is now writing a summary of what it found.';
  }
  if (phase === 'tool_start' && operationType) {
    switch (operationType) {
      case 'catalog':
        return 'The AI is searching an open data portal — a public catalog where governments publish datasets for anyone to use.';
      case 'search':
        return 'The AI is searching a catalog of available data — asking what exists about this topic before reading any of it.';
      case 'metadata':
        return 'Reading the data dictionary — the list of columns and what each one contains.';
      case 'query': {
        if (queryStepIndex === undefined || queryStepIndex === 0) {
          return 'Running a structured query against the dataset — filtering and aggregating records to answer the question.';
        }
        if (queryStepIndex === 1) {
          return 'Each query builds on the last — the AI is narrowing its focus based on what it found.';
        }
        return null;
      }
      case 'metrics':
        return 'Checking dataset statistics — how many records exist and how often the data is updated.';
      default:
        return null;
    }
  }
  return null;
}

// Build a short chip/breadcrumb label for a single tool call (~30 chars, action-verb led)
export function buildBreadcrumbLabel(
  tool: { name?: string; args: Record<string, unknown>; operationType?: string },
  allTools?: { name?: string; args: Record<string, unknown>; operationType?: string }[],
  index?: number,
): string {
  const opType = resolveOperationType(tool) ?? (tool.args.type as string | undefined);
  const query = tool.args.query as string | undefined;

  switch (opType) {
    case 'catalog':
      return query ? `Search "${truncate(query, 15)}"` : 'Search catalog';
    case 'search':
      return query ? `Search "${truncate(query, 15)}"` : 'Search catalog';
    case 'metadata':
      return 'Check schema';
    case 'query': {
      const select = tool.args.select as string | undefined;
      const where = tool.args.where as string | undefined;
      const group = tool.args.group as string | undefined;
      const order = tool.args.order as string | undefined;
      const limit = tool.args.limit as number | undefined;

      // Preview pattern
      if ((!select || select === '*') && limit && limit <= 10 && !where && !group) {
        return 'Preview data';
      }

      // Refinement
      const previousCalls = allTools && index !== undefined ? allTools.slice(0, index) : undefined;
      if (previousCalls) {
        const intent = generateQueryIntentLabel(tool.args, previousCalls);
        if (intent.refinedFromIndex !== undefined) {
          const prevWhere = allTools![intent.refinedFromIndex].args.where as string | undefined;
          const newFilter = where ? extractNewFilter(where, prevWhere) : null;
          return newFilter ? `Refine: ${truncate(newFilter, 18)}` : 'Refine query';
        }
      }

      const aggregation = select ? detectAggregationType(select) : null;
      const hasTopPattern = order && /DESC$/i.test(order) && limit && group;

      if (hasTopPattern) {
        return `Top ${truncate(humanizeColumns(group!), 22)}`;
      }
      if (group) {
        const verb = aggregation ? shortVerb(aggregation) : 'Count';
        return `${verb} by ${truncate(humanizeColumns(group), 18)}`;
      }
      if (aggregation) {
        return `${shortVerb(aggregation)} records`;
      }

      const filterDesc = where ? extractFilterDescription(where) : null;
      return filterDesc ? `Query ${truncate(filterDesc, 20)}` : 'Query data';
    }
    case 'metrics':
      return 'Get stats';
    default: {
      if (tool.name === 'fetch') {
        const id = tool.args.id as string | undefined;
        return id ? `Look up ${truncate(id, 20)}` : 'Look up one item';
      }
      // The recorded name, or a stated absence — never a stand-in that reads
      // like a name.
      return tool.name ?? UNNAMED_STEP_LABEL;
    }
  }
}

// Describe a tool call in past-tense narrative form
function describeToolNarrative(
  tool: { name?: string; args: Record<string, unknown>; operationType?: string },
  index: number,
  allTools: { name?: string; args: Record<string, unknown>; operationType?: string }[],
): string {
  const opType = resolveOperationType(tool) ?? (tool.args.type as string | undefined);
  const query = tool.args.query as string | undefined;

  switch (opType) {
    case 'catalog':
      return query ? `searched for datasets about "${query}"` : 'searched the data catalog';
    case 'search': {
      const subject = searchSubject(tool.name);
      return query ? `searched for ${subject.plural} about "${query}"` : `searched for ${subject.plural}`;
    }
    case 'metadata':
      return 'examined the dataset structure';
    case 'query': {
      const select = tool.args.select as string | undefined;
      const where = tool.args.where as string | undefined;
      const group = tool.args.group as string | undefined;
      const order = tool.args.order as string | undefined;
      const limit = tool.args.limit as number | undefined;

      // Preview pattern
      if ((!select || select === '*') && limit && limit <= 10 && !where && !group) {
        return 'sampled the data';
      }

      // Check refinement
      const previousCalls = allTools.slice(0, index);
      const intent = generateQueryIntentLabel(tool.args, previousCalls);
      if (intent.refinedFromIndex !== undefined) {
        const prevWhere = allTools[intent.refinedFromIndex]?.args?.where as string | undefined;
        const newFilter = where ? extractNewFilter(where, prevWhere) : null;
        return newFilter ? `refined the query (${newFilter})` : 'refined the previous query';
      }

      const aggregation = select ? detectAggregationType(select) : null;
      const hasTopPattern = order && /DESC$/i.test(order) && limit && group;

      if (hasTopPattern) {
        const groupCols = humanizeColumns(group!);
        const filterDesc = where ? extractFilterDescription(where) : null;
        return filterDesc ? `found top ${groupCols} ${filterDesc}` : `found top ${groupCols}`;
      }
      if (group) {
        const groupCols = humanizeColumns(group);
        const filterDesc = where ? extractFilterDescription(where) : null;
        const verb = aggregation ? pastTense(aggregation) : 'compared counts';
        return filterDesc ? `${verb} by ${groupCols} ${filterDesc}` : `${verb} by ${groupCols}`;
      }

      if (aggregation) {
        const filterDesc = where ? extractFilterDescription(where) : null;
        return filterDesc ? `${pastTense(aggregation)} records ${filterDesc}` : `${pastTense(aggregation)} records`;
      }

      const filterDesc = where ? extractFilterDescription(where) : null;
      return filterDesc ? `queried records ${filterDesc}` : 'queried the data';
    }
    case 'metrics':
      return 'checked dataset statistics';
    default: {
      if (tool.name === 'fetch') {
        const id = tool.args.id as string | undefined;
        return id ? `looked up ${id}` : 'looked up one item';
      }
      return tool.name ? `called ${tool.name}` : 'ran a step the record does not name';
    }
  }
}

/**
 * A rejected call, narrated as what it tried and that it did not complete —
 * never in the past tense of an action that happened (#384 P8, F2). `reason`
 * is the loop's own "to …" phrase for the attempt (`generateToolReason`);
 * a record that carries none is stated as a request, not guessed at.
 *
 * The phrase goes through `reasonWithoutIdentifier` HERE rather than at the one
 * call site, so no future caller can narrate a rejection and forget it (#406).
 * A rejected `fetch` read "The AI tried to look up
 * record:<portal>/<dataset>/<row>, but the request did not complete" — a portal
 * the call never reached, named on the page in the same sentence that says the
 * request never completed. A record whose phrase is dropped for that reason
 * lands on the same "made a request that did not complete" a record carrying no
 * phrase gets: less is said, and nothing false.
 */
function describeRejectedAttempt(reason: string | undefined): string {
  const safe = reasonWithoutIdentifier(reason);
  return safe ? `tried ${safe}, but the request did not complete` : 'made a request that did not complete';
}

// Build a narrative summary telling the analytical story of what the AI did
export function buildNarrativeSummary(
  toolsCalled: { name?: string; args: Record<string, unknown>; resultSummary?: { rows: number; columns: number }; duration_ms?: number; operationType?: string; reason?: string; failed?: boolean }[],
): string {
  if (toolsCalled.length === 0) return '';

  // A rejected call touched no dataset and no portal (#384 P8, F2): the
  // "Using …" clause below is written from the calls that were answered.
  const answered = toolsCalled.filter((tool) => !tool.failed);

  // Collect unique portals
  const portalSet = new Set<string>();
  for (const tool of answered) {
    const p = tool.args.portal as string | undefined;
    if (p) portalSet.add(p);
  }
  const portals = [...portalSet];
  const isMultiPortal = portals.length > 1;

  // A dataset keeps the portal its OWN call named, or none (#384, F2). A call
  // whose arguments carried no portal was answered by whatever portal the
  // source defaulted to — which the record does not say — so borrowing
  // another call's portal here minted a link, and a city, the record never
  // asserted.
  const datasets = new Map<string, { name: string; portal?: string }>();
  for (const tool of answered) {
    const id = tool.args.dataset_id as string | undefined;
    const p = tool.args.portal as string | undefined;
    if (id && !datasets.has(id)) {
      datasets.set(id, { name: getDatasetName(id), portal: p });
    }
  }

  // Build action phrases using intent-aware narrative descriptions
  const actions: string[] = [];
  for (let i = 0; i < toolsCalled.length; i++) {
    const tool = toolsCalled[i];
    actions.push(tool.failed ? describeRejectedAttempt(tool.reason) : describeToolNarrative(tool, i, toolsCalled));
  }

  // Deduplicate consecutive identical actions
  const deduped: { text: string; count: number }[] = [];
  for (const action of actions) {
    const last = deduped[deduped.length - 1];
    if (last && last.text === action) {
      last.count++;
    } else {
      deduped.push({ text: action, count: 1 });
    }
  }
  const parts = deduped.map(a => a.count > 1 ? `${a.text} (${a.count} times)` : a.text);

  // Build prefix with dataset context. A link and a city are written only from
  // the portal the dataset's own call named: a dataset whose call named none
  // is listed by name, unlinked, and counted under no city.
  let prefix = '';
  if (datasets.size === 1) {
    const [id, { name, portal }] = [...datasets.entries()][0];
    const url = datasetUrl(portal, id);
    const datasetRef = url ? `[${name} (${id})](${url})` : `${name} (${id})`;
    prefix = portal
      ? `Using ${getPortalCity(portal)}'s ${datasetRef}, the AI `
      : `Using ${datasetRef}, the AI `;
  } else if (datasets.size > 1) {
    const entries = [...datasets.entries()];
    if (isMultiPortal) {
      const linkedNames = entries.map(([id, { name, portal }]) => {
        const url = datasetUrl(portal, id);
        const ref = url ? `[${name} (${id})](${url})` : `${name} (${id})`;
        return portal ? `${getPortalCity(portal)}'s ${ref}` : ref;
      });
      prefix = `Using ${linkedNames.join(' and ')}, the AI `;
    } else {
      const linkedNames = entries.map(([id, { name, portal }]) => {
        const url = datasetUrl(portal, id);
        return url ? `[${name} (${id})](${url})` : `${name} (${id})`;
      });
      // "N <city> datasets" only when every dataset's own call named that one
      // portal; when any named none, "N datasets", and no city is asserted
      // for any of them.
      const everyDatasetNamedItsPortal = entries.every(([, { portal }]) => Boolean(portal));
      const cityPhrase = everyDatasetNamedItsPortal ? `${getPortalCity(portals[0])} ` : '';
      prefix = `Using ${linkedNames.length} ${cityPhrase}datasets (${linkedNames.join(', ')}), the AI `;
    }
  } else {
    prefix = 'The AI ';
  }

  // Join into natural sentence
  if (parts.length === 1) {
    return `${prefix}${parts[0]}.`;
  }
  if (parts.length === 2) {
    return `${prefix}${parts[0]}, then ${parts[1]}.`;
  }
  const last = parts.pop()!;
  return `${prefix}${parts.join(', ')}, then ${last}.`;
}

/** The minimum shape every rows-counting reader needs off a recorded call. */
type CountableToolCall = {
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  operationType?: string;
  /** Set when the loop recorded the call as rejected (`ToolCallRecord.failed`). */
  failed?: boolean;
};

/**
 * Did this tool call return DATA ROWS, as opposed to catalog hits or metadata?
 *
 * Socrata's unified `get_data` carries the operation in `args.type`; every
 * other server's operation type is derived from the tool name and arrives as
 * `operationType` (see `@/lib/mcp/operation-types`). `operationType` wins when
 * present because it is the resolved value; `args.type` is the fallback for a
 * recorded call that predates the field or that is read back off a published
 * package.
 *
 * This is the ONE predicate for "this call returned records" (#339). The
 * `records analyzed` count, the query count and the provenance line all read
 * it, so the three can never disagree about the same run.
 */
export function isQueryCall(t: CountableToolCall): boolean {
  // A call the source rejected returned no records, whatever it asked for
  // (#384 P8, F2): it is not a query that ran. Routed through this one
  // predicate so its three readers — the rows sum (unchanged in effect: a
  // rejected call has no `resultSummary`), the query count and the
  // provenance line's source list — cannot disagree about the same call.
  if (t.failed) return false;
  return (t.operationType || t.args.type) === 'query';
}

/**
 * Rows this run actually pulled from datasets.
 *
 * Counts QUERY calls only. A catalog search that returned 40 dataset
 * descriptions analyzed no records — reporting it as 40 tells a reader (and,
 * once published, every later reader of a signed record) that forty rows of
 * civic data backed a claim that rested on twelve. Both reader-facing lines
 * sum through here so neither can drift from the other (#339).
 */
function sumQueryRows(tools: CountableToolCall[]): number {
  return tools.reduce(
    (sum, t) => (isQueryCall(t) ? sum + (t.resultSummary?.rows || 0) : sum),
    0,
  );
}

// Build a stats summary line leading with data volume
export function buildStatsSummary(
  toolsCalled: { name?: string; args: Record<string, unknown>; resultSummary?: { rows: number; columns: number }; duration_ms?: number; operationType?: string; failed?: boolean }[],
  totalDuration_ms?: number,
): string {
  const statParts: string[] = [];

  const totalRows = sumQueryRows(toolsCalled);
  if (totalRows > 0) {
    statParts.push(`${totalRows.toLocaleString()} records analyzed`);
  }

  const queryCount = toolsCalled.filter(isQueryCall).length;
  if (queryCount > 0) {
    statParts.push(`${queryCount} ${queryCount === 1 ? 'query' : 'queries'}`);
  } else {
    statParts.push(`${toolsCalled.length} tool call${toolsCalled.length !== 1 ? 's' : ''}`);
  }

  // A rejected request is counted as what it is (#384 P8, F2): not among the
  // queries above, and not left out of the line either.
  const rejectedCount = toolsCalled.filter((t) => t.failed).length;
  if (rejectedCount > 0) {
    statParts.push(`${rejectedCount} request${rejectedCount === 1 ? '' : 's'} did not complete`);
  }

  if (totalDuration_ms) {
    statParts.push(`${(totalDuration_ms / 1000).toFixed(1)}s`);
  }

  return statParts.join(' \u00b7 ');
}

// Generate a Socrata dataset URL from portal and dataset ID
export function datasetUrl(portal: string | undefined, datasetId: string | undefined): string | null {
  if (!portal || !datasetId) return null;
  return `https://${portal}/d/${datasetId}`;
}

// Build source provenance line with markdown links for dataset references
export function buildProvenanceLine(
  tools: { args: Record<string, unknown>; resultSummary?: { rows: number; columns: number }; operationType?: string; failed?: boolean }[]
): string | null {
  // Same predicate as `buildStatsSummary` (#339). Before this, provenance read
  // `operationType` alone while the stats line read `operationType || args.type`,
  // so a recorded call carrying only `args.type` produced a "records analyzed"
  // count with no "Source:" line under it. The predicate also excludes a
  // rejected call (#384 P8, F2): a request that returned nothing is not a
  // source, and neither is the portal it was made to.
  const queryTools = tools.filter(isQueryCall);
  if (queryTools.length === 0) return null;

  const parts: string[] = [];

  // Collect unique portals from the tool calls that were answered
  const portalSet = new Set<string>();
  for (const tool of tools) {
    if (tool.failed) continue;
    const p = tool.args.portal as string | undefined;
    if (p) portalSet.add(p);
  }
  const portals = [...portalSet];

  if (portals.length === 1) {
    parts.push(`${getPortalCity(portals[0])} Open Data`);
  } else if (portals.length > 1) {
    const cities = portals.map(p => getPortalCity(p)).filter(c => c !== 'open data');
    if (cities.length > 0) {
      parts.push(`${cities.join(' + ')} Open Data`);
    }
  }

  const seen = new Set<string>();
  for (const tool of queryTools) {
    const did = tool.args.dataset_id as string | undefined;
    // The link is minted only from the portal THIS call named (#384, F2); a
    // call that named none is listed by name, unlinked — `datasetUrl` returns
    // null for an absent portal. The run-level "<city> Open Data" line above
    // stays: it names only the portals the calls named.
    const portal = tool.args.portal as string | undefined;
    if (did && !seen.has(did)) {
      seen.add(did);
      const name = getDatasetName(did);
      const url = datasetUrl(portal, did);
      if (url) {
        parts.push(`[${name} (${did})](${url})`);
      } else {
        parts.push(`${name} (${did})`);
      }
    }
  }

  // Through the same helper `buildStatsSummary` uses, so "N records analyzed"
  // and "N rows returned" describe the same N for the same run (#339).
  const totalRows = sumQueryRows(tools);
  if (totalRows > 0) {
    parts.push(`${totalRows.toLocaleString()} rows returned`);
  }

  return parts.length > 0 ? `Source: ${parts.join(' \u00b7 ')}` : null;
}

// Encode a stream event as SSE format
export function encodeSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * The panels (model arms) a comparison run executes. An `mcpOnly` run is
 * the with-data arm alone — one model call; the default is both arms.
 * `/api/compare-stream` uses this both to dispatch work and to address
 * fail-fast error events, so the two can never disagree about which
 * panels a run has.
 */
export function panelsForRun(mcpOnly: boolean): PanelType[] {
  return mcpOnly ? ['withMcp'] : ['withoutMcp', 'withMcp'];
}
