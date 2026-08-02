// W3C PROV-O provenance graph — app-side shim over
// @typedstandards/civic-typed-harness (S3a P1, #166; the verify-core shim
// pattern of #116-WS3 applied to the capture layer).
//
// `buildProvenanceGraph` lives in the harness's capture group (ADR-0022 §C),
// rebuilt on produce-core's generic PROV-O types and node/edge helpers. The
// harness's default config (`CIVICAITOOLS_PROVENANCE_CONFIG`: platform agent,
// civic source registry, socrata fallback) reproduces this deployment's
// graphs byte-for-byte — including the golden-locked unknown-source
// agent-association fallback, which rides through unchanged per G0-2
// (preserve; cleanup is a deliberate post-S3a emission change). Wiring
// instance config is P2 parameterization work, not this shim's.
export {
  buildProvenanceGraph,
  type ProvGraph,
} from '@typedstandards/civic-typed-harness';
