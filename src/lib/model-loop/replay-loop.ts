/**
 * Replay's loop configuration, in one place (#345 P3).
 *
 * WHY THIS IS A MODULE AND NOT A LITERAL IN THE ROUTE. `replay/route.ts` is a
 * Next route handler: `node --test` cannot invoke one, and 0 of the 74 test
 * files in this tree resolve the `@/` alias the route imports through. A test
 * that hand-rolled replay's options in its own body would therefore be
 * measuring a copy — configuration written twice diverges, and the divergence
 * would be invisible in exactly the direction that matters (a cap the route
 * raised, a portal the route stopped injecting). So the configuration lives
 * here, under relative imports only, and both the route and its tests obtain
 * it from the same call.
 *
 * WHAT THE ROUTE STILL OWNS. Everything about being a route: the session
 * check, the caller-supplied key, the MCP routing refusal, the record and
 * package reads, the hash-only-visibility refusal, the declared→endpoint model
 * mapping, and the whole error-classification tail. This module owns only what
 * the LOOP is given — which since #384 includes the portal derivation
 * (`replayPortalForPackage`), because what the loop is given is exactly what a
 * test must be able to read.
 *
 * AND SINCE #432, THE ROUTE'S PORTAL DECISION ITSELF. Deriving the portal was
 * moved here in #384; USING it stayed in the route, three lines that read
 * `replayPortalForPackage(pkg)`, composed a system prompt for whatever came
 * back, and handed both to `replayLoopOptions`. Those three lines were covered
 * by two assertions over the route's TEXT — that one named hostname does not
 * appear in it, and that the string `replayPortalForPackage(` does — and a
 * route that called the derivation and then coalesced a fallback around the
 * result satisfied both. Demonstrated on a runner rather than argued: with
 * `const portal = replayPortalForPackage(pkg) ?? pkg.dataSources[0]?.portalUrl…`
 * live in the route — the N10 defect exactly, an aggregate endpoint handed to a
 * replay as a Socrata portal and folded into a SIGNED consistency attestation —
 * CI was green over 1554 tests.
 *
 * So the decision is `replayLoopOptionsForPackage` below: one call, taking the
 * stored package and returning the options `runToolLoop` runs. The route holds
 * no portal, composes no system prompt and names neither, so there is no route
 * expression left for a fallback to sit in; and the value production actually
 * uses is now a value the suite can read, which is what
 * `derived-replay-portal-reaches-the-record.test.ts` reads.
 *
 * THE ARGS-IDENTITY CONSTRAINT, restated because this is the caller it bites.
 * The core injects `portal` into the very `args` object it records — the same
 * object, by reference (see the header of `run-tool-loop.ts`).
 * `canonicalizeToolCall` (`src/lib/evidence/tool-call-identity.ts`) keys a
 * replay run on the tool name plus a canonical JSON serialisation of the
 * WHOLE argument object — every field, not a hand-picked few — and those keys
 * are an input to a signed consistency attestation. Clone or freeze that
 * object anywhere on this path and the injected portal stops reaching the
 * record: the serialisation changes, so the key changes, and nothing in the
 * diff points at the cause.
 */

import type OpenAI from 'openai';
import { mcpTools } from '../mcp/tools.ts';
import { callMcpTool } from '../mcp/client.ts';
import { buildSystemPrompt } from '../mcp/socrata-skill.ts';
import { sourceIdForToolName } from '../mcp/operation-types.ts';
import { CIVIC_SOURCE_REGISTRY } from '../evidence/data-sources.ts';
import type { ToolLoopOptions } from './run-tool-loop.ts';

/** Tool-calling rounds before the loop stops and asks for an answer. */
export const REPLAY_MAX_ITERATIONS = 20;
/** `max_tokens` on every request a replay makes. */
export const REPLAY_MAX_TOKENS = 4000;
/** Cumulative token budget for one replay run. */
export const REPLAY_MAX_CUMULATIVE_TOKENS = 200_000;
/** Bound on one tool result fed back to the model as context. */
export const REPLAY_MAX_TOOL_RESULT_CHARS = 50_000;
/**
 * Per-tool-call timeout. A replay is one leg of an N-run consistency test, so
 * one unresponsive source must fail its own call rather than hold the whole
 * run — and the caller of the route is a browser waiting on a response.
 */
