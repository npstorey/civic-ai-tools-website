'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ProgressLog from './ProgressLog';
import type { ProgressLogEntry, ProgressGroup, ToolCall } from '@/hooks/useStreamingComparison';
import { getPortalCity, getDatasetName } from '@/lib/streaming';

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

function TimingBar({ tools, totalDuration }: { tools: ToolCall[]; totalDuration: number }) {
  const dataRetrievalMs = tools.reduce((sum, t) => sum + (t.duration_ms || 0), 0);
  const remainingMs = Math.max(0, totalDuration - dataRetrievalMs);
  // Split remaining time: 40% analysis, 60% synthesis (rough estimate)
  const analysisMs = Math.round(remainingMs * 0.4);
  const synthesisMs = remainingMs - analysisMs;

  const segments = [
    { label: 'AI reasoning', ms: analysisMs, color: 'var(--nyc-info)' },
    { label: 'Data Retrieval', ms: dataRetrievalMs, color: 'var(--nyc-success)' },
    { label: 'Synthesis', ms: synthesisMs, color: 'var(--nyc-caution)' },
  ];

  return (
    <div style={{ marginBottom: '12px' }}>
      {/* Stacked bar */}
      <div
        style={{
          display: 'flex',
          height: '8px',
          borderRadius: '4px',
          overflow: 'hidden',
          backgroundColor: 'var(--card-background)',
        }}
      >
        {segments.map((seg) => (
          <div
            key={seg.label}
            style={{
              width: `${(seg.ms / totalDuration) * 100}%`,
              backgroundColor: seg.color,
              minWidth: seg.ms > 0 ? '2px' : 0,
            }}
          />
        ))}
      </div>
      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginTop: '4px',
          fontSize: '11px',
          color: 'var(--text-muted)',
          flexWrap: 'wrap',
        }}
      >
        {segments.map((seg) => (
          <span key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '2px',
                backgroundColor: seg.color,
                flexShrink: 0,
              }}
            />
            {seg.label}: {(seg.ms / 1000).toFixed(1)}s
          </span>
        ))}
      </div>
    </div>
  );
}

function buildProvenanceLine(tools: ToolCall[]): string | null {
  // Find query-type tools with results
  const queryTools = tools.filter(t => t.operationType === 'query');
  if (queryTools.length === 0) return null;

  const parts: string[] = [];

  // Get portal city from first tool with a portal arg
  const firstPortal = tools.find(t => t.args.portal)?.args.portal as string | undefined;
  if (firstPortal) {
    const city = getPortalCity(firstPortal);
    parts.push(`${city} Open Data`);
  }

  // Dataset names and IDs (deduplicated)
  const seen = new Set<string>();
  for (const tool of queryTools) {
    const datasetId = tool.args.dataset_id as string | undefined;
    if (datasetId && !seen.has(datasetId)) {
      seen.add(datasetId);
      const name = getDatasetName(datasetId);
      parts.push(`${name} (${datasetId})`);
    }
  }

  // Total rows
  const totalRows = queryTools.reduce((sum, t) => sum + (t.resultSummary?.rows || 0), 0);
  if (totalRows > 0) {
    parts.push(`${totalRows.toLocaleString()} rows returned`);
  }

  return parts.length > 0 ? `Source: ${parts.join(' · ')}` : null;
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
            {/* Without-MCP contextual label */}
            {!isMcp && (
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
            )}
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
        {isStreaming && !content && !isMcp && (
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
                <ProgressLog
                  groups={progressGroups || []}
                  standaloneEntries={(progressLog || []).filter(e => !e.iteration)}
                  variant={variant}
                  isActive={false}
                  isComplete={!!(tools_called && tools_called.length > 0)}
                  toolsCalled={tools_called}
                  totalDuration_ms={duration_ms}
                />
              </div>
            )}
            {markdownContent(content, !duration_ms)}
            {/* MCP source provenance */}
            {isMcp && tools_called && tools_called.length > 0 && (() => {
              const provenance = buildProvenanceLine(tools_called);
              return provenance ? (
                <div
                  style={{
                    borderLeft: '3px solid var(--nyc-success)',
                    backgroundColor: 'rgba(0, 183, 3, 0.05)',
                    padding: '6px 10px',
                    marginTop: '16px',
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    borderRadius: '0 4px 4px 0',
                  }}
                >
                  {provenance}
                </div>
              ) : null;
            })()}
            {/* Without-MCP training data annotation */}
            {!isMcp && content && (
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
                This response is based on the model&apos;s training data (cutoff: ~early 2025). It cannot access current government records.
              </div>
            )}
          </div>
        )}

        {/* Static content (non-streaming) */}
        {showStaticContent && (
          <div>
            {/* Completed summary for MCP panel with tools */}
            {isMcp && tools_called && tools_called.length > 0 && (
              <div style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                <ProgressLog
                  groups={progressGroups || []}
                  standaloneEntries={(progressLog || []).filter(e => !e.iteration)}
                  variant={variant}
                  isActive={false}
                  isComplete={true}
                  toolsCalled={tools_called}
                  totalDuration_ms={duration_ms}
                />
              </div>
            )}
            {markdownContent(content)}
            {/* Without-MCP training data annotation */}
            {!isMcp && content && (
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
                This response is based on the model&apos;s training data (cutoff: ~early 2025). It cannot access current government records.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer with metadata */}
      {!isLoading && (duration_ms || tokens_used) && (
        <div
          style={{
            borderTop: `1px solid ${isMcp ? 'var(--nyc-success)' : 'var(--border-color)'}`,
            padding: '16px 24px',
            backgroundColor: isMcp ? 'rgba(0, 183, 3, 0.05)' : 'var(--card-background)',
          }}
        >
          {/* Timing breakdown bar for MCP panel */}
          {isMcp && tools_called && tools_called.length > 0 && duration_ms && (
            <TimingBar tools={tools_called} totalDuration={duration_ms} />
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
