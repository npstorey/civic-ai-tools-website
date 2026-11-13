/**
 * The base check (S2-B P3R, npstorey/civic-ai-tools#309; the seat's 6823831237;
 * route-identity C1 = A, C2 = A; router 0.9.0's `checkBasePins`).
 *
 * A pack's calls go to its base's server. Since router 0.9.0 a pack's manifest
 * entry states `pack.basePins`: what the base reported when the pack was written
 * (its `serverInfo` name and version, and `mcpToolSchemaSha256` of each base tool
 * the pin names). Bundle revision 4's refusal rule says a producer sends a pack's
 * calls only after the live base matched a pin. This module is that check, run by
 * the loop core (`../model-loop/run-tool-loop.ts`) before every pack call, at the
 * one site that sends one:
 *
 *   - THE READ. The base's `tools/list`, every page, and the `serverInfo` of the
 *     handshake it was answered on (`readServerTools`, `./client.ts`).
 *   - THE CACHE. Per run (one `createBaseCheck` per loop), keyed by the base's
 *     `sourceId`. A read is kept five minutes, whether it matched or not; a pack
 *     call after that reads again, and that read decides. A read that failed is
 *     not kept.
 *   - A MISMATCH, or a throw from `checkBasePins` (a malformed observation: a
 *     listed tool with no `inputSchema`, or a page with no `tools` array):
 *     `BaseChangedError`. Nothing is sent; the call is recorded `base_changed`.
 *   - A FAILED READ (unreachable, an error status, a timeout, a JSON-RPC error, a
 *     repeating cursor, paging past the bound): `BaseReadFailedError`. Nothing is
 *     sent; the call is recorded `unavailable`, by this type, never by the words
 *     of the error it wraps. Nothing was compared, so it is never a match.
 *   - A base this instance does not configure: the configuration error passes
 *     through unwrapped, recorded `not_configured`, as the pack's call would be.
 *
 * This module reads no server itself: the loop core hands it the client's read
 * (`readServerTools`). It is imported by `../streaming.ts` for its two error
 * types, which the browser bundle carries, so it imports nothing that reaches
 * the client or the registry.
 *
 * The base's own tools are not checked: only a call `packFilterOf` names a pack
 * call reaches here.
 */
import { CIVIC_MANIFEST, checkBasePins, type BasePin, type McpListedTool } from '@typedstandards/civic-typed-router';
import type { PackFilter } from './pack-filter.ts';
import type { ServerToolsRead } from './client.ts';

/** How long a read of a base decides for later pack calls in the same run. */
export const BASE_READ_KEPT_MS = 5 * 60_000;

/**
 * A pack call refused because its base did not match any of the pack's pins, or
 * because the observation could not be compared. Recognised by its type: the
 * loop core records `base_changed`, and the model is told by
 * `baseChangedRefusalForLlm` (`../streaming.ts`).
 */
export class BaseChangedError extends Error {
  readonly filter: PackFilter;
  constructor(filter: PackFilter) {
    super("This call's pack was written for a base that did not match the one read, so it was not sent.");
    this.name = 'BaseChangedError';
    this.filter = filter;
  }
}

/** A pack call not sent because its base's list could not be read. Recorded `unavailable`, by its type. */
export class BaseReadFailedError extends Error {
  constructor(cause: unknown) {
    super("This call's base could not be read, so it was not sent.", { cause });
    this.name = 'BaseReadFailedError';
  }
}

/** Reads a base by its `sourceId`. */
export type BaseReader = (baseSourceId: string) => Promise<ServerToolsRead>;

export interface BaseCheckOptions {
  /** The clock the cache reads. Defaults to `Date.now`. */
  now?: () => number;
  /** The read: the client's `readServerTools` in every run (`../model-loop/run-tool-loop.ts`). */
  read: BaseReader;
}

/** The check a run applies before each pack call: resolves when the call may be sent, throws when it may not. */
export type BaseCheck = (filter: PackFilter) => Promise<void>;

/** The pack's base and its pins, from the installed manifest entry the filter names. */
function pinsOf(filter: PackFilter): { base: string; pins: readonly BasePin[] } {
  const entry = CIVIC_MANIFEST.find((candidate) => candidate.id === filter.packId);
  if (!entry || entry.base === undefined || !entry.pack) throw new Error(`no pack entry states the id ${filter.packId}`);
  return { base: entry.base, pins: entry.pack.basePins };
}

/** One run's check, with its own cache. */
export function createBaseCheck(options: BaseCheckOptions): BaseCheck {
  const now = options.now ?? Date.now;
  const { read } = options;
  const kept = new Map<string, { at: number; observation: ServerToolsRead }>();

  return async (filter) => {
    const { base, pins } = pinsOf(filter);
    let held = kept.get(base);
    if (!held || now() - held.at > BASE_READ_KEPT_MS) {
      kept.delete(base);
      let observation: ServerToolsRead;
      try {
        observation = await read(base);
      } catch (error) {
        // `McpConfigurationError` (`./registry.ts`), by its code, so this module imports nothing of the registry.
        if ((error as { code?: unknown } | null)?.code === 'mcp_not_configured') throw error;
        throw new BaseReadFailedError(error);
      }
      held = { at: now(), observation };
      kept.set(base, held);
    }
    const { serverInfo, tools } = held.observation;
    let matched = false;
    try {
      matched = checkBasePins(pins, {
        ...(serverInfo?.name !== undefined ? { serverName: serverInfo.name } : {}),
        ...(serverInfo?.version !== undefined ? { serverVersion: serverInfo.version } : {}),
        tools: tools as readonly McpListedTool[],
      }).ok;
    } catch {
      // A malformed observation is not a match (Addendum 1, 3.iii).
      matched = false;
    }
    if (!matched) throw new BaseChangedError(filter);
  };
}
