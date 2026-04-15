import {
  buildMcpRegistry,
  readMcpEnvFromProcess,
  resolveServerForTool,
  type McpRegistry,
  type McpServerConfig,
} from './registry.ts';

const MCP_TIMEOUT_MS = 45_000; // 45-second timeout for MCP server requests

// M9.1: multi-MCP routing.
//
// The website talks to more than one MCP server (Socrata + Google Data
// Commons). Tool calls route to the correct server based on tool name via
// the registry in `./registry.ts`.
//
// Session handling is intentionally flexible because the two servers use
// different dialects of the MCP spec. The spec says the `mcp-session-id`
// header is OPTIONAL: servers MAY issue one on `initialize`, and clients
// MUST echo it back on subsequent requests only when it exists.
//
// - Socrata is stateful: `initialize` returns `mcp-session-id`, every
//   `tools/call` must carry it back, and a server restart invalidates the
//   session (which we detect and re-initialize on).
// - Data Commons' hosted HTTPS endpoint at api.datacommons.org/mcp is
//   stateless: `initialize` succeeds with no session header, and tool calls
//   carry only Content-Type + Accept + the `X-API-Key` registry header.
//
// Each server's state therefore tracks both whether we've initialized and
// whether that initialization produced a session id. Tool-call header
// construction is factored into `buildMcpRequestHeaders` so it can be unit
// tested against a stateless server config without network I/O.

const registry: McpRegistry = buildMcpRegistry(readMcpEnvFromProcess());

interface McpToolResult {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  error?: string;
}

interface ServerState {
  initialized: boolean;
  /** Session id issued by the server on `initialize`, or null if stateless. */
  sessionId: string | null;
}

const serverState: Record<string, ServerState> = {};

function getServerState(server: McpServerConfig): ServerState {
  let state = serverState[server.sourceId];
  if (!state) {
    state = { initialized: false, sessionId: null };
    serverState[server.sourceId] = state;
  }
  return state;
}

function resetServerState(server: McpServerConfig): void {
  serverState[server.sourceId] = { initialized: false, sessionId: null };
}

function createTimeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * Build the merged header set for any request to an MCP server. Combines the
 * standard JSON/SSE headers, any registry-supplied per-server headers (e.g.
 * Data Commons' `X-API-Key`), and a conditional `mcp-session-id` when a
 * session id is present. Exported for unit tests — no network I/O.
 */
export function buildMcpRequestHeaders(
  server: McpServerConfig,
  sessionId: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...(server.headers || {}),
  };
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }
  return headers;
}

/**
 * POST `initialize` to a server and return whatever session id the server
 * issued — or `null` if the server is stateless and issued none. Either
 * outcome is a successful initialization; the caller flips
 * `state.initialized = true` on return.
 */
async function initializeSession(server: McpServerConfig): Promise<string | null> {
  const { signal, clear } = createTimeoutSignal(MCP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(server.endpointUrl, {
      method: 'POST',
      headers: buildMcpRequestHeaders(server, null),
      signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'civic-ai-tools-website',
            version: '1.0.0',
          },
        },
      }),
    });
  } catch (error) {
    clear();
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`MCP server "${server.sourceId}" did not respond within ${MCP_TIMEOUT_MS / 1000}s — the upstream server may be starting up or unresponsive. Please try again.`);
    }
    throw error;
  } finally {
    clear();
  }

  if (!response.ok) {
    throw new Error(`MCP initialization failed for "${server.sourceId}": ${response.status}`);
  }

  // Session id header is optional per the MCP spec — stateless servers omit it.
  return response.headers.get('mcp-session-id');
}

/**
 * Ensure a server has been initialized. Returns the session id issued during
 * initialization, which may be `null` for stateless servers. Only triggers a
 * real `initialize` call the first time (or after `resetServerState` on a
 * session-expired retry).
 */
async function ensureInitialized(server: McpServerConfig): Promise<string | null> {
  const state = getServerState(server);
  if (!state.initialized) {
    state.sessionId = await initializeSession(server);
    state.initialized = true;
  }
  return state.sessionId;
}

/**
 * Look up the server hosting this tool and return it, throwing a clear error
 * if no server claims the tool. Exported for tests.
 */
export function routeTool(toolName: string): McpServerConfig {
  const server = resolveServerForTool(registry, toolName);
  if (!server) {
    throw new Error(`No MCP server registered for tool "${toolName}"`);
  }
  return server;
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const server = routeTool(name);
  await ensureInitialized(server);

  try {
    return await makeToolCall(server, name, args);
  } catch (error) {
    // For stateful servers (Socrata), a restart or session timeout can make a
    // previously-valid session id stop working. Clear state and retry once.
    // Stateless servers (Data Commons) never hit this branch — their session
    // id is always null, and no server-side state means no invalidation.
    if (error instanceof Error && (error.message.includes('session') || error.message.includes('400'))) {
      console.log(`[MCP:${server.sourceId}] Session rejected, reinitializing...`);
      resetServerState(server);
      await ensureInitialized(server);
      return await makeToolCall(server, name, args);
    }
    throw error;
  }
}