export const REPLAY_MCP_TOOL_TIMEOUT_MS = 45_000;

/** The tool transport. Substitutable so a test can drive the real loop. */
export type ReplayToolTransport = (
  name: string,
  args: Record<string, unknown>,
) => Promise<string>;

export interface ReplayLoopInputs {
  /** Built by the route from the caller-supplied key, in the route's own error handling. */
  client: OpenAI;
  /** The wire string this instance reaches the record's model with. */
  endpointModel: string;
  /** The record's prompt text, verbatim. */
  prompt: string;
  /** Regenerated fresh for the record's portal by the route. */
  systemPrompt: string;
  /**
   * The portal the record's own calls named (`replayPortalForPackage`),
   * injected into Socrata calls that omit one. Absent when the record named
   * none: nothing is injected, and the replay runs on whatever the source
   * defaults to — exactly as the recorded run did (#384, F2).
   */
  portal?: string;
  /**
   * The tool transport, for tests. Defaults to the live MCP client —
   * deliberately one level below the loop: substituting it restates no loop
   * configuration at all.
   */
  callTool?: ReplayToolTransport;
  /**
   * The per-tool-call timeout, in milliseconds. Overridable for ONE reason
   * (#357): a case that drives a transport which genuinely never settles
   * cannot wait 45 real seconds, and a case that fakes the timeout by throwing
   * its wording measures `classifyStreamError`'s text mapping instead of the
   * race — which is why the test named for this behaviour stayed green with
   * the whole race deleted.
   *
   * Production passes nothing and gets `REPLAY_MCP_TOOL_TIMEOUT_MS`. The
   * source-drift guard in this file's tests asserts the route supplies neither
   * this nor `callTool`: both seams exist for tests, not for production.
   */
  toolTimeoutMs?: number;
}

/**
 * The catalogue types whose `dataSources[].portalUrl` is a portal a `get_data`
 * call could address — DERIVED, not listed (#409 P8, cold-read F1).
 *
 * WHY THIS IS NOT A LITERAL. The rule the replay portal has to satisfy is not
 * "is not one of the two endpoints we have seen go wrong"; it is "is a portal
 * `get_data` can be pointed at". Those differ in exactly one direction, and it
 * is the direction that matters: a fourth catalogue type added next year is
 * not addressable by `get_data` until something says it is, and a blocklist
 * admits it by silence on the day it appears. So the set is computed from the
 * two registries that already answer the question:
 *
 *   - `sourceIdForToolName('get_data')` — the app's MCP layer, which knows
 *     which SOURCE hosts `get_data` (`socrata`);
 *   - `CIVIC_SOURCE_REGISTRY[sourceId].catalogType` — the harness's source
 *     registry, which knows what `catalogType` that source's `dataSources`
 *     entries carry.
 *
 * Every other catalogue type is reached by a tool that takes no Socrata
 * portal: `data-commons` by `get_observations`, `ckan` by `ckan__execute_sql`.
 * An entry from one of those states the endpoint its own source was called at,
 * which is not a value any `get_data` argument may be set to.
 *
 * FAIL-CLOSED, AND GUARDED. If either registry stops answering, this set is
 * empty and a replay simply injects no portal — a degradation, never a false
 * claim. `replay-portal-is-addressable.test.ts` asserts the derived set is
 * exactly `socrata` today, so an empty set is a red suite rather than a
 * production path that has quietly gone quiet.
 */
const GET_DATA_ADDRESSABLE_CATALOG_TYPES: ReadonlySet<string> = (() => {
  const sourceId = sourceIdForToolName('get_data');
  const catalogType = sourceId ? CIVIC_SOURCE_REGISTRY[sourceId]?.catalogType : undefined;
  return new Set(catalogType ? [catalogType] : []);
})();

/**
 * Is this `dataSources[]` entry's `portalUrl` a portal a `get_data` call could
 * be addressed to?
 *
 * `catalogType` is the discriminator a published package actually carries on
 * every entry (required by `DataSourceEntry`; measured present on all 39
 * entries across the 34 records published at the reference deployment on
 * 2026-09-06, with values `socrata`, `data-commons` and `ckan`). An entry that
 * states no catalogue type states nothing about addressability, and is read the
 * same way as one that states an unrecognised type: not known to be
 * addressable, so it supplies no portal.
 */
