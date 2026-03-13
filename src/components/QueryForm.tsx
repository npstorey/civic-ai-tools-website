'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Model {
  id: string;
  name: string;
  tag?: string;
  provider: string;
  description?: string;
}

interface QueryFormProps {
  onSubmit: (query: string, model: string, portal: string) => void;
  isLoading: boolean;
}

const EXAMPLE_QUERIES = [
  { text: 'Most common 311 complaints in NYC', portal: 'data.cityofnewyork.us' },
  { text: 'Restaurant inspection trends in Chicago', portal: 'data.cityofchicago.org' },
  { text: 'Top noise complaints in San Francisco', portal: 'data.sfgov.org' },
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
  const [model, setModel] = useState('openai/gpt-4o');
  const [portal, setPortal] = useState('data.cityofnewyork.us');
  const [models, setModels] = useState<Model[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const portalDropdownRef = useRef<HTMLDivElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, []);

  useEffect(() => { autoResize(); }, [query, autoResize]);

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

  // Close dropdowns on outside click
  useEffect(() => {
    if (!modelOpen && !portalOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modelOpen && modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
      if (portalOpen && portalDropdownRef.current && !portalDropdownRef.current.contains(e.target as Node)) {
        setPortalOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [modelOpen, portalOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isLoading) {
      onSubmit(query.trim(), model, portal);
    }
  };

  const handleExampleClick = (example: { text: string; portal: string }) => {
    setQuery(example.text);
    setPortal(example.portal);
  };

  const selectedModel = models.find((m) => m.id === model);

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="nyc-field">
        <label htmlFor="query">Ask a question that open data can answer</label>
        <textarea
          id="query"
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onInput={autoResize}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (query.trim() && !isLoading) {
                onSubmit(query.trim(), model, portal);
              }
            }
          }}
          placeholder="e.g., What are the most common 311 complaints in NYC?"
          rows={1}
          disabled={isLoading}
          style={{ resize: 'none', minHeight: '44px', maxHeight: '120px', overflowY: 'auto' }}
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
            {example.text.length > 40 ? example.text.slice(0, 40) + '...' : example.text}
          </button>
        ))}
      </div>

      <div className="form-controls-row">
        {/* Custom model dropdown: shows just the name when closed, name + tag when open */}
        <div className="nyc-field" ref={modelDropdownRef} style={{ position: 'relative' }}>
          <label>Model</label>
          <button
            type="button"
            onClick={() => !isLoading && setModelOpen(!modelOpen)}
            disabled={isLoading}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '10px 32px 10px 12px',
              fontSize: '16px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: 'var(--nyc-white)',
              color: 'var(--text-primary)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              appearance: 'none',
              position: 'relative',
            }}
          >
            {selectedModel?.name || 'Select model'}
            <span style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '12px',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}>
              &#9662;
            </span>
          </button>
          {modelOpen && (
            <ul style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              margin: '2px 0 0 0',
              padding: '4px 0',
              listStyle: 'none',
              backgroundColor: 'var(--nyc-white)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              zIndex: 10,
            }}>
              {models.map((m) => (
                <li
                  key={m.id}
                  onClick={() => { setModel(m.id); setModelOpen(false); }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: '15px',
                    backgroundColor: m.id === model ? 'var(--card-background)' : 'transparent',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.backgroundColor = m.id === model ? 'var(--card-background)' : 'transparent'; }}
                >
                  {m.name}
                  {m.tag && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '13px' }}>
                      {m.tag}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="nyc-field" ref={portalDropdownRef} style={{ position: 'relative' }}>
          <label>Data portal</label>
          <button
            type="button"
            onClick={() => !isLoading && setPortalOpen(!portalOpen)}
            disabled={isLoading}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '10px 32px 10px 12px',
              fontSize: '16px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              backgroundColor: 'var(--nyc-white)',
              color: 'var(--text-primary)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              appearance: 'none',
              position: 'relative',
            }}
          >
            {PORTALS.find((p) => p.id === portal)?.name || 'Select portal'}
            <span style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '12px',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}>
              &#9662;
            </span>
          </button>
          {portalOpen && (
            <ul style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              margin: '2px 0 0 0',
              padding: '4px 0',
              listStyle: 'none',
              backgroundColor: 'var(--nyc-white)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              zIndex: 10,
            }}>
              {PORTALS.map((p) => (
                <li
                  key={p.id}
                  onClick={() => { setPortal(p.id); setPortalOpen(false); }}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: '15px',
                    backgroundColor: p.id === portal ? 'var(--card-background)' : 'transparent',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--card-background)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.backgroundColor = p.id === portal ? 'var(--card-background)' : 'transparent'; }}
                >
                  {p.name}
                </li>
              ))}
            </ul>
          )}
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
