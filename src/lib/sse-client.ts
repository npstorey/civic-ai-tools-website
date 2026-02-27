/**
 * Shared SSE client for connecting to streaming API endpoints.
 * Used by both the home page comparison and the about page live trace.
 */

export class SSEError extends Error {
  status: number;
  data?: Record<string, unknown>;

  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.name = 'SSEError';
    this.status = status;
    this.data = data;
  }
}

export interface SSEClientOptions {
  url: string;
  body: Record<string, unknown>;
  onEvent: (event: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  signal?: AbortSignal;
}

/**
 * Opens an SSE connection via POST, parses events, and dispatches them.
 * Resolves when the stream ends; rejects on HTTP error or network failure.
 */
export async function connectSSE(options: SSEClientOptions): Promise<void> {
  const { url, body, onEvent, onError, onComplete, signal } = options;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let data: Record<string, unknown> | undefined;
    try {
      data = await response.json();
    } catch {
      // body not JSON
    }
    const message = (data?.error as string) || `HTTP ${response.status}`;
    throw new SSEError(message, response.status, data);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (double-newline delimited)
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const eventData = JSON.parse(line.slice(6));
            onEvent(eventData);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }
    }
  } finally {
    onComplete?.();
  }
}
