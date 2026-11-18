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

import { CIVIC_MANIFEST, civicRouter, RETIRED_PACKS } from '@typedstandards/civic-typed-router';

// --- Both spellings (#599 W3) -------------------------------------------------
//
// Since W3 the model sees every tool as `<alias>__<upstream name>`
// (`socrata__get_data`, `boston_opencontext__ckan__search_datasets`), and every record made
// before W3 names it bare (`get_data`). Every site in this repository that
// keys on a tool name reads both: it keys on the UPSTREAM name, which the
// router's dispatch map gives for an exposed name and which a bare name already
// is. The map is read, never a name split: an upstream name may itself hold
// `__` (`ckan__search_datasets`).

/**
 * The upstream name of a tool name in either spelling: the name the server
 * declares and is called by on the wire. An exposed name (`socrata__get_data`)
 * gives its upstream name (`get_data`); any other name, a bare one included, is
 * returned as it is. `undefined` stays `undefined`, for a record that carries
 * no name.
 */
export function upstreamToolName(toolName: string): string;
export function upstreamToolName(toolName: string | undefined): string | undefined;
export function upstreamToolName(toolName: string | undefined): string | undefined {
  if (toolName === undefined) return undefined;
  const upstream = civicRouter.upstreamToolName(toolName);
  return upstream === toolName ? legacyUpstreamToolName(toolName) ?? upstream : upstream;
}

/**
 * Aliases a source had before a router release gave them to another source,
 * by alias, with the source and its upstream names then (CKAN-1 P3, A-C6).
 * Router 0.11.0 renamed Boston OpenContext's alias from `boston` to
 * `boston_opencontext` and gave `boston` to the Boston pack, so a record made
 * between #599 W3 and that release names OpenContext's tools
 * `boston__ckan__query_data` and the rest, which the router no longer maps.
 * Such a name is unambiguous: the pack's tools are `ckan_*`, never one of
 * OpenContext's `ckan__*`, and `legacy-tool-names.test.ts` fails the day a
 * source under one of these aliases gains a tool whose name this table maps.
 */
export const LEGACY_TOOL_ALIASES: Readonly<Record<string, { sourceId: string; tools: readonly string[] }>> = {
  boston: {
    sourceId: 'boston-opencontext',
    tools: CIVIC_MANIFEST.find((entry) => entry.sourceId === 'boston-opencontext')?.toolNames ?? [],
  },
};

/**
 * The tools each pack a router release retired offered under its alias, by the pack's `sourceId`, frozen as the
 * last release that offered it stated them (CKAN-2-WEB P1). Router 0.11.0's Analyze Boston (`boston`) offered six of
 * the CKAN server's tools: the six `CKAN_TOOL_NAMES` begins with, `ckan_status_show` not among them (router 0.12.0's
 * own words: "the six a CKAN pack called through 0.11.0, then `ckan_status_show`"). A record made then names them
 * `boston__ckan_package_search` and the rest, which no manifest maps since 0.12.0.
 */
const RETIRED_PACK_TOOLS: Readonly<Record<string, readonly string[]>> = {
  'boston-ckan': [
    'ckan_package_search',
    'ckan_find_relevant_datasets',
    'ckan_package_show',
    'ckan_list_resources',
    'ckan_datastore_search',
    'ckan_datastore_search_sql',
  ],
};

/** An old exposed name's reading: the source it named then, the source whose configuration would route its tool
 *  now, and its upstream name. */
interface OldExposedName {
  /** The source a record made then attributes the name to (`sourceIdForToolName`). */
  sourceId: string;
  /** The source whose server answers the tool: OpenContext for its old alias, the base for a retired pack. */
  serverSourceId: string;
  upstream: string;
}

/** A name under an old alias (`LEGACY_TOOL_ALIASES`) or a retired pack's (`RETIRED_PACKS`), read, or `undefined`. */
function oldExposedName(toolName: string): OldExposedName | undefined {
  const at = toolName.indexOf('__');
  if (at <= 0) return undefined;
  const alias = toolName.slice(0, at);
  const upstream = toolName.slice(at + 2);
  const legacy = LEGACY_TOOL_ALIASES[alias];
  if (legacy !== undefined && legacy.tools.includes(upstream)) return { sourceId: legacy.sourceId, serverSourceId: legacy.sourceId, upstream };
  const pack = RETIRED_PACKS.find((candidate) => candidate.alias === alias && (RETIRED_PACK_TOOLS[candidate.sourceId] ?? []).includes(upstream));
  return pack !== undefined ? { sourceId: pack.sourceId, serverSourceId: pack.base, upstream } : undefined;
}

