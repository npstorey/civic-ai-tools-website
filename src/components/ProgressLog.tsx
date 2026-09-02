'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ProgressLogEntry, ProgressGroup, ToolCall } from '@/hooks/useStreamingComparison';
import { mapGroupsToToolCalls } from '@/hooks/useStreamingComparison';
import { getEducationalAnnotation, buildNarrativeSummary, buildStatsSummary, buildBreadcrumbLabel, generateQueryIntentLabel } from '@/lib/streaming';
import ToolCallCard from './ToolCallCard';
import NarrationExplainer from './NarrationExplainer';

interface ProgressLogProps {
  groups: ProgressGroup[];
  standaloneEntries: ProgressLogEntry[];
  variant: 'without-mcp' | 'with-mcp';
  isActive: boolean;
  isComplete?: boolean;
  toolsCalled?: ToolCall[];
  totalDuration_ms?: number;
}

function GearIcon({ size = 12 }: { size?: number }) {
  return (
    <span
      style={{
        width: `${size + 2}px`,
        height: `${size + 2}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--caution)',
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
        <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.116l.094-.318z" />
      </svg>
    </span>
  );
}

function getPhaseStyle(phase?: string): { color: string; fontWeight: number; accentColor: string } {
  switch (phase) {
    case 'tool_start':
      return { color: 'var(--text-secondary)', fontWeight: 500, accentColor: 'var(--caution)' };
    case 'tool_result':
      return { color: 'var(--text-muted)', fontWeight: 400, accentColor: 'var(--success)' };
    default:
      return { color: 'var(--text-muted)', fontWeight: 400, accentColor: 'var(--border-color)' };
  }
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
        color: variant === 'with-mcp' ? 'var(--success)' : 'var(--accent)',
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
        borderTopColor: variant === 'with-mcp' ? 'var(--success)' : 'var(--accent)',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

function StandaloneEntry({
  entry,
  variant,
  annotation,
  isActive,
}: {
  entry: ProgressLogEntry;
  variant: 'without-mcp' | 'with-mcp';
  annotation?: string | null;
  isActive?: boolean;
}) {
  return (
    <div>
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
      {annotation && isActive && (
        <div
          style={{
            fontSize: '11px',
            fontStyle: 'italic',
            color: 'var(--text-muted)',
            paddingLeft: '26px',
            marginTop: '2px',
            lineHeight: '1.4',
          }}
        >
          {annotation}
        </div>
      )}
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
  // Track user's explicit toggle. null = auto-mode, boolean = user override.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  // Auto-expand if group is active (last and incomplete), otherwise collapsed
  const autoExpanded = !group.isComplete || isLast;
  const expanded = userExpanded !== null ? userExpanded : autoExpanded;

  const handleToggle = () => {
    setUserExpanded(!expanded);
  };

  const accentColor = variant === 'with-mcp' ? 'var(--success)' : 'var(--accent)';

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
        onClick={handleToggle}
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
          {visibleEntries.map((entry, idx) => {
            const phaseStyle = getPhaseStyle(entry.phase);
            // Show annotation only for first tool_start entry of each operation type, only while active.
            // The recorded operation type first (#384); `args.type` only for an entry that carries none.
            const entryOpType = (e: ProgressLogEntry) => e.operationType ?? (e.args?.type as string | undefined);
            const opType = entryOpType(entry);
            const isFirstOfType = entry.phase === 'tool_start' && opType &&
              visibleEntries.findIndex(e => e.phase === 'tool_start' && entryOpType(e) === opType) === idx;
            const annotation = isFirstOfType && isLast
              ? getEducationalAnnotation(entry.phase!, opType)
              : null;
            return (
              <div key={idx}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: phaseStyle.color,
                    fontSize: '13px',
                    borderLeft: `2px solid ${phaseStyle.accentColor}`,
                    paddingLeft: '8px',
                  }}
                >
                  {!entry.isComplete ? (
                    <Spinner variant={variant} />
                  ) : entry.phase === 'tool_start' ? (
                    <GearIcon size={12} />
                  ) : (
                    <CheckIcon size={12} variant={variant} />
                  )}
                  <span style={{ fontWeight: phaseStyle.fontWeight }}>{entry.message}</span>
                  {entry.duration_ms !== undefined && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                      {(entry.duration_ms / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                {annotation && (
                  <div
                    style={{
                      fontSize: '11px',
                      fontStyle: 'italic',
                      color: 'var(--text-muted)',
                      paddingLeft: '18px',
                      marginTop: '2px',
                      lineHeight: '1.4',
                    }}
                  >
                    {annotation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CompletedSummary({
  toolsCalled,
  totalDuration_ms,
  groups,
}: {
  toolsCalled: ToolCall[];
  totalDuration_ms?: number;
  groups: ProgressGroup[];
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const narrative = buildNarrativeSummary(toolsCalled);
  const stats = buildStatsSummary(toolsCalled, totalDuration_ms);
  const enrichedGroups = mapGroupsToToolCalls(groups, toolsCalled);

  // Track query step indices for varied educational annotations
  const queryStepIndices = new Map<number, number>();
  let queryCount = 0;
  toolsCalled.forEach((tool, idx) => {
    const op = tool.operationType || (tool.args.type as string);
    if (op === 'query') {
      queryStepIndices.set(idx, queryCount);
      queryCount++;
    }
  });

  // Compute intent labels with refinement info for each tool call
  const toolIntents = toolsCalled.map((tool, idx) => {
    const opType = tool.operationType || (tool.args.type as string);
    if (opType === 'query') {
      return generateQueryIntentLabel(tool.args, toolsCalled.slice(0, idx));
    }
    return { label: '', refinedFromIndex: undefined };
  });

  // Build a flat list of tool calls with their global index for breadcrumbs
  const breadcrumbs = toolsCalled.map((tool, idx) => ({
    label: buildBreadcrumbLabel(tool, toolsCalled, idx),
    index: idx,
    opType: tool.operationType || (tool.args.type as string) || 'call',
    refinedFromIndex: toolIntents[idx].refinedFromIndex,
  }));

  return (
    <div className="completed-summary-enter" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Layer A: Narrative summary (rendered via ReactMarkdown for dataset links) */}
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <p
              style={{
                margin: 0,
                fontSize: '13px',
                lineHeight: '1.5',
                color: 'var(--text-muted)',
              }}
            >
              {children}
            </p>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--accent)',
                textDecoration: 'underline',
                textUnderlineOffset: '2px',
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {narrative}
      </ReactMarkdown>
      {stats && (
        <p
          style={{
            margin: 0,
            fontSize: '12px',
            color: 'var(--text-muted)',
            opacity: 0.8,
          }}
        >
          {stats}
        </p>
      )}

      {/* Layer B: Breadcrumb chips */}
      <div className="breadcrumb-trail">
        {breadcrumbs.map((crumb) => {
          const isActive = activeIndex === crumb.index;
          const isRefinement = crumb.refinedFromIndex !== undefined;
          return (
            <button
              key={crumb.index}
              onClick={() => {
                setActiveIndex(isActive ? null : crumb.index);
                setShowAll(false);
              }}
              style={{
                padding: '3px 10px',
                borderRadius: '12px',
                border: isActive ? '1px solid var(--success)' : '1px solid var(--border-color)',
                backgroundColor: isActive ? 'rgba(0, 183, 3, 0.08)' : 'var(--card-background)',
                color: isActive ? 'var(--success)' : 'var(--text-muted)',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'all 0.15s ease',
              }}
            >
              {isRefinement && <span style={{ marginRight: '3px', opacity: 0.6 }}>&#8627;</span>}
              {crumb.label}
            </button>
          );
        })}
      </div>

      {/* Layer C: Detail panel */}
      {activeIndex !== null && !showAll && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {/* Refinement indicator */}
          {toolIntents[activeIndex].refinedFromIndex !== undefined && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                color: 'var(--text-muted)',
                paddingLeft: '4px',
              }}
            >
              <span style={{ color: 'var(--success)', fontSize: '14px', lineHeight: 1 }}>&#8627;</span>
              <span>Refined from Step {toolIntents[activeIndex].refinedFromIndex! + 1} — the AI is iterating on its query to get better data</span>
            </div>
          )}
          <ToolCallCard
            stepNumber={activeIndex + 1}
            name={toolsCalled[activeIndex].name}
            args={toolsCalled[activeIndex].args}
            resultSummary={toolsCalled[activeIndex].resultSummary}
            duration_ms={toolsCalled[activeIndex].duration_ms}
            operationType={toolsCalled[activeIndex].operationType}
            reason={toolsCalled[activeIndex].reason}
          />
          {(() => {
            const opType = toolsCalled[activeIndex].operationType || (toolsCalled[activeIndex].args.type as string);
            const queryIdx = queryStepIndices.get(activeIndex);
            const annotation = getEducationalAnnotation('tool_start', opType, queryIdx);
            return annotation ? (
              <div
                style={{
                  fontSize: '11px',
                  fontStyle: 'italic',
                  color: 'var(--text-muted)',
                  paddingLeft: '12px',
                  lineHeight: '1.4',
                }}
              >
                {annotation}
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* Show all steps */}
      {showAll && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {enrichedGroups.map((eg) =>
            eg.toolCalls.map((tool, tIdx) => {
              const globalIdx = toolsCalled.indexOf(tool);
              const opType = tool.operationType || (tool.args.type as string);
              const queryIdx = queryStepIndices.get(globalIdx);
              const annotation = getEducationalAnnotation('tool_start', opType, queryIdx);
              const refinedFrom = toolIntents[globalIdx]?.refinedFromIndex;
              return (
                <div key={`${eg.group.iteration}-${tIdx}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {refinedFrom !== undefined && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        paddingLeft: '4px',
                      }}
                    >
                      <span style={{ color: 'var(--success)', fontSize: '14px', lineHeight: 1 }}>&#8627;</span>
                      <span>Refined from Step {refinedFrom + 1}</span>
                    </div>
                  )}
                  <ToolCallCard
                    stepNumber={globalIdx + 1}
                    name={tool.name}
                    args={tool.args}
                    resultSummary={tool.resultSummary}
                    duration_ms={tool.duration_ms}
                    operationType={tool.operationType}
                    reason={tool.reason}
                  />
                  {annotation && (
                    <div
                      style={{
                        fontSize: '11px',
                        fontStyle: 'italic',
                        color: 'var(--text-muted)',
                        paddingLeft: '12px',
                        lineHeight: '1.4',
                      }}
                    >
                      {annotation}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Toggle link */}
      {toolsCalled.length > 1 && (
        <button
          onClick={() => {
            setShowAll(!showAll);
            setActiveIndex(null);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
            alignSelf: 'flex-start',
          }}
        >
          {showAll ? 'Hide steps' : 'Show all steps'}
        </button>
      )}

      <NarrationExplainer />
    </div>
  );
}

