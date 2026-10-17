// Multi-source `dataSources` extraction — app-side shim over
// @typedstandards/civic-typed-harness (S3a P1, #166; the verify-core shim
// pattern of #116-WS3 applied to the capture layer).
//
// The span-walk / population logic lives in the harness's capture group
// (ADR-0022 §C); `DataSourceEntry` is produce-core's envelope input shape,
// re-exported through the harness. The tool-name → source-id fallback map is
// APP-SIDE knowledge (the MCP registry lives in `../mcp/`), so this shim
// passes `sourceIdForToolName` into the harness's injectable resolver rather
// than relying on the harness's exported civic default — the app's own map
// stays authoritative, per the S3a contract. The display helpers wrap the
// harness's civic-registry-backed versions, passing this instance's registry
// (`CIVIC_SOURCE_REGISTRY`, the harness's own demo default) explicitly rather
// than letting the harness apply it implicitly — same names, same output,
// including the socrata coercion for pre-M9.3 packages and the middle-dot
// separator. Wiring a non-demo registry is P2 parameterization work, not this
// shim's.
//
// HOSTED SOURCES (#617 R7 WF). A source this instance RUNS (the router
// manifest's entries with a `hosting` field: NYC Charter today) is not in
// `CIVIC_SOURCE_REGISTRY`, so the harness walk skipped its calls as an unknown
// source and a run that answered from it signed `dataSources: []` — against
// specification §8.1.1, which wants one entry per source the analysis touched.
// `dataSourceRegistry` below is `CIVIC_SOURCE_REGISTRY` plus one aggregate
// entry per hosted source, and it is the registry `dataSources[]` is BUILT and
// DISPLAYED against. It is never the provenance graph's registry: the packager
// keeps reading `CIVICAITOOLS_PROVENANCE_CONFIG.sourceRegistry` there, so the
// graph does not move (giving a hosted source's agent `civic:serverUrl` is an
// open owner decision). `CIVIC_SOURCE_REGISTRY` is re-exported unchanged,
// because replay derives the `get_data`-addressable catalogue types from it,
// and `readerFacingSourceNames` keeps it as its default.

import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { sourceIdForToolName } from '../mcp/operation-types.ts';
import { hostedServerPurl } from '../mcp/registry.ts';
import {
  buildDataSources as harnessBuildDataSources,
  resolveToolSource as harnessResolveToolSource,
  displayNameForSource as harnessDisplayNameForSource,
  formatDataSourcesSummary as harnessFormatDataSourcesSummary,
  CIVIC_SOURCE_REGISTRY,
  type CivicSourceRegistry,
  type DataSourceEntry,
  type DatHereMcpServer,
  type ToolCallSummary,
  type ToolSourceResolver,
} from '@typedstandards/civic-typed-harness';

export { CIVIC_SOURCE_REGISTRY, type CivicSourceRegistry, type DataSourceEntry, type ToolCallSummary };

/**
 * The registry `dataSources[]` is built and displayed against:
 * `CIVIC_SOURCE_REGISTRY`, in its order, then one entry per hosted source in
 * the router manifest, in manifest order. A hosted entry is AGGREGATE (one
 * `dataSources` entry for any answered call, the shape Data Commons and Boston
 * already have), with:
 *   - `catalogType`: the hosting field's `kind` (`npm-package`), the kind of
 *     thing `portalUrl` names; it is not a `get_data`-addressable type, so
 *     replay never takes the entry for a portal;
 *   - `aggregatePortalUrl` (the entry's `portalUrl`): the package URL of what
 *     the RUN ran — the address its recorded server list (`runMcpServers`,
 *     from the trace's `analysis.mcp_servers`) gives the source id, which is
 *     the packager's own rule for the graph ("the trace's record wins"); the
 *     pin's purl (`hostedServerPurl`) only when the run recorded no address
 *     for it;
 *   - `displayName`: the manifest's display name without its "MCP Server"
 *     suffix, which is implementation language on the record page;
 *   - `agentTitle`: the title the provenance graph actually gives the source's
 *     agent (`<sourceId> MCP Server`, the harness's name for a source its
 *     registry lacks). Neither reader of this registry reads it; it is set to
 *     the signed value so that nothing here contradicts the graph;
 *   - no `serverUrl`.
 * With no hosted source in the walk the extra entries mint nothing, so a run
 * that touched none keeps the bytes it had.
 */
export function dataSourceRegistry(runMcpServers?: readonly DatHereMcpServer[]): CivicSourceRegistry {
  const registry: CivicSourceRegistry = { ...CIVIC_SOURCE_REGISTRY };
  for (const entry of CIVIC_MANIFEST) {
    const { hosting, sourceId } = entry;
    if (!hosting || Object.hasOwn(registry, sourceId)) continue;
    const recorded = runMcpServers?.find((server) => server.name === sourceId)?.url;
    registry[sourceId] = {
      displayName: entry.displayName.replace(/ MCP Server$/, ''),
      agentTitle: `${sourceId} MCP Server`,
      catalogType: hosting.kind,
      aggregatePortalUrl: recorded ? recorded : hostedServerPurl(hosting),
    };
  }
  return registry;
}

/** The display registry: `dataSourceRegistry()` with no run record (display reads names only). */
const DISPLAY_REGISTRY: CivicSourceRegistry = dataSourceRegistry();

/** Human-friendly display label for a `sourceId`, against this instance's
 *  source registry. Thin wrapper over the harness function — always passes
 *  `registry` explicitly (defaulting to the data-source registry here at the
 *  shim boundary, so a hosted source reads its own name rather than the
 *  harness's capitalised id) so the harness call never relies on its own
 *  default. */
