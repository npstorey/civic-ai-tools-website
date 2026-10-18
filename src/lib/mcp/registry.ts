// Pure routing registry for the website's MCP clients.
//
// Each logical "source" (socrata, data-commons, ...) maps to an MCP server URL
// plus the tools that server hosts. Kept side-effect-free and free of
// `process.env` reads so it can be unit-tested in isolation — the caller
// resolves env at construction time via `buildMcpRegistry`.
//
// The sources themselves — their tool names, which of them are optional and
// which configuration variable offers each, and the reading of that
// configuration — are `@typedstandards/civic-typed-router`'s manifest
// (#599 W2). What stays here is the network side the package does not carry:
// the server configs, endpoint normalization, request headers, the per-call
// refusal of an unconfigured source, and the addresses a record states.
//
// Since #599 W3 every tool is offered to the model as `<alias>__<upstream
// name>` (ADR-0032). The index below is keyed by that exposed name, dispatch
// resolves a called name through the package's dispatch map and its rule
// (`routeToolCall`), and the server is always called by its own, upstream,
// name. The package's startup checks run when its router is built
// (`createCivicRouter`, at its module evaluation): an ill-formed alias, an
// alias or a source id two entries share, or two exposed names that collide
// after normalizing refuses the manifest before anything here runs.

import {
  BOSTON_OPENCONTEXT_TOOL_NAMES,
  CIVIC_MANIFEST,
  civicRouter,
  configuredSources,
  DATA_COMMONS_TOOL_NAMES,
  exposedToolName,
  readMcpEnv,
  resolveCalledName,
  SOCRATA_TOOL_NAMES,
  type DispatchMap,
  type McpRegistryEnv,
  type SourceHosting,
  type SourceSelection,
} from '@typedstandards/civic-typed-router';
import { AmbiguousToolNameError } from './tool-name-refusal.ts';

export { AmbiguousToolNameError } from './tool-name-refusal.ts';

export interface McpServerConfig {
  /** Stable source identifier used in traces and provenance. */
  sourceId: string;
  /** Human-readable label for UI / trace attributes. */
  label: string;
  /** Full MCP endpoint URL the client POSTs to (always ends in `/mcp`). */
  endpointUrl: string;
  /** Extra headers to attach to every request to this server. */
  headers?: Record<string, string>;
  /** Tool names this server hosts: its own, upstream, names, the ones sent on
   *  the wire. */
  tools: string[];
  /** The source's alias (ADR-0032): the prefix of every name the model is
   *  offered for this server's tools, `<alias>__<tool>`. */
  alias: string;
  /** The server's identity as a record states it (`mcp.server.id`): the
   *  manifest entry's `id`. */
  serverId: string;
}

/**
 * A source this instance RUNS rather than calls at a configured address: a
 * publisher-bundled stdio server from the manifest entry's `hosting` field,
 * offered while its switch is on (`configuredSources`). It has no address
 * here, because it has none until a call wakes its sandbox: the address is
 * resolved per call (`./hosting/address.ts`), never configured and never
 * cached on this object.
 *
 * Held in its own map, `McpRegistry.hosted`, beside `servers` (#617 G0, seam
 * c1): every reader of `servers` — the client's era bookkeeping, the
 * instructions fetch, the prompt fetch, the record's server list — keeps
 * reading configured addresses only, and none of them can wake a hosted
 * source by being asked about it.
 */
export interface HostedMcpServer {
  sourceId: string;
  label: string;
  /** Tool names the source hosts: its own, upstream, names. */
  tools: string[];
  alias: string;
  /** The manifest entry's `id`, as for an addressed server. */
  serverId: string;
  /** The pinned package the host runs, from the manifest entry. */
  hosting: SourceHosting;
}

/** Whether a routed server is hosted (resolved per call) rather than addressed. */
export function isHostedServer(server: McpServerConfig | HostedMcpServer): server is HostedMcpServer {
  return Object.hasOwn(server, 'hosting');
}

