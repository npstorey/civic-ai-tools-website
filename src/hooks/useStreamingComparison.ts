'use client';

import { useState, useCallback, useRef } from 'react';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  duration_ms?: number;
  operationType?: string;
  reason?: string;
}

export interface ProgressLogEntry {
  message: string;
  timestamp: number;
  isComplete?: boolean;
  duration_ms?: number;
  phase?: string;
  iteration?: number;
}

export interface ProgressGroup {
  iteration: number;
  label: string;
  entries: ProgressLogEntry[];
  isComplete: boolean;
  totalDuration_ms?: number;
}

interface PanelState {
  content: string;
  progress: string | null;
  progressLog: ProgressLogEntry[];
  progressGroups: ProgressGroup[];
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
  progressLog: [],
  progressGroups: [],
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

// Generate a human-readable label for a group of tool calls within an iteration
function generateGroupLabel(entries: ProgressLogEntry[]): string {
  const toolStarts = entries.filter(e => e.phase === 'tool_start');
  if (toolStarts.length === 0) return 'Processing';

  // Extract operation types from messages
  const messages = toolStarts.map(e => e.message.toLowerCase());
  const hasCatalog = messages.some(m => m.includes('searching') && m.includes('catalog'));
  const hasMetadata = messages.some(m => m.includes('metadata'));
  const hasQuery = messages.some(m => m.includes('querying'));
  const hasMetrics = messages.some(m => m.includes('metrics'));

  if (hasCatalog && !hasQuery && !hasMetadata) return 'Finding relevant datasets';
  if (hasMetadata && !hasQuery && !hasCatalog) return 'Understanding dataset structure';
  if (hasQuery && toolStarts.length > 1) return 'Querying multiple datasets';
  if (hasQuery) return 'Querying data';
  if (hasMetrics) return 'Checking dataset statistics';

  return 'Gathering data';
}

function handleEvent(
  event: { type: string; panel: 'withMcp' | 'withoutMcp'; [key: string]: unknown },
  setState: React.Dispatch<React.SetStateAction<StreamingState>>
) {
  const { type, panel } = event;

  switch (type) {
    case 'progress':
      setState(prev => {
        const message = event.message as string;
        const duration_ms = event.duration_ms as number | undefined;
        const phase = event.phase as string | undefined;
        const iteration = event.iteration as number | undefined;
        const newLog = [...prev[panel].progressLog];
        const newGroups = prev[panel].progressGroups.map(g => ({ ...g, entries: [...g.entries] }));
        const entry: ProgressLogEntry = { message, timestamp: Date.now(), duration_ms, phase, iteration };

        if (phase === 'tool_complete' && iteration !== undefined) {
          // Update the matching tool_start entry in-place within its group
          const group = newGroups.find(g => g.iteration === iteration);
          if (group) {
            const startIdx = group.entries.findIndex(
              e => e.phase === 'tool_start' && e.message === message && !e.isComplete
            );
            if (startIdx !== -1) {
              group.entries[startIdx] = { ...group.entries[startIdx], isComplete: true, duration_ms };
            }
          }
          // Also update in flat log
          const flatIdx = newLog.findIndex(
            e => e.phase === 'tool_start' && e.message === message && !e.isComplete
          );
          if (flatIdx !== -1) {
            newLog[flatIdx] = { ...newLog[flatIdx], isComplete: true, duration_ms };
          }
          return {
            ...prev,
            [panel]: { ...prev[panel], progress: message, progressLog: newLog, progressGroups: newGroups },
          };
        }

        if (phase === 'tool_result' && iteration !== undefined) {
          // Append result narration to the group
          entry.isComplete = true;
          const group = newGroups.find(g => g.iteration === iteration);
          if (group) {
            group.entries.push(entry);
          }
          newLog.push(entry);
          return {
            ...prev,
            [panel]: { ...prev[panel], progress: message, progressLog: newLog, progressGroups: newGroups },
          };
        }

        if (phase === 'thinking' && iteration !== undefined) {
          // Mark the current group as complete
          const group = newGroups.find(g => g.iteration === iteration);
          if (group) {
            group.isComplete = true;
            // Compute total duration from completed tool entries
            const durations = group.entries
              .filter(e => e.phase === 'tool_start' && e.duration_ms !== undefined)
              .map(e => e.duration_ms!);
            if (durations.length > 0) {
              group.totalDuration_ms = durations.reduce((a, b) => a + b, 0);
            }
            group.label = generateGroupLabel(group.entries);
          }
          // Don't add thinking to flat log or as standalone — it just closes the group
          return {
            ...prev,
            [panel]: { ...prev[panel], progress: message, progressGroups: newGroups },
          };
        }

        if (phase === 'tool_start' && iteration !== undefined) {
          // Find or create group for this iteration
          let group = newGroups.find(g => g.iteration === iteration);
          if (!group) {
            group = { iteration, label: 'Gathering data', entries: [], isComplete: false };
            newGroups.push(group);
          }
          group.entries.push(entry);
          newLog.push(entry);
          return {
            ...prev,
            [panel]: { ...prev[panel], progress: message, progressLog: newLog, progressGroups: newGroups },
          };
        }

        // Standalone entries (analyze, synthesize, or no phase)
        // Mark previous entry as complete
        if (newLog.length > 0) {
          newLog[newLog.length - 1] = { ...newLog[newLog.length - 1], isComplete: true };
        }
        newLog.push(entry);

        return {
          ...prev,
          [panel]: { ...prev[panel], progress: message, progressLog: newLog, progressGroups: newGroups },
        };
      });
      break;

    case 'token':
      setState(prev => {
        // Mark any in-progress log entry as complete when tokens start
        const newLog = [...prev[panel].progressLog];
        if (newLog.length > 0 && !newLog[newLog.length - 1].isComplete) {
          newLog[newLog.length - 1] = { ...newLog[newLog.length - 1], isComplete: true };
        }

        // Mark all groups as complete
        const newGroups = prev[panel].progressGroups.map(g => {
          if (!g.isComplete) {
            const entries = g.entries.map(e => ({ ...e, isComplete: true }));
            const durations = entries
              .filter(e => e.phase === 'tool_start' && e.duration_ms !== undefined)
              .map(e => e.duration_ms!);
            return {
              ...g,
              entries,
              isComplete: true,
              label: generateGroupLabel(entries),
              totalDuration_ms: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : undefined,
            };
          }
          return g;
        });

        return {
          ...prev,
          [panel]: {
            ...prev[panel],
            content: prev[panel].content + (event.content as string),
            progress: null,
            progressLog: newLog,
            progressGroups: newGroups,
          },
        };
      });
      break;

    case 'complete':
      const data = event.data as {
        content: string;
        duration_ms: number;
        tokens_used: number;
        tools_called?: ToolCall[];
      };
      setState(prev => {
        // Mark all log entries as complete
        const newLog = prev[panel].progressLog.map(entry => ({ ...entry, isComplete: true }));

        // Mark all groups as complete
        const newGroups = prev[panel].progressGroups.map(g => {
          const entries = g.entries.map(e => ({ ...e, isComplete: true }));
          const durations = entries
            .filter(e => e.phase === 'tool_start' && e.duration_ms !== undefined)
            .map(e => e.duration_ms!);
          return {
            ...g,
            entries,
            isComplete: true,
            label: generateGroupLabel(entries),
            totalDuration_ms: g.totalDuration_ms ?? (durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : undefined),
          };
        });

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
            progressLog: newLog,
            progressGroups: newGroups,
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
