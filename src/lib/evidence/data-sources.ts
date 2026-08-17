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

import { sourceIdForToolName } from '../mcp/operation-types.ts';
import {
  buildDataSources as harnessBuildDataSources,
  resolveToolSource as harnessResolveToolSource,
  displayNameForSource as harnessDisplayNameForSource,
  formatDataSourcesSummary as harnessFormatDataSourcesSummary,
  CIVIC_SOURCE_REGISTRY,
  type CivicSourceRegistry,
  type DataSourceEntry,
  type ToolCallSummary,
  type ToolSourceResolver,
} from '@typedstandards/civic-typed-harness';

export { CIVIC_SOURCE_REGISTRY, type CivicSourceRegistry, type DataSourceEntry, type ToolCallSummary };

/** Human-friendly display label for a `sourceId`, against this instance's
 *  source registry. Thin wrapper over the harness function — always passes
 *  `registry` explicitly (defaulting to `CIVIC_SOURCE_REGISTRY` here at the
 *  shim boundary) so the harness call never relies on its own default. */
export function displayNameForSource(
  sourceId: string | undefined | null,
  registry: CivicSourceRegistry = CIVIC_SOURCE_REGISTRY,
): string {
  return harnessDisplayNameForSource(sourceId, registry);
}

/** Compact, de-duplicated `dataSources` summary string, against this
 *  instance's source registry. Same explicit-registry thin-wrapper pattern
 *  as `displayNameForSource`. */
export function formatDataSourcesSummary(
  entries: DataSourceEntry[] | undefined,
  registry: CivicSourceRegistry = CIVIC_SOURCE_REGISTRY,
): string | null {
  return harnessFormatDataSourcesSummary(entries, registry);
}

/** The app's static tool-name → source-id map (`../mcp/operation-types.ts`)
 *  as a harness resolver — the fallback when a trace span carries no
 *  `mcp.source` attribute. */
const appToolSourceResolver: ToolSourceResolver = (toolName) =>
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
 */
export function buildDataSources(
  toolCalls: ToolCallSummary[],
  trace: Record<string, unknown>,
  fallbackPortal: string,
  now: string,
): DataSourceEntry[] {
  return harnessBuildDataSources(toolCalls, trace, fallbackPortal, now, {
    resolver: appToolSourceResolver,
  });
}
