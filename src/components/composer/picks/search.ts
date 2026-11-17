/**
 * The reader's search for data sources (S3-B W1, npstorey/civic-ai-tools#318; B7, B11, O5; the ORCH's A1, A2, A9,
 * A11), in the browser.
 *
 * ONE FUNCTION, ONE INDEX. The search is the router's own, `civicRouter.searchSources` (method `bm25` version 1), over
 * the router's index of its whole manifest: the function and the index the model's `find_source` reads
 * (`src/lib/mcp/routing-mode.ts`). The reader's search passes no space and no cut: every hit, offered or not, in the
 * ranking's order, with `top` the manifest's length, never the router's default of ten. So the reader's ranking,
 * limited to the model's search space and cut to ten, is the model's result for the same words.
 *
 * WHAT IT NEEDS TO KNOW. With no space the search reads the configuration only for the one-portal lock: a Socrata pack
 * fixed to another portal is never a hit (G0-6 = A). The browser gets the lock from what the root layout already
 * renders, `DefaultPortalProvider`'s two values, which the server resolves with the two functions
 * `readMcpEnvFromProcess()` reads (`isPortalLocked()`, `getDefaultPortal()`); `reader-search.test.ts` holds the two
 * equal on every row of the environment matrix. No other part of the configuration reaches the browser (it holds a
 * key). Which hits this site has set up is the flows statement's, which the page already reads.
 *
 * NOTHING IS SENT. The words stay in the page: the search reads the router's manifest, already in the page's bundle
 * (`src/lib/streaming.ts` imports the router), and nothing else.
 */

import { civicRouter, createSearchIndex, type McpRegistryEnv, type SearchSourcesInput, type SourceHit } from '@typedstandards/civic-typed-router';

/** The reader's cut: none. Every entry of the manifest may be a hit. */
export const READER_SEARCH_TOP: number = civicRouter.manifest.length;

/** The configuration the reader's search is given in the browser: the lock, and nothing else (A9). */
export function readerSearchConfiguration(locked: boolean, defaultPortal: string | null): McpRegistryEnv {
  return { dataCommonsUrl: '', ...(locked && defaultPortal ? { lockedPortal: defaultPortal } : {}) };
}

/** The search as the reader's function calls it; the router's by default (a test passes a spy). */
export type ReaderSearch = (input: SearchSourcesInput) => SourceHit[];

/** The reader's full ranking for `query`: source ids, best first, offered or not, with no space and no cut. */
export function readerRanking(query: string, configured: McpRegistryEnv, search: ReaderSearch = (input) => civicRouter.searchSources(input)): string[] {
  return search({ configured, query, top: READER_SEARCH_TOP }).map((hit) => hit.sourceId);
}

/**
 * Whether `query` holds a word the search can match (A2): the router's own tokenizer, through a one-entry index of
 * the query itself. An empty query, blanks or stopwords only hold none, so the search can return nothing for a reason
 * other than "no source matches", and the panel then lists what it lists before any words (R1).
 */
export function hasSearchableWord(query: string): boolean {
  return createSearchIndex([{ alias: '', displayName: query, description: '' }]).search(query).length > 0;
}
