'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';

// --- Types ---

interface EvidenceRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  model: string;
  verificationStatus: string;
  consistencyClassification: string | null;
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
  if (rows.length === 0) {
    return (
      <EmptyState
        message="You haven't published any evidence yet. Run an analysis on the home page and click 'Publish as Evidence' to get started."
        cta={{ text: 'Go to home page', href: '/' }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/evidence/${r.slug}`}
          style={{
            display: 'block', padding: '14px 18px',
            border: '1px solid var(--border-color)', borderRadius: '6px',
            textDecoration: 'none', color: 'inherit',
            transition: 'border-color 0.15s',
          }}
          onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--nyc-blue)'; }}
          onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '6px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
              {r.title}
            </h3>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              <StatusBadge status={r.verificationStatus} />
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span>{formatDate(r.createdAt)}</span>
            <span>{'\u00b7'}</span>
            <span>{r.model}</span>
            <span>{'\u00b7'}</span>
            <span>{r.attestationCount} attestation{r.attestationCount !== 1 ? 's' : ''}</span>
            {r.consistencyClassification && (
              <>
                <span>{'\u00b7'}</span>
                <span style={{ textTransform: 'capitalize' }}>
                  {r.consistencyClassification.replace(/_/g, ' ')}
                </span>
              </>
            )}
          </div>
        </Link>
      ))}
    </div>
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
