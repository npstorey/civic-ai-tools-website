'use client';

import { useState, useCallback, useRef } from 'react';
// Relative, extension-carrying imports (the convention of src/lib since #345)
// rather than the `@/` alias: the test runner has no path mapping, and the
// label functions this module exports are under test (#384).
import { createTraceCapture } from '../lib/bpmn/capture-trace.ts';
import { connectSSE } from '../lib/sse-client.ts';
import { isComparisonRunComplete } from '../lib/query-presentation.ts';
import { friendlyStreamError, type ProgressPhase, type CompleteEvent } from '../lib/streaming.ts';
import { deriveOperationType } from '../lib/mcp/operation-types.ts';
// Type-only: erased at compile time, so nothing from the notebook author rides
// into this hook's bundle. The kind vocabulary is declared once, beside the
// table that turns it into reader-facing copy.
import type { ToolFailureKind } from '../lib/notebook-author/tool-to-cell.ts';

export interface ToolCall {
  /**
   * Absent — never a stand-in — when the record the call was built from did
   * not carry a tool name (#384: a trace event from before the wire carried
   * one). The loop always records a name, so a live call has one; the readers
   * that can meet a replayed call say "unnamed" in words.
   */
  name?: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  duration_ms?: number;
  operationType?: string;
  reason?: string;
  /**
   * True when the loop recorded the call as rejected. Two readers, one field.
   *
   * F5 (#384 P3): read off the `complete` event unchanged and posted to the
   * publish route unchanged, so the signed package can say the call failed.
   *
   * F3 (#384 P4): the skeleton notebook generator STATES a rejection instead of
   * writing a live fetch cell for a request that returned nothing —
   * `notebook.ts`'s `planQueryStep` reads it, and the executed-notebook path has
   * read the same signal since #321.
   *
   * Absent is absent: it means the call was not recorded as failed, never that
   * it succeeded. Since P3 the chat-flow path does carry it (`streaming.ts`'s
   * `CompleteEvent.tools_called[]`), so a rejection now reaches both readers;
   * a record built from a source that never carried the field still tells them
   * nothing, and neither invents an answer for it.
   */
  failed?: boolean;
  /** Why it failed, when `failed` is true. Absent is read as `unknown`. */
  failureKind?: ToolFailureKind;
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
  /** As on the progress event (see `ProgressEvent`, #384). */
  toolName?: string;
  operationType?: string;
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
  /**
   * Whether the current run executes only the with-data arm (s6 P2, #229).
   * Latched per run at start: completion logic must not wait for a
   * without-data panel that will never stream, and the surface renders the
   * demoted (answer-first) treatment for exactly the runs that skipped the
   * comparison. Always false on mounts that never pass the option — the
   * apex default, unchanged.
   */
  mcpOnly: boolean;
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
  mcpOnly: false,
};

