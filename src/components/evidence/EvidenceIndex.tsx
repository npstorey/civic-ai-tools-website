'use client';

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import Link from 'next/link';

interface EvidenceRecord {
  id: string;
  slug: string;
  title: string;
  summary: string;
  model: string;
  verificationStatus: string;
  withdrawnAt: string | null;
  reinstatedAt: string | null;
  createdAt: string;
  creatorName: string;
}

interface ListResponse {
  records: EvidenceRecord[];
  total: number;
  page: number;
  totalPages: number;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'consistency_tested', label: 'Consistency tested' },
  { value: 'evaluated', label: 'Evaluated' },
  { value: 'fully_attested', label: 'Fully attested' },
];

const RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'attested', label: 'Most attested' },
  { value: 'alpha', label: 'Alphabetical' },
];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    unverified: { bg: 'rgba(0,0,0,0.06)', text: 'var(--text-muted)' },
    consistency_tested: { bg: 'rgba(16, 63, 239, 0.1)', text: 'var(--nyc-blue)' },
    evaluated: { bg: 'rgba(0, 183, 3, 0.1)', text: 'var(--nyc-success)' },
    fully_attested: { bg: 'rgba(0, 183, 3, 0.15)', text: 'var(--nyc-success)' },
    withdrawn: { bg: 'rgba(236, 19, 30, 0.08)', text: 'var(--nyc-error)' },
  };
  const c = colors[status] || colors.unverified;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
      fontSize: '11px', fontWeight: 600, backgroundColor: c.bg, color: c.text,
      textTransform: 'capitalize',
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const selectStyle: CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  fontSize: '13px',
  backgroundColor: 'white',
  color: 'var(--text-secondary)',
};

export default function EvidenceIndex() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [range, setRange] = useState('all');
  const [sort, setSort] = useState('newest');
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, status, range, sort, includeWithdrawn]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (status) params.set('status', status);
    if (range !== 'all') params.set('range', range);
    if (sort !== 'newest') params.set('sort', sort);
    if (includeWithdrawn) params.set('withdrawn', 'include');
    if (page > 1) params.set('page', String(page));

    try {
      const res = await fetch(`/api/evidence/list?${params}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, status, range, sort, includeWithdrawn, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <>
      {/* Search + Filters */}
      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search evidence by title or summary..."
          style={{
            width: '100%', padding: '10px 14px',
            border: '1px solid var(--border-color)', borderRadius: '6px',
            fontSize: '14px', boxSizing: 'border-box', marginBottom: '12px',
          }}
        />
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={range} onChange={(e) => setRange(e.target.value)} style={selectStyle}>
            {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={selectStyle}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '13px', color: 'var(--text-muted)', cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={includeWithdrawn}
              onChange={(e) => setIncludeWithdrawn(e.target.checked)}
            />
            Include withdrawn
          </label>
          {(query || status || range !== 'all' || sort !== 'newest' || includeWithdrawn) && (
            <button
              onClick={() => { setQuery(''); setStatus(''); setRange('all'); setSort('newest'); setIncludeWithdrawn(false); }}
              style={{
                ...selectStyle, cursor: 'pointer', border: 'none',
                color: 'var(--nyc-blue)', backgroundColor: 'transparent', padding: '6px 4px',
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
          Loading...
        </div>
      ) : !data || data.records.length === 0 ? (
        <div style={{
          padding: '32px', border: '1px solid var(--border-color)', borderRadius: '6px',
          textAlign: 'center', color: 'var(--text-muted)',
        }}>
          <p style={{ fontSize: '16px', margin: '0 0 8px' }}>
            {debouncedQuery || status || range !== 'all'
              ? 'No evidence matches your filters.'
              : 'No evidence packages published yet.'}
          </p>
          {!debouncedQuery && !status && range === 'all' && (
            <p style={{ fontSize: '14px', margin: 0 }}>
              Run a query on the <Link href="/" style={{ color: 'var(--nyc-blue)' }}>home page</Link> and
              click &ldquo;Publish as Evidence&rdquo; to create the first one.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Count */}
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            {data.total} record{data.total !== 1 ? 's' : ''}
            {data.totalPages > 1 && ` \u00b7 page ${data.page} of ${data.totalPages}`}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {data.records.map((r) => {
              const dateStr = new Date(r.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
              // Only currently-withdrawn (withdrawn but not reinstated) gets the muted treatment.
              const isWithdrawn = !!r.withdrawnAt && !r.reinstatedAt;
              return (
                <Link
                  key={r.id}
                  href={`/evidence/${r.slug}`}
                  style={{
                    display: 'block', padding: '16px 20px',
                    border: '1px solid var(--border-color)', borderRadius: '6px',
                    textDecoration: 'none', color: 'inherit',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                    opacity: isWithdrawn ? 0.6 : 1,
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.borderColor = 'var(--nyc-blue)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(16, 63, 239, 0.1)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '6px' }}>
                    <h2 style={{
                      fontSize: '16px', fontWeight: 600, margin: 0, color: 'var(--text-primary)',
                      textDecoration: isWithdrawn ? 'line-through' : 'none',
                    }}>
                      {r.title}
                    </h2>
                    {isWithdrawn
                      ? <StatusBadge status="withdrawn" />
                      : <StatusBadge status={r.verificationStatus} />
                    }
                  </div>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.5 }}>
                    {r.summary}
                  </p>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <span>{r.creatorName}</span>
                    <span>{'\u00b7'}</span>
                    <span>{dateStr}</span>
                    <span>{'\u00b7'}</span>
                    <span>{r.model}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '24px' }}>
              <PaginationButton
                label="Previous"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              />
              {Array.from({ length: data.totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === data.totalPages || Math.abs(p - page) <= 1)
                .reduce<(number | 'ellipsis')[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1]) > 1) acc.push('ellipsis');
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, i) =>
                  item === 'ellipsis' ? (
                    <span key={`e${i}`} style={{ padding: '6px 4px', color: 'var(--text-muted)', fontSize: '13px' }}>...</span>
                  ) : (
                    <PaginationButton
                      key={item}
                      label={String(item)}
                      active={item === page}
                      onClick={() => setPage(item)}
                    />
                  ),
                )}
              <PaginationButton
                label="Next"
                disabled={page >= data.totalPages}
                onClick={() => setPage(p => p + 1)}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}

function PaginationButton({ label, disabled, active, onClick }: {
  label: string; disabled?: boolean; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 12px', border: '1px solid var(--border-color)', borderRadius: '4px',
        fontSize: '13px', cursor: disabled ? 'not-allowed' : 'pointer',
        backgroundColor: active ? 'var(--nyc-blue)' : 'white',
        color: active ? 'white' : disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
        fontWeight: active ? 600 : 400,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
