'use client';

import { useState, useEffect } from 'react';
import TrustSignal from './TrustSignal';
import VerifyBadge from './VerifyBadge';
import {
  summarizeIntegrity,
  resolveCaptureMethodLabel,
} from '@/lib/evidence/trust-signal';
import { normalizeVisibility } from '@/lib/evidence/visibility';
import type {
  KeyTrustResult,
  BlobRefVerification,
  TypeResolution,
  SignerIdentityCheck,
  CaptureMethodVocabCheck,
  ContentCanonicalizationResolution,
  ContentHashCheck,
  LifecycleResolution,
} from '@/lib/evidence/verify';

interface EvidenceActionsProps {
  slug: string;
  title: string;
  creatorName: string;
  createdAt: string;
  packageUrl: string;
  /** ADR-0003 captureMethod DB column (enum string | null). Rendered as a
   *  neutral informational label beside the signature verdict (#11,
   *  "signed ≠ verbatim"). */
  captureMethod: string | null;
  /** Record visibility, as the raw DB label — either vocabulary (ADR-0016 §A;
   *  normalized through `@/lib/evidence/visibility`). Gates the verify badge
   *  (#114): the delegated verifier resolves a package via its commitment
   *  sidecar, which is redacted for sealed records, so the badge is
   *  public-state-only. */
  visibility: string;
  /** Absolute, publicly-fetchable commitment endpoint for this package
   *  (resolved server-side from the request host). The verify badge (#114)
   *  deep-links the neutral verifier to it. */
  commitmentUrl: string;
  /** Instance display name for the citation label (#217), resolved
   *  server-side by the detail page from `SITE_BRAND_NAME`
   *  (src/lib/brand-config.ts) — a prop, not context, because the server
   *  page renders this component directly.
   *
   *  REQUIRED and nullable since #259 P4 (D8). The default was the reference
   *  deployment's name and it reached user-visible COPY-PASTE text: the Cite
   *  popover writes it into the clipboard, so a mount that forgot the prop
   *  would have published citations crediting another deployment. `null`
   *  means the instance has not named itself, and the citation says
   *  "Evidence Package" with no publisher rather than inventing one. */
  brandName: string | null;
}

/** Exported for render-harness/tests only — the popover mounts on the Cite
 *  button's click, which a DOM-free server render cannot simulate. */
