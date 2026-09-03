/**
 * Pure utility to convert pre-recorded TraceEvent[] into ProgressGroup[],
 * ProgressLogEntry[], and ToolCall[] — the same data structures that
 * useLiveTrace builds incrementally from SSE events.
 *
 * This lets example trace replays render the same side-panel step cards
 * as live queries without duplicating the grouping logic in a hook.
 */

import type { TraceEvent } from './traces';
import type { ProgressLogEntry, ProgressGroup, ToolCall } from '@/hooks/useStreamingComparison';
// Value imports are relative and extension-carrying so the test runner, which
// has no `@/` mapping, can drive this module (#384). The type-only import
// above is erased and may keep the alias.
import { generateGroupLabel } from '../../hooks/useStreamingComparison.ts';
import { deriveOperationType } from '../mcp/operation-types.ts';

export interface TraceProgressData {
  progressLog: ProgressLogEntry[];
  progressGroups: ProgressGroup[];
  toolsCalled: ToolCall[];
}

const EMPTY: TraceProgressData = {
  progressLog: [],
  progressGroups: [],
  toolsCalled: [],
};

/**
 * Derive progress data from a slice of trace events (events[0..upToIndex]).
 * When isComplete is true, all groups and entries are finalized.
 */
export function traceEventsToProgressData(
  events: TraceEvent[],
  upToIndex: number,
  isComplete?: boolean,
): TraceProgressData {
  if (events.length === 0 || upToIndex < 0) return EMPTY;

  const progressLog: ProgressLogEntry[] = [];
  const progressGroups: ProgressGroup[] = [];
  const toolsCalled: ToolCall[] = [];

  const lastIndex = Math.min(upToIndex, events.length - 1);

  for (let i = 0; i <= lastIndex; i++) {
    const event = events[i];
    const entry: ProgressLogEntry = {
      message: event.message,
      timestamp: event.relativeMs,
      duration_ms: event.duration_ms,
      phase: event.phase,
      iteration: event.iteration,
      args: event.args,
      toolName: event.toolName,
      operationType: event.operationType,
      // The rejection the event carried, if any (#384 P8, F2); absent stays absent.
      ...(event.failed !== undefined ? { failed: event.failed } : {}),
      ...(event.failureKind !== undefined ? { failureKind: event.failureKind } : {}),
    };

    const { phase, iteration } = event;

    if (phase === 'tool_complete' && iteration !== undefined) {
      // The end event's outcome travels onto the start entry it pairs to —
      // the same pairing the live hooks use — so the call built from that
      // entry below can say it was rejected.
      const outcome = {
        isComplete: true,
        duration_ms: event.duration_ms,
        ...(event.failed !== undefined ? { failed: event.failed } : {}),
        ...(event.failureKind !== undefined ? { failureKind: event.failureKind } : {}),
      };
      // Update matching tool_start entry within its group
      const group = progressGroups.find(g => g.iteration === iteration);
      if (group) {
        const startIdx = group.entries.findIndex(
          e => e.phase === 'tool_start' && e.message === event.message && !e.isComplete
        );
        if (startIdx !== -1) {
          group.entries[startIdx] = { ...group.entries[startIdx], ...outcome };
        }
      }
      // Also update in flat log
      const flatIdx = progressLog.findIndex(
        e => e.phase === 'tool_start' && e.message === event.message && !e.isComplete
      );
      if (flatIdx !== -1) {
        progressLog[flatIdx] = { ...progressLog[flatIdx], ...outcome };
      }
      continue;
    }

    if (phase === 'tool_result' && iteration !== undefined) {
      entry.isComplete = true;
      const group = progressGroups.find(g => g.iteration === iteration);
      if (group) {
        group.entries.push(entry);
      }
      progressLog.push(entry);
      continue;
    }

    if (phase === 'thinking' && iteration !== undefined) {
      // Finalize the current group
      const group = progressGroups.find(g => g.iteration === iteration);
      if (group) {
        group.isComplete = true;
        const durations = group.entries
          .filter(e => e.phase === 'tool_start' && e.duration_ms !== undefined)
          .map(e => e.duration_ms!);
        if (durations.length > 0) {
          group.totalDuration_ms = durations.reduce((a, b) => a + b, 0);
        }
        const prevEntries = progressGroups
          .filter(g => g.iteration < iteration!)
          .flatMap(g => g.entries);
        group.label = generateGroupLabel(group.entries, prevEntries);
      }
      continue;
    }

    if (phase === 'tool_start' && iteration !== undefined) {
      let group = progressGroups.find(g => g.iteration === iteration);
      if (!group) {
        group = { iteration, label: 'Gathering data', entries: [], isComplete: false };
        progressGroups.push(group);
      }
      group.entries.push(entry);
      progressLog.push(entry);
      continue;
    }

    // Standalone entries (analyze, synthesize)
    if (progressLog.length > 0) {
      progressLog[progressLog.length - 1] = { ...progressLog[progressLog.length - 1], isComplete: true };
    }
    progressLog.push(entry);
  }

  // Build toolsCalled from paired tool_start/tool_complete/tool_result events
  for (const group of progressGroups) {
    for (const entry of group.entries) {
      if (entry.phase === 'tool_start' && entry.args) {
        // Read, never invent (#376, #384). The name is the one the trace
        // recorded; the operation type is the recorded one, else the loop's own
        // single derivation from that name and the arguments. An event that
        // carries no name yields a call that has none and no operation type —
        // not `get_data`, which is what this literal used to say for every
        // call, and not a guess from the arguments' shape.
        const name = entry.toolName;
        const operationType =
          entry.operationType ?? (name !== undefined ? deriveOperationType(name, entry.args) : undefined);
        const toolCall: ToolCall = {
          ...(name !== undefined ? { name } : {}),
          args: entry.args,
          duration_ms: entry.duration_ms,
          ...(operationType !== undefined ? { operationType } : {}),
          // Read off the end event's outcome, paired above (#384 P8, F2) —
          // never inferred from a missing result.
          ...(entry.failed !== undefined ? { failed: entry.failed } : {}),
          ...(entry.failureKind !== undefined ? { failureKind: entry.failureKind } : {}),
        };
        // Find matching result in group for resultSummary
        const resultEntry = group.entries.find(
          e => e.phase === 'tool_result' && e.iteration === entry.iteration
        );
        if (resultEntry) {
          // Look at the original event for resultSummary
          const originalEvent = events.find(
            ev => ev.phase === 'tool_result' && ev.iteration === entry.iteration
          );
          if (originalEvent?.resultSummary) {
            toolCall.resultSummary = originalEvent.resultSummary;
          }
        }
        toolsCalled.push(toolCall);
      }
    }
  }

  // Finalize when complete
  if (isComplete) {
    for (const entry of progressLog) {
      entry.isComplete = true;
    }
    for (let gIdx = 0; gIdx < progressGroups.length; gIdx++) {
      const g = progressGroups[gIdx];
      if (!g.isComplete) {
        g.entries = g.entries.map(e => ({ ...e, isComplete: true }));
        g.isComplete = true;
        const durations = g.entries
          .filter(e => e.phase === 'tool_start' && e.duration_ms !== undefined)
          .map(e => e.duration_ms!);
        const prevEntries = progressGroups.slice(0, gIdx).flatMap(pg => pg.entries);
        g.label = generateGroupLabel(g.entries, prevEntries);
        if (durations.length > 0) {
          g.totalDuration_ms = durations.reduce((a, b) => a + b, 0);
        }
      }
    }
  }

  return { progressLog, progressGroups, toolsCalled };
}
