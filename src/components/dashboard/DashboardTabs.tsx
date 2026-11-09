'use client';

import { useState, useCallback, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { normalizeVisibility } from '@/lib/evidence/visibility';
import { sealedRecordPublishAffordance } from '@/lib/evidence/seal-only';
import type { SealedRecordPublishAffordance } from '@/lib/evidence/seal-only';
import { formatModelName } from '@/lib/models';
import { reviewsLine, type RecordReviews } from '@/lib/evidence/review-summary';
import SourcesTab from './SourcesTab';
import { Dialog } from '@/components/ui/Dialog';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { Row } from '@/components/ui/Row';
import { Signal } from '@/components/ui/Signal';
import { Tabs } from '@/components/ui/Tabs';

// My analyses (UX-2 P4a) on the UX-1 primitives: the tab bar is P8 `Tabs`,
// each analysis, review and activity item a P7 `Row` with P6 signals, each
// analysis's actions a P2 `icon` menu, and the four confirmations P4
// `Dialog size="short"`. The first tab pages at 25 (`?page=`, read by the
// page). Every word below is ruled: the charter's Words table, row A (X19,
// X20, X21, P5's `reviewsLine`), and relay 46's R3-R6.

// --- Types ---

interface EvidenceRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  model: string;
  withdrawnAt: string | null;
  reinstatedAt: string | null;
  createdAt: string;
  /** Visibility mirror (civic-ai-tools#71), as the raw DB label — either
   *  vocabulary (ADR-0016 §A; normalized through `@/lib/evidence/visibility`).
   *  Sealed records are unlisted + creator-only until promoted via the publish
   *  flow. */
  visibility: string;
  /** The row's reviews, as P5's `reviewsLine` reads them; absent, the reviews signal is absent (Principle 3). */
  reviews?: RecordReviews;
}

interface EvaluationRow {
  id: string;
  type: string;
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

export type DashboardTab = 'evidence' | 'evaluations' | 'activity' | 'tokens' | 'sources';

interface DashboardTabsProps {
  /** The tab shown first: `/dashboard?tab=sources` opens the Sources tab (R6 W3, Q7); the parameter still works, though nothing links it since the Sources panel went (UX-2 P4b). */
  initialTab?: DashboardTab;
  /** This page's analyses, newest first. */
  myEvidence: EvidenceRow[];
  /** The analyses over every page, for the tab's count; omitted, this page's length. */
  analysesTotal?: number;
  /** This page's number, from 1. */
  page?: number;
  /** How many pages the analyses fill; 1 renders no pager. */
  pageCount?: number;
  myEvaluations: EvaluationRow[];
  activity: ActivityRow[];
  tokens: TokenRow[];
  /** Whether this instance holds a signing key (ADR-0020, S3a P3): with no
   *  key the sealed→public promotion is gated off server-side, so the
   *  Publish action renders disabled-with-explanation instead of a dead
   *  action that errors. */
  signingConfigured?: boolean;
  /** Whether this instance seals records only (`SITE_SEAL_ONLY`, #552): the
   *  sealed→public promotion is refused server-side, so Publish renders
   *  disabled with the reason, not hidden. Omitted = off. */
  sealOnly?: boolean;
}

// --- Words (ruled: X19-X21, relay 46 R3-R6) ---

/** The tablist's accessible name (R4). */
const TABLIST_LABEL = 'Dashboard';
/** The row menu's icon trigger, named for its row (R6, the owner's ruling). */
const actionsFor = (title: string): string => `Actions for ${title}`;
/** The pager's two words (R4, the registry's). */
const PAGER_PREVIOUS = 'Previous';
const PAGER_NEXT = 'Next';
/** Shown in the status region after Copy link (R4, the analysis page's word). */
const COPIED = 'Copied';
/** The unsigned tier's reason, today's words (R3): the disabled Publish item's second line. */
const UNSIGNED_PUBLISH_REASON =
  'Publishing is unavailable — this instance is running unsigned (signing is not configured). Signing is the go-to-production step and takes both PUBLISHER_SIGNING_KEY and PUBLISHER_KEY_ID; see docs/instance-setup.md.';
/** A review's kind, as the reviews line names it (R5; `review-summary.ts:50-52`, sentence case). */
const KIND_LABEL: Record<string, string> = {
  expert_attestation: 'Expert review',
  evaluation: 'Evaluation',
  consistency: 'Consistency test',
};
/** A kind the rulings name no word for (`re_evaluation`, `correction`) keeps today's text: its type. */
const kindLabel = (type: string): string => KIND_LABEL[type] ?? type;

// --- Shared ---

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

const BODY_TEXT: CSSProperties = { fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 12px' };
const QUOTED_TITLE: CSSProperties = { fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: 'var(--text-primary)' };
const REASON_LABEL: CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', marginTop: '12px', color: 'var(--text-primary)' };
const REASON_FIELD: CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid var(--border-color)',
  borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box',
  resize: 'vertical', fontFamily: 'inherit',
};
const ERROR_LINE: CSSProperties = { marginTop: '8px', fontSize: '13px', color: 'var(--error)' };

// --- Main component ---

export default function DashboardTabs({ initialTab = 'evidence', myEvidence, analysesTotal, page = 1, pageCount = 1, myEvaluations, activity, tokens, signingConfigured = true, sealOnly = false }: DashboardTabsProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab);
  const tabs = [
    { id: 'evidence', label: `My analyses (${analysesTotal ?? myEvidence.length})` },
    { id: 'evaluations', label: `My reviews and checks (${myEvaluations.length})` },
    { id: 'activity', label: `Activity (${activity.length})` },
    { id: 'tokens', label: `Tokens (${tokens.length})` },
    { id: 'sources', label: 'Sources' },
  ];

