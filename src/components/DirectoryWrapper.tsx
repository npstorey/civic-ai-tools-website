'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import DirectoryClient, { type RowActionTargets } from './DirectoryClient';
import PortalDirectoryClient from './PortalDirectoryClient';
import type { McpServerEntry } from '@/lib/mcp/directory-data';
import type { PortalEntry, PortalCounts } from '@/lib/mcp/portal-data';
import type { DirectorySourceNote } from '@/lib/content-source';
import { prose } from '@/styles/page-styles';
import { Tabs } from '@/components/ui/Tabs';

export default function DirectoryWrapper({
  servers,
  portals,
  portalCounts,
  sourceNote = null,
  offeredSourceIds,
  sessionProbe,
  askHref,
}: RowActionTargets & {
  servers: McpServerEntry[];
  portals: PortalEntry[];
  portalCounts: PortalCounts;
  /** Attribution for entries that are not this instance's own (#241);
   *  `null` — the default, and the case for a configured instance — renders
   *  no note at all. Resolved server-side by the page. */
  sourceNote?: DirectorySourceNote | null;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get('tab') === 'portals' ? 'portals' : 'servers';

  const switchTab = (tab: 'servers' | 'portals') => {
    router.replace(tab === 'portals' ? '/directory?tab=portals' : '/directory', { scroll: false });
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 24px' }}>
      {/* Page title */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ marginBottom: '12px' }}>Directory</h1>
        <p style={{ ...prose, marginBottom: 0 }}>
          {/* D-12 (DIR = A): the list's own count; the tab beside it states the same number. */}
          Browse {servers.length} MCP servers and {portalCounts.total.toLocaleString()} open data
          portals for civic data.
        </p>
        {sourceNote && (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '12px 0 0 0' }}>
            {sourceNote.kind === 'community' ? (
              <>
                The MCP server entries come from{' '}
                <a href={sourceNote.source.href} target="_blank" rel="noopener noreferrer">
                  {sourceNote.source.label}
                </a>
                , a shared community index maintained by that project rather than by this site.
              </>
            ) : (
              <>
                The MCP server entries are the community snapshot bundled with this codebase — the
                live directory source could not be loaded.
              </>
            )}
          </p>
        )}
      </div>

      {/* The two tabs on the site's Tabs (P8; UX-2 P6 item 1); the selection stays the address's \`?tab=\`. */}
      <div style={{ marginBottom: '32px' }}>
        <Tabs
          label="Directory"
          tabs={[
            { id: 'servers', label: `MCP Servers (${servers.length})` },
            { id: 'portals', label: `Data Portals (${portalCounts.total.toLocaleString()})` },
          ]}
          selectedId={activeTab}
          onSelect={(id) => switchTab(id === 'portals' ? 'portals' : 'servers')}
        />
      </div>

      {/* Tab content */}
      {activeTab === 'portals' ? (
        <PortalDirectoryClient portals={portals} />
      ) : (
        <DirectoryClient
          servers={servers}
          portalCounts={portalCounts}
          offeredSourceIds={offeredSourceIds}
          sessionProbe={sessionProbe}
          askHref={askHref}
        />
      )}
    </div>
  );
}
