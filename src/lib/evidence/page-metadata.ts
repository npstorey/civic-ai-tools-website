// Machine-readable metadata for the evidence detail page: the schema.org
// JSON-LD block and the Highwire-Press citation tags. Pure shape-builders,
// extracted from `src/app/(app)/evidence/[slug]/page.tsx` so the SHAPE is
// unit-testable — the page itself is a server component that reaches for the
// database and `next/headers`, so nothing in it can be asserted directly.
//
// The reason this file exists at all is #256: what these two blocks OMIT is
// load-bearing, and an omission with no test is one refactor away from being
// "restored" as an oversight. See the no-publication-date note below.

/**
 * ## Why neither builder emits a publication date (#256)
 *
 * `evidence_records` stores no publication timestamp. The only two timestamps
 * on the row are `created_at` (row insert, `defaultNow()`) and `updated_at`.
 *
 * A record may be sealed first and published later — a supported flow with its
 * own endpoint, `POST /api/evidence/[slug]/publish`, which writes `visibility`
 * and `updated_at` and nothing else. For such a record `created_at` is the SEAL
 * time, strictly earlier than publication. And a record published atomically at
 * creation is not distinguishable from a sealed-then-published one by anything
 * on the row, so there is no subset of records for which `created_at` could be
 * emitted as a publication date truthfully.
 *
 * `datePublished` and `citation_date` are the exact fields search engines,
 * citation managers (Zotero), and scholarly indexes read to date a work.
 * Emitting seal time there is a false claim in machine-readable form, on a
 * project whose premise is independently verifiable publishing.
 *
 * So the field is absent, unconditionally and on purpose. This is the honest
 * omission #258 established for URLs, applied to dates: no signal, no
 * assertion — and it matches `docs/design-principles.md` Principle 3, "if we
 * don't actually have a signal, don't show one."
 *
 * DO NOT restore it, and DO NOT substitute `dateCreated` — that decision was
 * made deliberately, not missed. A real publication timestamp is tracked
 * separately; the raw material for it already exists off-row as the signed
 * `releasedAt` on the `attestation/publishes/v1` node. Wiring that in is the
 * fix, not reaching for `created_at`.
 */

export interface EvidencePageMetadataInput {
  /** The record's title. */
  title: string;
  /** Display name of the record's creator; caller supplies its own fallback. */
  creatorName: string;
  /**
   * Canonical public URL for this record, or `null` when this instance has
   * declared no origin (#258 — honest omission, never another deployment's
   * URL). Null omits the URL-bearing key entirely.
   */
  url: string | null;
}

export interface EvidenceJsonLdInput extends EvidencePageMetadataInput {
  /** The record's summary, used as the Dataset description. */
  summary: string;
}

/**
 * schema.org JSON-LD for one evidence record.
 *
 * Emitted unguarded on every non-sealed evidence page, so it is the
 * highest-reach metadata surface the record has. Carries no date — see the
 * no-publication-date note above.
 */
export function buildEvidenceJsonLd(
  input: EvidenceJsonLdInput,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: input.title,
    description: input.summary,
    creator: { '@type': 'Person', name: input.creatorName },
    ...(input.url ? { url: input.url } : {}),
  };
}

/**
 * Highwire-Press citation tags for one evidence record, shaped for the
 * `other:` block of a Next.js `Metadata` object.
 *
 * These are what Zotero and Google Scholar read. `citation_date` IS a
 * publication-date assertion in that vocabulary, so it is absent for the same
 * reason `datePublished` is — see the no-publication-date note above.
 */
export function buildEvidenceCitationTags(
  input: EvidencePageMetadataInput,
): Record<string, string> {
  return {
    citation_title: input.title,
    citation_author: input.creatorName,
    ...(input.url ? { citation_public_url: input.url } : {}),
  };
}
