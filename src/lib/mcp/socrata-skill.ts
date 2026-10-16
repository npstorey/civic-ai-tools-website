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
export { outroFor, type SourceId } from '@typedstandards/civic-typed-router';

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
export function offeredSkillSources(configured: McpRegistryEnv = readMcpEnvFromProcess()): SourceId[] {
  return civicRouter.offeredSkillSources(configured) as SourceId[];
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
): string {
  return civicRouter.aliasedPortalLockGuidance(lockedPortal, configured);
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
): string {
  return civicRouter.aliasedWithPortalLockGuidance(systemPrompt, lockedPortal, configured);
}

/**
 * The composed system prompt for the sources this instance offers
 * (`offeredSkillSources`: `['socrata', 'data-commons']`, plus
 * `'boston-opencontext'` when `BOSTON_OPENCONTEXT_MCP_URL` is set), with the
 * cross-source preamble and outro for exactly those sources — so an instance
 * that does not configure Boston's composes none of its text and never asks
 * its server for instructions. `portal` is optional (#384, F2): without one
 * the Socrata block is composed with no portal-specific section and names no
 * default portal.
 */
export const buildSystemPrompt = async (
  portal?: string,
  configured: McpRegistryEnv = readMcpEnvFromProcess(),
): Promise<string> =>
  civicRouter.aliasedBuildSystemPrompt({
    portal,
    configured,
    today: new Date().toISOString().split('T')[0],
    publicationHost: DATA_COMMONS_PUBLICATION_HOST,
    fetchPrompt: fetchSkillGuidance,
    fetchInstructions,
  });
