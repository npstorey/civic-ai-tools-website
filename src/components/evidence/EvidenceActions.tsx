'use client';

import { useState } from 'react';

interface EvidenceActionsProps {
  slug: string;
  title: string;
  creatorName: string;
  createdAt: string;
  packageUrl: string;
  verificationStatus: string;
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

type KeyTrustStatus =
  | 'active'
  | 'deprecated_valid'
  | 'deprecated_invalid'
  | 'revoked'
  | 'unknown_key'
  | 'registry_unavailable'
  | 'legacy_embedded';

interface KeyTrust {
  status: KeyTrustStatus;
  verified: boolean;
  /** Optional because `legacy_embedded` signatures predate the trust
   *  registry and therefore have no kid. */
  kid?: string;
  deprecatedAt?: string | null;
  revokedAt?: string | null;
}

interface VerifyResult {
  hashMatch: boolean;
  signatureValid: boolean | null;
  rekorVerified: boolean | null;
  hasTimestamp: boolean;
  keyTrust: KeyTrust | null;
  details: {
    hasSigning: boolean;
    hasRekor: boolean;
    rekor?: { logIndex?: number; logEntryUrl?: string } | null;
    kid?: string;
  };
}

function keyTrustCopy(keyTrust: KeyTrust): string {
  switch (keyTrust.status) {
    case 'active':
      return `Signed with active key (${keyTrust.kid})`;
    case 'deprecated_valid':
      return `Signed with deprecated key before rotation (${keyTrust.kid})`;
    case 'deprecated_invalid':
      return `Key deprecated before this signature — do not trust (${keyTrust.kid})`;
    case 'revoked':
      return `Key revoked — do not trust (${keyTrust.kid})`;
    case 'unknown_key':
      return `Key not in platform trust registry (${keyTrust.kid})`;
    case 'registry_unavailable':
      return 'Trust registry unavailable — could not verify key';
    case 'legacy_embedded':
      return 'Signed with legacy embedded key (pre-trust-registry package)';
  }
}

/**
 * Map a key-trust result onto the icon state used by `VerifyCheck`:
 *   - `true`  → ✅ green (registry-validated)
 *   - `false` → ❌ red (registry says untrusted)
 *   - `null`  → ➖ neutral (no signing key, or pre-registry legacy package)
 */
function keyTrustIconStatus(keyTrust: KeyTrust | null): boolean | null {
  if (keyTrust === null) return null;
  if (keyTrust.status === 'legacy_embedded') return null;
  return keyTrust.verified;
}

function VerifyCheck({ label, status, detail }: { label: string; status: boolean | null; detail?: string }) {
  const icon = status === true ? '\u2705' : status === false ? '\u274C' : '\u2796';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', marginBottom: '6px' }}>
      <span>{icon}</span>
      <div>
        <span style={{ color: 'var(--text-primary)' }}>{label}</span>
        {detail && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{detail}</span>}
      </div>
    </div>
  );
}

export default function EvidenceActions({
  slug, title, creatorName, createdAt, packageUrl, verificationStatus,
}: EvidenceActionsProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [showCite, setShowCite] = useState(false);
  const [verifyState, setVerifyState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

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
          <VerifyCheck
            label="Package integrity"
            status={verifyResult.hashMatch}
            detail={verifyResult.hashMatch ? 'Hash matches stored package' : 'Hash mismatch — package may have been altered'}
          />
          <VerifyCheck
            label="Cryptographic signature"
            status={verifyResult.signatureValid}
            detail={
              verifyResult.signatureValid === null
                ? 'Not signed'
                : verifyResult.signatureValid
                  ? 'Valid Ed25519 signature'
                  : 'Invalid signature'
            }
          />
          <VerifyCheck
            label="Key trust"
            status={keyTrustIconStatus(verifyResult.keyTrust)}
            detail={
              verifyResult.keyTrust === null
                ? 'No signing key recorded'
                : keyTrustCopy(verifyResult.keyTrust)
            }
          />
          <VerifyCheck
            label="RFC 3161 timestamp"
            status={verifyResult.hasTimestamp ? true : null}
            detail={verifyResult.hasTimestamp ? 'Timestamp token present' : 'No timestamp'}
          />
          <VerifyCheck
            label="Transparency log (Rekor)"
            status={verifyResult.rekorVerified}
            detail={
              verifyResult.rekorVerified === null
                ? 'Not published to Rekor'
                : verifyResult.rekorVerified
                  ? 'Entry verified on Sigstore Rekor'
                  : 'Rekor verification failed'
            }
          />
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
