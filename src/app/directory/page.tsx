import { Suspense } from 'react';
import { getDirectoryData } from '@/lib/mcp/directory-data';
import DirectoryClient from '@/components/DirectoryClient';

export const metadata = {
  title: 'MCP Server Directory - Civic AI Tools',
  description:
    'Browse 65+ MCP servers for civic and public data — open data portals, census, legislation, health, geospatial, and more. Filter by domain, government level, and transport.',
};

export default async function DirectoryPage() {
  const servers = await getDirectoryData();
  return (
    <Suspense>
      <DirectoryClient servers={servers} />
    </Suspense>
  );
}
