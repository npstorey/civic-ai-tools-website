const MCP_URL = process.env.OPENGOV_MCP_URL || 'https://opengov-mcp-server.onrender.com';

interface McpToolResult {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  error?: string;
}

// Session management
let sessionId: string | null = null;

async function initializeSession(): Promise<string> {
  const response = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
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
    // If session expired, try reinitializing
    if (error instanceof Error && error.message.includes('session')) {
      sessionId = await initializeSession();
      return await makeToolCall(name, args);
    }
    throw error;
  }
}

async function makeToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  console.log('[MCP] Calling tool:', name, 'with args:', JSON.stringify(args));

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
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

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