  return (
    <Tabs label={TABLIST_LABEL} tabs={tabs} selectedId={activeTab} onSelect={(id) => setActiveTab(id as DashboardTab)}>
      <div style={{ paddingTop: '24px' }}>
        {activeTab === 'evidence' && <MyEvidenceTab rows={myEvidence} page={page} pageCount={pageCount} signingConfigured={signingConfigured} sealOnly={sealOnly} />}
        {activeTab === 'evaluations' && <MyEvaluationsTab rows={myEvaluations} />}
        {activeTab === 'activity' && <ActivityTab rows={activity} />}
        {activeTab === 'tokens' && <TokensTab rows={tokens} />}
        {activeTab === 'sources' && <SourcesTab />}
      </div>
    </Tabs>
  );
}

// --- Tab panels ---

/** The row's one lifecycle signal (X20): withdrawn first, else its visibility. */
function lifecycleLabel(r: EvidenceRow, currentlyWithdrawn: boolean): string {
  if (currentlyWithdrawn) return `Withdrawn on ${formatDate(r.withdrawnAt!)}`;
  return normalizeVisibility(r.visibility) === 'sealed' ? 'Sealed · only you' : 'Public';
}

/**
 * The Publish item on a sealed row: enabled when the instance can publish;
 * otherwise X21's "Publish", disabled, with the reason as its second line
 * (R3): the unsigned tier's, or (#552) the seal-only instance's.
 */
function publishItem(publishAffordance: SealedRecordPublishAffordance): MenuItem {
  if (publishAffordance.kind === 'available') return { id: 'publish', label: 'Publish' };
  if (publishAffordance.kind === 'unsigned') return { id: 'publish', label: 'Publish', disabledReason: UNSIGNED_PUBLISH_REASON };
  return { id: 'publish', label: 'Publish', disabledReason: publishAffordance.explanation };
}

