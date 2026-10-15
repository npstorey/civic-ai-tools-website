/**
 * The citation text for a published record: one builder for both places a
 * reader copies it from (LAYOUT-W1, ruling D3).
 *
 * RED-COMMIT STUB: typed, returns nothing. The fix fills it in.
 */

export interface RecordCitationInput {
  title: string;
  creatorName: string;
  /** ISO timestamp of the record (its row's `createdAt`). */
  createdAt: string;
  slug: string;
  /** Instance display name (#217); `null` when the instance has not named itself. */
  brandName: string | null;
  /** Origin the record is read at, e.g. `https://example.org`; `null` for a relative URL. */
  origin: string | null;
}

export interface RecordCitation {
  label: string;
  text: string;
}

export function buildRecordCitations(input: RecordCitationInput): RecordCitation[] {
  void input;
  return [];
}
