'use client';

import { useState, useCallback, useSyncExternalStore } from 'react';
import ResponsePanel from './ResponsePanel';

import type { ProgressLogEntry, ProgressGroup, EvidenceTrace } from '@/hooks/useStreamingComparison';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface ResponseData {
  content: string;
  duration_ms: number;
  tokens_used: number;
  tools_called?: ToolCall[];
}

interface StreamingPanelState {
  content: string;
  progress: string | null;
  progressLog: ProgressLogEntry[];
  progressGroups: ProgressGroup[];
  isComplete: boolean;
  duration_ms?: number;
  tokens_used?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  token_limit_exceeded?: boolean;
  tools_called?: ToolCall[];
  error?: string;
}

interface ComparisonDisplayProps {
  withoutMcp: ResponseData | null;
  withMcp: ResponseData | null;
  isLoading: boolean;
  modelName?: string;
  // Streaming props
  isStreaming?: boolean;
  streamingWithoutMcp?: StreamingPanelState;
  streamingWithMcp?: StreamingPanelState;
  queryText?: string;
  portal?: string;
  model?: string;
  evidenceTrace?: EvidenceTrace | null;
  publishDialogOpen?: boolean;
  onPublishDialogChange?: (open: boolean) => void;
  onContinue?: (continuationPrompt: string) => void;
  /**
   * Answer-first presentation (s6 P2, #229): the with-data answer is the
   * page and the side-by-side comparison is demoted to an expand option —
   * the same demotion the mobile layout has always applied, promoted to
   * every width. Set for runs that skipped the without-data arm, so the
   * demoted element offers to run the comparison rather than previewing a
   * panel that never streamed. Default false: today's layout, unchanged.
   */
  answerFirst?: boolean;
  /**
   * Called when the reader expands the demoted comparison. The surface
   * restores the side-by-side presentation for the session and re-runs the
   * question with both arms.
   */
  onRunComparison?: () => void;
}

