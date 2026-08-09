import { Suspense } from 'react';
import { getDirectoryData } from '@/lib/mcp/directory-data';
import { getPortalData, getPortalCounts } from '@/lib/mcp/portal-data';
import DirectoryWrapper from '@/components/DirectoryWrapper';
import { getBrandName } from '@/lib/brand-config';

export const metadata = {
  title: `Directory - ${getBrandName()}`,
  description:
    'Browse 65+ MCP servers for civic data and 2,000+ open data portals across Socrata and CKAN platforms.',
};

export default async function DirectoryPage() {
  const [servers, portals, portalCounts] = await Promise.all([
    getDirectoryData(),
    getPortalData(),
    getPortalCounts(),
  ]);

  return (
    <Suspense>
      <DirectoryWrapper
        servers={servers}
        portals={portals}
        portalCounts={portalCounts}
      />
    </Suspense>
  );
}
