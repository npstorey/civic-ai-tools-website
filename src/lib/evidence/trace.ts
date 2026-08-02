// OTel-compatible trace capture — app-side shim over
// @typedstandards/civic-typed-harness (S3a P1, #166; the verify-core shim
// pattern of #116-WS3 applied to the capture layer).
//
// The types + `TraceBuilder` live in the harness's capture group (ADR-0022
// §C). The harness's default config (`CIVICAITOOLS_TRACE_CONFIG`) carries this
// deployment's identity values (service.name, scope name/version, semconv
// version), so `new TraceBuilder()` emits byte-identical resource/scope
// blocks. `hash()` is re-backed by the @noble/hashes SHA-256 the stack
// single-sources through verify-core — same digest bytes as the prior
// node:crypto implementation. Wiring instance config (a non-demo service
// name) is P2 parameterization work, not this shim's.
export {
  TraceBuilder,
  hash,
  type SpanEvent,
  type OTelAttribute,
  type Span,
  type OTelTrace,
} from '@typedstandards/civic-typed-harness';
