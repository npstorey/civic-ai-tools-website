/**
 * How a question's data sources reach the model (#644 W1, D9): the instance
 * variable `SOURCE_ROUTING`.
 *
 *   - `all-sources`, the default, also when unset: the first request carries
 *     the guidance and the tools of every source the run is offered. This is
 *     what every run sent before the variable existed, byte for byte.
 *   - `in-loop`: the first request carries the directory and one tool,
 *     `load_source`; a source's guidance and tools arrive on the request
 *     after the model loads it.
 *
 * A THIRD VALUE RUNS AS `all-sources`. The preflight refuses one, naming the
 * variable and both values (`scripts/preflight-env.mjs`, `allowedValues`),
 * but nothing runs the preflight on a hosted build, so the running app
 * cannot rely on it. It does what `NYC_CHARTER_HOSTING` outside its set and
 * the analytics service outside its set already do: the setting is treated as
 * absent, and the server logs one line naming the variable and its two values.
 * The value itself is never printed: an operator's typo can be anything,
 * including a secret pasted into the wrong field.
 *
 * Read by name (`process.env.SOURCE_ROUTING`) so `env-reads-declared` sees it,
 * at call time, so a test can set it per run.
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
