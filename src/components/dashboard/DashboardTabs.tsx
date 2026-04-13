'use client';

import { useState, useCallback, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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

interface DashboardTabsProps {
  myEvidence: EvidenceRow[];
  myEvaluations: EvaluationRow[];
  activity: ActivityRow[];
}

// --- Shared styles ---

const tabStyle = (isActive: boolean): CSSProperties => ({
  padding: '12px 24px',
  fontSize: '15px',
  fontWeight: isActive ? 600 : 400,
  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
  border: 'none',
  borderBottom: isActive ? '2px solid var(--nyc-blue)' : '2px solid transparent',
  marginBottom: '-2px',
  background: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
});

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    unverified: { bg: 'rgba(0,0,0,0.06)', text: 'var(--text-muted)' },
    consistency_tested: { bg: 'rgba(16, 63, 239, 0.1)', text: 'var(--nyc-blue)' },
    evaluated: { bg: 'rgba(0, 183, 3, 0.1)', text: 'var(--nyc-success)' },
    fully_attested: { bg: 'rgba(0, 183, 3, 0.15)', text: 'var(--nyc-success)' },
    withdrawn: { bg: 'rgba(236, 19, 30, 0.08)', text: 'var(--nyc-error)' },
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
      backgroundColor: isConsistency ? 'rgba(16, 63, 239, 0.1)' : 'rgba(0, 183, 3, 0.1)',
      color: isConsistency ? 'var(--nyc-blue)' : 'var(--nyc-success)',
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
        <Link href={cta.href} style={{ color: 'var(--nyc-blue)', fontSize: '14px', marginTop: '8px', display: 'inline-block' }}>
          {cta.text}
        </Link>
      )}
    </div>
  );
}

// --- Main component ---

export default function DashboardTabs({ myEvidence, myEvaluations, activity }: DashboardTabsProps) {
  const [activeTab, setActiveTab] = useState<'evidence' | 'evaluations' | 'activity'>('evidence');

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
      </div>

      {activeTab === 'evidence' && <MyEvidenceTab rows={myEvidence} />}
      {activeTab === 'evaluations' && <MyEvaluationsTab rows={myEvaluations} />}
      {activeTab === 'activity' && <ActivityTab rows={activity} />}
    </>
  );
}

// --- Tab panels ---

function MyEvidenceTab({ rows }: { rows: EvidenceRow[] }) {
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

  if (rows.length === 0) {
    return (
      <EmptyState
        message="You haven't published any evidence yet. Run an analysis on the home page and click 'Publish as Evidence' to get started."
        cta={{ text: 'Go to home page', href: '/' }}
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
                    <span style={{ color: 'var(--nyc-error)' }}>Withdrawn {formatDate(r.withdrawnAt!)}</span>
                    <span>{'\u00b7'}</span>
                    <button
                      onClick={() => { setReinstateTarget(r); setReinstateReason(''); setReinstateError(''); }}
                      style={{
                        background: 'none', border: 'none', padding: 0,
                        fontSize: '12px', color: 'var(--nyc-blue)', cursor: 'pointer',
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
                    <span style={{ color: 'var(--nyc-success)' }}>Reinstated {formatDate(r.reinstatedAt!)}</span>
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
              <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--nyc-error)' }}>
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
                  backgroundColor: 'var(--nyc-error)', color: 'white',
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
              <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--nyc-error)' }}>
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
                  backgroundColor: 'var(--nyc-success)', color: 'white',
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
          onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--nyc-blue)'; }}
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
          onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--nyc-blue)'; }}
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
