// Multi-source MCP skill composition for the civic-ai-tools website.
//
// Despite the filename (historical — Socrata was the only source pre-M9.1),
// `buildSystemPrompt` composes the full multi-source system prompt spanning
// Socrata, Google Data Commons, and — only on an instance that configures it
// (`BOSTON_OPENCONTEXT_MCP_URL`) — Boston OpenContext:
//
//   1. Cross-source preamble  — "you have access to two data sources..."
//   2. Socrata skill          — fetched from the Socrata MCP server's
//                                prompts/get endpoint with a hardcoded
//                                fallback; portal-specific guidance appended
//   3. Data Commons server instructions — captured from the Data Commons
//                                initialize response's `result.instructions`
//                                field (MCP spec). Omitted when absent.
//   4. Data Commons augmentation — the embedded Data Commons skill.
//
// The order matters for LLM attention: cross-source decision logic lands
// first so the model reads it before diving into source-specific details.
//
// THE TEXT AND THE COMPOSITION ARE THE PACKAGE'S (#599 W2). Every sentence the
// prompt carries — the preamble, the intro and outro, `SOCRATA_SKILL_FALLBACK`,
// the per-portal table, the lock section — and the join itself are
// `@typedstandards/civic-typed-router`'s bare view, moved from this file byte
// for byte. The package reads no clock, no environment and no network, so this
// file supplies them: today's date from `new Date()` at call time, the
// configuration from `readMcpEnvFromProcess()`, the publication host as
// `./data-commons-skill.ts` read it at module load, the Socrata guidance from
// `callMcpPrompt` behind this file's five-minute cache, and each server's
// instructions from `getServerInstructions`. The logging stays here too: the
// package logs nothing.
//
// THE ALIASED VIEW (#599 W3, ADR-0032). Every text this file hands out is the
// package's aliased view, the one the query routes send: every tool the
// package's own text names is `<alias>__<upstream name>`, and text a source
// sends (the fetched Socrata guidance, a server's initialize instructions)
// gets the package's anchored rewrite — an exact backtick, bold or
// double-quoted token, an exact table cell, or an item of a `Tools:` list —
// and nothing else changes. Two names in the Socrata server's guidance sit at
// no anchor (a fenced `Tool: get_data` line and a header cell "get_data
// coverage") and stay bare; the dispatch rule accepts a bare name exactly one
// offered source has, so a model that calls one still reaches the server.
// `unaliasText` with the package's dispatch map undoes the view to W2's bytes.
//
// WHAT A RUN RECORDS ABOUT ITS PROMPT (#599 W4, ADR-0033 §E). `composeSystemPrompt`
// returns, beside the prompt, the facts a record states about how it was
// composed: the date the prompt asserted (#475), each source's offered-reason,
// and the components — one per offered source, then the router package. The
// query routes write them onto the trace's root span, and the packager reads
// them back at publish. `buildSystemPrompt` is the prompt alone.
//
// THE SELECTION (#599 D3). Every composition function here takes an explicit
// selection of source ids; absent, the run is offered every source the
// configuration offers, which is what every run is offered today. No request
// carries a selection until R6's panel; the routes pass
// `DEFAULT_SOURCE_SELECTION`. An id the manifest does not hold is ignored, as
// the router ignores it.

import { createHash } from 'node:crypto';
import routerPackage from '@typedstandards/civic-typed-router/package.json' with { type: 'json' };
import {
  bostonGuidanceText,
  civicPreambleEntry,
  civicRouter,
  composePreamble,
  composePrompt,
  dataCommonsGuidanceText,
  getSkillForPortal as routerSkillForPortal,
  introFor,
  outroFor,
  socrataGuidanceText,
  socrataSkillFallback,
  ALL_SOURCES,
  type CivicGuidanceContext,
  type SourceId,
  type SourceOffered,
  type SourceSelection,
} from '@typedstandards/civic-typed-router';
import { callMcpPrompt, getServerInstructions } from './client.ts';
import { readMcpEnvFromProcess, type McpRegistryEnv } from './registry.ts';
import { DATA_COMMONS_PUBLICATION_HOST } from './data-commons-skill.ts';
import { errorLogFacts } from '../streaming.ts';

