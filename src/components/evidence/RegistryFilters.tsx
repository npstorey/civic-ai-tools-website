'use client';

import type { CSSProperties } from 'react';

/**
 * The registry's filters (UX-2 P5), a module P4's list reuses: the search
 * box, the reviews filter (R18b C; X7's words, ruled), the date range, the
 * sort, and "Include withdrawn". The reviews filter's values are the ones the
 * list route reads (`?reviews=`, `api/evidence/list/route.ts`).
 *
 * Every state is the caller's; this renders and reports changes.
 */

/** X7, ruled: the reviews filter, in order, with the values the list route reads. */
export const REVIEWS_FILTER_OPTIONS = [
  { value: '', label: 'All analyses' },
  { value: 'none', label: 'No reviews yet' },
  { value: 'expert', label: 'Expert review' },
  { value: 'evaluation', label: 'Evaluation' },
  { value: 'consistency', label: 'Consistency test' },
] as const;

export const RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
] as const;

export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'attested', label: 'Most attested' },
  { value: 'alpha', label: 'Alphabetical' },
] as const;

export interface RegistryFilterState {
  query: string;
  reviews: string;
  range: string;
  sort: string;
  includeWithdrawn: boolean;
}

export const DEFAULT_REGISTRY_FILTERS: RegistryFilterState = {
  query: '',
  reviews: '',
  range: 'all',
  sort: 'newest',
  includeWithdrawn: false,
};

const selectStyle: CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--border-color)',
  borderRadius: '4px',
  fontSize: '13px',
  backgroundColor: 'white',
  color: 'var(--text-secondary)',
};

export function RegistryFilters({
  value,
  onChange,
  searchPlaceholder,
}: {
  value: RegistryFilterState;
  onChange: (next: RegistryFilterState) => void;
  searchPlaceholder: string;
}) {
  const set = (patch: Partial<RegistryFilterState>) => onChange({ ...value, ...patch });
  const changed =
    value.query !== DEFAULT_REGISTRY_FILTERS.query ||
    value.reviews !== DEFAULT_REGISTRY_FILTERS.reviews ||
    value.range !== DEFAULT_REGISTRY_FILTERS.range ||
    value.sort !== DEFAULT_REGISTRY_FILTERS.sort ||
    value.includeWithdrawn !== DEFAULT_REGISTRY_FILTERS.includeWithdrawn;
  return (
    <div style={{ marginBottom: '20px' }}>
      <input
        type="text"
        value={value.query}
        onChange={(e) => set({ query: e.target.value })}
        placeholder={searchPlaceholder}
        style={{
          width: '100%', padding: '10px 14px',
          border: '1px solid var(--border-color)', borderRadius: '6px',
          fontSize: '14px', boxSizing: 'border-box', marginBottom: '12px',
        }}
      />
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <select value={value.reviews} onChange={(e) => set({ reviews: e.target.value })} style={selectStyle}>
          {REVIEWS_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={value.range} onChange={(e) => set({ range: e.target.value })} style={selectStyle}>
          {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={value.sort} onChange={(e) => set({ sort: e.target.value })} style={selectStyle}>
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          fontSize: '13px', color: 'var(--text-muted)', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={value.includeWithdrawn}
            onChange={(e) => set({ includeWithdrawn: e.target.checked })}
          />
          Include withdrawn
        </label>
        {changed && (
          <button
            onClick={() => onChange(DEFAULT_REGISTRY_FILTERS)}
            style={{
              ...selectStyle, cursor: 'pointer', border: 'none',
              color: 'var(--accent)', backgroundColor: 'transparent', padding: '6px 4px',
            }}
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
