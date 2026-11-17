import type { Metadata } from 'next';
import EvidenceIndex from '@/components/evidence/EvidenceIndex';
import { pageTitle } from '@/lib/brand-config';
import { Page } from '@/components/ui/Page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: pageTitle('Analysis'),
  description: 'Published analyses of civic data, made with AI assistance.',
};

export default function EvidenceIndexPage() {
  return (
    <Page
      width="record"
      title="Analysis"
      lede={
        <>
          {/* P10-48 (C1 = A). */}
          Published analyses of civic data, made with AI assistance. Each one records its queries, data sources and
          model, and says where something was not recorded. Anyone can check that an analysis is unchanged.
        </>
      }
    >
      <EvidenceIndex />
    </Page>
  );
}
