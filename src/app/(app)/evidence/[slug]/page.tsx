import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { evidenceRecords, users } from '@/lib/db/schema';
// Instance-identity config (ADR-0020): canonical/OG/JSON-LD URLs and the
// request-host fallback resolve per-instance (server component — env is
// available at request time; demo defaults when unset).
import { getEvidenceSiteOrigin, getInstanceAttribution, getPublicationHost } from '@/lib/site-config';
// Chrome branding (#217): the citation label's display name — chrome-only,
// never part of the signed package (that is the PUBLISHER_* set above).
import { getBrandName } from '@/lib/brand-config';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import type { EvidencePackage } from '@/lib/evidence/packager';
import { resolveRecordAttestations } from '@/lib/evidence/lifecycle';
// The layout the record was published under (LAYOUT-WEB W4 P2), looked up
// among the layout nodes this site holds, for the view's foot line.
import { publishedLayoutFor } from '@/lib/answer-layout/held';
// The answer view (LAYOUT-WEB W3 P2, design §4.2 option A): the record
// adapter builds the view's model from the package and its row, and the view
// lays out the parts every surface shares, in one order, each under the line
// saying who wrote it. This page keeps its banners, header, lifecycle, Status
// History and Actions around the view.
import AnswerView from '@/components/answer-view/AnswerView';
import { adaptRecord, type ResolvedPackageData } from '@/components/answer-view/adapt-record';
import { sessionUserIsCreator } from '@/lib/evidence/sealed-access';
import { fromDbValue } from '@/lib/evidence/visibility';
import { loadEvaluationViews } from '@/lib/evidence/adversarial-eval';
import EvaluationAttestationsSection from '@/components/evidence/EvaluationAttestationsSection';
import EvidenceActions from '@/components/evidence/EvidenceActions';
import CitationBlock from '@/components/evidence/CitationBlock';
import AttestationSection from '@/components/evidence/AttestationSection';
import DashboardLink from '@/components/evidence/DashboardLink';
import ProvenanceGraphSection from '@/components/evidence/ProvenanceGraphSection';
// Machine-readable metadata shapes (JSON-LD + Highwire citation tags). Pure
// builders in lib so the SHAPE is unit-testable — including what it omits
// (#256: no publication date is stored, so none is asserted).
import { buildEvidenceJsonLd, buildEvidenceCitationTags } from '@/lib/evidence/page-metadata';
import { isBlobRef, verifyBlobRef, type BlobRef } from '@/lib/evidence/blob-ref';
// The key the notebook sits under in a package (#403), imported from its
// client-safe declaration rather than restated here: every producer writes
// under that binding, and a local copy of the string is a reader that can look
// under a key no producer wrote. `notebook-extension-key.test.ts` holds the
// tree to that. Read here by Additional Artifacts, which lists every other key.
import { NOTEBOOK_EXTENSION_KEY } from '@/lib/notebook-author/notebook-provenance-reading';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** An output blob, fetched once and checked: its text only when its bytes verified. */
type OutputBlobResolution =
  | { state: 'verified'; text: string }
  | { state: 'unavailable' }
  | { state: 'mismatch' };

/** Fetch an output blob ONCE, then check THOSE bytes against the record's
 *  reference with verify-core's own check (`verifyBlobRef`, size then
 *  SHA-256), handed the bytes already held rather than a second fetch, so the
 *  bytes that are checked are the bytes that are rendered (the W3 fix). The
 *  request is the one `fetchBlobRefText` makes (a plain GET, 15 s), read as
 *  bytes rather than text, because the check reads bytes. A blob that cannot
 *  be fetched is `unavailable`; one whose bytes do not verify, for any of the
 *  check's reasons, is `mismatch`, and its bytes are not returned. */
