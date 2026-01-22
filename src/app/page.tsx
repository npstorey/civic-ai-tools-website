'use client';

import { useState, useRef } from 'react';
import QueryForm from '@/components/QueryForm';
import ComparisonDisplay from '@/components/ComparisonDisplay';
import RateLimitBanner from '@/components/RateLimitBanner';
import { useStreamingComparison } from '@/hooks/useStreamingComparison';

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

interface ComparisonResult {
  withoutMcp: ResponseData;
  withMcp: ResponseData;
}

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queryCount, setQueryCount] = useState(0);
  const [usedModel, setUsedModel] = useState<string>('');
  const [isStreamingMode, setIsStreamingMode] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Streaming hook
  const streaming = useStreamingComparison();

  // Extract display name from model ID (e.g., "anthropic/claude-sonnet-4" -> "Claude Sonnet 4")
  const getModelDisplayName = (modelId: string) => {
    const name = modelId.split('/')[1] || modelId;
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const handleSubmit = async (query: string, model: string, portal: string, useStreaming: boolean) => {
    setUsedModel(model);
    setIsStreamingMode(useStreaming);

    // Scroll to results after a brief delay to let the loading state render
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    if (useStreaming) {
      // Use streaming mode
      setIsLoading(false);
      setResult(null);
      setError(null);
      streaming.startComparison(query, model, portal);
      setQueryCount((c) => c + 1); // Trigger rate limit banner refresh
    } else {
      // Use original non-streaming mode
      setIsLoading(true);
      setError(null);
      setResult(null);

      try {
        const response = await fetch('/api/compare', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, model, portal }),
        });

        const data = await response.json();

        if (!response.ok) {
          if (response.status === 429) {
            setError('Rate limit exceeded. Please try again tomorrow or sign in for more requests.');
          } else {
            setError(data.error || 'An error occurred');
          }
          return;
        }

        setResult(data);
      } catch {
        setError('Failed to connect to the server. Please try again.');
      } finally {
        setIsLoading(false);
        setQueryCount((c) => c + 1); // Trigger rate limit banner refresh
      }
    }
  };

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px 24px' }}>
      {/* Hero Section */}
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <h1 style={{ marginBottom: '8px', fontSize: '36px' }}>
          See how AI performs with open data
        </h1>
        <p
          style={{
            fontSize: '18px',
            lineHeight: '150%',
            color: 'var(--text-secondary)',
            maxWidth: '650px',
            margin: '0 auto',
          }}
        >
          Compare LLM responses with and without live data access via{' '}
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
          >
            MCP
          </a>
          —and see how model choice and tool access affect results.
        </p>
      </div>

      {/* Query Form */}
      <div
        style={{
          backgroundColor: 'var(--card-background)',
          borderRadius: '4px',
          padding: '16px',
          marginBottom: '16px',
        }}
      >
        <QueryForm onSubmit={handleSubmit} isLoading={isLoading || streaming.isLoading} />
        {/* Rate Limit - inline at bottom of form */}
        <div style={{ marginTop: '8px' }}>
          <RateLimitBanner refreshTrigger={queryCount} />
        </div>
      </div>

      {/* Error Message */}
      {(error || streaming.error) && (
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
          {error || streaming.error}
        </div>
      )}

      {/* Results */}
      {(isLoading || result || streaming.isLoading || streaming.withoutMcp.content || streaming.withMcp.content) && (
        <div ref={resultsRef} style={{ marginBottom: '24px' }}>
          <h2 style={{ marginBottom: '16px' }}>Results</h2>
          <ComparisonDisplay
            withoutMcp={result?.withoutMcp || null}
            withMcp={result?.withMcp || null}
            isLoading={isLoading || streaming.isLoading}
            modelName={getModelDisplayName(usedModel)}
            isStreaming={isStreamingMode}
            streamingWithoutMcp={streaming.withoutMcp}
            streamingWithMcp={streaming.withMcp}
          />
          {/* Hint for complex queries */}
          {(result || (streaming.withoutMcp.isComplete && streaming.withMcp.isComplete)) && (
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
                opengov-mcp
              </a>{' '}
              locally with Claude Code or Cursor.
            </p>
          )}
        </div>
      )}

      {/* CTA Section */}
      <div
        style={{
          textAlign: 'center',
          padding: '64px 24px',
          borderTop: '1px solid var(--border-color)',
        }}
      >
        <h2 style={{ marginBottom: '16px' }}>Want better results?</h2>
        <p
          style={{
            fontSize: '18px',
            color: 'var(--text-secondary)',
            marginBottom: '24px',
            maxWidth: '600px',
            margin: '0 auto 24px',
          }}
        >
          Set up civic-ai-tools locally with Claude Code, Cursor, or other MCP-compatible
          tools for unlimited access and complex multi-step analysis.
        </p>
        <a
          href="https://github.com/npstorey/civic-ai-tools"
          target="_blank"
          rel="noopener noreferrer"
          className="nyc-button nyc-button-primary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            textDecoration: 'none',
          }}
        >
          <svg style={{ width: '20px', height: '20px' }} fill="currentColor" viewBox="0 0 24 24">
            <path
              fillRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              clipRule="evenodd"
            />
          </svg>
          View on GitHub
        </a>
      </div>
    </div>
  );
}
