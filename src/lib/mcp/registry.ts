// Pure routing registry for the website's MCP clients.
//
// Each logical "source" (socrata, data-commons, ...) maps to an MCP server URL
// plus the tools that server hosts. Kept side-effect-free and free of
// `process.env` reads so it can be unit-tested in isolation — the caller
// resolves env at construction time via `buildMcpRegistry`.

export interface McpServerConfig {
  /** Stable source identifier used in traces and provenance. */
  sourceId: string;
  /** Human-readable label for UI / trace attributes. */
  label: string;
  /** Full MCP endpoint URL the client POSTs to (always ends in `/mcp`). */
  endpointUrl: string;
  /** Extra headers to attach to every request to this server. */
  headers?: Record<string, string>;
  /** Tool names this server hosts. */
  tools: string[];
}

export interface McpRegistry {
  servers: Record<string, McpServerConfig>;
  toolIndex: Record<string, string>;
  /**
   * Tool names whose hosting server is KNOWN but UNCONFIGURED, mapped to the
   * environment variable that would configure it. A tool listed here resolves
   * to no server; the client uses the variable name to refuse with an
   * operator-actionable error instead of a generic "unknown tool" (#258 C4).
   */
  unconfiguredTools: Record<string, string>;
}

export interface McpRegistryEnv {
  /**
   * Absent when `SOCRATA_MCP_URL` is unset. There is deliberately NO
   * reference-host fallback (#258 C4): an unconfigured instance refuses
   * Socrata-routed queries per-request rather than silently routing its
   * users' queries through another deployment's infrastructure.
   */
  socrataUrl?: string;
  dataCommonsUrl: string;
  dataCommonsApiKey?: string;
  bostonOpencontextUrl: string;
}

const SOCRATA_TOOLS = ['get_data', 'search', 'fetch'];
const DATA_COMMONS_TOOLS = ['search_indicators', 'get_observations'];
const BOSTON_OPENCONTEXT_TOOLS = [
  'ckan__search_datasets',
  'ckan__get_dataset',
  'ckan__query_data',
  'ckan__get_schema',
  'ckan__execute_sql',
  'ckan__aggregate_data',
];

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
 * Index every server's tools by bare tool name — the map the router keys on.
 *
 * Extracted from `buildMcpRegistry` and exported so this index's rules can be
 * driven directly: `buildMcpRegistry(env)` builds its servers from
 * compile-time constants, so its signature offers no way to hand it two
 * servers that share a tool name.
 */
export function buildToolIndex(
  servers: Record<string, McpServerConfig>,
): Record<string, string> {
  const toolIndex: Record<string, string> = {};
  for (const [sourceId, server] of Object.entries(servers)) {
    for (const tool of server.tools) {
      toolIndex[tool] = sourceId;
    }
  }
  return toolIndex;
}

/**
 * Build a routing registry from resolved environment values. Callers should
 * pass the env they actually want — the function does not read `process.env`
 * so the same code path is exercised in dev, prod, and tests.
 */
export function buildMcpRegistry(env: McpRegistryEnv): McpRegistry {
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
          },
        }
      : {}),
    'data-commons': {
      sourceId: 'data-commons',
      label: 'Google Data Commons MCP Server',
      endpointUrl: normalizeMcpEndpoint(env.dataCommonsUrl),
      headers: env.dataCommonsApiKey ? { 'X-API-Key': env.dataCommonsApiKey } : undefined,
      tools: DATA_COMMONS_TOOLS,
    },
    'boston-opencontext': {
      sourceId: 'boston-opencontext',
      label: 'Boston OpenContext MCP Server',
      endpointUrl: normalizeMcpEndpoint(env.bostonOpencontextUrl),
      tools: BOSTON_OPENCONTEXT_TOOLS,
    },
  };

  const toolIndex = buildToolIndex(servers);

  const unconfiguredTools: Record<string, string> = {};
  if (!env.socrataUrl) {
    for (const tool of SOCRATA_TOOLS) {
      unconfiguredTools[tool] = 'SOCRATA_MCP_URL';
    }
  }

  return { servers, toolIndex, unconfiguredTools };
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

/** One server this instance routes to, as a record names it. */
export interface ConfiguredMcpServer {
  /** The configured address, as configured. */
  url: string;
  /** The source id. */
  name: string;
}

/**
 * Every server in `buildMcpRegistry(env).servers`, in that insertion order,
 * each with its configured address and its source id. A server with no
 * address mapping throws rather than being dropped: a list that silently lost
 * a server would state, in signed bytes, that the run did not have it.
 */
export function configuredMcpServers(configured: McpRegistryEnv): ConfiguredMcpServer[] {
  return Object.keys(buildMcpRegistry(configured).servers).map((sourceId) => {
    const url = configuredAddressForSource(configured, sourceId);
    if (url === undefined) {
      throw new Error(
        `MCP registry server "${sourceId}" has no configured address — add it to MCP_SOURCE_ADDRESS_FIELD`,
      );
    }
    return { url, name: sourceId };
  });
}

/** Look up the server that hosts a given tool name. Returns `undefined` for unknown tools. */
export function resolveServerForTool(
  registry: McpRegistry,
  toolName: string,
): McpServerConfig | undefined {
  const sourceId = registry.toolIndex[toolName];
  if (!sourceId) return undefined;
  return registry.servers[sourceId];
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
 * through it refuses, naming the variable. The Data Commons and Boston
 * OpenContext defaults are third-party PUBLIC endpoints (Google's hosted
 * Data Commons, the City of Boston's OpenContext server), not reference
 * infrastructure, so they keep their coded defaults.
 */
export function readMcpEnvFromProcess(): McpRegistryEnv {
  return {
    socrataUrl: presentOrUndefined(process.env.SOCRATA_MCP_URL),
    dataCommonsUrl: process.env.DATA_COMMONS_MCP_URL || 'https://api.datacommons.org/mcp',
    dataCommonsApiKey: process.env.DATA_COMMONS_API_KEY || undefined,
    bostonOpencontextUrl:
      process.env.BOSTON_OPENCONTEXT_MCP_URL || 'https://data-mcp.boston.gov/mcp',
  };
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
