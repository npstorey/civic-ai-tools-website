'use client';

import { useState, useEffect, useRef } from 'react';
import McpResponseDisplay from '@/components/shared/McpResponseDisplay';
import type { ProgressLogEntry, ProgressGroup, ToolCall } from '@/hooks/useStreamingComparison';

const TIMEOUT_MESSAGES = [
  { afterMs: 15_000, text: 'Complex queries may take a minute \u2014 the AI is working through multiple data sources.', prominent: false },
  { afterMs: 45_000, text: 'Searching across portals, checking column schemas, and retrying queries as needed...', prominent: false },
  { afterMs: 90_000, text: 'This is taking longer than usual. The AI may be working through a complex multi-step analysis.', prominent: false },
  { afterMs: 120_000, text: '__too_complex__', prominent: true },
];

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
  const [timeoutMessage, setTimeoutMessage] = useState<string | null>(null);
  const [isProminent, setIsProminent] = useState(false);
  const lastEventTimeRef = useRef<number>(Date.now());
  const prevProgressLenRef = useRef<number>(progressLog.length);

  // Reset timer when new progress events arrive
  useEffect(() => {
    if (progressLog.length !== prevProgressLenRef.current) {
      prevProgressLenRef.current = progressLog.length;
      lastEventTimeRef.current = Date.now();
      setTimeoutMessage(null);
      setIsProminent(false);
    }
  }, [progressLog.length]);

  // Clear messages when streaming completes; reset timer when streaming starts
  useEffect(() => {
    if (!isRunning) {
      setTimeoutMessage(null);
      setIsProminent(false);
    } else {
      lastEventTimeRef.current = Date.now();
    }
  }, [isRunning]);

  // Tick every second while running to check for timeout messages
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastEventTimeRef.current;
      // Find the latest applicable message
      let matched: typeof TIMEOUT_MESSAGES[number] | null = null;
      for (const msg of TIMEOUT_MESSAGES) {
        if (elapsed >= msg.afterMs) matched = msg;
      }
      if (matched) {
        setTimeoutMessage(matched.text);
        setIsProminent(matched.prominent);
      } else {
        setTimeoutMessage(null);
        setIsProminent(false);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

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

      {/* Streaming timeout message */}
      {isRunning && timeoutMessage && (
        <div style={{
          flexShrink: 0,
          padding: '8px 14px',
          fontSize: '13px',
          color: 'var(--text-muted)',
          fontStyle: isProminent ? 'normal' : 'italic',
          fontWeight: isProminent ? 500 : 400,
        }}>
          {timeoutMessage === '__too_complex__' ? (
            <>
              This query may be too complex for the live demo. You can{' '}
              <a href="/" style={{ color: 'var(--nyc-blue)' }}>try a simpler question</a>, or{' '}
              <a href="https://github.com/npstorey/civic-ai-tools" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--nyc-blue)' }}>
                run locally
              </a>{' '}
              for more powerful analysis with no limits.
            </>
          ) : (
            timeoutMessage
          )}
        </div>
      )}

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
