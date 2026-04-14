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
}

export interface McpRegistryEnv {
  socrataUrl: string;
  dataCommonsUrl: string;
  dataCommonsApiKey?: string;
}

const SOCRATA_TOOLS = ['get_data', 'search', 'fetch'];
const DATA_COMMONS_TOOLS = ['search_indicators', 'get_observations'];

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
 * Build a routing registry from resolved environment values. Callers should
 * pass the env they actually want — the function does not read `process.env`
 * so the same code path is exercised in dev, prod, and tests.
 */
export function buildMcpRegistry(env: McpRegistryEnv): McpRegistry {
  const servers: Record<string, McpServerConfig> = {
    socrata: {
      sourceId: 'socrata',
      label: 'Socrata MCP Server',
      endpointUrl: normalizeMcpEndpoint(env.socrataUrl),
      tools: SOCRATA_TOOLS,
    },
    'data-commons': {
      sourceId: 'data-commons',
      label: 'Google Data Commons MCP Server',
      endpointUrl: normalizeMcpEndpoint(env.dataCommonsUrl),
      headers: env.dataCommonsApiKey ? { 'X-API-Key': env.dataCommonsApiKey } : undefined,
      tools: DATA_COMMONS_TOOLS,
    },
  };

  const toolIndex: Record<string, string> = {};
  for (const [sourceId, server] of Object.entries(servers)) {
    for (const tool of server.tools) {
      toolIndex[tool] = sourceId;
    }
  }

  return { servers, toolIndex };
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

/** Read the env values the website currently exposes to the MCP client. */
export function readMcpEnvFromProcess(): McpRegistryEnv {
  return {
    socrataUrl: process.env.SOCRATA_MCP_URL || 'https://socrata-mcp.civicaitools.org',
    dataCommonsUrl: process.env.DATA_COMMONS_MCP_URL || 'https://api.datacommons.org/mcp',
    dataCommonsApiKey: process.env.DATA_COMMONS_API_KEY || undefined,
  };
}
