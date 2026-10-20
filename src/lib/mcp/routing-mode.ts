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
import { civicRouter, LOAD_SOURCE_TOOL_NAME, type SourceOffered, type SourceSelection } from '@typedstandards/civic-typed-router';
import type { McpRegistryEnv } from './registry.ts';
import { routedSourceId } from './registry.ts';
import { composeDirectoryPrompt, composeInLoopSystemPrompt, routerComponent, withPortalLockGuidance, type CompositionComponent } from './socrata-skill.ts';
import { loadSourceTool, mcpToolsFor, offeredMcpTools } from './tools.ts';
import { sourceIdForToolName } from './operation-types.ts';
import { classifyStreamError } from '../streaming.ts';
import { callMcpTool, type McpToolCallOptions } from './client.ts';
import type { LoadStep } from '../model-loop/run-tool-loop.ts';
import { IN_LOOP_RUN_RECORD_ATTRIBUTE, RUN_RECORD_ATTRIBUTE } from '../evidence/trace.ts';

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

/**
 * What the model is told a load did (#644 W1, D1 = A): one line of plain text
 * with no `{` in it, since a JSON object in a tool message reached two models
 * as that object alone (R5; the quote test of 2026-10-19, S1). A loaded
 * source's guidance never travels here: it arrives in the next request's
 * system prompt. The alias is named only when it is one the directory lists;
 * an alias that names no source is text the model chose, and is not repeated.
 */
export const LOAD_RESULT_TEXT = {
  loaded: (alias: string) =>
    `Loaded ${alias}. Its tools are added for your next turn, and its guidance now appears in the system prompt.`,
  alreadyLoaded: (alias: string) =>
    `${alias} is already loaded. Its tools and its guidance are unchanged.`,
  // Design §1.6, "On decline": the source is unavailable for this run, the
  // model does not ask again, and the answer says what could not be checked.
  declined: (alias: string) =>
    `${alias} is unavailable for this question, so nothing was loaded. Do not call load_source for it again. ` +
    'In your answer, say what could not be checked without it.',
  notOffered:
    'No source in the directory has that alias, so nothing was loaded. Call load_source with an alias the directory lists.',
} as const;

/**
 * A call to a tool of a source the run lists in its directory but has not
 * loaded. The dispatch refused it before any request (`SourceNotOfferedError`,
 * R6 W1), so it keeps that refusal's kind: `code` is `not_offered`, the record
 * says `failureKind: 'not_offered'`, and the reader sees R6's copy. Only the
 * model's text differs: `sourceNotLoaded` sends `describeToolFailureForLlm` to
 * R8's variant, which says the source is not loaded and names `load_source`,
 * since R6's ("do not call its tools again") is wrong for a source the model
 * can still load.
 */
export class SourceNotLoadedError extends Error {
  readonly code = 'not_offered' as const;
  readonly sourceNotLoaded = true as const;
  /** The name the model called. */
  readonly calledName: string;

  constructor(calledName: string) {
    super(`Tool "${calledName}" belongs to a data source this run has not loaded, so the call was not sent.`);
    this.name = 'SourceNotLoadedError';
    this.calledName = calledName;
  }
}

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
  /** The loop's load step (`ToolLoopOptions.loadStep`). */
  readonly loadStep: LoadStep;
  /** The tool transport: a source's tool is sent only once that source is
   *  loaded; a tool of a listed source that is not loaded is refused
   *  `not_offered` as `SourceNotLoadedError`. */
  executeToolCall(name: string, args: Record<string, unknown>): Promise<string>;
  /** The source a span names for a call, by the loaded set as it stands. */
  resolveToolSource(name: string): string | undefined;
  /** The source ids loaded so far, in manifest order. */
  loaded(): string[];
  /** The system prompt the next request carries. */
  systemPrompt(): string;
  /** The tools the next request carries. */
  tools(): ChatCompletionTool[];
  /** The date the run's prompts state, `YYYY-MM-DD`. */
  readonly assertedDate: string;
  /** Every manifest source's offered-reason over the run's selection, as an
   *  all-sources composition states it: computed once, at composition, and
   *  not recomputed after a load (C4). */
  readonly sourcesOffered: SourceOffered[];
  /** The components of the prompt as it stands: the loaded sources', then
   *  the router's. */
  components(): CompositionComponent[];
  /** What the run's record states after the loop (C5): the final request's
   *  tools, the final prompt's components, the routing statement, and the
   *  harness definition's hash over the loaded set. */
  record(): InLoopRecord;
}

/** The four root-span facts an in-loop run computes after its loop (C5). */
export interface InLoopRecord {
  toolDefinitions: ChatCompletionTool[];
  components: CompositionComponent[];
  routing: { method: 'in-loop'; version: string };
  definitionHash: string;
}

/**
 * The options an in-loop run is given (#644 W1): the directory as its first
 * system prompt, `load_source` as its one tool, the load step, and a
 * transport bound to what the model has loaded.
 *
 * A LOAD (`loadStep.load`):
 *   - an alias naming no source of the directory set (unknown, Off, or not
 *     configured) is `not-offered`: nothing is loaded and the reader is not
 *     asked;
 *   - an Ask-first source is `declined` until W2 adds the pause;
 *   - an On source is `loaded`: the next request's system prompt is the
 *     in-loop prompt over the loaded set, then the lock section, and its
 *     tools are `load_source` and the loaded sources' tools; a second load
 *     recomposes over the union; a repeated load of a loaded source
 *     recomposes nothing and is `loaded`.
 * Nothing in a load contacts a source but the composition itself: loading
 * Data Commons or Boston asks that server for its instructions, as composing
 * it does under all-sources. A hosted source is never woken by a load.
 */