function MyEvidenceTab({ rows, page, pageCount, signingConfigured, sealOnly }: { rows: EvidenceRow[]; page: number; pageCount: number; signingConfigured: boolean; sealOnly: boolean }) {
  const router = useRouter();
  // What the Publish action on a sealed record is: available, the unsigned
  // tier's disabled action, or (#552) the seal-only one.
  const publishAffordance = sealedRecordPublishAffordance({ signingConfigured, sealOnly });
  const [withdrawTarget, setWithdrawTarget] = useState<EvidenceRow | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');

  const [reinstateTarget, setReinstateTarget] = useState<EvidenceRow | null>(null);
  const [reinstateReason, setReinstateReason] = useState('');
  const [reinstating, setReinstating] = useState(false);
  const [reinstateError, setReinstateError] = useState('');

  // Copy link: the status region above the list reads "Copied" for a moment.
  const [copied, setCopied] = useState(false);

  // A plain function: its one reader, the dialog's action, needs no stable
  // identity (with `useCallback`, the react-hooks lint could not preserve it).
  const handleWithdraw = async () => {
    if (!withdrawTarget || !withdrawReason.trim()) return;
    setWithdrawing(true);
    setWithdrawError('');
    try {
      const res = await fetch(`/api/records/${withdrawTarget.slug}/withdraw`, {
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
  };

  // A plain function: its one reader, the dialog's action, needs no stable
  // identity (with `useCallback`, the react-hooks lint could not preserve it).
  const handleReinstate = async () => {
    if (!reinstateTarget || !reinstateReason.trim()) return;
    setReinstating(true);
    setReinstateError('');
    try {
      const res = await fetch(`/api/records/${reinstateTarget.slug}/reinstate`, {
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
  };

  // Sealed → public promotion (civic-ai-tools#71/#72 Phase 5). Runs the
  // default-on adversarial eval unless the user unchecks it; irreversible.
  const [publishTarget, setPublishTarget] = useState<EvidenceRow | null>(null);
  const [publishRunEval, setPublishRunEval] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  // A plain function: its one reader, the dialog's action, needs no stable
  // identity (with `useCallback`, the react-hooks lint could not preserve it).
  const handlePublish = async () => {
    if (!publishTarget) return;
    setPublishing(true);
    setPublishError('');
    try {
      const res = await fetch(`/api/records/${publishTarget.slug}/publish`, {
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
  };

  const copyLink = async (r: EvidenceRow) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/records/${r.slug}`);
    } catch {
      return; // nothing was copied, so nothing is said
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /** A row's menu item chosen. Only enabled items reach here (the Menu calls nothing for a disabled one). */
  const act = (r: EvidenceRow, id: string) => {
    if (id === 'publish') { setPublishTarget(r); setPublishRunEval(true); setPublishError(''); }
    else if (id === 'withdraw') { setWithdrawTarget(r); setWithdrawReason(''); setWithdrawError(''); }
    else if (id === 'reinstate') { setReinstateTarget(r); setReinstateReason(''); setReinstateError(''); }
    else if (id === 'copy') void copyLink(r);
  };

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
        message="You haven't published any analyses yet. Ask a question, then click 'Publish' to get started."
        cta={{ text: 'Ask a question', href: '/ask' }}
      />
    );
  }

  return (
    <>
      <p role="status" aria-live="polite" style={{ margin: '0 0 8px', minHeight: '18px', fontSize: '13px', color: 'var(--success)' }}>
        {copied ? COPIED : ''}
      </p>
      <div>
        {rows.map((r) => {
          const isCurrentlyWithdrawn = !!r.withdrawnAt && !r.reinstatedAt;
          const isReinstated = !!r.withdrawnAt && !!r.reinstatedAt;
          const isSealed = normalizeVisibility(r.visibility) === 'sealed';
          // X21's actions, as the row's state allows (brief measurement 5):
          // Publish on a sealed row that is not withdrawn (the publish route
          // refuses a withdrawn one); Withdraw once (the withdraw route
          // refuses a record ever withdrawn, F8); Reinstate on a withdrawn one.
          const items: MenuItem[] = [
            { id: 'open', label: 'Open', href: `/records/${r.slug}` },
            ...(isSealed && !isCurrentlyWithdrawn ? [publishItem(publishAffordance)] : []),
            ...(!isCurrentlyWithdrawn && !isReinstated ? [{ id: 'withdraw', label: 'Withdraw' }] : []),
            ...(isCurrentlyWithdrawn ? [{ id: 'reinstate', label: 'Reinstate' }] : []),
            { id: 'copy', label: 'Copy link' },
          ];
          return (
            <Row
              key={r.id}
              as="article"
              title={r.title}
              href={`/records/${r.slug}`}
              summary={r.summary}
              meta={[
                formatDate(r.createdAt),
                formatModelName(r.model),
                isReinstated ? `Reinstated ${formatDate(r.reinstatedAt!)}` : null,
              ]}
              withdrawn={isCurrentlyWithdrawn}
              signals={
                <>
                  <Signal tier="neutral" label={lifecycleLabel(r, isCurrentlyWithdrawn)} />
                  {r.reviews && <Signal tier="neutral" label={reviewsLine(r.reviews)} />}
                </>
              }
              menu={
                <Menu
                  size="icon"
                  align="end"
                  trigger={<span aria-hidden="true">{'⋯'}</span>}
                  triggerLabel={actionsFor(r.title)}
                  items={items}
                  onSelect={(id) => act(r, id)}
                />
              }
            />
          );
        })}
      </div>

      {pageCount > 1 && <Pager page={page} pageCount={pageCount} />}

      {/* Publish (sealed → public) confirmation dialog */}
      <Dialog
        open={publishTarget !== null}
        onClose={() => setPublishTarget(null)}
        title="Publish this analysis"
        size="short"
        state={publishing ? 'busy' : publishError ? 'error' : 'form'}
        secondaryAction={{ label: 'Cancel', onClick: () => setPublishTarget(null) }}
        primaryAction={{
          label: publishing ? (publishRunEval ? 'Evaluating & publishing…' : 'Publishing…') : 'Publish',
          onClick: handlePublish,
        }}
      >
        {publishTarget && (
          <>
            <p style={BODY_TEXT}>
              Publishing makes the content of <strong>{publishTarget.title}</strong> publicly
              accessible, lists it in the registry, and emits signed publication
              attestations. Publication is <strong>not reversible</strong> — a later
              withdrawal flags the analysis but does not erase it.
            </p>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
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
                  rubric; the signed result is attached to the analysis (adds ~30s).
                </span>
              </span>
            </label>
            {publishError && (
              <div style={{
                padding: '8px 12px', marginTop: '12px', borderRadius: '4px',
                backgroundColor: 'rgba(var(--error-rgb), 0.08)', color: 'var(--error)', fontSize: '13px',
              }}>
                {publishError}
              </div>
            )}
          </>
        )}
      </Dialog>

      {/* Withdrawal confirmation dialog */}
      <Dialog
        open={withdrawTarget !== null}
        onClose={() => setWithdrawTarget(null)}
        title="Withdraw this analysis"
        size="short"
        state={withdrawing ? 'busy' : withdrawError ? 'error' : 'form'}
        secondaryAction={{ label: 'Cancel', onClick: () => setWithdrawTarget(null) }}
        primaryAction={{
          label: withdrawing ? 'Withdrawing...' : 'Withdraw',
          onClick: handleWithdraw,
          disabled: !withdrawReason.trim(),
        }}
      >
        {withdrawTarget && (
          <>
            <p style={BODY_TEXT}>
              Withdrawing an analysis is a public, permanent action. The analysis and its cryptographic
              proofs remain accessible, but it will be flagged as withdrawn.
            </p>
            <div style={QUOTED_TITLE}>
              &ldquo;{withdrawTarget.title}&rdquo;
            </div>
            <label htmlFor="dashboard-withdraw-reason" style={REASON_LABEL}>
              Reason for withdrawal *
            </label>
            <textarea
              id="dashboard-withdraw-reason"
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
              placeholder="e.g., Data source was updated, methodology was flawed, superseded by newer analysis..."
              rows={3}
              style={REASON_FIELD}
            />
            {withdrawError && <div style={ERROR_LINE}>{withdrawError}</div>}
          </>
        )}
      </Dialog>

      {/* Reinstatement confirmation dialog */}
      <Dialog
        open={reinstateTarget !== null}
        onClose={() => setReinstateTarget(null)}
        title="Reinstate this analysis"
        size="short"
        state={reinstating ? 'busy' : reinstateError ? 'error' : 'form'}
        secondaryAction={{ label: 'Cancel', onClick: () => setReinstateTarget(null) }}
        primaryAction={{
          label: reinstating ? 'Reinstating...' : 'Reinstate',
          onClick: handleReinstate,
          disabled: !reinstateReason.trim(),
        }}
      >
        {reinstateTarget && (
          <>
            <p style={BODY_TEXT}>
              Reinstating will make this analysis visible again in the public index. The prior
              withdrawal record is preserved — both the withdrawal and reinstatement will appear
              in the status history for transparency.
            </p>
            <div style={QUOTED_TITLE}>
              &ldquo;{reinstateTarget.title}&rdquo;
            </div>
            <label htmlFor="dashboard-reinstate-reason" style={REASON_LABEL}>
              Reason for reinstatement *
            </label>
            <textarea
              id="dashboard-reinstate-reason"
              value={reinstateReason}
              onChange={(e) => setReinstateReason(e.target.value)}
              placeholder="e.g., Original concern resolved, data was re-verified, withdrawal was premature..."
              rows={3}
              style={REASON_FIELD}
            />
            {reinstateError && <div style={ERROR_LINE}>{reinstateError}</div>}
          </>
        )}
      </Dialog>
    </>
  );
}

/** The first tab's pager: links to `?page=N`, the current page marked, far pages elided as the registry does. */
function Pager({ page, pageCount }: { page: number; pageCount: number }) {
  const href = (n: number) => `/dashboard?page=${n}`;
  const box: CSSProperties = {
    padding: '6px 12px', border: '1px solid var(--border-color)', borderRadius: '4px',
    fontSize: '13px', textDecoration: 'none', color: 'var(--text-secondary)',
  };
  const numbers = Array.from({ length: pageCount }, (_, i) => i + 1)
    .filter((n) => n === 1 || n === pageCount || Math.abs(n - page) <= 1)
    .reduce<(number | 'ellipsis')[]>((acc, n, i, arr) => {
      if (i > 0 && n - arr[i - 1] > 1) acc.push('ellipsis');
      acc.push(n);
      return acc;
    }, []);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '24px' }}>
      {page > 1 ? <Link href={href(page - 1)} style={box}>{PAGER_PREVIOUS}</Link> : <span style={{ ...box, opacity: 0.5 }}>{PAGER_PREVIOUS}</span>}
      {numbers.map((item, i) =>
        item === 'ellipsis' ? (
          <span key={`e${i}`} style={{ padding: '6px 4px', color: 'var(--text-muted)', fontSize: '13px' }}>...</span>
        ) : item === page ? (
          <span key={item} aria-current="page" style={{ ...box, backgroundColor: 'var(--accent)', color: 'var(--white)', fontWeight: 600 }}>{item}</span>
        ) : (
          <Link key={item} href={href(item)} style={box}>{item}</Link>
        ),
      )}
      {page < pageCount ? <Link href={href(page + 1)} style={box}>{PAGER_NEXT}</Link> : <span style={{ ...box, opacity: 0.5 }}>{PAGER_NEXT}</span>}
    </div>
  );
}

function MyEvaluationsTab({ rows }: { rows: EvaluationRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        message="You haven't run any evaluations yet. Visit any analysis page and click 'Add evaluation' to evaluate someone's analysis."
        cta={{ text: 'Browse analyses', href: '/records' }}
      />
    );
  }

  return (
    <div>
      {rows.map((r) => (
        <Row
          key={r.id}
          title={r.evidenceTitle}
          href={`/records/${r.evidenceSlug}`}
          meta={[formatDate(r.createdAt)]}
          signals={<Signal tier="neutral" label={kindLabel(r.type)} />}
        />
      ))}
    </div>
  );
}

function TokensTab({ rows }: { rows: TokenRow[] }) {
  const router = useRouter();
  const [revokeTarget, setRevokeTarget] = useState<TokenRow | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState('');
  // Read once when the tab opens, not on every render (react-hooks/purity).
  const [now] = useState(() => Date.now());

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
          const expired = new Date(t.expiresAt).getTime() <= now;
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
                <span>{'·'}</span>
                <span>Created {formatDate(t.createdAt)}</span>
                <span>{'·'}</span>
                {expired ? (
                  <span style={{ color: 'var(--error)' }}>Expired {formatDate(t.expiresAt)}</span>
                ) : (
                  <span>Expires {formatDate(t.expiresAt)}</span>
                )}
                <span>{'·'}</span>
                <span>
                  {t.lastUsedAt ? `Last used ${formatDate(t.lastUsedAt)}` : 'Never used'}
                </span>
                <span>{'·'}</span>
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

      <Dialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="Revoke token"
        size="short"
        state={revoking ? 'busy' : revokeError ? 'error' : 'form'}
        secondaryAction={{ label: 'Cancel', onClick: () => setRevokeTarget(null) }}
        primaryAction={{ label: revoking ? 'Revoking...' : 'Revoke', onClick: handleRevoke }}
      >
        {revokeTarget && (
          <>
            <p style={BODY_TEXT}>
              Revoking is immediate and permanent. Any client still using this
              token will start seeing 401 Unauthorized responses. The client
              will need to run a fresh login to get a new token.
            </p>
            <div style={QUOTED_TITLE}>
              &ldquo;{revokeTarget.name}&rdquo; <code style={{ fontSize: '12px', color: 'var(--text-muted)' }}>({revokeTarget.tokenPrefix}...)</code>
            </div>
            {revokeError && <div style={ERROR_LINE}>{revokeError}</div>}
          </>
        )}
      </Dialog>
    </>
  );
}

function ActivityTab({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        message="No activity yet. When others evaluate your analyses, you'll see it here."
      />
    );
  }

  return (
    <div>
      {rows.map((r) => (
        <Row
          key={r.id}
          title={r.evidenceTitle}
          href={`/records/${r.evidenceSlug}`}
          meta={[formatDate(r.createdAt), `by ${r.creatorDisplayName}`]}
          signals={<Signal tier="neutral" label={kindLabel(r.type)} />}
        />
      ))}
    </div>
  );
}
