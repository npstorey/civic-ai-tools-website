'use client';

import { useState } from 'react';
import SoqlDisplay from './SoqlDisplay';
import { generatePlainEnglishQuery } from '@/lib/streaming';
import { OP_BADGE_COLORS, OP_BADGE_TOOLTIPS } from './tool-badges';

interface ToolCallCardProps {
  stepNumber: number;
  /** Absent when the record carried no tool name (see `ToolCall.name`, #384). */
  name?: string;
  args: Record<string, unknown>;
  resultSummary?: { rows: number; columns: number };
  duration_ms?: number;
  operationType?: string;
  reason?: string;
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

// Format args as key-value pairs, excluding internal fields
function formatArgs(args: Record<string, unknown>): { key: string; value: string }[] {
  const skipKeys = new Set(['type', 'portal']);
  return Object.entries(args)
    .filter(([key]) => !skipKeys.has(key))
    .map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
}

export default function ToolCallCard({
  stepNumber,
  name,
  args,
  resultSummary,
  duration_ms,
  operationType,
  reason,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  // The recorded operation type, else `args.type` (only `get_data` carries
  // it); nothing for a call the record does not type (`fetch`, by design).
  const opType = operationType || (args.type as string | undefined) || undefined;
  // The badge says what the record says: the operation type, else the tool's
  // recorded name, else that the name is missing — never a stand-in such as
  // "call" that reads like a type (#384).
  const badgeLabel = opType ?? name ?? 'unnamed';
  const badgeTooltip = opType ? OP_BADGE_TOOLTIPS[opType] : undefined;
  const badgeColors = (opType && OP_BADGE_COLORS[opType]) || { bg: 'var(--card-background)', text: 'var(--text-secondary)' };
  const urls = buildSocrataUrl(args);
  const datasetId = args.dataset_id as string | undefined;
  const plainEnglish = opType === 'query' ? generatePlainEnglishQuery(args) : null;

  return (
    <div
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {/* Collapsed header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          backgroundColor: 'rgba(0, 183, 3, 0.06)',
          border: 'none',
          cursor: 'pointer',
          fontSize: '13px',
          color: 'var(--text-secondary)',
          textAlign: 'left',
        }}
      >
        {/* Step number */}
        <span
          style={{
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            backgroundColor: 'var(--success)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {stepNumber}
        </span>

        {/* Operation type badge */}
        <span
          data-tooltip={badgeTooltip}
          style={{
            padding: '1px 6px',
            borderRadius: '3px',
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            backgroundColor: badgeColors.bg,
            color: badgeColors.text,
            flexShrink: 0,
            cursor: badgeTooltip ? 'help' : undefined,
            position: 'relative',
          }}
        >
          {badgeLabel}
        </span>

        {/* Reason */}
        {reason && (
          <span
            style={{
              fontSize: '12px',
              fontStyle: 'italic',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {reason}
          </span>
        )}

        {/* Result count */}
        {resultSummary && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>
            {resultSummary.rows} row{resultSummary.rows !== 1 ? 's' : ''}
          </span>
        )}

        {/* Spacer */}
        <span style={{ flex: 1 }} />

        {/* Timing */}
        {duration_ms !== undefined && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>
            {(duration_ms / 1000).toFixed(1)}s
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

      {/* Expanded body */}
      {expanded && (
        <div
          style={{
            padding: '12px',
            borderTop: '1px solid var(--border-color)',
            fontSize: '13px',
          }}
        >
          {/* Tool name */}
          <div style={{ marginBottom: '8px' }}>
            <code
              style={{
                fontSize: '12px',
                fontFamily: 'monospace',
                color: 'var(--success)',
                fontWeight: 600,
              }}
            >
              {name ?? '(not recorded)'}
            </code>
          </div>

          {/* SoQL display for query type */}
          {opType === 'query' && (
            <div style={{ marginBottom: '8px' }}>
              <SoqlDisplay args={args} />
              {plainEnglish && (
                <div
                  style={{
                    borderLeft: '3px solid var(--info)',
                    backgroundColor: 'rgba(112, 186, 255, 0.08)',
                    padding: '6px 10px',
                    marginTop: '6px',
                    fontSize: '12px',
                    fontStyle: 'italic',
                    color: 'var(--text-secondary)',
                    borderRadius: '0 4px 4px 0',
                    lineHeight: '1.5',
                  }}
                >
                  {plainEnglish}
                </div>
              )}
            </div>
          )}

          {/* Formatted args for non-query types */}
          {opType !== 'query' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                marginBottom: '8px',
              }}
            >
              {formatArgs(args).map(({ key, value }) => (
                <div key={key} style={{ display: 'flex', gap: '8px', fontSize: '12px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-muted)', minWidth: '80px' }}>{key}:</span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', wordBreak: 'break-word' }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Dataset ID with tooltip */}
          {datasetId && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
              <span data-tooltip="Every Socrata dataset has a unique 4x4 code (like a library call number) that identifies it across the portal">Dataset: </span>
              <code style={{ fontFamily: 'monospace' }}>{datasetId}</code>
            </div>
          )}

          {/* Result summary */}
          {resultSummary && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
              Returned {resultSummary.rows} rows x {resultSummary.columns} columns
            </div>
          )}

          {/* Socrata links */}
          {urls && (
            <div style={{ fontSize: '12px', display: 'flex', gap: '12px' }}>
              <a href={urls.json} target="_blank" rel="noopener noreferrer">
                View JSON
              </a>
              {opType === 'query' && (
                <a href={urls.csv} target="_blank" rel="noopener noreferrer">
                  View CSV
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
