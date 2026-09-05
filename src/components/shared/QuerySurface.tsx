'use client';

/**
 * The query surface: the ask-a-question form plus everything it produces.
 *
 * Owns the two streaming hooks (`useStreamingComparison` for the side-by-side
 * comparison, `useNotebookStream` for the executed-notebook mode), the
 * last-submitted query context those results need, and the scroll-to-results
 * behaviour. Mounted on the apex demo page today; extracted so the same
 * surface can be mounted elsewhere without duplicating the wiring.
 *
 * `children` renders inside the form's narrow container, above the form —
 * the slot each mount uses for its own framing copy. Everything that is
 * purely framing (hero copy, calls to action, positioning) stays with the
 * page; only the form and its outputs live here.
 */

import { useState, useRef } from 'react';
import QueryForm from '@/components/QueryForm';
import { useDefaultPortalArg } from '@/components/DefaultPortalProvider';
import ComparisonDisplay from '@/components/ComparisonDisplay';
import NotebookOutput from '@/components/notebook/NotebookOutput';
import { useStreamingComparison } from '@/hooks/useStreamingComparison';
import { useNotebookStream } from '@/hooks/useNotebookStream';
import { useSessionChoice } from '@/hooks/useSessionChoice';
import {
  COMPARISON_STORAGE_KEY,
  isComparisonRunComplete,
  parseStoredComparison,
  shouldRunMcpOnly,
  type QueryMode,
  type QuerySurfacePresentation,
} from '@/lib/query-presentation';

interface QuerySurfaceProps {
  /** Framing content rendered above the form, inside its container. */
  children?: React.ReactNode;
  /**
   * Whether to close a completed comparison with the footnote suggesting the
   * reader run the tools locally for complex multi-step analysis.
   *
   * Default `true` — the apex demo's existing behavior, unchanged and
   * unconfigured (the marketing page passes nothing). The signed-in `(app)`
   * mount passes `false`: there, the footnote would send a user who just
   * signed in to the surface built for exactly this work somewhere else to
   * do it, and the limit it implicitly apologizes for is the app tier, not
   * the demo's. On the apex the footnote is honest — that surface IS the
   * rate-limited demo, and pointing past it is the point.
   */
  showLocalSetupFootnote?: boolean;
  /**
   * How this mount presents the standard-mode result (s6 P2, #229; Q62 G0).
   *
   * Default `'comparison'` — the apex demo's side-by-side, unchanged and
   * unconfigured (the marketing page passes nothing; the default is applied
   * here, inside the client component, so nothing about it serializes into
   * that mount's payload). `/ask` passes `'answer-first'`: the with-data
   * answer is primary, the comparison is demoted to an expand option, and
   * demoted runs make one model call instead of two. The visitor can
   * restore the comparison per session — via the demoted element under the
   * answer or the Advanced-options toggle — after which both arms run and
   * render exactly as on the apex.
   */
  presentation?: QuerySurfacePresentation;
  /**
   * The response mode the form starts in when the visitor has made no
   * explicit choice. Default `'standard'` — every existing mount's
   * behavior; `/ask` passes `'notebook'` (Q62 G0). An explicit mode choice
   * is session-sticky and wins over this default.
   */
  defaultMode?: QueryMode;
}

