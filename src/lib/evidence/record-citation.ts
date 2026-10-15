/**
 * The citation text for a published record: one builder for both places a
 * reader copies it from (LAYOUT-W1, ruling D3).
 *
 * The record page shows a collapsed "Citation" block beneath the answer
 * (`CitationBlock`), and the Cite button in Actions opens a modal
 * (`CitePopover` in `EvidenceActions.tsx`). Both call this, so the two cannot
 * state different text for the same record. The formats are the ones the
 * modal wrote before this builder existed, word for word.
 *
 * THE DATE IS THE UTC DATE. The block is rendered on the server and hydrated in
 * the browser, and the modal is rendered in the browser only. A date formatted
 * in each place's local time zone reads one day apart for a record created near
 * midnight UTC: a hydration mismatch in the block, and a modal that disagrees
 * with it. Stated in UTC, all three agree, and agree with the page's byline on
 * a host that runs in UTC.
 *
 * THE URL is the canonical `/records/<slug>` address (civic-ai-tools#160 P5,
 * spec Appendix J): citations are copied into documents that outlive the app,
 * and `/evidence/<slug>` stays served, so a citation already in circulation
 * keeps resolving. `origin` is the origin the record is read at; the caller
 * supplies it (the block from the request host, the modal from
 * `window.location`), and `null` gives the relative address.
 *
 * The publisher is the instance's display name (#217), or none: an instance
 * that has not named itself publishes a "Record Package" credited to no one
 * (#259 P4, D8), since this text travels into other people's documents.
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
  const { title, creatorName, createdAt, slug, brandName, origin } = input;
  const date = new Date(createdAt);
  const year = date.getUTCFullYear();
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  const url = origin === null ? `/records/${slug}` : `${origin}/records/${slug}`;
  return [
    {
      label: 'Plain text',
      text: `${creatorName} (${year}). "${title}." ${brandName === null ? '' : `${brandName} `}Record Package. ${url}. Published: ${dateStr}.`,
    },
    {
      label: 'For deliberative process reference',
      text: `Record: ${title} [Verified: ${dateStr}] ${url}`,
    },
  ];
}
