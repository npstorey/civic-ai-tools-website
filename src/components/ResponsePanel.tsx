'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolCallCard from './ToolCallCard';
import ProgressLog from './ProgressLog';
import type { ProgressLogEntry, ProgressGroup } from '@/hooks/useStreamingComparison';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  duration_ms?: number;
  operationType?: string;
  reason?: string;
}

interface ResponsePanelProps {
  title: string;
  subtitle: React.ReactNode;
  content: string;
  duration_ms?: number;
  tokens_used?: number;
  tools_called?: ToolCall[];
  isLoading?: boolean;
  variant: 'without-mcp' | 'with-mcp';
  // Streaming props
  progressLog?: ProgressLogEntry[];
  progressGroups?: ProgressGroup[];
  isStreaming?: boolean;
}

function buildToolSummary(tools: ToolCall[], totalDuration?: number): string {
  const counts: Record<string, number> = {};
  let totalRows = 0;

  for (const tool of tools) {
    const opType = tool.operationType || 'call';
    counts[opType] = (counts[opType] || 0) + 1;
    if (tool.resultSummary?.rows) {
      totalRows += tool.resultSummary.rows;
    }
  }

  const parts: string[] = [];
  if (counts.catalog) parts.push(`Searched ${counts.catalog} catalog${counts.catalog > 1 ? 's' : ''}`);
  if (counts.metadata) parts.push(`checked ${counts.metadata} metadata`);
  if (counts.query) parts.push(`ran ${counts.query} quer${counts.query > 1 ? 'ies' : 'y'}`);
  if (counts.metrics) parts.push(`fetched ${counts.metrics} metric${counts.metrics > 1 ? 's' : ''}`);
  if (totalRows > 0) parts.push(`examined ${totalRows.toLocaleString()} records`);

  let summary = parts.length > 0 ? parts.join(', ') : `Made ${tools.length} tool call${tools.length > 1 ? 's' : ''}`;
  if (totalDuration) {
    summary += ` in ${(totalDuration / 1000).toFixed(1)}s`;
  }

  return summary;
}

