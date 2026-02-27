'use client';

import { getEducationalAnnotation } from '@/lib/streaming';
import type { ReplayState } from '@/hooks/useTraceReplay';

interface NarrativePanelProps {
  replayState: ReplayState;
}

const LANE_DESCRIPTIONS: Record<string, { icon: string; label: string }> = {
  'Browser': { icon: '\uD83C\uDF10', label: 'Your Browser' },
  'AI Model': { icon: '\uD83E\uDDE0', label: 'AI Model' },
  'MCP Infrastructure': { icon: '\uD83D\uDD17', label: 'MCP Infrastructure' },
  'NYC Open Data (Socrata)': { icon: '\uD83C\uDFDB\uFE0F', label: 'NYC Open Data' },
  'Narration Layer': { icon: '\uD83D\uDCDD', label: 'Narration Layer' },
};

function getNarrative(replayState: ReplayState): { text: string; laneIcon: string; laneLabel: string } | null {
  const event = replayState.currentEvent;
  if (!event) return null;

  const lane = replayState.activeLane;
  const laneInfo = lane ? LANE_DESCRIPTIONS[lane] : null;
  const laneIcon = laneInfo?.icon || '';
  const laneLabel = laneInfo?.label || '';

  switch (event.phase) {
    case 'analyze':
      return {
        text: 'The AI is reading your question and planning which datasets to search and what queries to run.',
        laneIcon, laneLabel,
      };
    case 'tool_start': {
      const opType = event.args?.type as string | undefined;
      let action = 'The AI is calling a data tool.';
      if (opType === 'catalog') {
        action = 'The AI is searching the open data catalog to find datasets that could answer your question.';
      } else if (opType === 'metadata') {
        action = 'The AI is reading the dataset structure \u2014 learning what columns exist before writing a query.';
      } else if (opType === 'query') {
        action = 'The AI has constructed a structured database query and sent it through MCP to the data portal.';
      }
      return { text: action, laneIcon, laneLabel };
    }
    case 'tool_complete':
      return {
        text: 'Data is flowing back from the government database through MCP to the AI.',
        laneIcon, laneLabel,
      };
    case 'tool_result':
      return {
        text: 'The AI is evaluating the results \u2014 does it have enough data to answer your question?',
        laneIcon, laneLabel,
      };
    case 'thinking':
      return {
        text: 'Not yet \u2014 the AI needs more data. It\u2019s planning another query to fill in the gaps.',
        laneIcon, laneLabel,
      };
    case 'synthesize':
      return {
        text: 'The AI has enough data. It\u2019s now writing a response grounded in the actual records it retrieved.',
        laneIcon, laneLabel,
      };
    default:
      return null;
  }
}

export default function NarrativePanel({ replayState }: NarrativePanelProps) {
  if (!replayState.isPlaying && !replayState.isPaused && !replayState.isComplete) return null;

  if (replayState.isComplete) {
    return (
      <div style={panelStyle}>
        <span style={iconStyle}>&#x2705;</span>
        <span>Done \u2014 the AI wrote its response using real data from government databases. Every step above shows exactly how that data was retrieved.</span>
      </div>
    );
  }

  const narrative = getNarrative(replayState);
  if (!narrative) return null;

  // Additional educational context from streaming lib
  const event = replayState.currentEvent;
  const opType = event?.args?.type as string | undefined;
  const eduText = event ? getEducationalAnnotation(event.phase, opType) : null;

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        {narrative.laneIcon && (
          <span style={{ fontSize: '18px', flexShrink: 0, lineHeight: '1.4' }}>{narrative.laneIcon}</span>
        )}
        <div style={{ flex: 1 }}>
          {narrative.laneLabel && (
            <span style={laneBadgeStyle}>{narrative.laneLabel}</span>
          )}
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            {narrative.text}
          </p>
          {eduText && eduText !== narrative.text && (
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4', fontStyle: 'italic' }}>
              {eduText}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  backgroundColor: 'var(--card-background)',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  padding: '12px 16px',
  transition: 'all 0.3s ease',
  minHeight: '48px',
};

const iconStyle: React.CSSProperties = {
  fontSize: '18px',
  marginRight: '8px',
};

const laneBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--nyc-blue-40)',
  marginBottom: '4px',
};
