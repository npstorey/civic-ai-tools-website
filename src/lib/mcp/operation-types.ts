// Map an MCP tool call to its semantic operation type — the label surfaced
// in traces (`tool.operation_type`), the UI, and evidence packages
// (queries[].operationType).
//
// Socrata's unified `get_data` tool carries the operation type in `args.type`
// (catalog | metadata | query | metrics). Every other tool — Socrata's own
// `search` and `fetch`, and all of Data Commons' and Boston OpenContext's —
// names one operation and emits no `args.type`, so the mapping is by tool name
// instead. A tool this map does not name derives to `undefined`, which the
// packager records as `'unknown'`; that is a real answer for a tool whose
// operation is not knowable from its name, and `fetch` below is one.

const TOOL_OPERATION_TYPES: Record<string, string> = {
  // Socrata's `search`, like the two other name-keyed discovery tools below,
  // carries no `args.type` — it takes one property, `query`. The server runs it
  // through the same catalog handler `get_data` type=catalog uses
  // (`handleSearchTool` -> `handleCatalog`) and answers with dataset
  // descriptors. Some hits carry a few `preview_rows`, and those are an
  // enrichment of a catalog hit rather than rows the analysis queried — which
  // is the second reason 'search' is right and 'query' is not: `records
  // analyzed` sums only `operationType === 'query'`, and preview rows must not
  // land in that total (#339).
  search: 'search',
  //
  // `fetch` IS DELIBERATELY ABSENT, and this comment is here so the next reader
  // does not helpfully fill the gap in. It is two operations behind one name.
  // `handleFetchTool` branches on the SHAPE OF THE `id` STRING at call time:
  // a `dataset:` identifier returns metadata (description + columns, no rows),
  // and a `record:` identifier calls `retrieveDocuments` and returns one real
  // data row. Nothing in the tool name distinguishes them, and the branch is
  // decided by an identifier grammar with five accepted forms that lives in the
  // MCP server — including a URL form classified by its query-string
  // parameters, and a bare 4x4 form resolved against the server's own default
  // domain. Typing it here would mean reimplementing that grammar in this
  // repository, where it would drift silently; and this label goes into a
  // SIGNED package, where a confident wrong answer is worse than an honest
  // absent one. 'metadata' would hide a genuine record read from `records
  // analyzed`; 'query' would count every dataset-metadata read as records
  // analyzed. So `fetch` derives to `undefined` and the packager records
  // 'unknown' — which asserts nothing false. Closing this properly means the
  // server reporting the operation it performed, not this file guessing.
  search_indicators: 'search',
  get_observations: 'query',
  ckan__search_datasets: 'search',
  ckan__get_dataset: 'metadata',
  ckan__get_schema: 'metadata',
  ckan__query_data: 'query',
  ckan__execute_sql: 'query',
  ckan__aggregate_data: 'query',
  //
  // POC MCP-WARM-VM: the NYC Charter source. Four of its five tools map; one
  // does not, and the reason is DIFFERENT from `fetch`'s above.
  nyc_charter__search: 'search',
  // Enumerates the top-level chapters of one corpus — the same shape as
  // Socrata's `type=catalog`: what is available, not what it says.
  nyc_charter__list_titles: 'catalog',
  // The upstream index is flat, so this returns chapter/title-LEVEL records,
  // explicitly not the sections inside them. That is metadata about a division
  // of the corpus.
  nyc_charter__get_title: 'metadata',
  // Currency dates per corpus — metadata about the source itself.
  nyc_charter__get_version: 'metadata',
  //
  // `nyc_charter__get_section` IS DELIBERATELY ABSENT, and like `fetch` this
  // comment is here so the next reader does not fill the gap in. It is not
  // ambiguous the way `fetch` is — we know exactly what it does: it returns
  // the full text of one section of law. The problem is that THIS VOCABULARY
  // HAS NO TERM FOR THAT. catalog / metadata / query / metrics / search were
  // derived from tabular open-data portals, where the unit is a row.
  // 'query' is the tempting entry and is the worst of them: `records analyzed`
  // sums operationType === 'query' (#339), so every section read would land in
  // a signed package as a record analyzed, and a three-section answer would
  // report "3 records analyzed" about a body of law with 22,050 sections.
  // 'metadata' is false in the other direction — the section text is the
  // primary source, not data about it.
  // So it derives to `undefined` and the packager records 'unknown', which
  // asserts nothing false. Closing this properly means adding a term for
  // primary-text retrieval to the operation vocabulary — a charter decision
  // about what a record MEANS for a non-tabular source, not a line here.
};

const SOURCE_BY_TOOL_NAME: Record<string, string> = {
  get_data: 'socrata',
  search: 'socrata',
  fetch: 'socrata',
  search_indicators: 'data-commons',
  get_observations: 'data-commons',
  ckan__search_datasets: 'boston-opencontext',
  ckan__get_dataset: 'boston-opencontext',
  ckan__query_data: 'boston-opencontext',
  ckan__get_schema: 'boston-opencontext',
  ckan__execute_sql: 'boston-opencontext',
  ckan__aggregate_data: 'boston-opencontext',
  // POC MCP-WARM-VM. The SOURCE is knowable from the name for all five —
  // that is what the `nyc_charter__` prefix buys — including the one tool
  // whose OPERATION is not.
  nyc_charter__search: 'nyc-charter',
  nyc_charter__get_section: 'nyc-charter',
  nyc_charter__list_titles: 'nyc-charter',
  nyc_charter__get_title: 'nyc-charter',
  nyc_charter__get_version: 'nyc-charter',
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
