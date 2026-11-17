/**
 * How a `find_source` call is read and worded (S3-B W2, npstorey/civic-ai-tools#318): every surface that reads a run
 * or a record reads a search as the instance's own step, never as a source's call. One module, so the chooser line,
 * the record page's steps, the graph's Summary tab, the progress lines, the notebook and the replay dialog say the
 * same thing from the same reading.
 *
 * The record's words are bundle revision 5's (`SOURCE_CHOOSER_SEARCH`, `ROUTING_CONFIGURATION_TEXT`); the site's own
 * words where the bundle has none are `FIND_SOURCE_WORDS` (r2, research-checked). Pure: no I/O, no server module,
 * so a client surface may import it.
 */

import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';
import { FIND_SOURCE_WORDS, ROUTING_CONFIGURATION_TEXT, SOURCE_CHOOSER_SEARCH } from '../sources/copy.ts';
import { readerSourceName } from '../sources/source-name.ts';

/** The operation type a search's call and span carry (`FIND_SOURCE_OPERATION_TYPE` in the loop core). */
export const SEARCH_OPERATION = 'find_source';

/** One search, as a record states it: its span's outcome, query and, on `searched`, hits by source id. */
export interface SearchReading {
  outcome: 'searched' | 'limit-reached';
  query: string;
  hits?: string[];
}

/** The site's names for a search's hits, in their order; an id the manifest does not hold, as written. */
export function hitNames(ids: readonly string[]): string[] {
  return ids.map((id) => {
    const entry = CIVIC_MANIFEST.find((candidate) => candidate.sourceId === id);
    return entry ? readerSourceName({ sourceId: entry.sourceId, displayName: entry.displayName }) : id;
  });
}

/** The search's opening sentence, closed: the model's words quoted, or the bundle's empty-query sentence. */
function opening(reading: SearchReading): string {
  const S = SOURCE_CHOOSER_SEARCH;
  if (reading.outcome === 'limit-reached') return reading.query === '' ? S.limitedEmpty : `${S.limited(reading.query)}.`;
  return reading.query === '' ? S.searchedEmpty : `${S.searched(reading.query)}.`;
}

/**
 * A search in the record's words (bundle :205, :214 and :187 for `searched`; :196 for `limit-reached`): the chooser
 * line's sentence for the call, and the record page's step outcome (r2's S14, S15).
 */
export function searchRecordSentences(reading: SearchReading): string {
  const S = SOURCE_CHOOSER_SEARCH;
  if (reading.outcome === 'limit-reached') return `${opening(reading)} ${S.limitReached}`;
  return `${opening(reading)} ${S.hits(hitNames(reading.hits ?? []))} ${S.bySite}`;
}

/** The record page's outcome for a search call: its words, or, when the trace cannot be read for it, S16. */
export function searchStepOutcome(reading: SearchReading | undefined): string {
  return reading ? searchRecordSentences(reading) : FIND_SOURCE_WORDS.recordUnread;
}

/** A live run's result line for a search (S5 to S8): what it returned, or that it did not run. */
export function searchResultLine(outcome: string | undefined, hits: readonly string[] | undefined): string | null {
  if (outcome === 'searched') return SOURCE_CHOOSER_SEARCH.hits(hitNames(hits ?? []));
  if (outcome === 'limit-reached') return SOURCE_CHOOSER_SEARCH.limitReached;
  return null;
}

/** The query a call's arguments state, as the loop records and searches it: `''` for one that is not a string. */
export function searchQueryOf(args: Record<string, unknown> | undefined): string {
  return typeof args?.query === 'string' ? args.query : '';
}

/** The live progress line for a search (S3, S4), from the query the span records. */
export function searchProgressLine(args: Record<string, unknown> | undefined): string {
  const query = searchQueryOf(args);
  return query === '' ? FIND_SOURCE_WORDS.progressEmpty : FIND_SOURCE_WORDS.progress(query);
}

/** One notebook line for a search (S20, S21). */
export function searchNotebookLine(reading: SearchReading): string {
  return `- ${searchRecordSentences(reading).replace(` ${SOURCE_CHOOSER_SEARCH.bySite}`, '')}`;
}

/**
 * A graph activity's words on the record's Summary tab (S17), when it is a search's: bundle :205's opening sentence
 * for `searched`, :196's for `limit-reached`, read from `civic:searchOutcome` and `civic:searchQuery`. `undefined`
 * for any other node, which keeps its own words. The JSON-LD tab is never mapped.
 */
export function searchActivityDescription(node: Record<string, unknown>): string | undefined {
  const outcome = node['civic:searchOutcome'];
  if (outcome !== 'searched' && outcome !== 'limit-reached') return undefined;
  const query = typeof node['civic:searchQuery'] === 'string' ? node['civic:searchQuery'] : '';
  const S = SOURCE_CHOOSER_SEARCH;
  if (outcome === 'limit-reached') return query === '' ? S.limitedEmpty : S.limited(query);
  return query === '' ? S.searchedEmpty : S.searched(query);
}

/** A recorded routing configuration, as a record's composition block states it. */
export interface RoutingConfigurationShown {
  rule: { id: string; version: string };
  cap: string;
  search: 'none' | { method: string; version: string };
  inventory: { id: string; version: string; hash: string };
  hash: string;
}

/** Whether a recorded configuration states that the run offered the model a search (the dialog's condition). */
export function offeredASearch(configuration: unknown): boolean {
  const search = (configuration as { search?: unknown } | null | undefined)?.search;
  return search !== null && typeof search === 'object';
}

