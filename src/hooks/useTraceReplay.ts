'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { PreRecordedTrace, TraceEvent } from '@/lib/bpmn/traces';
import { mapEventToNodes } from '@/lib/bpmn/node-mapping';
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

const LANE_MAP: Record<string, string> = {
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

// Minimum gap between events at each speed (ms)
const MIN_GAP: Record<PlaybackSpeed, number> = { 1: 1000, 2: 500, 4: 250 };

const initialState: ReplayState = {
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

function buildOverlay(event: TraceEvent): OverlayData | null {
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

export function useTraceReplay(
  trace: PreRecordedTrace | null,
  options: { speed?: PlaybackSpeed; autoPlay?: boolean } = {},
) {
  const { speed: initialSpeed = 1, autoPlay = false } = options;
  const [state, setState] = useState<ReplayState>(initialState);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(initialSpeed);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playingRef = useRef(false);
  const pausedAtIndexRef = useRef(-1);

  const clearTimeouts = useCallback(() => {
    for (const t of timeoutsRef.current) clearTimeout(t);
    timeoutsRef.current = [];
  }, []);

  const reset = useCallback(() => {
    clearTimeouts();
    playingRef.current = false;
    pausedAtIndexRef.current = -1;
    setState(initialState);
  }, [clearTimeouts]);

  // Reset when trace changes
  useEffect(() => {
    reset();
    if (trace && autoPlay) {
      const t = setTimeout(() => {
        playingRef.current = true;
        scheduleEvents(0);
      }, 500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace?.id]);

  const scheduleEvents = useCallback((startIndex: number) => {
    if (!trace) return;
    clearTimeouts();

    const events = trace.events;
    let accumulatedDelay = 0;
    const minGap = MIN_GAP[speed];

    for (let i = startIndex; i < events.length; i++) {
      const event = events[i];

      if (i > startIndex) {
        const rawGap = event.relativeMs - events[i - 1].relativeMs;
        // Scale by speed, but enforce minimum gap for comprehension
        const scaledGap = rawGap / speed;
        const gap = Math.max(scaledGap, minGap);
        // Also account for holdMs from previous event's animation steps
        const prevSteps = mapEventToNodes(events[i - 1]);
        const maxHold = Math.max(...prevSteps.map(s => (s.holdMs || 0) / speed), 0);
        accumulatedDelay += Math.max(gap, maxHold);
      }

      const eventIndex = i;
      const t = setTimeout(() => {
        if (!playingRef.current) return;

        const steps = mapEventToNodes(event);
        const overlay = buildOverlay(event);

        // Determine the primary active lane from the first step
        const primaryNode = steps[0]?.nodeId;
        const lane = primaryNode ? (LANE_MAP[primaryNode] || null) : null;

        setState(prev => {
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
            progress: (eventIndex + 1) / events.length,
            isPlaying: true,
            isPaused: false,
            isComplete: false,
            activeLane: lane,
          };
        });

        // Schedule sub-steps with delays (cascade across lanes)
        for (const step of steps) {
          if (step.delay > 0) {
            const subT = setTimeout(() => {
              if (!playingRef.current) return;
              setState(prev => {
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
              });
            }, step.delay / speed);
            timeoutsRef.current.push(subT);
          }
        }

        // Check if this is the last event
        if (eventIndex === events.length - 1) {
          const endT = setTimeout(() => {
            playingRef.current = false;
            setState(prev => ({
              ...prev,
              isPlaying: false,
              isComplete: true,
              progress: 1,
              activeLane: null,
            }));
          }, 2000 / speed);
          timeoutsRef.current.push(endT);
        }
      }, accumulatedDelay);

      timeoutsRef.current.push(t);
    }
  }, [trace, speed, clearTimeouts]);

  const play = useCallback(() => {
    if (!trace) return;
    playingRef.current = true;
    const startFrom = pausedAtIndexRef.current >= 0 ? pausedAtIndexRef.current : 0;
    pausedAtIndexRef.current = -1;
    if (startFrom === 0) {
      setState(initialState);
    }
    setState(prev => ({ ...prev, isPlaying: true, isPaused: false, isComplete: false }));
    scheduleEvents(startFrom);
  }, [trace, scheduleEvents]);

  const pause = useCallback(() => {
    clearTimeouts();
    playingRef.current = false;
    setState(prev => {
      pausedAtIndexRef.current = prev.currentEventIndex + 1;
      return { ...prev, isPlaying: false, isPaused: true };
    });
  }, [clearTimeouts]);

  const setSpeed = useCallback((newSpeed: PlaybackSpeed) => {
    setSpeedState(newSpeed);
  }, []);

  return {
    state,
    speed,
    play,
    pause,
    reset,
    setSpeed,
  };
}
