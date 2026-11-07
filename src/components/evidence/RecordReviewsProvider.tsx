'use client';

// The analysis page's one review store and its one add-review sheet (UX-2 P2,
// M2). Mounted by the record page around the answer view, so the status
// area's summary row and the "Reviews" section read the same list, and both
// "Add one" and "+ Add review" open the same sheet.
//
// RED STUB (UX-2 P2 leg B): typed, and not written yet. It renders its
// children and reports a read that never settles; the green leg writes the
// fetch, the expert-payload reads, the refresh and the sheet.

import type { ReactNode } from 'react';
import type { ExpertPayloads, ReviewListRow } from '@/lib/evidence/record-reviews';

export type RecordReviewsState = 'loading' | 'failed' | 'settled';

export interface RecordReviewsValue {
  state: RecordReviewsState;
  attestations: ReviewListRow[];
  expertPayloads: ExpertPayloads;
  /** Read the list again; the last settled value stays until the new read lands. */
  refresh: () => void;
  sheetOpen: boolean;
  /** Open the sheet; `opener` is where focus returns when it closes. */
  openSheet: (opener?: HTMLElement | null) => void;
  closeSheet: () => void;
}

export interface RecordReviewsProviderProps {
  slug: string;
  analysisModel: string;
  promptVisibility: string;
  children?: ReactNode;
}

const UNSETTLED: RecordReviewsValue = {
  state: 'loading',
  attestations: [],
  expertPayloads: {},
  refresh: () => {},
  sheetOpen: false,
  openSheet: () => {},
  closeSheet: () => {},
};

export function RecordReviewsProvider({ children }: RecordReviewsProviderProps) {
  return <>{children}</>;
}

export function useRecordReviews(): RecordReviewsValue {
  return UNSETTLED;
}
