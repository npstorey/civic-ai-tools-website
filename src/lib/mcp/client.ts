import {
  buildMcpRegistry,
  readMcpEnvFromProcess,
  resolveServerForTool,
  type McpRegistry,
  type McpServerConfig,
} from './registry';

const MCP_TIMEOUT_MS = 45_000; // 45-second timeout for MCP server requests

// M9.1: multi-MCP routing.
//
// The website now talks to more than one MCP server (Socrata + Google Data
// Commons). Each server maintains its own `mcp-session-id` independently, so
// session state is tracked per source rather than in a single module-level
// variable. Tool calls route to the correct server based on tool name via the
// registry in `./registry.ts`.
//
// Why: the research phase (M9.0) confirmed Data Commons ships a hosted HTTPS
// MCP endpoint that is drop-in compatible with our existing HTTP/SSE client
// pattern — so the per-server routing layer is the entire architectural
// change needed. The skill-guidance prompt fetch still lives on the Socrata
// server and continues to route through the `socrata` source explicitly.

const registry: McpRegistry = buildMcpRegistry(readMcpEnvFromProcess());

interface McpToolResult {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  error?: string;
}

function createTimeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

// Per-server session state. Keyed by the server's sourceId.
const sessionIds: Record<string, string | null> = {};

function getSession(server: McpServerConfig): string | null {
  return sessionIds[server.sourceId] ?? null;
}

function setSession(server: McpServerConfig, id: string | null): void {
  sessionIds[server.sourceId] = id;
}

async function initializeSession(server: McpServerConfig): Promise<string> {
  const { signal, clear } = createTimeoutSignal(MCP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(server.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        ...(server.headers || {}),
      },
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

  const newSessionId = response.headers.get('mcp-session-id');
  if (!newSessionId) {
    throw new Error(`No session ID returned from MCP server "${server.sourceId}"`);
  }

  return newSessionId;
}

async function ensureSession(server: McpServerConfig): Promise<string> {
  let id = getSession(server);
  if (!id) {
    id = await initializeSession(server);
    setSession(server, id);
  }
  return id;
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
  await ensureSession(server);

  try {
    return await makeToolCall(server, name, args);
  } catch (error) {
    // Session expired / server restart: clear and retry once.
    if (error instanceof Error && (error.message.includes('session') || error.message.includes('400'))) {
      console.log(`[MCP:${server.sourceId}] Session rejected, reinitializing...`);
      setSession(server, null);
      await ensureSession(server);
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

  const sessionId = getSession(server);
  if (!sessionId) {
    throw new Error(`MCP session missing for server "${server.sourceId}"`);
  }

  const { signal, clear } = createTimeoutSignal(MCP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(server.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        ...(server.headers || {}),
      },
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
  await ensureSession(server);

  try {
    return await makePromptCall(server, name, args);
  } catch (error) {
    if (error instanceof Error && (error.message.includes('session') || error.message.includes('400'))) {
      console.log(`[MCP:${server.sourceId}] Session rejected, reinitializing...`);
      setSession(server, null);
      await ensureSession(server);
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

  const sessionId = getSession(server);
  if (!sessionId) {
    throw new Error(`MCP session missing for server "${server.sourceId}"`);
  }

  const response = await fetch(server.endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
      ...(server.headers || {}),
    },
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
