/**
 * A recorded alias, read as the record meant it (CKAN-1 P3, A-C6).
 *
 * An alias names a source only within the router release that ran: router
 * 0.11.0 renamed Boston OpenContext's alias from `boston` to
 * `boston_opencontext` and gave `boston` to the Boston pack. A record made
 * before then that loaded `boston` loaded OpenContext, and a reader that
 * resolves the alias through the live manifest names the pack instead.
 *
 * A record carries what tells the two apart, each of it its own: its
 * `sourcesOffered` rows (alias and `sourceId`, in its composition block or on
 * its trace's root span), and its call spans' `mcp.alias` beside `mcp.source`.
 * The resolver reads those first, in that order, and the live manifest only
 * for an alias the record states nowhere: a record that carries neither is a
 * record made before `sourcesOffered` (#599 W4) and before in-loop routing, and
 * names no alias to load. A tool name under an old alias is read by
 * `LEGACY_TOOL_ALIASES` (`../mcp/operation-types.ts`).
 */
import { CIVIC_MANIFEST } from '@typedstandards/civic-typed-router';

/** The fields of a stored package this module reads. */
export interface RecordedAliasSource {
  extensions?: Record<string, unknown>;
  trace?: unknown;
}

type Attr = { key?: string; value?: { stringValue?: string } };
type SpanLike = { parentSpanId?: string; attributes?: Attr[] };

function spansOf(trace: unknown): SpanLike[] {
  const resourceSpans = trace && typeof trace === 'object' ? (trace as { resourceSpans?: unknown }).resourceSpans : undefined;
  if (!Array.isArray(resourceSpans)) return [];
  return (resourceSpans as Array<{ scopeSpans?: Array<{ spans?: SpanLike[] }> }>).flatMap((r) => (r?.scopeSpans ?? []).flatMap((s) => s?.spans ?? []));
}

const attrsOf = (span: SpanLike): Record<string, string | undefined> =>
  Object.fromEntries((span.attributes ?? []).map((a) => [a?.key, a?.value?.stringValue]));

function rowsOf(value: unknown): Array<{ sourceId: string; alias: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const r = row as { sourceId?: unknown; alias?: unknown } | null;
    return r && typeof r.sourceId === 'string' && typeof r.alias === 'string' ? [{ sourceId: r.sourceId, alias: r.alias }] : [];
  });
}

/**
 * The `sourceId` a record's alias named when the record was made, or
 * `undefined` for an alias no row, span or manifest entry names.
 */
export function recordedAliasResolver(pkg: RecordedAliasSource | null | undefined): (alias: unknown) => string | undefined {
  const named = new Map<string, string>();
  const add = (alias: string, sourceId: string) => { if (!named.has(alias)) named.set(alias, sourceId); };
  const composition = pkg?.extensions?.['org.civicaitools.composition'] as { sourcesOffered?: unknown } | undefined;
  for (const row of rowsOf(composition?.sourcesOffered)) add(row.alias, row.sourceId);
  const spans = spansOf(pkg?.trace);
  const root = spans.find((span) => span.parentSpanId === undefined);
  if (root) {
    try {
      for (const row of rowsOf(JSON.parse(attrsOf(root)['analysis.sources_offered'] ?? 'null'))) add(row.alias, row.sourceId);
    } catch {
      /* a root that states no readable rows names nothing */
    }
  }
  for (const span of spans) {
    const attrs = attrsOf(span);
    const alias = attrs['mcp.alias'];
    const source = attrs['mcp.source'];
    if (alias && source && alias !== 'unknown' && source !== 'unknown') add(alias, source);
  }
  return (alias) => {
    if (typeof alias !== 'string') return undefined;
    return named.get(alias) ?? CIVIC_MANIFEST.find((entry) => entry.alias === alias)?.sourceId;
  };
}

/**
 * A record's calls with each `load_source` call's alias read as the record
 * meant it and given the alias that source has in the installed manifest, for
 * the readers that name a loaded source by the live manifest (the step view's
 * label and sentence). Display only: the record's own bytes are not touched,
 * and an alias whose source the manifest no longer has is left as recorded.
 */
export function withCurrentLoadAliases<Q extends { tool?: string | null; arguments?: Record<string, unknown> }>(
  queries: readonly Q[],
  pkg: RecordedAliasSource | null | undefined,
): Q[] {
  const resolve = recordedAliasResolver(pkg);
  return queries.map((query) => {
    const alias = query.arguments?.alias;
    if (query.tool !== 'load_source' || typeof alias !== 'string') return query;
    const sourceId = resolve(alias);
    const current = CIVIC_MANIFEST.find((entry) => entry.sourceId === sourceId)?.alias;
    return current === undefined || current === alias ? query : { ...query, arguments: { ...query.arguments, alias: current } };
  });
}
