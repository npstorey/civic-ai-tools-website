'use client';

import { useState } from 'react';

interface LiveResponsePanelProps {
  content: string;
  elapsedMs: number;
  iterationCount: number;
  isComplete: boolean;
}

const MAX_PREVIEW_CHARS = 600;

export default function LiveResponsePanel({
  content,
  elapsedMs,
  iterationCount,
  isComplete,
}: LiveResponsePanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!content && !isComplete) return null;

  const isTruncated = content.length > MAX_PREVIEW_CHARS && !expanded;
  const displayContent = isTruncated ? content.slice(0, MAX_PREVIEW_CHARS) + '\u2026' : content;

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: '4px',
      padding: '12px 16px',
      background: 'var(--card-background)',
      fontSize: '13px',
    }}>
      {/* Stats line */}
      <div style={{
        display: 'flex',
        gap: '12px',
        fontSize: '12px',
        color: 'var(--text-muted)',
        marginBottom: content ? '8px' : 0,
      }}>
        <span>{(elapsedMs / 1000).toFixed(1)}s</span>
        {iterationCount > 0 && (
          <span>{iterationCount} {iterationCount === 1 ? 'iteration' : 'iterations'}</span>
        )}
        {isComplete && !content && (
          <span>Waiting for response...</span>
        )}
      </div>

      {/* Response content */}
      {content && (
        <div style={{
          color: 'var(--text-secondary)',
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {displayContent}
        </div>
      )}

      {/* Show more / less toggle */}
      {content.length > MAX_PREVIEW_CHARS && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--nyc-blue-40)',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '4px 0 0',
            fontFamily: 'inherit',
          }}
        >
          {expanded ? 'Show less' : 'Show full response'}
        </button>
      )}

      {/* Source attribution */}
      {isComplete && content && (
        <div style={{
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid var(--border-color)',
          fontSize: '11px',
          color: 'var(--text-muted)',
        }}>
          Response generated with MCP-connected live data from NYC Open Data
        </div>
      )}
    </div>
  );
}