export interface McpRegistry {
  servers: Record<string, McpServerConfig>;
  /** Sources this instance runs itself, offered by their switch and keyed by
   *  source id; see `HostedMcpServer`. Never read by anything that reads
   *  `servers`. */
  hosted: Record<string, HostedMcpServer>;
  /** Exposed name (`socrata__get_data`) to the source id that hosts it. */
  toolIndex: Record<string, string>;
  /**
   * Exposed names of tools whose hosting server is KNOWN but UNCONFIGURED,
   * mapped to the environment variable that would configure it. A tool listed
   * here resolves to no server; the client uses the variable name to refuse
   * with an operator-actionable error instead of a generic "unknown tool"
   * (#258 C4), whichever spelling the call used.
   */
  unconfiguredTools: Record<string, string>;
  /**
   * The source ids a run on this instance is offered, in manifest order: the
   * offered set the dispatch rule reads (a bare name is accepted when exactly
   * one OFFERED source has it). Socrata is offered whether or not its address
   * is set, as in the composed prompt: it is required, so a call to it on an
   * instance without its address is refused per call, naming the variable.
   *
   * Narrowed by the run's selection when one is passed (#599 D3, R6 W1): the
   * same set the composed prompt and the tools array are built from
   * (`offeredSkillSources(configured, selection)`), so the dispatch refuses
   * what the model was not offered rather than sending it.
   */
  offeredSources: string[];
}

/**
 * The instance's MCP configuration, as `readMcpEnvFromProcess` reads it: the
 * package's type. `socrataUrl` is absent when `SOCRATA_MCP_URL` is unset —
 * there is deliberately NO reference-host fallback (#258 C4). `dataCommonsUrl`
 * falls back to Google's public endpoint. `bostonOpencontextUrl` is absent when
 * `BOSTON_OPENCONTEXT_MCP_URL` is unset: the source is optional and has no
 * coded default (sprint 238, ruling D2).
 */
export type { McpRegistryEnv };

// The routing lists, in the package's order (copies: `McpServerConfig.tools`
// is a mutable array, the package's are read-only).
const SOCRATA_TOOLS = [...SOCRATA_TOOL_NAMES];
const DATA_COMMONS_TOOLS = [...DATA_COMMONS_TOOL_NAMES];
const BOSTON_OPENCONTEXT_TOOLS = [...BOSTON_OPENCONTEXT_TOOL_NAMES];

/**
 * Sources a run is offered only when the instance configures them, each with
 * the variable that does and the tools it hosts (sprint 238, ruling D2).
 *
 * Unconfigured, such a source is ABSENT, not failing: no server in the
 * registry, none of its tools offered to the model (`withheldToolNames`, read
 * by `offeredMcpTools` in `./tools.ts`), none of its guidance in the composed
 * prompt (`offeredSkillSources` in `./socrata-skill.ts`), no entry in a
 * record's configured-servers list (`configuredMcpServers` below), and no
 * request sent to it. A call to one of its tools anyway — a replayed record, or
 * a model naming a tool it was not given — resolves to no server and is
 * refused per call through `unconfiguredTools`, naming the variable.
 *
 * This is the rule the Socrata source already follows (#258 C4), stated for
 * every source that is not required; it is not a per-source feature. Socrata
 * is not listed because it is required: an instance without it refuses every
 * query up front (`getMissingMcpRoutingError`), so its tools are never
 * withheld from a run that proceeds. Data Commons is not listed because it
 * keeps a coded public default. Read from the package's manifest: an entry
 * whose `configuration.requirement` is `optional`, with its address variable
 * and its routing list.
 */
const OPTIONAL_SOURCES: Record<string, { variable: string; alias: string; tools: readonly string[] }> = Object.fromEntries(
  CIVIC_MANIFEST.filter((entry) => entry.configuration.requirement === 'optional').map((entry) => [
    entry.sourceId,
    { variable: entry.configuration.addressVariable, alias: entry.alias, tools: entry.toolNames },
  ]),
);

/** A source's alias and server identity, from the package's manifest. */
function manifestIdentity(sourceId: string): { alias: string; serverId: string } {
  const entry = CIVIC_MANIFEST.find((candidate) => candidate.sourceId === sourceId);
  if (!entry) throw new Error(`MCP source "${sourceId}" is not in the router's manifest`);
  return { alias: entry.alias, serverId: entry.id };
}

