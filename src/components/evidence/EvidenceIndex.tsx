'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Row } from '@/components/ui/Row';
import { Signal } from '@/components/ui/Signal';
import { formatModelName } from '@/lib/models';
import { reviewsLine, type RecordReviews } from '@/lib/evidence/review-summary';
import { LIST_LOAD_FAILED, MADE_BY } from '@/lib/evidence/trust-words';
import { DEFAULT_REGISTRY_FILTERS, RegistryFilters, type RegistryFilterState } from './RegistryFilters';

// The registry (UX-2 P5; R18 C, R18b C). Each row is a P7 row stating facts,
// not a verdict: how the analysis was made and its reviews, as P6 `line`
// signals in the neutral tier. No `verificationStatus` word reaches a reader
// (R18 C), and the row carries no "Sources used" in P5 (relay 13, ruling 1:
// it waits for a phase that adds a column). A failed request says so (X8),
// and a response that arrives after a newer request's is dropped (#701 item 1).

interface EvidenceRecord {
  id: string;
  slug: string;
  title: string;
  summary: string;
  model: string;
  withdrawnAt: string | null;
  reinstatedAt: string | null;
  createdAt: string;
  creatorName: string;
  reviews?: RecordReviews;
}

interface ListResponse {
  records: EvidenceRecord[];
  total: number;
  page: number;
  totalPages: number;
}

export default function EvidenceIndex() {
  const [filters, setFilters] = useState<RegistryFilterState>(DEFAULT_REGISTRY_FILTERS);
  const { query, reviews, range, sort, includeWithdrawn } = filters;
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Reset page when filters change (during render, not in an effect)
  const filterKey = JSON.stringify([debouncedQuery, reviews, range, sort, includeWithdrawn]);
  const [pageFilterKey, setPageFilterKey] = useState(filterKey);
  if (filterKey !== pageFilterKey) {
    setPageFilterKey(filterKey);
    setPage(1);
  }

  // Loading starts when the request changes (during render); the effect fetches
  const requestKey = JSON.stringify([debouncedQuery, reviews, range, sort, includeWithdrawn, page]);
  const [loadingKey, setLoadingKey] = useState(requestKey);
  if (requestKey !== loadingKey) {
    setLoadingKey(requestKey);
    setLoading(true);
  }

  useEffect(() => {
    // A newer request supersedes this one: its cleanup runs first, and this
    // response, whenever it lands, sets nothing (#701 item 1).
    let superseded = false;
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (reviews) params.set('reviews', reviews);
    if (range !== 'all') params.set('range', range);
    if (sort !== 'newest') params.set('sort', sort);
    if (includeWithdrawn) params.set('withdrawn', 'include');
    if (page > 1) params.set('page', String(page));

    fetch(`/api/records/list?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as ListResponse;
        if (superseded) return;
        setData(body);
        setFailed(false);
      })
      .catch(() => {
        if (superseded) return;
        setData(null);
        setFailed(true);
      })
      .finally(() => {
        if (!superseded) setLoading(false);
      });
    return () => { superseded = true; };
  }, [debouncedQuery, reviews, range, sort, includeWithdrawn, page]);

  const filtered = !!debouncedQuery || !!reviews || range !== 'all';

  return (
    <>
      <RegistryFilters value={filters} onChange={setFilters} searchPlaceholder="Search analyses by title or summary..." />

      {/* Results */}
      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
          Loading...
        </div>
      ) : failed ? (
        <div style={{
          padding: '32px', border: '1px solid var(--border-color)', borderRadius: '6px',
          textAlign: 'center', color: 'var(--text-muted)',
        }}>
          <p style={{ fontSize: '16px', margin: 0 }}>{LIST_LOAD_FAILED}</p>
        </div>
      ) : !data || data.records.length === 0 ? (
        <div style={{
          padding: '32px', border: '1px solid var(--border-color)', borderRadius: '6px',
          textAlign: 'center', color: 'var(--text-muted)',
        }}>
          <p style={{ fontSize: '16px', margin: '0 0 8px' }}>
            {filtered
              ? 'No analyses match your filters.'
              : 'No analyses published yet.'}
          </p>
          {!filtered && (
            <p style={{ fontSize: '14px', margin: 0 }}>
              {/* Topology-stale copy fixed in #229 P1 — the second instance
                  of the "home page" noun the dashboard carried. `/records`
                  (and its permanent `/evidence` alias) is DUAL-SERVED, so this
                  line renders on both hosts, and the
                  href must stay relative: `/` is the query surface on the
                  marketing host and 307s to `/ask` on the app host, while a
                  direct `/ask` would 404 on the marketing host. Only the
                  wording was wrong — the app host has no "home page". */}
              <Link href="/" style={{ color: 'var(--accent)' }}>Run a query</Link> and
              click &ldquo;Publish&rdquo; to create the first one.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Count */}
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            {data.total} item{data.total !== 1 ? 's' : ''}
            {data.totalPages > 1 && ` \u00b7 page ${data.page} of ${data.totalPages}`}
          </div>

          <div>
            {data.records.map((r) => {
              const dateStr = new Date(r.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
              const modelName = formatModelName(r.model);
              // Only currently-withdrawn (withdrawn but not reinstated) gets the withdrawn treatment.
              const isWithdrawn = !!r.withdrawnAt && !r.reinstatedAt;
              return (
                <Row
                  key={r.id}
                  as="article"
                  title={r.title}
                  href={`/records/${r.slug}`}
                  summary={r.summary}
                  meta={[dateStr, r.creatorName, modelName]}
                  withdrawn={isWithdrawn}
                  signals={
                    <>
                      <Signal tier="neutral" label={MADE_BY(modelName)} />
                      {r.reviews && <Signal tier="neutral" label={reviewsLine(r.reviews)} />}
                    </>
                  }
                />
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
        backgroundColor: active ? 'var(--accent)' : 'white',
        color: active ? 'white' : disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
        fontWeight: active ? 600 : 400,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
