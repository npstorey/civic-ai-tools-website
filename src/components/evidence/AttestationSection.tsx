'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AttestationDialog from './AttestationDialog';

type AttestationType = 'consistency' | 'evaluation' | 'expert_attestation';
type ExpertRating = 'endorse' | 'concerns' | 'dispute' | 'neutral';

interface Attestation {
  id: string;
  type: AttestationType;
  packageHash: string;
  storageKey: string;
  createdAt: string;
  creatorDisplayName: string;
  creatorGithubUrl: string;
}

interface AttestationPackageData {
  type: string;
  metrics?: {
    toolCallOverlap: number;
    outputSimilarity: number;
    consistencyClassification: string;
  };
  config?: { numRuns: number };
  evaluatorModel?: string;
  rubric?: Record<string, { score: number; comment: string }>;
  overallScore?: number;
  assessment?: string;
  // Expert attestation fields
  body?: string;
  expertise?: string;
  rating?: ExpertRating;
  attesterDisplayName?: string;
  attesterGithubProfileUrl?: string;
}

interface AttestationSectionProps {
  slug: string;
  analysisModel: string;
  promptVisibility: string;
}

export default function AttestationSection({ slug, analysisModel, promptVisibility }: AttestationSectionProps) {
  const { data: session } = useSession();
  const [attestations, setAttestations] = useState<Attestation[]>([]);
  const [expandedPkgs, setExpandedPkgs] = useState<Record<string, AttestationPackageData | null>>({});
  // Expert attestations render their body inline rather than behind a "Show
  // details" toggle, so we fetch their blobs once on list load.
  const [expertPayloads, setExpertPayloads] = useState<Record<string, AttestationPackageData | null>>({});
  const [loading, setLoading] = useState(true);

  const fetchAttestations = useCallback(async () => {
    try {
      const res = await fetch(`/api/evidence/${slug}/attestations`);
      if (res.ok) {
        const data = await res.json();
        setAttestations(data.attestations || []);
      }
    } catch {
      // Silently fail — attestation list is non-critical
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchAttestations();
  }, [fetchAttestations]);

  // Eagerly load blobs for expert attestations so the body is visible
  // immediately. The blob URL is a public Vercel CDN path; per-attestation
  // cost is ~1 round trip and responses are small.
  useEffect(() => {
    const expertToLoad = attestations.filter(
      (a) => a.type === 'expert_attestation' && !(a.id in expertPayloads),
    );
    if (expertToLoad.length === 0) return;

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        expertToLoad.map(async (a) => {
          try {
            const res = await fetch(a.storageKey);
            if (!res.ok) return [a.id, null] as const;
            const data = (await res.json()) as AttestationPackageData;
            return [a.id, data] as const;
          } catch {
            return [a.id, null] as const;
          }
        }),
      );
      if (cancelled) return;
      setExpertPayloads((prev) => {
        const next = { ...prev };
        for (const [id, data] of results) next[id] = data;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [attestations, expertPayloads]);

  const handleAttestationCreated = useCallback(() => {
    fetchAttestations();
  }, [fetchAttestations]);

  const toggleExpand = async (attestation: Attestation) => {
    if (expandedPkgs[attestation.id] !== undefined) {
      // Toggle off
      setExpandedPkgs(prev => {
        const next = { ...prev };
        delete next[attestation.id];
        return next;
      });
      return;
    }
    // Fetch package data
    try {
      const res = await fetch(attestation.storageKey);
      if (res.ok) {
        const data = await res.json();
        setExpandedPkgs(prev => ({ ...prev, [attestation.id]: data }));
      }
    } catch {
      setExpandedPkgs(prev => ({ ...prev, [attestation.id]: null }));
    }
  };

  const isLoggedIn = !!session?.user?.id;

  return (
    <div style={{
      padding: '16px 20px', border: '1px solid var(--border-color)',
      borderRadius: '6px', backgroundColor: 'white',
    }}>
      {loading ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Loading attestations...</p>
      ) : attestations.length === 0 ? (
        <>
          <p style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--text-muted)' }}>No attestations yet.</p>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Attestations are independent evaluations — consistency tests, adversarial reviews,
            expert attestations, or corrections — that anyone can attach to this evidence record.
          </p>
        </>
      ) : (
        <div style={{ marginBottom: '16px' }}>
          {attestations.map((att) => {
            if (att.type === 'expert_attestation') {
              return (
                <ExpertAttestationCard
                  key={att.id}
                  attestation={att}
                  payload={expertPayloads[att.id]}
                />
              );
            }
            return (
              <AttestationCard
                key={att.id}
                attestation={att}
                expanded={expandedPkgs[att.id]}
                isExpanded={att.id in expandedPkgs}
                onToggle={() => toggleExpand(att)}
              />
            );
          })}
        </div>
      )}

      {isLoggedIn ? (
        <AttestationDialog
          slug={slug}
          analysisModel={analysisModel}
          promptVisibility={promptVisibility}
          onAttestationCreated={handleAttestationCreated}
        />
      ) : (
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
          Sign in with GitHub to add an attestation.
        </p>
      )}
    </div>
  );
}

// --- Machine attestation card (consistency / evaluation) ---

function AttestationCard({ attestation, expanded, isExpanded, onToggle }: {
  attestation: Attestation;
  expanded: AttestationPackageData | null | undefined;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const date = new Date(attestation.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  const typeBadge = attestation.type === 'consistency'
    ? { label: 'Consistency Test', bg: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--nyc-blue)' }
    : { label: 'Evaluation', bg: 'rgba(0, 183, 3, 0.1)', color: 'var(--nyc-success)' };

  return (
    <div style={{
      padding: '12px 0',
      borderBottom: '1px solid rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
          fontSize: '11px', fontWeight: 600, backgroundColor: typeBadge.bg, color: typeBadge.color,
        }}>
          {typeBadge.label}
        </span>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          by{' '}
          <a href={attestation.creatorGithubUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--nyc-blue)', textDecoration: 'none' }}>
            {attestation.creatorDisplayName}
          </a>
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{date}</span>
        <button
          onClick={onToggle}
          style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            fontSize: '12px', color: 'var(--nyc-blue)', cursor: 'pointer',
          }}
        >
          {isExpanded ? 'Hide details' : 'Show details'}
        </button>
      </div>

      {/* Summary metrics inline */}
      {attestation.type === 'consistency' && isExpanded && expanded && expanded.metrics && (
        <div style={{ marginTop: '10px', display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <span>
            {expanded.config?.numRuns || '?'} runs
          </span>
          <span>
            Tool overlap: <strong>{Math.round(expanded.metrics.toolCallOverlap * 100)}%</strong>
          </span>
          <span>
            Output similarity: <strong>{Math.round(expanded.metrics.outputSimilarity * 100)}%</strong>
          </span>
          <span style={{
            fontWeight: 600,
            color: expanded.metrics.consistencyClassification === 'highly_reproducible'
              ? 'var(--nyc-success)'
              : expanded.metrics.consistencyClassification === 'moderately_stable'
                ? 'var(--nyc-blue)'
                : 'var(--nyc-error)',
            textTransform: 'capitalize',
          }}>
            {expanded.metrics.consistencyClassification.replace(/_/g, ' ')}
          </span>
        </div>
      )}

      {attestation.type === 'evaluation' && isExpanded && expanded && expanded.rubric && (
        <div style={{ marginTop: '10px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', fontSize: '13px' }}>
            <span style={{ fontWeight: 600 }}>Overall:</span>
            <span style={{
              fontSize: '16px', fontWeight: 700,
              color: (expanded.overallScore || 0) >= 8 ? 'var(--nyc-success)'
                : (expanded.overallScore || 0) >= 5 ? 'var(--nyc-blue)'
                : 'var(--nyc-error)',
            }}>
              {(expanded.overallScore || 0).toFixed(1)}/10
            </span>
            {expanded.evaluatorModel && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                by {expanded.evaluatorModel}
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '12px' }}>
            {Object.entries(expanded.rubric).map(([key, val]) => (
              <div key={key} style={{ display: 'flex', gap: '6px', color: 'var(--text-secondary)' }}>
                <span style={{
                  fontWeight: 700, minWidth: '18px', textAlign: 'right',
                  color: val.score >= 8 ? 'var(--nyc-success)' : val.score >= 5 ? 'var(--nyc-blue)' : 'var(--nyc-error)',
                }}>
                  {val.score}
                </span>
                <span>{formatCriterionLabel(key)}</span>
              </div>
            ))}
          </div>
          {expanded.assessment && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {expanded.assessment}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatCriterionLabel(key: string): string {
  const labels: Record<string, string> = {
    dataSourceIdentification: 'Data Sources',
    quantitativeClaimSupport: 'Claim Support',
    confoundersAndBias: 'Bias Detection',
    geographicScope: 'Geo Scope',
    limitationsNoted: 'Limitations',
    contradictoryConclusion: 'Alt. Conclusions',
  };
  return labels[key] || key.replace(/([A-Z])/g, ' $1').trim();
}

// --- Expert attestation card (human-submitted review) ---

const RATING_STYLES: Record<ExpertRating, { label: string; bg: string; color: string }> = {
  endorse: { label: 'Endorsed', bg: 'rgba(0, 183, 3, 0.10)', color: 'var(--nyc-success)' },
  concerns: { label: 'Concerns', bg: 'rgba(255, 183, 0, 0.15)', color: '#8a5a00' },
  dispute: { label: 'Disputed', bg: 'rgba(236, 19, 30, 0.08)', color: 'var(--nyc-error)' },
  neutral: { label: 'Neutral note', bg: 'rgba(0, 0, 0, 0.06)', color: 'var(--text-secondary)' },
};

function ExpertAttestationCard({ attestation, payload }: {
  attestation: Attestation;
  payload: AttestationPackageData | null | undefined;
}) {
  const date = new Date(attestation.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  const loaded = payload !== undefined;
  const rating = payload?.rating && RATING_STYLES[payload.rating]
    ? payload.rating
    : 'neutral';
  const ratingStyle = RATING_STYLES[rating];

  return (
    <div style={{
      padding: '14px 16px',
      marginBottom: '10px',
      borderLeft: `3px solid ${ratingStyle.color}`,
      borderRadius: '0 4px 4px 0',
      backgroundColor: 'rgba(0, 0, 0, 0.015)',
    }}>
      {/* Header: type badge + attester + expertise + rating */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <span style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
          fontSize: '11px', fontWeight: 600,
          backgroundColor: 'rgba(83, 49, 156, 0.10)', color: '#53319c',
        }}>
          Expert Attestation
        </span>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          by{' '}
          <a href={attestation.creatorGithubUrl} target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--nyc-blue)', textDecoration: 'none', fontWeight: 500 }}>
            {attestation.creatorDisplayName}
          </a>
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{date}</span>
        <span style={{
          marginLeft: 'auto',
          display: 'inline-block', padding: '2px 10px', borderRadius: '10px',
          fontSize: '11px', fontWeight: 600,
          backgroundColor: ratingStyle.bg, color: ratingStyle.color,
        }}>
          {ratingStyle.label}
        </span>
      </div>

      {/* Expertise line */}
      {payload?.expertise && (
        <div style={{
          fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px',
          fontStyle: 'italic',
        }}>
          {payload.expertise}
        </div>
      )}

      {/* Body — markdown */}
      {loaded && payload?.body ? (
        <div className="expert-attestation-body" style={{
          fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.6,
        }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {payload.body}
          </ReactMarkdown>
        </div>
      ) : loaded ? (
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          [Review body could not be loaded; the stored package may be unavailable.]
        </div>
      ) : (
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Loading review...
        </div>
      )}

      <style jsx>{`
        .expert-attestation-body :global(p) {
          margin: 0 0 10px 0;
        }
        .expert-attestation-body :global(p:last-child) {
          margin-bottom: 0;
        }
        .expert-attestation-body :global(h1),
        .expert-attestation-body :global(h2),
        .expert-attestation-body :global(h3) {
          font-size: 14px;
          font-weight: 600;
          margin: 12px 0 6px;
        }
        .expert-attestation-body :global(ul),
        .expert-attestation-body :global(ol) {
          margin: 0 0 10px 0;
          padding-left: 22px;
        }
        .expert-attestation-body :global(li) {
          margin-bottom: 4px;
        }
        .expert-attestation-body :global(a) {
          color: var(--nyc-blue);
        }
        .expert-attestation-body :global(code) {
          font-family: monospace;
          font-size: 12px;
          background: rgba(0, 0, 0, 0.04);
          padding: 1px 4px;
          border-radius: 3px;
        }
        .expert-attestation-body :global(blockquote) {
          margin: 0 0 10px 0;
          padding: 6px 12px;
          border-left: 2px solid var(--border-color);
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}