/**
 * Normalize a base URL to a POST-able MCP endpoint. The Socrata env var is
 * historically a bare host (`https://socrata-mcp.civicaitools.org`) and the
 * client appends `/mcp` per-call; Google's docs for Data Commons give the
 * full `https://api.datacommons.org/mcp` URL. We accept either shape.
 */
function normalizeMcpEndpoint(url: string): string {
  const trimmed = url.replace(/\/$/, '');
  return trimmed.endsWith('/mcp') ? trimmed : `${trimmed}/mcp`;
}

/**
 * Index every server's tools by EXPOSED name, `<alias>__<tool>` — the name the
 * model is offered and the key dispatch resolves to (#599 W3, ADR-0032).
 *
 * Two sources may now host the same upstream name: Socrata's `search` and a
 * fourth source's `search` are `socrata__search` and `<alias>__search`, two
 * keys. An exposed name two servers share still REFUSES, naming the name and
 * both servers: the exposed name is the index's only key, so the alternative
 * is a second binding overwriting the first, one server's tool silently
 * unreachable, with nothing in a log or a trace to say so (#503 P3, hub open
 * question Q60 part b). The package's startup checks refuse such a manifest
 * first; this is the same refusal for the servers this module builds.
 *
 * This is a refusal an operator can never trigger: `buildMcpRegistry(env)`
 * builds its servers from compile-time constants, so a duplicate arrives only
 * with a code change. That also makes it safe at module-evaluation time,
 * which is where `src/lib/mcp/client.ts` calls it — unlike
 * `getMissingMcpRoutingError` below, which stays a check-and-return precisely
 * because its condition IS an environment `next build` does not have.
 *
 * Exported because `buildMcpRegistry`'s signature offers no way to hand it two
 * servers that share a tool name; this is the seam the guard is driven
 * through (`registry-duplicate-tool-name.test.ts`).
 */
export function buildToolIndex(
  servers: Record<string, Pick<McpServerConfig, 'tools' | 'alias'>>,
): Record<string, string> {
  const toolIndex: Record<string, string> = {};
  for (const [sourceId, server] of Object.entries(servers)) {
    for (const tool of server.tools) {
      const exposed = exposedToolName(server.alias, tool);
      if (Object.prototype.hasOwnProperty.call(toolIndex, exposed)) {
        throw new McpConfigurationError(
          `Duplicate MCP tool name "${exposed}": it is hosted by both "${toolIndex[exposed]}" and ` +
            `"${sourceId}". Exposed tool names are the router's only key, so the second binding would ` +
            `replace the first and that server's tool would be unreachable. Give one of the sources a ` +
            `distinct alias.`,
        );
      }
      toolIndex[exposed] = sourceId;
    }
  }
  return toolIndex;
}

/**
 * Build a routing registry from resolved environment values. Callers should
 * pass the env they actually want — the function does not read `process.env`
 * so the same code path is exercised in dev, prod, and tests.
 *
 * `selection` (#599 D3, R6 W1) narrows `offeredSources` and nothing else: the
 * servers, the hosted sources, the index and the unconfigured tools are the
 * configuration's. Absent, the registry is the one built before the selection
 * reached the dispatch, key for key.
 */
