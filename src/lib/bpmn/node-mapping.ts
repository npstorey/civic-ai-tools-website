import type { TraceEvent } from './traces';

export interface AnimationStep {
  nodeId: string;
  delay: number;
  edgeId?: string;
  marker?: 'loop-back' | 'success';
  /** Minimum time this step's activation should hold before the next event fires */
  holdMs?: number;
}

export function mapEventToNodes(event: TraceEvent): AnimationStep[] {
  switch (event.phase) {
    case 'analyze':
      return [
        { nodeId: 'task_ai_reads', delay: 0 },
        { nodeId: 'task_ai_plans', delay: 800 },
      ];

    case 'tool_start':
      // Cascade across swim lanes — user watches data travel down
      return [
        { nodeId: 'task_ai_constructs_call', delay: 0 },
        { nodeId: 'task_mcp_translates', delay: 800, edgeId: 'flow_construct_to_mcp' },
        { nodeId: 'task_socrata_executes', delay: 1600, edgeId: 'flow_mcp_to_socrata' },
        { nodeId: 'task_narration_translate', delay: 600, edgeId: 'flow_tool_to_narration' },
      ];

    case 'tool_complete':
      // A rejected call's end returns no results (#384 P8, F2): the span
      // ends, nothing travels back, and the "results return" node is not
      // lit for it. The annotation beside the diagram states the rejection.
      if (event.failed) return [];
      return [
        { nodeId: 'task_results_return', delay: 0, edgeId: 'flow_socrata_to_return' },
      ];

    case 'tool_result':
      // Gateway decision — hold for dramatic pause
      return [
        { nodeId: 'gateway_enough_data', delay: 0, edgeId: 'flow_return_to_gateway', holdMs: 2500 },
      ];

    case 'thinking':
      // Loop-back — hold the amber highlight
      return [
        { nodeId: 'gateway_enough_data', delay: 0, edgeId: 'flow_loop_back', marker: 'loop-back', holdMs: 1500 },
      ];

    case 'synthesize':
      // Success resolution — hold the green highlight
      return [
        { nodeId: 'gateway_enough_data', delay: 0, edgeId: 'flow_to_synthesis', marker: 'success', holdMs: 2000 },
        { nodeId: 'task_ai_synthesizes', delay: 800 },
        { nodeId: 'event_end', delay: 1600 },
      ];

    default:
      return [];
  }
}
