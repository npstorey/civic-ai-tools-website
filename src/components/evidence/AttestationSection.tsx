'use client';

import { useSession } from 'next-auth/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSignInOptions } from '@/components/SignInOptionsProvider';
import { resolveSignInProse } from '@/lib/auth-provider-options';
import type { ReviewSignatureStatus } from '@/lib/evidence/trust-signal';
import type { TrustTier } from '@/lib/evidence/trust-signal';
import { describeToolCallKeyPolicy } from '@/lib/evidence/tool-call-identity';
import { EXPERT_RATING_LABELS } from '@/lib/evidence/expert-attestation';
import { REVIEWS_LOAD_FAILED } from '@/lib/evidence/record-reviews';
import { NO_REVIEWS } from '@/lib/evidence/review-summary';
import { Row } from '@/components/ui/Row';
import { Signal } from '@/components/ui/Signal';
import TrustSignal from './TrustSignal';
import { useRecordReviews } from './RecordReviewsProvider';

type AttestationType = 'consistency' | 'evaluation' | 'expert_attestation';
type ExpertRating = 'endorse' | 'concerns' | 'dispute' | 'neutral';

/**
 * Per-attestation signing disclosure, served by
 * `GET /api/records/[slug]/attestations`. FIVE states, and the three unsigned
 * ones are deliberately NOT collapsed into each other: "recorded before
 * reviews were signed", "this instance has no signing key", and "signing this
 * review did not succeed" are different facts about a review, and a reader
 * weighing it needs to be able to tell which one applies. Copy is resolved
 * server-side from the shared vocabulary in `lib/evidence/trust-signal.ts` so
 * this component never invents wording.
 *
 * Optional because a client may be talking to an instance that has not
 * deployed migration 0016 yet; absent means "say nothing", never "signed".
 */
interface AttestationSignatureDisclosure {
  status: ReviewSignatureStatus;
  tier: TrustTier;
  label: string;
  detail: string;
  keyId: string | null;
  signedAt: string | null;
  rfc3161Timestamped: boolean;
}

/**
 * One row of the list route. The route also answers with each attestation's
 * storage address, kept for API compatibility; this component does not read
 * it. Content comes through the app's package route (#559), so it loads on an
 * instance whose bucket is private.
 */
interface Attestation {
  id: string;
  type: AttestationType;
  packageHash: string;
  createdAt: string;
  creatorDisplayName: string;
  creatorGithubUrl: string;
  signature?: AttestationSignatureDisclosure | null;
}

interface AttestationPackageData {
  type: string;
  metrics?: {
    toolCallOverlap: number;
    outputSimilarity: number;
    consistencyClassification: string;
  };
  config?: { numRuns: number };
  /**
   * How this attestation counted a request the source refused (#402), as the
   * submitting client stored it. Optional because an attestation written
   * before the field existed carries none — and that absence is stated to the
   * reader rather than papered over with this build's rule (#430 F3).
   */
  toolCallKeyPolicy?: string;
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

/**
 * The "Reviews" section's list (UX-2 P2): the page's one review store
 * (`RecordReviewsProvider`) read as P7 rows. Each row: the attester (the
 * title), the review's first line (an expert review's body; the summary), the
 * date and the rating word (the meta line), the kind as a P6 signal (X13), and
 * the review itself in a closed P1 `row` disclosure, "Read the review" (X14,
 * all three kinds under R3 B: the L3 reading). The signing line sits under its
 * row, unchanged. A failed read says so (Q2), never the empty state.
 */
export default function AttestationSection(props: AttestationSectionProps) {
  void props; // The store carries the record; the props stay for the page's call.
  const { data: session } = useSession();
  // #235 — the provider-literal class (#229 P1), prose instance: the
  // signed-out sentence below derives its wording from the providers this
  // instance configured rather than hardcoding one. This section ships on
  // the DUAL-SERVED evidence detail page — the marketing host included — so
  // the hardcoded name was wrong on every non-GitHub instance's public face.
  // Null (nothing configured) drops the sentence entirely.
  const signInProse = resolveSignInProse(useSignInOptions());
  const { state, attestations, expertPayloads, openSheet } = useRecordReviews();
  const rows = attestations as unknown as Attestation[];
  const packages = expertPayloads as Record<string, AttestationPackageData | null | undefined>;
  const isLoggedIn = !!session?.user?.id;

  return (
    <div style={{
      padding: '16px 20px', border: '1px solid var(--border-color)',
      borderRadius: '6px', backgroundColor: 'white',
    }}>
      {state === 'loading' ? (
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>{LOADING_REVIEWS}</p>
      ) : state === 'failed' ? (
        <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--text-muted)' }}>{REVIEWS_LOAD_FAILED}</p>
      ) : rows.length === 0 ? (
        <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--text-muted)' }}>{NO_REVIEWS}</p>
      ) : (
        <div style={{ marginBottom: '16px' }}>
          {rows.map((att) => (
            <ReviewRow key={att.id} attestation={att} payload={packages[att.id]} />
          ))}
        </div>
      )}