export function displayNameForSource(
  sourceId: string | undefined | null,
  registry: CivicSourceRegistry = DISPLAY_REGISTRY,
): string {
  return harnessDisplayNameForSource(sourceId, registry);
}

/** Compact, de-duplicated `dataSources` summary string, against this
 *  instance's source registry. Same explicit-registry thin-wrapper pattern
 *  as `displayNameForSource`. */
export function formatDataSourcesSummary(
  entries: DataSourceEntry[] | undefined,
  registry: CivicSourceRegistry = DISPLAY_REGISTRY,
): string | null {
  return harnessFormatDataSourcesSummary(entries, registry);
}

/**
 * Rewrite every registry AGENT TITLE in a string to that source's reader-facing
 * DISPLAY NAME (hub #194, ruling D4 = B).
 *
 * WHAT THE PROBLEM IS. The signed PROV-O graph names each data source by its
 * agent title — "Socrata MCP Server", "Google Data Commons MCP Server" — and
 * builds descriptions from it: a data response the builder could not describe
 * by a portal is written "Data response from Socrata MCP Server", and the
 * graph's Agent nodes carry the title as their `dcterms:title`. "MCP Server" is
 * implementation language on a reader-facing surface
 * (`docs/design-principles.md`, Principle 9), and the same source is already
 * called "Socrata" three rows further up the page.
 *
 * WHY AT RENDER TIME AND NOT IN THE GRAPH. The graph is inside the signed
 * bytes. Changing what the builder writes would change every future package's
 * hash, and would not touch the records already published — which are the ones
 * a reader is looking at. Option A (a second registry field) was measured dead
 * in Wave N10: the prefix sits inside frozen golden bytes. So the map is
 * applied where the text is displayed, and NO SIGNED BYTE MOVES: the graph's
 * JSON-LD tab, the PROV-O download and the package itself are untouched, which
 * is also the right split under Principle 6 — the power user's escape hatch
 * shows exactly what was signed, the summary reads in the reader's language.
 *
 * The registry is passed explicitly, like every other helper in this shim, and
 * longer titles are rewritten first so one title that contains another cannot
 * be half-replaced.
 */
export function readerFacingSourceNames(
  text: string,
  registry: CivicSourceRegistry = CIVIC_SOURCE_REGISTRY,
): string {
  const byLongestTitle = Object.values(registry)
    .filter((entry) => entry.agentTitle && entry.displayName)
    .sort((a, b) => b.agentTitle.length - a.agentTitle.length);
  let mapped = text;
  for (const entry of byLongestTitle) {
    mapped = mapped.split(entry.agentTitle).join(entry.displayName);
  }
  return mapped;
}

/** The app's static tool-name → source-id map (`../mcp/operation-types.ts`)
 *  as a harness resolver — the fallback when a trace span carries no
 *  `mcp.source` attribute. It answers both spellings of every tool (#599 W3).
 *  The packager passes the same resolver to the provenance graph (#599 W4),
 *  so the graph and `dataSources[]` resolve an untagged call alike. */
export const appToolSourceResolver: ToolSourceResolver = (toolName) =>
  sourceIdForToolName(toolName);

/** Trace-span shape the resolver inspects. Structural — matches the span
 *  shape the harness walks (the harness does not export it). */
interface TraceSpan {
  name: string;
  attributes?: Array<{ key: string; value?: { stringValue?: string; intValue?: string; boolValue?: boolean } }>;
}

/**
 * Resolve the MCP source for a tool call. Prefers the `mcp.source` attribute
 * recorded on the matching `mcp_tool_call` span (the M9.1 source of truth);
 * falls back to the app's static tool-name mapping for packages written
 * before M9.1 or callers that ship an empty trace.
 */
export function resolveToolSource(
  toolCall: ToolCallSummary,
  span: TraceSpan | undefined,
): string {
  return harnessResolveToolSource(toolCall, span, appToolSourceResolver);
}

/**
 * Build the per-source evidence-package `dataSources` array. Same walk and
 * emission order as before the re-point (dataset-keyed Socrata entries in
 * first-seen order, then aggregate sources in registry order); the app's
 * tool-name map is injected as the span-attribute fallback resolver.
 *
 * A call whose summary carries `failed: true` mints no entry on either branch
 * — no dataset-keyed entry, and no aggregate source marked accessed (#192).
 * The harness reads that itself as of 0.4.0, so callers hand their records
 * through whole; this shim strips nothing.
 *
 * NO FALLBACK PORTAL. The harness's third positional parameter has been inert
 * since 0.3.1 — an entry states the portal the CALL carried, never the run's —
 * and 0.4.0 widened it to accept `undefined`, which is what a caller that has
 * stopped consulting it should pass. This wrapper therefore no longer takes
 * one, and passes `undefined` explicitly rather than letting a value travel to
 * a parameter nothing reads. The harness cannot drop the parameter before a
 * major (it is third of five positionals), which is why `undefined` is passed
 * here rather than the argument being omitted.
 *
 * `runMcpServers` is the servers the run recorded on its trace, when it
 * recorded them: a hosted source's entry states the address that list gives
 * it (`dataSourceRegistry`). The registry passed is `dataSourceRegistry`'s,
 * never the provenance graph's.
 */
export function buildDataSources(
  toolCalls: ToolCallSummary[],
  trace: Record<string, unknown>,
  now: string,
  runMcpServers?: readonly DatHereMcpServer[],
): DataSourceEntry[] {
  return harnessBuildDataSources(toolCalls, trace, undefined, now, {
    resolver: appToolSourceResolver,
    registry: dataSourceRegistry(runMcpServers),
  });
}
