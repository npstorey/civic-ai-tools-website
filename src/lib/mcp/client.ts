const MCP_URL = process.env.OPENGOV_MCP_URL || 'https://opengov-mcp-server.onrender.com';

interface McpToolResult {
  content?: Array<{
    type: string;
    text?: string;
  }>;
  error?: string;
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const response = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP server error: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();

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
      throw new Error('Unexpected MCP response format');
    } catch {
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
    if (e instanceof Error && e.message !== 'Failed to parse MCP response') {
      throw e;
    }
    throw new Error('Failed to parse MCP response JSON');
  }
}

function formatMcpResult(result: McpToolResult): string {
  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content
      .filter(item => item.type === 'text' && item.text)
      .map(item => item.text)
      .join('\n');
    return textContent || JSON.stringify(result);
  }
  return JSON.stringify(result);
}
