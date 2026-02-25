'use client';

import { useState, useEffect } from 'react';
import type { ProgressLogEntry, ProgressGroup } from '@/hooks/useStreamingComparison';

interface ProgressLogProps {
  groups: ProgressGroup[];
  standaloneEntries: ProgressLogEntry[];
  variant: 'without-mcp' | 'with-mcp';
  isActive: boolean;
}

function CheckIcon({ size = 14, variant }: { size?: number; variant: 'without-mcp' | 'with-mcp' }) {
  return (
    <span
      style={{
        width: `${size + 2}px`,
        height: `${size + 2}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: variant === 'with-mcp' ? 'var(--nyc-success)' : 'var(--nyc-blue)',
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
      </svg>
    </span>
  );
}

function Spinner({ variant }: { variant: 'without-mcp' | 'with-mcp' }) {
  return (
    <span
      style={{
        width: '16px',
        height: '16px',
        border: '2px solid var(--border-color)',
        borderTopColor: variant === 'with-mcp' ? 'var(--nyc-success)' : 'var(--nyc-blue)',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

function StandaloneEntry({ entry, variant }: { entry: ProgressLogEntry; variant: 'without-mcp' | 'with-mcp' }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        color: entry.isComplete ? 'var(--text-muted)' : 'var(--text-secondary)',
        fontSize: '14px',
        opacity: entry.isComplete ? 0.7 : 1,
      }}
    >
      {entry.isComplete ? <CheckIcon variant={variant} /> : <Spinner variant={variant} />}
      <span>{entry.message}</span>
    </div>
  );
}

function GroupCard({
  group,
  stepIndex,
  variant,
  isLast,
}: {
  group: ProgressGroup;
  stepIndex: number;
  variant: 'without-mcp' | 'with-mcp';
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(!group.isComplete || isLast);

  // Auto-expand the active (last incomplete) group, collapse when it completes
  useEffect(() => {
    if (isLast && !group.isComplete) {
      setExpanded(true);
    }
  }, [isLast, group.isComplete]);

  const accentColor = variant === 'with-mcp' ? 'var(--nyc-success)' : 'var(--nyc-blue)';

  // Filter to show only tool_start entries (with timing) and tool_result entries
  const visibleEntries = group.entries.filter(
    e => e.phase === 'tool_start' || e.phase === 'tool_result'
  );

  return (
    <div
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {/* Group header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 12px',
          backgroundColor: group.isComplete ? 'var(--card-background)' : 'rgba(0, 0, 0, 0.02)',
          border: 'none',
          cursor: 'pointer',
          fontSize: '14px',
          color: group.isComplete ? 'var(--text-muted)' : 'var(--text-secondary)',
          textAlign: 'left',
        }}
      >
        {/* Step indicator */}
        {group.isComplete ? (
          <CheckIcon size={14} variant={variant} />
        ) : (
          <Spinner variant={variant} />
        )}

        {/* Step number + label */}
        <span style={{ fontWeight: 500 }}>
          <span style={{ color: accentColor, marginRight: '6px' }}>Step {stepIndex}</span>
          {group.label}
        </span>

        {/* Spacer */}
        <span style={{ flex: 1 }} />

        {/* Total duration */}
        {group.totalDuration_ms !== undefined && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>
            {(group.totalDuration_ms / 1000).toFixed(1)}s
          </span>
        )}

        {/* Chevron */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="currentColor"
          style={{
            transition: 'transform 0.15s',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            flexShrink: 0,
            color: 'var(--text-muted)',
          }}
        >
          <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06z" />
        </svg>
      </button>

      {/* Group body */}
      {expanded && visibleEntries.length > 0 && (
        <div
          style={{
            padding: '6px 12px 8px 40px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {visibleEntries.map((entry, idx) => (
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
              {entry.isComplete ? (
                <CheckIcon size={12} variant={variant} />
              ) : (
                <Spinner variant={variant} />
              )}
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
  );
}

export default function ProgressLog({ groups, standaloneEntries, variant, isActive }: ProgressLogProps) {
  // Split standalone entries into before-groups (analyze) and after-groups (synthesize)
  const analyzeEntries = standaloneEntries.filter(e => e.phase === 'analyze' || (!e.phase && !e.iteration));
  const synthesizeEntries = standaloneEntries.filter(e => e.phase === 'synthesize');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Analyze / pre-group entries */}
      {analyzeEntries.map((entry, idx) => (
        <StandaloneEntry key={`a-${idx}`} entry={entry} variant={variant} />
      ))}

      {/* Iteration groups */}
      {groups.map((group, idx) => (
        <GroupCard
          key={group.iteration}
          group={group}
          stepIndex={idx + 1}
          variant={variant}
          isLast={idx === groups.length - 1 && isActive}
        />
      ))}

      {/* Synthesize / post-group entries */}
      {synthesizeEntries.map((entry, idx) => (
        <StandaloneEntry key={`s-${idx}`} entry={entry} variant={variant} />
      ))}
    </div>
  );
}
