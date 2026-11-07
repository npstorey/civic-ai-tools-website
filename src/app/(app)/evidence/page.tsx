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
          Published analyses of civic data, made with AI assistance.
          Each analysis includes a full provenance chain — the exact queries, data sources,
          and model outputs — so findings can be independently verified.
        </>
      }
    >
      <EvidenceIndex />
    </Page>
  );
}