export default function ProgressLog({
  groups,
  standaloneEntries,
  variant,
  isActive,
  isComplete,
  toolsCalled,
  totalDuration_ms,
}: ProgressLogProps) {
  // Completed mode: show narrative + breadcrumbs + detail
  if (isComplete && toolsCalled && toolsCalled.length > 0) {
    return (
      <CompletedSummary
        toolsCalled={toolsCalled}
        totalDuration_ms={totalDuration_ms}
        groups={groups}
      />
    );
  }

  // Streaming mode: existing view
  const analyzeEntries = standaloneEntries.filter(e => e.phase === 'analyze' || (!e.phase && !e.iteration));
  const synthesizeEntries = standaloneEntries.filter(e => e.phase === 'synthesize');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Analyze / pre-group entries */}
      {analyzeEntries.map((entry, idx) => (
        <StandaloneEntry
          key={`a-${idx}`}
          entry={entry}
          variant={variant}
          annotation={idx === 0 ? getEducationalAnnotation('analyze') : null}
          isActive={isActive}
        />
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
        <StandaloneEntry
          key={`s-${idx}`}
          entry={entry}
          variant={variant}
          annotation={idx === 0 ? getEducationalAnnotation('synthesize') : null}
          isActive={isActive}
        />
      ))}
    </div>
  );
}