export function useStreamingComparison() {
  const [state, setState] = useState<StreamingState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const traceCaptureRef = useRef<ReturnType<typeof createTraceCapture> | null>(null);

  const startComparison = useCallback(async (
    query: string,
    model: string,
    portal: string,
    opts?: { mcpOnly?: boolean },
  ) => {
    const mcpOnly = opts?.mcpOnly ?? false;

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
      mcpOnly,
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
        // The flag is only serialized when set, so a default (two-arm) run's
        // request body is byte-identical to what the apex has always sent.
        body: { query, model, portal, ...(mcpOnly ? { mcpOnly: true } : {}) },
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
                toolName: eventData.toolName as string | undefined,
                operationType: eventData.operationType as string | undefined,
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
          // Check whether every panel this run actually has is complete —
          // a demoted (mcpOnly) run must not wait for the without-data
          // panel, which never streams.
          setState(prev => ({
            ...prev,
            isLoading: !isComparisonRunComplete(
              prev.mcpOnly,
              prev.withoutMcp.isComplete,
              prev.withMcp.isComplete,
            ),
          }));
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      // friendlyStreamError maps every shape (SSEError 429, MCP timeout/down,
      // connection drop, generic) to calm copy — no raw error text reaches the UI.
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: friendlyStreamError(error),
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

import { generateQueryIntentLabel, getDatasetName as getDatasetNameFromStreaming, searchSubject } from '../lib/streaming.ts';

// Known dataset names for rich labels
const DATASET_NAMES: Record<string, string> = {
  'erm2-nwe9': '311 Service Requests',
  '43nn-pn8j': 'Restaurant Inspections',
  'wvxf-dwi5': 'Housing Violations',
  'v6vf-nfxy': '311 Service Requests',
  'vw6y-z8j6': '311 Cases',
};

/**
 * The operation type an entry carries: the one the loop recorded, else the
 * loop's own derivation from the recorded name (`deriveOperationType` — the
 * single derivation, never a second one, and never from the message text);
 * nothing for an entry that carries neither (#384).
 */
function entryOperationType(entry: ProgressLogEntry): string | undefined {
  if (entry.operationType) return entry.operationType;
  if (entry.toolName) return deriveOperationType(entry.toolName, entry.args ?? {});
  return undefined;
}

// Generate a rich label from what the entries recorded — the tool name and
// operation type first, then the arguments — when available
function generateRichLabel(entries: ProgressLogEntry[], previousEntries?: ProgressLogEntry[]): string | null {
  const toolStarts = entries.filter(e => e.phase === 'tool_start' && e.args);
  if (toolStarts.length === 0) return null;

  const first = toolStarts[0];
  const firstArgs = first.args!;
  const opType = entryOperationType(first);
  const datasetId = firstArgs.dataset_id as string | undefined;
  const datasetName = datasetId ? (DATASET_NAMES[datasetId] || getDatasetNameFromStreaming(datasetId)) : null;

  if (opType === 'catalog') {
    const query = firstArgs.query as string | undefined;
    return query ? `Searching for datasets about "${query}"` : 'Searching the data catalog';
  }

  if (opType === 'search') {
    const query = firstArgs.query as string | undefined;
    const subject = searchSubject(first.toolName).plural;
    return query ? `Searching for ${subject} about "${query}"` : `Searching for ${subject}`;
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

  // `fetch` derives to no operation type by design (mcp/operation-types.ts);
  // the label names what was asked for and asserts nothing about the answer.
  if (first.toolName === 'fetch') {
    const id = firstArgs.id as string | undefined;
    return id ? `Looking up ${id}` : 'Looking up one item';
  }

  return null;
}

// Generate a human-readable label for a group of tool calls within an iteration
export function generateGroupLabel(entries: ProgressLogEntry[], previousEntries?: ProgressLogEntry[]): string {
  const richLabel = generateRichLabel(entries, previousEntries);
  if (richLabel) return richLabel;

  const toolStarts = entries.filter(e => e.phase === 'tool_start');
  if (toolStarts.length === 0) return 'Processing';

  // An entry that names its tool but has no rich label above is a call whose
  // operation these labels do not describe. Its label repeats what the record
  // says; the keyword matching below is for entries that recorded nothing —
  // it must never overrule a name (#384).
  // (`get_data`'s name in user language is "gather data", as in `generateToolReason`.)
  const named = toolStarts.find(e => e.toolName || e.operationType);
  if (named) return named.toolName && named.toolName !== 'get_data' ? `Calling ${named.toolName}` : 'Gathering data';

  // Fallback for entries that carry neither a tool name nor an operation type:
  // extract operation types from messages
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

  // Nothing recorded says what these calls were, so the label claims nothing:
  // the same provisional label the group carried while it was open. This
  // branch used to announce a query — a positively wrong label for any group
  // that was not one (#377).
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
        const args = event.args as Record<string, unknown> | undefined;
        const toolName = event.toolName as string | undefined;
        const operationType = event.operationType as string | undefined;
        const newLog = [...prev[panel].progressLog];
        const newGroups = prev[panel].progressGroups.map(g => ({ ...g, entries: [...g.entries] }));
        const entry: ProgressLogEntry = { message, timestamp: Date.now(), duration_ms, phase, iteration, args, toolName, operationType };

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
      // #374: cast to the wire type itself rather than a hand-typed copy of
      // it — a private duplicate is what let this site's `tokens_used`
      // disagree (as a required `number`) with the source of truth in
      // src/lib/streaming.ts.
      const data = event.data as CompleteEvent['data'];
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
        // Check if every panel this run has is complete (one for a demoted
        // mcpOnly run, both otherwise)
        const runComplete = isComparisonRunComplete(
          newState.mcpOnly,
          newState.withoutMcp.isComplete,
          newState.withMcp.isComplete,
        );
        return {
          ...newState,
          isLoading: !runComplete,
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
      setState(prev => {
        // Stop the spinners: without this, a panel that errors before any
        // content arrives keeps its in-flight progress entries animating
        // forever — the silent-hang symptom of #178.
        const newLog = prev[panel].progressLog.map(entry => ({ ...entry, isComplete: true }));
        const newGroups = prev[panel].progressGroups.map(g => ({
          ...g,
          isComplete: true,
          entries: g.entries.map(e => ({ ...e, isComplete: true })),
        }));
        return {
          ...prev,
          [panel]: {
            ...prev[panel],
            // Pass the whole event: a typed `code` (e.g. model_not_configured)
            // selects operator-actionable copy; otherwise the message text is
            // classified as before.
            error: friendlyStreamError(event),
            isComplete: true,
            progress: null,
            progressLog: newLog,
            progressGroups: newGroups,
          },
        };
      });
      break;
  }
}
