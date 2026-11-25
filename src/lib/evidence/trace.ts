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
// a sixth when the run had a flows statement in force (R6 W2, #632 D2 = A),
// and two more on an in-loop run only (#644 W1, harness 0.10.0),
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

/**
 * The three root-span attributes an in-loop run adds (#644 W1; ADR-0033's
 * amendment 2, harness 0.10.0; the third, amendment 3, harness 0.12.0, S2-B
 * W4), after the six. Kept beside
 * `RUN_RECORD_ATTRIBUTE` rather than in it: `run-record-attributes.test.ts`
 * pins that object to exactly six names.
 */
export const IN_LOOP_RUN_RECORD_ATTRIBUTE = {
  /** JSON `{ method, version }`, exactly those keys: how the run's sources
   *  were chosen and the router's version. Written on an in-loop run only, so
   *  an all-sources record's bytes do not move. */
  routing: 'analysis.routing',
  /** The router's harness definition hash, lowercase hex SHA-256, a plain
   *  string. In-loop runs only. */
  definitionHash: 'analysis.definition_hash',
  /** JSON `{ inventory: { id, version, hash }, total, listed, rule,
   *  ruleVersion }`, exactly those keys: the source inventory the run was
   *  routed against, `version` in `<version>+<hash12>` form, and how many of
   *  its entries the model was shown. In-loop runs only (G0-B7 A). */
  considered: 'analysis.considered',
  /** JSON `{ rule: { id, version }, cap, search, inventory: { id, version,
   *  hash }, hash }`, exactly those keys in that order: the routing
   *  configuration the run was routed under (the router's
   *  `routingConfiguration`) and its hash (ADR-0033 amendment 5, harness
   *  0.14.0; S3-B W2, O4). In-loop runs only, as `considered` (G0-B7 A). */
  routingConfiguration: 'analysis.routing_configuration',
} as const;

/**
 * The format a run was asked for (OF2, Sprint OF-1, website #810; the seat's S8): JSON `{ id, version }`, exactly those
 * keys, on the root span, written by the route when the question named a format and absent under "Auto", so an "Auto"
 * run's root span is what it was before formats existed. This site's own attribute, not the harness's:
 * `extractRunAttributes` does not read it; the packager reads it back through `src/lib/output-format/record.ts` into
 * `extensions["org.civicaitools.output-format"].preset`. Kept beside `RUN_RECORD_ATTRIBUTE` rather than in it, as the
 * in-loop three are (`run-record-attributes.test.ts` pins that object to six names).
 */
export const OUTPUT_FORMAT_ATTRIBUTE = 'analysis.output_format';

/** The root-span attribute for a run asked in `format`; none for an "Auto" run. Exactly the two keys, in order. */
export function outputFormatAttributes(format: { id: string; version: string } | undefined): Record<string, string> {
  return format ? { [OUTPUT_FORMAT_ATTRIBUTE]: JSON.stringify({ id: format.id, version: format.version }) } : {};
}

/**
 * What a run in a map format presented (OF3a, website #810): JSON `{ outcome, counts?, map? }`, the record's members
 * of `extensions["org.civicaitools.output-format"]` beside `preset`, on the root span, written by the route at the
 * root's end once the run completed. Absent under "Auto", and for a format run that did not complete ("the run
 * recorded no outcome"). The trace is a publish input, so the record's map is read from here at publish
 * (`src/lib/output-format/record.ts`) and is in the signed package twice: inside the trace and in the extension.
 */
export const OUTPUT_FORMAT_RESULT_ATTRIBUTE = 'analysis.output_format_result';

/** The root-span attribute for what a map-format run presented; none when it presented nothing (an "Auto" run). */
export function outputFormatResultAttributes(presentation: { outcome: unknown; counts?: unknown; map?: unknown } | undefined): Record<string, string> {
  if (!presentation) return {};
  const { outcome, counts, map } = presentation;
  return { [OUTPUT_FORMAT_RESULT_ATTRIBUTE]: JSON.stringify({ outcome, ...(counts !== undefined ? { counts } : {}), ...(map !== undefined ? { map } : {}) }) };
}

/** What a run states about itself, before encoding. */
export interface RunRecordInput {
  assertedDate: string;
  mcpServers: ReadonlyArray<{ url: string; name?: string }>;
  toolDefinitions: ReadonlyArray<unknown>;
  sourcesOffered: ReadonlyArray<{ sourceId: string; alias: string; reason: string }>;
  components: ReadonlyArray<{ id: string; version?: string; guidanceHash?: string; guidanceOrigin?: string }>;
  /** The flows statement in force (`flowsStatementReference`); omitted when there is none. */
  flowsStatement?: { url: string; hash: string; date: string };
  /** How the run's sources were chosen (#644 W1); omitted under all-sources. */
  routing?: { method: string; version: string };
  /** The harness definition's hash (#644 W1); omitted under all-sources. */
  definitionHash?: string;
  /** What the run was routed against (S2-B W4); omitted under all-sources. */
  considered?: {
    inventory: { id: string; version: string; hash: string };
    total: number;
    listed: number;
    rule: string;
    ruleVersion: string;
  };
  /** The routing configuration and its hash (S3-B W2); omitted under all-sources. */
  routingConfiguration?: {
    rule: { id: string; version: string };
    cap: string;
    search: 'none' | { method: string; version: string };
    inventory: { id: string; version: string; hash: string };
    hash: string;
  };
}

/** The root-span attributes for a run, ready for `startRoot` or `endRoot`:
 *  five, and each of the last five only when passed, in the harness's order. */
export function runRecordAttributes(run: RunRecordInput): Record<string, string> {
  const { flowsStatement, routing, definitionHash, considered, routingConfiguration } = run;
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
    // Exactly the two keys, in the harness's order (#644 W1).
    ...(routing ? { [IN_LOOP_RUN_RECORD_ATTRIBUTE.routing]: JSON.stringify({ method: routing.method, version: routing.version }) } : {}),
    ...(definitionHash !== undefined ? { [IN_LOOP_RUN_RECORD_ATTRIBUTE.definitionHash]: definitionHash } : {}),
    // Exactly the five keys and the inventory's three, in the harness's order (S2-B W4).
    ...(considered
      ? {
          [IN_LOOP_RUN_RECORD_ATTRIBUTE.considered]: JSON.stringify({
            inventory: { id: considered.inventory.id, version: considered.inventory.version, hash: considered.inventory.hash },
            total: considered.total,
            listed: considered.listed,
            rule: considered.rule,
            ruleVersion: considered.ruleVersion,
          }),
        }
      : {}),
    // Exactly the five members and each object's own, in the harness's order (S3-B W2, ADR-0033 amendment 5).
    ...(routingConfiguration
      ? {
          [IN_LOOP_RUN_RECORD_ATTRIBUTE.routingConfiguration]: JSON.stringify({
            rule: { id: routingConfiguration.rule.id, version: routingConfiguration.rule.version },
            cap: routingConfiguration.cap,
            search: routingConfiguration.search === 'none'
              ? 'none'
              : { method: routingConfiguration.search.method, version: routingConfiguration.search.version },
            inventory: { id: routingConfiguration.inventory.id, version: routingConfiguration.inventory.version, hash: routingConfiguration.inventory.hash },
            hash: routingConfiguration.hash,
          }),
        }
      : {}),
  };
}
