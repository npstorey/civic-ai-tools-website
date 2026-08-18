import { Suspense } from 'react';
import { getDirectoryData } from '@/lib/mcp/directory-data';
import { getPortalData, getPortalCounts } from '@/lib/mcp/portal-data';
import DirectoryWrapper from '@/components/DirectoryWrapper';
import { pageTitle } from '@/lib/brand-config';
import { directorySourceNote } from '@/lib/content-source';

export const metadata = {
  title: pageTitle('Directory'),
  description:
    'Browse 65+ MCP servers for civic data and 2,000+ open data portals across Socrata and CKAN platforms.',
};

export default async function DirectoryPage() {
  const [directory, portals, portalCounts] = await Promise.all([
    getDirectoryData(),
    getPortalData(),
    getPortalCounts(),
  ]);

  // A curated index of public MCP servers is a shared resource, so an
  // instance with no directory of its own keeps serving the community index
  // — and says whose it is (#241). Computed here, server-side, because the
  // wrapper below is a client component.
  const sourceNote = directorySourceNote(directory.provenance, directory.sourceUrl);

  return (
    <Suspense>
      <DirectoryWrapper
        servers={directory.servers}
        portals={portals}
        portalCounts={portalCounts}
        sourceNote={sourceNote}
      />
    </Suspense>
  );
}