export default function QuerySurface({
  children,
  showLocalSetupFootnote = true,
  presentation = 'comparison',
  defaultMode = 'standard',
}: QuerySurfaceProps) {
  const [queryCount, setQueryCount] = useState(0);
  const [usedModel, setUsedModel] = useState<string>('');
  const [lastQuery, setLastQuery] = useState<string>('');
  const [lastPortal, setLastPortal] = useState<string>('');
  const [lastMode, setLastMode] = useState<QueryMode>('standard');
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const streaming = useStreamingComparison();
  const notebook = useNotebookStream();
  // This instance's configured default portal as a wire value, or '' when it
  // declared none (#407) — server-resolved, threaded through the root layout.
  const defaultPortal = useDefaultPortalArg();

  // Answer-first configuration (s6 P2, #229). The restore choice is
  // session-sticky through the same mechanism as the response mode; it only
  // means anything on an answer-first mount — the apex neither reads it into
  // behavior (shouldRunMcpOnly is constant-false for 'comparison') nor
  // renders the toggle that writes it.
  const answerFirstConfigured = presentation === 'answer-first';
  const [comparisonChoice, setComparisonChoice] = useSessionChoice(
    COMPARISON_STORAGE_KEY,
    parseStoredComparison,
  );
  const comparisonRestored = comparisonChoice === 'on';
  // Presentation follows the run, not the toggle: flipping the toggle
  // mid-result must not reshape an already-rendered answer (a restored
  // comparison has nothing to show for a run whose without-data arm never
  // executed). The next submit picks the toggle up.
  const answerFirstActive = answerFirstConfigured && streaming.mcpOnly;

  // Extract display name from model ID (e.g., "anthropic/claude-sonnet-4" -> "Claude Sonnet 4")
  const getModelDisplayName = (modelId: string) => {
    const name = modelId.split('/')[1] || modelId;
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const handleSubmit = async (query: string, model: string, portal: string, mode: QueryMode) => {
    // The form's selection, else this instance's configured default, else
    // NONE (#407). '' is the wire's "no portal" — the id of the form's "All
    // portals" entry — and it is what the routes read as absent. It used to
    // be a literal here, so choosing "All portals" silently ran against one
    // deployment's city and every surface downstream said so.
    const effectivePortal = portal || defaultPortal;
    setUsedModel(model);
    setLastQuery(query);
    setLastPortal(effectivePortal);
    setLastMode(mode);

    // Scroll to results after a brief delay to let the loading state render
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    if (mode === 'notebook') {
      streaming.abort();
      notebook.start(query, model, effectivePortal);
    } else {
      notebook.reset();
      streaming.startComparison(query, model, effectivePortal, {
        mcpOnly: shouldRunMcpOnly(presentation, comparisonRestored),
      });
    }
    setQueryCount((c) => c + 1);
  };

  const handleContinue = (continuationPrompt: string) => {
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    streaming.startComparison(continuationPrompt, usedModel, lastPortal, {
      mcpOnly: shouldRunMcpOnly(presentation, comparisonRestored),
    });
    setQueryCount((c) => c + 1);
  };

  // Expand option on the demoted comparison (answer-first mounts): restore
  // the side-by-side presentation for the session and re-run the question
  // with both arms — the without-data arm was skipped, so there is nothing
  // to expand without running it.
  const handleRunComparison = () => {
    if (!lastQuery) return;
    setComparisonChoice('on');
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    streaming.startComparison(lastQuery, usedModel, lastPortal, { mcpOnly: false });
    setQueryCount((c) => c + 1);
  };

  const handleNotebookRetry = () => {
    if (lastQuery) notebook.start(lastQuery, usedModel, lastPortal);
  };

  return (
    <>
      {/* Framing + Form: narrow container */}
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px 0' }}>
        {children}

        {/* Query Form */}
        <div style={{ marginBottom: '48px' }}>
          <QueryForm
            onSubmit={handleSubmit}
            isLoading={streaming.isLoading}
            queryCount={queryCount}
            defaultMode={defaultMode}
            comparisonControl={
              answerFirstConfigured
                ? {
                    restored: comparisonRestored,
                    onChange: (restored) => setComparisonChoice(restored ? 'on' : 'off'),
                  }
                : undefined
            }
          />
        </div>
      </div>

      {/* Results: wide container matching header max-w-6xl */}
      {lastMode === 'standard' && streaming.error && (
        <div className="max-w-6xl mx-auto px-6">
          <div
            style={{
              marginBottom: '32px',
              padding: '16px 24px',
              backgroundColor: 'rgba(236, 19, 30, 0.1)',
              color: 'var(--error)',
              borderRadius: '4px',
              border: '1px solid var(--error)',
            }}
          >
            {streaming.error}
          </div>
        </div>
      )}

      {lastMode === 'standard' && (streaming.isLoading || streaming.withoutMcp.content || streaming.withMcp.content ||
        streaming.withoutMcp.isComplete || streaming.withMcp.isComplete || streaming.error) && (
        <div ref={resultsRef} className="max-w-6xl mx-auto px-6" style={{ marginBottom: '24px' }}>
          <h2 style={{ marginBottom: '16px' }}>Results</h2>
          <ComparisonDisplay
            withoutMcp={null}
            withMcp={null}
            isLoading={streaming.isLoading}
            modelName={getModelDisplayName(usedModel)}
            isStreaming={true}
            streamingWithoutMcp={streaming.withoutMcp}
            streamingWithMcp={streaming.withMcp}
            queryText={lastQuery}
            portal={lastPortal}
            model={usedModel}
            evidenceTrace={streaming.evidenceTrace}
            publishDialogOpen={publishDialogOpen}
            onPublishDialogChange={setPublishDialogOpen}
            onContinue={handleContinue}
            answerFirst={answerFirstActive}
            onRunComparison={answerFirstConfigured ? handleRunComparison : undefined}
          />
          {/* The footnote closes a finished run, however many panes the run
              had — a demoted (one-pane) run is finished when its only pane
              is. On the apex (mcpOnly always false) this is exactly the old
              both-panes condition. */}
          {showLocalSetupFootnote && isComparisonRunComplete(
            streaming.mcpOnly,
            streaming.withoutMcp.isComplete,
            streaming.withMcp.isComplete,
          ) && (
            <p
              style={{
                marginTop: '16px',
                fontSize: '14px',
                color: 'var(--text-muted)',
                textAlign: 'center',
              }}
            >
              For complex multi-step analysis, try{' '}
              <a
                href="https://github.com/npstorey/civic-ai-tools"
                target="_blank"
                rel="noopener noreferrer"
              >
                civic-ai-tools
              </a>{' '}
              locally with Claude Code or Cursor.
            </p>
          )}
        </div>
      )}

      {lastMode === 'notebook' && (notebook.state.isLoading || notebook.state.notebook || notebook.state.error) && (
        <div ref={resultsRef} className="max-w-6xl mx-auto px-6" style={{ marginBottom: '24px' }}>
          <h2 style={{ marginBottom: '16px' }}>Executed-sandbox response</h2>
          <NotebookOutput
            state={notebook.state}
            prompt={lastQuery}
            model={usedModel}
            portal={lastPortal}
            onRetry={handleNotebookRetry}
          />
        </div>
      )}
    </>
  );
}
