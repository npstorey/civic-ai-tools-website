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
 *
 * #112: this wrapper also owns the PUBLISH affordance for executed-notebook
 * sessions — the entry point ChatNotebookOutput (view-only) lacked. When the
 * stream delivered the publish inputs (`publish_inputs` SSE event: trace,
 * token usage, answer), a signed-in user can publish the EXECUTED session
 * through the same PublishEvidenceDialog the chat flow uses; the dialog
 * carries the executed notebook verbatim instead of regenerating a skeleton.
 */
import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import ChatNotebookOutput from './ChatNotebookOutput';
import NotebookProgress from './NotebookProgress';
import PublishEvidenceDialog from '@/components/PublishEvidenceDialog';
import { useSignInOptions } from '@/components/SignInOptionsProvider';
import { resolveSignInAffordance } from '@/lib/auth-provider-options';
import { SUMMARY_EXTENSION_KEY } from '@/lib/notebook-author/prompt';
import type { NotebookStreamState } from '@/hooks/useNotebookStream';
import type { Notebook } from '@/lib/notebook-author/cells';

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

/** Read the notebook's structured two-clause summary (Phase 2a2 item 3) as a
 *  publish-dialog prefill. Returns undefined when absent (the dialog then
 *  falls back to its LLM-generated summary). */
function structuredSummaryText(notebook: Notebook): string | undefined {
  const extensions = notebook.metadata?.extensions as Record<string, unknown> | undefined;
  const summary = extensions?.[SUMMARY_EXTENSION_KEY] as Record<string, unknown> | undefined;
  const desc = summary?.analysisDescription;
  const finding = summary?.headlineFinding;
  if (typeof desc !== 'string' || typeof finding !== 'string') return undefined;
  return `${desc.trim()} ${finding.trim()}`;
}

export default function NotebookOutput({ state, prompt, model, portal, onRetry }: NotebookOutputProps) {
  const { data: session } = useSession();
  // #229 P1: same treatment as the chat flow's publish button — the
  // signed-out branch starts whatever provider this instance configured.
  // (This surface has no split-topology branch of its own; it only renders
  // under `/ask` and the dev preview, both app-private.)
  const signInAffordance = resolveSignInAffordance(useSignInOptions());
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);

  // Publishable iff the pipeline completed AND the publish inputs arrived
  // (trace + answer via the `publish_inputs` event). Older cached streams /
  // fixtures without the event simply don't show the button.
  const canPublish =
    !!state.notebook && !state.isLoading && !!state.answerContent && !!state.evidenceTrace;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {state.error && (
        <div
          role="alert"
          style={{
            border: '1px solid var(--error, #ec131e)',
            background: 'rgba(236, 19, 30, 0.06)',
            color: 'var(--error, #ec131e)',
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
        <>
          <ChatNotebookOutput
            notebook={state.notebook}
            prompt={prompt}
            model={model}
            portal={portal}
            toolCalls={state.toolCalls}
            composedSystemPrompt={state.composedSystemPrompt}
            composedSystemPromptHash={state.composedSystemPromptHash}
            signingKeyId={state.signingKeyId}
          />

          {/* #112 publish affordance — mirrors the chat flow's entry point. */}
          {canPublish && (
            <div
              style={{
                maxWidth: '900px',
                margin: '0 auto',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
                paddingTop: '8px',
                borderTop: '1px solid var(--border-color)',
              }}
            >
              {!session?.user && signInAffordance.kind === 'panel' ? (
                /* More than one provider: defer to the panel that lists them. */
                <a
                  href={signInAffordance.href}
                  style={{
                    background: 'none',
                    border: '1px solid var(--accent)',
                    borderRadius: '4px',
                    padding: '6px 14px',
                    fontSize: '13px',
                    color: 'var(--accent)',
                    cursor: 'pointer',
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  Sign in to publish
                </a>
              ) : !session?.user && signInAffordance.kind === 'none' ? null : (
              <button
                onClick={() => {
                  if (!session?.user && signInAffordance.kind === 'provider') {
                    // NextAuth v4 OAuth providers need a full redirect; the
                    // user signs in, then re-runs the query (same caveat as
                    // the chat flow's publish button).
                    signIn(signInAffordance.option.id);
                  } else {
                    setPublishDialogOpen(true);
                  }
                }}
                style={{
                  background: 'none',
                  border: '1px solid var(--accent)',
                  borderRadius: '4px',
                  padding: '6px 14px',
                  fontSize: '13px',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                {session?.user ? 'Publish as Evidence' : 'Sign in to publish'}
              </button>
              )}
              {(session?.user || signInAffordance.kind !== 'none') && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {session?.user
                  ? 'Publishes the executed notebook and its execution record — not a regenerated skeleton.'
                  : 'Sign in first, then re-run your query.'}
              </span>
              )}
            </div>
          )}

          {publishDialogOpen && canPublish && (
            <PublishEvidenceDialog
              isOpen={publishDialogOpen}
              onClose={() => setPublishDialogOpen(false)}
              queryText={prompt}
              output={state.answerContent!}
              toolCalls={state.toolCalls.map((tc) => ({
                name: tc.name,
                args: tc.args ?? {},
                resultSummary: tc.resultSummary,
                duration_ms: tc.duration_ms,
                operationType: tc.operationType,
                reason: tc.reason,
              }))}
              evidenceTrace={state.evidenceTrace!}
              model={model}
              portal={portal}
              promptTokens={state.tokenUsage?.promptTokens}
              completionTokens={state.tokenUsage?.completionTokens}
              duration_ms={state.pipelineDurationMs ?? undefined}
              executedNotebook={state.notebook}
              initialSummary={structuredSummaryText(state.notebook)}
            />
          )}
        </>
      )}
    </div>
  );
}
