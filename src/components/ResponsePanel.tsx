'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
}

interface ProgressLogEntry {
  message: string;
  timestamp: number;
  isComplete?: boolean;
}

interface ResponsePanelProps {
  title: string;
  subtitle: string;
  content: string;
  duration_ms?: number;
  tokens_used?: number;
  tools_called?: ToolCall[];
  isLoading?: boolean;
  variant: 'without-mcp' | 'with-mcp';
  // Streaming props
  progressLog?: ProgressLogEntry[];
  isStreaming?: boolean;
}

function buildSocrataUrl(args: Record<string, unknown>): { json: string; csv: string } | null {
  const type = args.type as string;
  const portal = args.portal as string;
  const datasetId = args.dataset_id as string;

  if (!portal || !datasetId) return null;

  const base = `https://${portal}/resource/${datasetId}`;

  if (type === 'query') {
    const params = new URLSearchParams();
    if (args.select) params.set('$select', args.select as string);
    if (args.where) params.set('$where', args.where as string);
    if (args.group) params.set('$group', args.group as string);
    if (args.order) params.set('$order', args.order as string);
    if (args.limit) params.set('$limit', String(args.limit));
    const qs = params.toString();
    return {
      json: `${base}.json${qs ? `?${qs}` : ''}`,
      csv: `${base}.csv${qs ? `?${qs}` : ''}`,
    };
  }

  if (type === 'catalog') {
    const query = args.query as string | undefined;
    const catalogUrl = `https://${portal}/api/catalog/v1${query ? `?q=${encodeURIComponent(query)}` : ''}`;
    return { json: catalogUrl, csv: catalogUrl };
  }

  if (type === 'metadata') {
    return {
      json: `https://${portal}/api/views/${datasetId}.json`,
      csv: `https://${portal}/api/views/${datasetId}.json`,
    };
  }

  return null;
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
  isStreaming,
}: ResponsePanelProps) {
  const isMcp = variant === 'with-mcp';
  const hasProgressLog = isStreaming && progressLog && progressLog.length > 0;
  const showProgressLog = hasProgressLog && !content;
  const showStreamingContent = isStreaming && content;
  const showStaticContent = !isStreaming && !isLoading && content;

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
        {showProgressLog && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {progressLog!.map((entry, idx) => (
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
                <span style={{ textDecoration: entry.isComplete ? 'none' : 'none' }}>
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Streaming content (with cursor) */}
        {showStreamingContent && (
          <div>
            {/* Show completed progress log above content */}
            {hasProgressLog && (
              <div style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
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
                    </div>
                  ))}
                </div>
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

          {tools_called && tools_called.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h4
                style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--text-secondary)',
                  marginBottom: '8px',
                }}
              >
                MCP tools used:
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {tools_called.map((tool, idx) => {
                  const urls = buildSocrataUrl(tool.args);
                  return (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: 'rgba(0, 183, 3, 0.15)',
                        borderRadius: '4px',
                        padding: '8px 12px',
                      }}
                    >
                      <code
                        style={{
                          fontSize: '14px',
                          fontFamily: 'monospace',
                          color: 'var(--nyc-success)',
                          fontWeight: 600,
                        }}
                      >
                        {tool.name}
                      </code>
                      {tool.resultSummary && (
                        <span
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-muted)',
                            marginLeft: '8px',
                          }}
                        >
                          Returned {tool.resultSummary.rows} rows x {tool.resultSummary.columns} columns
                        </span>
                      )}
                      <div
                        style={{
                          fontSize: '12px',
                          fontFamily: 'monospace',
                          color: 'var(--text-muted)',
                          marginTop: '4px',
                          overflowX: 'auto',
                        }}
                      >
                        {JSON.stringify(tool.args, null, 2)}
                      </div>
                      {urls && (
                        <div
                          style={{
                            fontSize: '12px',
                            marginTop: '6px',
                            display: 'flex',
                            gap: '12px',
                          }}
                        >
                          <a href={urls.json} target="_blank" rel="noopener noreferrer">
                            View JSON
                          </a>
                          {(tool.args.type as string) === 'query' && (
                            <a href={urls.csv} target="_blank" rel="noopener noreferrer">
                              View CSV
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
