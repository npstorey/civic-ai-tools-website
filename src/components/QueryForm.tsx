'use client';

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { signIn, useSession } from 'next-auth/react';
import { useHostLinks } from '@/components/HostLinksProvider';
import RateLimitBanner from './RateLimitBanner';

interface Model {
  id: string;
  name: string;
  tag?: string;
  provider: string;
  description?: string;
}

export type QueryMode = 'standard' | 'notebook';

const MODE_STORAGE_KEY = 'civicaitools.notebookMode';

/**
 * Sticky-per-session mode persistence. Subscribes to the `storage` event so
 * multiple tabs reflecting each other in the same session stay in sync, and
 * survives Strict Mode double-invocation. SSR returns 'standard'.
 */
function subscribeToStorage(notify: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', notify);
  return () => window.removeEventListener('storage', notify);
}

function readStoredMode(): QueryMode {
  if (typeof window === 'undefined') return 'standard';
  const raw = window.sessionStorage.getItem(MODE_STORAGE_KEY);
  return raw === 'notebook' || raw === 'standard' ? raw : 'standard';
}

function useStoredMode(enabled: boolean): [QueryMode, (next: QueryMode) => void] {
  const stored = useSyncExternalStore(
    subscribeToStorage,
    readStoredMode,
    () => 'standard' as QueryMode,
  );
  // Local override lets the component update synchronously on click without
  // round-tripping through a `storage` event (which never fires in the same
  // tab).
  const [override, setOverride] = useState<QueryMode | null>(null);
  const set = useCallback((next: QueryMode) => {
    setOverride(next);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(MODE_STORAGE_KEY, next);
    }
  }, []);
  // When the toggle is disabled (anonymous user, loading auth state, etc.)
  // force-return 'standard'. Stored preference is preserved so signing back
  // in restores the previous choice.
  const effective = enabled ? (override ?? stored) : 'standard';
  return [effective, set];
}

interface QueryFormProps {
  onSubmit: (query: string, model: string, portal: string, mode: QueryMode) => void;
  isLoading: boolean;
  queryCount?: number;
}

const EXAMPLE_QUERIES = [
  { text: 'Noise trends in NYC', portal: 'data.cityofnewyork.us' },
  { text: 'Top 311 complaints: NYC vs SF', portal: '' },
  { text: 'Median household income: NYC vs SF', portal: '' },
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
  // Phase 2a1 gate: executed-sandbox mode is signed-in-only. Anonymous users
  // cannot invoke /api/query-notebook through the UI. `useStoredMode` keeps
  // the sticky-per-session persistence from §10 Q7 but force-returns
  // 'standard' when the user is not authenticated.
  const { status: authStatus } = useSession();
  const isAuthenticated = authStatus === 'authenticated';
  // Where sign-in should go (P4c). Null on an instance with no host
  // topology configured — then the affordance below stays in place, exactly
  // as it is today. See src/lib/host-links.ts.
  const { signInHref } = useHostLinks();
  const [mode, updateMode] = useStoredMode(isAuthenticated);
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
      onSubmit(query.trim(), model, portal, mode);
    }
  };

  const handleExampleClick = (example: { text: string; portal: string }) => {
    setQuery(example.text);
    setPortal(example.portal);
  };

  const selectedModel = models.find((m) => m.id === model);

  const segmentStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 14px',
    border: 'none',
    background: active ? 'var(--nyc-white, #fff)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: active ? 600 : 500,
    cursor: isLoading ? 'not-allowed' : 'pointer',
    borderRadius: '999px',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
    transition: 'background-color 0.15s ease, color 0.15s ease',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
  });

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
                onSubmit(query.trim(), model, portal, mode);
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
          {/* Response mode — signed-in-only per Phase 2a1. Anonymous users
              see a sign-in prompt instead of the toggle; the executed-sandbox
              path requires authentication to invoke /api/query-notebook. */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 400, display: 'block', marginBottom: '6px' }}>
              Response mode
            </label>
            {isAuthenticated ? (
              <>
                <div
                  role="radiogroup"
                  aria-label="Response mode"
                  style={{
                    display: 'flex',
                    padding: '3px',
                    gap: '4px',
                    background: 'var(--card-background, #f3f3f3)',
                    borderRadius: '999px',
                    border: '1px solid var(--border-color, #e5e5e5)',
                    width: '100%',
                  }}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'standard'}
                    disabled={isLoading}
                    onClick={() => updateMode('standard')}
                    style={segmentStyle(mode === 'standard')}
                  >
                    Standard
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={mode === 'notebook'}
                    disabled={isLoading}
                    onClick={() => updateMode('notebook')}
                    style={segmentStyle(mode === 'notebook')}
                    title="Generate and execute a Jupyter notebook against live data (~30-90s)."
                  >
                    Execute in a signed sandbox
                  </button>
                </div>
                {mode === 'notebook' && (
                  <p
                    style={{
                      margin: '6px 0 0',
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      lineHeight: 1.5,
                    }}
                  >
                    Generates and executes a Jupyter notebook against live
                    data. Typically 30 to 90 seconds. The notebook and a
                    cryptographic execution record are signed by the platform.
                  </p>
                )}
              </>
            ) : (
              <div
                style={{
                  padding: '12px 14px',
                  border: '1px dashed var(--border-color, #e5e5e5)',
                  borderRadius: '6px',
                  background: 'var(--card-background, #f8f8f8)',
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                }}
              >
                <div style={{ marginBottom: '6px', fontWeight: 500, color: 'var(--text-primary)' }}>
                  Sign in to execute in a signed sandbox
                </div>
                {/* One expression, not a sentence split around a ternary:
                    two adjacent text children would make React emit comment
                    separators, and the unset case must stay byte-identical. */}
                <p style={{ margin: '0 0 10px' }}>
                  {signInHref !== null
                    ? 'Executed-sandbox mode generates and runs a Jupyter notebook against live data, then signs the execution record. Sign in to enable.'
                    : 'Executed-sandbox mode generates and runs a Jupyter notebook against live data, then signs the execution record. Sign in with GitHub to enable.'}
                </p>
                {signInHref !== null ? (
                  /* Split topology (P4c): sign-in lives on the app surface,
                     so this is a link rather than an in-place OAuth start —
                     which could not complete from this host anyway. No
                     loading state: the destination decides server-side. */
                  <a
                    href={signInHref}
                    className="nyc-button nyc-button-primary"
                    style={{ fontSize: '13px', padding: '6px 14px', textDecoration: 'none' }}
                  >
                    Sign in
                  </a>
                ) : (
                <button
                  type="button"
                  onClick={() => signIn('github')}
                  disabled={authStatus === 'loading'}
                  className="nyc-button nyc-button-primary"
                  style={{
                    fontSize: '13px',
                    padding: '6px 14px',
                    cursor: authStatus === 'loading' ? 'wait' : 'pointer',
                  }}
                >
                  {authStatus === 'loading' ? 'Loading…' : 'Sign in with GitHub'}
                </button>
                )}
              </div>
            )}
          </div>

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
