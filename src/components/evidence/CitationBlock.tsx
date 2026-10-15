'use client';

/**
 * The record page's Citation block, beneath the answer (LAYOUT-W1, ruling D3).
 *
 * Shaped like the executed run's `ChatCitationPreview`: a "Citation" heading
 * over a collapsed disclosure with both formats ("Plain text", "For
 * deliberative process reference") and a Copy button for each. Its text comes
 * from `buildRecordCitations`, which the Cite modal in Actions also calls, so
 * the block and the modal cannot differ.
 *
 * Rendered on the server and hydrated in the browser, so every input is a prop
 * resolved on the server: the origin is the request host's (the page derives
 * it beside the commitment URL), never `window.location`, and the builder
 * states the date in UTC. Both come out the same on either side.
 *
 * Disclosure, not validation (docs/design-principles.md, Principle 1): the
 * citation says when and by whom the record was published, not that it is
 * correct.
 */
import { useState } from 'react';
import { buildRecordCitations, type RecordCitationInput } from '@/lib/evidence/record-citation';

export default function CitationBlock(props: RecordCitationInput) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const citations = buildRecordCitations(props);

  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch {
      // The clipboard API can be unavailable (some browsers, iframes); the
      // text is selectable in the block either way.
    }
  };

  return (
    <section data-part="citation" style={{ marginBottom: '32px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '10px', color: 'var(--text-primary)' }}>
        Citation
      </h3>
      <details>
        <summary style={{
          cursor: 'pointer', fontSize: '13px',
          color: 'var(--text-secondary)', padding: '8px 0',
        }}>
          Show how to cite this record
        </summary>
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {citations.map((c, i) => (
            <div key={c.label}>
              <div style={{
                fontSize: '11px', fontWeight: 600,
                color: 'var(--text-muted)', marginBottom: '4px',
              }}>
                {c.label}
              </div>
              <div style={{
                padding: '10px 12px', backgroundColor: 'var(--card-background)', borderRadius: '4px',
                border: '1px solid var(--border-color)',
                fontSize: '13px', lineHeight: 1.5,
                marginBottom: '6px', whiteSpace: 'pre-wrap',
              }}>
                {c.text}
              </div>
              <button
                onClick={() => handleCopy(c.text, i)}
                style={{
                  background: 'none', border: '1px solid var(--border-color)', borderRadius: '4px',
                  padding: '4px 10px', fontSize: '12px', cursor: 'pointer',
                  color: copiedIdx === i ? 'var(--success)' : 'var(--text-muted)',
                }}
              >
                {copiedIdx === i ? 'Copied' : 'Copy'}
              </button>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
