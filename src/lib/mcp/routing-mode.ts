/**
 * How a question's data sources reach the model (#644 W1, D9): the instance
 * variable `SOURCE_ROUTING`. RED STUB: every value runs as `all-sources`.
 */

/** The values `SOURCE_ROUTING` takes, the default first. */
export const SOURCE_ROUTING_MODES = ['all-sources', 'in-loop'] as const;

export type SourceRoutingMode = (typeof SOURCE_ROUTING_MODES)[number];

/** The mode a raw `SOURCE_ROUTING` value selects. */
export function parseSourceRouting(_raw: string | undefined, _warn: (line: string) => void = console.warn): SourceRoutingMode {
  return 'all-sources';
}

/** This instance's mode, read from `SOURCE_ROUTING` at call time. */
export function sourceRoutingMode(): SourceRoutingMode {
  return 'all-sources';
}
