/**
 * What a notebook in a signed package says about the check that was run on it
 * before it was signed — read here, once, for every surface that shows it
 * (#400).
 *
 * DISCLOSURE, NOT VALIDATION. `docs/design-principles.md` Principle 1 governs
 * this whole module. The verdict is a statement about the DOCUMENT — whether
 * what it says about itself matches the cells beneath it — and never about
 * whether the analysis is right. Every string below is written so a reader
 * cannot come away thinking a flagged notebook means a wrong answer, or that a
 * clean one means a right one. D1 was ruled **A**: nothing here refuses a
 * publish and nothing here is a failure banner. The reader is told what was
 * found and decides what it is worth.
 *
 * FOUR OUTCOMES, ONE OF WHICH IS SILENCE.
 *
 *   - `issues_found`  — the check ran and flagged things. `attention`, the
 *                       amber tier the vocabulary reserves for "worth a closer
 *                       look, not proven bad". Never `alarm`: that tier is for
 *                       a cryptographic integrity failure, and a notebook whose
 *                       cover text overstates itself is not one.
 *   - `checked_clean` — the check ran and flagged nothing. `normal`, the calm
 *                       informational tier.
 *   - `not_recorded`  — the notebook says it was EXECUTED and the package
 *                       carries no verdict, as every package published before
 *                       this field existed does. An absence, not a failure —
 *                       and named, because otherwise it looks exactly like the
 *                       clean reading (#401's lesson, one level up).
 *   - `null`          — nothing to disclose, and no row is rendered. A skeleton
 *                       is never validated (`validateNotebookProvenance`
 *                       accepts only `"executed"`), so it has no verdict to
 *                       lack; a notebook that states nothing about whether it
 *                       ran is already reported by the provenance row above.
 *                       Reporting an absent check on documents no check was
 *                       ever going to run is the false precision Principle 3
 *                       forbids, in the shape of noise on every skeleton
 *                       package in the registry.
 *
 * WHY `checked_clean` RENDERS AT ALL. It would be defensible to show nothing
 * for a clean verdict — a clean check needs no chrome. It is shown because the
 * alternative collapses it into `not_recorded`: silence would mean both "we
 * checked and found nothing" and "no check is recorded", and a reader would
 * read the second as the first. That is exactly the shape #401 found, where a
 * value reserved with no writer made silence readable as only one thing.
 *
 * WHY THE COPY IS AUTHORED HERE and not in `../evidence/trust-signal.ts` with
 * `NOTEBOOK_PROVENANCE_SIGNALS`. That module holds `Record<Value, Descriptor>`
 * maps whose total coverage is checked by construction, and two of the three
 * labels below carry a COUNT — they are derived, not a fixed vocabulary, so
 * they cannot live in such a map. The one static descriptor is kept here beside
 * them rather than split across two modules.
 *
 * CLIENT SAFETY, same constraint as `./notebook-provenance-reading.ts` (see its
 * header): `components/evidence/NotebookSection.tsx` is a client component and
 * has to read this off a stored notebook, so this module imports pure data and
 * types only. `./validate.ts` reaches `./prompt.ts` and therefore
 * `../site-config.ts`, which reads non-`NEXT_PUBLIC` environment — its import
 * here is `import type` and is erased.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not re-run the validator. The verdict
 * it reads was computed by the producer over the document as it stood, and a
 * reader who wants to check it has the notebook: the whole point of carrying it
 * is that a package published in the past can still be read by a validator that
 * has since changed its mind. A malformed `validation` value — anything that is
 * not `{ ok: boolean, issues: [{path, message}] }` — is read as no verdict at
 * all rather than coerced, because a shape we cannot read is not a check we can
 * report the result of.
 */

import type { TrustSignalDescriptor } from '../evidence/trust-signal.ts';
import type { ValidationIssue, ValidationResult } from './validate.ts';
import {
  NOTEBOOK_EXTENSION_KEY,
  readNotebookProvenance,
} from './notebook-provenance-reading.ts';

/** The three readings that produce a row. `null` is the fourth outcome. */
export type NotebookValidationState = 'checked_clean' | 'issues_found' | 'not_recorded';

/**
 * One reading: a `TrustSignalDescriptor` — `{ tier, label, detail? }`, the shape
 * `<TrustSignal>` renders — plus which reading produced it and the issues a
 * surface may expose on demand (Principle 8: collapse in the skim, expose on
 * click). `issues` is empty for every state but `issues_found`.
 */
export interface NotebookValidationReading extends TrustSignalDescriptor {
  state: NotebookValidationState;
  issues: ValidationIssue[];
}

