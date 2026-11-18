'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  McpServerEntry,
  CivicDomain,
  GovernmentLevel,
  Transport,
  DataPlatform,
  DOMAIN_LABELS,
  GOVERNMENT_LEVEL_LABELS,
  DATA_PLATFORM_LABELS,
} from '@/lib/mcp/directory-data';
import { prose } from '@/styles/page-styles';
import { Disclosure } from '@/components/ui/Disclosure';
import FilterDropdown from '@/components/directory/FilterDropdown';
import { useHostLinks } from '@/components/HostLinksProvider';
import { useCrossHostSession } from '@/hooks/useCrossHostSession';
import { offeredSourceFor } from '@/lib/directory-source-map';
import type { SessionAffordanceTarget } from '@/lib/allowed-origins';

const SUGGEST_SERVER_URL =
  'https://github.com/npstorey/civic-ai-tools/issues/new?template=suggest-server.yml&labels=directory-submission';

// --- Helpers ---

function buildGitHubProfileUrl(maintainer: string): string {
  if (maintainer.includes(' ') || maintainer.includes('(') || !maintainer.match(/^[a-zA-Z0-9_-]+$/)) {
    return '';
  }
  return `https://github.com/${maintainer}`;
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generateCsv(servers: McpServerEntry[]): string {
  const headers = [
    'Name', 'Description', 'URL', 'Transport', 'Categories', 'Government Level',
    'Data Platform', 'Maintainer', 'Status', 'Verification', 'Jurisdiction',
    'Tool Count', 'API Key Required', 'Data Sources', 'Notes',
  ];
  const rows = servers.map((s) => [
    s.name,
    s.description,
    s.repoUrl,
    s.transport.join('; '),
    s.categories.map((c) => DOMAIN_LABELS[c]).join('; '),
    s.governmentLevel.map((g) => GOVERNMENT_LEVEL_LABELS[g]).join('; '),
    (s.dataPlatform || []).map((p) => DATA_PLATFORM_LABELS[p]).join('; '),
    s.maintainer,
    s.status,
    s.verificationStatus || '',
    s.jurisdiction || '',
    s.toolCount?.toString() || '',
    s.apiKeyRequired === undefined ? '' : s.apiKeyRequired ? 'Yes' : 'No',
    (s.dataSources || []).join('; '),
    s.notes || '',
  ]);
  return [headers, ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\n');
}

function downloadCsv(servers: McpServerEntry[]) {
  const csv = generateCsv(servers);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mcp-server-directory.csv';
  link.click();
  URL.revokeObjectURL(url);
}

type SortOption = 'name' | 'dateAdded' | 'governmentLevel' | 'category';

const SORT_LABELS: Record<SortOption, string> = {
  name: 'Name A-Z',
  dateAdded: 'Recently Added',
  governmentLevel: 'Government Level',
  category: 'Category',
};

// --- Component ---

/** What a row needs to link "Ask with this source" (UX-2 P6 + P10, item 7; 0d items 1 and 9). */
export interface RowActionTargets {
  /** The sources this instance's statement offers, read by the directory page at its render. */
  offeredSourceIds?: readonly string[];
  /** The app host's session probe on a full split topology (`resolveSessionAffordance`), else null. */
  sessionProbe?: SessionAffordanceTarget | null;
  /** Where Ask lives (`resolveAskHref`): `/ask`, or the app origin's `/ask` on a split topology. */
  askHref?: string;
}

export default function DirectoryClient({
  servers,
  portalCounts,
  offeredSourceIds = [],
  sessionProbe = null,
  askHref = '/ask',
}: { servers: McpServerEntry[]; portalCounts?: { socrata: number; ckan: number; total: number } } & RowActionTargets) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // "Ask with this source" (C5 = (b), G0-8, X27; PQ4 = (a), 0d item 1). Signed in (a local session, or the Header's
  // probe of the app host reporting one) it opens /ask with the source; otherwise the home page with it. While the
  // probe is pending, or after it fails, the row links the home page.
  const { data: session } = useSession();
  const { marketingOrigin } = useHostLinks();
  const probedIn = useCrossHostSession(sessionProbe?.statusUrl ?? null, !session);
  const signedIn = Boolean(session) || probedIn;
  const actionHref = (sourceId: string) =>
    signedIn ? `${askHref}?source=${encodeURIComponent(sourceId)}` : `${marketingOrigin ?? ''}/?source=${encodeURIComponent(sourceId)}`;
  const siteSourceOf = useCallback((server: McpServerEntry) => offeredSourceFor(server.id, offeredSourceIds), [offeredSourceIds]);

  // Read initial state from URL
  const initialQ = searchParams.get('q') || '';
  const initialDomain = searchParams.get('domain') || '';
  const initialLevel = searchParams.get('level') || '';
  const initialTransport = searchParams.get('transport') || '';
  const initialOfficial = searchParams.get('official') === 'true';
  const initialPlatform = searchParams.get('platform') || '';
  const initialSort = (searchParams.get('sort') as SortOption) || 'name';

  const [query, setQuery] = useState(initialQ);
  const [domainFilter, setDomainFilter] = useState(initialDomain);
  const [levelFilter, setLevelFilter] = useState(initialLevel);
  const [transportFilter, setTransportFilter] = useState(initialTransport);
  const [officialOnly, setOfficialOnly] = useState(initialOfficial);
  const [platformFilter, setPlatformFilter] = useState(initialPlatform);
  const [sortBy, setSortBy] = useState<SortOption>(initialSort);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Sync URL params
  const updateUrl = useCallback(
    (params: Record<string, string>) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v) sp.set(k, v);
      }
      const qs = sp.toString();
      router.replace(qs ? `/directory?${qs}` : '/directory', { scroll: false });
    },
    [router]
  );

  const setFilter = useCallback(
    (key: string, value: string, setter: (v: string) => void) => {
      setter(value);
      const params: Record<string, string> = {
        q: key === 'q' ? value : query,
        domain: key === 'domain' ? value : domainFilter,
        level: key === 'level' ? value : levelFilter,
        transport: key === 'transport' ? value : transportFilter,
        official: key === 'official' ? value : officialOnly ? 'true' : '',
        platform: key === 'platform' ? value : platformFilter,
        sort: key === 'sort' ? value : sortBy,
      };
      updateUrl(params);
    },
    [query, domainFilter, levelFilter, transportFilter, officialOnly, platformFilter, sortBy, updateUrl]
  );

  // Compute available domain options with counts
  const domainOptions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of servers) {
      for (const c of s.categories) {
        counts[c] = (counts[c] || 0) + 1;
      }
    }
    return [
      { value: '', label: 'All Domains' },
      ...Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([domain, count]) => ({
          value: domain,
          label: `${DOMAIN_LABELS[domain as CivicDomain] || domain} (${count})`,
        })),
    ];
  }, [servers]);

  // Filter + sort
  const filtered = useMemo(() => {
    let result = servers;

    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          (s.dataSources || []).some((d) => d.toLowerCase().includes(q)) ||
          (s.tags || []).some((t) => t.toLowerCase().includes(q)) ||
          (s.jurisdiction || '').toLowerCase().includes(q) ||
          (s.notes || '').toLowerCase().includes(q) ||
          s.maintainer.toLowerCase().includes(q)
      );
    }

    if (domainFilter) {
      result = result.filter((s) => s.categories.includes(domainFilter as CivicDomain));
    }
    if (levelFilter) {
      result = result.filter((s) => s.governmentLevel.includes(levelFilter as GovernmentLevel));
    }
    if (transportFilter) {
      result = result.filter((s) => s.transport.includes(transportFilter as Transport));
    }
    if (platformFilter) {
      result = result.filter((s) => (s.dataPlatform || []).includes(platformFilter as DataPlatform));
    }
    if (officialOnly) {
      result = result.filter((s) => s.verificationStatus === 'official');
    }

    // This site's own sources first (D-14 (i)): the rows that carry the action, never the index's `included` flag.
    result = [...result].sort((a, b) => {
      const aSite = siteSourceOf(a) !== null;
      const bSite = siteSourceOf(b) !== null;
      if (aSite && !bSite) return -1;
      if (!aSite && bSite) return 1;
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'dateAdded':
          return (b.dateAdded || '').localeCompare(a.dateAdded || '');
        case 'governmentLevel':
          return (a.governmentLevel[0] || '').localeCompare(b.governmentLevel[0] || '');
        case 'category':
          return (a.categories[0] || '').localeCompare(b.categories[0] || '');
        default:
          return 0;
      }
    });

    return result;
  }, [servers, query, domainFilter, levelFilter, transportFilter, platformFilter, officialOnly, sortBy, siteSourceOf]);

  const clearFilters = () => {
    setQuery('');
    setDomainFilter('');
    setLevelFilter('');
    setTransportFilter('');
    setPlatformFilter('');
    setOfficialOnly(false);
    setSortBy('name');
    router.replace('/directory', { scroll: false });
  };

  const hasFilters = query || domainFilter || levelFilter || transportFilter || platformFilter || officialOnly;

  return (
    <div>
      {/* Banner */}
      {portalCounts && (
        <div style={{
          backgroundColor: 'var(--card-background)',
          padding: '12px 16px',
          borderRadius: '4px',
          fontSize: '14px',
          color: 'var(--text-secondary)',
          marginBottom: '20px',
          lineHeight: '1.5',
        }}>
          {/* D-13 (DIR = A): the counts are the portal lists' lengths, not portals a server was shown to reach. */}
          Some of these MCP servers read data from Socrata or CKAN portals. The Data Portals tab lists{' '}
          {portalCounts.socrata.toLocaleString()} Socrata portals and{' '}
          {portalCounts.ckan.toLocaleString()} CKAN portals worldwide.{' '}
          <button
            onClick={() => router.replace('/directory?tab=portals', { scroll: false })}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              fontWeight: 500,
              fontSize: '14px',
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'inherit',
            }}
          >
            Browse Data Portals &rarr;
          </button>
        </div>
      )}

      {/* Subtitle + CTA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' }}>
        <p style={{ ...prose, margin: 0 }}>
          {/* UX-2-FIX P3, D7 = A: no count here; the line under the title states it. */}
          MCP servers for civic and public data &mdash; open data portals, census,
          legislation, health, geospatial, and more.
        </p>
        <a
          href={SUGGEST_SERVER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ui-button ui-button-secondary"
          style={{ fontSize: '14px', padding: '8px 16px', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Suggest a Server
        </a>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: '32px' }}>
        {/* Search — always visible */}
        <div style={{ marginBottom: '16px' }}>
          <input
            type="text"
            placeholder="Search servers..."
            value={query}
            onChange={(e) => setFilter('q', e.target.value, setQuery)}
            style={{
              width: '100%',
              padding: '10px 16px',
              fontSize: '16px',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              fontFamily: 'inherit',
              backgroundColor: 'var(--white)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* The filters (R14; 0d item 6): below 640 px a Disclosure, "Show Filters" / "Hide Filters"; at 640 px and up,
            in a browser with ::details-content, its summary is hidden and the filters always show; without it the
            Disclosure stays (globals.css, \`.directory-filter-toggle\`, #791). */}
        <div className="directory-filter-toggle">
        <Disclosure
          summary={`${mobileFiltersOpen ? 'Hide Filters' : 'Show Filters'}${hasFilters ? ' (active)' : ''}`}
          open={mobileFiltersOpen}
          onToggle={setMobileFiltersOpen}
        >
        {/* Filter row */}
        <div
          className="directory-filters"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center',
          }}
        >
          <FilterDropdown
            label="All Domains"
            value={domainFilter}
            options={domainOptions}
            onChange={(v) => setFilter('domain', v, setDomainFilter)}
          />
          <FilterDropdown
            label="All Levels"
            value={levelFilter}
            options={[
              { value: '', label: 'All Levels' },
              ...(['local', 'state', 'federal', 'international', 'global', 'multi'] as GovernmentLevel[]).map(
                (g) => ({ value: g, label: GOVERNMENT_LEVEL_LABELS[g] })
              ),
            ]}
            onChange={(v) => setFilter('level', v, setLevelFilter)}
          />
          <FilterDropdown
            label="All Transports"
            value={transportFilter}
            options={[
              { value: '', label: 'All Transports' },
              { value: 'stdio', label: 'stdio' },
              { value: 'http', label: 'HTTP' },
              { value: 'sse', label: 'SSE' },
            ]}
            onChange={(v) => setFilter('transport', v, setTransportFilter)}
          />
          <FilterDropdown
            label="All Platforms"
            value={platformFilter}
            options={[
              { value: '', label: 'All Platforms' },
              ...(['socrata', 'ckan', 'arcgis', 'data-commons', 'custom-api'] as DataPlatform[]).map(
                (p) => ({ value: p, label: DATA_PLATFORM_LABELS[p] })
              ),
            ]}
            onChange={(v) => setFilter('platform', v, setPlatformFilter)}
          />
          <FilterDropdown
            label="Name A-Z"
            value={sortBy}
            options={Object.entries(SORT_LABELS).map(([val, label]) => ({ value: val, label }))}
            onChange={(v) => {
              setSortBy(v as SortOption);
              setFilter('sort', v, () => {});
            }}
          />

          {/* Official only */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '14px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <input
              type="checkbox"
              checked={officialOnly}
              onChange={(e) => {
                setOfficialOnly(e.target.checked);
                setFilter('official', e.target.checked ? 'true' : '', () => {});
              }}
              style={{ cursor: 'pointer' }}
            />
            Official only
          </label>

          {hasFilters && (
            <button
              onClick={clearFilters}
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                background: 'var(--white)',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontFamily: 'inherit',
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        </Disclosure>
        </div>
      </div>

      {/* Results count + CSV download */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
          {filtered.length === servers.length
            ? `Showing all ${servers.length} servers`
            : `Showing ${filtered.length} of ${servers.length} servers`}
        </p>
        <button
          onClick={() => downloadCsv(filtered)}
          style={{
            padding: '6px 14px',
            fontSize: '13px',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            background: 'var(--white)',
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

      {/* Server grid */}
      {filtered.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '64px 24px',
            color: 'var(--text-muted)',
          }}
        >
          <p style={{ fontSize: '18px', marginBottom: '12px' }}>
            No servers match your filters.
          </p>
          <button
            onClick={clearFilters}
            className="ui-button ui-button-secondary"
            style={{ fontSize: '14px', padding: '8px 16px' }}
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '16px',
            marginBottom: '48px',
          }}
        >
          {filtered.map((server) => (
            <ServerCard key={server.id} server={server} siteSource={siteSourceOf(server)} actionHref={actionHref} />
          ))}
        </div>
      )}

      {/* Coverage Gaps */}
      <section style={{ marginTop: '48px', paddingTop: '32px', borderTop: '1px solid var(--border-color)' }}>
        <h2 style={{ marginBottom: '16px', fontSize: '28px' }}>Coverage Gaps</h2>
        <p style={prose}>
          These civic data domains have limited or no MCP server coverage:
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
            gap: '12px',
            marginBottom: '24px',
          }}
        >
          {COVERAGE_GAPS.map((gap) => (
            <div
              key={gap.domain}
              style={{
                border: '1px dashed var(--border-color)',
                borderRadius: '4px',
                padding: '16px',
              }}
            >
              <h4 style={{ fontSize: '15px', marginBottom: '4px' }}>{gap.domain}</h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                {gap.note}
              </p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '14px' }}>
          Know of a server that fills one of these gaps?{' '}
          <a
            href={SUGGEST_SERVER_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Suggest a server
          </a>
          {' '}or{' '}
          <a
            href="https://github.com/npstorey/civic-ai-tools/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            open an issue on GitHub
          </a>
        </p>
      </section>

    </div>
  );
}

// --- ServerCard ---

/** The neutral pair every platform, transport and Commercial badge takes (PQ8 = (a)): 10.89:1 on the light tokens. */
const NEUTRAL_BADGE = { color: 'var(--text-secondary)', bg: 'var(--card-background)' } as const;

function ServerCard({
  server,
  siteSource,
  actionHref,
}: {
  server: McpServerEntry;
  /** The offered source this entry is (D-14 (i), item 7), or null. */
  siteSource: string | null;
  actionHref: (sourceId: string) => string;
}) {
  const profileUrl = buildGitHubProfileUrl(server.maintainer);

  return (
    <div
      data-server={server.id}
      style={{
        border: `1px solid ${siteSource ? 'var(--accent)' : 'var(--border-color)'}`,
        borderRadius: '4px',
        padding: '20px',
        backgroundColor: siteSource ? 'rgba(var(--accent-rgb), 0.03)' : 'var(--background)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {/* Name + badges row */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
          <a
            href={server.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '17px', fontWeight: 600, textDecoration: 'none' }}
          >
            {server.name}
          </a>
          {siteSource && <Badge color="var(--accent)" bg="rgba(var(--accent-rgb), 0.1)">{"This site's data source"}</Badge>}
          {server.verificationStatus === 'official' && (
            <Badge color="var(--success)" bg="rgba(var(--success-rgb), 0.1)">Official</Badge>
          )}
          {server.verificationStatus === 'commercial' && (
            <Badge color={NEUTRAL_BADGE.color} bg={NEUTRAL_BADGE.bg}>Commercial</Badge>
          )}
        </div>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
          {server.description}
        </p>
      </div>

      {/* Transport + platform badges */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {server.transport.map((t) => (
          <Badge key={t} color={NEUTRAL_BADGE.color} bg={NEUTRAL_BADGE.bg}>
            {t}
          </Badge>
        ))}
        {(server.dataPlatform || [])
          .filter((p) => p !== 'custom-api')
          .map((p) => (
            <Badge key={p} color={NEUTRAL_BADGE.color} bg={NEUTRAL_BADGE.bg}>
              {DATA_PLATFORM_LABELS[p]}
            </Badge>
          ))}
      </div>

      {/* Categories */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {server.categories.map((cat) => (
          <span
            key={cat}
            style={{
              fontSize: '11px',
              padding: '2px 6px',
              borderRadius: '3px',
              backgroundColor: 'var(--card-background)',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            {DOMAIN_LABELS[cat]}
          </span>
        ))}
      </div>

      {/* Meta row */}
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        {server.governmentLevel.length > 0 && (
          <span>
            {server.governmentLevel.map((g) => GOVERNMENT_LEVEL_LABELS[g]).join(', ')}
          </span>
        )}
        {server.jurisdiction && <span>{server.jurisdiction}</span>}
        {server.toolCount && <span>{server.toolCount}+ tools</span>}
        {server.apiKeyRequired !== undefined && (
          <span>{server.apiKeyRequired ? 'API key required' : 'No API key'}</span>
        )}
      </div>

      {/* Maintainer */}
      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
        Maintainer:{' '}
        {profileUrl ? (
          <a href={profileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px' }}>
            @{server.maintainer}
          </a>
        ) : (
          server.maintainer
        )}
      </div>

      {/* Action links */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'baseline', marginTop: 'auto', paddingTop: '4px' }}>
        {/* C5 = (b), X27: the one in-app action, on this site's own sources only. UX-2-FIX P3, D4 = A: set apart from
            the new-tab links beside it by its look, a small outlined button-shaped link. */}
        {siteSource && (
          <Link
            href={actionHref(siteSource)}
            className="directory-row-action"
            style={{
              display: 'inline-block',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--accent)',
              textDecoration: 'none',
              border: '1px solid var(--accent)',
              borderRadius: '4px',
              padding: '4px 10px',
            }}
          >
            Ask with this source
          </Link>
        )}
        <ActionLink href={server.repoUrl} label="GitHub" />
        {server.docsUrl && <ActionLink href={server.docsUrl} label="Docs" />}
        {server.npmPackage && (
          <ActionLink
            href={`https://www.npmjs.com/package/${server.npmPackage}`}
            label="npm"
          />
        )}
        {server.endpointUrl && <ActionLink href={server.endpointUrl} label="Endpoint" />}
      </div>
    </div>
  );
}

// --- Small components ---

function Badge({
  children,
  color,
  bg,
}: {
  children: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <span
      style={{
        fontSize: '11px',
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: '3px',
        color,
        backgroundColor: bg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        fontSize: '12px',
        fontWeight: 500,
        color: 'var(--accent)',
        textDecoration: 'none',
      }}
    >
      {label}
    </a>
  );
}

// --- Static data ---

const COVERAGE_GAPS = [
  { domain: 'Elections & Voting Results', note: 'Campaign finance (FEC) is covered, but actual election results are not.' },
  { domain: 'Universal Transit (GTFS)', note: 'International coverage exists but US-specific GTFS coverage is still missing.' },
  { domain: 'Local 311 & Permits', note: 'No dedicated Open311 or municipal permit server found.' },
  { domain: 'Zoning & Land Use', note: 'Highly local, fragmented municipal data.' },
  { domain: 'Property Records', note: 'Parcel data, assessments, ownership from county assessors.' },
];
