/**
 * One-time backfill (civic-ai-tools-website#119 P1 / D2): populate
 * `base_package_rekor_entry_body` for evidence rows published before the column
 * existed, so their Rekor inclusion proof can be verified OFFLINE (no re-fetch).
 *
 * SELF-VALIDATING — a row is only written if the re-fetched entry body actually
 * folds to a verified inclusion proof:
 *   - If the row already stores a REAL proof (audit path + checkpoint), the fetched
 *     body MUST fold to THAT stored proof before we trust/write it. This is the
 *     guard: we never store a body that doesn't match what we already committed to.
 *   - If the row stored an empty `{}` proof (early `publishToRekor` wrote
 *     `… || {}`), there's nothing to fold against, so we validate the body against
 *     the entry's FRESH proof from Rekor and refresh both columns together.
 * A row whose body fails to fold is SKIPPED and reported — never written.
 *
 * Idempotent: rows that already have a body which still folds are left untouched.
 *
 * DRY RUN by default (writes nothing, reports the plan). Pass `--apply` to write.
 * Migration 0011 (the nullable column) must already be applied.
 *
 *   Dry run:  op run --env-file=.env.local -- npx tsx scripts/backfill-rekor-entry-body.ts
 *   Apply:    op run --env-file=.env.local -- npx tsx scripts/backfill-rekor-entry-body.ts --apply
 */

import { eq, isNotNull } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { evidenceRecords } from '../src/lib/db/schema';
import {
  verifyRekorInclusion,
  parseInclusionProof,
  type RekorInclusionProof,
  type RekorInclusionResult,
} from '@typedstandards/verify-core';

const APPLY = process.argv.includes('--apply');

interface RekorEntry {
  body?: string;
  verification?: { inclusionProof?: RekorInclusionProof };
}

// A proof is usable only if it carries an audit path + a signed checkpoint. The
// STORED column (a JSON string) is parsed with verify-core's shared
// `parseInclusionProof` (#119 P4) — the same guard the verify route and browser
// verify-flow use. `isRealProof` is its object-level twin, for validating the FRESH
// proof object pulled from a re-fetched Rekor entry (already parsed, not a string).
function isRealProof(proof: unknown): proof is RekorInclusionProof {
  return (
    !!proof &&
    typeof proof === 'object' &&
    Array.isArray((proof as RekorInclusionProof).hashes) &&
    typeof (proof as RekorInclusionProof).checkpoint === 'string'
  );
}

async function fetchRekorEntry(entryId: string): Promise<RekorEntry | null> {
  const res = await fetch(`https://rekor.sigstore.dev/api/v1/log/entries/${entryId}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, RekorEntry>;
  return json[entryId] ?? Object.values(json)[0] ?? null;
}

type Outcome =
  | { kind: 'skip-has-body' }
  | { kind: 'skip-no-entry' }
  | { kind: 'skip-no-body' }
  | { kind: 'skip-no-proof' }
  | { kind: 'skip-fold-failed'; result: RekorInclusionResult }
  | { kind: 'write-body' }
  | { kind: 'write-body-and-refresh-proof' };

async function planRow(row: {
  id: string;
  slug: string;
  basePackageRekorEntryId: string | null;
  basePackageRekorEntryBody: string | null;
  basePackageRekorInclusionProof: string | null;
}): Promise<{ outcome: Outcome; body?: string; proofJson?: string }> {
  const entryId = row.basePackageRekorEntryId;
  if (!entryId) return { outcome: { kind: 'skip-no-proof' } };

  const entry = await fetchRekorEntry(entryId);
  if (!entry) return { outcome: { kind: 'skip-no-entry' } };
  if (typeof entry.body !== 'string') return { outcome: { kind: 'skip-no-body' } };

  const storedProof = parseInclusionProof(row.basePackageRekorInclusionProof);
  const freshProof = isRealProof(entry.verification?.inclusionProof)
    ? entry.verification!.inclusionProof!
    : null;

  // Idempotent: a row that already has a body which still folds is left as-is.
  if (row.basePackageRekorEntryBody && storedProof) {
    const check = verifyRekorInclusion(row.basePackageRekorEntryBody, storedProof);
    if (check.inclusionVerified) return { outcome: { kind: 'skip-has-body' } };
  }

  if (storedProof) {
    // Validate the fetched body against the ALREADY-STORED proof before writing.
    const result = verifyRekorInclusion(entry.body, storedProof);
    if (!result.inclusionVerified) return { outcome: { kind: 'skip-fold-failed', result } };
    return { outcome: { kind: 'write-body' }, body: entry.body };
  }

  // Empty/missing stored proof: validate the body against the fresh proof and
  // refresh both columns together.
  if (!freshProof) return { outcome: { kind: 'skip-no-proof' } };
  const result = verifyRekorInclusion(entry.body, freshProof);
  if (!result.inclusionVerified) return { outcome: { kind: 'skip-fold-failed', result } };
  return {
    outcome: { kind: 'write-body-and-refresh-proof' },
    body: entry.body,
    proofJson: JSON.stringify(freshProof),
  };
}

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: evidenceRecords.id,
      slug: evidenceRecords.slug,
      basePackageRekorEntryId: evidenceRecords.basePackageRekorEntryId,
      basePackageRekorEntryBody: evidenceRecords.basePackageRekorEntryBody,
      basePackageRekorInclusionProof: evidenceRecords.basePackageRekorInclusionProof,
    })
    .from(evidenceRecords)
    .where(isNotNull(evidenceRecords.basePackageRekorEntryId));

  console.log(`[backfill] ${rows.length} rows with a Rekor entry id. ${APPLY ? 'APPLY' : 'DRY RUN'}.`);
  const tally: Record<string, number> = {};
  let written = 0;

  for (const row of rows) {
    const { outcome, body, proofJson } = await planRow(row);
    tally[outcome.kind] = (tally[outcome.kind] ?? 0) + 1;

    if (outcome.kind === 'skip-fold-failed') {
      console.warn(`[backfill] FOLD FAILED ${row.slug} (${row.basePackageRekorEntryId}) — ${outcome.result.reason}; NOT writing.`);
      continue;
    }
    if ((outcome.kind === 'write-body' || outcome.kind === 'write-body-and-refresh-proof') && body) {
      console.log(`[backfill] ${APPLY ? 'WRITE' : 'would write'} ${outcome.kind} → ${row.slug}`);
      if (APPLY) {
        await db
          .update(evidenceRecords)
          .set(
            outcome.kind === 'write-body-and-refresh-proof' && proofJson
              ? { basePackageRekorEntryBody: body, basePackageRekorInclusionProof: proofJson }
              : { basePackageRekorEntryBody: body },
          )
          .where(eq(evidenceRecords.id, row.id));
        written += 1;
      }
    }
  }

  console.log('[backfill] summary:', tally);
  console.log(`[backfill] ${APPLY ? `wrote ${written} rows` : 'dry run — nothing written'}.`);
  if (tally['skip-fold-failed']) {
    console.warn(`[backfill] ${tally['skip-fold-failed']} row(s) failed to fold — investigate before trusting those entries.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exit(1);
  });
