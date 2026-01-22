'use client';

import { useState, useCallback, useRef } from 'react';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface PanelState {
  content: string;
  progress: string | null;
  isComplete: boolean;
  duration_ms?: number;
  tokens_used?: number;
  tools_called?: ToolCall[];
  error?: string;
}

interface StreamingState {
  withoutMcp: PanelState;
  withMcp: PanelState;
  isLoading: boolean;
  error: string | null;
}

const initialPanelState: PanelState = {
  content: '',
  progress: null,
  isComplete: false,
};

const initialState: StreamingState = {
  withoutMcp: { ...initialPanelState },
  withMcp: { ...initialPanelState },
  isLoading: false,
  error: null,
};

export function useStreamingComparison() {
  const [state, setState] = useState<StreamingState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startComparison = useCallback(async (query: string, model: string, portal: string) => {
    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    // Reset state
    setState({
      withoutMcp: { ...initialPanelState },
      withMcp: { ...initialPanelState },
      isLoading: true,
      error: null,
    });

    try {
      const response = await fetch('/api/compare-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, model, portal }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const data = await response.json();
        if (response.status === 429) {
          setState(prev => ({
            ...prev,
            isLoading: false,
            error: 'Rate limit exceeded. Please try again tomorrow or sign in for more requests.',
          }));
        } else {
          setState(prev => ({
            ...prev,
            isLoading: false,
            error: data.error || 'An error occurred',
          }));
        }
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // Keep incomplete event in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6));
              handleEvent(eventData, setState);
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }
          }
        }
      }

      // Check if both panels are complete
      setState(prev => ({
        ...prev,
        isLoading: !(prev.withoutMcp.isComplete && prev.withMcp.isComplete),
      }));

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was aborted, ignore
        return;
      }
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: 'Failed to connect to the server. Please try again.',
      }));
    }
  }, []);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setState(prev => ({ ...prev, isLoading: false }));
  }, []);

  return {
    ...state,
    startComparison,
    abort,
  };
}

function handleEvent(
  event: { type: string; panel: 'withMcp' | 'withoutMcp'; [key: string]: unknown },
  setState: React.Dispatch<React.SetStateAction<StreamingState>>
) {
  const { type, panel } = event;

  switch (type) {
    case 'progress':
      setState(prev => ({
        ...prev,
        [panel]: {
          ...prev[panel],
          progress: event.message as string,
        },
      }));
      break;

    case 'token':
      setState(prev => ({
        ...prev,
        [panel]: {
          ...prev[panel],
          content: prev[panel].content + (event.content as string),
          progress: null, // Clear progress when tokens start
        },
      }));
      break;

    case 'complete':
      const data = event.data as {
        content: string;
        duration_ms: number;
        tokens_used: number;
        tools_called?: ToolCall[];
      };
      setState(prev => {
        const newState = {
          ...prev,
          [panel]: {
            ...prev[panel],
            content: data.content,
            duration_ms: data.duration_ms,
            tokens_used: data.tokens_used,
            tools_called: data.tools_called,
            isComplete: true,
            progress: null,
          },
        };
        // Check if both are complete
        const bothComplete = newState.withoutMcp.isComplete && newState.withMcp.isComplete;
        return {
          ...newState,
          isLoading: !bothComplete,
        };
      });
      break;

    case 'error':
      setState(prev => ({
        ...prev,
        [panel]: {
          ...prev[panel],
          error: event.message as string,
          isComplete: true,
          progress: null,
        },
      }));
      break;
  }
}
