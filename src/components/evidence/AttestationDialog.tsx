'use client';

// The analysis page's add-review sheet (UX-2 P2): a P3 Sheet that opens on the
// review path (an expert review: rating, body, expertise), with the automated
// checks behind one disclosure, "Run an automated check instead" (X17). Its
// open state belongs to the page's review store (`RecordReviewsProvider`),
// which mounts this sheet once, so both "Add one" and "+ Add review" open it.

import { useState, useCallback, useEffect, useId } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Disclosure } from '@/components/ui/Disclosure';
import { Card } from '@/components/ui/Card';
import { parseModelsResponse, type Model } from '@/lib/model-list';
// The tool-call identity key, in ONE place. It used to be a private function
// here with a verbatim copy in `replay-loop.test.ts`, because no `.test.ts` in
// this tree can import a `.tsx` — so the shipped function had no test and the
// copy could only ever agree with itself. Both now import this module.
//
// `TOOL_CALL_KEY_POLICY` comes from the same module because it is a sentence
// ABOUT that key: how a call the source refused is counted (#402). It is
// rendered beside the score and submitted inside the signed package, from one
// string, so what a reader is told and what the package records cannot drift.
import { canonicalizeToolCall, TOOL_CALL_KEY_POLICY } from '@/lib/evidence/tool-call-identity';
// The score itself moved out for the reason the key did, and it is the same
// reason: no `.test.ts` here can import a `.tsx`, so the function that decides
// whether a run is signed `highly_reproducible` could not be driven where it
// stood. The arithmetic is unchanged; see the module header.
import {
  computeConsistencyMetrics,
  type ConsistencyMetrics,
  type ReplayResult,
} from '@/lib/evidence/consistency-metrics';
// A source's reader-facing name (the manifest's display name without its
// "MCP Server" suffix), for the line naming a source the replays ran without.
import { displayNameForSource } from '@/lib/evidence/data-sources';
// The replayer's own consent (R6 W3, #632 criterion 7): a replay sends the
// record's question to the model endpoint and calls live sources, so the
// replay route is gated (C6), and this dialog answers its refusal with the
// same consent card the query surfaces show.
import ConsentCard from '@/components/sources/ConsentCard';
import { useSourceConsent } from '@/components/sources/useSourceConsent';
// A consent in force with no source On (item 42): answered as home and
// `/explore` answer it, through the one component whose "Data source settings"
// is a client-side link to the Settings overlay.
import NoSourcesOnLine from '@/components/sources/NoSourcesOnLine';

/** A replay the route refused for want of consent: the card answers it, not an error line. */
class ConsentRequired extends Error {}

/** A replay the route refused `no_sources_on`: the refusal's line answers it, not an error line. */
class NoSourcesOn extends Error {}

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

interface AttestationDialogProps {
  slug: string;
  analysisModel: string;
  promptVisibility: string;
  /** Whether the sheet is open: the page's review store holds it. */
  open: boolean;
  /** Escape, the close control, a backdrop click, or a saved review (unless busy). */
  onClose: () => void;
  onAttestationCreated: () => void;
}

// The ruled words (contract v5, "Words: RULED"; R3 B's renames, M1).
const SHEET_TITLE = 'Add a review'; // X18
const PUBLISH_REVIEW = 'Publish review'; // X15
const EXPERTISE_LABEL = 'Expertise or affiliation (published)'; // X16
const AUTOMATED_LABEL = 'Run an automated check instead'; // X17
const EVALUATION_CHOICE = 'Evaluation: a second model reviews the answer against a fixed checklist.'; // X17
const CONSISTENCY_CHOICE = 'Consistency test: re-runs the analysis to see whether it can be reproduced.'; // X17
const SAVE_REVIEW = 'Save review'; // R3 B
const SAVE_FAILED = 'Failed to save review'; // R3 B

// --- Component ---

