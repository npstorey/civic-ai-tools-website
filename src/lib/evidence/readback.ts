// The `GET /api/evidence/[slug]` read-back projection.
//
// Extracted from the route so the two properties the ADR-0016 §A sweep put on
// this surface are directly exercisable by the test runner (which resolves no
// path aliases, and cannot load a route module):
//
//   1. `visibility` is served CANONICAL, not raw — a row on either vocabulary
//      reads out as `sealed` / `public`;
//   2. `listed` and `isPublic` are both emitted, from the same column.
//
// Nothing here touches the database; the route does the lookups and the
// authorization, then hands the rows to this pure function.

import type { evidenceRecords, users } from '../db/schema.ts';
import { fromDbValue } from './visibility.ts';

type EvidenceRecord = typeof evidenceRecords.$inferSelect;

/** The creator projection the route selects — public GitHub identity only. */
export type ReadbackCreator = Pick<
  typeof users.$inferSelect,
  'displayName' | 'githubProfileUrl'
>;

/**
 * Build the read-back body for one evidence record.
 *
 * `createdAt` / `updatedAt` are passed through as `Date`s; `NextResponse.json`
 * serializes them to ISO-8601 strings, exactly as the route did inline.
 */
export function buildRecordReadback(
  record: EvidenceRecord,
  creator: ReadbackCreator | null,
): Record<string, unknown> {
  return {
    slug: record.slug,
    title: record.title,
    summary: record.summary,
    model: record.model,
    promptHash: record.promptHash,
    promptVisibility: record.promptVisibility,
    verificationStatus: record.verificationStatus,
    consistencyClassification: record.consistencyClassification,
    jurisdiction: record.jurisdiction,
    civicContext: record.civicContext,
    basePackageHash: record.basePackageHash,
    // `listed` and `visibility` are ORTHOGONAL and may legitimately disagree
    // (ADR-0016 §A.1; sprint decision G0-6):
    //
    //   - `visibility` is the CONTENT-DISCLOSURE axis: `sealed` | `public`.
    //   - `listed` is the HOST-DISPLAY axis — does THIS host show the record in
    //     its index? — which §A.1 names as a separate dimension, resolved by
    //     host policy rather than by the node itself.
    //
    // They are separate columns (`visibility` and `is_public`), and a record can
    // be `public` but unlisted — a host declining to index content it still
    // serves. Emitting only `isPublic` invited reading
    // `{visibility: "sealed", isPublic: true}` as a contradiction, or worse as
    // "visibility == public"; `listed` names what the boolean actually is.
    // `isPublic` stays as a read-back ALIAS — same column, same value — because
    // already-shipped clients read it. Both are emitted indefinitely.
    //
    // (`GET /api/evidence/list` ANDs the two: a record appears there only if
    // `is_public` AND its visibility is the public state. That entanglement is
    // existing behavior of the LISTING endpoint — documented accurately here,
    // not changed.)
    listed: record.isPublic,
    isPublic: record.isPublic,
    // SERVED CANONICAL (ADR-0016 §A, P2): normalized through the vocabulary
    // boundary, so a historical row still holding `committed` / `published`
    // reads out as `sealed` / `public` like every other row. One vocabulary on
    // the wire, whichever spelling the column happens to carry — see
    // `./visibility.ts`.
    visibility: fromDbValue(record.visibility),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    creator: creator ?? null,
  };
}