export async function createInLoopRouting(input: InLoopRoutingInput): Promise<InLoopRouting> {
  const { portal, lockedPortal, configured, directory, selection, now = new Date() } = input;
  const callTool = input.callTool ?? callMcpTool;
  const directoryIds = directory.map((entry) => entry.sourceId);
  // The lock section stays the consumer's and follows the router's text, on
  // every request, over the directory set (the router's flag).
  const withLock = (prompt: string) => withPortalLockGuidance(prompt, lockedPortal, configured, directoryIds);
  const loadTool = loadSourceTool(configured, directoryIds);
  const loadedIds: string[] = [];
  const loadedNow = (): string[] => directoryIds.filter((id) => loadedIds.includes(id));

  let current: { systemPrompt: string; tools: ChatCompletionTool[]; components: CompositionComponent[] } = {
    systemPrompt: withLock(composeDirectoryPrompt({ configured, directory: directoryIds, now })),
    tools: [loadTool],
    components: [routerComponent()],
  };
  const first = current;

  const loadStep: LoadStep = {
    toolName: LOAD_SOURCE_TOOL_NAME,
    async load(alias) {
      const entry = alias === undefined ? undefined : directory.find((candidate) => candidate.alias === alias);
      if (!entry) return { outcome: 'not-offered', text: LOAD_RESULT_TEXT.notOffered };
      if (entry.state !== 'on') return { outcome: 'declined', text: LOAD_RESULT_TEXT.declined(entry.alias) };
      if (loadedIds.includes(entry.sourceId)) {
        return { outcome: 'loaded', text: LOAD_RESULT_TEXT.alreadyLoaded(entry.alias), systemPrompt: current.systemPrompt, tools: current.tools };
      }
      // Composed over the candidate set first, committed only once composed.
      const candidate = directoryIds.filter((id) => loadedIds.includes(id) || id === entry.sourceId);
      const composed = await composeInLoopSystemPrompt({ portal, configured, directory: directoryIds, loaded: candidate, now });
      loadedIds.push(entry.sourceId);
      current = {
        systemPrompt: withLock(composed.prompt),
        tools: [loadTool, ...offeredMcpTools(mcpToolsFor(lockedPortal), configured, loadedNow())],
        components: composed.components,
      };
      return { outcome: 'loaded', text: LOAD_RESULT_TEXT.loaded(entry.alias), systemPrompt: current.systemPrompt, tools: current.tools };
    },
  };

  const listed = new Set(directoryIds);
  return {
    directory,
    firstSystemPrompt: first.systemPrompt,
    firstTools: first.tools,
    loadStep,
    async executeToolCall(name, args) {
      try {
        return await callTool(name, args, { selection: loadedNow() });
      } catch (error) {
        // A listed source the model has not loaded: R6's refusal, with R8's
        // model text. A source the run does not list keeps R6's text.
        const sourceId = sourceIdForToolName(name);
        if (classifyStreamError(error) === 'not_offered' && sourceId !== undefined && listed.has(sourceId)) {
          throw new SourceNotLoadedError(name);
        }
        throw error;
      }
    },
    resolveToolSource: (name) => routedSourceId(name, configured, loadedNow()),
    loaded: loadedNow,
    systemPrompt: () => current.systemPrompt,
    tools: () => current.tools,
    assertedDate: now.toISOString().split('T')[0],
    sourcesOffered: civicRouter
      .sourcesOffered(configured, selection)
      .map(({ sourceId, alias, reason }) => ({ sourceId, alias, reason })),
    components: () => current.components,
    record: () => ({
      toolDefinitions: current.tools,
      components: current.components,
      routing: { method: 'in-loop', version: routerComponent().version as string },
      // The loaded set, intersected with the directory set first and passed as
      // the selection, so the definition's `sources` match its components (the
      // router's flags); the model chose them.
      definitionHash: civicRouter.harnessDefinition({
        configured,
        selection: loadedNow(),
        chosenBy: 'model',
        components: current.components,
      }).hash,
    }),
  };
}

/** The root-span attributes an in-loop run writes after its loop, by name. */
export const AFTER_LOOP_RUN_ATTRIBUTES: readonly string[] = [
  RUN_RECORD_ATTRIBUTE.toolDefinitions,
  RUN_RECORD_ATTRIBUTE.components,
  IN_LOOP_RUN_RECORD_ATTRIBUTE.routing,
  IN_LOOP_RUN_RECORD_ATTRIBUTE.definitionHash,
];

/** `attributes` with only (`keep: true`) or without (`keep: false`) the
 *  after-loop attributes, in their order. */
export function afterLoopAttributes(attributes: Record<string, string>, keep: boolean): Record<string, string> {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => AFTER_LOOP_RUN_ATTRIBUTES.includes(key) === keep));
}
