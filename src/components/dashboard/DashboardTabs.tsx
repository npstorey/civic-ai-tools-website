'use client';

import { useState, useCallback, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { normalizeVisibility } from '@/lib/evidence/visibility';

// --- Types ---

interface EvidenceRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  model: string;
  verificationStatus: string;
  consistencyClassification: string | null;
  withdrawnAt: string | null;
  reinstatedAt: string | null;
  createdAt: string;
  attestationCount: number;
  /** Visibility mirror (civic-ai-tools#71), as the raw DB label — either
   *  vocabulary (ADR-0016 §A; normalized through `@/lib/evidence/visibility`).
   *  Sealed records are unlisted + creator-only until promoted via the publish
   *  flow. */
  visibility: string;
}

interface EvaluationRow {
  id: string;
  type: string;
  storageKey: string;
  createdAt: string;
  evidenceTitle: string;
  evidenceSlug: string;
}

interface ActivityRow {
  id: string;
  type: string;
  createdAt: string;
  evidenceTitle: string;
  evidenceSlug: string;
  creatorDisplayName: string;
  creatorGithubUrl: string;
}

interface TokenRow {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

interface DashboardTabsProps {
  myEvidence: EvidenceRow[];
  myEvaluations: EvaluationRow[];
  activity: ActivityRow[];
  tokens: TokenRow[];
  /** Whether this instance holds a signing key (ADR-0020, S3a P3): with no
   *  key the sealed→public promotion is gated off server-side, so the
   *  Publish affordance renders disabled-with-explanation instead of a dead
   *  button that errors. */
  signingConfigured?: boolean;
}

// --- Shared styles ---

const tabStyle = (isActive: boolean): CSSProperties => ({
  padding: '12px 24px',
  fontSize: '15px',
  fontWeight: isActive ? 600 : 400,
  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
  border: 'none',
  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
  marginBottom: '-2px',
  background: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
});

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    unverified: { bg: 'rgba(0,0,0,0.06)', text: 'var(--text-muted)' },
    consistency_tested: { bg: 'rgba(var(--accent-rgb), 0.1)', text: 'var(--accent)' },
    evaluated: { bg: 'rgba(0, 183, 3, 0.1)', text: 'var(--success)' },
    fully_attested: { bg: 'rgba(0, 183, 3, 0.15)', text: 'var(--success)' },
    withdrawn: { bg: 'rgba(236, 19, 30, 0.08)', text: 'var(--error)' },
    sealed: { bg: 'rgba(var(--accent-rgb), 0.08)', text: 'var(--accent)' },
  };
  const c = colors[status] || colors.unverified;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
      fontSize: '11px', fontWeight: 600, backgroundColor: c.bg, color: c.text,
      textTransform: 'capitalize',
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const isConsistency = type === 'consistency';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
      fontSize: '11px', fontWeight: 600,
      backgroundColor: isConsistency ? 'rgba(var(--accent-rgb), 0.1)' : 'rgba(0, 183, 3, 0.1)',
      color: isConsistency ? 'var(--accent)' : 'var(--success)',
      textTransform: 'capitalize',
    }}>
      {type}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function EmptyState({ message, cta }: { message: string; cta?: { text: string; href: string } }) {
  return (
    <div style={{
      padding: '32px', border: '1px solid var(--border-color)', borderRadius: '6px',
      textAlign: 'center', color: 'var(--text-muted)',
    }}>
      <p style={{ fontSize: '14px', margin: 0, lineHeight: 1.6 }}>{message}</p>
      {cta && (
        <Link href={cta.href} style={{ color: 'var(--accent)', fontSize: '14px', marginTop: '8px', display: 'inline-block' }}>
          {cta.text}
        </Link>
      )}
    </div>
  );
}

// --- Main component ---

