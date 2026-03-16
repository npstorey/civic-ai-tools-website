'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import RateLimitBanner from './RateLimitBanner';

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
  queryCount?: number;
}

const EXAMPLE_QUERIES = [
  { text: 'Noise trends in NYC', portal: 'data.cityofnewyork.us' },
  { text: 'Top restaurant violations in SF', portal: 'data.sfgov.org' },
  { text: 'Top 311 complaints: NYC vs SF', portal: '' },
];

const PORTALS = [
  { id: '', name: 'All portals' },
  { id: 'data.cityofnewyork.us', name: 'New York City' },
  { id: 'data.cityofchicago.org', name: 'Chicago' },
  { id: 'data.sfgov.org', name: 'San Francisco' },
  { id: 'data.lacity.org', name: 'Los Angeles' },
  { id: 'data.seattle.gov', name: 'Seattle' },
];

export default function QueryForm({ onSubmit, isLoading, queryCount = 0 }: QueryFormProps) {
  const [query, setQuery] = useState('');
  const [model, setModel] = useState('openai/gpt-4o');
  const [portal, setPortal] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
        if (isMounted) setModels(data.models);
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    };
    fetchModels();
    return () => { isMounted = false; };
  }, []);

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
      {/* Chat-style textarea with inline send button */}
      <div className="nyc-field" style={{ position: 'relative' }}>
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
          placeholder="What data is available about child care in NYC?"
          rows={1}
          disabled={isLoading}
          aria-label="Ask a question about open data"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'none',
            minHeight: '48px',
            maxHeight: '120px',
            overflow: 'hidden',
            paddingRight: '48px',
            borderRadius: '8px',
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          style={{
            position: 'absolute',
            right: '8px',
            bottom: '8px',
            width: '32px',
            height: '32px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: query.trim() && !isLoading ? 'var(--nyc-blue)' : 'var(--border-color)',
            color: 'white',
            cursor: query.trim() && !isLoading ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 0.15s ease',
          }}
          aria-label="Submit query"
        >
          {isLoading ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="8" cy="8" r="6" stroke="white" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>

      {/* Example queries on one row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
        {EXAMPLE_QUERIES.map((example, idx) => (
          <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            {idx > 0 && <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>·</span>}
            <button
              type="button"
              onClick={() => handleExampleClick(example)}
              disabled={isLoading}
              style={{
                fontSize: '13px',
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
              onMouseOver={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.backgroundColor = 'var(--nyc-blue-80)';
                  e.currentTarget.style.borderColor = 'var(--nyc-blue-40)';
                }
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
            >
              {example.text}
            </button>
          </span>
        ))}
      </div>

      {/* Secondary info row: advanced options + rate limit (after first query) */}
      <div style={{ display: 'flex', justifyContent: queryCount > 0 ? 'space-between' : 'center', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '13px',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          <span style={{ fontSize: '16px' }}>&#9881;</span> Advanced options {advancedOpen ? '\u25B4' : '\u25BE'}
        </button>
        {queryCount > 0 && <RateLimitBanner refreshTrigger={queryCount} />}
      </div>

      {/* Advanced options expanded section */}
      {advancedOpen && (
        <div>
          <div className="form-controls-row">
              {/* Model dropdown */}
              <div className="nyc-field" ref={modelDropdownRef} style={{ position: 'relative' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400 }}>Model</label>
                <button
                  type="button"
                  onClick={() => !isLoading && setModelOpen(!modelOpen)}
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 28px 8px 10px',
                    fontSize: '14px',
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

              {/* Portal dropdown */}
              <div className="nyc-field" ref={portalDropdownRef} style={{ position: 'relative' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400 }}>Data portal</label>
                <button
                  type="button"
                  onClick={() => !isLoading && setPortalOpen(!portalOpen)}
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 28px 8px 10px',
                    fontSize: '14px',
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
                        key={p.id || '__all__'}
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
            </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            <Link
              href="/learn#model-selection"
              style={{ fontSize: '12px', color: 'var(--text-muted)' }}
            >
              Why these models?
            </Link>
            <Link
              href="/directory?tab=portals"
              style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 400 }}
            >
              Browse available data &rarr;
            </Link>
            <Link
              href="/about#whats-in-the-project"
              style={{ fontSize: '12px', color: 'var(--text-muted)' }}
            >
              What data is available?
            </Link>
          </div>
        </div>
      )}
    </form>
  );
}
