'use client';

/**
 * Phase 2a1 wrapper — picks the right surface based on stream state:
 *   - error (shown alongside any partial state),
 *   - in-progress → multi-stage NotebookProgress,
 *   - completed → ChatNotebookOutput (A-G section layout matching the
 *     evidence detail page for datHere-profile packages).
 *
 * Consumers pass the state object from `useNotebookStream` plus the prompt /
 * model / portal context the renderer needs for sections A and C. The page
 * threads these from the QueryForm submit handler; the dev preview page
 * threads fixtures.
 */
import ChatNotebookOutput from './ChatNotebookOutput';
import NotebookProgress from './NotebookProgress';
import type { NotebookStreamState } from '@/hooks/useNotebookStream';

interface NotebookOutputProps {
  state: NotebookStreamState;
  /** The prompt that was submitted; surfaced in section A. */
  prompt: string;
  /** Model ID; surfaced in section C. */
  model: string;
  /** Portal (e.g., `data.cityofnewyork.us`); surfaced in section C. */
  portal: string;
  /** Optional refresh — if the request errored, the page can offer a retry. */
  onRetry?: () => void;
}

export default function NotebookOutput({ state, prompt, model, portal, onRetry }: NotebookOutputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {state.error && (
        <div
          role="alert"
          style={{
            border: '1px solid var(--nyc-error, #ec131e)',
            background: 'rgba(236, 19, 30, 0.06)',
            color: 'var(--nyc-error, #ec131e)',
            borderRadius: '4px',
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxWidth: '600px',
            margin: '0 auto',
          }}
        >
          <strong>Couldn&apos;t generate a reproducible notebook.</strong>
          <span style={{ fontSize: '13px' }}>{state.error}</span>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            You can switch back to <em>Standard</em> mode and try the same
            question, or retry below.
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="nyc-button nyc-button-secondary"
              style={{ alignSelf: 'flex-start', fontSize: '13px', padding: '6px 14px' }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {!state.notebook && (state.isLoading || state.phase) && !state.error && (
        <NotebookProgress
          phase={state.phase}
          startedAt={state.startedAt}
          phaseStartedAt={state.phaseStartedAt}
          completedAt={state.completedAt}
          detail={state.detail}
        />
      )}

      {state.notebook && (
        <ChatNotebookOutput
          notebook={state.notebook}
          prompt={prompt}
          model={model}
          portal={portal}
          toolCalls={state.toolCalls}
        />
      )}
    </div>
  );
}
