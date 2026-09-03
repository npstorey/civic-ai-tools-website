'use client';

import { getEducationalAnnotation } from '@/lib/streaming';
import { describeQueryOutcome } from '@/lib/evidence/query-step';
import type { ReplayState } from '@/hooks/useTraceReplay';

interface DiagramAnnotationsProps {
  replayState: ReplayState;
}

function getOperationType(replayState: ReplayState): string | undefined {
  const event = replayState.currentEvent;
  if (!event) return undefined;
  // The operation type the trace recorded (#384); `args.type` only for an
  // event that carries none — a search event has no `args.type`, and read
  // that way alone it had no annotation.
  return event.operationType ?? (event.args?.type as string | undefined);
}

function getCrossReference(replayState: ReplayState): { text: string; href: string } | null {
  if (!replayState.currentEvent) return null;

  const activeNodes = replayState.activeNodes;
  if (activeNodes.has('task_ai_reads')) {
    return { text: "What's in the skill prompt?", href: '#system-prompt' };
  }
  if (activeNodes.has('task_narration_translate')) {
    return { text: 'How narration works', href: '#narration' };
  }
  return null;
}

export default function DiagramAnnotations({ replayState }: DiagramAnnotationsProps) {
  const event = replayState.currentEvent;
  if (!event && !replayState.isComplete) return null;

  let annotationText: string | null = null;

  if (replayState.isComplete) {
    annotationText = 'The AI has finished its analysis. Each step above shows how data flowed from your question through the AI, MCP server, and data portal before coming back as a grounded answer.';
  } else if (event?.failed) {
    // The end and outcome events of a rejected call (#384 P8, F2): the
    // diagram lights no "results return" step for it (node-mapping.ts), and
    // this states why in the one outcome formatter's words.
    annotationText =
      `${describeQueryOutcome({ failed: true, failureKind: event.failureKind }).text} ` +
      'The AI is told this request returned no data and not to fill the gap with a guess.';
  } else if (event) {
    const opType = getOperationType(replayState);
    annotationText = getEducationalAnnotation(event.phase, opType);
  }

  if (!annotationText) return null;

  const crossRef = replayState.isComplete ? null : getCrossReference(replayState);

  return (
    <div
      style={{
        backgroundColor: 'rgba(112, 186, 255, 0.12)',
        border: '1px solid rgba(112, 186, 255, 0.3)',
        borderRadius: '4px',
        padding: '12px 16px',
        fontSize: '14px',
        color: 'var(--text-secondary)',
        lineHeight: '1.5',
        transition: 'opacity 0.3s ease',
      }}
    >
      <p style={{ margin: 0 }}>{annotationText}</p>
      {crossRef && (
        <p style={{ margin: '8px 0 0 0', fontSize: '13px' }}>
          <a href={crossRef.href}>{crossRef.text} &rarr;</a>
        </p>
      )}
    </div>
  );
}