export default function AttestationDialog({
  slug,
  analysisModel,
  promptVisibility,
  open,
  onClose,
  onAttestationCreated,
}: AttestationDialogProps) {
  // The review path first (UX-2 P2): the automated checks are behind X17's
  // disclosure, and the key field renders only once it is chosen.
  const [path, setPath] = useState<'review' | 'automated'>('review');
  const [check, setCheck] = useState<'evaluation' | 'consistency'>('evaluation');
  const tab: 'consistency' | 'evaluation' | 'expert' = path === 'review' ? 'expert' : check;
  const checkName = useId();
  const [apiKey, setApiKey] = useState('');

  // Consistency test state
  const [numRuns, setNumRuns] = useState(5);
  const [consistencyStatus, setConsistencyStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [consistencyProgress, setConsistencyProgress] = useState('');
  const [completedRuns, setCompletedRuns] = useState<ReplayResult[]>([]);
  const [consistencyMetrics, setConsistencyMetrics] = useState<ConsistencyMetrics | null>(null);

  // Evaluation state
  const [evaluatorModel, setEvaluatorModel] = useState('');
  const [evaluatorModels, setEvaluatorModels] = useState<Model[]>([]);
  const [modelsUnavailable, setModelsUnavailable] = useState(false);
  const [evalStatus, setEvalStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [evalResult, setEvalResult] = useState<EvaluationResult | null>(null);
  const [evalError, setEvalError] = useState('');

  // Expert attestation state (free-text, human-submitted — no API key needed)
  const [expertBody, setExpertBody] = useState('');
  const [expertExpertise, setExpertExpertise] = useState('');
  const [expertRating, setExpertRating] = useState<ExpertRating | ''>('');
  const [expertError, setExpertError] = useState('');

  // Submit state. A failed save on a check path is the sheet's error line (it was an alert()).
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState('');

  // The replayer's consent (R6 W3): read when the dialog opens.
  const { guard: guardQuestion, refresh: refreshConsent } = useSourceConsent({ load: open });
  const [consentNeeded, setConsentNeeded] = useState(false);
  // No source On, from the guard or from the route's refusal: rendered from the code, never the route's text.
  const [noneOn, setNoneOn] = useState(false);

  const canReplay = promptVisibility === 'full_text';
  // `analysisModel` is a DECLARED identity read out of a signed package, while
  // these are catalog ids. Under the built-in catalog the two namespaces
  // coincide; under a catalog where they diverge this filter may fail to hide
  // the analysis model. That degrades safely — the evaluate route refuses a
  // same-model evaluation server-side, which is the check that actually
  // protects evaluator independence. Serving declared identities from
  // `/api/models` instead would change a response shape pinned by
  // `parseModelsResponse` (#283) and by a frozen-body test.
  const filteredModels = evaluatorModels.filter(m => m.id !== analysisModel);
  const requiresApiKey = path === 'automated';

  // The evaluator list comes from `/api/models` — the models THIS instance
  // offers, served from its catalog (website#30 P2). It used to be a hardcoded
  // array of five ids under a comment claiming it was fetched: false the day it
  // was written, and consequential once the catalog arrived, because on any
  // instance whose catalog is not the built-in one four of those five ids name
  // nothing, and the evaluate route resolves a caller's id tolerantly.
  //
  // Fetched when the dialog OPENS rather than on mount: this component renders
  // on every record detail page and most readers never open it. `/api/models`
  // answers 503 rather than an empty list when a catalog cannot be read, so a
  // failure here means "we cannot say what this instance offers" — reported as
  // an absence rather than rendered as an empty dropdown, which would look like
  // a finished answer.
  useEffect(() => {
    if (!open) return;
    let isMounted = true;
    (async () => {
      try {
        const res = await fetch('/api/models');
        const parsed = parseModelsResponse(await res.json());
        if (!isMounted) return;
        if (!res.ok || parsed === null) {
          console.error('[attestation] could not load the model list this instance offers');
          setModelsUnavailable(true);
          return;
        }
        setEvaluatorModels(parsed);
        setModelsUnavailable(false);
        // Drop a selection the instance no longer offers. Without this the
        // select falls back to showing its placeholder while the state still
        // holds the old id, and Run would send it.
        setEvaluatorModel((current) =>
          current !== '' && !parsed.some((m) => m.id === current) ? '' : current,
        );
      } catch (err) {
        console.error('[attestation] could not load the model list this instance offers', err);
        if (isMounted) setModelsUnavailable(true);
      }
    })();
    return () => { isMounted = false; };
  }, [open]);

  const busy = consistencyStatus === 'running' || evalStatus === 'running' || submitting;
  const canPublishReview = expertBody.trim().length > 0 && expertExpertise.trim().length > 0 && !!expertRating && !submitting;

  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  // --- Consistency Test ---

  const runReplays = useCallback(async () => {
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
          // The canonical field name (website#30 G0 D7). The prior-era
          // `openRouterApiKey` is still accepted by the route, indefinitely, so
          // an older client keeps working; this one sends the current name.
          body: JSON.stringify({ modelApiKey: apiKey }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          if (err.code === 'consent_required') throw new ConsentRequired();
          if (err.code === 'no_sources_on') throw new NoSourcesOn();
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
      if (err instanceof ConsentRequired) {
        // Nothing to report as a failure: the card asks, and Allow runs the test again.
        setConsistencyStatus('idle');
        setConsistencyProgress('');
        setCompletedRuns([]);
        setConsentNeeded(true);
        void refreshConsent();
        return;
      }
      if (err instanceof NoSourcesOn) {
        // Nothing to report as a failure: no source is On, and the line says where to turn one On.
        setConsistencyStatus('idle');
        setConsistencyProgress('');
        setCompletedRuns([]);
        setNoneOn(true);
        void refreshConsent();
        return;
      }
      setConsistencyStatus('error');
      setConsistencyProgress(err instanceof Error ? err.message : 'Consistency test failed');
    }
  }, [apiKey, numRuns, slug, refreshConsent]);

  // The guard (stage-A ruling (a)): with no consent in force the card asks
  // before any replay is sent.
  // With no source On the guard sends nothing and says so ('none-on'), and the
  // dialog shows the refusal's line, as home does.
  const runConsistencyTest = useCallback(() => {
    setNoneOn(false);
    void guardQuestion(() => { void runReplays(); }, () => setConsentNeeded(true)).then((result) => {
      if (result === 'none-on') setNoneOn(true);
    });
  }, [guardQuestion, runReplays]);

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
        // Canonical field name — see the replay call above.
        body: JSON.stringify({ modelApiKey: apiKey, evaluatorModel }),
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
    setSaveError('');
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
            // How this attestation counted a call the source refused (#402).
            // Inside the signed bytes, not only on the screen: the same two
            // runs score differently under the old rule and the new one, and a
            // reader comparing two attestations cannot tell which produced a
            // number unless the package says so.
            toolCallKeyPolicy: TOOL_CALL_KEY_POLICY,
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
        throw new Error(err.error || SAVE_FAILED);
      }

      if (tab === 'expert') {
        setExpertBody('');
        setExpertExpertise('');
        setExpertRating('');
      }
      onClose();
      onAttestationCreated();
    } catch (err) {
      if (tab === 'expert') {
        setExpertError(err instanceof Error ? err.message : SAVE_FAILED);
      } else {
        setSaveError(err instanceof Error ? err.message : SAVE_FAILED);
      }
    } finally {
      setSubmitting(false);
    }
  }, [tab, consistencyMetrics, completedRuns, evalResult, expertBody, expertExpertise, expertRating, slug, analysisModel, onClose, onAttestationCreated]);

  // --- Render ---

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title={SHEET_TITLE}
      busy={busy}
      primaryAction={path === 'review' ? { label: PUBLISH_REVIEW, onClick: submitAttestation, disabled: !canPublishReview } : undefined}
    >
      {path === 'review' && (
        <ExpertTab
          body={expertBody}
          setBody={setExpertBody}
          expertise={expertExpertise}
          setExpertise={setExpertExpertise}
          rating={expertRating}
          setRating={setExpertRating}
          error={expertError}
        />
      )}

      <Disclosure
        summary={AUTOMATED_LABEL}
        open={path === 'automated'}
        onToggle={(isOpen) => setPath(isOpen ? 'automated' : 'review')}
      >
        {path === 'automated' && (
          <>
            <div role="radiogroup" aria-label={AUTOMATED_LABEL} style={{ display: 'grid', gap: '8px', margin: '8px 0 16px' }}>
              {([['evaluation', EVALUATION_CHOICE], ['consistency', CONSISTENCY_CHOICE]] as const).map(([value, words]) => (
                <Card key={value} variant="selectable" compact selected={check === value} as="label">
                  <input
                    type="radio"
                    name={checkName}
                    value={value}
                    checked={check === value}
                    onChange={() => setCheck(value)}
                    style={{ marginRight: '8px' }}
                  />
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{words}</span>
                </Card>
              ))}
            </div>

            {requiresApiKey && (
              <>
                <div style={{
                  padding: '10px 14px', backgroundColor: 'var(--card-background)',
                  borderRadius: '4px', fontSize: '12px', color: 'var(--text-secondary)',
                  marginBottom: '16px', lineHeight: 1.5,
                }}>
                  Your API key is used for this request only and is never stored. It is sent to our server to make AI model calls on your behalf, then discarded.
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label htmlFor="attestation-model-api-key" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>
                    Model API key
                  </label>
                  <p id="attestation-model-api-key-hint" style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    The key for the AI model endpoint this site is configured to use. Which service that is depends on how this instance is set up.
                  </p>
                  <input
                    id="attestation-model-api-key"
                    aria-describedby="attestation-model-api-key-hint"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste your key"
                    style={{
                      width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)',
                      borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </>
            )}

            {tab === 'evaluation' && (
              <EvaluationTab
                apiKey={apiKey}
                evaluatorModel={evaluatorModel}
                setEvaluatorModel={setEvaluatorModel}
                filteredModels={filteredModels}
                modelsUnavailable={modelsUnavailable}
                status={evalStatus}
                result={evalResult}
                error={evalError}
                onRun={runEvaluation}
                onSubmit={submitAttestation}
                submitting={submitting}
              />
            )}

            {tab === 'consistency' && canReplay && consentNeeded && (
              <div style={{ marginBottom: '16px' }}>
                <ConsentCard
                  onAllow={() => {
                    setConsentNeeded(false);
                    runConsistencyTest();
                  }}
                  onNotNow={() => setConsentNeeded(false)}
                />
              </div>
            )}

            {tab === 'consistency' && canReplay && noneOn && !consentNeeded && (
              <p role="status" style={{ margin: '0 0 16px', fontSize: '13px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                <NoSourcesOnLine />
              </p>
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
                  Consistency testing requires full prompt text. This analysis was published with hash-only visibility.
                </div>
              )
            )}

            {saveError && <ErrorLine text={saveError} />}
          </>
        )}
      </Disclosure>
    </Sheet>
  );
}