export function buildMcpRegistry(env: McpRegistryEnv, selection?: SourceSelection): McpRegistry {
  const servers: Record<string, McpServerConfig> = {
    // The Socrata server exists in the registry only when the instance
    // configured an endpoint for it. Unconfigured, its tools are recorded in
    // `unconfiguredTools` below so the client can refuse by naming the
    // variable — never routed to a default host (#258 C4).
    ...(env.socrataUrl
      ? {
          socrata: {
            sourceId: 'socrata',
            label: 'Socrata MCP Server',
            endpointUrl: normalizeMcpEndpoint(env.socrataUrl),
            tools: SOCRATA_TOOLS,
            ...manifestIdentity('socrata'),
          },
        }
      : {}),
    'data-commons': {
      sourceId: 'data-commons',
      label: 'Google Data Commons MCP Server',
      endpointUrl: normalizeMcpEndpoint(env.dataCommonsUrl),
      headers: env.dataCommonsApiKey ? { 'X-API-Key': env.dataCommonsApiKey } : undefined,
      tools: DATA_COMMONS_TOOLS,
      ...manifestIdentity('data-commons'),
    },
    // Optional: present only when configured (`OPTIONAL_SOURCES`). Unset,
    // its tools are recorded in `unconfiguredTools` below, as Socrata's are.
    ...(env.bostonOpencontextUrl
      ? {
          'boston-opencontext': {
            sourceId: 'boston-opencontext',
            label: 'Boston OpenContext MCP Server',
            endpointUrl: normalizeMcpEndpoint(env.bostonOpencontextUrl),
            tools: BOSTON_OPENCONTEXT_TOOLS,
            ...manifestIdentity('boston-opencontext'),
          },
        }
      : {}),
  };

  // Sources the instance runs itself, offered by their switch rather than an
  // address (router 0.3.0 `configuredSources`; #617 P3). Absent while the
  // switch is unset, so with every switch unset this registry is the one the
  // previous router built, key for key, and its tools are refused per call
  // below, naming the switch.
  const switchedOn = configuredSources(env);
  const hosted: Record<string, HostedMcpServer> = {};
  for (const entry of CIVIC_MANIFEST) {
    if (!entry.hosting || switchedOn[entry.sourceId] === undefined) continue;
    hosted[entry.sourceId] = {
      sourceId: entry.sourceId,
      label: entry.displayName,
      tools: [...entry.toolNames],
      alias: entry.alias,
      serverId: entry.id,
      hosting: entry.hosting,
    };
  }

  const toolIndex = buildToolIndex({ ...servers, ...hosted });

  const unconfiguredTools: Record<string, string> = {};
  if (!env.socrataUrl) {
    const { alias } = manifestIdentity('socrata');
    for (const tool of SOCRATA_TOOLS) {
      unconfiguredTools[exposedToolName(alias, tool)] = 'SOCRATA_MCP_URL';
    }
  }
  for (const [sourceId, { variable, alias, tools }] of Object.entries(OPTIONAL_SOURCES)) {
    if (servers[sourceId] || hosted[sourceId]) continue;
    for (const tool of tools) {
      unconfiguredTools[exposedToolName(alias, tool)] = variable;
    }
  }

  return { servers, hosted, toolIndex, unconfiguredTools, offeredSources: civicRouter.offeredSkillSources(env, selection) };
}

/**
 * `registry` with its offered set narrowed by `selection`: the same server
 * objects, so the client's per-server state and the hosted-source bookkeeping
 * see one object per source whatever the selection. `configured` is the
 * configuration `registry` was built from. Absent, `registry` itself.
 */
export function withSelection(
  registry: McpRegistry,
  configured: McpRegistryEnv,
  selection: SourceSelection,
): McpRegistry {
  if (selection === undefined) return registry;
  return { ...registry, offeredSources: civicRouter.offeredSkillSources(configured, selection) };
}

/**
 * Which `McpRegistryEnv` field carries each source's configured address —
 * keyed by SOURCE ID, the same key `buildMcpRegistry` gives its servers and
 * the harness's `CIVIC_SOURCE_REGISTRY` gives its entries (Wave N12 W5,
 * website #449 and civic-ai-tools#205; keyed by id so that a later
 * per-instance alias scheme is not pre-empted).
 *
 * The value a record states for a server is this field's value AS CONFIGURED
 * — what `readMcpEnvFromProcess()` returns, which is also what the skill-fetch
 * span records through `skillRoutingTraceAttributes` — never
 * `normalizeMcpEndpoint`'s routing form. `mcp-source-addresses.test.ts` fails
 * in both directions: a server `buildMcpRegistry` emits with no entry here,
 * and an entry here naming no server; it also requires each entry to name the
 * field that server's `endpointUrl` is built from.
 */
export const MCP_SOURCE_ADDRESS_FIELD = {
  socrata: 'socrataUrl',
  'data-commons': 'dataCommonsUrl',
  'boston-opencontext': 'bostonOpencontextUrl',
} as const satisfies Record<string, keyof McpRegistryEnv>;

/** A source's configured address as configured, or `undefined` when the
 *  source has no mapping or the instance configured no address for it. An
 *  empty string is `undefined` too: absence is stated by absence, never by
 *  `''`. Any other value is returned untouched — the value routing builds its
 *  endpoint from, before `normalizeMcpEndpoint`. */
