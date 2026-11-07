/**
 * The Settings overlay's search over the configured data sources (UX-2 P4b,
 * item 17): a source matches when its reader name or its "what" line holds
 * the query. A typed stub for the red commit: it matches every source.
 */

export interface SearchableSource {
  sourceId: string;
  /** The reader name (`readerSourceName`). */
  name: string;
  /** The row's "what" line (`sourceRowLines(source).what`), or null. */
  what: string | null;
}

export function matchingSources<T extends SearchableSource>(sources: readonly T[], query: string): T[] {
  void query;
  return [...sources];
}
