'use client';

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ProgressLog from '@/components/ProgressLog';
import SkillPromptDisclosure from '@/components/SkillPromptDisclosure';
import { buildProvenanceLine, buildNarrativeSummary, buildStatsSummary, getPortalCity } from '@/lib/streaming';
import { generateNotebook, downloadNotebook } from '@/lib/notebook';
import type { ProgressLogEntry, ProgressGroup, ToolCall } from '@/hooks/useStreamingComparison';

interface McpResponseDisplayProps {
  content: string;
  queryText?: string;
  progressLog?: ProgressLogEntry[];
  progressGroups?: ProgressGroup[];
  toolsCalled?: ToolCall[];
  duration_ms?: number;
  tokens_used?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  token_limit_exceeded?: boolean;
  isComplete?: boolean;
  isActive?: boolean;
  showFooter?: boolean;
  autoScroll?: boolean;
  portal?: string;
  onContinue?: (continuationPrompt: string) => void;
}

// Segment colors: warm family (LLM) + cool (API) — Gestalt similarity groups "thinking" vs "waiting"
const COLOR_PLANNING = '#CC3311';   // deep red-orange
const COLOR_SYNTHESIS = '#EE7733'; // medium orange
const COLOR_API = '#0077BB';       // cool blue

function TimingFooter({
  tools, totalDuration, tokens_used, prompt_tokens, completion_tokens, token_limit_exceeded,
}: {
  tools: ToolCall[];
  totalDuration: number;
  tokens_used?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  token_limit_exceeded?: boolean;
}) {
  const [activeSegment, setActiveSegment] = useState<string | null>(null);

  const apiMs = tools.reduce((sum, t) => sum + (t.duration_ms || 0), 0);
  const llmMs = Math.max(0, totalDuration - apiMs);
  const planningMs = Math.round(llmMs * 0.4);
  const synthesisMs = llmMs - planningMs;

  const llmPct = Math.round((llmMs / totalDuration) * 100);
  const apiPct = 100 - llmPct;

  const segments = [
    { key: 'planning', label: 'Planning', ms: planningMs, color: COLOR_PLANNING },
    { key: 'synthesis', label: 'Synthesis', ms: synthesisMs, color: COLOR_SYNTHESIS },
    { key: 'api', label: 'Data', ms: apiMs, color: COLOR_API },
  ];

  // Build flat array of bar elements (segments + group gap)
  const barElements: React.ReactNode[] = [];
  for (const seg of segments) {
    if (seg.key === 'api') {
      barElements.push(
        <div key="group-gap" style={{ flex: '0 0 3px', background: 'transparent' }} />
      );
    }
    barElements.push(
      <div
        key={seg.key}
        tabIndex={0}
        aria-label={`${seg.label}: ${(seg.ms / 1000).toFixed(1)} seconds`}
        className="timing-segment"
        style={{
          flexGrow: activeSegment === seg.key ? seg.ms * 1.8 : seg.ms,
          flexShrink: 0,
          flexBasis: 0,
          backgroundColor: seg.color,
          filter: activeSegment === seg.key ? 'brightness(1.1)' : undefined,
          transition: 'flex-grow 0.2s ease, filter 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: 'default',
          position: 'relative',
          minWidth: seg.ms > 0 ? '2px' : 0,
        }}
        onMouseEnter={() => setActiveSegment(seg.key)}
        onMouseLeave={() => setActiveSegment(null)}
        onFocus={() => setActiveSegment(seg.key)}
        onBlur={() => setActiveSegment(null)}
        onClick={() => setActiveSegment(prev => prev === seg.key ? null : seg.key)}
      >
        <span className="segment-label" style={{
          fontSize: '11px',
          fontWeight: 500,
          color: 'white',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          padding: '0 6px',
        }}>
          {seg.label} {(seg.ms / 1000).toFixed(1)}s
        </span>

        {/* Mobile tooltip — shown on tap via CSS */}
        {activeSegment === seg.key && (
          <div className="segment-tooltip" style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#333',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            marginBottom: '4px',
            pointerEvents: 'none',
          }}>
            {seg.label} {(seg.ms / 1000).toFixed(1)}s
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={`Performance breakdown: completed in ${(totalDuration / 1000).toFixed(1)} seconds`}
      style={{ marginBottom: '12px' }}
    >
      {/* Row 1: Summary headline */}
      <div style={{ fontSize: '13px', color: '#444', marginBottom: '8px' }}>
        Completed in{' '}
        <span style={{ fontWeight: 600 }}>{(totalDuration / 1000).toFixed(1)}s</span>
        {' \u2014 '}
        AI thinking{' '}
        <span style={{ fontWeight: 600 }}>{llmPct}%</span>
        {' \u00b7 '}
        Data retrieval{' '}
        <span style={{ fontWeight: 600 }}>{apiPct}%</span>
      </div>

      {/* Row 2: Single segmented bar */}
      <div
        role="img"
        aria-label={`Planning ${(planningMs / 1000).toFixed(1)}s, Synthesis ${(synthesisMs / 1000).toFixed(1)}s, Data retrieval ${(apiMs / 1000).toFixed(1)}s`}
        className="timing-bar"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          height: '28px',
          gap: '1px',
          backgroundColor: 'white',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        {barElements}
      </div>

      {/* Row 3: Group labels */}
      <div style={{ display: 'flex', marginTop: '4px' }}>
        <div style={{
          flexGrow: planningMs + synthesisMs,
          flexShrink: 0,
          flexBasis: 0,
          fontSize: '11px',
          color: '#666',
        }}>
          AI thinking
        </div>
        <div style={{ flex: '0 0 4px' }} />
        <div style={{
          flexGrow: apiMs,
          flexShrink: 0,
          flexBasis: 0,
          fontSize: '11px',
          color: '#666',
          textAlign: 'left',
        }}>
          Data retrieval
        </div>
      </div>

      {/* Token line */}
      {tokens_used && (
        <div style={{ fontSize: '11px', color: '#666', marginTop: '6px' }}>
          Tokens:{' '}
          {prompt_tokens && completion_tokens ? (
            <>{prompt_tokens.toLocaleString()} in{' \u00b7 '}{completion_tokens.toLocaleString()} out{' \u00b7 '}{tokens_used.toLocaleString()} total</>
          ) : (
            <>{tokens_used.toLocaleString()} total</>
          )}
          {token_limit_exceeded && (
            <span style={{ color: 'var(--nyc-caution)', marginLeft: '6px' }}>(limit reached)</span>
          )}
        </div>
      )}

      <style jsx>{`
        .timing-segment:focus-visible {
          outline: 2px solid #005fcc;
          outline-offset: -2px;
        }
        .segment-tooltip {
          display: none;
        }
        @media (max-width: 400px) {
          .timing-bar {
            height: 32px !important;
          }
          .segment-label {
            display: none !important;
          }
          .segment-tooltip {
            display: block !important;
          }
        }
      `}</style>
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

// Detect if the AI's response appears incomplete or budget-exhausted
function detectIncompleteResponse(content: string): boolean {
  if (!content || content.length < 50) return false;

  // Check for phrases indicating the AI couldn't finish
  const incompletePatterns = [
    /i couldn'?t complete/i,
    /ran out of/i,
    /if you'?d like me to continue/i,
    /let me know how you would like to proceed/i,
    /would you like me to\b/i,
    /i was(n'?t| not) able to finish/i,
    /due to (?:token |tool[ -]?call )?limits?/i,
    /budget (?:was )?(?:exceeded|exhausted|reached)/i,
  ];

  for (const pattern of incompletePatterns) {
    if (pattern.test(content)) return true;
  }

  // Check if response ends mid-sentence (last paragraph doesn't end with terminal punctuation)
  const trimmed = content.trimEnd();
  const paragraphs = trimmed.split(/\n\n+/);
  const lastParagraph = paragraphs[paragraphs.length - 1].trim();
  if (lastParagraph.length > 20 && !/[.!?:)\]"'`*]$/.test(lastParagraph)) {
    return true;
  }

  return false;
}

export default function McpResponseDisplay({
  content,
  queryText,
  progressLog = [],
  progressGroups = [],
  toolsCalled = [],
  duration_ms,
  tokens_used,
  prompt_tokens,
  completion_tokens,
  token_limit_exceeded,
  isComplete,
  isActive,
  showFooter,
  autoScroll,
  portal,
  onContinue,
}: McpResponseDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const hasGroups = progressGroups.length > 0;
  const hasProgressLog = progressLog.length > 0;
  const showActiveProgress = (hasProgressLog || hasGroups) && !content;
  const showContent = !!content;

  // Detect heuristic incompleteness (only when explicit token_limit_exceeded banner won't show)
  const showIncompleteBanner = isComplete && !!content && !token_limit_exceeded && detectIncompleteResponse(content);

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

            {/* Heuristic incomplete-response banner */}
            {showIncompleteBanner && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '10px 14px',
                  backgroundColor: 'rgba(230, 168, 23, 0.08)',
                  borderLeft: '3px solid #e6a817',
                  borderRadius: '0 4px 4px 0',
                  fontSize: '14px',
                  color: '#6b5900',
                  lineHeight: '1.5',
                }}
              >
                Analysis may be incomplete. This demo has token and tool-call limits that can cut short complex queries. For the full analysis with no limits,{' '}
                <a
                  href="https://github.com/npstorey/civic-ai-tools"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#6b5900', textDecoration: 'underline', textUnderlineOffset: '2px' }}
                >
                  run locally
                </a>{' '}
                with Claude Code or Cursor.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Truncation warning banner */}
      {token_limit_exceeded && isComplete && content && (
        <div
          style={{
            flexShrink: 0,
            borderTop: '1px solid #e6a817',
            padding: '12px 24px',
            backgroundColor: 'rgba(230, 168, 23, 0.08)',
          }}
        >
          <div style={{ fontSize: '13px', color: '#8a6d00', marginBottom: '8px' }}>
            This response was cut short due to token limits.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
            {onContinue && (
              <button
                onClick={() => {
                  const narrative = buildNarrativeSummary(toolsCalled);
                  const prompt = [
                    'Continue the analysis below. Do NOT re-query the data \u2014 synthesize from the results already described.',
                    '',
                    `Original query: ${queryText}`,
                    '',
                    `Data collected:`,
                    narrative,
                    '',
                    'Partial response so far:',
                    content,
                    '',
                    'Please continue from where the previous response was cut short.',
                  ].join('\n');
                  onContinue(prompt);
                }}
                style={{
                  background: 'none',
                  border: '1px solid #c89b00',
                  borderRadius: '4px',
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#8a6d00',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s',
                }}
                onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'rgba(230, 168, 23, 0.12)'; }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                Continue this analysis
              </button>
            )}
            <a
              href="/learn#try-it"
              style={{
                fontSize: '12px',
                color: '#8a6d00',
                textDecoration: 'underline',
                textUnderlineOffset: '2px',
              }}
            >
              Try this locally (no limits)
            </a>
          </div>
        </div>
      )}

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
            <TimingFooter
              tools={toolsCalled}
              totalDuration={duration_ms}
              tokens_used={tokens_used}
              prompt_tokens={prompt_tokens}
              completion_tokens={completion_tokens}
              token_limit_exceeded={token_limit_exceeded}
            />
          )}

          {/* Summary line with copy button */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '16px',
              fontSize: '14px',
              color: 'var(--text-muted)',
            }}
          >
            {!(toolsCalled.length > 0 && duration_ms) && duration_ms && (
              <span>
                <strong>Time:</strong> {(duration_ms / 1000).toFixed(2)}s
              </span>
            )}
            {!(toolsCalled.length > 0 && duration_ms) && tokens_used && (
              <span>
                <strong>Tokens:</strong> {tokens_used.toLocaleString()}
                {token_limit_exceeded && (
                  <span style={{ color: 'var(--nyc-caution)', marginLeft: '6px' }}>
                    (limit reached)
                  </span>
                )}
              </span>
            )}

            {/* Copy button */}
            {content && (
              <button
                onClick={async () => {
                  const parts: string[] = [];
                  // Header: query and portal(s)
                  if (queryText) parts.push(`**Query:** ${queryText}`);
                  const copyPortals = [...new Set(
                    toolsCalled.map(t => t.args.portal as string).filter(Boolean)
                  )];
                  if (copyPortals.length === 1) {
                    parts.push(`**Portal:** ${getPortalCity(copyPortals[0])}`);
                  } else if (copyPortals.length > 1) {
                    parts.push(`**Portals:** ${copyPortals.map(p => getPortalCity(p)).join(', ')}`);
                  }
                  // Context: narrative and stats
                  if (toolsCalled.length > 0) {
                    const narrative = buildNarrativeSummary(toolsCalled);
                    if (narrative) parts.push(narrative);
                    const stats = buildStatsSummary(toolsCalled, duration_ms);
                    if (stats) parts.push(stats);
                  }
                  if (parts.length > 0) parts.push('---');
                  parts.push(content);
                  // Attribution
                  parts.push(`\n_Generated via civicaitools.org \u00b7 ${new Date().toLocaleDateString()}_`);
                  await navigator.clipboard.writeText(parts.join('\n\n'));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                style={{
                  marginLeft: 'auto',
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  color: copied ? 'var(--nyc-success)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'color 0.15s, border-color 0.15s',
                }}
              >
                {copied ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
                      <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
            )}

            {/* Download notebook button */}
            {content && toolsCalled.some(t => t.operationType === 'query') && (
              <button
                onClick={() => {
                  const p = (toolsCalled.find(t => t.args.portal)?.args.portal as string) || portal || 'data.cityofnewyork.us';
                  const notebook = generateNotebook(queryText || '', p, toolsCalled, content);
                  downloadNotebook(notebook);
                }}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'color 0.15s, border-color 0.15s',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z" />
                  <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z" />
                </svg>
                Notebook
              </button>
            )}
          </div>

          {toolsCalled.length > 0 && (
            <SkillPromptDisclosure />
          )}
        </div>
      )}

      {/* AI accuracy disclaimer */}
      {isComplete && content && (
        <div
          style={{
            flexShrink: 0,
            padding: '8px 24px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            lineHeight: '1.5',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          AI-generated analysis may contain errors. Verify findings against the{' '}
          original dataset before citing.{' '}
          <a
            href="/learn#ai-limitations"
            style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}
          >
            Learn more &rarr;
          </a>
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
