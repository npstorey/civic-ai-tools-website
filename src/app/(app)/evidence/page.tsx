import type { Metadata } from 'next';
import EvidenceIndex from '@/components/evidence/EvidenceIndex';
import { pageTitle } from '@/lib/brand-config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: pageTitle('Records'),
  description: 'Published record packages from AI-assisted civic data analyses.',
};

export default function EvidenceIndexPage() {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 24px 64px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>Records</h1>
      <p style={{ fontSize: '16px', color: 'var(--text-secondary)', marginBottom: '32px', lineHeight: 1.6 }}>
        Published record packages from AI-assisted civic data analyses.
        Each record includes a full provenance chain — the exact queries, data sources,
        and model outputs — so findings can be independently verified.
      </p>
      <EvidenceIndex />
    </div>
  );
}
