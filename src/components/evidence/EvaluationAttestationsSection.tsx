// Adversarial-evaluation attestations on the evidence detail page
// (civic-ai-tools#72 Phase 3; spec §8.12.4 verifier expectations).
//
// Server component — pure rendering over independently-verified views from
// `loadEvaluationViews`. Per the design principles (disclosure not validation):
// the section discloses what the evaluation found and under what methodology;
// it does not render a platform verdict about the analysis. Drill-down to
// per-criterion scores uses a native <details> disclosure.

import type { EvaluationAttestationView } from '@/lib/evidence/adversarial-eval';

const CRITERION_LABELS: Record<string, string> = {
  dataSourceIdentification: 'Data source identification',
  quantitativeClaimSupport: 'Quantitative claim support',
  confoundersAndBias: 'Confounders and bias',
  geographicScope: 'Geographic scope',
  limitationsNoted: 'Limitations noted',
  contradictoryConclusion: 'Contradictory conclusion',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function EvaluationAttestationsSection({
  views,
}: {
  views: EvaluationAttestationView[];
}) {
  if (views.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
        {views.length === 1
          ? 'An adversarial evaluation — a critical review by an independent model against a declared rubric — was run on this analysis.'
          : `${views.length} adversarial evaluations — critical reviews by independent models against a declared rubric — were run on this analysis.`}{' '}
        Each is a separately signed attestation; the scores below are the
        evaluator&rsquo;s assessment, not a platform verdict.
      </p>
      {views.map((v) => (
        <div
          key={v.nodeId}
          style={{
            padding: '12px 16px',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 14px',
              alignItems: 'baseline',
              fontSize: '14px',
            }}
          >
            {v.results && (
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {v.results.overallScore.toFixed(1)} / 10
              </span>
            )}
            {v.methodology?.evaluatorModel && (
              <span style={{ color: 'var(--text-secondary)' }}>
                evaluated by <code style={{ fontSize: '12px' }}>{v.methodology.evaluatorModel}</code>
              </span>
            )}
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {fmtDate(v.createdAt)}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {v.signatureValid === true
                ? 'signature verifies'
                : v.signatureValid === false
                  ? 'signature does not verify'
                  : 'unsigned'}
              {v.hasRekor ? ' · transparency-logged' : ''}
            </span>
          </div>
          {v.results?.assessment && (
            <p
              style={{
                margin: '8px 0 0',
                fontSize: '13px',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
              }}
            >
              {v.results.assessment}
            </p>
          )}
          {v.results && (
            <details style={{ marginTop: '8px' }}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontSize: '12px',
                  color: 'var(--nyc-blue)',
                  padding: '2px 0',
                }}
              >
                Per-criterion scores and methodology
              </summary>
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {Object.entries(v.results.perCriterion).map(([key, entry]) => (
                  <div key={key} style={{ fontSize: '12px', lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {CRITERION_LABELS[key] ?? key}: {entry.score}/10.
                    </span>{' '}
                    <span style={{ color: 'var(--text-secondary)' }}>{entry.comment}</span>
                  </div>
                ))}
                {v.methodology && (
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Methodology: {v.methodology.testSet} · rubric version{' '}
                    <code title={v.methodology.promptSetVersion}>
                      {v.methodology.promptSetVersion.slice(0, 12)}…
                    </code>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
