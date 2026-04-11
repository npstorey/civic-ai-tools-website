'use client';

import { useState, useCallback, useRef } from 'react';
import { createTraceCapture } from '@/lib/bpmn/capture-trace';
import { connectSSE, SSEError } from '@/lib/sse-client';
import type { ProgressPhase } from '@/lib/streaming';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  duration_ms?: number;
  operationType?: string;
  reason?: string;
}

export interface EnrichedGroup {
  group: ProgressGroup;
  toolCalls: ToolCall[];
}

export interface ProgressLogEntry {
  message: string;
  timestamp: number;
  isComplete?: boolean;
  duration_ms?: number;
  phase?: string;
  iteration?: number;
  args?: Record<string, unknown>;
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
  prompt_tokens?: number;
  completion_tokens?: number;
  token_limit_exceeded?: boolean;
  tools_called?: ToolCall[];
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EvidenceTrace = Record<string, any>;

interface StreamingState {
  withoutMcp: PanelState;
  withMcp: PanelState;
  isLoading: boolean;
  error: string | null;
  evidenceTrace: EvidenceTrace | null;
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
  evidenceTrace: null,
};

export function useStreamingComparison() {
  const [state, setState] = useState<StreamingState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const traceCaptureRef = useRef<ReturnType<typeof createTraceCapture> | null>(null);

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
      evidenceTrace: null,
    });

    // Initialize trace capture if enabled
    if (process.env.NEXT_PUBLIC_CAPTURE_TRACES === 'true') {
      traceCaptureRef.current = createTraceCapture(query, model, portal);
    } else {
      traceCaptureRef.current = null;
    }

    try {
      await connectSSE({
        url: '/api/compare-stream',
        body: { query, model, portal },
        signal: abortControllerRef.current.signal,
        onEvent: (eventData) => {
          // Record MCP-panel events for trace capture
          if (traceCaptureRef.current && eventData.panel === 'withMcp') {
            if (eventData.type === 'progress') {
              traceCaptureRef.current.recordEvent({
                phase: eventData.phase as ProgressPhase,
                message: eventData.message as string,
                iteration: eventData.iteration as number | undefined,
                args: eventData.args as Record<string, unknown> | undefined,
                duration_ms: eventData.duration_ms as number | undefined,
              });
            } else if (eventData.type === 'complete') {
              const trace = traceCaptureRef.current.exportTrace();
              console.log('[Trace Capture] MCP panel trace captured. Copy the JSON below into src/lib/bpmn/traces.ts:');
              console.log(JSON.stringify(trace, null, 2));
              traceCaptureRef.current = null;
            }
          }

          handleEvent(eventData as { type: string; panel: 'withMcp' | 'withoutMcp'; [key: string]: unknown }, setState);
        },
        onComplete: () => {
          // Check if both panels are complete
          setState(prev => ({
            ...prev,
            isLoading: !(prev.withoutMcp.isComplete && prev.withMcp.isComplete),
          }));
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      if (error instanceof SSEError) {
        if (error.status === 429) {
          setState(prev => ({
            ...prev,
            isLoading: false,
            error: 'Rate limit exceeded. Please try again tomorrow or sign in for more requests.',
          }));
        } else {
          setState(prev => ({
            ...prev,
            isLoading: false,
            error: error.message || 'An error occurred',
          }));
        }
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

  const restoreState = useCallback((saved: StreamingState) => {
    setState(saved);
  }, []);

  return {
    ...state,
    startComparison,
    abort,
    restoreState,
  };
}

// Map progress groups to their corresponding tool calls from the complete event
export function mapGroupsToToolCalls(groups: ProgressGroup[], toolsCalled: ToolCall[]): EnrichedGroup[] {
  const result: EnrichedGroup[] = [];
  let toolIndex = 0;

  for (const group of groups) {
    // Count tool_start entries in this group to know how many tool calls it contains
    const toolStartCount = group.entries.filter(e => e.phase === 'tool_start').length;
    const groupToolCalls = toolsCalled.slice(toolIndex, toolIndex + toolStartCount);
    toolIndex += toolStartCount;
    result.push({ group, toolCalls: groupToolCalls });
  }

  return result;
}

import { generateQueryIntentLabel, getDatasetName as getDatasetNameFromStreaming } from '@/lib/streaming';

// Known dataset names for rich labels
const DATASET_NAMES: Record<string, string> = {
  'erm2-nwe9': '311 Service Requests',
  '43nn-pn8j': 'Restaurant Inspections',
  'wvxf-dwi5': 'Housing Violations',
  'v6vf-nfxy': '311 Service Requests',
  'vw6y-z8j6': '311 Cases',
};

// Generate a rich label from structured args when available
function generateRichLabel(entries: ProgressLogEntry[], previousEntries?: ProgressLogEntry[]): string | null {
  const toolStarts = entries.filter(e => e.phase === 'tool_start' && e.args);
  if (toolStarts.length === 0) return null;

  const firstArgs = toolStarts[0].args!;
  const opType = firstArgs.type as string | undefined;
  const datasetId = firstArgs.dataset_id as string | undefined;
  const datasetName = datasetId ? (DATASET_NAMES[datasetId] || getDatasetNameFromStreaming(datasetId)) : null;

  if (opType === 'catalog') {
    const query = firstArgs.query as string | undefined;
    return query ? `Searching for datasets about "${query}"` : 'Searching the data catalog';
  }

  if (opType === 'metadata' && datasetName) {
    return `Understanding ${datasetName} structure`;
  }

  if (opType === 'query') {
    if (toolStarts.length > 1) {
      return 'Querying multiple datasets';
    }
    // Use intent label system with previous context
    const previousCalls = (previousEntries || [])
      .filter(e => e.phase === 'tool_start' && e.args)
      .map(e => ({ args: e.args! }));
    return generateQueryIntentLabel(firstArgs, previousCalls).label;
  }

  if (opType === 'metrics' && datasetName) {
    return `Checking ${datasetName} statistics`;
  }

  return null;
}

// Generate a human-readable label for a group of tool calls within an iteration
export function generateGroupLabel(entries: ProgressLogEntry[], previousEntries?: ProgressLogEntry[]): string {
  const richLabel = generateRichLabel(entries, previousEntries);
  if (richLabel) return richLabel;

  const toolStarts = entries.filter(e => e.phase === 'tool_start');
  if (toolStarts.length === 0) return 'Processing';

  // Fallback: extract operation types from messages
  const messages = toolStarts.map(e => e.message.toLowerCase());
  const hasCatalog = messages.some(m => m.includes('searching') && m.includes('catalog'));
  const hasMetadata = messages.some(m => m.includes('metadata'));
  const hasQuery = messages.some(m => m.includes('querying') || m.includes('counting') || m.includes('previewing') || m.includes('refining') || m.includes('top'));
  const hasMetrics = messages.some(m => m.includes('metrics'));

  if (hasCatalog && !hasQuery && !hasMetadata) return 'Finding relevant datasets';
  if (hasMetadata && !hasQuery && !hasCatalog) return 'Understanding dataset structure';
  if (hasQuery && toolStarts.length > 1) return 'Querying multiple datasets';
  if (hasQuery) return 'Querying data';
  if (hasMetrics) return 'Checking dataset statistics';

  return 'Running query';
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
        const args = event.args as Record<string, unknown> | undefined;
        const newLog = [...prev[panel].progressLog];
        const newGroups = prev[panel].progressGroups.map(g => ({ ...g, entries: [...g.entries] }));
        const entry: ProgressLogEntry = { message, timestamp: Date.now(), duration_ms, phase, iteration, args };

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
            const prevEntries = newGroups
              .filter(g => g.iteration < iteration!)
              .flatMap(g => g.entries);
            group.label = generateGroupLabel(group.entries, prevEntries);
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
        const allGroups = prev[panel].progressGroups;
        const newGroups = allGroups.map((g, gIdx) => {
          if (!g.isComplete) {
            const entries = g.entries.map(e => ({ ...e, isComplete: true }));
            const durations = entries
              .filter(e => e.phase === 'tool_start' && e.duration_ms !== undefined)
              .map(e => e.duration_ms!);
            const prevEntries = allGroups.slice(0, gIdx).flatMap(pg => pg.entries);
            return {
              ...g,
              entries,
              isComplete: true,
              label: generateGroupLabel(entries, prevEntries),
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
        prompt_tokens?: number;
        completion_tokens?: number;
        token_limit_exceeded?: boolean;
        tools_called?: ToolCall[];
      };
      setState(prev => {
        // Mark all log entries as complete
        const newLog = prev[panel].progressLog.map(entry => ({ ...entry, isComplete: true }));

        // Mark all groups as complete
        const completeAllGroups = prev[panel].progressGroups;
        const newGroups = completeAllGroups.map((g, gIdx) => {
          const entries = g.entries.map(e => ({ ...e, isComplete: true }));
          const durations = entries
            .filter(e => e.phase === 'tool_start' && e.duration_ms !== undefined)
            .map(e => e.duration_ms!);
          const prevEntries = completeAllGroups.slice(0, gIdx).flatMap(pg => pg.entries);
          return {
            ...g,
            entries,
            isComplete: true,
            label: generateGroupLabel(entries, prevEntries),
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
            prompt_tokens: data.prompt_tokens,
            completion_tokens: data.completion_tokens,
            token_limit_exceeded: data.token_limit_exceeded,
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

    case 'trace':
      setState(prev => ({
        ...prev,
        evidenceTrace: event.data as EvidenceTrace,
      }));
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