// --- Sub-components ---

function EvaluationTab({ apiKey, evaluatorModel, setEvaluatorModel, filteredModels, modelsUnavailable, status, result, error, onRun, onSubmit, submitting }: {
  apiKey: string;
  evaluatorModel: string;
  setEvaluatorModel: (m: string) => void;
  filteredModels: { id: string; name: string }[];
  modelsUnavailable: boolean;
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
          disabled={modelsUnavailable}
          style={{
            width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)',
            borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box', backgroundColor: 'white',
          }}
        >
          <option value="">{modelsUnavailable ? 'Model list unavailable' : 'Select a model...'}</option>
          {filteredModels.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {modelsUnavailable && (
          /* Disclosure, not validation (design-principles P3 and the state-signal
             corollary): the reader chose nothing wrong, so the control is not
             marked invalid. It says what is missing and stops offering a choice
             it cannot describe, rather than presenting an empty list as an
             answer. */
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            This site could not load the list of AI models it offers, so an evaluation can’t be started right now.
          </p>
        )}
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
            {submitting ? 'Saving...' : SAVE_REVIEW}
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
  // Sources the record was offered that this instance does not have (#632 D8
  // = A): the replays ran without them, which the score above cannot show.
  // Displayed only; no signed run carries it.
  const lacking = [...new Set(completedRuns.flatMap((r) => r.offeredSet?.lacking ?? []))].map((id) => displayNameForSource(id));
  // Sources the record shows loaded but does not list among those offered,
  // which its stated set leaves out (#644 W2 [B]): the replays ran without
  // them too, and `lacking`'s "This site does not offer it" would be false.
  // Displayed only; no signed run carries it.
  const loadedUnstated = [...new Set(completedRuns.flatMap((r) => (r.offeredSet as { loadedUnstated?: string[] } | undefined)?.loadedUnstated ?? []))]
    .filter((id) => !completedRuns.some((r) => r.offeredSet?.lacking.includes(id)))
    .map((id) => displayNameForSource(id));
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

          {/* How a refused request was counted (#402). Beside the score, not
              in a footnote: the number above is a claim about reproducibility
              and this is the rule that produced it. Disclosure, not
              validation — docs/design-principles.md Principle 1. */}
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
            {TOOL_CALL_KEY_POLICY}
          </p>

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
          {lacking.length > 0 && (
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
              {`The original analysis could use ${lacking.length === 1 ? lacking[0] : `${lacking.slice(0, -1).join(', ')} and ${lacking[lacking.length - 1]}`}. This site does not offer ${lacking.length === 1 ? 'it' : 'them'}, so these replays ran without ${lacking.length === 1 ? 'it' : 'them'}.`}
            </p>
          )}
          {loadedUnstated.length > 0 && (
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
              {`The analysis shows ${loadedUnstated.length === 1 ? loadedUnstated[0] : `${loadedUnstated.slice(0, -1).join(', ')} and ${loadedUnstated[loadedUnstated.length - 1]}`} loaded but does not list ${loadedUnstated.length === 1 ? 'it' : 'them'} among the sources offered, so these replays ran without ${loadedUnstated.length === 1 ? 'it' : 'them'}.`}
            </p>
          )}

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
            {submitting ? 'Saving...' : SAVE_REVIEW}
          </button>
        </div>
      )}
    </>
  );
}

