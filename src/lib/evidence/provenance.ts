// W3C PROV-O provenance graph — app-side shim over
// @typedstandards/civic-typed-harness (S3a P1, #166; the verify-core shim
// pattern of #116-WS3 applied to the capture layer).
//
// `buildProvenanceGraph` lives in the harness's civic layer (since 0.7.0,
// `src/civic/provenance.ts`), rebuilt on produce-core's generic PROV-O types
// and node/edge helpers. The packager passes this instance's config
// (`instanceProvenanceConfig` in `packager.ts`): its platform agent, a source
// registry carrying the addresses the RUN had when the trace records them
// (#495, `withRunServerAddresses`), and the app's tool-name resolver.
//
// THE SOCRATA FALLBACK IS GONE (harness 0.7.0, ADR-0033 §A). Until 0.7.0 a
// call whose span named a source the registry lacked, or that nothing
// identified, was associated with the Socrata agent — in a run that never
// called Socrata, an agent the graph did not contain. Each call is now
// associated with its own source's agent, and a call nothing identifies with
// an agent named `unknown`. A record signed before the bump keeps its bytes;
// only a new package moves.
export {
  buildProvenanceGraph,
  type ProvGraph,
} from '@typedstandards/civic-typed-harness';
