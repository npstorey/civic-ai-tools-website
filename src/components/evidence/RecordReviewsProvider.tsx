'use client';

// The analysis page's one review store and its one add-review sheet (UX-2 P2,
// M2). Mounted by the record page around the answer view, so the status
// area's summary row (`ReviewsSummaryRow`) and the "Reviews" section's list
// (`AttestationSection`) read the same list, and both "Add one" and
// "+ Add review" open the same sheet.
//
// THE READ. The record's review list (`GET /api/records/[slug]/attestations`),
// then each review's stored package through the app's package route (#559),
// once per review. The list is kept oldest first (the route states no order).
//   - `loading` until the first list read returns; `failed` when it does not
//     answer 2xx, or does not answer: never an empty list, which would be a
//     claim the page has not established (Principle 3);
//   - a refresh (after a publish) keeps the last settled list until the new
//     read lands, so the summary row does not blank; a refresh that fails
//     keeps it too;
//   - a package read that fails is `null`, which the list shows as
//     unavailable and the summary reads as an unread rating (left out).
// State is set only in promise callbacks, so no effect sets any synchronously
// (react-hooks/set-state-in-effect).
//
// THE SHEET. Mounted here, beside the children and outside every section and
// `<details>`, so where the section renders never decides whether the sheet
// can show. `openSheet(opener)` records the element that opened it, and focus
// returns to that element when the sheet closes: the Sheet's own return
// (`useModalFocus`) relies on the browser having focused the clicked button,
// which macOS Safari does not.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadAttestationPackage } from '@/lib/evidence/attestation-content';
import { oldestFirst, type ExpertPayloads, type ReviewListRow } from '@/lib/evidence/record-reviews';
import AttestationDialog from './AttestationDialog';

export type RecordReviewsState = 'loading' | 'failed' | 'settled';

/** One row of the list route, as the list renders it. */
export interface ReviewRow extends ReviewListRow {
  packageHash: string;
  creatorDisplayName: string;
  creatorGithubUrl: string;
  /** The per-review signing disclosure (`trust-signal.ts`); absent on an instance without the columns. */
  signature?: unknown;
}

export interface RecordReviewsValue {
  state: RecordReviewsState;
  attestations: ReviewRow[];
  /** Each review's stored package, by id (see `ExpertPayloads`). */
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

const RecordReviewsContext = createContext<RecordReviewsValue>(UNSETTLED);

export function RecordReviewsProvider({ slug, analysisModel, promptVisibility, children }: RecordReviewsProviderProps) {
  const [state, setState] = useState<RecordReviewsState>('loading');
  const [attestations, setAttestations] = useState<ReviewRow[]>([]);
  const [payloads, setPayloads] = useState<ExpertPayloads>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  const read = useCallback(() => {
    fetch(`/api/records/${slug}/attestations`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { attestations?: ReviewRow[] };
        setAttestations(oldestFirst(Array.isArray(data.attestations) ? data.attestations : []));
        setState('settled');
      })
      .catch(() => {
        // A first read that fails is a failed read; a refresh that fails keeps the list it had.
        setState((prior) => (prior === 'settled' ? prior : 'failed'));
      });
  }, [slug]);

  useEffect(() => {
    read();
  }, [read]);

  // Each review's package, once: the expert bodies and rating words, and the
  // automated reviews' details. A failed read is null.
  useEffect(() => {
    const toLoad = attestations.filter((a) => !(a.id in payloads));
    if (toLoad.length === 0) return;
    let cancelled = false;
    Promise.all(
      toLoad.map((a) =>
        loadAttestationPackage(slug, a.id, { fetch: (input, init) => fetch(input, init) }).then((data) => [a.id, data] as const),
      ),
    ).then((results) => {
      if (cancelled) return;
      setPayloads((prev) => {
        const next = { ...prev };
        for (const [id, data] of results) next[id] = data as { rating?: unknown } | null;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [slug, attestations, payloads]);

  const openSheet = useCallback((from?: HTMLElement | null) => {
    opener.current = from ?? null;
    setSheetOpen(true);
  }, []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // Focus returns to the element that opened the sheet. This runs after the
  // Sheet's own return (a child's effect cleanup runs before a parent's effect).
  useEffect(() => {
    if (wasOpen.current && !sheetOpen) {
      const el = opener.current;
      if (el && typeof el.focus === 'function' && el.isConnected !== false) el.focus();
    }
    wasOpen.current = sheetOpen;
  }, [sheetOpen]);

  const value = useMemo<RecordReviewsValue>(
    () => ({ state, attestations, expertPayloads: payloads, refresh: read, sheetOpen, openSheet, closeSheet }),
    [state, attestations, payloads, read, sheetOpen, openSheet, closeSheet],
  );

  return (
    <RecordReviewsContext.Provider value={value}>
      {children}
      <AttestationDialog
        slug={slug}
        analysisModel={analysisModel}
        promptVisibility={promptVisibility}
        open={sheetOpen}
        onClose={closeSheet}
        onAttestationCreated={read}
      />
    </RecordReviewsContext.Provider>
  );
}

/** The page's review store. Outside the provider: a read that never settles, and a sheet that never opens. */
export function useRecordReviews(): RecordReviewsValue {
  return useContext(RecordReviewsContext);
}