/** Whether `value` is an object whose members `keys` are each a string. */
function hasStrings(value: unknown, ...keys: string[]): boolean {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => typeof record[key] === 'string');
}

/**
 * A recorded configuration of the complete shape the dialog reads, with a search (S3-B F, the cold read's F2): `rule`
 * with `id` and `version`, `cap`, `search` with `method` and `version`, `inventory` with `id` and `version`, and
 * `hash`, each a string (`cap` may be `'none'`). Null for any other value: a record's composition block can carry any
 * object (`recordRoutingConfiguration`), and a caller's `extensions` reach that block.
 */
function shownConfiguration(configuration: unknown): (RoutingConfigurationShown & { search: { method: string; version: string } }) | null {
  if (!offeredASearch(configuration)) return null;
  const c = configuration as Record<string, unknown>;
  const complete = hasStrings(c, 'cap', 'hash')
    && hasStrings(c.rule, 'id', 'version')
    && hasStrings(c.search, 'method', 'version')
    && hasStrings(c.inventory, 'id', 'version');
  return complete ? (configuration as RoutingConfigurationShown & { search: { method: string; version: string } }) : null;
}

/**
 * The replay dialog's lines for a recorded routing configuration (S22, then bundle :115's small print, S23): shown
 * only for a record whose run offered a search (`offeredASearch`), which is the one case where a replay, which lists
 * its whole set and offers no search, is routed differently from the run, and only for a configuration of the complete
 * shape it reads (`shownConfiguration`). Empty for any other value; it never throws.
 */
export function replayRoutingLines(configuration: unknown): string[] {
  const c = shownConfiguration(configuration);
  if (c === null) return [];
  const T = ROUTING_CONFIGURATION_TEXT;
  return [
    FIND_SOURCE_WORDS.replayIntro,
    T.searchOffered(c.search.method, c.search.version),
    c.cap === 'none' ? T.capNone : T.cap(c.cap),
    T.rule(c.rule.id, c.rule.version),
    T.inventory(c.inventory.id, c.inventory.version),
    T.hash(c.hash),
  ];
}

// --- Reading a trace ---------------------------------------------------------------------------------------------

/** A span's attributes by key, each its string, boolean or integer value. */
function attributesOfSpan(span: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const list = (span as { attributes?: unknown } | null)?.attributes;
  if (!Array.isArray(list)) return out;
  for (const attribute of list as Array<{ key?: unknown; value?: { stringValue?: unknown; boolValue?: unknown; intValue?: unknown } }>) {
    if (typeof attribute?.key !== 'string') continue;
    const value = attribute.value?.stringValue ?? attribute.value?.boolValue ?? attribute.value?.intValue;
    out.set(attribute.key, value);
  }
  return out;
}

/** A search span's reading, or `undefined` for a span that is not a well-formed search span. */
function readingOf(span: unknown): SearchReading | undefined {
  const attrs = attributesOfSpan(span);
  if (attrs.get('tool.operation_type') !== SEARCH_OPERATION) return undefined;
  const outcome = attrs.get('tool.search_outcome');
  const query = attrs.get('tool.search_query');
  if ((outcome !== 'searched' && outcome !== 'limit-reached') || typeof query !== 'string') return undefined;
  if (outcome === 'limit-reached') return { outcome, query };
  let hits: unknown;
  try {
    hits = JSON.parse(String(attrs.get('tool.search_hits')));
  } catch {
    return undefined;
  }
  if (!Array.isArray(hits) || !hits.every((hit) => typeof hit === 'string')) return undefined;
  return { outcome, query, hits: hits as string[] };
}

/** The `mcp_tool_call` spans of a trace's span list, in order. */
function toolSpans(spans: readonly unknown[]): unknown[] {
  return spans.filter((span) => (span as { name?: unknown } | null)?.name === 'mcp_tool_call');
}

/** The searches a trace's spans state, in call order. */
export function searchesOfSpans(spans: readonly unknown[]): SearchReading[] {
  return toolSpans(spans).flatMap((span) => {
    const reading = readingOf(span);
    return reading ? [reading] : [];
  });
}

/** A record's inline span list, or `null` when its trace is absent or stored by reference. */
export function spanList(trace: unknown): unknown[] | null {
  const resourceSpans = (trace as { resourceSpans?: unknown } | null)?.resourceSpans;
  if (!Array.isArray(resourceSpans)) return null;
  return resourceSpans.flatMap((resource: { scopeSpans?: Array<{ spans?: unknown[] }> }) =>
    (resource?.scopeSpans ?? []).flatMap((scope) => (Array.isArray(scope?.spans) ? scope.spans : [])));
}

/**
 * Each search call's reading, by its index in a record's `queries[]`: the tool spans pair with the entries by
 * position, as the harness pairs them, only when the counts agree and the span at the position names the entry's
 * tool. Otherwise empty, and the record page states S16 for the call.
 */
export function searchReadingsByQuery(trace: unknown, queries: ReadonlyArray<{ tool?: string }>): Map<number, SearchReading> {
  const out = new Map<number, SearchReading>();
  const spans = spanList(trace);
  if (spans === null) return out;
  const tools = toolSpans(spans);
  if (tools.length !== queries.length) return out;
  queries.forEach((query, i) => {
    if (attributesOfSpan(tools[i]).get('tool.name') !== query.tool) return;
    const reading = readingOf(tools[i]);
    if (reading) out.set(i, reading);
  });
  return out;
}
