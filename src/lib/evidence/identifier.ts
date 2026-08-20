import { evidenceRecords } from '../db/schema.ts';

type EvidenceRecord = typeof evidenceRecords.$inferSelect;

/**
 * A base-package hash is the hex SHA-256 of the canonical envelope: exactly 64
 * hex chars. Case-INSENSITIVE (`/i`): stored digests are lowercase hex, but a
 * bare hash pasted by a user — or embedded in an older link/badge — may arrive
 * upper- or mixed-case, and it must still resolve (civic-ai-tools-website#116
 * durable backend half).
 */
export const IDENTIFIER_HASH_RE = /^[0-9a-f]{64}$/i;

export interface ResolvedIdentifier {
  /** Which `evidence_records` column the identifier matches. */
  by: 'basePackageHash' | 'slug';
  /**
   * The normalized match value. The hash form is lowercased so the match is
   * case-insensitive yet stays sargable against a plain btree index (stored
   * digests are already lowercase hex, so lowercasing the INPUT — rather than
   * `lower(column)` — keeps the index usable). The slug form passes through
   * verbatim (slugs are case-sensitive and unique).
   */
  value: string;
  /**
   * True when the identifier is a base-package hash. A re-published package can
   * produce multiple rows sharing one `basePackageHash` (identical immutable
   * blob, a separate signing run), so hash callers order by `createdAt asc` and
   * take the first (canonical) row. Slugs are unique — at most one row.
   */
  isHash: boolean;
}

/**
 * Classify a `[slug]`-segment identifier as a base-package hash or a record
 * slug, and return the normalized DB lookup for it. This is the single seam that
 * makes the two identifier forms interchangeable for a public read.
 *
 * Precedence — hash SHAPE wins: a 64-hex string is matched as a hash, anything
 * else as a slug. This is unambiguous in this data model because every slug
 * carries a human title portion plus a `-<6hex>` suffix
 * (e.g. `noise-trends-in-nyc-last-week-e84455`), so a real slug always contains
 * a hyphen and non-hex title characters and is never a bare 64-hex string —
 * it cannot collide with the hash form.
 */
export function classifyIdentifier(identifier: string): ResolvedIdentifier {
  if (IDENTIFIER_HASH_RE.test(identifier)) {
    return { by: 'basePackageHash', value: identifier.toLowerCase(), isHash: true };
  }
  return { by: 'slug', value: identifier, isHash: false };
}

/**
 * The commitment endpoint's public-visibility gate, factored out so it is applied
 * IDENTICALLY however the record was addressed (by hash or by slug). Returns the
 * 404 error message when the record must not be served publicly, or `null` when
 * it may be.
 *
 * This is the load-bearing authorization invariant of the hash-lookup fix:
 * addressing a record by hash grants NO more access than addressing it by slug.
 * A record with no published base package, or one that is not public (private /
 * unlisted), is unreachable by EITHER form. Sealed-visibility redaction is
 * handled separately by the route (the commitment is public by design — the hash
 * is already on the transparency log — but content and location are redacted).
 */
export function commitmentAccessError(
  record: Pick<EvidenceRecord, 'basePackageHash' | 'isPublic'>,
): string | null {
  // A row with no base-package hash never completed publishing — there are no
  // proofs to commit to. (A bare-hash lookup could never have matched it either.)
  if (!record.basePackageHash) {
    return 'No published record package for this identifier';
  }
  // Non-public records are not exposed — mirrors the slug read-back. The public
  // flag is independent of withdrawal (withdrawn-but-public is still served).
  if (!record.isPublic) {
    return 'Record not found';
  }
  return null;
}