export default function DashboardTabs({ myEvidence, myEvaluations, activity, tokens, signingConfigured = true }: DashboardTabsProps) {
  const [activeTab, setActiveTab] = useState<'evidence' | 'evaluations' | 'activity' | 'tokens'>('evidence');

  return (
    <>
      <div style={{ display: 'flex', borderBottom: '2px solid var(--border-color)', marginBottom: '24px' }}>
        <button onClick={() => setActiveTab('evidence')} style={tabStyle(activeTab === 'evidence')}>
          My Evidence ({myEvidence.length})
        </button>
        <button onClick={() => setActiveTab('evaluations')} style={tabStyle(activeTab === 'evaluations')}>
          My Evaluations ({myEvaluations.length})
        </button>
        <button onClick={() => setActiveTab('activity')} style={tabStyle(activeTab === 'activity')}>
          Activity ({activity.length})
        </button>
        <button onClick={() => setActiveTab('tokens')} style={tabStyle(activeTab === 'tokens')}>
          Tokens ({tokens.length})
        </button>
      </div>

      {activeTab === 'evidence' && <MyEvidenceTab rows={myEvidence} signingConfigured={signingConfigured} />}
      {activeTab === 'evaluations' && <MyEvaluationsTab rows={myEvaluations} />}
      {activeTab === 'activity' && <ActivityTab rows={activity} />}
      {activeTab === 'tokens' && <TokensTab rows={tokens} />}
    </>
  );
}

// --- Tab panels ---