function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export default function ComparisonDisplay({
  withoutMcp,
  withMcp,
  isLoading,
  modelName = 'LLM',
  isStreaming,
  streamingWithoutMcp,
  streamingWithMcp,
  queryText,
  portal,
  model,
  evidenceTrace,
  publishDialogOpen,
  onPublishDialogChange,
  onContinue,
  answerFirst = false,
  onRunComparison,
}: ComparisonDisplayProps) {
  const isMobile = useMediaQuery('(max-width: 640px)');
  const [nonMcpExpanded, setNonMcpExpanded] = useState(false);

  // Use streaming data if available, otherwise fall back to static data
  const withoutMcpContent = isStreaming && streamingWithoutMcp
    ? streamingWithoutMcp.content
    : withoutMcp?.content || '';
  const withMcpContent = isStreaming && streamingWithMcp
    ? streamingWithMcp.content
    : withMcp?.content || '';

  const withMcpPanel = (
    <ResponsePanel
      title="With Data Tools"
      subtitle={
        <>
          {modelName} + live civic data via{' '}
          <span data-tooltip="Model Context Protocol — a standard for connecting AI to external tools" style={{ cursor: 'help', position: 'relative', borderBottom: '1px dotted var(--text-muted)' }}>
            MCP
          </span>
        </>
      }
      content={withMcpContent}
      duration_ms={isStreaming ? streamingWithMcp?.duration_ms : withMcp?.duration_ms}
      tokens_used={isStreaming ? streamingWithMcp?.tokens_used : withMcp?.tokens_used}
      prompt_tokens={isStreaming ? streamingWithMcp?.prompt_tokens : undefined}
      completion_tokens={isStreaming ? streamingWithMcp?.completion_tokens : undefined}
      token_limit_exceeded={isStreaming ? streamingWithMcp?.token_limit_exceeded : undefined}
      tools_called={isStreaming ? streamingWithMcp?.tools_called : withMcp?.tools_called}
      isLoading={isLoading && !isStreaming}
      variant="with-mcp"
      error={isStreaming ? streamingWithMcp?.error : undefined}
      isStreaming={isStreaming}
      progressLog={streamingWithMcp?.progressLog}
      progressGroups={streamingWithMcp?.progressGroups}
      queryText={queryText}
      portal={portal}
      model={model}
      evidenceTrace={evidenceTrace}
      publishDialogOpen={publishDialogOpen}
      onPublishDialogChange={onPublishDialogChange}
      onContinue={onContinue}
    />
  );

  const withoutMcpPanel = (
    <ResponsePanel
      title="Without Data Tools"
      subtitle={`${modelName} using only training data`}
      content={withoutMcpContent}
      duration_ms={isStreaming ? streamingWithoutMcp?.duration_ms : withoutMcp?.duration_ms}
      tokens_used={isStreaming ? streamingWithoutMcp?.tokens_used : withoutMcp?.tokens_used}
      isLoading={isLoading && !isStreaming}
      variant="without-mcp"
      error={isStreaming ? streamingWithoutMcp?.error : undefined}
      isStreaming={isStreaming}
      progressLog={streamingWithoutMcp?.progressLog}
      progressGroups={streamingWithoutMcp?.progressGroups}
    />
  );

  // Strip markdown formatting for plain-text preview
  const previewText = withoutMcpContent
    .replace(/[#*_`\[\]>]/g, '')
    .replace(/\n+/g, ' ')
    .slice(0, 200);

  // Mobile collapsed view for Without MCP panel
  const collapsedWithoutMcp = (
    <div
      style={{
        border: '2px solid var(--border-color)',
        borderRadius: '4px',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
      onClick={() => setNonMcpExpanded(true)}
    >
      <div
        style={{
          padding: '16px 24px',
          backgroundColor: 'var(--card-background)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
        }}
      >
        <span
          style={{
            color: 'var(--text-muted)',
            fontSize: '14px',
            lineHeight: '24px',
            flexShrink: 0,
          }}
        >
          &#9654;
        </span>
        <div>
          <h3
            style={{
              fontSize: '20px',
              fontWeight: 600,
              margin: 0,
              color: 'var(--text-primary)',
            }}
          >
            Without Data Tools
          </h3>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-muted)',
              margin: '4px 0 0 0',
            }}
          >
            {modelName} using only training data
          </p>
        </div>
      </div>
      {previewText && (
        <div
          style={{
            position: 'relative',
            maxHeight: '60px',
            overflow: 'hidden',
            padding: '0 24px 16px 50px',
          }}
        >
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              margin: 0,
              lineHeight: '1.5',
            }}
          >
            {previewText}
          </p>
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '50px',
              background: 'linear-gradient(transparent, var(--card-background))',
            }}
          />
        </div>
      )}
    </div>
  );

  // Mobile expanded view: full panel with a collapse button
  const expandedWithoutMcp = (
    <div style={{ position: 'relative' }}>
      {withoutMcpPanel}
      <button
        onClick={() => setNonMcpExpanded(false)}
        aria-label="Collapse panel"
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: '14px',
          padding: '4px 8px',
          zIndex: 1,
        }}
      >
        &#9660;
      </button>
    </div>
  );

  // Answer-first (s6 P2): the demoted element keeps the page's dominant
  // split — AI alone vs AI with civic data — discoverable without running
  // both arms up front. Visually it is the mobile collapsed panel; because
  // the without-data arm was skipped, activating it runs the comparison
  // (restoring the side-by-side presentation for the session) instead of
  // expanding content that does not exist.
  const runComparisonAffordance = (
    <button
      type="button"
      onClick={onRunComparison}
      disabled={isLoading || !onRunComparison}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        border: '2px solid var(--border-color)',
        borderRadius: '4px',
        cursor: isLoading || !onRunComparison ? 'not-allowed' : 'pointer',
        overflow: 'hidden',
        padding: 0,
        background: 'none',
        font: 'inherit',
      }}
    >
      <div
        style={{
          padding: '16px 24px',
          backgroundColor: 'var(--card-background)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
        }}
      >
        <span
          style={{
            color: 'var(--text-muted)',
            fontSize: '14px',
            lineHeight: '24px',
            flexShrink: 0,
          }}
        >
          &#9654;
        </span>
        <div>
          <h3
            style={{
              fontSize: '20px',
              fontWeight: 600,
              margin: 0,
              color: 'var(--text-primary)',
            }}
          >
            Without Data Tools
          </h3>
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-muted)',
              margin: '4px 0 0 0',
            }}
          >
            Run the side-by-side comparison — ask this question again with and
            without data tools to see the difference.
          </p>
        </div>
      </div>
    </button>
  );

  if (answerFirst) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '24px',
        }}
      >
        {withMcpPanel}
        {runComparisonAffordance}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '24px',
      }}
    >
      {isMobile ? (
        <>
          {withMcpPanel}
          {nonMcpExpanded ? expandedWithoutMcp : collapsedWithoutMcp}
        </>
      ) : (
        <>
          {withoutMcpPanel}
          {withMcpPanel}
        </>
      )}
    </div>
  );
}
