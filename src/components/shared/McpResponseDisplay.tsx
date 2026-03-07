'use client';

import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ProgressLog from '@/components/ProgressLog';
import SkillPromptDisclosure from '@/components/SkillPromptDisclosure';
import { buildProvenanceLine } from '@/lib/streaming';
import type { ProgressLogEntry, ProgressGroup, ToolCall } from '@/hooks/useStreamingComparison';

interface McpResponseDisplayProps {
  content: string;
  queryText?: string;
  progressLog?: ProgressLogEntry[];
  progressGroups?: ProgressGroup[];
  toolsCalled?: ToolCall[];
  duration_ms?: number;
  tokens_used?: number;
  token_limit_exceeded?: boolean;
  isComplete?: boolean;
  isActive?: boolean;
  showFooter?: boolean;
  autoScroll?: boolean;
}

function TimingBar({ tools, totalDuration }: { tools: ToolCall[]; totalDuration: number }) {
  const dataRetrievalMs = tools.reduce((sum, t) => sum + (t.duration_ms || 0), 0);
  const remainingMs = Math.max(0, totalDuration - dataRetrievalMs);
  const analysisMs = Math.round(remainingMs * 0.4);
  const synthesisMs = remainingMs - analysisMs;

  const segments = [
    { label: 'AI reasoning', ms: analysisMs, color: 'var(--nyc-info)' },
    { label: 'Data retrieval', ms: dataRetrievalMs, color: 'var(--nyc-success)' },
    { label: 'Synthesis', ms: synthesisMs, color: 'var(--nyc-caution)' },
  ];

  return (
    <div style={{ marginBottom: '12px' }}>
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

// Replace bare dataset IDs in markdown content with clickable links
function linkDatasetIds(markdown: string, toolsCalled?: ToolCall[]): string {
  if (!toolsCalled || toolsCalled.length === 0 || !markdown) return markdown;

  const idToUrl = new Map<string, string>();
  const firstPortal = toolsCalled.find(t => t.args.portal)?.args.portal as string | undefined;

  for (const tool of toolsCalled) {
    const id = tool.args.dataset_id as string | undefined;
    const portal = (tool.args.portal as string | undefined) || firstPortal;
    if (id && portal && !idToUrl.has(id)) {
      idToUrl.set(id, `https://${portal}/d/${id}`);
    }
  }

  if (idToUrl.size === 0) return markdown;

  // Split on existing markdown links to avoid double-linking
  const linkPattern = /\[[^\]]*\]\([^)]*\)/g;
  const parts: { text: string; isLink: boolean }[] = [];
  let lastIndex = 0;
  let match;

  while ((match = linkPattern.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: markdown.slice(lastIndex, match.index), isLink: false });
    }
    parts.push({ text: match[0], isLink: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < markdown.length) {
    parts.push({ text: markdown.slice(lastIndex), isLink: false });
  }

  return parts.map(part => {
    if (part.isLink) return part.text;
    let text = part.text;
    for (const [id, url] of idToUrl) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`\\b${escaped}\\b`, 'g'), `[${id}](${url})`);
    }
    return text;
  }).join('');
}

// Custom link component for ReactMarkdown — opens in new tab
const markdownComponents = {
  a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: 'var(--nyc-blue)', textDecoration: 'underline' }}
      {...props}
    >
      {children}
    </a>
  ),
};

// Inline components for provenance rendering (no block-level wrappers)
const provenanceComponents = {
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
    <span {...props}>{children}</span>
  ),
  a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: 'var(--nyc-success)',
        textDecoration: 'underline',
        textUnderlineOffset: '2px',
        fontFamily: 'monospace',
        fontSize: '12px',
      }}
      {...props}
    >
      {children}
    </a>
  ),
};

export default function McpResponseDisplay({
  content,
  queryText,
  progressLog = [],
  progressGroups = [],
  toolsCalled = [],
  duration_ms,
  tokens_used,
  token_limit_exceeded,
  isComplete,
  isActive,
  showFooter,
  autoScroll,
}: McpResponseDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasGroups = progressGroups.length > 0;
  const hasProgressLog = progressLog.length > 0;
  const showActiveProgress = (hasProgressLog || hasGroups) && !content;
  const showContent = !!content;

  // Auto-scroll when enabled
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll, progressLog.length, progressGroups.length, content]);

  // Process content: add dataset links for known IDs from tool calls
  const processedContent = linkDatasetIds(content, toolsCalled);

  // Build provenance line
  const provenance = (content && toolsCalled.length > 0)
    ? buildProvenanceLine(toolsCalled)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Scrollable content */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px',
        }}
      >
        {/* Query text */}
        {queryText && (
          <div
            style={{
              borderLeft: '3px solid var(--nyc-blue)',
              backgroundColor: 'rgba(16, 63, 239, 0.04)',
              padding: '8px 12px',
              marginBottom: '16px',
              fontSize: '15px',
              fontStyle: 'italic',
              color: 'var(--text-secondary)',
              borderRadius: '0 4px 4px 0',
              lineHeight: '1.5',
            }}
          >
            &ldquo;{queryText}&rdquo;
          </div>
        )}

        {/* Active progress log (no content yet) */}
        {showActiveProgress && (
          <ProgressLog
            groups={progressGroups}
            standaloneEntries={progressLog.filter(e => !e.iteration)}
            variant="with-mcp"
            isActive={!!isActive}
          />
        )}

        {/* Connecting spinner (before any events arrive) */}
        {isActive && !content && !hasProgressLog && !hasGroups && (
          <div
            style={{
              color: 'var(--text-muted)',
              fontStyle: 'italic',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
            }}
          >
            <span
              style={{
                width: '16px',
                height: '16px',
                border: '2px solid var(--border-color)',
                borderTopColor: 'var(--nyc-success)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                flexShrink: 0,
              }}
            />
            Connecting...
          </div>
        )}

        {/* Content (streaming or complete) */}
        {showContent && (
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
                  totalDuration_ms={isComplete ? duration_ms : undefined}
                />
              </div>
            )}

            {/* Markdown response */}
            <div className="response-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {processedContent}
              </ReactMarkdown>
              {isActive && !isComplete && (
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

            {/* Source provenance */}
            {provenance && (
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
                <ReactMarkdown components={provenanceComponents}>
                  {provenance}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {showFooter && !!(duration_ms || tokens_used) && (
        <div
          style={{
            flexShrink: 0,
            borderTop: '1px solid var(--nyc-success)',
            padding: '16px 24px',
            backgroundColor: 'rgba(0, 183, 3, 0.05)',
          }}
        >
          {toolsCalled.length > 0 && duration_ms && (
            <TimingBar tools={toolsCalled} totalDuration={duration_ms} />
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
                <strong>Tokens:</strong> {tokens_used.toLocaleString()}
                {token_limit_exceeded && (
                  <span style={{ color: 'var(--nyc-caution)', marginLeft: '6px' }}>
                    (limit reached)
                  </span>
                )}
              </span>
            )}
          </div>

          {toolsCalled.length > 0 && (
            <SkillPromptDisclosure />
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
