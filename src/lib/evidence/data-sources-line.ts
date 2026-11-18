// A record's "Data sources used" line (CKAN-2-WEB P2; G0's D9, this site builds it; the owner's M6 = A with the
// card's rules, OA-1043). The record page's one renderer (`adaptRecord`) prints it; the harness formatter it replaces
// there (`formatDataSourcesSummary`, one display name per source) is unchanged.
//
// THE LINE. One item per source, in first-seen order, joined by " · ":
//   - A PACK prints "<its name> (<its portal's host>)", only on a record whose call says it used that pack: a call span
//     that states `mcp.pack_id` and was sent (`isSentPackCall`, the rule the chooser's pack credit reads; a call refused
//     before any request credits no pack). Nothing installed decides it: never a source id, never a `catalogType`. A
//     `dataSources` entry is the pack's when such a call, recorded under the entry's `sourceId` (`mcp.source`), names
//     the entry's portal (its `portal` argument, or the argument the source's registry entry names, `server_url` for
//     the CKAN server) and, when the entry has one, its dataset (`dataset_id`). An entry a bare call also names prints as
//     today: no rule covers it.
//   - THE CKAN SOURCE prints its name and its portals' hosts in first-seen order, "CKAN (<host>, <host>)". It is the
//     source whose id is the CKAN server's, never a `catalogType` (Boston OpenContext's entries carry `ckan` too). A
//     portal the model named by two addresses is listed once for each; two entries on one host print it once. A record
//     whose CKAN calls all went through the retired Boston pack prints that pack alone, by the pack rule above.
//   - EVERY OTHER SOURCE prints as today: its display name.
//
// FALLBACKS, unruled, so as today (no words invented): a pack id that resolves to no current or retired pack, and a
// portal address that does not parse, leave the entry to print as today's formatter prints it. A CKAN entry whose
// portal does not parse adds no host, and a CKAN item with no host reads as the source's name alone.
//
// Relative, extension-carrying imports, so the module runs under `node --test` with no loader, as its caller does.

import { CKAN_SERVER_SOURCE_ID, RETIRED_PACKS } from '@typedstandards/civic-typed-router';
import { attributesOf, isSentPackCall, spansOfTrace } from '../flows/source-chooser.ts';
import { packFilters } from '../mcp/pack-filter.ts';
import { dataSourceRegistry, displayNameForSource, type DataSourceEntry } from './data-sources.ts';

/** The display registry: the one the record's entries are displayed against. */
const REGISTRY = dataSourceRegistry();

/** The line's separator, as the harness formatter joins it. */
const SEPARATOR = ' · ';

/** The host an address names, as `URL` reads it; a bare host is read as an https address. Undefined when it does not parse. */
function hostOf(address: unknown): string | undefined {
  if (typeof address !== 'string') return undefined;
  const text = address.trim();
  if (text === '') return undefined;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).host;
    return host === '' ? undefined : host;
  } catch {
    return undefined;
  }
}

/** One tool call as the line reads it: the source it was recorded under, its pack id, whether it was sent as a pack call, its arguments. */
interface CallRead {
  source: string | undefined;
  packId: string | undefined;
  sentPack: boolean;
  args: Record<string, unknown>;
}

function callsOf(trace: unknown): CallRead[] {
  const calls: CallRead[] = [];
  for (const span of spansOfTrace(trace) ?? []) {
    if ((span as { name?: unknown } | null)?.name !== 'mcp_tool_call') continue;
    const attrs = attributesOf(span);
    if (attrs.get('tool.operation_type') === 'load_source') continue;
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(String(attrs.get('tool.arguments') ?? '{}'));
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      // Arguments that do not parse name no portal.
    }
    const source = attrs.get('mcp.source');
    const packId = attrs.get('mcp.pack_id');
    calls.push({
      source: typeof source === 'string' ? source : undefined,
      packId: typeof packId === 'string' ? packId : undefined,
      sentPack: isSentPackCall(attrs),
      args,
    });
  }
  return calls;
}

/** Whether a call names an entry: recorded under its source, naming its portal and, when it has one, its dataset. */
function names(call: CallRead, entry: DataSourceEntry): boolean {
  if (call.source === undefined || call.source !== entry.sourceId) return false;
  const portalArgument = REGISTRY[entry.sourceId]?.portalArgument ?? 'portal';
  const host = hostOf(entry.portalUrl);
  if (host === undefined || hostOf(call.args[portalArgument]) !== host) return false;
  return entry.datasetId === undefined || call.args.dataset_id === entry.datasetId;
}

/** A pack by the id its calls state: a current pack's name and portal host, or a retired pack's; undefined for any other id. */
function packOf(packId: string): { name: string; host: string } | undefined {
  for (const filter of packFilters().values()) {
    if (filter.packId !== packId) continue;
    const host = hostOf(filter.portal);
    return host === undefined ? undefined : { name: filter.source, host };
  }
  const retired = RETIRED_PACKS.find((pack) => pack.id === packId);
  const host = retired ? hostOf(retired.portal) : undefined;
  return retired && host !== undefined ? { name: retired.displayName, host } : undefined;
}

/** The pack an entry is, by the record's calls, or undefined when no rule covers it. */
function packOfEntry(entry: DataSourceEntry, calls: readonly CallRead[]): { name: string; host: string } | undefined {
  const naming = calls.filter((call) => names(call, entry));
  if (naming.some((call) => call.packId === undefined)) return undefined;
  const packIds = new Set(naming.filter((call) => call.sentPack).map((call) => call.packId as string));
  return packIds.size === 1 ? packOf([...packIds][0]) : undefined;
}

/**
 * The line for a record's `dataSources` and trace, or null when it has no entry (the page prints "—"). The trace is
 * the package's, read for its call spans; a record with no trace credits no pack.
 */
export function dataSourcesLine(entries: readonly DataSourceEntry[] | undefined, trace: unknown): string | null {
  if (!entries || entries.length === 0) return null;
  const calls = callsOf(trace);
  const items: string[] = [];
  let ckanAt = -1;
  const ckanHosts: string[] = [];
  for (const entry of entries) {
    const pack = packOfEntry(entry, calls);
    if (pack !== undefined) {
      items.push(`${pack.name} (${pack.host})`);
      continue;
    }
    if (entry.sourceId === CKAN_SERVER_SOURCE_ID) {
      if (ckanAt === -1) {
        ckanAt = items.length;
        items.push('');
      }
      const host = hostOf(entry.portalUrl);
      if (host !== undefined && !ckanHosts.includes(host)) ckanHosts.push(host);
      continue;
    }
    items.push(displayNameForSource(entry.sourceId));
  }
  if (ckanAt !== -1) {
    const name = displayNameForSource(CKAN_SERVER_SOURCE_ID);
    items[ckanAt] = ckanHosts.length > 0 ? `${name} (${ckanHosts.join(', ')})` : name;
  }
  return [...new Set(items)].join(SEPARATOR);
}