/** The upstream name a legacy exposed name (`<old alias>__<upstream>`) stands for, or `undefined`. */
function legacyUpstreamToolName(toolName: string): string | undefined {
  return oldExposedName(toolName)?.upstream;
}

/**
 * The source whose server would answer a call under an old exposed name, by `sourceId`, or `undefined` for any other
 * name (CKAN-2-WEB P1, W11): Boston OpenContext's tools under its alias before router 0.11.0 (`boston__ckan__…`), and
 * the retired Analyze Boston pack's (`boston__ckan_…`), whose calls went to the CKAN server. No manifest entry holds
 * `boston` since router 0.12.0 (D7 = A), so the dispatch reads the name here, never through the live map.
 */
export function oldExposedNameServer(toolName: string): string | undefined {
  return civicRouter.upstreamToolName(toolName) === toolName ? oldExposedName(toolName)?.serverSourceId : undefined;
}

/** Whether `toolName`, in either spelling, is the civic tool `upstream`. */
export function isTool(toolName: string | undefined, upstream: string): boolean {
  return toolName !== undefined && upstreamToolName(toolName) === upstream;
}

/** What an `mcp_tool_call` span states about the names of the call it stands
 *  for (ADR-0033 §B): the name sent on the wire, and the alias and server
 *  identity of the source that answered. */
export interface ToolSpanNames {
  /** `tool.upstream_name`. */
  upstreamName: string;
  /** `mcp.alias`. */
  alias: string;
  /** `mcp.server.id`: the manifest entry's `id`. */
  serverId: string;
}

/** The value a span states for a source it cannot name, the same value the
 *  loop writes on `mcp.source` for a call no server took. */
export const UNKNOWN_TOOL_SOURCE = 'unknown';

/**
 * The names a `mcp_tool_call` span states for a call of `toolName` routed to
 * `sourceId` (the span's `mcp.source`). The alias and the server identity are
 * the routed source's, so the three attributes cannot disagree with
 * `mcp.source`: a call no server took (`unknown`) states `unknown` for both.
 * The upstream name is the dispatch map's for an exposed name; a bare name is
 * its own upstream name.
 */
export function toolSpanNames(toolName: string, sourceId: string): ToolSpanNames {
  const entry = CIVIC_MANIFEST.find((candidate) => candidate.sourceId === sourceId);
  return {
    upstreamName: upstreamToolName(toolName),
    alias: entry?.alias ?? UNKNOWN_TOOL_SOURCE,
    serverId: entry?.id ?? UNKNOWN_TOOL_SOURCE,
  };
}

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
  // The hosted CKAN server's six data tools (router 0.11.0's Boston pack's six,
  // CKAN-1 P3, A17; the server's own since router 0.12.0): two find datasets,
  // two read a dataset's description and its resources, and the two datastore
  // tools read records. Its seventh, `ckan_status_show`, is left untyped: it
  // reads no dataset (`operation-types.test.ts` states the reading).
  ckan_package_search: 'search',
  ckan_find_relevant_datasets: 'search',
  ckan_package_show: 'metadata',
  ckan_list_resources: 'metadata',
  ckan_datastore_search: 'query',
  ckan_datastore_search_sql: 'query',
  //
  // NYC CHARTER, LAWS AND RULES' FOUR OTHER TOOLS ARE DELIBERATELY ABSENT
  // (#617 P4, measured against each kind's readers: the step copy in
  // `streaming.ts`, the badge in `tool-badges.ts`, "records analyzed").
  // Its `search` derives `search` from the row above, by upstream name.
  //   - `get_section` returns the text of one section of law. `query` would
  //     count section text in "records analyzed"; `metadata` reads "the list
  //     of columns"; `catalog` reads "Found N datasets".
  //   - `list_titles` and `get_title` return chapter and title headings.
  //     `catalog` reads "datasets"; `metadata` reads "columns" and "Loaded
  //     metadata for <dataset>".
  //   - `get_version` returns each corpus's currency date and section count.
  //     `metrics` reads "Fetching metrics for <dataset>" and "how many records
  //     exist".
  // No kind is true of any of them, so each derives `undefined` and a record
  // states `unknown`, the honest absence `fetch` takes; the copy names the
  // tool ("Calling get_section...").
  //
  // `load_source`, the in-loop first-step tool (#644 W1, ADR-0037), is the
  // instance's own step: no source answers it and it reads no data. Its
  // operation type is its own name, the value the harness reads a load span
  // by (`tool.operation_type`, harness 0.10.0), and every renderer that
  // switches on the type has a case for it, so none narrates a load as a
  // data request. The router reserves the name, so no source's tool has it.
  load_source: 'load_source',
  //
  // `find_source`, the in-loop search (S3-B W2, harness 0.14.0), is the
  // instance's own step as `load_source` is: no source answers it and it reads
  // no data. Its operation type is its own name, the value the harness reads a
  // search span by, and every renderer that switches on the type has a case
  // for it. The router reserves the name, so no source's tool has it.
  find_source: 'find_source',
};