// The fallback guidance, used when the Socrata MCP server's prompt fetch
// fails, and the cross-source preamble and outro: the package's text.
//
// The fallback is GENERIC-ONLY, by design (sprint 154 P4, portability
// charter): it tracks the deployment-NEUTRAL overlay of the source-of-truth
// skill docs in the civic-ai-tools repo and carries no deployment posture.
// Its claims about which tool takes a portal are held to the hub's base skill
// by `socrata-skill-mirror.test.ts`. The router package's pinned guidance
// fixture and its pinning script, in the hub, hold the guidance text itself.
export { outroFor, type SourceId, type SourceOffered, type SourceSelection } from '@typedstandards/civic-typed-router';

/**
 * The selection every query route passes: none, so the run is offered every
 * source the instance configures. A request field that carries another is
 * R6's (the Sources panel), not this sprint's (#599 D3).
 */
export const DEFAULT_SOURCE_SELECTION: SourceSelection = undefined;

/** The view every text below is composed in: the package's aliased view. */
const VIEW = civicRouter.aliasedView;

/** The cross-source preamble for `sources`, in the aliased view: what the
 *  composed prompt carries for that set of offered sources. */
export function crossSourcePreamble(sources: readonly SourceId[]): string {
  return composePreamble(sources.map((sourceId) => ({ sourceId, preambleEntry: civicPreambleEntry(sourceId, VIEW) })));
}

/** The preamble with every source this codebase has, in the aliased view. */
export const CROSS_SOURCE_PREAMBLE: string = crossSourcePreamble(ALL_SOURCES);

/** The Socrata block used when the guidance fetch fails, in the aliased view. */
export const SOCRATA_SKILL_FALLBACK: string = socrataSkillFallback(VIEW);

/** Portal-specific guidance for a run's Socrata portal, or `''`: the package's
 *  per-portal table, in the aliased view. */
export const getSkillForPortal = (portal: string): string => routerSkillForPortal(portal, VIEW);

// Cached skill guidance from MCP server. The cache is the consumer's, so it
// stays here with the semantics it always had: a fetched text is kept for five
// minutes, and it is served only while it is non-empty — an empty answer is
// stored but never served, so it is fetched again on every prompt. A failed
// fetch is not cached: it throws, and the package composes its fallback.
let cachedSkillGuidance: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** The package's `fetchPrompt`: the Socrata guidance, behind the cache. The
 *  package asks for one prompt, `skill-guidance` in the `web` modality; it is
 *  passed to `callMcpPrompt` as asked. */
async function fetchSkillGuidance(name: string, args: Record<string, string>): Promise<string> {
  const now = Date.now();
  if (cachedSkillGuidance && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSkillGuidance;
  }

  try {
    console.log('[Skill] Fetching skill guidance from MCP server...');
    const guidance = await callMcpPrompt(name, args);
    cachedSkillGuidance = guidance;
    cacheTimestamp = now;
    console.log('[Skill] Fetched skill guidance successfully (%d chars)', guidance.length);
    return guidance;
  } catch (error) {
    console.warn('[Skill] Failed to fetch skill guidance, using fallback:', errorLogFacts(error));
    throw error;
  }
}

/** The one log line for a source whose block could not be composed. */
function warnSourceTextFailed(sourceId: string, error: unknown): void {
  console.warn(`[composeSkillPrompt] Failed to fetch text for "${sourceId}":`, errorLogFacts(error));
}

/** The package's `fetchInstructions` for `buildSystemPrompt`: the client's,
 *  with a failure logged before the package leaves that source's block out. */
async function fetchInstructions(sourceId: string): Promise<string | null> {
  try {
    return await getServerInstructions(sourceId);
  } catch (error) {
    warnSourceTextFailed(sourceId, error);
    throw error;
  }
}

/**
 * Inputs handed to every `SkillEntry.fetchText` call. Sources are free to
 * ignore fields that don't apply to them (e.g. Data Commons ignores `portal`).
 */
export interface SkillContext {
  /** Default Socrata portal, used by the Socrata entry to append portal-specific guidance. */
  portal?: string;
  /** Today's date as YYYY-MM-DD; used in the intro block. */
  today: string;
  /** Cross-source preamble inserted between the intro and the per-source blocks. Optional. */
  preamble?: string;
  /** The closing block. Optional: absent, the outro citing every source. */
  outro?: string;
}