export function configuredAddressForSource(
  configured: McpRegistryEnv,
  sourceId: string,
): string | undefined {
  if (!Object.hasOwn(MCP_SOURCE_ADDRESS_FIELD, sourceId)) return undefined;
  const field = MCP_SOURCE_ADDRESS_FIELD[sourceId as keyof typeof MCP_SOURCE_ADDRESS_FIELD];
  const value = configured[field];
  return value ? value : undefined;
}

/**
 * Whether a run on an instance configured as `configured` is offered this
 * source: always, unless it is an optional source (`OPTIONAL_SOURCES`) with no
 * configured address. The same condition `buildMcpRegistry` builds the
 * source's server on, so a source is offered exactly when it is routable.
 */
export function isSourceOffered(configured: McpRegistryEnv, sourceId: string): boolean {
  return civicRouter.isSourceOffered(configured, sourceId);
}

/**
 * The tool names the model is NOT offered on an instance configured as
 * `configured`: every tool of an optional source it did not configure, by the
 * name the model would have been offered (`<alias>__<tool>`, #599 W3). Empty
 * when every optional source is configured.
 */
export function withheldToolNames(configured: McpRegistryEnv): string[] {
  return civicRouter.aliasedWithheldToolNames(configured);
}

/** One server this instance routes to, as a record names it. */
export interface ConfiguredMcpServer {
  /** The configured address, as configured; for a hosted server, the purl of
   *  the package it runs (`hostedServerPurl`). */
  url: string;
  /** The source id. */
  name: string;
}

/**
 * The package URL (purl) a record states for a hosted server (#617 ruling a2):
 * `pkg:npm/<scope>/<name>@<version>`, from the manifest entry's hosting field,
 * never configured. Each segment of the package name is percent-encoded on its
 * own, so the scope's `@` is `%40` and the `/` between scope and name stays a
 * `/` (encoding the whole name would write `%2F`, which is not the purl):
 * `pkg:npm/%40betanyc/nyc-charter-laws-rules@0.3.1`.
 */
export function hostedServerPurl(hosting: Pick<SourceHosting, 'package' | 'version'>): string {
  return `pkg:npm/${hosting.package.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(hosting.version)}`;
}

/**
 * Every server a run on this instance can reach, as a record names it: each
 * server in `buildMcpRegistry(env).servers`, in that insertion order, with its
 * configured address; then each hosted server in `.hosted` (#617 P4, ruling
 * a2), with the purl of the package it runs (`hostedServerPurl`). A hosted
 * server has no configured address (its sandbox's address lives for one
 * session) and no entry in `MCP_SOURCE_ADDRESS_FIELD`; it is stated by what
 * it runs, so a Charter-on record lists Charter rather than omitting it (which,
 * until P4, it did: the list read `servers` only). An addressed server with no
 * address mapping still throws rather than being dropped: a list that silently
 * lost a server would state, in signed bytes, that the run did not have it.
 */
export function configuredMcpServers(configured: McpRegistryEnv): ConfiguredMcpServer[] {
  const registry = buildMcpRegistry(configured);
  const addressed = Object.keys(registry.servers).map((sourceId) => {
    const url = configuredAddressForSource(configured, sourceId);
    if (url === undefined) {
      throw new Error(
        `MCP registry server "${sourceId}" has no configured address — add it to MCP_SOURCE_ADDRESS_FIELD`,
      );
    }
    return { url, name: sourceId };
  });
  const hosted = Object.values(registry.hosted).map((server) => ({ url: hostedServerPurl(server.hosting), name: server.sourceId }));
  return [...addressed, ...hosted];
}

/** Where one called tool name goes: the server, and the names the call has. */
export interface RoutedToolCall {
  /** An addressed server, or a hosted one whose address the caller resolves
   *  for this call (`isHostedServer`). */
  server: McpServerConfig | HostedMcpServer;
  /** The name the model is offered: `<alias>__<tool>`. */
  exposedName: string;
  /** The server's own name for the tool, sent on the wire. */
  upstreamName: string;
  alias: string;
  /** `aliased`: the call used the exposed name. `bare`: an upstream name
   *  exactly one offered source has (the dispatch rule). */
  spelling: 'aliased' | 'bare';
}

