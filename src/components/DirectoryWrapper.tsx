'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import DirectoryClient from './DirectoryClient';
import PortalDirectoryClient from './PortalDirectoryClient';
import type { McpServerEntry } from '@/lib/mcp/directory-data';
import type { PortalEntry, PortalCounts } from '@/lib/mcp/portal-data';
import { prose } from '@/styles/page-styles';
import type { CSSProperties } from 'react';

export default function DirectoryWrapper({
  servers,
  portals,
  portalCounts,
}: {
  servers: McpServerEntry[];
  portals: PortalEntry[];
  portalCounts: PortalCounts;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get('tab') === 'portals' ? 'portals' : 'servers';

  const switchTab = (tab: 'servers' | 'portals') => {
    router.replace(tab === 'portals' ? '/directory?tab=portals' : '/directory', { scroll: false });
  };

  const tabStyle = (isActive: boolean): CSSProperties => ({
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: isActive ? 600 : 400,
    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
    border: 'none',
    borderBottom: isActive ? '2px solid var(--nyc-blue)' : '2px solid transparent',
    marginBottom: '-2px',
    background: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  });

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 24px' }}>
      {/* Page title */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ marginBottom: '12px' }}>Directory</h1>
        <p style={{ ...prose, marginBottom: 0 }}>
          Browse {servers.length}+ MCP servers and {portalCounts.total.toLocaleString()} open data
          portals for civic data.
        </p>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '2px solid var(--border-color)',
          marginBottom: '32px',
        }}
      >
        <button onClick={() => switchTab('servers')} style={tabStyle(activeTab === 'servers')}>
          MCP Servers ({servers.length})
        </button>
        <button onClick={() => switchTab('portals')} style={tabStyle(activeTab === 'portals')}>
          Data Portals ({portalCounts.total.toLocaleString()})
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'portals' ? (
        <PortalDirectoryClient portals={portals} />
      ) : (
        <DirectoryClient servers={servers} portalCounts={portalCounts} />
      )}
    </div>
  );
}
