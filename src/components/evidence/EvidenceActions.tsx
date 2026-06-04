'use client';

import { useState } from 'react';
import TrustSignal from './TrustSignal';
import {
  resolveEnvelopeIntegrity,
  resolveSignature,
  resolveTimestamp,
  resolveRekor,
  resolveKeyTrust,
  resolveCaptureMethodLabel,
} from '@/lib/evidence/trust-signal';
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
}

function CitePopover({ title, creatorName, createdAt, slug, onClose }: {
  title: string; creatorName: string; createdAt: string; slug: string; onClose: () => void;
}) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const url = typeof window !== 'undefined' ? `${window.location.origin}/evidence/${slug}` : `/evidence/${slug}`;

  const citations = [
    {
      label: 'Plain text',
      text: `${creatorName} (${year}). "${title}." Civic AI Tools Evidence Package. ${url}. Published: ${dateStr}.`,
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
 * The verify-route response shape. #111 renders only the five legacy checks
 * (hashMatch, signatureValid, keyTrust, hasTimestamp, rekorVerified), but the
 * type is aligned to the route's full emitted shape (spec §9.2 checks #3-#15 +
 * lifecycle) as a clean base for the #113/#114 panel waves — those fields are
 * typed here but intentionally NOT surfaced yet. The upstream interfaces are
 * type-only imports, so this client component pulls in no node:crypto runtime.
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
  slug, title, creatorName, createdAt, packageUrl, captureMethod,
}: EvidenceActionsProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [showCite, setShowCite] = useState(false);
  const [verifyState, setVerifyState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
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

  const handleVerify = async () => {
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <button onClick={handleDownload} style={btnStyle}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z" />
            <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z" />
          </svg>
          Download Package
        </button>
        <button
          onClick={handleVerify}
          disabled={verifyState === 'loading'}
          style={{ ...btnStyle, color: verifyState === 'loading' ? 'var(--text-muted)' : btnStyle.color }}
        >
          {verifyState === 'loading' ? 'Verifying...' : 'Verify Integrity'}
        </button>
        <button onClick={handleCopyLink} style={{ ...btnStyle, color: linkCopied ? 'var(--nyc-success)' : btnStyle.color }}>
          {linkCopied ? 'Copied' : 'Copy Link'}
        </button>
        <button onClick={() => setShowCite(true)} style={btnStyle}>
          Cite
        </button>
      </div>

      {/* Verification results */}
      {verifyState === 'done' && verifyResult && (
        <div style={{
          marginTop: '12px', padding: '14px 16px',
          border: '1px solid var(--border-color)', borderRadius: '6px',
          backgroundColor: 'white',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>Verification Results</div>
          {/* The five integrity checks, re-skinned onto <TrustSignal> and driven
              entirely by the trust-signal vocabulary (#110). Legacy / back-compat
              statuses resolve to Verified or Normal — never amber or red — so a
              pre-v0.1 package reads calm (the #111 calm baseline). The label is
              the verdict one-liner; the muted detail expands it (P5). */}

          {/* #1 Envelope integrity */}
          <TrustSignal {...resolveEnvelopeIntegrity(verifyResult.hashMatch)} />

          {/* #2 Cryptographic signature, with the captureMethod label directly
              beneath it — "signed ≠ verbatim" (spec §9.2 #11). A valid signature
              proves the bytes are unchanged since signing, not that they are a
              verbatim capture; the caption says how the signed bytes were obtained. */}
          <TrustSignal {...resolveSignature(verifyResult.signatureValid)} />
          {captureMethodCaption && (
            <div
              style={{
                marginLeft: '24px',
                marginBottom: '8px',
                fontSize: '12px',
                lineHeight: 1.45,
                color: 'var(--text-muted)',
              }}
            >
              {captureMethodCaption}
            </div>
          )}

          {/* #5 Key trust (keyTrust:null = unsigned → calm Normal) */}
          <TrustSignal {...resolveKeyTrust(verifyResult.keyTrust)} />

          {/* #7 RFC 3161 timestamp */}
          <TrustSignal {...resolveTimestamp(verifyResult.hasTimestamp)} />

          {/* #8 Transparency log (Rekor) */}
          <TrustSignal {...resolveRekor(verifyResult.rekorVerified)} />
          {verifyResult.details.rekor?.logEntryUrl && (
            <div style={{ marginTop: '6px', fontSize: '12px' }}>
              <a
                href={verifyResult.details.rekor.logEntryUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--nyc-blue)', textDecoration: 'underline' }}
              >
                View Rekor log entry (index {verifyResult.details.rekor.logIndex})
              </a>
            </div>
          )}
        </div>
      )}
      {verifyState === 'error' && (
        <div style={{
          marginTop: '12px', padding: '10px 14px', fontSize: '13px',
          color: 'var(--nyc-error)', backgroundColor: 'rgba(236, 19, 30, 0.06)',
          borderRadius: '4px',
        }}>
          Verification request failed. Try again.
        </div>
      )}

      {showCite && (
        <CitePopover
          title={title}
          creatorName={creatorName}
          createdAt={createdAt}
          slug={slug}
          onClose={() => setShowCite(false)}
        />
      )}
    </>
  );
}
