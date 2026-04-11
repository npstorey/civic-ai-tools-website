import Link from 'next/link';
import { db } from '@/lib/db';
import { evidenceRecords, users } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Evidence - Civic AI Tools',
  description: 'Published evidence packages from AI-assisted civic data analyses.',
};

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    unverified: { bg: 'rgba(0,0,0,0.06)', text: 'var(--text-muted)' },
    consistency_tested: { bg: 'rgba(16, 63, 239, 0.1)', text: 'var(--nyc-blue)' },
    evaluated: { bg: 'rgba(0, 183, 3, 0.1)', text: 'var(--nyc-success)' },
    fully_attested: { bg: 'rgba(0, 183, 3, 0.15)', text: 'var(--nyc-success)' },
  };
  const c = colors[status] || colors.unverified;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
      fontSize: '11px', fontWeight: 600, backgroundColor: c.bg, color: c.text,
      textTransform: 'capitalize',
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default async function EvidenceIndexPage() {
  const records = await db
    .select({
      id: evidenceRecords.id,
      slug: evidenceRecords.slug,
      title: evidenceRecords.title,
      summary: evidenceRecords.summary,
      model: evidenceRecords.model,
      verificationStatus: evidenceRecords.verificationStatus,
      createdAt: evidenceRecords.createdAt,
      creatorId: evidenceRecords.creatorId,
    })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.isPublic, true))
    .orderBy(desc(evidenceRecords.createdAt))
    .limit(50);

  // Batch-fetch creators
  const creatorIds = [...new Set(records.map(r => r.creatorId))];
  const creators = creatorIds.length > 0
    ? await db.select().from(users)
    : [];
  const creatorMap = new Map(creators.map(c => [c.id, c]));

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 24px 64px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>Evidence</h1>
      <p style={{ fontSize: '16px', color: 'var(--text-secondary)', marginBottom: '32px', lineHeight: 1.6 }}>
        Published evidence packages from AI-assisted civic data analyses.
        Each record includes a full provenance chain — the exact queries, data sources,
        and model outputs — so findings can be independently verified.
      </p>

      {records.length === 0 ? (
        <div style={{
          padding: '32px', border: '1px solid var(--border-color)', borderRadius: '6px',
          textAlign: 'center', color: 'var(--text-muted)',
        }}>
          <p style={{ fontSize: '16px', margin: '0 0 8px' }}>No evidence packages published yet.</p>
          <p style={{ fontSize: '14px', margin: 0 }}>
            Run a query on the <Link href="/" style={{ color: 'var(--nyc-blue)' }}>home page</Link> and
            click &ldquo;Publish as Evidence&rdquo; to create the first one.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {records.map((r) => {
            const creator = creatorMap.get(r.creatorId);
            const dateStr = r.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            return (
              <Link
                key={r.id}
                href={`/evidence/${r.slug}`}
                style={{
                  display: 'block', padding: '16px 20px',
                  border: '1px solid var(--border-color)', borderRadius: '6px',
                  textDecoration: 'none', color: 'inherit',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onMouseOver={(e: React.MouseEvent<HTMLAnchorElement>) => {
                  e.currentTarget.style.borderColor = 'var(--nyc-blue)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(16, 63, 239, 0.1)';
                }}
                onMouseOut={(e: React.MouseEvent<HTMLAnchorElement>) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '6px' }}>
                  <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
                    {r.title}
                  </h2>
                  <StatusBadge status={r.verificationStatus} />
                </div>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.5 }}>
                  {r.summary.slice(0, 200)}{r.summary.length > 200 ? '...' : ''}
                </p>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span>{creator?.displayName || 'Unknown'}</span>
                  <span>{'\u00b7'}</span>
                  <span>{dateStr}</span>
                  <span>{'\u00b7'}</span>
                  <span>{r.model}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
