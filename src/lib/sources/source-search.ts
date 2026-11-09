/**
 * The Settings overlay's search over the configured data sources (UX-2 P4b,
 * item 17): a source matches when its reader name or its "what" line holds
 * the query, case-insensitive, the query's surrounding spaces ignored. An
 * empty query matches every source. The order is the sources' own.
 */

export interface SearchableSource {
  sourceId: string;
  /** The reader name (`readerSourceName`). */
  name: string;
  /** The row's "what" line (`sourceRowLines(source).what`), or null. */
  what: string | null;
}

export function matchingSources<T extends SearchableSource>(sources: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...sources];
  return sources.filter((s) => s.name.toLowerCase().includes(needle) || (s.what ?? '').toLowerCase().includes(needle));
}