async function resolveOutputBlob(ref: BlobRef): Promise<OutputBlobResolution> {
  let bytes: Uint8Array;
  try {
    const response = await fetch(ref.url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { state: 'unavailable' };
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { state: 'unavailable' };
  }
  const held = bytes;
  const check = await verifyBlobRef(ref, { fetch: async () => new Response(new Uint8Array(held)) });
  if (!check.ok) return { state: 'mismatch' };
  return { state: 'verified', text: new TextDecoder().decode(held) };
}

/** Server-side resolution for blob-referenced fields in an evidence package.
 *  `output` is eagerly fetched and checked (`resolveOutputBlob`) so the answer
 *  (rendered first and again as section F) can treat it as a string. `skillMetadata.skillText` is handed through as a
 *  reference when it's a BlobRef — the skill section expands on click and
 *  fetches lazily, so there's no point paying the latency up front. The
 *  result's shape (`ResolvedPackageData`) is the record adapter's input. */
async function resolvePackageForRender(pkg: EvidencePackage): Promise<ResolvedPackageData> {
  const outputIsBlob = isBlobRef(pkg.output);
  const outputBlobRef = outputIsBlob ? (pkg.output as BlobRef) : null;
  let resolvedOutput: string;
  // An output blob that cannot be fetched, or whose bytes do not verify, is
  // said so by the record adapter, in the site's words under no author line
  // (`OUTPUT_UNAVAILABLE`, `OUTPUT_DOES_NOT_MATCH`); the empty string here is
  // never rendered as the answer, and bytes that did not verify reach no part
  // of the page.
  let outputUnavailable = false;
  let outputVerified = false;
  let outputMismatch = false;
  if (outputBlobRef !== null) {
    const blob = await resolveOutputBlob(outputBlobRef);
    outputUnavailable = blob.state === 'unavailable';
    outputMismatch = blob.state === 'mismatch';
    outputVerified = blob.state === 'verified';
    resolvedOutput = blob.state === 'verified' ? blob.text : '';
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
    outputUnavailable,
    outputVerified,
    outputMismatch,
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
  if (!data) return { title: 'Record Not Found' };

  // Sealed records (civic-ai-tools#71): title/summary are content-derived
  // and creator-only — emit generic metadata regardless of viewer so nothing
  // content-bearing lands in OG tags, caches, or link previews.
  if (fromDbValue(data.record.visibility) === 'sealed') {
    return { title: 'Sealed record', robots: { index: false } };
  }

  const { record, creator } = data;
  // #258: the canonical/OG/citation URL exists only when this instance has
  // declared its origin — honest omission otherwise, never another
  // deployment's URL in metadata.
  const origin = getEvidenceSiteOrigin();
  // Settlement-era canonical address (civic-ai-tools#160 P5, spec Appendix J).
  // `/evidence/<slug>` stays served as a permanent alias, so links already in the
  // wild resolve; what this page DECLARES canonical is the new segment.
  const url = origin ? `${origin}/records/${slug}` : null;
  const description = record.summary.slice(0, 200);

  return {
    title: `Record: ${record.title}`,
    description,
    openGraph: {
      title: `Record: ${record.title}`,
      description,
      type: 'article',
      ...(url ? { url } : {}),
    },
    twitter: {
      card: 'summary',
      title: `Record: ${record.title}`,
      description,
    },
    // Highwire-Press citation tags — what Zotero and Google Scholar read.
    // #256: no `citation_date`. That tag is a publication-date assertion in
    // this vocabulary, and no publication timestamp is stored (`created_at` is
    // row-insert time = SEAL time for a sealed-then-published record). Its
    // absence is deliberate and unconditional; see lib/evidence/page-metadata.ts.
    other: buildEvidenceCitationTags({
      title: record.title,
      creatorName: creator?.displayName || 'Unknown',
      url,
    }),
  };
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    unverified: { bg: 'rgba(0,0,0,0.06)', text: 'var(--text-muted)' },
    consistency_tested: { bg: 'rgba(var(--accent-rgb), 0.1)', text: 'var(--accent)' },
    evaluated: { bg: 'rgba(0, 183, 3, 0.1)', text: 'var(--success)' },
    fully_attested: { bg: 'rgba(0, 183, 3, 0.15)', text: 'var(--success)' },
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
  // Byline date. Deliberately LEFT as `created_at` by #256, and deliberately
  // left UNLABELLED: it names no field, so unlike `datePublished`,
  // `citation_date`, and the former "Published on" row it asserts nothing a
  // machine or a citation manager will read as a publication date. Not an
  // oversight in the #256 sweep — the other three sites were changed and this
  // one was examined and kept.
  const dateStr = record.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Absolute, publicly-fetchable commitment endpoint for the verify badge
  // (#114), resolved from the request host so the deep-link is correct on
  // production AND preview deploys (the verifier fetches it cross-origin).
  // The request host is effectively always present; the configured
  // publication host is the tail fallback (#258: nullable — with neither, a
  // last-resort relative URL rather than a fabricated absolute one).
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? getPublicationHost();
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const commitmentUrl = host
    ? `${proto}://${host}/api/records/${slug}/commitment`
    : `/api/records/${slug}/commitment`;

  // The origin the reader is reading at, from the request host as above; the
  // Citation block writes its URL from it, so the text rendered here is the
  // text the browser hydrates (the Cite modal reads the same origin from
  // `window.location`). Null with no host: the citation then carries the
  // relative address rather than a fabricated absolute one.
  const requestOrigin = host ? `${proto}://${host}` : null;
  // One layout for every content profile (LAYOUT-W1, #598; #135), and the one
  // view every surface renders through (LAYOUT-WEB W3 P2): the record adapter
  // reads the package — as stored, and as resolved above — and the row's
  // fields it needs, and names this instance as the author of the parts it
  // writes (`getInstanceAttribution()`; omitted when the instance declares
  // none). The profile still decides two things, both because only an A-G-format
  // record has them: the spec link beside the status row, and the notebook
  // bundle download, which the bundle route refuses for any other profile
  // (`api/evidence/[slug]/bundle/route.ts`).
  //
  // Lifecycle (spec §8.10) — dual-read the signed attestation chain when
  // present, else the legacy withdrawn/reinstated columns (§8.10.4). The banner
  // and Status History below render from the resolved status + history rather
  // than the raw columns, so post-PR3 records surface their signed chain while
  // pre-PR3 records keep rendering from their columns. From the same verified
  // rows, the layout node the record's publication attestation names
  // (LAYOUT-WEB W4 P2), which the view's foot line compares with the layout
  // it shows.
  const { lifecycle, publishedLayoutNodeId } = await resolveRecordAttestations(record, renderPkg?.signer?.identifier);
  const viewModel = adaptRecord({
    stored: pkg,
    resolution,
    row: {
      slug,
      summary: record.summary,
      contentProfile: record.contentProfile,
      captureMethod: record.captureMethod,
    },
    instance: getInstanceAttribution().host,
    publishedLayout: await publishedLayoutFor(publishedLayoutNodeId),
  });

  // Adversarial evaluations targeting this content node (civic-ai-tools#72).
  const evaluationViews = record.basePackageHash
    ? await loadEvaluationViews(record.basePackageHash)
    : [];
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Schema.org JSON-LD. `url` only when this instance declared an origin
  // (#258: honest omission, never another deployment's URL).
  // #256 applies the same rule to dates: the block carries NO `datePublished`,
  // because no publication timestamp is stored — `created_at` is row-insert
  // time, which for a record sealed first and published later is the SEAL
  // time. `datePublished` is exactly the field search engines and citation
  // tooling read to date a work, so emitting seal time there is a
  // machine-readable false claim. Absent on purpose, not an oversight; the
  // reasoning and the regression tests live in lib/evidence/page-metadata.ts.
  const jsonLdOrigin = getEvidenceSiteOrigin();
  const jsonLd = buildEvidenceJsonLd({
    title: record.title,
    summary: record.summary,
    creatorName: creator?.displayName || 'Unknown',
    url: jsonLdOrigin ? `${jsonLdOrigin}/records/${slug}` : null,
  });

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
            border: '1px solid var(--caution)',
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
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--accent)', marginBottom: '6px' }}>
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
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--error)', marginBottom: '6px' }}>
              This record was withdrawn by the author on{' '}
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
                style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                {creator.displayName}
              </a>
            ) : (
              creator?.displayName || 'Unknown'
            )}
          </span>
          <span>{'\u00b7'}</span>
          <span>{dateStr}</span>
        </div>
        {/* The viewer is compared with the creator here, on the server; the link gets only the answer. */}
        <DashboardLink isCreator={await sessionUserIsCreator(record)} />
        {(record.jurisdiction || record.civicContext) && (
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            {record.jurisdiction && <span>{record.jurisdiction}</span>}
            {record.jurisdiction && record.civicContext && <span> {'\u00b7'} </span>}
            {record.civicContext && <span>{record.civicContext}</span>}
          </div>
        )}

        {/* The view (LAYOUT-WEB W3 P2): the status row, the refused-request
            lines, the answer, the citation block, the steps, one disclosure —
            A-G, then the parts W1 placed after the envelope — then Status
            History and the actions. Everything a layout must not hide (rule 3)
            sits outside the disclosure: the banners above, the status row and
            the refused-request lines, and the verify action in Actions. The
            parts W1 placed after the envelope go to the view by name, so a
            layout's `disclosure.order` can place each (LAYOUT-WEB W4 P1). */}
        <AnswerView
          model={viewModel}
          sectionHeading="h2"
          citationBlock={
            // Citation (ruling D3) — beneath the answer, collapsed; the same
            // text as the Cite modal in Actions, from the same builder.
            <CitationBlock
              title={record.title}
              creatorName={creator?.displayName || 'Unknown'}
              createdAt={record.createdAt.toISOString()}
              slug={slug}
              brandName={getBrandName()}
              origin={requestOrigin}
            />
          }
          recordSections={{
            // Provenance Graph (W3C PROV-O)
            'provenance-graph': renderPkg?.provenance && (
              <Section title="Provenance Graph">
                <ProvenanceGraphSection provenance={renderPkg.provenance} slug={slug} />
              </Section>
            ),

            // Unknown extensions — graceful fallback for other adopters' artifacts
            'additional-artifacts': (() => {
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
                      This record package contains artifacts from other extensions:
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
            })(),

            // Adversarial evaluations (civic-ai-tools#72) — signed
            // attestation/evaluates/v1 nodes targeting this content node,
            // emitted by the publication gate (or future third-party
            // evaluators). Renders nothing when no evaluations exist.
            evaluations: evaluationViews.length > 0 && (
              <Section title="Adversarial evaluations">
                <EvaluationAttestationsSection views={evaluationViews} />
              </Section>
            ),

            attestations: (
              <Section title="Attestations">
                <AttestationSection
                  slug={slug}
                  analysisModel={record.model}
                  promptVisibility={record.promptVisibility}
                />
              </Section>
            ),

            verification: (
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
            ),
          }}
          afterDisclosure={
            <>
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
                    {/* #256: the "Published on <date>" row that used to lead this
                        list is gone. It rendered `created_at` — row-insert time,
                        which for a record sealed first and published later is the
                        SEAL time, not the publication date. Omitted rather than
                        relabelled: every remaining row here is a signed lifecycle
                        event resolved from the attestation chain, so a row sourced
                        from an unsigned column of a different kind reads as the same
                        claim without being one. Relabelling it "Created on" would
                        stay technically true while a reader skimming a
                        Published→Withdrawn sequence still takes the first date as the
                        publication — the misread survives the wording fix (design
                        principles 3 "no false precision" and 7 "three orthogonal
                        axes"). "Sealed on" is ruled out separately by principle 9:
                        the seal/publish split is implementation language. The
                        record's date is still visible, unlabelled, in the byline. */}
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

            </>
          }
          actions={
            // Actions: copy, the notebook, cite, verify — outside the disclosure.
            <Section title="Actions">
              <EvidenceActions
                slug={slug}
                title={record.title}
                creatorName={creator?.displayName || 'Unknown'}
                createdAt={record.createdAt.toISOString()}
                captureMethod={record.captureMethod}
                visibility={record.visibility}
                commitmentUrl={commitmentUrl}
                brandName={getBrandName()}
              />
            </Section>
          }
        />

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
