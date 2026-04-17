// Map an MCP tool call to its semantic operation type — the label surfaced
// in traces (`tool.operation_type`), the UI, and evidence packages
// (queries[].operationType).
//
// Socrata's unified `get_data` tool carries the operation type in `args.type`
// (catalog | metadata | query | metrics). Data Commons uses distinct tool
// names for each operation and does not emit an `args.type` field, so the
// mapping is by tool name instead.

const TOOL_OPERATION_TYPES: Record<string, string> = {
  search_indicators: 'search',
  get_observations: 'query',
};

const SOURCE_BY_TOOL_NAME: Record<string, string> = {
  get_data: 'socrata',
  search: 'socrata',
  fetch: 'socrata',
  search_indicators: 'data-commons',
  get_observations: 'data-commons',
};

/**
 * Resolve the operation type for a tool call. Returns `undefined` when the
 * operation cannot be determined — callers typically fall back to `'unknown'`.
 */
export function deriveOperationType(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  const mapped = TOOL_OPERATION_TYPES[toolName];
  if (mapped) return mapped;
  const argType = args.type;
  return typeof argType === 'string' ? argType : undefined;
}

/**
 * Static tool-name → source-id map. Used as a fallback when the trace does
 * not carry an `mcp.source` attribute (pre-M9.1 packages, tests without a
 * full trace). The authoritative runtime mapping lives in `./registry.ts`;
 * this static version exists so pure-function callers (packager, tests) can
 * resolve sources without reading `process.env`.
 */
export function sourceIdForToolName(toolName: string): string | undefined {
  return SOURCE_BY_TOOL_NAME[toolName];
}
