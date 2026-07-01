'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import QueryForm, { type QueryMode } from '@/components/QueryForm';
import ComparisonDisplay from '@/components/ComparisonDisplay';
import NotebookOutput from '@/components/notebook/NotebookOutput';
import PositioningBand from '@/components/home/PositioningBand';
import { useStreamingComparison } from '@/hooks/useStreamingComparison';
import { useNotebookStream } from '@/hooks/useNotebookStream';

export default function Home() {
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
      {/* Hero + Form: narrow container */}
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 24px 0' }}>
        {/* Hero Section */}
        <div style={{ textAlign: 'center', marginBottom: '24px', paddingTop: '40px' }}>
          <h1 style={{ marginBottom: '8px' }}>
            Explore Open Data with AI
          </h1>
          <p
            style={{
              fontSize: '20px',
              lineHeight: '150%',
              color: 'var(--text-secondary)',
              maxWidth: '650px',
              margin: '0 auto',
            }}
          >
            See how AI answers with and without access to real datasets
          </p>
        </div>

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

      {/* CTA: narrow container */}
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 24px' }}>
        <div
          style={{
            textAlign: 'center',
            padding: '40px 24px 24px',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <h2 style={{ marginBottom: '12px', fontSize: '24px', fontWeight: 500 }}>Go deeper</h2>
          <p
            style={{
              fontSize: '15px',
              lineHeight: '170%',
              color: 'var(--text-secondary)',
              maxWidth: '650px',
              margin: '0 auto 20px',
            }}
          >
            This demo has rate limits and runs simple queries. Set up locally for
            unlimited access, more data sources, and complex multi-step analysis.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <a
              href="https://github.com/npstorey/civic-ai-tools"
              target="_blank"
              rel="noopener noreferrer"
              className="nyc-button nyc-button-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                textDecoration: 'none',
                fontSize: '14px',
                padding: '10px 24px',
              }}
            >
              <svg style={{ width: '16px', height: '16px' }} fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                  clipRule="evenodd"
                />
              </svg>
              Get Started
            </a>
            <Link
              href="/learn#try-it"
              className="nyc-button nyc-button-secondary"
              style={{ textDecoration: 'none', fontSize: '14px', padding: '10px 24px' }}
            >
              Learn how it works
            </Link>
          </div>
        </div>
      </div>

      {/* Positioning band: the demo above is the hero; this zooms out */}
      <PositioningBand />
    </>
  );
}