/**
 * One source's contribution to the composed system prompt. `fetchText` may do
 * async I/O (MCP prompt fetch, `initialize`-time instructions). It must catch
 * its own errors and return an empty string to opt out gracefully — the
 * composer treats empty strings as "skip this source".
 */
export interface SkillEntry {
  sourceId: SourceId;
  fetchText(ctx: SkillContext): Promise<string>;
}

/**
 * Map from `SourceId` to the entry that produces its skill text. `Partial`
 * because tests inject smaller registries containing only the entries under
 * test, and because the composer's "unknown sourceId" branch must be reachable
 * from a real call site, not just from a hand-rolled stub.
 */
export type SkillRegistry = Partial<Record<SourceId, SkillEntry>>;

/**
 * The sources a run's prompt is composed from on an instance configured as
 * `configured`: each source the instance offers (`isSourceOffered` in
 * `./registry.ts`). Socrata and Data Commons always; an optional source such as
 * Boston OpenContext only when its variable is set — unset, its guidance block,
 * its preamble entry and routing rule, its outro citation and its line in the
 * lock section are all left out, and its server is never asked for
 * instructions (sprint 238, ruling D2).
 */
export function offeredSkillSources(
  configured: McpRegistryEnv = readMcpEnvFromProcess(),
  selection?: SourceSelection,
): SourceId[] {
  return civicRouter.offeredSkillSources(configured, selection) as SourceId[];
}

/** The outro `composeSkillPrompt` closes with when the context names none. */
const OUTRO = outroFor(ALL_SOURCES);

/** What the package's guidance entries receive from a `SkillContext`: the
 *  client's fetchers as they are (the composer below logs a failure). */
function guidanceContext(ctx: SkillContext): CivicGuidanceContext {
  return {
    portal: ctx.portal,
    publicationHost: DATA_COMMONS_PUBLICATION_HOST,
    fetchPrompt: fetchSkillGuidance,
    fetchInstructions: getServerInstructions,
  };
}

/**
 * Default registry. One entry per source the website talks to, each the
 * package's guidance block for that source, ready to be joined into the final
 * prompt by `composeSkillPrompt`.
 */
const SKILL_REGISTRY: SkillRegistry = {
  socrata: { sourceId: 'socrata', fetchText: (ctx) => socrataGuidanceText(guidanceContext(ctx), VIEW) },
  'data-commons': { sourceId: 'data-commons', fetchText: (ctx) => dataCommonsGuidanceText(guidanceContext(ctx), VIEW) },
  'boston-opencontext': {
    sourceId: 'boston-opencontext',
    fetchText: (ctx) => bostonGuidanceText(guidanceContext(ctx), VIEW),
  },
};

/**
 * Compose a multi-source LLM system prompt by joining an intro block, an
 * optional cross-source preamble, one block per active source, and an outro —
 * the package's join (`composePrompt`) and intro, over the blocks `registry`
 * produces. The composer itself has no environment reads, no global mutable
 * state, and no source-specific branches.
 *
 * The default registry argument is the module-level `SKILL_REGISTRY`. Tests
 * inject custom registries to exercise composition logic without mocking
 * module imports. Production composes through `buildSystemPrompt`.
 *
 * Sources that throw, return an empty string, or are missing from the
 * registry are skipped with a warning logged. Composition always succeeds; an
 * empty `activeSources` produces intro + preamble + outro.
 */
export async function composeSkillPrompt(
  activeSources: SourceId[],
  context: SkillContext,
  registry: SkillRegistry = SKILL_REGISTRY,
): Promise<string> {
  return composePrompt(
    { intro: introFor(context.today), preamble: context.preamble, outro: context.outro ?? OUTRO },
    activeSources.map((sourceId) => async () => {
      const entry = registry[sourceId];
      if (!entry) {
        console.warn(`[composeSkillPrompt] Unknown sourceId "${sourceId}" — skipping`);
        return '';
      }
      try {
        return await entry.fetchText(context);
      } catch (error) {
        warnSourceTextFailed(sourceId, error);
        return '';
      }
    }),
  );
}

