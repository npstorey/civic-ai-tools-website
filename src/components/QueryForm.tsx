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
  'What are the most common 311 complaints in NYC?',
  'Show me restaurant inspection grades in Manhattan',
  'What are the top noise complaint types?',
  'Find datasets about housing violations',
];

const PORTALS = [
  { id: 'data.cityofnewyork.us', name: 'New York City' },
  { id: 'data.cityofchicago.org', name: 'Chicago' },
  { id: 'data.sfgov.org', name: 'San Francisco' },
  { id: 'data.lacity.org', name: 'Los Angeles' },
  { id: 'data.seattle.gov', name: 'Seattle' },
];

export default function QueryForm({ onSubmit, isLoading }: QueryFormProps) {
  const [query, setQuery] = useState('');
  const [model, setModel] = useState('openai/gpt-4o-mini');
  const [portal, setPortal] = useState('data.cityofnewyork.us');
  const [models, setModels] = useState<Model[]>([]);

  useEffect(() => {
    let isMounted = true;

    const fetchModels = async () => {
      try {
        const res = await fetch('/api/models');
        const data = await res.json();
        if (isMounted) {
          setModels(data.models);
        }
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    };

    fetchModels();

    return () => {
      isMounted = false;
    };
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
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="nyc-field">
        <label htmlFor="query">Ask a question about civic data</label>
        <textarea
          id="query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g., What are the most common 311 complaints in San Francisco?"
          rows={3}
          disabled={isLoading}
          style={{ resize: 'none' }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
          Try an example:
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {EXAMPLE_QUERIES.map((example, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleExampleClick(example)}
              disabled={isLoading}
              style={{
                fontSize: '14px',
                padding: '6px 12px',
                borderRadius: '4px',
                backgroundColor: 'var(--card-background)',
                color: 'var(--text-secondary)',
                border: 'none',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.15s ease',
              }}
              onMouseOver={(e) => {
                if (!isLoading) e.currentTarget.style.backgroundColor = 'var(--nyc-gray-80)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--card-background)';
              }}
            >
              {example.length > 45 ? example.slice(0, 45) + '...' : example}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px' }}>
        <div className="nyc-field">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={isLoading}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
        </div>

        <div className="nyc-field">
          <label htmlFor="portal">Data portal</label>
          <select
            id="portal"
            value={portal}
            onChange={(e) => setPortal(e.target.value)}
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
        className="nyc-button nyc-button-primary"
        style={{
          width: '100%',
          padding: '16px 24px',
          fontSize: '18px',
        }}
      >
        {isLoading ? 'Comparing responses...' : 'Compare responses'}
      </button>
    </form>
  );
}
