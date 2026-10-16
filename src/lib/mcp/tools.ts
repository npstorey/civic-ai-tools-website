import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { civicRouter, type SourceSelection } from '@typedstandards/civic-typed-router';
import { readMcpEnvFromProcess, type McpRegistryEnv } from './registry.ts';

// Unified OpenAI-style function-calling schema spanning every MCP source the
// website talks to. The client in `./client.ts` uses the tool name to route
// each call to the correct MCP server via `./registry.ts`.
//
// The schemas, their one-portal rewrites (#436, ruling D7) and the offered-tools
// filter are `@typedstandards/civic-typed-router`'s (#599 W2): this file keeps
// the website's names and signatures and holds none of their text.
//
// THE ALIASED VIEW (#599 W3, ADR-0032). Every tool is offered as `<alias>__<upstream
// name>`: `socrata__get_data`, `data_commons__search_indicators`,
// `boston__ckan__search_datasets`. Every description and parameter description
// names a tool the same way. The client calls each server by its own name
// (`routeToolCall` in `./registry.ts`). The view is the package's own
// `aliased*` output, and `unaliasText` with the package's dispatch map undoes it
// to the bare bytes W2 sent.
// The package's tool type is structural (a JSON-schema shape with read-only
// fields); the casts below give it the `openai` type the loop core sends.

/**
 * Every tool schema this codebase has, for every source — the vocabulary, not
 * one instance's offer. A query run hands the model `offeredMcpTools(...)` of
 * this, which drops the tools of an optional source the instance did not
 * configure; replay of a published record hands the model this list as is.
 * The client in ./client.ts routes each call to the correct MCP server by tool
 * name. The package's array itself: one object for the process's lifetime.
 */
export const mcpTools: ChatCompletionTool[] = civicRouter.aliasedMcpTools as unknown as ChatCompletionTool[];

/**
 * The tool schemas for a run: `mcpTools` itself when the instance is not
 * locked (the same array, so an unlocked run sends byte-for-byte what it sent
 * before #436), else the same tools with the three Socrata descriptions and
 * `get_data`'s `portal` property rewritten for the one Socrata portal it
 * serves. The Data Commons and Boston OpenContext tools are unchanged. Which
 * sources' tools a run is offered at all is `offeredMcpTools`'s decision,
 * applied to this function's result.
 *
 * Under `SITE_PORTAL_LOCKED` the loop core refuses a `get_data` call naming
 * another portal and a `fetch` whose identifier names one, in either spelling; the locked text is
 * the other half: the model is not INVITED to make those calls. The schemas'
 * names and shapes do not change, so the set of callable tools
 * (`prompt-advertised-tools.test.ts`) is the same locked or not.
 */
export function mcpToolsFor(lockedPortal?: string): ChatCompletionTool[] {
  return civicRouter.aliasedMcpToolsFor(lockedPortal) as unknown as ChatCompletionTool[];
}

/**
 * The tool schemas a query run offers the model: `tools` without the tools of
 * any optional source the instance did not configure (`withheldToolNames`,
 * sprint 238 ruling D2) — so a model is never offered a tool no server here can
 * answer. With every optional source configured, `tools` itself is returned
 * (the same array), so such an instance sends byte-for-byte what it sent
 * before. The query routes and the compare factory call this on
 * `mcpToolsFor(lockedPortal)`; replay does not, and keeps the full vocabulary.
 *
 * `selection` (#599 D3) narrows the sources further: absent, every source the
 * configuration offers; given, only the configured sources it names. An id the
 * manifest does not hold is ignored. The query routes pass
 * `DEFAULT_SOURCE_SELECTION` until a request can carry one (R6).
 */
export function offeredMcpTools(
  tools: ChatCompletionTool[],
  configured: McpRegistryEnv = readMcpEnvFromProcess(),
  selection?: SourceSelection,
): ChatCompletionTool[] {
  return civicRouter.aliasedOfferedMcpTools(tools, configured, selection);
}

// Model definitions moved to src/lib/model-catalog.ts (civic-ai-tools-website#30
// P2). `ModelDefinition`, the offered list, its pricing and its display names
// were four tables in three files describing the same ids; they are now one
// catalog with one resolver (src/lib/model-resolver.ts). Nothing about MCP
// tooling lived in them, which is why they left this file rather than staying.
