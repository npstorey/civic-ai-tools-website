// OTel-compatible trace capture — app-side shim over
// @typedstandards/civic-typed-harness (S3a P1, #166; the verify-core shim
// pattern of #116-WS3 applied to the capture layer).
//
// The types + `TraceBuilder` live in the harness's capture group (ADR-0022
// §C). This deployment's identity values (service.name, scope name/version,
// semconv version) are the harness's demo default (`CIVICAITOOLS_TRACE_CONFIG`),
// re-exported here so call sites construct `new TraceBuilder(CIVICAITOOLS_TRACE_CONFIG)`
// explicitly rather than relying on the constructor's own default — same
// byte-identical resource/scope blocks, now passed explicitly at the call
// site instead of applied implicitly inside the harness. `hash()` is
// re-backed by the @noble/hashes SHA-256 the stack single-sources through
// verify-core — same digest bytes as the prior node:crypto implementation.
// Wiring instance config (a non-demo service name) is P2 parameterization
// work, not this shim's.
export {
  TraceBuilder,
  hash,
  CIVICAITOOLS_TRACE_CONFIG,
  type SpanEvent,
  type OTelAttribute,
  type Span,
  type OTelTrace,
  type TraceBuilderConfig,
} from '@typedstandards/civic-typed-harness';

// --- What a run records about itself (#599 W4, ADR-0033 §D and §E) ----------
//
// The query routes write five facts onto the trace's ROOT span at run time,
// and a sixth when the run had a flows statement in force (R6 W2, #632 D2 = A),
// and the packager reads them back with the harness's `extractRunAttributes`
// at publish (#495: a fact read at packaging is packaging-time state). Each is
// JSON text except the date. The names are the harness's: `extractRunAttributes`
// reads exactly these keys, and `run-record-attributes.test.ts` round-trips
// them through it so the two cannot part.

/** The six root-span attributes, by ADR-0033's names (the sixth from its 2026-10-18 amendment). */
export const RUN_RECORD_ATTRIBUTE = {
  /** `YYYY-MM-DD`, the `today` the composed prompt stated (#475). */
  assertedDate: 'analysis.asserted_date',
  /** JSON `[{ url, name }]`: the servers the run's configuration had, `name`
   *  the source id, in the registry's order (#495). */
  mcpServers: 'analysis.mcp_servers',
  /** JSON: the tools array the run offered the model, in order, verbatim. */
  toolDefinitions: 'analysis.tool_definitions',
  /** JSON `[{ sourceId, alias, reason }]`, one per manifest source. */
  sourcesOffered: 'analysis.sources_offered',
  /** JSON `[{ id, version?, guidanceHash?, guidanceOrigin? }]`. */
  components: 'analysis.components',
  /** JSON `{ url, hash, date }`, exactly those keys: the flows statement in
   *  force for the run (harness 0.9.0). Absent when the run had none, never
   *  `null`, which the harness's extractor refuses. */
  flowsStatement: 'analysis.flows_statement',
} as const;

/** What a run states about itself, before encoding. */
export interface RunRecordInput {
  assertedDate: string;
  mcpServers: ReadonlyArray<{ url: string; name?: string }>;
  toolDefinitions: ReadonlyArray<unknown>;
  sourcesOffered: ReadonlyArray<{ sourceId: string; alias: string; reason: string }>;
  components: ReadonlyArray<{ id: string; version?: string; guidanceHash?: string; guidanceOrigin?: string }>;
  /** The flows statement in force (`flowsStatementReference`); omitted when there is none. */
  flowsStatement?: { url: string; hash: string; date: string };
}

/** The root-span attributes for a run, ready for `startRoot` or `endRoot`: five, and the sixth when passed. */
export function runRecordAttributes(run: RunRecordInput): Record<string, string> {
  const { flowsStatement } = run;
  return {
    [RUN_RECORD_ATTRIBUTE.assertedDate]: run.assertedDate,
    [RUN_RECORD_ATTRIBUTE.mcpServers]: JSON.stringify(run.mcpServers),
    [RUN_RECORD_ATTRIBUTE.toolDefinitions]: JSON.stringify(run.toolDefinitions),
    [RUN_RECORD_ATTRIBUTE.sourcesOffered]: JSON.stringify(run.sourcesOffered),
    [RUN_RECORD_ATTRIBUTE.components]: JSON.stringify(run.components),
    // Exactly the three keys, in the harness's order, whatever the caller passed.
    ...(flowsStatement
      ? { [RUN_RECORD_ATTRIBUTE.flowsStatement]: JSON.stringify({ url: flowsStatement.url, hash: flowsStatement.hash, date: flowsStatement.date }) }
      : {}),
  };
}
