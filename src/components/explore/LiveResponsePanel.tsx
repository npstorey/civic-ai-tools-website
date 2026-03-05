'use client';

import McpResponseDisplay from '@/components/shared/McpResponseDisplay';
import type { ProgressLogEntry, ProgressGroup, ToolCall } from '@/hooks/useStreamingComparison';

interface ExampleStatus {
  currentStep: number;
  totalSteps: number;
  currentMessage?: string;
}

interface LiveResponsePanelProps {
  content: string;
  elapsedMs: number;
  iterationCount: number;
  isComplete: boolean;
  isRunning: boolean;
  progressLog: ProgressLogEntry[];
  progressGroups: ProgressGroup[];
  toolsCalled: ToolCall[];
  queryText?: string;
  exampleStatus?: ExampleStatus;
  completionCta?: React.ReactNode;
}

export default function LiveResponsePanel({
  content,
  elapsedMs,
  iterationCount,
  isComplete,
  isRunning,
  progressLog,
  progressGroups,
  toolsCalled,
  queryText,
  exampleStatus,
  completionCta,
}: LiveResponsePanelProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Header: stats line */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-color)',
        fontSize: '12px',
        color: 'var(--text-muted)',
        background: 'var(--card-background)',
      }}>
        {exampleStatus ? (
          isComplete ? (
            <>
              <span>{(elapsedMs / 1000).toFixed(1)}s</span>
              {toolsCalled.length > 0 && (
                <span>{toolsCalled.length} {toolsCalled.length === 1 ? 'tool call' : 'tool calls'}</span>
              )}
            </>
          ) : (
            <>
              {exampleStatus.currentMessage && (
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}>
                  {exampleStatus.currentMessage}
                </span>
              )}
            </>
          )
        ) : (
          <>
            <span>{(elapsedMs / 1000).toFixed(1)}s</span>
            {iterationCount > 0 && (
              <span>{iterationCount} {iterationCount === 1 ? 'iteration' : 'iterations'}</span>
            )}
          </>
        )}
        {!exampleStatus && isComplete && toolsCalled.length > 0 && (
          <span style={{ marginLeft: 'auto', fontWeight: 500 }}>
            {toolsCalled.length} {toolsCalled.length === 1 ? 'tool call' : 'tool calls'}
          </span>
        )}
      </div>

      {/* McpResponseDisplay fills remaining space */}
      <McpResponseDisplay
        content={content}
        queryText={queryText}
        progressLog={progressLog}
        progressGroups={progressGroups}
        toolsCalled={toolsCalled}
        duration_ms={isComplete ? elapsedMs : undefined}
        isComplete={isComplete}
        isActive={isRunning}
        showFooter={isComplete && toolsCalled.length > 0}
        autoScroll
      />

      {isComplete && completionCta && (
        <div style={{
          flexShrink: 0,
          padding: '10px 14px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--card-background)',
        }}>
          {completionCta}
        </div>
      )}
    </div>
  );
}
