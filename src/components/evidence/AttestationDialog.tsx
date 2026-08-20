'use client';

import { useState, useCallback } from 'react';

// --- Types ---

const EXPERT_RATINGS = ['endorse', 'concerns', 'dispute', 'neutral'] as const;
type ExpertRating = (typeof EXPERT_RATINGS)[number];

const EXPERT_BODY_MAX_CHARS = 10_000;
const EXPERT_EXPERTISE_MAX_CHARS = 300;

interface RubricCriterion {
  score: number;
  comment: string;
}

interface EvaluationResult {
  rubric: {
    dataSourceIdentification: RubricCriterion;
    quantitativeClaimSupport: RubricCriterion;
    confoundersAndBias: RubricCriterion;
    geographicScope: RubricCriterion;
    limitationsNoted: RubricCriterion;
    contradictoryConclusion: RubricCriterion;
  };
  overallScore: number;
  assessment: string;
  evaluatorModel: string;
}

interface ReplayResult {
  toolCalls: { name: string; args: Record<string, unknown> }[];
  output: string;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  durationMs: number;
}

interface ConsistencyMetrics {
  toolCallOverlap: number;
  outputSimilarity: number;
  consistencyClassification: 'highly_reproducible' | 'moderately_stable' | 'inconsistent';
}

interface AttestationDialogProps {
  slug: string;
  analysisModel: string;
  promptVisibility: string;
  onAttestationCreated: () => void;
}

// --- Metric computation ---

function canonicalizeToolCall(tc: { name: string; args: Record<string, unknown> }): string {
  const key = [
    tc.name,
    tc.args.type as string || '',
    tc.args.dataset_id as string || '',
    tc.args.portal as string || '',
  ].join(':');
  return key;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/\b\d[\d,]*\.?\d*\b/g) || [];
  return matches
    .map(m => parseFloat(m.replace(/,/g, '')))
    .filter(n => !isNaN(n) && n > 0);
}

function computeConsistencyMetrics(runs: ReplayResult[]): ConsistencyMetrics {
  if (runs.length < 2) {
    return { toolCallOverlap: 1, outputSimilarity: 1, consistencyClassification: 'highly_reproducible' };
  }

  // Tool call overlap: average pairwise Jaccard similarity
  const toolCallSets = runs.map(r =>
    new Set(r.toolCalls.map(canonicalizeToolCall))
  );
  let totalJaccard = 0;
  let pairCount = 0;
  for (let i = 0; i < toolCallSets.length; i++) {
    for (let j = i + 1; j < toolCallSets.length; j++) {
      totalJaccard += jaccardSimilarity(toolCallSets[i], toolCallSets[j]);
      pairCount++;
    }
  }
  const toolCallOverlap = pairCount > 0 ? totalJaccard / pairCount : 1;

  // Output similarity: compare numeric claims across runs
  const numberSets = runs.map(r => extractNumbers(r.output));
  const referenceSet = new Set(numberSets[0].map(n => n.toString()));
  let totalMatch = 0;
  for (let i = 1; i < numberSets.length; i++) {
    if (referenceSet.size === 0) {
      totalMatch += 1; // No numbers to compare — treat as matching
    } else {
      const matches = numberSets[i].filter(n => referenceSet.has(n.toString()));
      totalMatch += matches.length / referenceSet.size;
    }
  }
  const outputSimilarity = runs.length > 1 ? totalMatch / (runs.length - 1) : 1;

  // Combined score for classification
  const combined = (toolCallOverlap + Math.min(outputSimilarity, 1)) / 2;
  let consistencyClassification: ConsistencyMetrics['consistencyClassification'];
  if (combined >= 0.9) consistencyClassification = 'highly_reproducible';
  else if (combined >= 0.7) consistencyClassification = 'moderately_stable';
  else consistencyClassification = 'inconsistent';

  return {
    toolCallOverlap: Math.round(toolCallOverlap * 100) / 100,
    outputSimilarity: Math.round(Math.min(outputSimilarity, 1) * 100) / 100,
    consistencyClassification,
  };
}