type ToolCallResolution =
  | { ok: true; call: RoutedToolCall }
  | { ok: false; refusal: 'ambiguous'; candidates: readonly string[] }
  | { ok: false; refusal: 'not-configured'; variable: string }
  | { ok: false; refusal: 'not-offered' }
  | { ok: false; refusal: 'unknown' };

/** Whether this instance can send a call to `sourceId`: it has an addressed
 *  server or a hosted source for it. */
function isRoutable(registry: McpRegistry, sourceId: string): boolean {
  return Object.hasOwn(registry.servers, sourceId) || (registry.hosted !== undefined && Object.hasOwn(registry.hosted, sourceId));
}

/**
 * Resolve a called name against the registry: the dispatch rule (ADR-0032,
 * D6), read through the package's dispatch map and never by splitting the
 * name. Pure; `routeToolCall` and `resolveServerForTool` both read it.
 *
 * - An exposed name resolves by the map. A bare upstream name resolves when
 *   exactly one offered source has it; two or more is `ambiguous`, with every
 *   aliased form.
 * - A name whose source is known but not configured here — its server absent
 *   from the registry, or its source not offered (`not-offered` in the
 *   package's terms) — is `not-configured`, with the variable that would
 *   configure it, whichever spelling the call used (#258 C4).
 * - A name whose source IS configured here but the run's selection leaves out
 *   is `not-offered` (R6 W1): refused before any request, recorded
 *   `not_offered`. Configuration comes first, as in the router's
 *   `offeredReason`: a source the configuration does not offer is
 *   `not-configured` whatever the selection says.
 * - An ambiguous bare name one of whose candidates' sources this instance
 *   cannot route is `not-configured`, naming that source's variable (#632 D8
 *   ii, as corrected at R6 W1's gate). The first such candidate in manifest
 *   order names it; the candidates arrive in the dispatch map's order, which
 *   is the manifest's.
 *
 * WHY THE DISPATCH DOES NOT RESOLVE OVER THE ROUTABLE SOURCES. D8 (ii) ruled
 * that an unconfigured Socrata beside NYC Charter refuses a bare `search` as
 * `not-configured` naming `SOCRATA_MCP_URL`, and named the mechanism as "the
 * offered set becomes the routable sources". Measured at 5a8e975, the two
 * disagree: with `SOCRATA_MCP_URL` unset and Charter on, the routable sources
 * are `data-commons` and `nyc-charter`, and the package's rule over that set
 * ACCEPTS a bare `search` as `nyc_charter__search` — a call routed to Charter
 * on a guess, while the model is still offered `socrata__search` (Socrata is
 * required, so the prompt and the tools array keep it). So the rule resolves
 * over the offered set, as the prompt and the tools array are built, and
 * reads routability only to choose the refusal.
 */
function resolveToolCall(registry: McpRegistry, toolName: string, map: DispatchMap): ToolCallResolution {
  const resolution = resolveCalledName(map, registry.offeredSources, toolName);
  if (resolution.ok) {
    const sourceId = Object.hasOwn(registry.toolIndex, resolution.exposedName)
      ? registry.toolIndex[resolution.exposedName]
      : undefined;
    const server = sourceId === undefined ? undefined : registry.servers[sourceId] ?? registry.hosted[sourceId];
    if (server) {
      return {
        ok: true,
        call: {
          server,
          exposedName: resolution.exposedName,
          upstreamName: resolution.upstreamName,
          alias: resolution.alias,
          spelling: resolution.spelling,
        },
      };
    }
    const variable = registry.unconfiguredTools[resolution.exposedName];
    return variable ? { ok: false, refusal: 'not-configured', variable } : { ok: false, refusal: 'unknown' };
  }
  if (resolution.reason === 'ambiguous') {
    const variable = resolution.candidates
      .filter((name) => {
        const target = map.get(name);
        return target !== undefined && !isRoutable(registry, target.sourceId);
      })
      .map((name) => registry.unconfiguredTools[name])
      .find(Boolean);
    if (variable) return { ok: false, refusal: 'not-configured', variable };
    return { ok: false, refusal: 'ambiguous', candidates: resolution.candidates };
  }
  if (resolution.reason === 'not-offered') {
    const variable = resolution.candidates.map((name) => registry.unconfiguredTools[name]).find(Boolean);
    if (variable) return { ok: false, refusal: 'not-configured', variable };
    const configuredHere = resolution.candidates.some((name) => {
      const target = map.get(name);
      return target !== undefined && isRoutable(registry, target.sourceId);
    });
    if (configuredHere) return { ok: false, refusal: 'not-offered' };
  }
  return { ok: false, refusal: 'unknown' };
}

