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
