import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { db } from '@/lib/db';
import { evidenceRecords, users } from '@/lib/db/schema';
// Instance-identity config (ADR-0020): canonical/OG/JSON-LD URLs and the
// request-host fallback resolve per-instance (server component — env is
// available at request time; demo defaults when unset).
import { getEvidenceSiteOrigin, getPublicationHost } from '@/lib/site-config';
// Chrome branding (#217): the citation label's display name — chrome-only,
// never part of the signed package (that is the EVIDENCE_* set above).
import { getBrandName } from '@/lib/brand-config';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import type { EvidencePackage } from '@/lib/evidence/packager';
import { resolveLifecycle } from '@/lib/evidence/lifecycle';
import { sessionUserIsCreator } from '@/lib/evidence/sealed-access';
import { fromDbValue } from '@/lib/evidence/visibility';
import { loadEvaluationViews } from '@/lib/evidence/adversarial-eval';
import EvaluationAttestationsSection from '@/components/evidence/EvaluationAttestationsSection';
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

  // Sealed records (civic-ai-tools#71): title/summary are content-derived
  // and creator-only — emit generic metadata regardless of viewer so nothing
  // content-bearing lands in OG tags, caches, or link previews.
  if (fromDbValue(data.record.visibility) === 'sealed') {
    return { title: 'Sealed evidence record', robots: { index: false } };
  }

  const { record, creator } = data;
  const url = `${getEvidenceSiteOrigin()}/evidence/${slug}`;
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
    consistency_tested: { bg: 'rgba(var(--accent-rgb), 0.1)', text: 'var(--nyc-blue)' },
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

// Type-narrowing accessor for the org.civicaitools.environment extension
// (OES §9.1.1 requirement 3). Returns null when absent or malformed so
// callers can default-fallback for non-datHere packages.
function getEnvironmentExtension(pkg: EvidencePackage | null | undefined): {
  modelVersion?: string;
  temperature?: number;
  mcpServers?: Array<{ url: string; name?: string }>;
  host?: string;
} | null {
  const ext = pkg?.extensions?.['org.civicaitools.environment'];
  if (!ext || typeof ext !== 'object') return null;
  return ext as ReturnType<typeof getEnvironmentExtension> & object;
}

