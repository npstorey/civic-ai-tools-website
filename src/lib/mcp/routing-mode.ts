/**
 * How a question's data sources reach the model (#644 W1, D9): the instance
 * variable `SOURCE_ROUTING`, and what an in-loop run is given.
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
 *
 * THE DIRECTORY SET (G0 correction 1, the seat's ruling). The sources an
 * in-loop run lists and may load are read from the consent gate's decision,
 * never from the request. While the gate is dormant (`enforced: false`, its
 * `states` empty) every configured source is listed and loads as On: that is
 * what an all-sources run is offered today, where the selection is
 * `undefined`. Read as "a source with no stored state is Ask first" over the
 * dormant gate's empty states, every load would be declined and every in-loop
 * run would answer with no data. Once the gate is enforced, the set is
 * configured ∩ (On ∪ Ask first) from the stored states: a source with no
 * stored state is Ask first (D6), and an Off source is not listed.
 *
 * AN EMPTY DIRECTORY SET IS NEVER RUN IN-LOOP (the router's flag: the tool's
 * enum would be `[]`). It arises only once the gate is enforced and every
 * source is Off, and the run then takes the all-sources path over the same
 * empty selection: the all-Off prompt is decided for that path (R6's W3), and
 * an in-loop instance sends exactly what an all-sources one does for that
 * reader. The record of such a run states no `routing`, as an all-sources
 * run's does not.
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { civicRouter, type SourceOffered, type SourceSelection } from '@typedstandards/civic-typed-router';
import type { McpRegistryEnv } from './registry.ts';
import { routedSourceId } from './registry.ts';
import { composeDirectoryPrompt, routerComponent, withPortalLockGuidance, type CompositionComponent } from './socrata-skill.ts';
import { loadSourceTool } from './tools.ts';
import { callMcpTool, type McpToolCallOptions } from './client.ts';

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

// --- The directory set ------------------------------------------------------------

/** One source an in-loop run lists, and how a load of it is answered. */
export interface DirectoryEntry {
  sourceId: string;
  /** The alias the directory lists it by, and `load_source` names it by. */
  alias: string;
  /** `on` loads; `ask-first` is declined until W2 adds the pause. */
  state: 'on' | 'ask-first';
}

/** What the directory set reads from the consent gate's decision. */
export interface DirectoryConsent {
  /** False while the gate is dormant (`CONSENT_GATE_ENFORCED`). */
  enforced: boolean;
  /** The stored states, by source id; empty while the gate is dormant. */
  states: Readonly<Record<string, string>>;
}

/**
 * The directory set: the configured sources in manifest order, each with how
 * a load of it is answered. Dormant gate: every configured source, On.
 * Enforced: the configured sources whose stored state is On or Ask first, a
 * source with no stored state being Ask first; Off is left out.
 */
export function directorySet(configured: McpRegistryEnv, consent: DirectoryConsent): DirectoryEntry[] {
  const offered = new Set(civicRouter.offeredSkillSources(configured));
  const entries: DirectoryEntry[] = [];
  for (const entry of civicRouter.manifest) {
    if (!offered.has(entry.sourceId)) continue;
    if (!consent.enforced) {
      entries.push({ sourceId: entry.sourceId, alias: entry.alias, state: 'on' });
      continue;
    }
    const stored = Object.hasOwn(consent.states, entry.sourceId) ? consent.states[entry.sourceId] : undefined;
    if (stored === 'off') continue;
    entries.push({ sourceId: entry.sourceId, alias: entry.alias, state: stored === 'on' ? 'on' : 'ask-first' });
  }
  return entries;
}

/** Whether a run is routed in-loop: the mode says so and the directory set
 *  is not empty. */
export function entersInLoop(mode: SourceRoutingMode, directory: readonly DirectoryEntry[]): boolean {
  return mode === 'in-loop' && directory.length > 0;
}

// --- An in-loop run -----------------------------------------------------------------

/** The transport an in-loop run calls a source's tool through: the MCP
 *  client's, told the loaded set as it stands at each call. */
export type InLoopToolTransport = (name: string, args: Record<string, unknown>, options: McpToolCallOptions) => Promise<string>;

export interface InLoopRoutingInput {
  /** The run's Socrata portal, if any. */
  portal?: string;
  /** The one Socrata portal a locked instance serves, or absent. */
  lockedPortal?: string;
  /** The instance's configuration, read once per run. */
  configured: McpRegistryEnv;
  /** The directory set (`directorySet`); not empty (`entersInLoop`). */
  directory: readonly DirectoryEntry[];
  /** The run's selection as the consent gate gave it (configured ∩ On), for
   *  what a record states as offered (C4). */
  selection: SourceSelection;
  /** The run's clock; the directory and every composition state its date. */
  now?: Date;
  /** For tests: the transport. Defaults to the MCP client. */
  callTool?: InLoopToolTransport;
}

/** What an in-loop run is given, and what it has loaded so far. */
export interface InLoopRouting {
  /** The directory set the run lists. */
  readonly directory: readonly DirectoryEntry[];
  /** The first request's system prompt: the directory, then the lock
   *  section on a locked instance. */
  readonly firstSystemPrompt: string;
  /** The first request's tools: `load_source` alone. */
  readonly firstTools: ChatCompletionTool[];
  /** The tool transport: a source's tool is sent only once that source is
   *  loaded; otherwise the dispatch refuses it `not_offered`. */
  executeToolCall(name: string, args: Record<string, unknown>): Promise<string>;
  /** The source a span names for a call, by the loaded set as it stands. */
  resolveToolSource(name: string): string | undefined;
  /** The source ids loaded so far, in manifest order. */
  loaded(): string[];
  /** The date the run's prompts state, `YYYY-MM-DD`. */
  readonly assertedDate: string;
  /** Every manifest source's offered-reason over the run's selection, as an
   *  all-sources composition states it: computed once, at composition, and
   *  not recomputed after a load (C4). */
  readonly sourcesOffered: SourceOffered[];
  /** The components of the prompt as it stands: the loaded sources', then
   *  the router's. */
  components(): CompositionComponent[];
}

/**
 * The options an in-loop run is given (#644 W1): the directory as its first
 * system prompt, `load_source` as its one tool, and a transport bound to what
 * the model has loaded.
 */
export async function createInLoopRouting(input: InLoopRoutingInput): Promise<InLoopRouting> {
  const { lockedPortal, configured, directory, selection, now = new Date() } = input;
  const callTool = input.callTool ?? callMcpTool;
  const directoryIds = directory.map((entry) => entry.sourceId);
  // The lock section stays the consumer's and follows the router's text, on
  // every request, over the directory set (the router's flag).
  const withLock = (prompt: string) => withPortalLockGuidance(prompt, lockedPortal, configured, directoryIds);
  const loadedIds: string[] = [];
  const loadedNow = (): string[] => directoryIds.filter((id) => loadedIds.includes(id));

  return {
    directory,
    firstSystemPrompt: withLock(composeDirectoryPrompt({ configured, directory: directoryIds, now })),
    firstTools: [loadSourceTool(configured, directoryIds)],
    executeToolCall: (name, args) => callTool(name, args, { selection: loadedNow() }),
    resolveToolSource: (name) => routedSourceId(name, configured, loadedNow()),
    loaded: loadedNow,
    assertedDate: now.toISOString().split('T')[0],
    sourcesOffered: civicRouter
      .sourcesOffered(configured, selection)
      .map(({ sourceId, alias, reason }) => ({ sourceId, alias, reason })),
    components: () => [routerComponent()],
  };
}
