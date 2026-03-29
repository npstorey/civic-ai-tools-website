const MCP_URL = process.env.SOCRATA_MCP_URL || 'https://socrata-mcp.civicaitools.org';
const MCP_TIMEOUT_MS = 45_000; // 45-second timeout for MCP server requests

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

// Session management
let sessionId: string | null = null;

async function initializeSession(): Promise<string> {
  const { signal, clear } = createTimeoutSignal(MCP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${MCP_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
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
      throw new Error(`MCP server did not respond within ${MCP_TIMEOUT_MS / 1000}s — the upstream server may be starting up or unresponsive. Please try again.`);
    }
    throw error;
  } finally {
    clear();
  }

  if (!response.ok) {
    throw new Error(`MCP initialization failed: ${response.status}`);
  }

  // Get session ID from header
  const newSessionId = response.headers.get('mcp-session-id');
  if (!newSessionId) {
    throw new Error('No session ID returned from MCP server');
  }

  return newSessionId;
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  // Ensure we have a session
  if (!sessionId) {
    sessionId = await initializeSession();
  }

  try {
    return await makeToolCall(name, args);
  } catch (error) {
    // If session expired or rejected (400 = invalid session on server restart), reinitialize
    if (error instanceof Error && (error.message.includes('session') || error.message.includes('400'))) {
      console.log('[MCP] Session rejected, reinitializing...');
      sessionId = null;
      sessionId = await initializeSession();
      return await makeToolCall(name, args);
    }
    throw error;
  }
}

async function makeToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  console.log('[MCP] Calling tool:', name, 'with args:', JSON.stringify(args));

  const { signal, clear } = createTimeoutSignal(MCP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${MCP_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId!,
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
    console.error('[MCP] Server error:', response.status, response.statusText);
    throw new Error(`MCP server error: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  console.log('[MCP] Raw response:', text.substring(0, 500));

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

export async function callMcpPrompt(name: string, args: Record<string, string>): Promise<string> {
  // Ensure we have a session
  if (!sessionId) {
    sessionId = await initializeSession();
  }

  try {
    return await makePromptCall(name, args);
  } catch (error) {
    // If session expired or rejected (400 = invalid session on server restart), reinitialize
    if (error instanceof Error && (error.message.includes('session') || error.message.includes('400'))) {
      console.log('[MCP] Session rejected, reinitializing...');
      sessionId = null;
      sessionId = await initializeSession();
      return await makePromptCall(name, args);
    }
    throw error;
  }
}

async function makePromptCall(name: string, args: Record<string, string>): Promise<string> {
  console.log('[MCP] Getting prompt:', name, 'with args:', JSON.stringify(args));

  const response = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId!,
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
  console.log('[MCP] Prompt raw response:', text.substring(0, 500));

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