/**
 * The section a LOCKED instance appends to the composed prompt (#436, ruling
 * D7: "under the lock the tool text stops inviting other portals"): the
 * package's lock section. It names what no longer applies under the lock
 * instead of forking the text above, which stays true of every unlocked
 * instance and which the Socrata MCP server also serves from outside this
 * repository. Names only tools the model can call (`portal-lock.test.ts`). The
 * closing sentence names the other sources this instance offers — Data
 * Commons, and Boston OpenContext only where it is configured (sprint 238,
 * ruling D2).
 */
export function portalLockGuidance(
  lockedPortal: string,
  configured: McpRegistryEnv = readMcpEnvFromProcess(),
  selection?: SourceSelection,
): string {
  return civicRouter.aliasedPortalLockGuidance(lockedPortal, configured, selection);
}

/**
 * The composed prompt, with `portalLockGuidance` appended when the run is
 * locked; the prompt unchanged when it is not. The query routes call this on
 * `buildSystemPrompt`'s result. Replay never does: its portal comes from the
 * record it replays, and the lock does not govern it.
 */
export function withPortalLockGuidance(
  systemPrompt: string,
  lockedPortal?: string,
  configured: McpRegistryEnv = readMcpEnvFromProcess(),
  selection?: SourceSelection,
): string {
  return civicRouter.aliasedWithPortalLockGuidance(systemPrompt, lockedPortal, configured, selection);
}

/** Where a component's guidance came from (ADR-0033 §E, Q65's three kinds). */
export type GuidanceOrigin = 'endpoint' | 'inline' | 'fallback';

/** One component of a composed prompt, as a record states it (ADR-0033 §E). */
export interface CompositionComponent {
  /** The manifest entry's `id` (the value every call's `mcp.server.id`
   *  carries), or, for the composing package, its package name. */
  id: string;
  /** What this instance knows of the component's version: the composing
   *  package's, as installed. Omitted for a source: the client does not read
   *  a server's `serverInfo`. */
  version?: string;
  /** Lowercase hex SHA-256 of the component's block as composed into the
   *  prompt. Omitted when the component contributed no block. */
  guidanceHash?: string;
  /** Present exactly when `guidanceHash` is. */
  guidanceOrigin?: GuidanceOrigin;
}

/** A composed prompt and what a record states about its composition. */
export interface ComposedSystemPrompt {
  /** The composed prompt: what `buildSystemPrompt` returns for the same
   *  inputs, before any lock section. */
  prompt: string;
  /** The `today` the prompt states, `YYYY-MM-DD` (#475). */
  assertedDate: string;
  /** Every manifest source, in manifest order, with the reason it was or was
   *  not offered: `configured` / `not-configured` with no selection,
   *  `selected` / `not-selected` / `not-configured` with one. */
  sourcesOffered: SourceOffered[];
  /** One entry per offered source in manifest order, then one for the router
   *  package that composed the prompt. */
  components: CompositionComponent[];
}

/** The inputs of one composition. */
export interface ComposeSystemPromptInput {
  /** The run's Socrata portal, if any. */
  portal?: string;
  /** The instance's configuration, read once per run. */
  configured?: McpRegistryEnv;
  /** The source ids the run selects; absent, every source the configuration offers. */
  selection?: SourceSelection;
  /** The run's clock. The prompt states this instant's UTC date. */
  now?: Date;
}

/** One fetch the composition made, keyed so the replay below can serve it. */
type FetchOutcome = { ok: true; text: string | null } | { ok: false };

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * The origin of a block, from the fetches its entry made (ADR-0033 §E):
 *   - `fallback` when a fetch failed and the block was still composed — the
 *     Socrata block is then `SOCRATA_SKILL_FALLBACK`;
 *   - `endpoint` when a fetch returned text, which the block then carries —
 *     the Socrata guidance, or a server's `initialize` instructions;
 *   - `inline` otherwise: every byte is the package's own text.
 * The Data Commons and Boston blocks join a server's instructions to the
 * package's skill text. Such a block is `endpoint` when the server sent
 * instructions — its bytes then depend on what the server sent at run time —
 * and `inline` when it sent none, because the block is then entirely the
 * package's. A Data Commons or Boston fetch that fails leaves no block, so it
 * has no origin.
 */
function originOf(fetches: FetchOutcome[]): GuidanceOrigin {
  if (fetches.some((f) => !f.ok)) return 'fallback';
  if (fetches.some((f) => f.ok && typeof f.text === 'string' && f.text.length > 0)) return 'endpoint';
  return 'inline';
}

