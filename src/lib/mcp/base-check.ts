/**
 * The base check (S2-B P3R, npstorey/civic-ai-tools#309), tree 8: typed stubs. The red tree moves the pins and
 * adds the tests, and checks nothing: `createBaseCheck` resolves for every call. Tree 9 replaces this module.
 */
import type { PackFilter } from './pack-filter.ts';
import type { ServerToolsRead } from './client.ts';

/** How long a read of a base decides for later pack calls in the same run. */
export const BASE_READ_KEPT_MS = 5 * 60_000;

/** A pack call refused because its base did not match. Stub. */
export class BaseChangedError extends Error {
  readonly filter: PackFilter;
  constructor(filter: PackFilter) {
    super("This call's pack was written for a base that did not match the one read, so it was not sent.");
    this.name = 'BaseChangedError';
    this.filter = filter;
  }
}

/** A pack call not sent because its base's list could not be read. Stub. */
export class BaseReadFailedError extends Error {
  constructor(cause: unknown) {
    super("This call's base could not be read, so it was not sent.", { cause });
    this.name = 'BaseReadFailedError';
  }
}

/** Reads a base by its `sourceId`. */
export type BaseReader = (baseSourceId: string) => Promise<ServerToolsRead>;

export interface BaseCheckOptions {
  now?: () => number;
  read?: BaseReader;
}

/** The check a run applies before each pack call. */
export type BaseCheck = (filter: PackFilter) => Promise<void>;

/** Stub: checks nothing. */
export function createBaseCheck(options: BaseCheckOptions = {}): BaseCheck {
  void options;
  return async () => {};
}
