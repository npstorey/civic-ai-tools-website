'use client';

import { useState } from 'react';
import type { BlobRef } from '@/lib/evidence/blob-ref';

interface SkillSectionProps {
  /** Inline skill text from the package JSON. Mutually exclusive with
   *  `skillTextRef`. */
  skillText?: string;
  /** Blob reference pointing at the skill text. Fetched on first expand so
   *  the detail page doesn't pay the download cost up front for a section
   *  most viewers never open. */
  skillTextRef?: BlobRef;
  skillHash?: string;
}

interface FetchState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  text: string;
  error?: string;
}

export default function SkillSection({ skillText, skillTextRef, skillHash }: SkillSectionProps) {
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState<FetchState>({ status: 'idle', text: '' });

  const usingRef = skillTextRef !== undefined;
  const resolvedText = usingRef ? (fetched.status === 'loaded' ? fetched.text : '') : (skillText ?? '');
  const lineCount = resolvedText ? resolvedText.split('\n').length : 0;
  const charCount = usingRef ? skillTextRef.size : resolvedText.length;

  async function handleToggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && usingRef && fetched.status === 'idle') {
      setFetched({ status: 'loading', text: '' });
      try {
        const res = await fetch(skillTextRef.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setFetched({ status: 'loaded', text });
      } catch (err) {
        setFetched({
          status: 'error',
          text: '',
          error: err instanceof Error ? err.message : 'fetch failed',
        });
      }
    }
  }

  const buttonLabel = open
    ? 'Hide skill guidance'
    : usingRef
      ? `View skill guidance (${charCount.toLocaleString()} bytes, stored as blob)`
      : `View skill guidance (${lineCount} lines, ${charCount.toLocaleString()} chars)`;

  return (
    <div style={{
      padding: '16px 20px', border: '1px solid var(--border-color)',
      borderRadius: '6px', backgroundColor: 'white',
    }}>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
        The exact skill guidance text sent to the model as the system prompt for this analysis.
        {skillHash ? ' This is the source of the skill hash recorded in the package.' : ''}
      </p>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: open ? '16px' : 0, flexWrap: 'wrap' }}>
        <button
          onClick={handleToggle}
          style={{
            background: 'none', border: '1px solid var(--nyc-blue)', borderRadius: '4px',
            padding: '6px 14px', fontSize: '13px', cursor: 'pointer',
            color: 'var(--nyc-blue)', fontWeight: 500,
          }}
        >
          {buttonLabel}
        </button>
        {usingRef && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            {skillTextRef.ref.slice(0, 'blob:sha256:'.length + 12)}…
          </span>
        )}
      </div>

      {open && (
        <>
          {usingRef && fetched.status === 'loading' && (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Fetching skill content…
            </div>
          )}
          {usingRef && fetched.status === 'error' && (
            <div style={{ fontSize: '13px', color: 'var(--nyc-error)' }}>
              Could not fetch blob: {fetched.error}
            </div>
          )}
          {(!usingRef || fetched.status === 'loaded') && (
            <pre style={{
              padding: '12px 14px', backgroundColor: '#f5f5f5', borderRadius: '4px',
              fontSize: '12px', lineHeight: 1.5, overflow: 'auto', maxHeight: '500px',
              whiteSpace: 'pre-wrap', margin: 0,
            }}>
              {resolvedText}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