/**
 * Route a called tool name, in either spelling, to its server and its
 * upstream name, or refuse before any request is made:
 *
 * - `AmbiguousToolNameError` for a bare name two offered sources have, naming
 *   every aliased form (D6's dispatch rule);
 * - `McpConfigurationError` naming the variable, for a tool whose source is
 *   known but not configured (#258 C4) — the same error for `get_data` and
 *   `socrata__get_data`;
 * - `SourceNotOfferedError`, for a tool of a configured source the run's
 *   selection leaves out (R6 W1);
 * - a plain `Error` for a name no source has.
 *
 * `map` is the package's dispatch map; a test passes a larger manifest's.
 */
export function routeToolCall(
  registry: McpRegistry,
  toolName: string,
  map: DispatchMap = civicRouter.dispatchMap,
): RoutedToolCall {
  const resolved = resolveToolCall(registry, toolName, map);
  if (resolved.ok) return resolved.call;
  switch (resolved.refusal) {
    case 'ambiguous':
      throw new AmbiguousToolNameError(toolName, resolved.candidates);
    case 'not-configured':
      throw new McpConfigurationError(
        `The MCP server for tool "${toolName}" is not configured: ${resolved.variable} is missing or empty in the server environment. Set it and restart the server.`,
      );
    case 'not-offered':
      throw new SourceNotOfferedError(toolName);
    default:
      throw new Error(`No MCP server registered for tool "${toolName}"`);
  }
}

/** Look up the server that hosts a given tool name, in either spelling.
 *  Returns `undefined` for an unknown tool, a tool whose source is not
 *  configured here, and a bare name two offered sources share. */
export function resolveServerForTool(
  registry: McpRegistry,
  toolName: string,
  map: DispatchMap = civicRouter.dispatchMap,
): McpServerConfig | HostedMcpServer | undefined {
  const resolved = resolveToolCall(registry, toolName, map);
  return resolved.ok ? resolved.call.server : undefined;
}

/**
 * The source id of the server this instance routes `toolName` to, in either
 * spelling, or `undefined` when none does: a tool no source hosts, one whose
 * source is not configured here, one whose source the run's `selection`
 * leaves out (R6 W1), or a bare name two offered sources share. For a trace's `mcp.source` attribution, which the loop
 * core reads ABOVE its per-call `try`. `routeTool` (`./client.ts`) throws in the
 * same case, and a throw there ends the whole run instead of recording one
 * failed call; with this lookup the call itself is what gets refused — by the
 * transport, per call, recorded as failed — and the span names no source for a
 * call no server took. For every tool the instance does route, the answer is
 * `routeTool(name).sourceId`.
 */
export function routedSourceId(
  toolName: string,
  configured: McpRegistryEnv = readMcpEnvFromProcess(),
  selection?: SourceSelection,
): string | undefined {
  return resolveServerForTool(buildMcpRegistry(configured, selection), toolName)?.sourceId;
}

/** THE presence test — non-empty after trim, matching the preflight. */
function presentOrUndefined(raw: string | undefined): string | undefined {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined;
}

/**
 * Read the env values the website currently exposes to the MCP client.
 *
 * `SOCRATA_MCP_URL` has NO fallback (#258 C4, owner ruling): unset, the
 * Socrata source is simply unconfigured and every query that would route
 * through it refuses, naming the variable. `BOSTON_OPENCONTEXT_MCP_URL` has
 * none either (sprint 238, ruling D2): unset, Boston's OpenContext source is
 * not offered to a run (`OPTIONAL_SOURCES`). Its coded default went because
 * that public endpoint refuses every request without a bearer token, so the
 * default only ever produced failed calls. The Data Commons default is a
 * third-party PUBLIC endpoint (Google's hosted Data Commons), not reference
 * infrastructure, so it keeps its coded default.
 */
