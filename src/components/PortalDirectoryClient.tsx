'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { PortalEntry } from '@/lib/mcp/portal-data';
import { prose } from '@/styles/page-styles';
import type { CSSProperties } from 'react';

const ITEMS_PER_PAGE = 50;

// --- Helpers ---

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generatePortalCsv(portals: PortalEntry[]): string {
  const headers = [
    'Name', 'ID', 'URL', 'Platform', 'Country', 'Owner', 'Owner Type',
    'Government Level', 'Datasets', 'API Endpoint',
  ];
  const rows = portals.map((p) => [
    p.name || p.id,
    p.id,
    p.url,
    p.platform,
    p.country_name,
    p.owner_name,
    p.owner_type,
    p.government_level,
    p.dataset_count.toString(),
    p.api_endpoint,
  ]);
  return [headers, ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\n');
}

function downloadPortalCsv(portals: PortalEntry[]) {
  const csv = generatePortalCsv(portals);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'data-portal-directory.csv';
  link.click();
  URL.revokeObjectURL(url);
}

type PortalSortOption = 'name' | 'datasets' | 'country' | 'ownerType';

const SORT_LABELS: Record<PortalSortOption, string> = {
  name: 'Name A-Z',
  datasets: 'Dataset Count',
  country: 'Country A-Z',
  ownerType: 'Owner Type',
};

// --- FilterDropdown (duplicated from DirectoryClient for component independence) ---

function FilterDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selectedLabel = options.find((o) => o.value === value)?.label || label;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          textAlign: 'left',
          padding: '8px 28px 8px 12px',
          fontSize: '14px',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          backgroundColor: 'var(--nyc-white)',
          color: value ? 'var(--text-primary)' : 'var(--text-muted)',
          cursor: 'pointer',
          appearance: 'none' as const,
          position: 'relative' as const,
          fontFamily: 'inherit',
          whiteSpace: 'nowrap',
        }}
      >
        {selectedLabel}
        <span
          style={{
            position: 'absolute',
            right: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '10px',
            color: 'var(--text-muted)',
            pointerEvents: 'none',
          }}
        >
          &#9662;
        </span>
      </button>
      {open && (
        <ul
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            minWidth: '100%',
            margin: '2px 0 0 0',
            padding: '4px 0',
            listStyle: 'none',
            backgroundColor: 'var(--nyc-white)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 10,
            maxHeight: '280px',
            overflowY: 'auto',
            whiteSpace: 'nowrap',
          }}
        >
          {options.map((opt) => (
            <li
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '14px',
                backgroundColor:
                  opt.value === value ? 'var(--card-background)' : 'transparent',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--card-background)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor =
                  opt.value === value ? 'var(--card-background)' : 'transparent';
              }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Platform badge ---

function PlatformBadge({ platform }: { platform: string }) {
  const isSocrata = platform === 'socrata';
  return (
    <span
      style={{
        fontSize: '11px',
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: '3px',
        color: isSocrata ? '#2B6CB0' : '#1D6F42',
        backgroundColor: isSocrata
          ? 'rgba(43, 108, 176, 0.1)'
          : 'rgba(29, 111, 66, 0.1)',
        whiteSpace: 'nowrap',
      }}
    >
      {isSocrata ? 'Socrata' : 'CKAN'}
    </span>
  );
}

// --- Table styles ---

const thStyle: CSSProperties = {
  padding: '10px 12px',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  borderBottom: '2px solid var(--border-color)',
};

const tdStyle: CSSProperties = {
  padding: '10px 12px',
  fontSize: '14px',
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-color)',
  verticalAlign: 'middle',
};

// --- Component ---

