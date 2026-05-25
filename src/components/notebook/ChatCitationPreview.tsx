'use client';

/**
 * Phase 2a1 — pre-publish citation preview.
 *
 * Mirrors the format of `src/components/evidence/EvidenceActions.tsx`'s
 * CitePopover (two formats — Plain text + Deliberative process reference)
 * but honest about pre-publish state: there is no slug, no public URL, no
 * permanent record yet. Surfaces the citation as a collapsible disclosure
 * so the reader can preview what the citation will look like once
 * published, with `(URL assigned at publish)` where the slug-URL would go.
 *
 * Two surfaces, same shape:
 *   - Detail page: `Cite` button → modal CitePopover with the canonical URL
 *   - Chat output (here): inline disclosure with the placeholder URL
 *
 * This is `disclosure not validation` per design-principles.md Principle 1:
 * the citation describes process (when, by whom), not truth.
 */
import { useSession } from 'next-auth/react';
import { useState } from 'react';

interface ChatCitationPreviewProps {
  prompt: string;
  /** Stamped at Phase D; used as the citation date. */
  executedAt: string | null;
  /** Phase 2a2 item 3: structured summary from notebook root metadata.
   *  When present, the "Deliberative process reference" citation includes
   *  the headline finding for context. */
  structuredSummary?: {
    analysisDescription: string;
    headlineFinding: string;
  } | null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '24px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '10px', color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function deriveTitle(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return 'Civic AI Tools Evidence Package';
  // Use the first sentence-ish chunk, capped.
  const firstChunk = trimmed.split(/[?.!\n]/)[0]?.trim() || trimmed;
  if (firstChunk.length <= 100) return firstChunk;
  return firstChunk.slice(0, 97).trim() + '…';
}

export default function ChatCitationPreview({ prompt, executedAt, structuredSummary }: ChatCitationPreviewProps) {
  const { data: session } = useSession();
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const creatorName = session?.user?.name || 'Anonymous';
  const date = executedAt ? new Date(executedAt) : new Date();
  const year = date.getFullYear();
  const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  // Phase 2a2 item 3: prefer the analysis description from the structured
  // summary when present (it's an LLM-authored one-clause; cleaner than the
  // prompt's first sentence). Otherwise fall back to the prompt-derived
  // title heuristic.
  const title = structuredSummary?.analysisDescription
    ? structuredSummary.analysisDescription.replace(/[.!?]+$/, '')
    : deriveTitle(prompt);
  const placeholderUrl = 'https://civicaitools.org/evidence/(URL assigned at publish)';

  const headlineSuffix = structuredSummary?.headlineFinding
    ? ` Headline finding: ${structuredSummary.headlineFinding}`
    : '';
  const citations = [
    {
      label: 'Plain text',
      text: `${creatorName} (${year}). "${title}." Civic AI Tools Evidence Package. ${placeholderUrl}. Published: (date assigned at publish).${headlineSuffix}`,
    },
    {
      label: 'For deliberative process reference',
      text: `Evidence: ${title} [Executed: ${dateStr}] ${placeholderUrl}${headlineSuffix}`,
    },
  ];

  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch {
      // Clipboard API may be unavailable in some browsers / iframes; silently
      // ignore — the citation text is selectable in the UI either way.
    }
  };

  return (
    <Section title="Citation">
      <details>
        <summary style={{
          cursor: 'pointer', fontSize: '13px',
          color: 'var(--text-secondary)', padding: '8px 0',
        }}>
          Preview how this analysis would be cited
        </summary>
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {citations.map((c, i) => (
            <div key={i}>
              <div style={{
                fontSize: '11px', fontWeight: 600,
                color: 'var(--text-muted)', marginBottom: '4px',
              }}>
                {c.label}
              </div>
              <div style={{
                padding: '10px 12px', backgroundColor: '#f5f5f5', borderRadius: '4px',
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
                  color: copiedIdx === i ? 'var(--nyc-success)' : 'var(--text-muted)',
                }}
              >
                {copiedIdx === i ? 'Copied' : 'Copy'}
              </button>
            </div>
          ))}
          <p style={{
            margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5,
          }}>
            Publishing this analysis assigns a permanent URL, a publish date,
            and a content-addressable hash; the citation above becomes
            stable at that point.
          </p>
        </div>
      </details>
    </Section>
  );
}