export function isGetDataAddressableSource(entry: { catalogType?: string }): boolean {
  return (
    typeof entry.catalogType === 'string'
    && GET_DATA_ADDRESSABLE_CATALOG_TYPES.has(entry.catalogType)
  );
}

/** The derived set, for the guard that keeps the derivation honest. */
export function getDataAddressableCatalogTypes(): ReadonlySet<string> {
  return GET_DATA_ADDRESSABLE_CATALOG_TYPES;
}

/**
 * The portal a replay runs on, read off the record and nothing else (#384,
 * F2). The route used to take the first data source's portal and, for a
 * record with no data-source entry — a `search`/`fetch`-only run has none —
 * fall back to a literal domain the record never mentioned, which then
 * reached every `get_data` call the replay injected into and, through
 * `canonicalizeToolCall`, a signed consistency attestation.
 *
 * Order: the first `queries[]` entry that named a portal (the loop's own
 * record, app-side), else the first `dataSources[]` entry that is BOTH
 * addressable by `get_data` and carries a portal host, else `undefined` — a
 * record that named no portal a `get_data` could use replays with none.
 *
 * THE SECOND CLAUSE'S FILTER (#409 P8, cold-read F1). Until this phase the
 * fallback took the first entry with any `portalUrl` and inspected nothing
 * else, so a record whose only source was aggregate or CKAN replayed with that
 * server's own endpoint standing in for a Socrata portal — measured live on 5
 * of the 34 published records (4 Data Commons, 1 CKAN). The value was not
 * inert: the route hands it to `buildSystemPrompt`, which writes it into the
 * model's instructions as "Default portal: …", and to this module as `portal`,
 * which the core injects into any `get_data` that omits one — reaching the
 * recorded arguments, the span's `tool.portal_domain`, and through
 * `canonicalizeToolCall` a SIGNED consistency attestation. A host no Socrata
 * call could ever have addressed was being named as the one the replay ran on.
 *
 * A mixed run keeps its Socrata portal: the filter selects the first entry
 * that IS addressable rather than rejecting the whole list when entry zero is
 * not, so an analysis that queried both an aggregate source and a portal still
 * replays on the portal it queried.
 */