// The rating cards' own words and hints (UX-2 P2, contract v5): the choice's
// words, not the display labels, which the rows and the summary read from
// `EXPERT_RATING_LABELS`.
const EXPERT_RATING_OPTIONS: { value: ExpertRating; label: string; hint: string }[] = [
  { value: 'endorse', label: 'Endorse', hint: 'The analysis is sound given the available data.' },
  { value: 'concerns', label: 'Concerns', hint: 'Partially supported — see notes for caveats or missing context.' },
  { value: 'dispute', label: 'Dispute', hint: 'The conclusion is not supported by the data or method.' },
  { value: 'neutral', label: 'Neutral', hint: 'Observation or methodology note without endorsement or dispute.' },
];

/** The sheet's error line: what a failed save says, where the action was taken (it was an alert()). */
function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" style={{ margin: '12px 0 0', fontSize: '13px', color: 'var(--error)', lineHeight: 1.5 }}>
      {text}
    </p>
  );
}

// A field's label row: the label, and its character count at the right (in the
// row, not under the field, so the review path fits a phone's bottom sheet: P2's
// layout instrument, criterion 10).
const FIELD_HEAD = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' } as const;
const FIELD_LABEL = { fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' } as const;

/** The review path: the lead, the body, the expertise, and the rating as P5 selectable cards. Its action is the sheet's footer. */
function ExpertTab({
  body, setBody, expertise, setExpertise, rating, setRating, error,
}: {
  body: string;
  setBody: (v: string) => void;
  expertise: string;
  setExpertise: (v: string) => void;
  rating: ExpertRating | '';
  setRating: (r: ExpertRating) => void;
  error: string;
}) {
  const ids = useId();
  const bodyId = `${ids}-body`;
  const expertiseId = `${ids}-expertise`;
  const ratingName = `${ids}-rating`;
  const bodyCharCount = body.length;
  const expertiseCharCount = expertise.length;
  return (
    <>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
        A review from a domain expert, published as part of this analysis. Your GitHub identity,
        self-described expertise, and the review text are all published publicly. Each review
        shows its own signing status once submitted.
      </p>

      {/* Rating */}
      <fieldset style={{ border: 'none', margin: '0 0 12px', padding: 0 }}>
        <legend style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)', padding: 0 }}>
          Rating
        </legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {EXPERT_RATING_OPTIONS.map((opt) => (
            <Card key={opt.value} variant="selectable" compact selected={rating === opt.value} as="label">
              <span style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <input
                  type="radio"
                  name={ratingName}
                  value={opt.value}
                  checked={rating === opt.value}
                  onChange={() => setRating(opt.value)}
                  style={{ marginTop: '2px' }}
                />
                <span>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '2px' }}>
                    {opt.label}
                  </span>
                  <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {opt.hint}
                  </span>
                </span>
              </span>
            </Card>
          ))}
        </div>
      </fieldset>

      {/* Body */}
      <div style={{ marginBottom: '12px' }}>
        <div style={FIELD_HEAD}>
          <label htmlFor={bodyId} style={FIELD_LABEL}>
            Review
          </label>
          <span style={{ fontSize: '11px', color: bodyCharCount > EXPERT_BODY_MAX_CHARS ? 'var(--error)' : 'var(--text-muted)' }}>
            {bodyCharCount.toLocaleString()} / {EXPERT_BODY_MAX_CHARS.toLocaleString()}
          </span>
        </div>
        <textarea
          id={bodyId}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Your assessment, context, or correction. Markdown supported."
          rows={3}
          style={{
            width: '100%', padding: '10px 12px', border: '1px solid var(--border-color)',
            borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box',
            fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical',
          }}
        />
      </div>

      {/* Expertise */}
      <div style={{ marginBottom: '12px' }}>
        <div style={FIELD_HEAD}>
          <label htmlFor={expertiseId} style={FIELD_LABEL}>
            {EXPERTISE_LABEL}
          </label>
          <span style={{ fontSize: '11px', color: expertiseCharCount > EXPERT_EXPERTISE_MAX_CHARS ? 'var(--error)' : 'var(--text-muted)' }}>
            {expertiseCharCount} / {EXPERT_EXPERTISE_MAX_CHARS}
          </span>
        </div>
        <input
          id={expertiseId}
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
      </div>

      {error && <ErrorLine text={error} />}
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
