'use client';

import { useState, useEffect } from 'react';

interface Model {
  id: string;
  name: string;
  provider: string;
  description?: string;
}

interface QueryFormProps {
  onSubmit: (query: string, model: string, portal: string) => void;
  isLoading: boolean;
}

const EXAMPLE_QUERIES = [
  'What are the most common 311 complaints in San Francisco?',
  'Show me recent building permits in Chicago',
  'What are the top crime types in New York City?',
  'Find datasets about public transportation in San Francisco',
];

const PORTALS = [
  { id: 'data.sfgov.org', name: 'San Francisco' },
  { id: 'data.cityofchicago.org', name: 'Chicago' },
  { id: 'data.ny.gov', name: 'New York State' },
  { id: 'data.cityofnewyork.us', name: 'New York City' },
  { id: 'data.lacity.org', name: 'Los Angeles' },
];

export default function QueryForm({ onSubmit, isLoading }: QueryFormProps) {
  const [query, setQuery] = useState('');
  const [model, setModel] = useState('openai/gpt-4o-mini');
  const [portal, setPortal] = useState('data.sfgov.org');
  const [models, setModels] = useState<Model[]>([]);

  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((data) => setModels(data.models))
      .catch(console.error);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isLoading) {
      onSubmit(query.trim(), model, portal);
    }
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="query"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
        >
          Ask a question about civic data
        </label>
        <textarea
          id="query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g., What are the most common 311 complaints in San Francisco?"
          className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 resize-none"
          rows={3}
          disabled={isLoading}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400 w-full mb-1">
          Try an example:
        </span>
        {EXAMPLE_QUERIES.map((example, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleExampleClick(example)}
            className="text-xs px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            disabled={isLoading}
          >
            {example.length > 40 ? example.slice(0, 40) + '...' : example}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="model"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
          >
            Model
          </label>
          <select
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
            disabled={isLoading}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="portal"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2"
          >
            Data Portal
          </label>
          <select
            id="portal"
            value={portal}
            onChange={(e) => setPortal(e.target.value)}
            className="w-full px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
            disabled={isLoading}
          >
            {PORTALS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading || !query.trim()}
        className="w-full py-3 px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? 'Comparing responses...' : 'Compare Responses'}
      </button>
    </form>
  );
}