export function replayPortalForPackage(pkg: {
  queries: ReadonlyArray<{ portal?: string }>;
  dataSources: ReadonlyArray<{ catalogType?: string; portalUrl?: string }>;
}): string | undefined {
  const named = pkg.queries.find((q) => typeof q.portal === 'string' && q.portal.length > 0)?.portal;
  if (named) return named;
  const sourceUrl = pkg.dataSources.find(
    (d) =>
      isGetDataAddressableSource(d)
      && typeof d.portalUrl === 'string'
      && d.portalUrl.length > 0,
  )?.portalUrl;
  if (!sourceUrl) return undefined;
  return sourceUrl.replace(/^https?:\/\//, '');
}

/**
 * Everything `runToolLoop` needs to run one replay. The caps, the tool set,
 * the portal and the per-call timeout are all fixed here; the route supplies
 * only what it read off the record.
 *
 * The portal and the timeout are now VALUES this factory hands the core
 * rather than behaviour it performs (#359, #352). This module held the
 * reference implementation of both — the `get_data` guard three other callers
 * copied, and the only timer of the four that was cleared — and what it kept
 * is the two numbers and the one portal that are genuinely replay's. The
 * injection had to move because it ran inside `executeToolCall`, which the
 * core invokes after it has already recorded the call and stringified the
 * arguments onto the `mcp_tool_call` span: the span disagreed with the record,
 * and on a replay the record is what a signed consistency attestation is
 * computed over.
 */
export function replayLoopOptions(inputs: ReplayLoopInputs): ToolLoopOptions {
  const {
    client,
    endpointModel,
    prompt,
    systemPrompt,
    portal,
    callTool = callMcpTool,
    toolTimeoutMs = REPLAY_MCP_TOOL_TIMEOUT_MS,
  } = inputs;

  return {
    client,
    endpointModel,
    prompt,
    systemPrompt,
    tools: mcpTools,
    maxIterations: REPLAY_MAX_ITERATIONS,
    maxTokens: REPLAY_MAX_TOKENS,
    maxCumulativeTokens: REPLAY_MAX_CUMULATIVE_TOKENS,
    maxToolResultChars: REPLAY_MAX_TOOL_RESULT_CHARS,
    // A replay has no reader attached to the model call: the client that
    // started it is waiting on one JSON body, and the answering turn is the
    // published output of this run.
    finalTurn: 'blocking',
    logContext: 'replay',
    // Injected by the core into a Socrata `get_data` call that omits a portal,
    // above the record and the span; Data Commons tools are untouched.
    portal,
    // Raced and cleared by the core, so one unresponsive source fails its own
    // call rather than holding the replay open.
    toolTimeoutMs,
    executeToolCall: callTool,
  };
}

/** The two fields of a stored package the replay portal is derived from. */
export type ReplayPortalSource = Parameters<typeof replayPortalForPackage>[0];

/**
 * Composes the system prompt a replay runs under. Defaults to
 * `buildSystemPrompt`; substitutable for the same reason `callTool` is, and
 * for one more: `buildSystemPrompt` reaches three MCP servers for their skill
 * text, so a case that drove it would be measuring the network as well as the
 * decision. A test injects a recorder and reads back the portal the composer
 * was given, which is the half of the journey the loop options cannot show.
 */
export type ReplaySystemPromptComposer = (portal?: string) => Promise<string>;

export interface ReplayForPackageInputs {
  /** The stored package, read from storage by the route. */
  pkg: ReplayPortalSource;
  /** Built by the route from the caller-supplied key, in the route's own error handling. */
  client: OpenAI;
  /** The wire string this instance reaches the record's model with. */
  endpointModel: string;
  /** The record's prompt text, verbatim. */
  prompt: string;
  /** For tests only; production passes nothing. See the type's own note. */
  composeSystemPrompt?: ReplaySystemPromptComposer;
  /** For tests only; production passes nothing. */
  callTool?: ReplayToolTransport;
  /** For tests only; production passes nothing. */
  toolTimeoutMs?: number;
}

/**
 * The replay route's portal decision, end to end and in one place (#432).
 *
 * Everything between "here is the record's package" and "here are the options
 * the loop runs": the portal derived off the package and nothing else, the
 * system prompt composed for that portal, and both placed into the loop
 * options. The route supplies the three things only a route can know — the
 * client built from the caller's key, the endpoint model, the prompt text —
 * and takes the result.
 *
 * WHY THIS IS A FUNCTION AND NOT THREE LINES IN THE ROUTE. Same reason the
 * configuration is, one paragraph up in this file's header, and now with a
 * measured cost attached: a Next route handler cannot be invoked by
 * `node --test`, so any assertion about lines living there can only read them
 * as characters. A character-level assertion enumerates; it caught one
 * hostname and passed on every other way of writing the same defect, including
 * the one that had just been fixed. Moved here, the decision is a value a
 * driven case reads — the same value production hands to `runToolLoop`, not a
 * copy of it composed in a test body.
 *
 * The portal is deliberately not a parameter. A caller cannot pass one in, so
 * a replay cannot run on a portal that was not derived from the record it is
 * replaying — which is the property, stated in the type rather than asserted
 * about the text of one caller.
 */
export async function replayLoopOptionsForPackage(
  inputs: ReplayForPackageInputs,
): Promise<ToolLoopOptions> {
  const {
    pkg,
    composeSystemPrompt = buildSystemPrompt,
    ...loopInputs
  } = inputs;

  // The portal the record's own calls named, or none (#384, F2). A record that
  // named no portal — a search/fetch-only run has no data-source entry, and an
  // aggregate or CKAN source states an endpoint no `get_data` could address —
  // replays with nothing injected and a system prompt that names no default
  // portal, rather than on a domain the record never mentioned. Absence is
  // recorded as absence in the replayed calls' arguments, and so in the
  // identity keys the consistency attestation is computed over.
  const portal = replayPortalForPackage(pkg);

  // Regenerated fresh — the guidance may have moved since the record was
  // published — but for THIS portal, or for none.
  const systemPrompt = await composeSystemPrompt(portal);

  return replayLoopOptions({ ...loopInputs, systemPrompt, portal });
}
