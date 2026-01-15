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
  'Most common 311 complaints in NYC',
  'Restaurant inspection grades in Manhattan',
  'Top noise complaint types',
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
  const [model, setModel] = useState('anthropic/claude-sonnet-4');
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
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="nyc-field">
        <label htmlFor="query">Ask a question about civic data</label>
        <textarea
          id="query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g., What are the most common 311 complaints in NYC?"
          rows={1}
          disabled={isLoading}
          style={{ resize: 'none', minHeight: '44px' }}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Examples:
        </span>
        {EXAMPLE_QUERIES.map((example, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleExampleClick(example)}
            disabled={isLoading}
            style={{
              fontSize: '13px',
              padding: '4px 10px',
              borderRadius: '4px',
              backgroundColor: 'var(--nyc-white)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseOver={(e) => {
              if (!isLoading) {
                e.currentTarget.style.backgroundColor = 'var(--nyc-blue-80)';
                e.currentTarget.style.borderColor = 'var(--nyc-blue-40)';
              }
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--nyc-white)';
              e.currentTarget.style.borderColor = 'var(--border-color)';
            }}
          >
            {example.length > 35 ? example.slice(0, 35) + '...' : example}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '16px', alignItems: 'end' }}>
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

        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className="nyc-button nyc-button-primary"
          style={{
            padding: '12px 32px',
            fontSize: '16px',
            whiteSpace: 'nowrap',
          }}
        >
          {isLoading ? 'Comparing...' : 'Compare'}
        </button>
      </div>
    </form>
  );
}