/**
 * The composed prompt with what a record states about it (#599 W4).
 *
 * The prompt is the router's aliased composition, unchanged: the same call
 * `buildSystemPrompt` makes, with this module's fetchers wrapped so each
 * answer is kept. Each component's block is then recomposed from those kept
 * answers by the same manifest entry the router called — no second fetch —
 * and hashed. A block that is not found verbatim in the prompt (which the
 * router's join makes impossible) is stated with no hash rather than a hash
 * of something the prompt did not carry.
 */
export async function composeSystemPrompt(input: ComposeSystemPromptInput = {}): Promise<ComposedSystemPrompt> {
  const { portal, configured = readMcpEnvFromProcess(), selection, now = new Date() } = input;
  const today = now.toISOString().split('T')[0];

  const prompts = new Map<string, FetchOutcome>();
  const instructions = new Map<string, FetchOutcome>();
  const promptKey = (name: string, args: Record<string, string>) => JSON.stringify([name, args]);

  const prompt = await civicRouter.aliasedBuildSystemPrompt({
    portal,
    configured,
    today,
    publicationHost: DATA_COMMONS_PUBLICATION_HOST,
    fetchPrompt: async (name, args) => {
      try {
        const text = await fetchSkillGuidance(name, args);
        prompts.set(promptKey(name, args), { ok: true, text });
        return text;
      } catch (error) {
        prompts.set(promptKey(name, args), { ok: false });
        throw error;
      }
    },
    fetchInstructions: async (sourceId) => {
      try {
        const text = await fetchInstructions(sourceId);
        instructions.set(sourceId, { ok: true, text });
        return text;
      } catch (error) {
        instructions.set(sourceId, { ok: false });
        throw error;
      }
    },
    selection,
  });

  const offered = new Set(civicRouter.offeredSkillSources(configured, selection));
  const components: CompositionComponent[] = [];
  for (const entry of civicRouter.manifest) {
    if (!offered.has(entry.sourceId)) continue;
    const seen: FetchOutcome[] = [];
    let unserved = false;
    const replay = (outcome: FetchOutcome | undefined) => {
      if (!outcome) {
        unserved = true;
        throw new Error('composeSystemPrompt: a fetch the composition did not make');
      }
      seen.push(outcome);
      if (!outcome.ok) throw new Error('composeSystemPrompt: replayed fetch failure');
      return outcome.text;
    };
    let block = '';
    try {
      block = await entry.guidance.fetchText(
        {
          portal,
          publicationHost: DATA_COMMONS_PUBLICATION_HOST,
          fetchPrompt: async (name, args) => replay(prompts.get(promptKey(name, args))) as string,
          fetchInstructions: async (sourceId) => replay(instructions.get(sourceId)),
        },
        VIEW,
      );
    } catch {
      block = '';
    }
    const contributed = !unserved && block.trim().length > 0 && prompt.includes(block);
    components.push({
      id: entry.id,
      ...(contributed ? { guidanceHash: sha256Hex(block), guidanceOrigin: originOf(seen) } : {}),
    });
  }
  components.push({ id: routerPackage.name, version: routerPackage.version });

  return {
    prompt,
    assertedDate: today,
    sourcesOffered: civicRouter
      .sourcesOffered(configured, selection)
      .map(({ sourceId, alias, reason }) => ({ sourceId, alias, reason })),
    components,
  };
}

/**
 * The composed system prompt for the sources this instance offers
 * (`offeredSkillSources`: `['socrata', 'data-commons']`, plus
 * `'boston-opencontext'` when `BOSTON_OPENCONTEXT_MCP_URL` is set), with the
 * cross-source preamble and outro for exactly those sources — so an instance
 * that does not configure Boston's composes none of its text and never asks
 * its server for instructions. `portal` is optional (#384, F2): without one
 * the Socrata block is composed with no portal-specific section and names no
 * default portal. `selection` narrows the sources further (#599 D3); absent,
 * the prompt is the one every run sent before it existed.
 */
export const buildSystemPrompt = async (
  portal?: string,
  configured: McpRegistryEnv = readMcpEnvFromProcess(),
  selection?: SourceSelection,
): Promise<string> => (await composeSystemPrompt({ portal, configured, selection })).prompt;
