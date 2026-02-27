/**
 * Shared animation state types and transforms used by both
 * useTraceReplay (pre-recorded replay) and useLiveTrace (real-time SSE).
 */

import type { TraceEvent } from './traces';
import type { AnimationStep } from './node-mapping';
import { mapEventToNodes } from './node-mapping';
import { buildSoqlClauses } from '@/lib/streaming';

export type PlaybackSpeed = 1 | 2 | 4;

export interface OverlayData {
  nodeId: string;
  content: string;
  type: 'soql' | 'result' | 'iteration' | 'info';
}

export interface ReplayState {
  activeNodes: Set<string>;
  completedNodes: Set<string>;
  activeEdges: Set<string>;
  markedEdges: Map<string, 'loop-back' | 'success'>;
  currentIteration: number;
  currentOverlay: OverlayData | null;
  isPlaying: boolean;
  isPaused: boolean;
  isComplete: boolean;
  progress: number; // 0-1
  currentEventIndex: number;
  currentEvent: TraceEvent | null;
  /** Which swim lane is currently active */
  activeLane: string | null;
}

export const LANE_MAP: Record<string, string> = {
  event_start: 'Browser',
  event_end: 'Browser',
  task_ai_reads: 'AI Model',
  task_ai_plans: 'AI Model',
  task_ai_constructs_call: 'AI Model',
  task_results_return: 'AI Model',
  gateway_enough_data: 'AI Model',
  task_ai_synthesizes: 'AI Model',
  task_mcp_translates: 'MCP Infrastructure',
  task_socrata_executes: 'NYC Open Data (Socrata)',
  task_narration_translate: 'Narration Layer',
};

/** Minimum gap between events at each speed (ms) */
export const MIN_GAP: Record<PlaybackSpeed, number> = { 1: 1000, 2: 500, 4: 250 };

export const initialReplayState: ReplayState = {
  activeNodes: new Set(),
  completedNodes: new Set(),
  activeEdges: new Set(),
  markedEdges: new Map(),
  currentIteration: 0,
  currentOverlay: null,
  isPlaying: false,
  isPaused: false,
  isComplete: false,
  progress: 0,
  currentEventIndex: -1,
  currentEvent: null,
  activeLane: null,
};

function truncateSoql(content: string): string {
  const lines = content.split('\n');
  if (lines.length <= 2) return content;
  return lines.slice(0, 2).join('\n') + '\n...';
}

/** Build an overlay hint from a trace event (SoQL preview, result badge, etc.) */
export function buildOverlay(event: TraceEvent): OverlayData | null {
  if (event.phase === 'tool_start' && event.args) {
    const clauses = buildSoqlClauses(event.args);
    if (clauses.length > 0) {
      const content = truncateSoql(clauses.map(c => `${c.keyword} ${c.value}`).join('\n'));
      return { nodeId: 'task_ai_constructs_call', content, type: 'soql' };
    }
    const query = event.args.query as string | undefined;
    const type = event.args.type as string;
    if (type === 'catalog' && query) {
      return { nodeId: 'task_ai_constructs_call', content: `Searching: "${query}"`, type: 'info' };
    }
    if (type === 'metadata') {
      return { nodeId: 'task_ai_constructs_call', content: 'Reading dataset schema', type: 'info' };
    }
  }

  if (event.phase === 'tool_complete' && event.duration_ms) {
    return {
      nodeId: 'task_results_return',
      content: `Completed in ${(event.duration_ms / 1000).toFixed(1)}s`,
      type: 'result',
    };
  }

  if (event.phase === 'tool_result' && event.resultSummary) {
    return {
      nodeId: 'gateway_enough_data',
      content: `${event.resultSummary.rows} rows returned`,
      type: 'result',
    };
  }

  if (event.phase === 'thinking' && event.iteration) {
    return {
      nodeId: 'gateway_enough_data',
      content: `Iteration ${event.iteration} \u2014 evaluating results...`,
      type: 'iteration',
    };
  }

  return null;
}

/**
 * Apply the immediate (delay===0) animation steps for an event,
 * moving previous active nodes to completed.
 */
export function applyAnimationSteps(
  prev: ReplayState,
  event: TraceEvent,
  steps: AnimationStep[],
  overlay: OverlayData | null,
  eventIndex: number,
  totalEvents: number,
): ReplayState {
  const newActive = new Set(prev.activeNodes);
  const newCompleted = new Set(prev.completedNodes);
  const newActiveEdges = new Set(prev.activeEdges);
  const newMarkedEdges = new Map(prev.markedEdges);

  // Move currently active nodes to completed
  for (const nodeId of newActive) {
    newCompleted.add(nodeId);
  }
  newActive.clear();
  newActiveEdges.clear();

  // Apply immediate steps (delay === 0)
  for (const step of steps) {
    if (step.delay === 0) {
      newActive.add(step.nodeId);
      if (step.edgeId) {
        newActiveEdges.add(step.edgeId);
        if (step.marker) {
          newMarkedEdges.set(step.edgeId, step.marker);
        }
      }
    }
  }

  const primaryNode = steps[0]?.nodeId;
  const lane = primaryNode ? (LANE_MAP[primaryNode] || null) : null;

  return {
    ...prev,
    activeNodes: newActive,
    completedNodes: newCompleted,
    activeEdges: newActiveEdges,
    markedEdges: newMarkedEdges,
    currentIteration: event.iteration ?? prev.currentIteration,
    currentOverlay: overlay,
    currentEventIndex: eventIndex,
    currentEvent: event,
    progress: (eventIndex + 1) / totalEvents,
    isPlaying: true,
    isPaused: false,
    isComplete: false,
    activeLane: lane,
  };
}

/**
 * Apply a single delayed cascade sub-step (cross-lane activation).
 */
export function applyCascadeStep(prev: ReplayState, step: AnimationStep): ReplayState {
  const newActive = new Set(prev.activeNodes);
  newActive.add(step.nodeId);
  const newActiveEdges = new Set(prev.activeEdges);
  if (step.edgeId) newActiveEdges.add(step.edgeId);
  const newMarkedEdges = new Map(prev.markedEdges);
  if (step.edgeId && step.marker) {
    newMarkedEdges.set(step.edgeId, step.marker);
  }
  const lane = LANE_MAP[step.nodeId] || prev.activeLane;
  return { ...prev, activeNodes: newActive, activeEdges: newActiveEdges, markedEdges: newMarkedEdges, activeLane: lane };
}