function MyEvidenceTab({ rows, signingConfigured }: { rows: EvidenceRow[]; signingConfigured: boolean }) {
  const router = useRouter();
  const [withdrawTarget, setWithdrawTarget] = useState<EvidenceRow | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');

  const [reinstateTarget, setReinstateTarget] = useState<EvidenceRow | null>(null);
  const [reinstateReason, setReinstateReason] = useState('');
  const [reinstating, setReinstating] = useState(false);
  const [reinstateError, setReinstateError] = useState('');

  const handleWithdraw = useCallback(async () => {
    if (!withdrawTarget || !withdrawReason.trim()) return;
    setWithdrawing(true);
    setWithdrawError('');
    try {
      const res = await fetch(`/api/evidence/${withdrawTarget.slug}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: withdrawReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Withdrawal failed' }));
        throw new Error(err.error || 'Withdrawal failed');
      }
      setWithdrawTarget(null);
      setWithdrawReason('');
      router.refresh();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : 'Withdrawal failed');
    } finally {
      setWithdrawing(false);
    }
  }, [withdrawTarget, withdrawReason, router]);

  const handleReinstate = useCallback(async () => {
    if (!reinstateTarget || !reinstateReason.trim()) return;
    setReinstating(true);
    setReinstateError('');
    try {
      const res = await fetch(`/api/evidence/${reinstateTarget.slug}/reinstate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reinstateReason.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Reinstatement failed' }));
        throw new Error(err.error || 'Reinstatement failed');
      }
      setReinstateTarget(null);
      setReinstateReason('');
      router.refresh();
    } catch (err) {
      setReinstateError(err instanceof Error ? err.message : 'Reinstatement failed');
    } finally {
      setReinstating(false);
    }
  }, [reinstateTarget, reinstateReason, router]);

  // Sealed → public promotion (civic-ai-tools#71/#72 Phase 5). Runs the
  // default-on adversarial eval unless the user unchecks it; irreversible.
  const [publishTarget, setPublishTarget] = useState<EvidenceRow | null>(null);
  const [publishRunEval, setPublishRunEval] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  const handlePublish = useCallback(async () => {
    if (!publishTarget) return;
    setPublishing(true);
    setPublishError('');
    try {
      const res = await fetch(`/api/evidence/${publishTarget.slug}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runEvaluation: publishRunEval }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Publication failed' }));
        throw new Error(err.error || 'Publication failed');
      }
      setPublishTarget(null);
      router.refresh();
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Publication failed');
    } finally {
      setPublishing(false);
    }
  }, [publishTarget, publishRunEval, router]);

  if (rows.length === 0) {
    return (
      /* Topology-stale copy fixed in #229 P1. "The home page" is a
         marketing-surface noun: the dashboard is app-private, so on a
         split-host instance it renders on the app host, which HAS no home
         page — `/` there 307s to `/ask`. `/ask` is the signed-in query
         surface on every topology (it serves everywhere when none is
         configured), and everyone reading this empty state is signed in by
         definition, so the relative href is correct on all three shapes with
         no origin treatment needed. */
      <EmptyState
        message="You haven't published any evidence yet. Ask a question, then click 'Publish as Evidence' to get started."
        cta={{ text: 'Ask a question', href: '/ask' }}
      />
    );
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {rows.map((r) => {
          const isCurrentlyWithdrawn = !!r.withdrawnAt && !r.reinstatedAt;
          const isReinstated = !!r.withdrawnAt && !!r.reinstatedAt;
          return (
            <div
              key={r.id}
              style={{
                padding: '14px 18px',
                border: '1px solid var(--border-color)', borderRadius: '6px',
                opacity: isCurrentlyWithdrawn ? 0.65 : 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '6px' }}>
                <Link
                  href={`/evidence/${r.slug}`}
                  style={{
                    fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)',
                    textDecoration: isCurrentlyWithdrawn ? 'line-through' : 'none',
                  }}
                >
                  {r.title}
                </Link>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
                  {normalizeVisibility(r.visibility) === 'sealed' && <StatusBadge status="sealed" />}
                  {isCurrentlyWithdrawn
                    ? <StatusBadge status="withdrawn" />
                    : <StatusBadge status={r.verificationStatus} />
                  }
                </div>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span>{formatDate(r.createdAt)}</span>
                <span>{'\u00b7'}</span>
                <span>{r.model}</span>
                <span>{'\u00b7'}</span>
                <span>{r.attestationCount} attestation{r.attestationCount !== 1 ? 's' : ''}</span>
                {r.consistencyClassification && !isCurrentlyWithdrawn && (
                  <>
                    <span>{'\u00b7'}</span>
                    <span style={{ textTransform: 'capitalize' }}>
                      {r.consistencyClassification.replace(/_/g, ' ')}
                    </span>
                  </>
                )}
                {isCurrentlyWithdrawn && (
                  <>
                    <span>{'\u00b7'}</span>
                    <span style={{ color: 'var(--error)' }}>Withdrawn {formatDate(r.withdrawnAt!)}</span>
                    <span>{'\u00b7'}</span>
                    <button
                      onClick={() => { setReinstateTarget(r); setReinstateReason(''); setReinstateError(''); }}
                      style={{
                        background: 'none', border: 'none', padding: 0,
                        fontSize: '12px', color: 'var(--accent)', cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Reinstate
                    </button>
                  </>
                )}
                {isReinstated && (
                  <>
                    <span>{'\u00b7'}</span>
                    <span style={{ color: 'var(--success)' }}>Reinstated {formatDate(r.reinstatedAt!)}</span>
                  </>
                )}
                {normalizeVisibility(r.visibility) === 'sealed' && !isCurrentlyWithdrawn && (
                  <>
                    <span>{'\u00b7'}</span>
                    {signingConfigured ? (
                      <button
                        onClick={() => { setPublishTarget(r); setPublishRunEval(true); setPublishError(''); }}
                        style={{
                          background: 'none', border: 'none', padding: 0,
                          fontSize: '12px', color: 'var(--accent)', cursor: 'pointer',
                          textDecoration: 'underline', fontWeight: 600,
                        }}
                      >
                        Publish
                      </button>
                    ) : (
                      /* Unsigned-tier gate-off (ADR-0020, S3a P3): publishing
                         emits signed attestations this instance cannot back,
                         so the action is disabled with an explanation rather
                         than left as a dead button that errors. */
                      <button
                        disabled
                        title="Publishing is unavailable \u2014 this instance is running unsigned (signing is not configured). Signing is the go-to-production step and takes both EVIDENCE_SIGNING_KEY and EVIDENCE_KEY_ID; see docs/instance-setup.md."
                        style={{
                          background: 'none', border: 'none', padding: 0,
                          fontSize: '12px', color: 'var(--text-muted)',
                          cursor: 'not-allowed', fontWeight: 600,
                        }}
                      >
                        Publish unavailable (unsigned)
                      </button>
                    )}
                  </>
                )}
                {!isCurrentlyWithdrawn && !isReinstated && (
                  <>
                    <span>{'\u00b7'}</span>
                    <button
                      onClick={() => { setWithdrawTarget(r); setWithdrawReason(''); setWithdrawError(''); }}
                      style={{
                        background: 'none', border: 'none', padding: 0,
                        fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Withdraw
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Publish (sealed → public) confirmation dialog */}
      {publishTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !publishing) { setPublishTarget(null); } }}
        >
          <div style={{
            backgroundColor: 'white', borderRadius: '8px', width: '100%', maxWidth: '480px',
            margin: '16px', padding: '24px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Publish Evidence</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 12px' }}>
              Publishing makes the content of <strong>{publishTarget.title}</strong> publicly
              accessible, lists it in the registry, and emits signed publication
              attestations. Publication is <strong>not reversible</strong> — a later
              withdrawal flags the record but does not erase it.
            </p>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', cursor: 'pointer', marginBottom: '12px' }}>
              <input
                type="checkbox"
                checked={publishRunEval}
                onChange={(e) => setPublishRunEval(e.target.checked)}
                disabled={publishing}
                style={{ marginTop: '2px' }}
              />
              <span>
                Run an adversarial evaluation before publishing
                <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)' }}>
                  An independent model critiques the analysis against a declared
                  rubric; the signed result is attached to the record (adds ~30s).
                </span>
              </span>
            </label>
            {publishError && (
              <div style={{
                padding: '8px 12px', marginBottom: '12px', borderRadius: '4px',
                backgroundColor: 'rgba(236, 19, 30, 0.08)', color: 'var(--error)', fontSize: '13px',
              }}>
                {publishError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPublishTarget(null)}
                disabled={publishing}
                style={{
                  padding: '8px 16px', border: '1px solid var(--border-color)', borderRadius: '4px',
                  fontSize: '13px', cursor: publishing ? 'not-allowed' : 'pointer', backgroundColor: 'white',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing}
                style={{
                  padding: '8px 16px', border: 'none', borderRadius: '4px',
                  fontSize: '13px', fontWeight: 600,
                  cursor: publishing ? 'wait' : 'pointer',
                  backgroundColor: 'var(--accent)', color: 'white',
                  opacity: publishing ? 0.7 : 1,
                }}
              >
                {publishing ? (publishRunEval ? 'Evaluating & publishing…' : 'Publishing…') : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Withdrawal confirmation dialog */}
      {withdrawTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !withdrawing) { setWithdrawTarget(null); } }}
        >
          <div style={{
            backgroundColor: 'white', borderRadius: '8px', width: '100%', maxWidth: '480px',
            margin: '16px', padding: '24px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Withdraw Evidence</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
              Withdrawing evidence is a public, permanent action. The record and its cryptographic
              proofs remain accessible, but the evidence will be flagged as withdrawn.
            </p>
            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: 'var(--text-primary)' }}>
              &ldquo;{withdrawTarget.title}&rdquo;
            </div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', marginTop: '12px', color: 'var(--text-primary)' }}>
              Reason for withdrawal *
            </label>
            <textarea
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
              placeholder="e.g., Data source was updated, methodology was flawed, superseded by newer analysis..."
              rows={3}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)',
                borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box',
                resize: 'vertical', fontFamily: 'inherit',
              }}
            />
            {withdrawError && (
              <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--error)' }}>
                {withdrawError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                onClick={() => setWithdrawTarget(null)}
                disabled={withdrawing}
                style={{
                  padding: '8px 16px', border: '1px solid var(--border-color)', borderRadius: '4px',
                  fontSize: '13px', cursor: 'pointer', backgroundColor: 'white',
                  color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleWithdraw}
                disabled={!withdrawReason.trim() || withdrawing}
                style={{
                  padding: '8px 16px', border: 'none', borderRadius: '4px',
                  fontSize: '13px', fontWeight: 600, cursor: !withdrawReason.trim() || withdrawing ? 'not-allowed' : 'pointer',
                  backgroundColor: 'var(--error)', color: 'white',
                  opacity: !withdrawReason.trim() || withdrawing ? 0.6 : 1,
                }}
              >
                {withdrawing ? 'Withdrawing...' : 'Withdraw'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reinstatement confirmation dialog */}
      {reinstateTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !reinstating) { setReinstateTarget(null); } }}
        >
          <div style={{
            backgroundColor: 'white', borderRadius: '8px', width: '100%', maxWidth: '480px',
            margin: '16px', padding: '24px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Reinstate Evidence</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
              Reinstating will make this evidence visible again in the public index. The prior
              withdrawal record is preserved — both the withdrawal and reinstatement will appear
              in the status history for transparency.
            </p>
            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: 'var(--text-primary)' }}>
              &ldquo;{reinstateTarget.title}&rdquo;
            </div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', marginTop: '12px', color: 'var(--text-primary)' }}>
              Reason for reinstatement *
            </label>
            <textarea
              value={reinstateReason}
              onChange={(e) => setReinstateReason(e.target.value)}
              placeholder="e.g., Original concern resolved, data was re-verified, withdrawal was premature..."
              rows={3}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)',
                borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box',
                resize: 'vertical', fontFamily: 'inherit',
              }}
            />
            {reinstateError && (
              <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--error)' }}>
                {reinstateError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                onClick={() => setReinstateTarget(null)}
                disabled={reinstating}
                style={{
                  padding: '8px 16px', border: '1px solid var(--border-color)', borderRadius: '4px',
                  fontSize: '13px', cursor: 'pointer', backgroundColor: 'white',
                  color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleReinstate}
                disabled={!reinstateReason.trim() || reinstating}
                style={{
                  padding: '8px 16px', border: 'none', borderRadius: '4px',
                  fontSize: '13px', fontWeight: 600,
                  cursor: !reinstateReason.trim() || reinstating ? 'not-allowed' : 'pointer',
                  backgroundColor: 'var(--success)', color: 'white',
                  opacity: !reinstateReason.trim() || reinstating ? 0.6 : 1,
                }}
              >
                {reinstating ? 'Reinstating...' : 'Reinstate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MyEvaluationsTab({ rows }: { rows: EvaluationRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        message="You haven't run any evaluations yet. Visit any evidence page and click 'Add evaluation' to evaluate someone's analysis."
        cta={{ text: 'Browse evidence', href: '/evidence' }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/evidence/${r.evidenceSlug}`}
          style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '14px 18px',
            border: '1px solid var(--border-color)', borderRadius: '6px',
            textDecoration: 'none', color: 'inherit',
            transition: 'border-color 0.15s',
          }}
          onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
        >
          <TypeBadge type={r.type} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.evidenceTitle}
            </div>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>
            {formatDate(r.createdAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}

function TokensTab({ rows }: { rows: TokenRow[] }) {
  const router = useRouter();
  const [revokeTarget, setRevokeTarget] = useState<TokenRow | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState('');

  const handleRevoke = useCallback(async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    setRevokeError('');
    try {
      const res = await fetch(`/api/auth/tokens/${revokeTarget.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Revocation failed' }));
        throw new Error(err.error || 'Revocation failed');
      }
      setRevokeTarget(null);
      router.refresh();
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : 'Revocation failed');
    } finally {
      setRevoking(false);
    }
  }, [revokeTarget, router]);

  if (rows.length === 0) {
    return (
      <EmptyState
        message="No API tokens. External clients (like the Claude Code publish skill) can request a token by running `publish.py --login`, which starts a device authorization flow."
      />
    );
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {rows.map((t) => {
          const expired = new Date(t.expiresAt).getTime() <= Date.now();
          return (
            <div
              key={t.id}
              style={{
                padding: '14px 18px',
                border: '1px solid var(--border-color)', borderRadius: '6px',
                opacity: expired ? 0.6 : 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '6px' }}>
                <div style={{ fontSize: '15px', fontWeight: 600 }}>
                  {t.name}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
                    fontSize: '11px', fontWeight: 600,
                    backgroundColor: 'rgba(var(--accent-rgb), 0.1)', color: 'var(--accent)',
                  }}>
                    {t.scope}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <code style={{ fontFamily: 'monospace' }}>{t.tokenPrefix}...</code>
                <span>{'\u00b7'}</span>
                <span>Created {formatDate(t.createdAt)}</span>
                <span>{'\u00b7'}</span>
                {expired ? (
                  <span style={{ color: 'var(--error)' }}>Expired {formatDate(t.expiresAt)}</span>
                ) : (
                  <span>Expires {formatDate(t.expiresAt)}</span>
                )}
                <span>{'\u00b7'}</span>
                <span>
                  {t.lastUsedAt ? `Last used ${formatDate(t.lastUsedAt)}` : 'Never used'}
                </span>
                <span>{'\u00b7'}</span>
                <button
                  onClick={() => { setRevokeTarget(t); setRevokeError(''); }}
                  style={{
                    background: 'none', border: 'none', padding: 0,
                    fontSize: '12px', color: 'var(--error)', cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Revoke
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {revokeTarget && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !revoking) { setRevokeTarget(null); } }}
        >
          <div style={{
            backgroundColor: 'white', borderRadius: '8px', width: '100%', maxWidth: '440px',
            margin: '16px', padding: '24px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Revoke token</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
              Revoking is immediate and permanent. Any client still using this
              token will start seeing 401 Unauthorized responses. The client
              will need to run a fresh login to get a new token.
            </p>
            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: 'var(--text-primary)' }}>
              &ldquo;{revokeTarget.name}&rdquo; <code style={{ fontSize: '12px', color: 'var(--text-muted)' }}>({revokeTarget.tokenPrefix}...)</code>
            </div>
            {revokeError && (
              <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--error)' }}>
                {revokeError}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                onClick={() => setRevokeTarget(null)}
                disabled={revoking}
                style={{
                  padding: '8px 16px', border: '1px solid var(--border-color)', borderRadius: '4px',
                  fontSize: '13px', cursor: 'pointer', backgroundColor: 'white',
                  color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={revoking}
                style={{
                  padding: '8px 16px', border: 'none', borderRadius: '4px',
                  fontSize: '13px', fontWeight: 600, cursor: revoking ? 'not-allowed' : 'pointer',
                  backgroundColor: 'var(--error)', color: 'white',
                  opacity: revoking ? 0.6 : 1,
                }}
              >
                {revoking ? 'Revoking...' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ActivityTab({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        message="No activity yet. When others evaluate your evidence, you'll see it here."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/evidence/${r.evidenceSlug}`}
          style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '14px 18px',
            border: '1px solid var(--border-color)', borderRadius: '6px',
            textDecoration: 'none', color: 'inherit',
            transition: 'border-color 0.15s',
          }}
          onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
        >
          <TypeBadge type={r.type} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.evidenceTitle}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              by{' '}
              <span style={{ color: 'var(--text-secondary)' }}>
                {r.creatorDisplayName}
              </span>
            </div>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>
            {formatDate(r.createdAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}
