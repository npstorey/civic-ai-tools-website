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
import NotebookSection from '@/components/evidence/NotebookSection';
import SkillSection from '@/components/evidence/SkillSection';
import { formatModelName, estimateCostUsd } from '@/lib/models';
import { formatDataSourcesSummary } from '@/lib/evidence/data-sources';
import { isBlobRef, fetchBlobRefText, type BlobRef } from '@/lib/evidence/blob-ref';

const NOTEBOOK_EXTENSION_KEY = 'org.civicaitools.notebook';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Server-side resolution for blob-referenced fields in an evidence package.
 *  `output` is eagerly fetched so the ProvenanceChain can continue to
 *  treat it as a string. `skillMetadata.skillText` is handed through as a
 *  reference when it's a BlobRef — the skill section expands on click and
 *  fetches lazily, so there's no point paying the latency up front. */
interface ResolvedPackageData {
  pkg: EvidencePackage;
  outputIsBlob: boolean;
  outputBlobRef: BlobRef | null;
  skillTextIsBlob: boolean;
  skillTextBlobRef: BlobRef | null;
}

async function resolvePackageForRender(pkg: EvidencePackage): Promise<ResolvedPackageData> {
  const outputIsBlob = isBlobRef(pkg.output);
  const outputBlobRef = outputIsBlob ? (pkg.output as BlobRef) : null;
  let resolvedOutput: string;
  if (outputIsBlob) {
    resolvedOutput =
      (await fetchBlobRefText(pkg.output as BlobRef)) ??
      '[Output blob could not be fetched; see the Package hash below to audit.]';
  } else {
    resolvedOutput = pkg.output as string;
  }

  const skillText = pkg.skillMetadata?.skillText;
  const skillTextIsBlob = skillText !== undefined && isBlobRef(skillText);
  const skillTextBlobRef = skillTextIsBlob ? (skillText as BlobRef) : null;

  // Shallow-clone the package with the resolved output so child components
  // can keep treating `pkg.output` as a plain string.
  const resolved: EvidencePackage = {
    ...pkg,
    output: resolvedOutput,
    skillMetadata: {
      ...pkg.skillMetadata,
      // When skillText is a BlobRef, keep the reference so the SkillSection
      // can surface it rather than rendering `[object Object]`. The section
      // fetches bytes on demand.
      skillText: skillTextIsBlob ? undefined : (skillText as string | undefined),
    },
  };
  return {
    pkg: resolved,
    outputIsBlob,
    outputBlobRef,
    skillTextIsBlob,
    skillTextBlobRef,
  };
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
  let resolution: ResolvedPackageData | null = null;
  if (record.basePackageStorageKey) {
    pkg = (await getPackage(record.basePackageStorageKey)) as EvidencePackage | null;
    if (pkg) {
      resolution = await resolvePackageForRender(pkg);
    }
  }

  return { record, creator: creator[0] || null, pkg, resolution };
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

// Human-readable label for the ADR-0003 captureMethod field. Pre-ADR
// records (column null) render as "Unknown (pre-ADR-0003)" rather than
// inferring a method from indirect signals — see ADR-0003 §1 amendment.
function captureMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case 'chat-flow-stream':
      return 'Chat flow (verbatim stream)';
    case 'claude-code-jsonl-readback':
      return 'Claude Code (verbatim JSONL)';
    case 'claude-code-self-report':
      return 'Claude Code (self-report, deprecated)';
    default:
      return 'Unknown (pre-ADR-0003)';
  }
}

