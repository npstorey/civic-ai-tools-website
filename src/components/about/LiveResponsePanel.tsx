'use client';

import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ProgressLog from '@/components/ProgressLog';
import type { ProgressLogEntry, ProgressGroup, ToolCall } from '@/hooks/useStreamingComparison';
import { getDatasetName, getPortalCity } from '@/lib/streaming';

interface LiveResponsePanelProps {
  content: string;
  elapsedMs: number;
  iterationCount: number;
  isComplete: boolean;
  isRunning: boolean;
  progressLog: ProgressLogEntry[];
  progressGroups: ProgressGroup[];
  toolsCalled: ToolCall[];
}

function buildProvenanceLine(tools: ToolCall[]): string | null {
  const queryTools = tools.filter(t => t.operationType === 'query');
  if (queryTools.length === 0) return null;

  const parts: string[] = [];

  const firstPortal = tools.find(t => t.args.portal)?.args.portal as string | undefined;
  if (firstPortal) {
    parts.push(`${getPortalCity(firstPortal)} Open Data`);
  }

  const seen = new Set<string>();
  for (const tool of queryTools) {
    const datasetId = tool.args.dataset_id as string | undefined;
    if (datasetId && !seen.has(datasetId)) {
      seen.add(datasetId);
      parts.push(`${getDatasetName(datasetId)} (${datasetId})`);
    }
  }

  const totalRows = queryTools.reduce((sum, t) => sum + (t.resultSummary?.rows || 0), 0);
  if (totalRows > 0) {
    parts.push(`${totalRows.toLocaleString()} rows returned`);
  }

  return parts.length > 0 ? `Source: ${parts.join(' \u00B7 ')}` : null;
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
}: LiveResponsePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasGroups = progressGroups.length > 0;
  const hasProgressLog = progressLog.length > 0;

  // Phases of display — mirrors home page ResponsePanel exactly
  const showActiveProgressLog = (hasProgressLog || hasGroups) && !content;
  const showStreamingContent = !!content;

  // Auto-scroll as new entries or content arrives
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [progressLog.length, progressGroups.length, content]);

  const provenance = (isComplete && toolsCalled.length > 0)
    ? buildProvenanceLine(toolsCalled)
    : null;

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
        <span>{(elapsedMs / 1000).toFixed(1)}s</span>
        {iterationCount > 0 && (
          <span>{iterationCount} {iterationCount === 1 ? 'iteration' : 'iterations'}</span>
        )}
        {isComplete && toolsCalled.length > 0 && (
          <span style={{ marginLeft: 'auto', fontWeight: 500 }}>
            {toolsCalled.length} {toolsCalled.length === 1 ? 'tool call' : 'tool calls'}
          </span>
        )}
      </div>

      {/* Scrollable content area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
        }}
      >
        {/* Active progress log — streaming phase, no content yet */}
        {showActiveProgressLog && (
          <ProgressLog
            groups={progressGroups}
            standaloneEntries={progressLog.filter(e => !e.iteration)}
            variant="with-mcp"
            isActive={!content}
          />
        )}

        {/* Waiting for initial events */}
        {isRunning && !hasProgressLog && !hasGroups && !content && (
          <div style={{
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
          }}>
            <span style={{
              width: '16px',
              height: '16px',
              border: '2px solid var(--border-color)',
              borderTopColor: 'var(--nyc-success)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              flexShrink: 0,
            }} />
            Connecting...
          </div>
        )}

        {/* Content visible (streaming or complete) */}
        {showStreamingContent && (
          <div>
            {/* Completed progress log above content */}
            {(hasProgressLog || hasGroups) && (
              <div style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                <ProgressLog
                  groups={progressGroups}
                  standaloneEntries={progressLog.filter(e => !e.iteration)}
                  variant="with-mcp"
                  isActive={false}
                  isComplete={isComplete && toolsCalled.length > 0}
                  toolsCalled={isComplete ? toolsCalled : undefined}
                  totalDuration_ms={isComplete ? elapsedMs : undefined}
                />
              </div>
            )}

            {/* Markdown response */}
            <div className="response-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              {/* Blinking cursor while still streaming */}
              {isRunning && (
                <span style={{
                  display: 'inline-block',
                  width: '2px',
                  height: '1em',
                  backgroundColor: 'var(--text-secondary)',
                  marginLeft: '2px',
                  animation: 'blink 1s step-end infinite',
                  verticalAlign: 'text-bottom',
                }} />
              )}
            </div>

            {/* Source provenance */}
            {provenance && (
              <div style={{
                borderLeft: '3px solid var(--nyc-success)',
                backgroundColor: 'rgba(0, 183, 3, 0.05)',
                padding: '6px 10px',
                marginTop: '16px',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                borderRadius: '0 4px 4px 0',
              }}>
                {provenance}
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