// --- Available evaluator models (fetched from /api/models, filtered) ---
const EVALUATOR_MODELS = [
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-5.4', name: 'GPT-5.4' },
  { id: 'google/gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
];

// --- Component ---

export default function AttestationDialog({
  slug,
  analysisModel,
  promptVisibility,
  onAttestationCreated,
}: AttestationDialogProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'consistency' | 'evaluation' | 'expert'>('evaluation');
  const [apiKey, setApiKey] = useState('');

  // Consistency test state
  const [numRuns, setNumRuns] = useState(5);
  const [consistencyStatus, setConsistencyStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [consistencyProgress, setConsistencyProgress] = useState('');
  const [completedRuns, setCompletedRuns] = useState<ReplayResult[]>([]);
  const [consistencyMetrics, setConsistencyMetrics] = useState<ConsistencyMetrics | null>(null);

  // Evaluation state
  const [evaluatorModel, setEvaluatorModel] = useState('');
  const [evalStatus, setEvalStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [evalResult, setEvalResult] = useState<EvaluationResult | null>(null);
  const [evalError, setEvalError] = useState('');

  // Expert attestation state (free-text, human-submitted — no API key needed)
  const [expertBody, setExpertBody] = useState('');
  const [expertExpertise, setExpertExpertise] = useState('');
  const [expertRating, setExpertRating] = useState<ExpertRating | ''>('');
  const [expertError, setExpertError] = useState('');

  // Submit state
  const [submitting, setSubmitting] = useState(false);

  const canReplay = promptVisibility === 'full_text';
  const filteredModels = EVALUATOR_MODELS.filter(m => m.id !== analysisModel);
  const requiresApiKey = tab === 'consistency' || tab === 'evaluation';

  const handleClose = () => {
    if (consistencyStatus === 'running' || evalStatus === 'running' || submitting) return;
    setOpen(false);
  };

  // --- Consistency Test ---

  const runConsistencyTest = useCallback(async () => {
    if (!apiKey) return;
    setConsistencyStatus('running');
    setCompletedRuns([]);
    setConsistencyMetrics(null);
    setConsistencyProgress(`Starting run 1 of ${numRuns}...`);

    const runs: ReplayResult[] = [];
    try {
      for (let i = 0; i < numRuns; i++) {
        setConsistencyProgress(`Running replay ${i + 1} of ${numRuns}...`);
        const res = await fetch(`/api/records/${slug}/replay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ openRouterApiKey: apiKey }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || `Replay ${i + 1} failed`);
        }
        const result: ReplayResult = await res.json();
        runs.push(result);
        setCompletedRuns([...runs]);
        setConsistencyProgress(`Completed ${i + 1} of ${numRuns} runs`);
      }

      const metrics = computeConsistencyMetrics(runs);
      setConsistencyMetrics(metrics);
      setConsistencyStatus('done');
      setConsistencyProgress('All runs complete');
    } catch (err) {
      setConsistencyStatus('error');
      setConsistencyProgress(err instanceof Error ? err.message : 'Consistency test failed');
    }
  }, [apiKey, numRuns, slug]);

  // --- Adversarial Evaluation ---

  const runEvaluation = useCallback(async () => {
    if (!apiKey || !evaluatorModel) return;
    setEvalStatus('running');
    setEvalResult(null);
    setEvalError('');

    try {
      const res = await fetch(`/api/records/${slug}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openRouterApiKey: apiKey, evaluatorModel }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || 'Evaluation failed');
      }
      const result: EvaluationResult = await res.json();
      setEvalResult(result);
      setEvalStatus('done');
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : 'Evaluation failed');
      setEvalStatus('error');
    }
  }, [apiKey, evaluatorModel, slug]);

  // --- Submit attestation ---

  const submitAttestation = useCallback(async () => {
    setSubmitting(true);
    try {
      let attestationData;
      if (tab === 'consistency' && consistencyMetrics && completedRuns.length > 0) {
        attestationData = {
          type: 'consistency',
          data: {
            config: { numRuns: completedRuns.length, model: analysisModel },
            runs: completedRuns.map((r, i) => ({
              runIndex: i,
              toolCallCount: r.toolCalls.length,
              toolCallKeys: r.toolCalls.map(canonicalizeToolCall),
              outputExcerpt: r.output.slice(0, 500),
              tokenUsage: r.tokenUsage,
              durationMs: r.durationMs,
            })),
            metrics: consistencyMetrics,
          },
        };
      } else if (tab === 'evaluation' && evalResult) {
        attestationData = {
          type: 'evaluation',
          data: {
            evaluatorModel: evalResult.evaluatorModel,
            rubric: evalResult.rubric,
            overallScore: evalResult.overallScore,
            assessment: evalResult.assessment,
          },
        };
      } else if (tab === 'expert') {
        const trimmedBody = expertBody.trim();
        const trimmedExpertise = expertExpertise.trim();
        if (!trimmedBody) {
          setExpertError('Review body is required.');
          return;
        }
        if (trimmedBody.length > EXPERT_BODY_MAX_CHARS) {
          setExpertError(`Review body exceeds ${EXPERT_BODY_MAX_CHARS} characters.`);
          return;
        }
        if (!trimmedExpertise) {
          setExpertError('Expertise / affiliation is required.');
          return;
        }
        if (trimmedExpertise.length > EXPERT_EXPERTISE_MAX_CHARS) {
          setExpertError(`Expertise exceeds ${EXPERT_EXPERTISE_MAX_CHARS} characters.`);
          return;
        }
        if (!expertRating) {
          setExpertError('Select a rating.');
          return;
        }
        setExpertError('');
        attestationData = {
          type: 'expert_attestation',
          data: {
            body: trimmedBody,
            expertise: trimmedExpertise,
            rating: expertRating,
          },
        };
      } else {
        return;
      }

      const res = await fetch(`/api/records/${slug}/attestations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attestationData),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Submit failed' }));
        throw new Error(err.error || 'Failed to save attestation');
      }

      setOpen(false);
      onAttestationCreated();
    } catch (err) {
      if (tab === 'expert') {
        setExpertError(err instanceof Error ? err.message : 'Failed to save attestation');
      } else {
        alert(err instanceof Error ? err.message : 'Failed to save attestation');
      }
    } finally {
      setSubmitting(false);
    }
  }, [tab, consistencyMetrics, completedRuns, evalResult, expertBody, expertExpertise, expertRating, slug, analysisModel, onAttestationCreated]);

  // --- Render ---

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '6px 14px',
          border: '1px solid var(--accent)',
          borderRadius: '4px',
          fontSize: '13px',
          color: 'var(--accent)',
          backgroundColor: 'white',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        + Add attestation
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div style={{
        backgroundColor: 'white', borderRadius: '8px', width: '100%', maxWidth: '600px',
        maxHeight: '85vh', overflow: 'auto', margin: '16px', padding: '24px',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Add Attestation</h3>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}>&times;</button>
        </div>

        {/* API Key notice + input — only machine attestations need an LLM call */}
        {requiresApiKey && (
          <>
            <div style={{
              padding: '10px 14px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
              borderRadius: '4px', fontSize: '12px', color: 'var(--text-secondary)',
              marginBottom: '16px', lineHeight: 1.5,
            }}>
              Your API key is used for this request only and is never stored. It is sent to our server to make LLM calls on your behalf, then discarded.
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>
                OpenRouter API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-..."
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)',
                  borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box',
                }}
              />
            </div>
          </>
        )}

        {/* Tab selector */}
        <div style={{ display: 'flex', gap: '0', marginBottom: '20px', borderBottom: '1px solid var(--border-color)' }}>
          <TabButton active={tab === 'evaluation'} onClick={() => setTab('evaluation')}>
            Adversarial Evaluation
          </TabButton>
          <TabButton active={tab === 'consistency'} onClick={() => setTab('consistency')} disabled={!canReplay}>
            Consistency Test
          </TabButton>
          <TabButton active={tab === 'expert'} onClick={() => setTab('expert')}>
            Expert Attestation
          </TabButton>
        </div>

        {/* Tab content */}
        {tab === 'evaluation' && (
          <EvaluationTab
            apiKey={apiKey}
            evaluatorModel={evaluatorModel}
            setEvaluatorModel={setEvaluatorModel}
            filteredModels={filteredModels}
            status={evalStatus}
            result={evalResult}
            error={evalError}
            onRun={runEvaluation}
            onSubmit={submitAttestation}
            submitting={submitting}
          />
        )}

        {tab === 'consistency' && (
          canReplay ? (
            <ConsistencyTab
              apiKey={apiKey}
              numRuns={numRuns}
              setNumRuns={setNumRuns}
              status={consistencyStatus}
              progress={consistencyProgress}
              completedRuns={completedRuns}
              metrics={consistencyMetrics}
              onRun={runConsistencyTest}
              onSubmit={submitAttestation}
              submitting={submitting}
            />
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '12px 0' }}>
              Consistency testing requires full prompt text. This record was published with hash-only visibility.
            </div>
          )
        )}

        {tab === 'expert' && (
          <ExpertTab
            body={expertBody}
            setBody={setExpertBody}
            expertise={expertExpertise}
            setExpertise={setExpertExpertise}
            rating={expertRating}
            setRating={setExpertRating}
            error={expertError}
            onSubmit={submitAttestation}
            submitting={submitting}
          />
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function TabButton({ active, onClick, disabled, children }: {
  active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 16px', border: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        background: 'none', fontSize: '13px', fontWeight: active ? 600 : 400,
        color: disabled ? 'var(--text-muted)' : active ? 'var(--accent)' : 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function EvaluationTab({ apiKey, evaluatorModel, setEvaluatorModel, filteredModels, status, result, error, onRun, onSubmit, submitting }: {
  apiKey: string;
  evaluatorModel: string;
  setEvaluatorModel: (m: string) => void;
  filteredModels: { id: string; name: string }[];
  status: string;
  result: EvaluationResult | null;
  error: string;
  onRun: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
        An independent LLM evaluates this analysis against a 6-criterion rubric covering data accuracy,
        bias detection, and methodological rigor.
      </p>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>
          Evaluator Model
        </label>
        <select
          value={evaluatorModel}
          onChange={(e) => setEvaluatorModel(e.target.value)}
          style={{
            width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)',
            borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box', backgroundColor: 'white',
          }}
        >
          <option value="">Select a model...</option>
          {filteredModels.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      <button
        onClick={onRun}
        disabled={!apiKey || !evaluatorModel || status === 'running'}
        style={{
          padding: '8px 20px', border: 'none', borderRadius: '4px',
          fontSize: '13px', fontWeight: 600, cursor: !apiKey || !evaluatorModel || status === 'running' ? 'not-allowed' : 'pointer',
          backgroundColor: !apiKey || !evaluatorModel ? '#e0e0e0' : 'var(--accent)',
          color: !apiKey || !evaluatorModel ? 'var(--text-muted)' : 'white',
          opacity: status === 'running' ? 0.7 : 1,
        }}
      >
        {status === 'running' ? 'Evaluating...' : 'Run Evaluation'}
      </button>

      {error && (
        <div style={{ marginTop: '12px', padding: '10px', fontSize: '13px', color: 'var(--error)', backgroundColor: 'rgba(236, 19, 30, 0.06)', borderRadius: '4px' }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: '16px' }}>
          <RubricDisplay rubric={result.rubric} overallScore={result.overallScore} />
          <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <strong>Assessment:</strong> {result.assessment}
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
            Evaluated by: {result.evaluatorModel}
          </div>
          <button
            onClick={onSubmit}
            disabled={submitting}
            style={{
              marginTop: '16px', padding: '8px 20px', border: 'none', borderRadius: '4px',
              fontSize: '13px', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer',
              backgroundColor: 'var(--success)', color: 'white',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Saving...' : 'Save Attestation'}
          </button>
        </div>
      )}
    </>
  );
}

function ConsistencyTab({ apiKey, numRuns, setNumRuns, status, progress, completedRuns, metrics, onRun, onSubmit, submitting }: {
  apiKey: string;
  numRuns: number;
  setNumRuns: (n: number) => void;
  status: string;
  progress: string;
  completedRuns: ReplayResult[];
  metrics: ConsistencyMetrics | null;
  onRun: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
        Re-runs the exact same prompt and tools N times to measure how stable the results are.
        Each run uses your API key and may take 30-120 seconds.
      </p>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>
          Number of Runs
        </label>
        <select
          value={numRuns}
          onChange={(e) => setNumRuns(Number(e.target.value))}
          disabled={status === 'running'}
          style={{
            padding: '8px 12px', border: '1px solid var(--border-color)',
            borderRadius: '4px', fontSize: '14px', backgroundColor: 'white',
          }}
        >
          <option value={3}>3 runs</option>
          <option value={5}>5 runs (recommended)</option>
          <option value={10}>10 runs</option>
        </select>
      </div>

      <button
        onClick={onRun}
        disabled={!apiKey || status === 'running'}
        style={{
          padding: '8px 20px', border: 'none', borderRadius: '4px',
          fontSize: '13px', fontWeight: 600, cursor: !apiKey || status === 'running' ? 'not-allowed' : 'pointer',
          backgroundColor: !apiKey ? '#e0e0e0' : 'var(--accent)',
          color: !apiKey ? 'var(--text-muted)' : 'white',
          opacity: status === 'running' ? 0.7 : 1,
        }}
      >
        {status === 'running' ? 'Running...' : 'Run Consistency Test'}
      </button>

      {/* Progress */}
      {status !== 'idle' && (
        <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          {progress}
          {status === 'running' && completedRuns.length > 0 && (
            <div style={{
              marginTop: '8px', height: '4px', backgroundColor: '#e0e0e0',
              borderRadius: '2px', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', backgroundColor: 'var(--accent)',
                width: `${(completedRuns.length / numRuns) * 100}%`,
                transition: 'width 0.3s ease',
              }} />
            </div>
          )}
        </div>
      )}

      {status === 'error' && (
        <div style={{ marginTop: '12px', padding: '10px', fontSize: '13px', color: 'var(--error)', backgroundColor: 'rgba(236, 19, 30, 0.06)', borderRadius: '4px' }}>
          {progress}
        </div>
      )}

      {/* Results */}
      {metrics && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>Results ({completedRuns.length} runs)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <MetricCard
              label="Tool Call Overlap"
              value={`${Math.round(metrics.toolCallOverlap * 100)}%`}
              color={metrics.toolCallOverlap >= 0.9 ? 'var(--success)' : metrics.toolCallOverlap >= 0.7 ? 'var(--accent)' : 'var(--error)'}
            />
            <MetricCard
              label="Output Similarity"
              value={`${Math.round(metrics.outputSimilarity * 100)}%`}
              color={metrics.outputSimilarity >= 0.9 ? 'var(--success)' : metrics.outputSimilarity >= 0.7 ? 'var(--accent)' : 'var(--error)'}
            />
            <MetricCard
              label="Classification"
              value={metrics.consistencyClassification.replace(/_/g, ' ')}
              color={
                metrics.consistencyClassification === 'highly_reproducible' ? 'var(--success)'
                : metrics.consistencyClassification === 'moderately_stable' ? 'var(--accent)'
                : 'var(--error)'
              }
            />
          </div>

          {/* Per-run summary */}
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            {completedRuns.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: '12px', padding: '4px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <span>Run {i + 1}</span>
                <span>{r.toolCalls.length} tool calls</span>
                <span>{(r.durationMs / 1000).toFixed(1)}s</span>
                <span>{r.tokenUsage.totalTokens.toLocaleString()} tokens</span>
              </div>
            ))}
          </div>

          <button
            onClick={onSubmit}
            disabled={submitting}
            style={{
              padding: '8px 20px', border: 'none', borderRadius: '4px',
              fontSize: '13px', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer',
              backgroundColor: 'var(--success)', color: 'white',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Saving...' : 'Save Attestation'}
          </button>
        </div>
      )}
    </>
  );
}

const EXPERT_RATING_OPTIONS: { value: ExpertRating; label: string; hint: string; bg: string; color: string }[] = [
  {
    value: 'endorse',
    label: 'Endorse',
    hint: 'The analysis is sound given the available data.',
    bg: 'rgba(0, 183, 3, 0.08)',
    color: 'var(--success)',
  },
  {
    value: 'concerns',
    label: 'Concerns',
    hint: 'Partially supported — see notes for caveats or missing context.',
    bg: 'rgba(255, 183, 0, 0.10)',
    color: '#a07000',
  },
  {
    value: 'dispute',
    label: 'Dispute',
    hint: 'The conclusion is not supported by the data or method.',
    bg: 'rgba(236, 19, 30, 0.08)',
    color: 'var(--error)',
  },
  {
    value: 'neutral',
    label: 'Neutral',
    hint: 'Observation or methodology note without endorsement or dispute.',
    bg: 'rgba(0, 0, 0, 0.05)',
    color: 'var(--text-secondary)',
  },
];

function ExpertTab({
  body, setBody, expertise, setExpertise, rating, setRating, error, onSubmit, submitting,
}: {
  body: string;
  setBody: (v: string) => void;
  expertise: string;
  setExpertise: (v: string) => void;
  rating: ExpertRating | '';
  setRating: (r: ExpertRating) => void;
  error: string;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const bodyCharCount = body.length;
  const expertiseCharCount = expertise.length;
  const canSubmit = body.trim().length > 0 && expertise.trim().length > 0 && !!rating && !submitting;
  return (
    <>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
        A signed, timestamped review from a domain expert. Your GitHub identity, self-described expertise,
        and the review text are all published publicly and attached to this record.
      </p>

      {/* Body */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>
          Review
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Your assessment, context, or correction. Markdown supported."
          rows={8}
          style={{
            width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)',
            borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box',
            fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical',
          }}
        />
        <div style={{
          fontSize: '11px', color: bodyCharCount > EXPERT_BODY_MAX_CHARS ? 'var(--error)' : 'var(--text-muted)',
          textAlign: 'right', marginTop: '2px',
        }}>
          {bodyCharCount.toLocaleString()} / {EXPERT_BODY_MAX_CHARS.toLocaleString()}
        </div>
      </div>

      {/* Expertise */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>
          Your expertise or affiliation
        </label>
        <input
          type="text"
          value={expertise}
          onChange={(e) => setExpertise(e.target.value)}
          placeholder="e.g., Demographer, NYU Furman Center"
          maxLength={EXPERT_EXPERTISE_MAX_CHARS + 50}
          style={{
            width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)',
            borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box',
          }}
        />
        <div style={{
          fontSize: '11px', color: expertiseCharCount > EXPERT_EXPERTISE_MAX_CHARS ? 'var(--error)' : 'var(--text-muted)',
          textAlign: 'right', marginTop: '2px',
        }}>
          {expertiseCharCount} / {EXPERT_EXPERTISE_MAX_CHARS}
        </div>
      </div>

      {/* Rating */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
          Rating
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {EXPERT_RATING_OPTIONS.map((opt) => {
            const selected = rating === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRating(opt.value)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: `1.5px solid ${selected ? opt.color : 'var(--border-color)'}`,
                  borderRadius: '4px',
                  backgroundColor: selected ? opt.bg : 'white',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                <div style={{ fontWeight: 600, color: opt.color, marginBottom: '2px' }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  {opt.hint}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: '12px', padding: '10px', fontSize: '13px', color: 'var(--error)', backgroundColor: 'rgba(236, 19, 30, 0.06)', borderRadius: '4px' }}>
          {error}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        style={{
          padding: '8px 20px', border: 'none', borderRadius: '4px',
          fontSize: '13px', fontWeight: 600, cursor: canSubmit ? 'pointer' : 'not-allowed',
          backgroundColor: canSubmit ? 'var(--success)' : '#e0e0e0',
          color: canSubmit ? 'white' : 'var(--text-muted)',
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? 'Signing and publishing...' : 'Publish attestation'}
      </button>
    </>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      padding: '10px', border: '1px solid var(--border-color)', borderRadius: '4px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '16px', fontWeight: 700, color, textTransform: 'capitalize' }}>
        {value}
      </div>
    </div>
  );
}

function RubricDisplay({ rubric, overallScore }: { rubric: EvaluationResult['rubric']; overallScore: number }) {
  const criteria = [
    { key: 'dataSourceIdentification', label: 'Data Source Identification' },
    { key: 'quantitativeClaimSupport', label: 'Quantitative Claim Support' },
    { key: 'confoundersAndBias', label: 'Confounders & Bias' },
    { key: 'geographicScope', label: 'Geographic Scope' },
    { key: 'limitationsNoted', label: 'Limitations Noted' },
    { key: 'contradictoryConclusion', label: 'Contradictory Conclusion' },
  ] as const;

  const scoreColor = (s: number) =>
    s >= 8 ? 'var(--success)' : s >= 5 ? 'var(--accent)' : 'var(--error)';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontSize: '14px', fontWeight: 600 }}>Overall Score:</span>
        <span style={{ fontSize: '20px', fontWeight: 700, color: scoreColor(overallScore) }}>
          {overallScore.toFixed(1)}/10
        </span>
      </div>
      <div style={{ display: 'grid', gap: '8px' }}>
        {criteria.map(({ key, label }) => {
          const criterion = rubric[key];
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '8px 10px', backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: '4px',
            }}>
              <div style={{
                minWidth: '32px', textAlign: 'center', fontSize: '14px',
                fontWeight: 700, color: scoreColor(criterion.score),
              }}>
                {criterion.score}
              </div>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{criterion.comment}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
