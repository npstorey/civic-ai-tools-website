/**
 * Servers this site once ran for a source and runs no longer: recorded
 * history, frozen (S2-B, npstorey/civic-ai-tools#309; card G0-B4 A).
 *
 * A record sealed while a source was hosted names that source's server and
 * pin. When a router release retires the server, the manifest stops carrying
 * them, but the records do not change: they still name the source by its id
 * and their calls by the retired tools. This module keeps what those records
 * need, copied from the last manifest that carried it, so the record page
 * still names the source (`../evidence/data-sources.ts`) and a replay can say
 * which server and pin a step it does not re-run used (P3's replay cell).
 *
 * Nothing here is configuration and nothing here is offered to a run. Values
 * are never edited: a later retirement adds an entry.
 */

/** A retired server's last pin, as the last manifest that carried it stated it. */
export interface RetiredHostedServer {
  /** The manifest's `displayName` for the source at retirement. */
  displayName: string;
  /** The source's alias, which a record's call names prefix (`<alias>__<tool>`). */
  alias: string;
  /** The retired server's tool names, as the last manifest that declared them listed them. */
  toolNames: readonly string[];
  /** The npm package the instance ran in its sandbox. */
  package: string;
  /** Its last pinned version. */
  version: string;
  /** The commit the registry stated for that version. */
  commit: string;
  /** The releases that retired it. */
  retiredBy: { router: string; inventory: string };
}

/**
 * NYC City Record's server, `@betanyc/nyc-record-mcp@1.1.0`, as router 0.6.0's
 * manifest pinned it (the hosted variant routers 0.6.0 and 0.7.0 offered by
 * its own switch).
 * Retired by router 0.8.0 (inventory 2026-11-09.1), under which City Record
 * is a pack over the Socrata server; its `sourceId` and alias are kept.
 *
 * `alias` and `toolNames` (S2-B W11) were read by script from router 0.6.0's
 * published `CIVIC_MANIFEST`, the last release this site pinned (tarball sha1
 * `b54b8b1b9c5f0f87d17857b51f4d38e559340b55`, the registry's `dist.shasum`);
 * router 0.7.0 carries the same seven. No manifest from 0.8.0 on declares
 * them, so a replayed notebook step that names one is known by this entry
 * (`../notebook-author/tool-to-cell.ts`).
 */
export const RETIRED_HOSTED_SERVERS: Readonly<Record<string, RetiredHostedServer>> = {
  'nyc-record': {
    displayName: 'NYC City Record MCP Server',
    alias: 'nyc_record',
    toolNames: [
      'search_notices',
      'get_notices_by_agency',
      'get_notices_by_type',
      'get_procurement_notices',
      'get_public_hearings',
      'get_open_solicitations',
      'get_notices_by_date_range',
    ],
    package: '@betanyc/nyc-record-mcp',
    version: '1.1.0',
    commit: '6c52a5353381592713678caa109870d1e912c858',
    retiredBy: { router: '0.8.0', inventory: '2026-11-09.1' },
  },
};
