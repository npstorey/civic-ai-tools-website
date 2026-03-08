'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ProgressLog from './ProgressLog';
import McpResponseDisplay from './shared/McpResponseDisplay';
import type { ProgressLogEntry, ProgressGroup, ToolCall } from '@/hooks/useStreamingComparison';

interface ResponsePanelProps {
  title: string;
  subtitle: React.ReactNode;
  content: string;
  duration_ms?: number;
  tokens_used?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  token_limit_exceeded?: boolean;
  tools_called?: ToolCall[];
  isLoading?: boolean;
  variant: 'without-mcp' | 'with-mcp';
  // Streaming props
  progressLog?: ProgressLogEntry[];
  progressGroups?: ProgressGroup[];
  isStreaming?: boolean;
  queryText?: string;
}

export default function ResponsePanel({
  title,
  subtitle,
  content,
  duration_ms,
  tokens_used,
  prompt_tokens,
  completion_tokens,
  token_limit_exceeded,
  tools_called,
  isLoading,
  variant,
  progressLog,
  progressGroups,
  isStreaming,
  queryText,
}: ResponsePanelProps) {
  const isMcp = variant === 'with-mcp';

  // Without-MCP display state
  const hasProgressLog = isStreaming && progressLog && progressLog.length > 0;
  const hasGroups = isStreaming && progressGroups && progressGroups.length > 0;
  const showProgressLog = !isMcp && (hasProgressLog || hasGroups) && !content;
  const showStreamingContent = !isMcp && isStreaming && !!content;
  const showStaticContent = !isMcp && !isStreaming && !isLoading && !!content;

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

      {/* MCP variant: delegate to shared component */}
      {isMcp && (
        <McpResponseDisplay
          content={content}
          queryText={queryText}
          progressLog={progressLog}
          progressGroups={progressGroups}
          toolsCalled={tools_called}
          duration_ms={duration_ms}
          tokens_used={tokens_used}
          prompt_tokens={prompt_tokens}
          completion_tokens={completion_tokens}
          token_limit_exceeded={token_limit_exceeded}
          isComplete={isStreaming ? !!duration_ms : !!content}
          isActive={!!isStreaming && !duration_ms}
          showFooter={!isLoading && !!(duration_ms || tokens_used)}
        />
      )}

      {/* Without-MCP variant: existing rendering */}
      {!isMcp && (
        <>
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
                    borderLeft: '3px solid var(--nyc-caution)',
                    padding: '8px 12px',
                    fontSize: '14px',
                    fontStyle: 'italic',
                    color: 'var(--text-secondary)',
                    backgroundColor: 'rgba(255, 179, 32, 0.08)',
                    borderRadius: '0 4px 4px 0',
                    marginBottom: '4px',
                  }}
                >
                  Answering from training data only — no access to current databases.
                </div>
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
            {/* Without-MCP contextual label during streaming */}
            {isStreaming && !content && (
              <div
                style={{
                  borderLeft: '3px solid var(--nyc-caution)',
                  padding: '8px 12px',
                  fontSize: '14px',
                  fontStyle: 'italic',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'rgba(255, 179, 32, 0.08)',
                  borderRadius: '0 4px 4px 0',
                  marginBottom: '12px',
                }}
              >
                Answering from training data only — no access to current databases.
              </div>
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
                          color: 'var(--nyc-blue)',
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
                          borderTopColor: 'var(--nyc-blue)',
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
                {markdownContent(content, !duration_ms)}
                {content && (
                  <div
                    style={{
                      borderTop: '1px solid var(--border-color)',
                      marginTop: '16px',
                      paddingTop: '12px',
                      fontSize: '13px',
                      fontStyle: 'italic',
                      color: 'var(--text-muted)',
                    }}
                  >
                    This response is based on the model&apos;s training data only. It cannot access current government records.
                  </div>
                )}
              </div>
            )}

            {/* Static content (non-streaming) */}
            {showStaticContent && (
              <div>
                {markdownContent(content)}
                {content && (
                  <div
                    style={{
                      borderTop: '1px solid var(--border-color)',
                      marginTop: '16px',
                      paddingTop: '12px',
                      fontSize: '13px',
                      fontStyle: 'italic',
                      color: 'var(--text-muted)',
                    }}
                  >
                    This response is based on the model&apos;s training data only. It cannot access current government records.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer with metadata */}
          {!isLoading && (duration_ms || tokens_used) && (
            <div
              style={{
                borderTop: '1px solid var(--border-color)',
                padding: '16px 24px',
                backgroundColor: 'var(--card-background)',
              }}
            >
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
        </>
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
