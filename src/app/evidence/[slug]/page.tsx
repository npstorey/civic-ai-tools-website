import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { evidenceRecords, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import type { EvidencePackage } from '@/lib/evidence/packager';
import ProvenanceChain from '@/components/evidence/ProvenanceChain';
import EvidenceActions from '@/components/evidence/EvidenceActions';
import AttestationSection from '@/components/evidence/AttestationSection';
import DashboardLink from '@/components/evidence/DashboardLink';
import ProvenanceGraphSection from '@/components/evidence/ProvenanceGraphSection';
import { formatModelName, estimateCostUsd } from '@/lib/models';

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function getEvidenceData(slug: string) {
  const records = await db
    .select()
    .from(evidenceRecords)
    .where(eq(evidenceRecords.slug, slug))
    .limit(1);
  if (records.length === 0) return null;
  const record = records[0];

  const creator = await db
    .select()
    .from(users)
    .where(eq(users.id, record.creatorId))
    .limit(1);

  let pkg: EvidencePackage | null = null;
  if (record.basePackageStorageKey) {
    pkg = (await getPackage(record.basePackageStorageKey)) as EvidencePackage | null;
  }

  return { record, creator: creator[0] || null, pkg };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getEvidenceData(slug);
  if (!data) return { title: 'Evidence Not Found' };

  const { record, creator } = data;
  const url = `https://civicaitools.org/evidence/${slug}`;
  const description = record.summary.slice(0, 200);

  return {
    title: `Evidence: ${record.title}`,
    description,
    openGraph: {
      title: `Evidence: ${record.title}`,
      description,
      type: 'article',
      url,
    },
    twitter: {
      card: 'summary',
      title: `Evidence: ${record.title}`,
      description,
    },
    other: {
      'citation_title': record.title,
      'citation_author': creator?.displayName || 'Unknown',
      'citation_date': record.createdAt.toISOString().split('T')[0],
      'citation_public_url': url,
    },
  };
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    unverified: { bg: 'rgba(0,0,0,0.06)', text: 'var(--text-muted)' },
    consistency_tested: { bg: 'rgba(16, 63, 239, 0.1)', text: 'var(--nyc-blue)' },
    evaluated: { bg: 'rgba(0, 183, 3, 0.1)', text: 'var(--nyc-success)' },
    fully_attested: { bg: 'rgba(0, 183, 3, 0.15)', text: 'var(--nyc-success)' },
  };
  const c = colors[status] || colors.unverified;
  const label = status.replace(/_/g, ' ');
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: '12px',
      fontSize: '12px', fontWeight: 600, backgroundColor: c.bg, color: c.text,
      textTransform: 'capitalize',
    }}>
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function EvidencePage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getEvidenceData(slug);
  if (!data) notFound();

  const { record, creator, pkg } = data;
  const dateStr = record.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Schema.org JSON-LD
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: record.title,
    description: record.summary,
    creator: { '@type': 'Person', name: creator?.displayName || 'Unknown' },
    datePublished: record.createdAt.toISOString().split('T')[0],
    url: `https://civicaitools.org/evidence/${slug}`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 24px 64px' }}>
        {/* Withdrawal banner */}
        {record.withdrawnAt && (
          <div style={{
            padding: '16px 20px', marginBottom: '24px',
            backgroundColor: 'rgba(236, 19, 30, 0.06)',
            border: '1px solid rgba(236, 19, 30, 0.2)',
            borderRadius: '6px',
          }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--nyc-error)', marginBottom: '6px' }}>
              This evidence was withdrawn by the author on{' '}
              {record.withdrawnAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
            {record.withdrawnReason && (
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                <strong>Reason:</strong> {record.withdrawnReason}
              </div>
            )}
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              The original content and cryptographic proofs are preserved below for transparency.
            </div>
          </div>
        )}

        {/* Header */}
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px', lineHeight: 1.3 }}>
          {record.title}
        </h1>
        <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
          <span>By{' '}
            {creator?.githubProfileUrl ? (
              <a href={creator.githubProfileUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--nyc-blue)', textDecoration: 'none' }}>
                {creator.displayName}
              </a>
            ) : (
              creator?.displayName || 'Unknown'
            )}
          </span>
          <span>{'\u00b7'}</span>
          <span>{dateStr}</span>
        </div>
        {creator?.githubId && (
          <div style={{ marginBottom: '4px' }}>
            <DashboardLink creatorGithubId={creator.githubId} />
          </div>
        )}
        {(record.jurisdiction || record.civicContext) && (
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            {record.jurisdiction && <span>{record.jurisdiction}</span>}
            {record.jurisdiction && record.civicContext && <span> {'\u00b7'} </span>}
            {record.civicContext && <span>{record.civicContext}</span>}
          </div>
        )}

        {/* Summary */}
        <Section title="Summary">
          <div style={{
            padding: '16px 20px', backgroundColor: 'rgba(16, 63, 239, 0.04)',
            borderLeft: '3px solid var(--nyc-blue)', borderRadius: '0 4px 4px 0',
            fontSize: '15px', lineHeight: 1.6, color: 'var(--text-secondary)',
          }}>
            {record.summary}
          </div>
        </Section>

        {/* Verification Status */}
        <Section title="Verification Status">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
            <StatusBadge status={record.verificationStatus} />
            {record.consistencyClassification && (
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Consistency: {record.consistencyClassification.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </Section>

        {/* Provenance Chain */}
        {pkg && (
          <Section title="Provenance Chain">
            <div style={{
              padding: '16px 20px', border: '1px solid var(--border-color)',
              borderRadius: '6px', backgroundColor: 'white',
            }}>
              <ProvenanceChain pkg={pkg} />
            </div>
          </Section>
        )}

        {/* Provenance Graph (W3C PROV-O) */}
        {pkg?.provenance && (
          <Section title="Provenance Graph">
            <ProvenanceGraphSection provenance={pkg.provenance} slug={slug} />
          </Section>
        )}

        {/* Attestations */}
        <Section title="Attestations">
          <AttestationSection
            slug={slug}
            analysisModel={record.model}
            promptVisibility={record.promptVisibility}
          />
        </Section>

        {/* Resources */}
        {pkg && (
          <Section title="Resources Used">
            {(() => {
              const cost = estimateCostUsd(
                pkg.cost.model,
                pkg.cost.promptTokens || 0,
                pkg.cost.completionTokens || 0,
              );
              const skillHash = pkg.skillMetadata.systemPromptHash;
              const items: Array<{ label: string; value: React.ReactNode; mono?: boolean }> = [
                { label: 'Model', value: formatModelName(pkg.cost.model) },
                { label: 'Skill', value: 'Socrata MCP Skill Guidance' },
                ...(skillHash ? [{
                  label: 'Skill hash',
                  value: skillHash.slice(0, 12),
                  mono: true,
                }] : []),
                { label: 'Prompt tokens', value: pkg.cost.promptTokens?.toLocaleString() || '—' },
                { label: 'Completion tokens', value: pkg.cost.completionTokens?.toLocaleString() || '—' },
                { label: 'Total tokens', value: pkg.cost.totalTokens?.toLocaleString() || '—' },
                { label: 'Estimated cost', value: cost !== null ? `~$${cost.toFixed(cost < 0.01 ? 4 : 2)}` : '—' },
                { label: 'Duration', value: pkg.cost.durationMs ? `${(pkg.cost.durationMs / 1000).toFixed(1)}s` : '—' },
                { label: 'Tool calls', value: String(pkg.queries.length) },
              ];
              return (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '12px',
                }}>
                  {items.map((item) => (
                    <div key={item.label} style={{
                      padding: '10px 14px', border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                    }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>
                        {item.label}
                      </div>
                      <div style={{
                        fontSize: item.mono ? '12px' : '14px',
                        color: item.mono ? 'var(--text-muted)' : 'var(--text-primary)',
                        fontWeight: 500,
                        fontFamily: item.mono ? 'monospace' : 'inherit',
                      }}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Section>
        )}

        {/* Actions */}
        <Section title="Actions">
          <EvidenceActions
            slug={slug}
            title={record.title}
            creatorName={creator?.displayName || 'Unknown'}
            createdAt={record.createdAt.toISOString()}
            packageUrl={record.basePackageStorageKey || ''}
            verificationStatus={record.verificationStatus}
          />
        </Section>

        {/* Package hash */}
        {record.basePackageHash && (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            Package hash: {record.basePackageHash}
          </div>
        )}
      </div>
    </>
  );
}