/**
 * Resolve the operation type for a tool call, named in either spelling.
 * Returns `undefined` when the operation cannot be determined — callers
 * typically fall back to `'unknown'`.
 */
export function deriveOperationType(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  // Keyed on the upstream name, so `socrata__search` and `search` derive the
  // same label (#599 W3).
  const upstream = upstreamToolName(toolName);
  const mapped = TOOL_OPERATION_TYPES[upstream];
  if (mapped) return mapped;
  // `args.type` is an operation type only for `get_data`, the one tool whose
  // `type` names one (catalog, metadata, query, metrics; #323). Kept to it
  // (R8 W3): NYS Open Legislation's `get_updates` carries a `type` naming the
  // date its feed is keyed on (processed, published), which is no operation,
  // and a name no source offers records nothing from its arguments.
  if (upstream !== 'get_data') return undefined;
  const argType = args.type;
  return typeof argType === 'string' ? argType : undefined;
}

/**
 * Every operation type `deriveOperationType` can return (#644 W2, LAYOUT-WEB-D's
 * test 2): the name map's values, and the values `get_data`'s `type` argument
 * takes, read from the router's own schema for it (the one tool whose `type`
 * names an operation, above). A type a step label has no words for would read
 * as an open step; `steps.test.ts` drives each one through the label.
 */
export const DERIVABLE_OPERATION_TYPES: readonly string[] = (() => {
  const getData = civicRouter.mcpTools.find((tool) => tool.function.name === 'get_data');
  const typeProperty = (getData?.function.parameters as { properties?: { type?: { enum?: unknown } } } | undefined)?.properties?.type;
  const argTypes = Array.isArray(typeProperty?.enum) ? typeProperty.enum.filter((v): v is string => typeof v === 'string') : [];
  return [...new Set([...Object.values(TOOL_OPERATION_TYPES), ...argTypes])];
})();

/**
 * Static tool-name → source-id map. Used as a fallback when the trace does
 * not carry an `mcp.source` attribute (pre-M9.1 packages, tests without a
 * full trace). The authoritative runtime mapping lives in `./registry.ts`;
 * this static version exists so pure-function callers (packager, tests) can
 * resolve sources without reading `process.env`. The map is
 * `@typedstandards/civic-typed-router`'s tool-to-source index, derived from its
 * schemas (#599 W2); the operation-type labels above stay the website's.
 */
export function sourceIdForToolName(toolName: string): string | undefined {
  // An exposed name resolves by the dispatch map; a bare name by the
  // package's index, as before W3 (#599 W3: both spellings answer the same);
  // a legacy exposed name by the source it named then (CKAN-1 P3, A-C6).
  const old = oldExposedName(toolName);
  if (old !== undefined && civicRouter.upstreamToolName(toolName) === toolName) return old.sourceId;
  return civicRouter.sourceForAliasedName(toolName)?.sourceId ?? civicRouter.sourceIdForToolName(toolName);
}