export default async function EvidencePage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getEvidenceData(slug);
  if (!data) notFound();

  // Sealed records are creator-only (civic-ai-tools#71): the page (content,
  // title, summary, notebook) does not exist for anyone else — 404, not 403,
  // so probing can't confirm the record. The public surface for a sealed
  // claim is the redacted commitment sidecar.
  const isSealed = fromDbValue(data.record.visibility) === 'sealed';
  if (isSealed && !(await sessionUserIsCreator(data.record))) {
    notFound();
  }

  const { record, creator, pkg, resolution } = data;
  // Unsigned-package discriminator (ADR-0020 guard 2): a record persisted
  // with no signature envelope. Drives the prominent unsigned banner below.
  const isUnsignedRecord = !record.basePackageSignature;
  // Use the resolved package everywhere we render package content — it has
  // BlobRef outputs eagerly pulled into strings so child components can stay
  // ignorant of the reference layer. When the package isn't a BlobRef user
  // (the vast majority of historical records), `resolution.pkg === pkg`
  // modulo the shallow clone.
  const renderPkg = resolution?.pkg ?? pkg;
  const dateStr = record.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Absolute, publicly-fetchable commitment endpoint for the verify badge
  // (#114), resolved from the request host so the deep-link is correct on
  // production AND preview deploys (the verifier fetches it cross-origin).
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? getPublicationHost();
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const commitmentUrl = `${proto}://${host}/api/evidence/${slug}/commitment`;

  // ADR-0004: detail-page layout branches on contentProfile. When the value
  // is 'datHere', the page renders the A-G envelope as its primary structure
  // (sections A through G replace ProvenanceChain, Skill Guidance, Jupyter
  // Notebook, and Resources Used). For default / absent contentProfile, the
  // existing legacy layout renders unchanged.
  const isDatHere = record.contentProfile === 'datHere';

  // Lifecycle (spec §8.10) — dual-read the signed attestation chain when
  // present, else the legacy withdrawn/reinstated columns (§8.10.4). The banner
  // and Status History below render from the resolved status + history rather
  // than the raw columns, so post-PR3 records surface their signed chain while
  // pre-PR3 records keep rendering from their columns.
  const lifecycle = await resolveLifecycle(record, renderPkg?.signer?.identifier);
  // Adversarial evaluations targeting this content node (civic-ai-tools#72).
  const evaluationViews = record.basePackageHash
    ? await loadEvaluationViews(record.basePackageHash)
    : [];
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Schema.org JSON-LD
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: record.title,
    description: record.summary,
    creator: { '@type': 'Person', name: creator?.displayName || 'Unknown' },
    datePublished: record.createdAt.toISOString().split('T')[0],
    url: `${getEvidenceSiteOrigin()}/evidence/${slug}`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 24px 64px' }}>
        {/* Unsigned-package banner (S3a P3, #166; ADR-0020 §Consequences
            guard 2 — mandatory labeling wherever an unsigned package appears).
            A record persisted without a signature carries no cryptographic
            commitment: no signature, no registered key, and — Rekor logging
            being signature-gated — no transparency-log entry. Going forward
            the seal/commit gate prevents such rows from being created; a
            historical row is not migrated or relabeled, it renders with this
            prominent label (and cannot be published — the per-record gate). */}
        {isUnsignedRecord && (
          <div style={{
            padding: '16px 20px', marginBottom: '24px',
            backgroundColor: 'rgba(255, 179, 32, 0.12)',
            border: '1px solid var(--nyc-caution, #FFB320)',
            borderRadius: '6px',
          }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
              Unsigned package — no cryptographic commitment
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              This record was produced without a signing key (the unsigned dev
              tier). It carries no signature, no registered key, and no
              transparency-log entry, so its origin cannot be cryptographically
              confirmed. An unsigned package can reach neither the sealed nor
              the public state.
            </div>
          </div>
        )}

        {/* Sealed banner (civic-ai-tools#71) — creator-only view of a
            sealed-not-published record. The commitment (hash + signature +
            timestamp + Rekor) is publicly registered; the content is not.
            The proof sentence is signature-conditional: a historical unsigned
            row registered no commitment, and the banner must not claim one. */}
        {isSealed && (
          <div style={{
            padding: '16px 20px', marginBottom: '24px',
            backgroundColor: 'rgba(var(--accent-rgb), 0.05)',
            border: '1px solid rgba(var(--accent-rgb), 0.25)',
            borderRadius: '6px',
          }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--nyc-blue)', marginBottom: '6px' }}>
              Sealed — not published
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {isUnsignedRecord ? (
                <>
                  This record is unlisted: its content is not publicly
                  accessible and it does not appear in the public registry.
                  Only you can see this page. It was persisted without a
                  signature, so no public commitment backs it and it cannot be
                  published.
                </>
              ) : (
                <>
                  This record is signed, timestamped, and registered on the public
                  transparency log, but its content is not publicly accessible and
                  it does not appear in the public registry. Only you can see this
                  page. Publishing is a separate, irreversible step that makes the
                  content public and emits signed publication attestations.
                </>
              )}
            </div>
          </div>
        )}

        {/* Withdrawal banner — shown when the resolved lifecycle status is
            withdrawn (from the signed attestation chain, or the legacy columns
            for pre-PR3 records). */}
        {lifecycle.status === 'withdrawn' && lifecycle.withdrawnAt && (
          <div style={{
            padding: '16px 20px', marginBottom: '24px',
            backgroundColor: 'rgba(236, 19, 30, 0.06)',
            border: '1px solid rgba(236, 19, 30, 0.2)',
            borderRadius: '6px',
          }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--nyc-error)', marginBottom: '6px' }}>
              This evidence was withdrawn by the author on{' '}
              {fmtDate(lifecycle.withdrawnAt)}
            </div>
            {lifecycle.withdrawnReason && (
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                <strong>Reason:</strong> {lifecycle.withdrawnReason}
              </div>
            )}
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              The original content and cryptographic proofs are preserved below for transparency.
              {lifecycle.source === 'attestation-chain' && ' This withdrawal is a separately-signed attestation node.'}
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

        {/* Summary — legacy layout only (datHere shows summary as section G) */}
        {!isDatHere && (
          <Section title="Summary">
            <div style={{
              padding: '16px 20px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
              borderLeft: '3px solid var(--nyc-blue)', borderRadius: '0 4px 4px 0',
              fontSize: '15px', lineHeight: 1.6, color: 'var(--text-secondary)',
            }}>
              {record.summary}
            </div>
          </Section>
        )}

        {/* DatHere small label row — appears between header and content. Per
            ADR-0004 + the 2026-05-19 reframe, captureMethod and contentProfile
            are orthogonal axes; this row carries the contentProfile label (the
            captureMethod label now sits beside the signature verdict in the
            verify panel, #111), then renders A-G as the page structure below. */}
        {isDatHere && (
          <div style={{
            fontSize: '13px', color: 'var(--text-secondary)',
            marginBottom: '24px', marginTop: '12px',
            display: 'flex', flexWrap: 'wrap', gap: '0 8px', alignItems: 'center',
          }}>
            <span>datHere content profile</span>
            <span>{'·'}</span>
            <a
              href="https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/open-evidence-standard.md#91-dathere-content-profile"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--nyc-blue)' }}
            >
              OES §9.1
            </a>
            <span>{'·'}</span>
            <a
              href={`/api/evidence/${slug}/bundle`}
              style={{ color: 'var(--nyc-blue)' }}
            >
              Download notebook (.ipynb)
            </a>
          </div>
        )}

        {/* A-G sections AS the page structure for datHere-content-profile
            packages. ADR-0004 + OES §9.1. The legacy ProvenanceChain /
            Skill Guidance / Jupyter Notebook / Resources Used sections
            below are suppressed for datHere; their content is subsumed
            here as sections A, B, E, and C respectively. */}
        {isDatHere && renderPkg && (
          <>
            {/* A · Initial prompt */}
            <Section title="A · Initial prompt">
              {renderPkg.prompt.text ? (
                <div style={{
                  padding: '16px 20px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
                  borderLeft: '3px solid var(--nyc-blue)', borderRadius: '0 4px 4px 0',
                  fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {renderPkg.prompt.text}
                </div>
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Prompt visibility was hash-only; verbatim text not captured.
                </div>
              )}
            </Section>

            {/* B · System prompts */}
            {(renderPkg.skillMetadata?.skillText || resolution?.skillTextIsBlob) ? (
              <Section title="B · System prompts">
                <SkillSection
                  skillText={typeof renderPkg.skillMetadata?.skillText === 'string'
                    ? renderPkg.skillMetadata.skillText
                    : undefined}
                  skillTextRef={resolution?.skillTextBlobRef ?? undefined}
                  skillHash={renderPkg.skillMetadata?.systemPromptHash}
                />
              </Section>
            ) : null}

            {/* C · Model + environment */}
            <Section title="C · Model + environment">
              {(() => {
                const env = getEnvironmentExtension(renderPkg);
                const envMcpHosts = env?.mcpServers
                  ?.map((s) => {
                    try { return new URL(s.url).host; } catch { return s.url; }
                  })
                  .join(', ');
                const cost = estimateCostUsd(
                  renderPkg.cost.model,
                  renderPkg.cost.promptTokens || 0,
                  renderPkg.cost.completionTokens || 0,
                );
                const items: Array<{ label: string; value: React.ReactNode; mono?: boolean }> = [
                  { label: 'Model', value: formatModelName(renderPkg.cost.model) },
                  ...(env?.modelVersion && env.modelVersion !== renderPkg.cost.model ? [{
                    label: 'Model version', value: env.modelVersion,
                  }] : []),
                  ...(env?.temperature !== undefined ? [{
                    label: 'Temperature', value: String(env.temperature),
                  }] : []),
                  ...(env?.host ? [{
                    label: 'Publishing host', value: env.host,
                  }] : []),
                  ...(envMcpHosts ? [{
                    label: 'MCP servers', value: envMcpHosts,
                  }] : []),
                  { label: 'Prompt tokens', value: renderPkg.cost.promptTokens?.toLocaleString() || '—' },
                  { label: 'Completion tokens', value: renderPkg.cost.completionTokens?.toLocaleString() || '—' },
                  { label: 'Estimated cost', value: cost !== null ? `~$${cost.toFixed(cost < 0.01 ? 4 : 2)}` : '—' },
                  { label: 'Duration', value: renderPkg.cost.durationMs ? `${(renderPkg.cost.durationMs / 1000).toFixed(1)}s` : '—' },
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
                        <div style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 500 }}>
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Section>

            {/* D · Deliberative trace — collapsed by default */}
            <Section title="D · Deliberative trace">
              <details>
                <summary style={{
                  cursor: 'pointer', fontSize: '13px',
                  color: 'var(--text-secondary)', padding: '8px 0',
                }}>
                  Show {renderPkg.queries.length} tool {renderPkg.queries.length === 1 ? 'call' : 'calls'}
                </summary>
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {renderPkg.queries.map((q, i) => (
                    <div key={i} style={{
                      padding: '10px 14px', border: '1px solid var(--border-color)',
                      borderRadius: '4px', fontSize: '13px',
                    }}>
                      <div style={{ fontFamily: 'monospace', color: 'var(--text-primary)', marginBottom: '4px' }}>
                        {q.tool}{q.operationType ? ` (${q.operationType})` : ''}
                      </div>
                      <pre style={{
                        fontSize: '11px', color: 'var(--text-secondary)', margin: 0,
                        overflow: 'auto', whiteSpace: 'pre-wrap',
                      }}>
                        {JSON.stringify(q.arguments, null, 2)}
                      </pre>
                      {q.resultRows !== undefined && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          Result: {q.resultRows} rows × {q.resultColumns ?? '—'} cols
                          {q.duration_ms !== undefined && ` · ${q.duration_ms}ms`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </Section>

            {/* E · Answer notebook */}
            {renderPkg.extensions?.[NOTEBOOK_EXTENSION_KEY] !== undefined ? (
              <Section title="E · Answer notebook">
                <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Re-executing this notebook against the documented runtime + stable upstream data reproduces section F (OES §9.1.3).{' '}
                  <a href={`/api/evidence/${slug}/bundle`} style={{ color: 'var(--nyc-blue)' }}>
                    Download notebook (.ipynb)
                  </a>
                </div>
                <NotebookSection notebook={renderPkg.extensions[NOTEBOOK_EXTENSION_KEY]} slug={slug} />
              </Section>
            ) : null}

            {/* F · Rendered answer */}
            <Section title="F · Rendered answer">
              <div style={{
                padding: '16px 20px', border: '1px solid var(--border-color)',
                borderRadius: '6px', backgroundColor: 'white',
                fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)',
              }}>
                {typeof renderPkg.output === 'string' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderPkg.output}</ReactMarkdown>
                ) : (
                  <em style={{ color: 'var(--text-muted)' }}>
                    Output stored as blob ({resolution?.outputBlobRef?.size.toLocaleString()} bytes);
                    fetch the canonical package URL to retrieve.
                  </em>
                )}
              </div>
            </Section>

            {/* G · Summary */}
            <Section title="G · Summary">
              <div style={{
                padding: '12px 16px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
                borderLeft: '3px solid var(--nyc-blue)', borderRadius: '0 4px 4px 0',
                fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary)',
              }}>
                {renderPkg.summary ?? record.summary}
              </div>
            </Section>
          </>
        )}

        {/* Verification Status — legacy layout shows near top; datHere
            renders this section near the bottom (after Attestations) per
            ADR-0004 detail-page restructure. */}
        {!isDatHere && (
          <Section title="Verification Status">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
              <StatusBadge status={record.verificationStatus} />
              {record.consistencyClassification && (
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Consistency: {record.consistencyClassification.replace(/_/g, ' ')}
                </span>
              )}
              {/* Typed-standards envelope labels (ADR-0006/0009). Read from
                  the canonical package object — not a DB column. Absent on
                  pre-v0.1 packages, which simply omit these. */}
              {renderPkg?.producerProfile && (
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Producer profile: {renderPkg.producerProfile}
                </span>
              )}
              {renderPkg?.type && (
                <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {renderPkg.type}
                </span>
              )}
            </div>
          </Section>
        )}

        {/* Status History — shown when the record has a withdrawal/reinstatement
            cycle. Sourced from the resolved lifecycle (signed attestation chain
            when present, legacy columns otherwise). */}
        {lifecycle.withdrawnAt && (
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
                {fmtDate(lifecycle.withdrawnAt)}
                {lifecycle.withdrawnReason && (
                  <span> — <em>{lifecycle.withdrawnReason}</em></span>
                )}
              </div>
              {lifecycle.reinstatedAt && (
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>Reinstated</strong>
                  {' on '}
                  {fmtDate(lifecycle.reinstatedAt)}
                  {lifecycle.reinstatedReason && (
                    <span> — <em>{lifecycle.reinstatedReason}</em></span>
                  )}
                </div>
              )}
              {lifecycle.source === 'attestation-chain' && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Lifecycle events above are separately-signed attestation nodes
                  ({lifecycle.chain.length} in the chain).
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Provenance Chain — legacy layout only (datHere subsumes this
            into sections A/B/C/D/F per the A-G content profile). */}
        {!isDatHere && renderPkg && (
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

        {/* Skill guidance — legacy layout only (datHere subsumes into B). */}
        {!isDatHere && (renderPkg?.skillMetadata?.skillText || resolution?.skillTextIsBlob) && (
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

        {/* Jupyter Notebook — legacy layout only (datHere subsumes into E). */}
        {!isDatHere && renderPkg?.extensions?.[NOTEBOOK_EXTENSION_KEY] !== undefined && (
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

        {/* Adversarial evaluations (civic-ai-tools#72) — signed
            attestation/evaluates/v1 nodes targeting this content node,
            emitted by the publication gate (or future third-party
            evaluators). Renders nothing when no evaluations exist. */}
        {evaluationViews.length > 0 && (
          <Section title="Adversarial evaluations">
            <EvaluationAttestationsSection views={evaluationViews} />
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

        {/* Resources Used — legacy layout only (datHere subsumes into C). */}
        {!isDatHere && renderPkg && (
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
              // Section-C environment metadata (datHere captureMethod only;
              // org.civicaitools.environment extension per OES §9.1.1).
              const env = getEnvironmentExtension(renderPkg);
              const envMcpHosts = env?.mcpServers
                ?.map((s) => {
                  try { return new URL(s.url).host; } catch { return s.url; }
                })
                .join(', ');
              const items: Array<{ label: string; value: React.ReactNode; mono?: boolean }> = [
                { label: 'Model', value: formatModelName(renderPkg.cost.model) },
                ...(env?.modelVersion && env.modelVersion !== renderPkg.cost.model ? [{
                  label: 'Model version',
                  value: env.modelVersion,
                }] : []),
                ...(env?.host ? [{
                  label: 'Publishing host',
                  value: env.host,
                }] : []),
                ...(envMcpHosts ? [{
                  label: 'MCP servers',
                  value: envMcpHosts,
                }] : []),
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

        {/* Verification Status — datHere layout shows this near the bottom
            (after Attestations and Resources). Legacy layout has it near
            the top after Summary. */}
        {isDatHere && (
          <Section title="Verification Status">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
              <StatusBadge status={record.verificationStatus} />
              {record.consistencyClassification && (
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Consistency: {record.consistencyClassification.replace(/_/g, ' ')}
                </span>
              )}
              {/* Typed-standards envelope labels (ADR-0006/0009). Read from
                  the canonical package object — not a DB column. Absent on
                  pre-v0.1 packages, which simply omit these. */}
              {renderPkg?.producerProfile && (
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Producer profile: {renderPkg.producerProfile}
                </span>
              )}
              {renderPkg?.type && (
                <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {renderPkg.type}
                </span>
              )}
            </div>
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
            captureMethod={record.captureMethod}
            visibility={record.visibility}
            commitmentUrl={commitmentUrl}
            brandName={getBrandName()}
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