      {isLoggedIn ? (
        <button
          type="button"
          onClick={(event) => openSheet(event.currentTarget)}
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
          {ADD_REVIEW}
        </button>
      ) : signInProse !== null ? (
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
          {signInProse} {SIGN_IN_TO_ADD}
        </p>
      ) : null}
    </div>
  );
}

// R3 B's renames (M1).
const LOADING_REVIEWS = 'Loading reviews...'; // was "Loading attestations..."
const SIGN_IN_TO_ADD = 'to add a review.'; // was "to add an attestation."
const ADD_REVIEW = '+ Add review'; // was "+ Add attestation"

// X13: each kind's words, as P6 signals.
const KIND_WORDS: Record<AttestationType, string> = {
  expert_attestation: 'Expert review',
  evaluation: 'Evaluation',
  consistency: 'Consistency test',
};
const READ_THE_REVIEW = 'Read the review'; // X14

/** The first line of a review's text, without its leading markdown marks; empty when there is none. */
function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  return line.replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/, '').replace(/[*_`]/g, '').trim();
}

/**
 * Whether the signature was produced on a later DAY than the review was
 * recorded — i.e. whether this is a review the P2 signing pass reached rather
 * than one signed as it was submitted.
 *
 * Day granularity, not millisecond: the live path signs a review moments after
 * it is recorded, and surfacing a two-second gap as "signed later" would be
 * noise dressed as disclosure (Principle 3 — precision we have not earned).
 * A gap that crosses a calendar day is a real, reader-relevant fact; anything
 * smaller is the same event.
 */
function signedOnALaterDay(createdAt: string, signedAt: string): boolean {
  const c = new Date(createdAt);
  const s = new Date(signedAt);
  if (Number.isNaN(c.getTime()) || Number.isNaN(s.getTime())) return false;
  return s.toDateString() !== c.toDateString();
}

/**
 * The per-review signing line. Renders through the shared `TrustSignal`
 * primitive rather than a parallel badge, so severity reaches a reader by
 * glyph silhouette and screen-reader label, not by color alone.
 *
 * The one-line `label` IS the signal; the longer `detail` is elaboration and
 * stays out of the list (P8: default renders collapse). Renders NOTHING when
 * the field is absent — an instance that has not deployed the signature
 * columns yet says nothing rather than implying either state (P3: if we don't
 * have a signal, don't show one).
 *
 * WHEN THE SIGNATURE IS YOUNGER THAN THE REVIEW, that gap is shown, and this
 * is the honesty property that makes the P2 backfill a disclosable correction
 * rather than a quiet rewrite. Those reviews were recorded before this
 * instance signed reviews at all; a later pass signed them, and `signed_at`
 * records when that actually happened rather than being backdated to the
 * review. A reader who is told only "Signed" would reasonably infer the
 * signature is as old as the review — so the two dates are shown together,
 * in narrative rather than as a metadata pair (P5), whenever they differ.
 */
function ReviewSignatureLine({
  signature,
  createdAt,
}: {
  signature?: AttestationSignatureDisclosure | null;
  createdAt: string;
}) {
  if (!signature) return null;

  const signedLater =
    signature.signedAt !== null && signedOnALaterDay(createdAt, signature.signedAt);

  return (
    <div style={{ marginTop: '8px' }}>
      <TrustSignal tier={signature.tier} label={signature.label} />
      {signedLater && (
        <p style={{
          margin: '4px 0 0 0',
          fontSize: '12px',
          lineHeight: 1.5,
          color: 'var(--text-muted)',
        }}>
          Signed {formatReviewDate(signature.signedAt!)}, after the review itself was
          recorded. This review predates signing on this instance; the signature was
          added later and is dated when it was actually produced, not backdated to the
          review.
        </p>
      )}
    </div>
  );
}

/** One date format for both the review date and the signing date, so a reader
 *  comparing them is comparing like with like. */
function formatReviewDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// --- One review, as a P7 row ---

function ReviewRow({ attestation, payload }: {
  attestation: Attestation;
  payload: AttestationPackageData | null | undefined;
}) {
  const date = new Date(attestation.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const expert = attestation.type === 'expert_attestation';
  const rating = expert && payload?.rating && payload.rating in EXPERT_RATING_LABELS ? EXPERT_RATING_LABELS[payload.rating] : null;
  const summary = expert && payload?.body ? firstLine(payload.body) : null;
  return (
    <div className="ui-review">
      <Row
        title={
          <a href={attestation.creatorGithubUrl} target="_blank" rel="noopener noreferrer">
            {attestation.creatorDisplayName}
          </a>
        }
        summary={summary}
        meta={[date, rating, expert ? payload?.expertise : null]}
        signals={<Signal tier="neutral" label={KIND_WORDS[attestation.type]} />}
        disclosure={{
          summary: READ_THE_REVIEW,
          children: expert ? <ExpertReviewBody payload={payload} /> : <AutomatedReviewDetails attestation={attestation} expanded={payload} />,
        }}
      />
      <ReviewSignatureLine signature={attestation.signature} createdAt={attestation.createdAt} />
    </div>
  );
}

/** An expert review's text, as markdown; said once when it could not be read. */
function ExpertReviewBody({ payload }: { payload: AttestationPackageData | null | undefined }) {
  if (payload === undefined) {
    return <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Loading review...</p>;
  }
  if (!payload?.body) {
    return (
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
        [Review body could not be loaded; the stored package may be unavailable.]
      </p>
    );
  }
  return (
    <div className="response-markdown" style={{ fontSize: '14px' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{payload.body}</ReactMarkdown>
    </div>
  );
}

/** An evaluation's or a consistency test's details, from its stored package. */
function AutomatedReviewDetails({ attestation, expanded }: {
  attestation: Attestation;
  expanded: AttestationPackageData | null | undefined;
}) {
  if (expanded === undefined) {
    return <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Loading review...</p>;
  }
  if (expanded === null) {
    // A failed read (#559): the details are unavailable, said once, never an error body.
    return (
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
        [Details could not be loaded; the stored package may be unavailable.]
      </div>
    );
  }
  return (
    <>
      {attestation.type === 'consistency' && expanded.metrics && (
        <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
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
              ? 'var(--success)'
              : expanded.metrics.consistencyClassification === 'moderately_stable'
                ? 'var(--accent)'
                : 'var(--error)',
            textTransform: 'capitalize',
          }}>
            {expanded.metrics.consistencyClassification.replace(/_/g, ' ')}
          </span>
        </div>
        {/* The key the score was computed under, beside the score (#430 F3).
            A percentage means nothing without it: #363's collapsing key made
            two runs that read different data score 100% inside a SIGNED
            attestation. Read from the stored package, so an attestation that
            records no rule says that instead of borrowing this build's —
            disclosure, not validation (docs/design-principles.md Principle 1,
            and Principle 3 on absence). */}
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.5 }}>
          {describeToolCallKeyPolicy(expanded).text}
        </p>
        </>
      )}

      {attestation.type === 'evaluation' && expanded.rubric && (
        <div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', fontSize: '13px' }}>
            <span style={{ fontWeight: 600 }}>Overall:</span>
            <span style={{
              fontSize: '16px', fontWeight: 700,
              color: (expanded.overallScore || 0) >= 8 ? 'var(--success)'
                : (expanded.overallScore || 0) >= 5 ? 'var(--accent)'
                : 'var(--error)',
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
                  color: val.score >= 8 ? 'var(--success)' : val.score >= 5 ? 'var(--accent)' : 'var(--error)',
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
    </>
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