async function makeToolCall(
  server: McpServerConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  console.log(`[MCP:${server.sourceId}] Calling tool:`, name, 'with args:', JSON.stringify(args));

  const state = getServerState(server);
  const headers = buildMcpRequestHeaders(server, state.sessionId);

  const { signal, clear } = createTimeoutSignal(MCP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(server.endpointUrl, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
  } catch (error) {
    clear();
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`MCP tool call "${name}" timed out after ${MCP_TIMEOUT_MS / 1000}s — the data source may be slow or unresponsive. Try a simpler query.`);
    }
    throw error;
  } finally {
    clear();
  }

  if (!response.ok) {
    console.error(`[MCP:${server.sourceId}] Server error:`, response.status, response.statusText);
    throw new Error(`MCP server "${server.sourceId}" error: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  console.log(`[MCP:${server.sourceId}] Raw response:`, text.substring(0, 500));

  // Parse SSE response format: "event: message\ndata: {...}\n\n"
  const lines = text.split('\n');
  let jsonData = '';

  for (const line of lines) {
    if (line.startsWith('data:')) {
      jsonData = line.slice(5).trim();
      break;
    }
  }

  if (!jsonData) {
    // Try parsing the whole response as JSON (in case it's not SSE format)
    try {
      const parsed = JSON.parse(text);
      if (parsed.result) {
        return formatMcpResult(parsed.result);
      }
      if (parsed.error) {
        throw new Error(parsed.error.message || 'MCP tool error');
      }
      throw new Error('Unexpected MCP response format');
    } catch (e) {
      if (e instanceof Error && e.message !== 'Unexpected MCP response format') {
        throw e;
      }
      throw new Error('Failed to parse MCP response');
    }
  }

  try {
    const parsed = JSON.parse(jsonData);
    if (parsed.result) {
      return formatMcpResult(parsed.result);
    }
    if (parsed.error) {
      throw new Error(parsed.error.message || 'MCP tool error');
    }
    return JSON.stringify(parsed);
  } catch (e) {
    if (e instanceof Error && !e.message.includes('parse')) {
      throw e;
    }
    throw new Error('Failed to parse MCP response JSON');
  }
}

interface McpPromptResult {
  messages?: Array<{
    role: string;
    content: { type: string; text?: string } | Array<{ type: string; text?: string }>;
  }>;
}

/**
 * Prompt fetches are still Socrata-only today: skill guidance is served from
 * the Socrata MCP server's `prompts/get` endpoint. Route explicitly so the
 * intent is obvious when a second prompt source shows up later.
 */
export async function callMcpPrompt(name: string, args: Record<string, string>): Promise<string> {
  const server = registry.servers['socrata'];
  if (!server) {
    throw new Error('Socrata MCP server is not configured; cannot fetch prompt');
  }
  await ensureInitialized(server);

  try {
    return await makePromptCall(server, name, args);
  } catch (error) {
    if (error instanceof Error && (error.message.includes('session') || error.message.includes('400'))) {
      console.log(`[MCP:${server.sourceId}] Session rejected, reinitializing...`);
      resetServerState(server);
      await ensureInitialized(server);
      return await makePromptCall(server, name, args);
    }
    throw error;
  }
}

async function makePromptCall(
  server: McpServerConfig,
  name: string,
  args: Record<string, string>,
): Promise<string> {
  console.log(`[MCP:${server.sourceId}] Getting prompt:`, name, 'with args:', JSON.stringify(args));

  const state = getServerState(server);
  const headers = buildMcpRequestHeaders(server, state.sessionId);

  const response = await fetch(server.endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'prompts/get',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(10_000), // 10s timeout for cold starts
  });

  if (!response.ok) {
    throw new Error(`MCP prompt error: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  console.log(`[MCP:${server.sourceId}] Prompt raw response:`, text.substring(0, 500));

  // Parse SSE response format
  const lines = text.split('\n');
  let jsonData = '';

  for (const line of lines) {
    if (line.startsWith('data:')) {
      jsonData = line.slice(5).trim();
      break;
    }
  }

  if (!jsonData) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.result) {
        return formatPromptResult(parsed.result);
      }
      if (parsed.error) {
        throw new Error(parsed.error.message || 'MCP prompt error');
      }
    } catch (e) {
      if (e instanceof Error && !e.message.includes('parse') && !e.message.includes('Unexpected')) {
        throw e;
      }
    }
    throw new Error('Failed to parse MCP prompt response');
  }

  const parsed = JSON.parse(jsonData);
  if (parsed.result) {
    return formatPromptResult(parsed.result);
  }
  if (parsed.error) {
    throw new Error(parsed.error.message || 'MCP prompt error');
  }
  throw new Error('Unexpected MCP prompt response format');
}

function formatPromptResult(result: McpPromptResult): string {
  if (!result.messages || !Array.isArray(result.messages)) {
    throw new Error('MCP prompt returned no messages');
  }

  return result.messages
    .map(msg => {
      const content = msg.content;
      if (Array.isArray(content)) {
        return content
          .filter(item => item.type === 'text' && item.text)
          .map(item => item.text)
          .join('\n');
      }
      if (typeof content === 'object' && content.type === 'text' && content.text) {
        return content.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function formatMcpResult(result: McpToolResult): string {
  console.log('[MCP] Formatting result:', JSON.stringify(result).substring(0, 500));
  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content
      .filter(item => item.type === 'text' && item.text)
      .map(item => item.text)
      .join('\n');
    const formatted = textContent || JSON.stringify(result);
    console.log('[MCP] Formatted output:', formatted.substring(0, 300));
    return formatted;
  }
  return JSON.stringify(result);
}
