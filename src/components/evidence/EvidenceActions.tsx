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

export default function EvidenceActions({
  slug, title, creatorName, createdAt, packageUrl, verificationStatus,
}: EvidenceActionsProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [showCite, setShowCite] = useState(false);

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
          onClose={() => setShowCite(false)}
        />
      )}
    </>
  );
}
