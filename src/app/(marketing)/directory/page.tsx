import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getDirectoryData } from '@/lib/mcp/directory-data';
import { getPortalData, getPortalCounts } from '@/lib/mcp/portal-data';
import DirectoryWrapper from '@/components/DirectoryWrapper';
import { pageTitle } from '@/lib/brand-config';
import { directorySourceNote } from '@/lib/content-source';
import { buildFlowsStatement } from '@/lib/flows/statement';
import { resolveSessionAffordance } from '@/lib/allowed-origins';
import { resolveAskHref } from '@/lib/host-routing';

// The counts are read from the data this page renders, not typed in: "65+"
// and "2,000+" had gone stale (74 servers, 1,960 portals on 2026-10-10).
export async function generateMetadata(): Promise<Metadata> {
  const [directory, portalCounts] = await Promise.all([getDirectoryData(), getPortalCounts()]);
  return {
    title: pageTitle('Directory'),
    description: `Browse ${directory.servers.length} MCP servers for civic data and ${portalCounts.total.toLocaleString('en-US')} open data portals across Socrata and CKAN platforms.`,
  };
}

export default async function DirectoryPage() {
  const [directory, portals, portalCounts, statement] = await Promise.all([
    getDirectoryData(),
    getPortalData(),
    getPortalCounts(),
    buildFlowsStatement(),
  ]);
  // "Ask with this source" (UX-2 P6 + P10, item 7; 0d items 1 and 9): the sources this instance offers, read from its
  // statement when the page renders (at build, then on each revalidation), and where a signed-in row links: the app
  // host's session probe and Ask's address, as the root layout resolves them for the Header.
  const offeredSourceIds = statement.sources.map((source) => source.sourceId);
  const sessionProbe = resolveSessionAffordance(process.env);
  const askHref = resolveAskHref(process.env);

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
        offeredSourceIds={offeredSourceIds}
        sessionProbe={sessionProbe}
        askHref={askHref}
      />
    </Suspense>
  );
}
