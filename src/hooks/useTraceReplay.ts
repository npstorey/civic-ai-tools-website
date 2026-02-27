'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { PreRecordedTrace } from '@/lib/bpmn/traces';
import { mapEventToNodes } from '@/lib/bpmn/node-mapping';
import {
  type PlaybackSpeed,
  type ReplayState,
  type OverlayData,
  initialReplayState,
  buildOverlay,
  applyAnimationSteps,
  applyCascadeStep,
  MIN_GAP,
} from '@/lib/bpmn/animation';

// Re-export types so existing imports still work
export type { PlaybackSpeed, ReplayState, OverlayData };

export function useTraceReplay(
  trace: PreRecordedTrace | null,
  options: { speed?: PlaybackSpeed; autoPlay?: boolean } = {},
) {
  const { speed: initialSpeed = 1, autoPlay = false } = options;
  const [state, setState] = useState<ReplayState>(initialReplayState);
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
    setState(initialReplayState);
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
        const scaledGap = rawGap / speed;
        const gap = Math.max(scaledGap, minGap);
        const prevSteps = mapEventToNodes(events[i - 1]);
        const maxHold = Math.max(...prevSteps.map(s => (s.holdMs || 0) / speed), 0);
        accumulatedDelay += Math.max(gap, maxHold);
      }

      const eventIndex = i;
      const t = setTimeout(() => {
        if (!playingRef.current) return;

        const steps = mapEventToNodes(event);
        const overlay = buildOverlay(event);

        setState(prev => applyAnimationSteps(prev, event, steps, overlay, eventIndex, events.length));

        // Schedule sub-steps with delays (cascade across lanes)
        for (const step of steps) {
          if (step.delay > 0) {
            const subT = setTimeout(() => {
              if (!playingRef.current) return;
              setState(prev => applyCascadeStep(prev, step));
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
      setState(initialReplayState);
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
