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
import { getEvidenceSiteOrigin, getInstanceAttribution, getPublicationHost } from '@/lib/site-config';
// Chrome branding (#217): the citation label's display name — chrome-only,
// never part of the signed package (that is the PUBLISHER_* set above).
import { getBrandName } from '@/lib/brand-config';
import { eq } from 'drizzle-orm';
import { getPackage } from '@/lib/storage';
import type { EvidencePackage } from '@/lib/evidence/packager';
import {
  describeQueryOutcome,
  describeRefusedRequests,
  describeUnrecordedOutcomes,
  readRefusalsFromTrace,
} from '@/lib/evidence/query-step';
import { resolveLifecycle } from '@/lib/evidence/lifecycle';
// The step view (LAYOUT-WEB W2 P2): one step per signed `queries[]` entry,
// built when the page renders, from the shared step module.
import { buildRecordStepView, stepsAuthorLine, type StepViewCall } from '@/lib/answer-view/steps';
// A call's label reads the upstream name (`get_data`); the name the model
// called (`socrata__get_data`) stays where the record states it (ADR-0033).
import { upstreamToolName } from '@/lib/mcp/operation-types';
import { sessionUserIsCreator } from '@/lib/evidence/sealed-access';
import { fromDbValue } from '@/lib/evidence/visibility';
import { loadEvaluationViews } from '@/lib/evidence/adversarial-eval';
import EvaluationAttestationsSection from '@/components/evidence/EvaluationAttestationsSection';
import EvidenceActions from '@/components/evidence/EvidenceActions';
import CitationBlock from '@/components/evidence/CitationBlock';
import AttestationSection from '@/components/evidence/AttestationSection';
import DashboardLink from '@/components/evidence/DashboardLink';
import ProvenanceGraphSection from '@/components/evidence/ProvenanceGraphSection';
import NotebookSection from '@/components/evidence/NotebookSection';
// What this page is entitled to CLAIM about re-executing the notebook, read off
// the notebook in hand rather than asserted beside the download button (#416).
// The claim used to be rendered unconditionally, directly above a
// `<NotebookSection>` that may state on the very next line that the notebook
// never ran or that whether it ran is not stated. It is a pure function so that
// it can be tested on its own, without rendering this page (the page's render
// test, `record-page-layout.test.ts`, drives the layout, not this claim).
import { reproductionAssertionFor } from '@/lib/notebook-author/reproduction-assertion';
import SkillSection from '@/components/evidence/SkillSection';
// Machine-readable metadata shapes (JSON-LD + Highwire citation tags). Pure
// builders in lib so the SHAPE is unit-testable — including what it omits
// (#256: no publication date is stored, so none is asserted).
import { buildEvidenceJsonLd, buildEvidenceCitationTags } from '@/lib/evidence/page-metadata';
import { formatModelName, estimateCostUsd } from '@/lib/models';
import { formatDataSourcesSummary } from '@/lib/evidence/data-sources';
import { isBlobRef, fetchBlobRefText, type BlobRef } from '@/lib/evidence/blob-ref';
// What the record can disclose about the composed skill prompt (#411, D3) —
// one decision, read by both `SkillSection` sites below, and drivable from a
// test in a way an inline condition in this file is not.
import { describeSkillDisclosure, carriesSkillText } from '@/lib/evidence/skill-disclosure';
// The key the notebook sits under in a package (#403), imported from its
// client-safe declaration rather than restated here: every producer writes
// under that binding, and a local copy of the string is a reader that can look
// under a key no producer wrote. `notebook-extension-key.test.ts` holds the
// tree to that.
import {
  NOTEBOOK_EXTENSION_KEY,
  readNotebookProvenanceOfNotebook,
} from '@/lib/notebook-author/notebook-provenance-reading';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** Server-side resolution for blob-referenced fields in an evidence package.
 *  `output` is eagerly fetched so the answer (rendered first and again as
 *  section F) can treat it as a string. `skillMetadata.skillText` is handed through as a
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

