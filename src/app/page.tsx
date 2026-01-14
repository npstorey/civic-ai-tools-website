'use client';

import { useState } from 'react';
import QueryForm from '@/components/QueryForm';
import ComparisonDisplay from '@/components/ComparisonDisplay';
import RateLimitBanner from '@/components/RateLimitBanner';

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

  const handleSubmit = async (query: string, model: string, portal: string) => {
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
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold mb-4">
          See What MCP Can Do
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto">
          Compare how LLMs respond to civic data questions with and without{' '}
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Model Context Protocol (MCP)
          </a>{' '}
          providing live access to Socrata open data portals.
        </p>
      </div>

      <div className="mb-6">
        <RateLimitBanner />
      </div>

      <div className="bg-zinc-50 dark:bg-zinc-900 rounded-xl p-6 mb-8">
        <QueryForm onSubmit={handleSubmit} isLoading={isLoading} />
      </div>

      {error && (
        <div className="mb-8 p-4 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded-lg">
          {error}
        </div>
      )}

      {(isLoading || result) && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Results</h2>
          <ComparisonDisplay
            withoutMcp={result?.withoutMcp || null}
            withMcp={result?.withMcp || null}
            isLoading={isLoading}
          />
        </div>
      )}

      <div className="mt-12 text-center">
        <h2 className="text-xl font-semibold mb-4">Want to use MCP locally?</h2>
        <p className="text-zinc-600 dark:text-zinc-400 mb-4 max-w-xl mx-auto">
          Set up the opengov-mcp-server with Claude Code, Cursor, or other MCP-compatible
          tools for unlimited access to civic data.
        </p>
        <a
          href="https://github.com/npstorey/civic-ai-tools"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
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
