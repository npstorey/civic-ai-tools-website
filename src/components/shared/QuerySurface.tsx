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
import QueryForm, { type QueryMode } from '@/components/QueryForm';
import ComparisonDisplay from '@/components/ComparisonDisplay';
import NotebookOutput from '@/components/notebook/NotebookOutput';
import { useStreamingComparison } from '@/hooks/useStreamingComparison';
import { useNotebookStream } from '@/hooks/useNotebookStream';

interface QuerySurfaceProps {
  /** Framing content rendered above the form, inside its container. */
  children?: React.ReactNode;
}

export default function QuerySurface({ children }: QuerySurfaceProps) {
  const [queryCount, setQueryCount] = useState(0);
  const [usedModel, setUsedModel] = useState<string>('');
  const [lastQuery, setLastQuery] = useState<string>('');
  const [lastPortal, setLastPortal] = useState<string>('');
  const [lastMode, setLastMode] = useState<QueryMode>('standard');
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const streaming = useStreamingComparison();
  const notebook = useNotebookStream();

  // Extract display name from model ID (e.g., "anthropic/claude-sonnet-4" -> "Claude Sonnet 4")
  const getModelDisplayName = (modelId: string) => {
    const name = modelId.split('/')[1] || modelId;
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const handleSubmit = async (query: string, model: string, portal: string, mode: QueryMode) => {
    const effectivePortal = portal || 'data.cityofnewyork.us';
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
      streaming.startComparison(query, model, effectivePortal);
    }
    setQueryCount((c) => c + 1);
  };

  const handleContinue = (continuationPrompt: string) => {
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    streaming.startComparison(continuationPrompt, usedModel, lastPortal);
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
          <QueryForm onSubmit={handleSubmit} isLoading={streaming.isLoading} queryCount={queryCount} />
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
              color: 'var(--nyc-error)',
              borderRadius: '4px',
              border: '1px solid var(--nyc-error)',
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
          />
          {(streaming.withoutMcp.isComplete && streaming.withMcp.isComplete) && (
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