export function CitePopover({ title, creatorName, createdAt, slug, brandName, onClose }: {
  title: string; creatorName: string; createdAt: string; slug: string; brandName: string | null; onClose: () => void;
}) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const url = typeof window !== 'undefined' ? `${window.location.origin}/evidence/${slug}` : `/evidence/${slug}`;

  const citations = [
    {
      label: 'Plain text',
      text: `${creatorName} (${year}). "${title}." ${brandName === null ? '' : `${brandName} `}Evidence Package. ${url}. Published: ${dateStr}.`,
    },
    {
      label: 'For deliberative process reference',
      text: `Evidence: ${title} [Verified: ${dateStr}] ${url}`,
    },
  ];

  const handleCopy = async (text: string, idx: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        backgroundColor: 'white', borderRadius: '8px', width: '100%', maxWidth: '500px',
        margin: '16px', padding: '24px', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Cite this evidence</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}>&times;</button>
        </div>
        {citations.map((c, i) => (
          <div key={i} style={{ marginBottom: i < citations.length - 1 ? '16px' : 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>{c.label}</div>
            <div style={{
              padding: '10px 12px', backgroundColor: '#f5f5f5', borderRadius: '4px',
              fontSize: '13px', lineHeight: '1.5', fontFamily: 'inherit', marginBottom: '6px',
            }}>
              {c.text}
            </div>
            <button
              onClick={() => handleCopy(c.text, i)}
              style={{
                background: 'none', border: '1px solid var(--border-color)', borderRadius: '4px',
                padding: '4px 10px', fontSize: '12px', cursor: 'pointer',
                color: copiedIdx === i ? 'var(--nyc-success)' : 'var(--text-muted)',
              }}
            >
              {copiedIdx === i ? 'Copied' : 'Copy'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The verify-route response shape. The #113 in-page glance rolls these checks
 * into ONE worst-tier-wins summary (`summarizeIntegrity`); the full per-check
 * "show the math" is delegated to the neutral verifier at typedstandards.org
 * /verify (ADR-0013 / Q46), reached via the verify badge (#114). The structural
 * superset of `IntegrityGlanceInput`, so the fetched result passes straight in.
 * The upstream interfaces are type-only imports, so this client component pulls
 * in no node:crypto runtime.
 */
interface VerifyResult {
  hashMatch: boolean;
  signatureValid: boolean | null;
  rekorVerified: boolean | null;
  hasTimestamp: boolean;
  keyTrust: KeyTrustResult | null;
  blobRefsVerified: boolean | null;
  blobRefs: BlobRefVerification[];
  contentCanonicalization: ContentCanonicalizationResolution | null;
  contentHash: ContentHashCheck | null;
  nodeId: string | null;
  typeResolution: TypeResolution | null;
  signerIdentity: SignerIdentityCheck | null;
  captureMethodVocab: CaptureMethodVocabCheck | null;
  lifecycle: LifecycleResolution;
  details: {
    storedHash?: string | null;
    recomputedHash?: string | null;
    hasSigning: boolean;
    hasRekor: boolean;
    rekor?: { logIndex?: number; logEntryUrl?: string } | null;
    kid?: string;
  };
}

export default function EvidenceActions({
  slug, title, creatorName, createdAt, packageUrl, captureMethod, visibility, commitmentUrl,
  brandName,
}: EvidenceActionsProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [showCite, setShowCite] = useState(false);
  const [verifyState, setVerifyState] = useState<'loading' | 'done' | 'error'>('loading');
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  // captureMethod LABEL (#11, "signed != verbatim"): a neutral, signature-covered
  // reading of HOW the bytes were captured, shown beside the signature verdict.
  // Pre-ADR-0003 packages have no captureMethod (null), so the line is omitted.
  const captureMethodCaption = resolveCaptureMethodLabel(captureMethod);

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/evidence/${slug}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = packageUrl;
    a.download = `evidence-${slug}.json`;
    a.click();
  };

  // The integrity glance auto-loads so it is a true glance (always present,
  // P5's glance layer), not gated behind a click. A failure to LOAD the check
  // is rendered calm (a muted "couldn't load" + Retry), never as an integrity
  // failure — our endpoint being unreachable says nothing about the package
  // (P1 disclosure ≠ validation, P3 no false precision).
  const runVerify = async () => {
    setVerifyState('loading');
    try {
      const res = await fetch(`/api/evidence/${slug}/verify`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setVerifyResult(data);
      setVerifyState('done');
    } catch {
      setVerifyState('error');
    }
  };

  useEffect(() => {
    runVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const btnStyle: React.CSSProperties = {
    background: 'none',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  };

  return (
    <>
      {/* Integrity glance (#113) — a single calm, worst-tier-wins overall
          verdict, auto-loaded so it is always present (P5's glance layer), not
          gated behind a click. The full per-check "show the math" is delegated
          to the neutral verifier at typedstandards.org/verify (ADR-0013 / Q46),
          reached via the verify badge (#114), and is not rendered here. */}
      <div style={{ marginBottom: '16px' }}>
        {verifyState === 'loading' && (
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Checking integrity…
          </div>
        )}

        {verifyState === 'done' && verifyResult && (
          <>
            {/* Worst-tier-wins summary. Legacy / back-compat checks
                (legacy_relabeled, legacy_embedded, no timestamp, …) roll up into
                the calm "Integrity verified" — never amber/red (the load-bearing
                calm requirement). Amber/red appear only on a genuine
                unconfirmed/failed check. */}
            <TrustSignal {...summarizeIntegrity(verifyResult)} />

            {/* captureMethod label adjacent to the glance — "signed ≠ verbatim"
                (spec §9.2 #11): the summary's signature check proves the bytes
                are unchanged since signing, not that they are a verbatim
                capture; this caption says how the signed bytes were obtained.
                Omitted for pre-ADR-0003 packages (null), keeping legacy calm. */}
            {captureMethodCaption && (
              <div
                style={{
                  marginLeft: '24px',
                  fontSize: '12px',
                  lineHeight: 1.45,
                  color: 'var(--text-muted)',
                }}
              >
                {captureMethodCaption}
              </div>
            )}
          </>
        )}

        {/* A failure to LOAD the check is calm, not an alarm — our endpoint
            being unreachable says nothing about the package (P1 / P3). */}
        {verifyState === 'error' && (
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Integrity check couldn’t be loaded.{' '}
            <button
              onClick={runVerify}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: '13px',
                color: 'var(--nyc-blue)',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Verify-independently badge (#114) — the host-side entry point to the
            neutral verifier (ADR-0013 / Q46). Public-state-only: the verifier
            resolves a package through its commitment sidecar, which is redacted
            for sealed records (content private), so /verify would show a
            missing-content alarm. Rendered independent of the glance's load
            state — when our own check can't load, "verify it yourself" matters
            most. */}
        {normalizeVisibility(visibility) === 'public' && <VerifyBadge commitmentUrl={commitmentUrl} />}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <button onClick={handleDownload} style={btnStyle}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z" />
            <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z" />
          </svg>
          Download Package
        </button>
        <button onClick={handleCopyLink} style={{ ...btnStyle, color: linkCopied ? 'var(--nyc-success)' : btnStyle.color }}>
          {linkCopied ? 'Copied' : 'Copy Link'}
        </button>
        <button onClick={() => setShowCite(true)} style={btnStyle}>
          Cite
        </button>
      </div>

      {showCite && (
        <CitePopover
          title={title}
          creatorName={creatorName}
          createdAt={createdAt}
          slug={slug}
          brandName={brandName}
          onClose={() => setShowCite(false)}
        />
      )}
    </>
  );
}
