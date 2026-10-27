/**
 * The instance variable `SOURCE_ROUTING` and its reader (#644 W1, D9), in a
 * module of its own (#644 W2, the seat's ruling of 2026-10-21).
 *
 * WHY A LEAF. The privacy page states the consent pause only under
 * `in-loop`, so `src/lib/privacy-facts.ts` reads the mode. `routing-mode.ts`,
 * where the reader lived, value-imports the MCP client, which reads the
 * environment and builds the registry when it loads; the flows statement and
 * the consent gate import `privacy-facts.ts`. This module imports nothing, so
 * reading the mode brings no other module, and no work at import, into
 * either graph. `routing-mode.ts` re-exports everything here, so every import
 * of it stands.
 *
 * The rest of the mode's story (the default, a third value, why the value is
 * never printed) is in `routing-mode.ts`'s header.
 */

/** The values `SOURCE_ROUTING` takes, the default first. */
export const SOURCE_ROUTING_MODES = ['all-sources', 'in-loop'] as const;

export type SourceRoutingMode = (typeof SOURCE_ROUTING_MODES)[number];

/** The one log line for a value outside the set. Names the variable and the
 *  set, never the value. */
export const SOURCE_ROUTING_UNKNOWN_VALUE_LINE =
  `[source-routing] SOURCE_ROUTING is set to a value other than ${SOURCE_ROUTING_MODES.join(' or ')}; running as all-sources`;

function isSourceRoutingMode(value: string): value is SourceRoutingMode {
  return (SOURCE_ROUTING_MODES as readonly string[]).includes(value);
}

/**
 * The mode a raw `SOURCE_ROUTING` value selects: trimmed, as the preflight
 * trims; unset, empty or blank is `all-sources`; a value outside the set is
 * `all-sources` and `warn` is called once with the line above.
 */
export function parseSourceRouting(raw: string | undefined, warn: (line: string) => void = console.warn): SourceRoutingMode {
  const value = raw?.trim();
  if (!value) return 'all-sources';
  if (isSourceRoutingMode(value)) return value;
  warn(SOURCE_ROUTING_UNKNOWN_VALUE_LINE);
  return 'all-sources';
}

/** This instance's mode, read from `SOURCE_ROUTING` at call time. */
export function sourceRoutingMode(): SourceRoutingMode {
  return parseSourceRouting(process.env.SOURCE_ROUTING);
}
