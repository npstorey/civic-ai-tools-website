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
  onComplete?: () => void;
  signal?: AbortSignal;
}

/**
 * Opens an SSE connection via POST, parses events, and dispatches them.
 *
 * Error contract: this function communicates ALL fatal failures by REJECTING
 * the returned promise — an `SSEError` (carrying the HTTP status) on a non-ok
 * response, or the underlying error on a missing body / mid-stream network
 * drop. Promise rejection is the single error channel; every caller handles it
 * with try/catch or `.catch()` and maps it to user copy via
 * `friendlyStreamError` (see lib/streaming.ts). There is deliberately no
 * `onError` callback — see the removal rationale below.
 *
 * Per-event JSON parse errors are intentionally swallowed (logged, not thrown):
 * one malformed event must not tear down an otherwise-healthy stream.
 *
 * `onComplete` runs in a `finally` when the read loop exits, on both the
 * success path and a mid-stream drop (in the latter case the promise also
 * rejects afterward; callers' rejection handler is authoritative).
 *
 * Removed: a previously-declared `onError?` option that was destructured but
 * never invoked, and which no caller ever passed. It was a dead second error
 * channel — keeping it invited a future caller to wire it up and silently get
 * no callbacks. Errors flow through promise rejection only.
 */
export async function connectSSE(options: SSEClientOptions): Promise<void> {
  const { url, body, onEvent, onComplete, signal } = options;

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