/** One call in the step view: the site's sentence for it, and its outcome. */
function StepCallRow({ call }: { call: StepViewCall }) {
  return (
    <div data-part="step-call" style={{ marginTop: '6px', paddingLeft: '20px', fontSize: '13px', lineHeight: 1.5 }}>
      {call.sentence !== undefined && (
        <div data-part="step-sentence" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>{call.sentence}</div>
      )}
      <div data-part="step-outcome" style={{ fontSize: '12px', color: call.failed ? 'var(--error)' : 'var(--text-muted)' }}>{call.outcome}</div>
    </div>
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
// (spec §8.7.1 requirement 3). Returns null when absent or malformed so
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
  // What this record can disclose about the composed skill prompt (#411, D3),
  // asked ONCE, for section B's `SkillSection`. It reads the
  // UNRESOLVED package, because `resolvePackageForRender` blanks a BlobRef
  // `skillText` so children can treat the field as a string — the reference
  // itself survives on `resolution.skillTextBlobRef`, and the disclosure has
  // to see it to answer `blob` rather than `hash-only`.
  const skillDisclosure = describeSkillDisclosure(pkg?.skillMetadata);
  // `null` for a notebook whose package says it was a skeleton, and for one that
  // says nothing — 24 of the 25 live records with a notebook, measured
  // 2026-09-05. No sentence, rather than a hedged one: `NotebookSection` states
  // the reading directly below in the vocabulary that owns it, and an absence
  // read as an assertion is what this removes.
  const reproductionAssertion = reproductionAssertionFor(
    renderPkg?.extensions?.[NOTEBOOK_EXTENSION_KEY],
  );
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

  // One layout for every content profile (LAYOUT-W1, #598; #135). The
  // profile no longer chooses the page's structure: every record renders the
  // A-G envelope (ADR-0004, spec §8.7). It still decides two things, both
  // because only an A-G-format record has them: the spec link beside the
  // status row, and the notebook bundle download, which the bundle route
  // refuses for any other profile (`api/evidence/[slug]/bundle/route.ts`).
  const isDatHere = record.contentProfile === 'datHere';
  // The origin the reader is reading at, from the request host as above; the
  // Citation block writes its URL from it, so the text rendered here is the
  // text the browser hydrates (the Cite modal reads the same origin from
  // `window.location`). Null with no host: the citation then carries the
  // relative address rather than a fabricated absolute one.
  const requestOrigin = host ? `${proto}://${host}` : null;
  // The notebook, and what it says about whether it ran — the reading
  // `NotebookSection` shows in E, stated again in the status row so a reader
  // sees it without opening the disclosure (layout rule 3; ruling D1).
  const notebook = renderPkg?.extensions?.[NOTEBOOK_EXTENSION_KEY];
  const notebookReading = notebook !== undefined ? readNotebookProvenanceOfNotebook(notebook) : null;
  // Ruling D1 (#430): a record whose request list marks no refusal is read
  // against its trace once, here; a declined reading leaves every entry as its
  // own fields say. Read by the refused-request line and by section D.
  const fromTrace = renderPkg ? readRefusalsFromTrace(renderPkg) : null;
  // Ruling D2: the refused-request count and the record-level unrecorded-
  // outcomes sentence (#430 F4, ruling D8) sit under the status row, outside
  // the disclosure. Each is null when it has nothing to say.
  const refusedRequests = renderPkg && fromTrace
    ? describeRefusedRequests(renderPkg.queries, fromTrace.refused)
    : null;
  const unrecordedOutcomes = renderPkg ? describeUnrecordedOutcomes(renderPkg) : null;
  // The steps (W2 P2, design §5): one per signed entry, the sentence and the
  // outcome written now from the signed fields — the outcome reading the trace
  // as section D does — under a line saying this instance wrote them, omitted
  // when the instance declares none.
  const stepView = renderPkg ? buildRecordStepView(renderPkg.queries, fromTrace?.refused) : null;
  const stepsAuthor = stepsAuthorLine(getInstanceAttribution().host);
  // The answer, built ONCE and rendered twice: first, with no section heading,
  // and again as F inside the disclosure, so the envelope reads whole to
  // someone inspecting it. One element, so the two cannot drift.
  const answer = renderPkg ? (
    <div data-part="answer" style={{
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
  ) : null;

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

        {/* Status row (ruling D1) — one line, only when it has something to
            say: the notebook's own reading when the record carries one, then,
            for an A-G-format record, the spec link and the notebook bundle.
            The content-profile name that used to lead this row is in C. */}
        {(notebookReading !== null || isDatHere) && (
          <div data-part="status-row" style={{
            fontSize: '13px', color: 'var(--text-secondary)',
            marginBottom: '16px', marginTop: '12px',
            display: 'flex', flexWrap: 'wrap', gap: '0 8px', alignItems: 'center',
          }}>
            {notebookReading !== null && <span>{notebookReading.label}</span>}
            {notebookReading !== null && isDatHere && <span>{'·'}</span>}
            {isDatHere && (
              <>
                <a
                  href="https://github.com/npstorey/civic-ai-tools/blob/main/docs/architecture/typed-standards-specification.md#87-content-profile-dathere"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent)' }}
                >
                  Typed Standards §8.7
                </a>
                <span>{'·'}</span>
                <a
                  href={`/api/records/${slug}/bundle`}
                  style={{ color: 'var(--accent)' }}
                >
                  Download notebook (.ipynb)
                </a>
              </>
            )}
          </div>
        )}

        {/* Refused-request lines (ruling D2) — under the status row, outside
            the disclosure, only when non-null: how many requests did not
            complete, and the record-level statement that no outcome is
            recorded. Per-call text stays in D. */}
        {(refusedRequests !== null || unrecordedOutcomes !== null) && (
          <div data-part="refused-requests" style={{ marginBottom: '16px' }}>
            {refusedRequests !== null && (
              <p style={{ margin: '0 0 6px', fontSize: '13px', lineHeight: 1.5, color: 'var(--text-primary)', fontWeight: 500 }}>
                {refusedRequests}
              </p>
            )}
            {unrecordedOutcomes !== null && (
              <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                {unrecordedOutcomes}
              </p>
            )}
          </div>
        )}

        {/* The answer — first, with no section heading. */}
        {answer !== null && (
          <div style={{ marginTop: '16px', marginBottom: '24px' }}>
            {answer}
          </div>
        )}

        {/* Citation (ruling D3) — beneath the answer, collapsed; the same text
            as the Cite modal in Actions, from the same builder. */}
        <CitationBlock
          title={record.title}
          creatorName={creator?.displayName || 'Unknown'}
          createdAt={record.createdAt.toISOString()}
          slug={slug}
          brandName={getBrandName()}
          origin={requestOrigin}
        />

        {/* The steps, outside the disclosure, after the citation (W2 P2). */}
        {stepView !== null && stepView.steps.length > 0 && (
          <div data-part="steps" style={{ marginBottom: '24px' }}>
            {stepsAuthor !== null && (
              <p data-part="steps-author" style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                {stepsAuthor}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {stepView.steps.map((step, i) => (
                <div data-part="step" key={i} style={{ padding: '8px 12px', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--accent)', marginRight: '6px' }}>Step {i + 1}</span>
                    <span data-part="step-label">{step.label}</span>
                  </div>
                  {step.calls.map((call, j) => <StepCallRow key={j} call={call} />)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* One disclosure, closed by default (ruling D4): the envelope A-G,
            then the parts that followed it. Everything a layout must not hide
            (rule 3) is above this; the verify link is in Actions, below it. */}
        <details style={{ marginBottom: '32px' }}>
          <summary style={{
            cursor: 'pointer', fontSize: '15px', fontWeight: 600,
            color: 'var(--text-primary)', padding: '8px 0',
          }}>
            Learn more about how this analysis was produced
          </summary>
          <div style={{ marginTop: '20px' }}>
            {renderPkg && (
              <>
                {/* A · Initial prompt */}
                <Section title="A · Initial prompt">
                  {renderPkg.prompt.text ? (
                    <div style={{
                      padding: '16px 20px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
                      borderLeft: '3px solid var(--accent)', borderRadius: '0 4px 4px 0',
                      fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {renderPkg.prompt.text}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Prompt visibility was hash-only; verbatim text not captured.
                      </div>
                      {/* The hash identifies the prompt that was used (ruling D7). */}
                      {renderPkg.prompt.hash && (
                        <div style={{
                          marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)',
                          fontFamily: 'monospace', wordBreak: 'break-all',
                        }}>
                          Prompt hash: {renderPkg.prompt.hash}
                        </div>
                      )}
                    </>
                  )}
                </Section>

                {/* B · System prompts */}
                {carriesSkillText(skillDisclosure) ? (
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

                {/* C · Model + environment — with what the old format's
                    Resources Used carried (ruling D7), for every format. */}
                <Section title="C · Model + environment">
                  {(() => {
                    const env = getEnvironmentExtension(renderPkg);
                    const envMcpHosts = env?.mcpServers
                      ?.map((s) => {
                        try { return new URL(s.url).host || s.url; } catch { return s.url; }
                      })
                      .join(', ');
                    const cost = estimateCostUsd(
                      renderPkg.cost.model,
                      renderPkg.cost.promptTokens || 0,
                      renderPkg.cost.completionTokens || 0,
                    );
                    const skillHash = renderPkg.skillMetadata?.systemPromptHash;
                    const dataSourcesSummary = formatDataSourcesSummary(renderPkg.dataSources);
                    const blobFields: string[] = [];
                    if (resolution?.outputIsBlob) blobFields.push('output');
                    if (resolution?.skillTextIsBlob) blobFields.push('skill text');
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
                      { label: 'Content profile', value: record.contentProfile ?? 'default' },
                      { label: 'Data sources', value: dataSourcesSummary ?? '—' },
                      // A hash-only skill prompt (#411) has no section B; this
                      // is where its hash is disclosed.
                      ...(skillHash ? [{
                        label: 'Skill hash', value: skillHash.slice(0, 12), mono: true,
                      }] : []),
                      { label: 'Prompt tokens', value: renderPkg.cost.promptTokens?.toLocaleString() || '—' },
                      { label: 'Completion tokens', value: renderPkg.cost.completionTokens?.toLocaleString() || '—' },
                      { label: 'Total tokens', value: renderPkg.cost.totalTokens?.toLocaleString() || '—' },
                      { label: 'Estimated cost', value: cost !== null ? `~$${cost.toFixed(cost < 0.01 ? 4 : 2)}` : '—' },
                      { label: 'Duration', value: renderPkg.cost.durationMs ? `${(renderPkg.cost.durationMs / 1000).toFixed(1)}s` : '—' },
                      { label: 'Tool calls', value: String(renderPkg.queries.length) },
                      ...(blobFields.length > 0 ? [{
                        label: 'Blob-stored fields', value: blobFields.join(', '),
                      }] : []),
                    ];
                    return (
                      <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: '12px',
                      }}>
                        {items.map((item) => (
                          <div data-part="c-item" key={item.label} style={{
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

                {/* D · Deliberative trace — collapsed by default. The
                    record-level unrecorded-outcomes sentence that sat here is
                    above the answer now (ruling D2), stated once. */}
                <Section title="D · Deliberative trace">
                  <details>
                    <summary style={{
                      cursor: 'pointer', fontSize: '13px',
                      color: 'var(--text-secondary)', padding: '8px 0',
                    }}>
                      Show {renderPkg.queries.length} tool {renderPkg.queries.length === 1 ? 'call' : 'calls'}
                    </summary>
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {renderPkg.queries.map((q, i) => {
                        // #384 F5: what the call returned is stated through the
                        // one formatter both renderers share — a rejected call is
                        // said to have failed, an empty result to have returned
                        // nothing, and an entry with neither is stated as
                        // unrecorded, never as either.
                        const outcome = describeQueryOutcome(q, { refusedInTrace: fromTrace?.refused.has(i) ?? false });
                        // The signed duration, raw, when the outcome sentence
                        // does not state it (LAYOUT-W1 P3). A returned call's
                        // sentence ends " · Nms" and a failed one's says "The
                        // attempt took Nms"; neither gets a second, bare number,
                        // which beside "did not complete" reads as how long the
                        // call took to succeed (#413).
                        const duration = outcome.kind === 'unrecorded' ? q.duration_ms : undefined;
                        return (
                          <div data-part="call" key={i} style={{
                            padding: '10px 14px', border: '1px solid var(--border-color)',
                            borderRadius: '4px', fontSize: '13px',
                          }}>
                            <div style={{ fontFamily: 'monospace', color: 'var(--text-primary)', marginBottom: '4px' }}>
                              {upstreamToolName(q.tool)}{q.operationType ? ` (${q.operationType})` : ''}
                            </div>
                            {/* The signed entry's dataset and portal, raw, when
                                it carries them (ruling D6), and its duration
                                when the outcome below does not state it. */}
                            {(q.datasetId || q.portal || duration !== undefined) && (
                              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                {[
                                  q.datasetId ? <span key="dataset">Dataset <code>{q.datasetId}</code></span> : null,
                                  q.portal ? <span key="portal">Portal <code>{q.portal}</code></span> : null,
                                  duration !== undefined ? <span key="duration">Duration <code>{duration}ms</code></span> : null,
                                ]
                                  .filter((part) => part !== null)
                                  .flatMap((part, j) => (j === 0 ? [part] : [<span key={`sep-${j}`}>{' · '}</span>, part]))}
                              </div>
                            )}
                            <pre style={{
                              fontSize: '11px', color: 'var(--text-secondary)', margin: 0,
                              overflow: 'auto', whiteSpace: 'pre-wrap',
                            }}>
                              {JSON.stringify(q.arguments, null, 2)}
                            </pre>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                              {outcome.text}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                </Section>

                {/* E · Answer notebook. The bundle download is offered for an
                    A-G-format record only — the route refuses any other
                    profile; every notebook keeps NotebookSection's own
                    download. */}
                {notebook !== undefined ? (
                  <Section title="E · Answer notebook">
                    {(reproductionAssertion !== null || isDatHere) && (
                      <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        {reproductionAssertion !== null && (
                          <>
                            {reproductionAssertion}{' '}
                          </>
                        )}
                        {isDatHere && (
                          <a href={`/api/records/${slug}/bundle`} style={{ color: 'var(--accent)' }}>
                            Download notebook (.ipynb)
                          </a>
                        )}
                      </div>
                    )}
                    <NotebookSection notebook={notebook} slug={slug} />
                  </Section>
                ) : null}

                {/* F · Rendered answer — the same answer element as above. */}
                <Section title="F · Rendered answer">
                  {answer}
                  {resolution?.outputIsBlob && (
                    <div style={{
                      marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)',
                      fontFamily: 'monospace',
                    }}>
                      Output stored as blob (verified) · {resolution.outputBlobRef?.size.toLocaleString()} bytes
                    </div>
                  )}
                </Section>
              </>
            )}

            {/* G · Summary — the package's, else the database row's. With no
                package to load, this is the one part of the envelope that can
                render. */}
            <Section title="G · Summary">
              <div style={{
                padding: '12px 16px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
                borderLeft: '3px solid var(--accent)', borderRadius: '0 4px 4px 0',
                fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary)',
              }}>
                {renderPkg?.summary ?? record.summary}
              </div>
            </Section>

            {/* Provenance Graph (W3C PROV-O) */}
            {renderPkg?.provenance && (
              <Section title="Provenance Graph">
                <ProvenanceGraphSection provenance={renderPkg.provenance} slug={slug} />
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

            {/* Verification Status */}
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
          </div>
        </details>

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

        {/* Actions */}
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
