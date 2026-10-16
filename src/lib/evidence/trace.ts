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
// and the packager reads them back with the harness's `extractRunAttributes`
// at publish (#495: a fact read at packaging is packaging-time state). Each is
// JSON text except the date. The names are the harness's: `extractRunAttributes`
// reads exactly these keys, and `run-record-attributes.test.ts` round-trips
// them through it so the two cannot part.

/** The five root-span attributes, by ADR-0033's names. */
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
} as const;

/** What a run states about itself, before encoding. */
export interface RunRecordInput {
  assertedDate: string;
  mcpServers: ReadonlyArray<{ url: string; name?: string }>;
  toolDefinitions: ReadonlyArray<unknown>;
  sourcesOffered: ReadonlyArray<{ sourceId: string; alias: string; reason: string }>;
  components: ReadonlyArray<{ id: string; version?: string; guidanceHash?: string; guidanceOrigin?: string }>;
}

/** The five root-span attributes for a run, ready for `startRoot` or `endRoot`. */
export function runRecordAttributes(run: RunRecordInput): Record<string, string> {
  return {
    [RUN_RECORD_ATTRIBUTE.assertedDate]: run.assertedDate,
    [RUN_RECORD_ATTRIBUTE.mcpServers]: JSON.stringify(run.mcpServers),
    [RUN_RECORD_ATTRIBUTE.toolDefinitions]: JSON.stringify(run.toolDefinitions),
    [RUN_RECORD_ATTRIBUTE.sourcesOffered]: JSON.stringify(run.sourcesOffered),
    [RUN_RECORD_ATTRIBUTE.components]: JSON.stringify(run.components),
  };
}