/**
 * The reader-facing text.
 *
 * `Checked against its own steps` is the user-language name for what the five
 * validators actually do (Principle 9): they compare what the document claims
 * — that it was executed, that its steps re-run live requests, the count its
 * cover states — against the cells underneath. "Validation", "schema" and
 * "extension" are implementation words and appear nowhere a reader looks.
 */
export const NOTEBOOK_VALIDATION_NOT_RECORDED_SIGNAL: TrustSignalDescriptor = {
  tier: 'normal',
  label: 'Whether this notebook was checked against its own steps is not stated',
  detail:
    'The package records no result for that check, as in a package published before notebooks carried one. An absence, not a failure.',
};

export const NOTEBOOK_VALIDATION_CLEAN_SIGNAL: TrustSignalDescriptor = {
  tier: 'normal',
  label: 'Checked against its own steps: nothing flagged',
  detail:
    'Before this notebook was signed, what it says about itself was compared with the cells beneath it, and nothing was flagged. That is a check on the document, not on whether the analysis is right.',
};

/** The flagged label carries a count, so it is built rather than looked up. */
export function notebookValidationFlaggedSignal(count: number): TrustSignalDescriptor {
  return {
    tier: 'attention',
    label: `Checked against its own steps: ${count} ${count === 1 ? 'thing' : 'things'} flagged`,
    detail:
      'Before this notebook was signed, what it says about itself was compared with the cells beneath it, and what did not line up was recorded and published with it. It describes the document, not whether the analysis is right.',
  };
}

function readIssues(value: unknown): ValidationIssue[] | null {
  if (!Array.isArray(value)) return null;
  const issues: ValidationIssue[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') return null;
    const { path, message } = entry as Record<string, unknown>;
    if (typeof path !== 'string' || typeof message !== 'string') return null;
    issues.push({ path, message });
  }
  return issues;
}

/**
 * Read a `validation` value off a notebook extension object.
 *
 * Takes `unknown` on purpose, for the reason `readNotebookProvenance` does:
 * what reaches this comes out of stored package bytes that are never
 * regenerated, so every shape a past or foreign producer could have written has
 * to arrive here without throwing. Returns `null` when there is no readable
 * verdict — the caller decides whether that absence is worth a row.
 */
export function readNotebookValidation(extension: unknown): NotebookValidationReading | null {
  const stated =
    extension !== null && typeof extension === 'object'
      ? (extension as Record<string, unknown>).validation
      : undefined;
  if (stated === null || typeof stated !== 'object') return null;
  const { ok, issues } = stated as Record<string, unknown>;
  if (typeof ok !== 'boolean') return null;
  const readable = readIssues(issues);
  if (readable === null) return null;

  // `ok` is the producer's own verdict and is not recomputed from the issue
  // count: a producer that reports `ok: false` with no issues has said
  // something, and re-deriving `ok` here would silently overrule it.
  if (!ok) {
    return { state: 'issues_found', issues: readable, ...notebookValidationFlaggedSignal(readable.length) };
  }
  return { state: 'checked_clean', issues: [], ...NOTEBOOK_VALIDATION_CLEAN_SIGNAL };
}

/**
 * The same reading taken from a whole notebook — what every rendering surface
 * actually holds, since the record page passes the stored notebook straight
 * through (`renderPkg.extensions["org.civicaitools.notebook"]` IS the notebook,
 * and the verdict is nested in ITS `metadata.extensions`, beside the provenance
 * stamp).
 *
 * Returns `null` for everything with nothing to disclose — see the header's
 * fourth outcome. The provenance reading is what separates "executed, and no
 * verdict was recorded" from "no verdict was ever going to exist".
 */
export function readNotebookValidationOfNotebook(notebook: unknown): NotebookValidationReading | null {
  const metadata =
    notebook !== null && typeof notebook === 'object'
      ? (notebook as { metadata?: unknown }).metadata
      : undefined;
  const extensions =
    metadata !== null && typeof metadata === 'object'
      ? (metadata as { extensions?: unknown }).extensions
      : undefined;
  const extension =
    extensions !== null && typeof extensions === 'object'
      ? (extensions as Record<string, unknown>)[NOTEBOOK_EXTENSION_KEY]
      : undefined;

  const verdict = readNotebookValidation(extension);
  if (verdict !== null) return verdict;
  if (readNotebookProvenance(extension).state !== 'executed') return null;
  return { state: 'not_recorded', issues: [], ...NOTEBOOK_VALIDATION_NOT_RECORDED_SIGNAL };
}

/** Re-exported so a caller reading a verdict does not also import validate.ts. */
export type { ValidationIssue, ValidationResult };