export default async function EvidencePage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getEvidenceData(slug);
  if (!data) notFound();

  const { record, creator, pkg, resolution } = data;
  // Use the resolved package everywhere we render package content — it has
  // BlobRef outputs eagerly pulled into strings so child components can stay
  // ignorant of the reference layer. When the package isn't a BlobRef user
  // (the vast majority of historical records), `resolution.pkg === pkg`
  // modulo the shallow clone.
  const renderPkg = resolution?.pkg ?? pkg;
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
        {/* Withdrawal banner — only shown when currently withdrawn (not reinstated) */}
        {record.withdrawnAt && !record.reinstatedAt && (
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
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Captured via: {captureMethodLabel(record.captureMethod)}
            </span>
          </div>
        </Section>

        {/* Status History — shown when the record has a withdrawal/reinstatement cycle */}
        {record.withdrawnAt && (
          <Section title="Status History">
            <div style={{
              padding: '16px 20px', border: '1px solid var(--border-color)',
              borderRadius: '6px', backgroundColor: 'white',
              fontSize: '13px', lineHeight: 1.7, color: 'var(--text-secondary)',
            }}>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Published</strong>
                {' on '}
                {record.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Withdrawn</strong>
                {' on '}
                {record.withdrawnAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                {record.withdrawnReason && (
                  <span> — <em>{record.withdrawnReason}</em></span>
                )}
              </div>
              {record.reinstatedAt && (
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>Reinstated</strong>
                  {' on '}
                  {record.reinstatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  {record.reinstatedReason && (
                    <span> — <em>{record.reinstatedReason}</em></span>
                  )}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Provenance Chain */}
        {renderPkg && (
          <Section title="Provenance Chain">
            <div style={{
              padding: '16px 20px', border: '1px solid var(--border-color)',
              borderRadius: '6px', backgroundColor: 'white',
            }}>
              <ProvenanceChain pkg={renderPkg} />
              {resolution?.outputIsBlob && (
                <div style={{
                  marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)',
                  fontFamily: 'monospace',
                }}>
                  Output stored as blob (verified) · {resolution.outputBlobRef?.size.toLocaleString()} bytes
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Provenance Graph (W3C PROV-O) */}
        {renderPkg?.provenance && (
          <Section title="Provenance Graph">
            <ProvenanceGraphSection provenance={renderPkg.provenance} slug={slug} />
          </Section>
        )}

        {/* Skill guidance (system prompt sent to the model) */}
        {(renderPkg?.skillMetadata?.skillText || resolution?.skillTextIsBlob) && (
          <Section title="Skill Guidance">
            <SkillSection
              skillText={typeof renderPkg?.skillMetadata?.skillText === 'string'
                ? renderPkg.skillMetadata.skillText
                : undefined}
              skillTextRef={resolution?.skillTextBlobRef ?? undefined}
              skillHash={renderPkg?.skillMetadata?.systemPromptHash}
            />
          </Section>
        )}

        {/* Jupyter Notebook extension */}
        {renderPkg?.extensions?.[NOTEBOOK_EXTENSION_KEY] !== undefined && (
          <Section title="Jupyter Notebook">
            <NotebookSection notebook={renderPkg.extensions[NOTEBOOK_EXTENSION_KEY]} slug={slug} />
          </Section>
        )}

        {/* Unknown extensions — graceful fallback for other adopters' artifacts */}
        {(() => {
          if (!renderPkg?.extensions) return null;
          const unknown = Object.keys(renderPkg.extensions).filter(k => k !== NOTEBOOK_EXTENSION_KEY);
          if (unknown.length === 0) return null;
          return (
            <Section title="Additional Artifacts">
              <div style={{
                padding: '12px 16px', border: '1px solid var(--border-color)',
                borderRadius: '6px', backgroundColor: 'white',
                fontSize: '13px', color: 'var(--text-secondary)',
              }}>
                <p style={{ margin: '0 0 6px' }}>
                  This evidence package contains artifacts from other extensions:
                </p>
                <ul style={{ margin: 0, paddingLeft: '20px', fontFamily: 'monospace', fontSize: '12px' }}>
                  {unknown.map(k => <li key={k}>{k}</li>)}
                </ul>
                <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Download the full package to inspect them.
                </p>
              </div>
            </Section>
          );
        })()}

        {/* Attestations */}
        <Section title="Attestations">
          <AttestationSection
            slug={slug}
            analysisModel={record.model}
            promptVisibility={record.promptVisibility}
          />
        </Section>

        {/* Resources */}
        {renderPkg && (
          <Section title="Resources Used">
            {(() => {
              const cost = estimateCostUsd(
                renderPkg.cost.model,
                renderPkg.cost.promptTokens || 0,
                renderPkg.cost.completionTokens || 0,
              );
              const skillHash = renderPkg.skillMetadata.systemPromptHash;
              const dataSourcesSummary = formatDataSourcesSummary(renderPkg.dataSources);
              const blobFields: string[] = [];
              if (resolution?.outputIsBlob) blobFields.push('output');
              if (resolution?.skillTextIsBlob) blobFields.push('skill text');
              const items: Array<{ label: string; value: React.ReactNode; mono?: boolean }> = [
                { label: 'Model', value: formatModelName(renderPkg.cost.model) },
                { label: 'Data sources', value: dataSourcesSummary ?? '—' },
                ...(skillHash ? [{
                  label: 'Skill hash',
                  value: skillHash.slice(0, 12),
                  mono: true,
                }] : []),
                { label: 'Prompt tokens', value: renderPkg.cost.promptTokens?.toLocaleString() || '—' },
                { label: 'Completion tokens', value: renderPkg.cost.completionTokens?.toLocaleString() || '—' },
                { label: 'Total tokens', value: renderPkg.cost.totalTokens?.toLocaleString() || '—' },
                { label: 'Estimated cost', value: cost !== null ? `~$${cost.toFixed(cost < 0.01 ? 4 : 2)}` : '—' },
                { label: 'Duration', value: renderPkg.cost.durationMs ? `${(renderPkg.cost.durationMs / 1000).toFixed(1)}s` : '—' },
                { label: 'Tool calls', value: String(renderPkg.queries.length) },
                ...(blobFields.length > 0 ? [{
                  label: 'Blob-stored fields',
                  value: blobFields.join(', '),
                }] : []),
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