export function readMcpEnvFromProcess(): McpRegistryEnv {
  // The package's reader over exactly these five variables, each read by name
  // here so the environment this module reads stays visible
  // (`scripts/env-reads-declared.test.mjs`); `process.env` is never handed over
  // whole.
  return readMcpEnv({
    SOCRATA_MCP_URL: process.env.SOCRATA_MCP_URL,
    DATA_COMMONS_MCP_URL: process.env.DATA_COMMONS_MCP_URL,
    DATA_COMMONS_API_KEY: process.env.DATA_COMMONS_API_KEY,
    BOSTON_OPENCONTEXT_MCP_URL: process.env.BOSTON_OPENCONTEXT_MCP_URL,
    // The switch that offers the hosted NYC Charter source (#617 D7): only
    // `sandbox` turns it on; it names no address.
    NYC_CHARTER_HOSTING: process.env.NYC_CHARTER_HOSTING,
  });
}

/**
 * Typed, operator-actionable configuration failure: the environment names no
 * MCP endpoint for the primary data source. The `code` rides on SSE `error`
 * events and JSON error bodies so clients render distinct copy without
 * parsing message strings — same shape as `ModelConfigurationError`
 * (src/lib/model-client.ts, #178).
 */
export class McpConfigurationError extends Error {
  readonly code = 'mcp_not_configured' as const;

  constructor(message: string) {
    super(message);
    this.name = 'McpConfigurationError';
  }
}

/**
 * A tool of a source this instance configures, called on a run whose
 * selection leaves that source out (R6 W1). Thrown by `routeToolCall` before
 * any request, so no source saw the call. The `code` is read by
 * `classifyStreamError` before any message, so the loop records the call
 * `failureKind: 'not_offered'`, the model is told through
 * `describeToolFailureForLlm` and a reader through `friendlyStreamError`;
 * the message below is for the operator's log only.
 */
export class SourceNotOfferedError extends Error {
  readonly code = 'not_offered' as const;
  /** The name the model called. */
  readonly calledName: string;

  constructor(calledName: string) {
    super(`Tool "${calledName}" belongs to a data source this run is not offered, so the call was not sent.`);
    this.name = 'SourceNotOfferedError';
    this.calledName = calledName;
  }
}

const MISSING_SOCRATA_URL_MESSAGE =
  'No Socrata MCP endpoint is configured: SOCRATA_MCP_URL is missing or empty in the server environment. ' +
  'Set it to the MCP server this instance should query — there is no default — and restart the server.';

/**
 * Request-path guard: returns a typed `McpConfigurationError` when
 * `SOCRATA_MCP_URL` is missing or empty, or null when it is set. Routes call
 * this up front to refuse the query before any upstream work — a
 * check-and-return (not a throw) so each route shapes its own response (SSE
 * error event vs. JSON status), mirroring `getMissingModelCredentialError`.
 * Deliberately NOT a module-load throw: `next build` imports these modules
 * with no environment.
 */
export function getMissingMcpRoutingError(): McpConfigurationError | null {
  if (presentOrUndefined(process.env.SOCRATA_MCP_URL) === undefined) {
    return new McpConfigurationError(MISSING_SOCRATA_URL_MESSAGE);
  }
  return null;
}

/**
 * The routing attributes a query trace records on its skill-fetch span.
 * Records only EXPLICITLY CONFIGURED routing (#258 A9): with no
 * `socrataUrl`, the `skill.mcp_server_url` key is omitted entirely — never
 * filled with a default the instance did not set. (The query will have
 * refused before the span closes in that state; the omission keeps the
 * recorded trace honest regardless of call order.) The Data Commons URL is
 * a third-party public endpoint whose coded default is real routing, so it
 * is always recorded.
 */
export function skillRoutingTraceAttributes(env: McpRegistryEnv): Record<string, string> {
  return {
    ...(env.socrataUrl ? { 'skill.mcp_server_url': env.socrataUrl } : {}),
    'skill.data_commons_url': env.dataCommonsUrl,
  };
}
