/**
 * UX-2 P6 + P10 (#729; contract p6p10.md item 7, PQ3 = (a), 0c's rule, 0d item 2): the directory-to-source mapping.
 *
 * The directory lists the community index's entries; this instance offers the sources its statement lists. They are
 * two id spaces, and no field joins them, so the join is this one explicit table. THE RULE: an entry maps to a source
 * when it is that source's server or package, or the entry the router keeps for it (`nyc-record` keeps
 * `nyc-record-mcp`, the retired package's entry: the router's carry-over note). Every value is a manifest `sourceId`
 * at the router this codebase pins; `directory-source-map.test.ts` holds the table to that and to the index.
 *
 * NOT HERE, stated: `ckan-server` (CKAN-1's P3) is a manifest `sourceId` from router 0.11.0, and no entry maps to it;
 * `boston-ckan`, the pack over it, was retired by router 0.12.0. The hosted CKAN server's entry (`ckan-mcp-server`)
 * and its badge are hub #329's to add (OA-941 = A: `CKAN_MCP_URL` is unset). `boston-core-mcp` is another maintainer's server and maps to nothing.
 */

/** Directory entry id → the `sourceId` of the source that entry is. */
export const DIRECTORY_SOURCE_MAP: Readonly<Record<string, string>> = Object.freeze({
  'socrata-mcp-server': 'socrata',
  'data-commons-mcp': 'data-commons',
  'nyc-charter-laws-rules': 'nyc-charter',
  'nyc-checkbook-mcp': 'nyc-checkbook',
  'nys-openlegislation-mcp': 'nys-legislation',
  'nyc-record-mcp': 'nyc-record',
  opencontext: 'boston-opencontext',
});

/** The source a directory entry is, when this instance offers it (`offered`: its statement's ids); otherwise null. */
export function offeredSourceFor(entryId: string, offered: readonly string[]): string | null {
  const sourceId = Object.prototype.hasOwnProperty.call(DIRECTORY_SOURCE_MAP, entryId) ? DIRECTORY_SOURCE_MAP[entryId] : undefined;
  return sourceId !== undefined && offered.includes(sourceId) ? sourceId : null;
}
