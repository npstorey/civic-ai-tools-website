'use client';

// The status area's reviews row on the analysis page (UX-2 P2; X12, ruled):
// "No reviews yet · Add one", or "N reviews: … · See them · Add one". The
// reviews part is `reviewsLine`, the registry row's own line (P5), over the
// page's one review store (`RecordReviewsProvider`), so the two surfaces say
// the same thing about one record.
//
// THE ROW'S ELEMENT RENDERS IN EVERY STATE, empty until the list and every
// expert review's payload have been read, so the page can place it: a count
// from a partial read ("1 expert review", then "(concerns)") or an early "No
// reviews yet" would be a claim the page has not established (Principle 3).
// A failed read leaves it empty; the list says what failed.
//
// "Add one": signed in, it opens the sheet and records itself as where focus
// returns. Signed out, the host-aware sign-in form (`QueryForm.tsx`): a link
// to the app host's sign-in when the topology sets one, in-place sign-in with
// the one provider, the sign-in panel with several, and nothing with none.

import type { ReactNode } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useHostLinks } from '@/components/HostLinksProvider';
import { useSignInOptions } from '@/components/SignInOptionsProvider';
import { resolveSignInAffordance } from '@/lib/auth-provider-options';
import { expertPayloadsSettled, recordReviewsOf, REVIEWS_SECTION_ID } from '@/lib/evidence/record-reviews';
import { reviewsLine } from '@/lib/evidence/review-summary';
import { useRecordReviews } from './RecordReviewsProvider';

const SEE_THEM = 'See them';
const ADD_ONE = 'Add one';

const LINK_STYLE = { color: 'var(--accent)', textDecoration: 'underline' } as const;
const BUTTON_STYLE = {
  ...LINK_STYLE,
  background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer',
} as const;

export default function ReviewsSummaryRow() {
  const { state, attestations, expertPayloads, openSheet } = useRecordReviews();
  const { data: session } = useSession();
  const { signInHref } = useHostLinks();
  const affordance = resolveSignInAffordance(useSignInOptions());
  const settled = state === 'settled' && expertPayloadsSettled(attestations, expertPayloads);

  let addOne: ReactNode = null;
  if (session?.user?.id) {
    addOne = <button type="button" style={BUTTON_STYLE} onClick={(event) => openSheet(event.currentTarget)}>{ADD_ONE}</button>;
  } else if (signInHref !== null) {
    addOne = <a href={signInHref} style={LINK_STYLE}>{ADD_ONE}</a>;
  } else if (affordance.kind === 'provider') {
    const { id } = affordance.option;
    addOne = <button type="button" style={BUTTON_STYLE} onClick={() => { void signIn(id); }}>{ADD_ONE}</button>;
  } else if (affordance.kind === 'panel') {
    addOne = <a href={affordance.href} style={LINK_STYLE}>{ADD_ONE}</a>;
  }

  const parts: ReactNode[] = [];
  if (settled) {
    const reviews = recordReviewsOf(attestations, expertPayloads);
    const counted = reviews.expertRatings.length + reviews.evaluations + reviews.consistencyTests;
    parts.push(<span key="line">{reviewsLine(reviews)}</span>);
    if (counted > 0) parts.push(<a key="see" href={`#${REVIEWS_SECTION_ID}`} style={LINK_STYLE}>{SEE_THEM}</a>);
    if (addOne !== null) parts.push(<span key="add">{addOne}</span>);
  }

  return (
    <div data-part="reviews-summary" style={{ margin: '0 0 24px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {part}
        </span>
      ))}
    </div>
  );
}
