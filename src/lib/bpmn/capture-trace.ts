import type { TraceEvent, PreRecordedTrace } from './traces';
import type { ProgressPhase } from '@/lib/streaming';

/**
 * Dev-only utility to capture a live trace from the SSE event stream.
 *
 * Usage: Set NEXT_PUBLIC_CAPTURE_TRACES=true in .env.local, then run a query.
 * After the query completes, the trace JSON will be logged to the console.
 * Copy and paste into traces.ts.
 */
export function createTraceCapture(query: string, model: string, portal: string) {
  const events: TraceEvent[] = [];
  const startTime = Date.now();

  return {
    recordEvent(event: {
      phase?: ProgressPhase;
      message: string;
      iteration?: number;
      args?: Record<string, unknown>;
      duration_ms?: number;
      resultSummary?: { rows: number; columns: number };
      toolName?: string;
      operationType?: string;
    }) {
      if (!event.phase) return;
      events.push({
        relativeMs: Date.now() - startTime,
        phase: event.phase,
        message: event.message,
        iteration: event.iteration,
        args: event.args,
        duration_ms: event.duration_ms,
        resultSummary: event.resultSummary,
        // What the wire carried (#384): a captured trace records the tool the
        // loop named, so its replay never has to guess one.
        ...(event.toolName !== undefined ? { toolName: event.toolName } : {}),
        ...(event.operationType !== undefined ? { operationType: event.operationType } : {}),
      });
    },

    exportTrace(): PreRecordedTrace {
      return {
        id: 'captured',
        title: query,
        chipLabel: query.slice(0, 30),
        query,
        model,
        portal,
        capturedAt: new Date().toISOString(),
        totalDuration_ms: Date.now() - startTime,
        events,
      };
    },
  };
}