export default function PortalDirectoryClient({
  portals,
}: {
  portals: PortalEntry[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialQ = searchParams.get('q') || '';
  const initialPlatform = searchParams.get('platform') || '';
  const initialCountry = searchParams.get('country') || '';
  const initialGovLevel = searchParams.get('govLevel') || '';
  const initialOwnerType = searchParams.get('ownerType') || '';
  const initialSort = (searchParams.get('sort') as PortalSortOption) || 'name';
  const initialPage = parseInt(searchParams.get('page') || '1', 10) || 1;

  const [query, setQuery] = useState(initialQ);
  const [platformFilter, setPlatformFilter] = useState(initialPlatform);
  const [countryFilter, setCountryFilter] = useState(initialCountry);
  const [govLevelFilter, setGovLevelFilter] = useState(initialGovLevel);
  const [ownerTypeFilter, setOwnerTypeFilter] = useState(initialOwnerType);
  const [sortBy, setSortBy] = useState<PortalSortOption>(initialSort);
  const [page, setPage] = useState(initialPage);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Platform counts (from full array, not filtered)
  const socrataCount = useMemo(
    () => portals.filter((p) => p.platform === 'socrata').length,
    [portals]
  );
  const ckanCount = useMemo(
    () => portals.filter((p) => p.platform === 'ckan').length,
    [portals]
  );

  // URL sync
  const updateUrl = useCallback(
    (params: Record<string, string>) => {
      const sp = new URLSearchParams();
      sp.set('tab', 'portals');
      for (const [k, v] of Object.entries(params)) {
        if (v && !(k === 'page' && v === '1')) sp.set(k, v);
      }
      router.replace(`/directory?${sp.toString()}`, { scroll: false });
    },
    [router]
  );

  const setFilter = useCallback(
    (key: string, value: string, setter: (v: string) => void) => {
      setter(value);
      setPage(1);
      const params: Record<string, string> = {
        q: key === 'q' ? value : query,
        platform: key === 'platform' ? value : platformFilter,
        country: key === 'country' ? value : countryFilter,
        govLevel: key === 'govLevel' ? value : govLevelFilter,
        ownerType: key === 'ownerType' ? value : ownerTypeFilter,
        sort: key === 'sort' ? value : sortBy,
      };
      updateUrl(params);
    },
    [query, platformFilter, countryFilter, govLevelFilter, ownerTypeFilter, sortBy, updateUrl]
  );

  // Filter dropdown options
  const platformOptions = useMemo(
    () => [
      { value: '', label: 'All Platforms' },
      { value: 'socrata', label: `Socrata (${socrataCount.toLocaleString()})` },
      { value: 'ckan', label: `CKAN (${ckanCount.toLocaleString()})` },
    ],
    [socrataCount, ckanCount]
  );

  const countryOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of portals) {
      if (p.country_name) counts[p.country_name] = (counts[p.country_name] || 0) + 1;
    }
    return [
      { value: '', label: 'All Countries' },
      ...Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ value: name, label: `${name} (${count})` })),
    ];
  }, [portals]);

  const govLevelOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of portals) {
      if (p.government_level)
        counts[p.government_level] = (counts[p.government_level] || 0) + 1;
    }
    return [
      { value: '', label: 'All Levels' },
      ...Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([level, count]) => ({
          value: level,
          label: `${level.charAt(0).toUpperCase() + level.slice(1)} (${count})`,
        })),
    ];
  }, [portals]);

  const ownerTypeOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of portals) {
      if (p.owner_type) counts[p.owner_type] = (counts[p.owner_type] || 0) + 1;
    }
    return [
      { value: '', label: 'All Owner Types' },
      ...Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ value: type, label: `${type} (${count})` })),
    ];
  }, [portals]);

  // Filter + sort
  const filtered = useMemo(() => {
    let result = portals;

    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (p) =>
          (p.name || p.id).toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.url.toLowerCase().includes(q) ||
          p.country_name.toLowerCase().includes(q) ||
          p.owner_name.toLowerCase().includes(q)
      );
    }
    if (platformFilter) result = result.filter((p) => p.platform === platformFilter);
    if (countryFilter) result = result.filter((p) => p.country_name === countryFilter);
    if (govLevelFilter)
      result = result.filter((p) => p.government_level === govLevelFilter);
    if (ownerTypeFilter) result = result.filter((p) => p.owner_type === ownerTypeFilter);

    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.name || a.id).localeCompare(b.name || b.id);
        case 'datasets': {
          const ac = a.dataset_count > 0 ? a.dataset_count : -1;
          const bc = b.dataset_count > 0 ? b.dataset_count : -1;
          return bc - ac;
        }
        case 'country':
          return (a.country_name || '\uffff').localeCompare(b.country_name || '\uffff');
        case 'ownerType':
          return (a.owner_type || '\uffff').localeCompare(b.owner_type || '\uffff');
        default:
          return 0;
      }
    });

    return result;
  }, [portals, query, platformFilter, countryFilter, govLevelFilter, ownerTypeFilter, sortBy]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const clampedPage = Math.min(page, totalPages);
  const paginatedPortals = filtered.slice(
    (clampedPage - 1) * ITEMS_PER_PAGE,
    clampedPage * ITEMS_PER_PAGE
  );

  const goToPage = (newPage: number) => {
    setPage(newPage);
    const params: Record<string, string> = {
      q: query,
      platform: platformFilter,
      country: countryFilter,
      govLevel: govLevelFilter,
      ownerType: ownerTypeFilter,
      sort: sortBy,
      page: newPage.toString(),
    };
    updateUrl(params);
  };

  const clearFilters = () => {
    setQuery('');
    setPlatformFilter('');
    setCountryFilter('');
    setGovLevelFilter('');
    setOwnerTypeFilter('');
    setSortBy('name');
    setPage(1);
    router.replace('/directory?tab=portals', { scroll: false });
  };

  const hasFilters =
    query || platformFilter || countryFilter || govLevelFilter || ownerTypeFilter;

  return (
    <div>
      {/* Summary */}
      <div style={{ marginBottom: '24px' }}>
        <p style={{ ...prose, marginBottom: '8px' }}>
          <strong>{portals.length.toLocaleString()}</strong> open data portals across 2
          platforms &mdash; {socrataCount.toLocaleString()} Socrata &middot;{' '}
          {ckanCount.toLocaleString()} CKAN
        </p>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
          MCP compatibility: Socrata portals work with socrata-mcp-server and odp-mcp
          &middot; CKAN portals work with ckan-mcp-server (ondata)
        </p>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: '24px' }}>
        {/* Search */}
        <div style={{ marginBottom: '12px' }}>
          <input
            type="text"
            placeholder="Search portals..."
            value={query}
            onChange={(e) => setFilter('q', e.target.value, setQuery)}
            style={{
              width: '100%',
              padding: '10px 16px',
              fontSize: '16px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              fontFamily: 'inherit',
              backgroundColor: 'var(--nyc-white)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* Mobile filter toggle */}
        <button
          className="portal-filter-toggle"
          onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
          style={{
            display: 'none',
            width: '100%',
            padding: '10px 16px',
            fontSize: '14px',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            background: 'var(--card-background)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            color: 'var(--text-secondary)',
            marginBottom: '12px',
          }}
        >
          {mobileFiltersOpen ? 'Hide Filters' : 'Show Filters'}
          {hasFilters ? ' (active)' : ''}
        </button>

        {/* Filter row */}
        <div
          className="portal-filters"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center',
          }}
        >
          <FilterDropdown
            label="All Platforms"
            value={platformFilter}
            options={platformOptions}
            onChange={(v) => setFilter('platform', v, setPlatformFilter)}
          />
          <FilterDropdown
            label="All Countries"
            value={countryFilter}
            options={countryOptions}
            onChange={(v) => setFilter('country', v, setCountryFilter)}
          />
          <FilterDropdown
            label="All Levels"
            value={govLevelFilter}
            options={govLevelOptions}
            onChange={(v) => setFilter('govLevel', v, setGovLevelFilter)}
          />
          <FilterDropdown
            label="All Owner Types"
            value={ownerTypeFilter}
            options={ownerTypeOptions}
            onChange={(v) => setFilter('ownerType', v, setOwnerTypeFilter)}
          />
          <FilterDropdown
            label="Name A-Z"
            value={sortBy}
            options={Object.entries(SORT_LABELS).map(([val, lbl]) => ({
              value: val,
              label: lbl,
            }))}
            onChange={(v) => {
              setSortBy(v as PortalSortOption);
              setFilter('sort', v, () => {});
            }}
          />
          {hasFilters && (
            <button
              onClick={clearFilters}
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                background: 'var(--nyc-white)',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontFamily: 'inherit',
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Results count + CSV */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
          {filtered.length === portals.length
            ? `Showing all ${portals.length.toLocaleString()} portals`
            : `Showing ${filtered.length.toLocaleString()} of ${portals.length.toLocaleString()} portals`}
        </p>
        <button
          onClick={() => downloadPortalCsv(filtered)}
          style={{
            padding: '6px 14px',
            fontSize: '13px',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            background: 'var(--nyc-white)',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            fontFamily: 'inherit',
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          Download CSV
        </button>
      </div>

      {/* Table or empty state */}
      {filtered.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '64px 24px',
            color: 'var(--text-muted)',
          }}
        >
          <p style={{ fontSize: '18px', marginBottom: '12px' }}>
            No portals match your filters.
          </p>
          <button
            onClick={clearFilters}
            className="nyc-button nyc-button-secondary"
            style={{ fontSize: '14px', padding: '8px 16px' }}
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Portal</th>
                  <th style={thStyle}>Platform</th>
                  <th style={thStyle}>Country</th>
                  <th style={thStyle}>Owner</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Datasets</th>
                  <th style={thStyle}>Links</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPortals.map((portal) => (
                  <tr key={portal.id}>
                    <td style={tdStyle}>
                      <a
                        href={portal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontWeight: 500, fontSize: '14px' }}
                      >
                        {portal.name || portal.id}
                      </a>
                    </td>
                    <td style={tdStyle}>
                      <PlatformBadge platform={portal.platform} />
                    </td>
                    <td style={tdStyle}>{portal.country_name || '\u2014'}</td>
                    <td style={tdStyle}>{portal.owner_name || '\u2014'}</td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {portal.dataset_count > 0
                        ? portal.dataset_count === 10000
                          ? '10,000+'
                          : portal.dataset_count.toLocaleString()
                        : '\u2014'}
                    </td>
                    <td style={tdStyle}>
                      <a
                        href={portal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: '13px',
                          color: 'var(--nyc-blue)',
                          textDecoration: 'none',
                        }}
                      >
                        Visit
                      </a>
                      {portal.platform === 'ckan' && portal.api_endpoint && (
                        <>
                          {' \u00b7 '}
                          <a
                            href={portal.api_endpoint}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '13px',
                              color: 'var(--nyc-blue)',
                              textDecoration: 'none',
                            }}
                          >
                            API
                          </a>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '12px',
                marginTop: '24px',
                marginBottom: '24px',
              }}
            >
              <button
                onClick={() => goToPage(clampedPage - 1)}
                disabled={clampedPage <= 1}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  background: 'var(--nyc-white)',
                  cursor: clampedPage <= 1 ? 'default' : 'pointer',
                  color:
                    clampedPage <= 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
                  fontFamily: 'inherit',
                  opacity: clampedPage <= 1 ? 0.5 : 1,
                }}
              >
                Previous
              </button>
              <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                Page {clampedPage} of {totalPages}
              </span>
              <button
                onClick={() => goToPage(clampedPage + 1)}
                disabled={clampedPage >= totalPages}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  background: 'var(--nyc-white)',
                  cursor: clampedPage >= totalPages ? 'default' : 'pointer',
                  color:
                    clampedPage >= totalPages
                      ? 'var(--text-muted)'
                      : 'var(--text-secondary)',
                  fontFamily: 'inherit',
                  opacity: clampedPage >= totalPages ? 0.5 : 1,
                }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Mobile filter styles */}
      <style jsx>{`
        @media (max-width: 640px) {
          .portal-filter-toggle {
            display: block !important;
          }
          .portal-filters {
            display: ${mobileFiltersOpen ? 'flex' : 'none'} !important;
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}
