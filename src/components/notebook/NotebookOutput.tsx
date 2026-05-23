'use client';

/**
 * Phase 2a wrapper — picks the right surface based on stream state:
 *   - error (shown alongside any partial state),
 *   - in-progress → multi-stage NotebookProgress,
 *   - completed → NotebookRenderer with the executed notebook.
 *
 * Consumers pass the state object from `useNotebookStream`. The reason this
 * wrapper exists (vs. inlining the branching on the home page) is to keep
 * the dev preview route a simple consumer too — it stubs the hook output
 * with a fixture and reuses the same picker.
 */
import type { NotebookStreamState } from '@/hooks/useNotebookStream';
import NotebookProgress from './NotebookProgress';
import NotebookRenderer from './NotebookRenderer';

interface NotebookOutputProps {
  state: NotebookStreamState;
  /** Optional refresh — if the request errored, the page can offer a retry. */
  onRetry?: () => void;
}

export default function NotebookOutput({ state, onRetry }: NotebookOutputProps) {
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
        <NotebookRenderer notebook={state.notebook} validation={state.validation ?? undefined} />
      )}
    </div>
  );
}
