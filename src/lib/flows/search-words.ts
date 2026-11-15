/**
 * S3-B W2 stub (npstorey/civic-ai-tools#318): the words a `find_source` call is read in. Typed stubs; the green
 * commit fills them.
 */

/** One search, as a record states it. */
export interface SearchReading {
  outcome: 'searched' | 'limit-reached';
  query: string;
  hits?: string[];
}

/** A graph activity's words on the Summary tab, when it is a search's; otherwise `undefined`. */
export function searchActivityDescription(node: Record<string, unknown>): string | undefined {
  void node;
  return undefined;
}

/** The replay dialog's lines for a recorded routing configuration. */
export function replayRoutingLines(configuration: unknown): string[] {
  void configuration;
  return [];
}