export default function ResponsePanel({
  title,
  subtitle,
  content,
  duration_ms,
  tokens_used,
  tools_called,
  isLoading,
  variant,
  progressLog,
  progressGroups,
  isStreaming,
}: ResponsePanelProps) {
  const isMcp = variant === 'with-mcp';
  const hasProgressLog = isStreaming && progressLog && progressLog.length > 0;
  const hasGroups = isStreaming && progressGroups && progressGroups.length > 0;
  const showProgressLog = (hasProgressLog || hasGroups) && !content;
  const showStreamingContent = isStreaming && content;
  const showStaticContent = !isStreaming && !isLoading && content;

  const toolSummary = isMcp && tools_called && tools_called.length > 0
    ? buildToolSummary(tools_called, duration_ms)
    : null;

  const markdownContent = (text: string, showCursor?: boolean) => (
    <div className="response-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      {showCursor && (
        <span
          style={{
            display: 'inline-block',
            width: '2px',
            height: '1em',
            backgroundColor: 'var(--text-secondary)',
            marginLeft: '2px',
            animation: 'blink 1s step-end infinite',
            verticalAlign: 'text-bottom',
          }}
        />
      )}
    </div>
  );

  return (
    <div
      style={{
        border: `2px solid ${isMcp ? 'var(--nyc-success)' : 'var(--border-color)'}`,
        borderRadius: '4px',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 24px',
          backgroundColor: isMcp ? 'rgba(0, 183, 3, 0.1)' : 'var(--card-background)',
          borderBottom: `1px solid ${isMcp ? 'var(--nyc-success)' : 'var(--border-color)'}`,
        }}
      >
        <h3
          style={{
            fontSize: '20px',
            fontWeight: 600,
            margin: 0,
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: '14px',
            color: 'var(--text-muted)',
            margin: '4px 0 0 0',
          }}
        >
          {subtitle}
        </p>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          padding: '24px',
          overflow: 'auto',
        }}
      >
        {/* Non-streaming loading state */}
        {isLoading && !isStreaming && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div
              style={{
                height: '16px',
                backgroundColor: 'var(--skeleton-color)',
                borderRadius: '4px',
                animation: 'pulse 2s infinite',
              }}
            />
            <div
              style={{
                height: '16px',
                backgroundColor: 'var(--skeleton-color)',
                borderRadius: '4px',
                width: '85%',
                animation: 'pulse 2s infinite',
              }}
            />
            <div
              style={{
                height: '16px',
                backgroundColor: 'var(--skeleton-color)',
                borderRadius: '4px',
                width: '70%',
                animation: 'pulse 2s infinite',
              }}
            />
          </div>
        )}

        {/* Streaming progress log */}
        {showProgressLog && hasGroups && (
          <ProgressLog
            groups={progressGroups!}
            standaloneEntries={(progressLog || []).filter(e => !e.iteration)}
            variant={variant}
            isActive={!content}
          />
        )}
        {showProgressLog && !hasGroups && progressLog && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {progressLog.map((entry, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  color: entry.isComplete ? 'var(--text-muted)' : 'var(--text-secondary)',
                  fontSize: '14px',
                  opacity: entry.isComplete ? 0.7 : 1,
                }}
              >
                {entry.isComplete ? (
                  <span
                    style={{
                      width: '16px',
                      height: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isMcp ? 'var(--nyc-success)' : 'var(--nyc-blue)',
                      flexShrink: 0,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                    </svg>
                  </span>
                ) : (
                  <span
                    style={{
                      width: '16px',
                      height: '16px',
                      border: '2px solid var(--border-color)',
                      borderTopColor: isMcp ? 'var(--nyc-success)' : 'var(--nyc-blue)',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      flexShrink: 0,
                    }}
                  />
                )}
                <span>{entry.message}</span>
                {entry.duration_ms !== undefined && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                    {(entry.duration_ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Streaming content (with cursor) */}
        {showStreamingContent && (
          <div>
            {/* Show completed progress log above content */}
            {(hasProgressLog || hasGroups) && (
              <div style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                {hasGroups ? (
                  <ProgressLog
                    groups={progressGroups!}
                    standaloneEntries={(progressLog || []).filter(e => !e.iteration)}
                    variant={variant}
                    isActive={false}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {progressLog!.map((entry, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          color: 'var(--text-muted)',
                          fontSize: '13px',
                        }}
                      >
                        <span
                          style={{
                            width: '14px',
                            height: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isMcp ? 'var(--nyc-success)' : 'var(--nyc-blue)',
                            flexShrink: 0,
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                          </svg>
                        </span>
                        <span>{entry.message}</span>
                        {entry.duration_ms !== undefined && (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                            {(entry.duration_ms / 1000).toFixed(1)}s
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {toolSummary && (
              <div
                style={{
                  borderLeft: '3px solid var(--nyc-success)',
                  backgroundColor: 'rgba(0, 183, 3, 0.06)',
                  padding: '8px 12px',
                  marginBottom: '16px',
                  fontSize: '14px',
                  color: 'var(--text-secondary)',
                  borderRadius: '0 4px 4px 0',
                }}
              >
                {toolSummary}
              </div>
            )}
            {markdownContent(content, !duration_ms)}
          </div>
        )}

        {/* Static content (non-streaming) */}
        {showStaticContent && markdownContent(content)}
      </div>

      {/* Footer with metadata */}
      {!isLoading && (duration_ms || tokens_used || tools_called) && (
        <div
          style={{
            borderTop: `1px solid ${isMcp ? 'var(--nyc-success)' : 'var(--border-color)'}`,
            padding: '16px 24px',
            backgroundColor: isMcp ? 'rgba(0, 183, 3, 0.05)' : 'var(--card-background)',
          }}
        >
          {tools_called && tools_called.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <h4
                data-tooltip="Model Context Protocol — lets the AI call external data tools"
                style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  marginBottom: '8px',
                  cursor: 'help',
                  position: 'relative',
                  width: 'fit-content',
                }}
              >
                MCP tools used:
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {tools_called.map((tool, idx) => (
                  <ToolCallCard
                    key={idx}
                    stepNumber={idx + 1}
                    name={tool.name}
                    args={tool.args}
                    resultSummary={tool.resultSummary}
                    duration_ms={tool.duration_ms}
                    operationType={tool.operationType}
                    reason={tool.reason}
                  />
                ))}
              </div>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              fontSize: '14px',
              color: 'var(--text-muted)',
            }}
          >
            {duration_ms && (
              <span>
                <strong>Time:</strong> {(duration_ms / 1000).toFixed(2)}s
              </span>
            )}
            {tokens_used && (
              <span>
                <strong>Tokens:</strong> {tokens_used}
              </span>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
