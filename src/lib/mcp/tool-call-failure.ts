/**
 * How a `tools/call` response says the data source refused the call (#429).
 *
 * MCP has two ways to say it, and a client that reads only one of them records
 * the other as an answer:
 *
 *   - The JSON-RPC `error` member: the request failed. `McpErrorEnvelope`
 *     carries the server's message exactly as the client always has. The
 *     classifier reads that message (a source that says it "timed out" is
 *     recorded `timeout`), and so does the client's session retry; neither is
 *     changed here (Wave N11 P3's non-goals).
 *   - A `result` carrying `isError: true`: the MCP specification's tool-level
 *     failure — the tool ran, and reports that it could not do what was asked.
 *     Until Wave N11 P3 nothing in this repository read the flag, so both
 *     senders handed the refusal's text to the model as data, and every reader
 *     of the record — the signed package's `queries[]` and `dataSources[]`
 *     included — recorded the call as answered.
 *
 * `McpErrorResult` records the flag by its STRUCTURE, never by its words (Wave
 * N11 ruling R1). MCP gives the flag no kind, and reading the source's prose
 * through the classifier's matchers would sign a refusal worded "unavailable"
 * as `unavailable`. So it carries `code: 'generic'`, which `classifyStreamError`
 * returns before it reads any message, and the loop records
 * `failureKind: 'unknown'`. Its message is fixed and holds none of the source's
 * text, which keeps three things true by construction rather than by each
 * reader's care: the client's session retry (it fires on "session" or "400" in a
 * message) cannot fire on a refusal; the SSE branch's parse failure cannot take
 * its place; and no word the source chose can reach the model, the trace or the
 * signed package through the error. The source's text stays in the operator's
 * log, where `client.ts` writes every raw response.
 *
 * `isSourceRefusal` is how `describeToolFailureForLlm` tells a failure the source
 * ANSWERED with from one that happened on this side (Wave N11 ruling R6). It
 * reads a marker both classes carry rather than `instanceof`, so it does not
 * depend on there being one instance of this module.
 *
 * Every `tools/call` sender in this repository routes a result through
 * `throwIfErrorResult`; `tool-call-senders.test.ts` derives the senders from
 * `git ls-files` and holds each one to it.
 *
 * Pure and dependency-free, in erasable TypeScript only: `streaming.ts` imports
 * it and reaches client bundles, and `scripts/eval-models.mjs` imports it under
 * Node's type stripping.
 */

/** The two shapes a source's refusal takes on the wire. */
export type SourceRefusalShape = 'error-envelope' | 'error-result';

/**
 * The message every `McpErrorResult` carries. Fixed, and free of every word the
 * session retry, the parse rewrite and the classifier's matchers read
 * (`tool-call-failure.test.ts` holds it to that).
 */
export const ERROR_RESULT_MESSAGE = 'The data source answered this tool call with a result marked isError: true.';

/** A JSON-RPC `error` member in answer to `tools/call`. Its message is the source's, unchanged. */
export class McpErrorEnvelope extends Error {
  readonly sourceRefusal: SourceRefusalShape = 'error-envelope';

  constructor(message: string | undefined) {
    super(message);
    this.name = 'McpErrorEnvelope';
  }
}

/** A `tools/call` result carrying `isError: true`, recorded by its structure. */
export class McpErrorResult extends Error {
  readonly sourceRefusal: SourceRefusalShape = 'error-result';
  /** Read by `classifyStreamError` before any message: `generic`, so the loop records `unknown`. */
  readonly code = 'generic';

  constructor() {
    super(ERROR_RESULT_MESSAGE);
    this.name = 'McpErrorResult';
  }
}

/** Throw `McpErrorResult` when a `tools/call` result carries `isError: true`; return otherwise. */
export function throwIfErrorResult(result: unknown): void {
  if (result !== null && typeof result === 'object' && (result as { isError?: unknown }).isError === true) {
    throw new McpErrorResult();
  }
}

/** Whether an error is a refusal the source answered with, in either shape. */
export function isSourceRefusal(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const shape = (error as { sourceRefusal?: unknown }).sourceRefusal;
  return shape === 'error-envelope' || shape === 'error-result';
}
