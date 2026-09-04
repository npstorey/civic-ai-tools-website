/**
 * What a notebook in a signed package says about whether it RAN — read here,
 * once, for every surface that shows it (#401).
 *
 * THREE STATES, NOT TWO. `executed` and `skeleton` are assertions the producer
 * makes: the executed pipeline stamps the first, the skeleton generator stamps
 * the second. A package built before the field existed carries NEITHER, and
 * that is a third thing — an absence. Absence is not one of the assertions, and
 * rendering it as either would be exactly the false precision
 * `docs/design-principles.md` Principle 3 forbids: for two waves `'skeleton'`
 * was reserved with no writer, so a silent notebook could only ever be read as
 * "executed", because that was the only value the vocabulary had ever carried.
 *
 * NEITHER READING IS A FAILURE, and the tiers say so. All three are `normal` —
 * the calm, informational tier the module they come from reserves for "not ok
 * but EXPECTED". A skeleton reproduces the steps without having run them; an
 * older package simply predates the question. Neither is an alarm, and neither
 * may be styled as one.
 *
 * THE COPY IS NOT AUTHORED HERE for the two assertions. `NOTEBOOK_PROVENANCE_
 * SIGNALS` in `../evidence/trust-signal.ts` already carries reviewed
 * label/detail text for both; this module reuses it rather than writing a
 * second wording that can drift. Only the third state's text is written here,
 * because the third state is a READING and not a producer value — putting it in
 * that `Record<NotebookProvenance, …>` would break the total-coverage-by-
 * construction property that record exists to have.
 *
 * WHY THIS MODULE AND NOT `./prompt.ts`. Same reason as `./reproduction-claim.ts`
 * (see its header): `prompt.ts` reaches `../site-config.ts`, which reads
 * non-`NEXT_PUBLIC` environment, and a CLIENT component
 * (`components/evidence/NotebookSection.tsx`) has to read this off a stored
 * notebook. `src/lib/notebook.ts:2-11` records what happens when a server-env
 * module rides into a client bundle. This module imports pure data and types
 * only, so it is safe on both sides — and `src/lib/notebook.ts`, which is
 * bundled into client components, imports the extension key from here.
 *
 * WHAT THIS MODULE DOES NOT DISTINGUISH, stated rather than left to be found.
 * `not_stated` covers two causes and deliberately reads the same for both: a
 * notebook with no `provenance` key (every package published before the field
 * existed), and a `provenance` value outside the canonical vocabulary. The
 * second is emitted by no producer in this repository — the vocabulary is
 * closed and owned in `../evidence/trust-signal.ts` — but the record page does
 * render other adopters' extensions, so it is reachable in principle, and for
 * that case the label is imprecise: something IS stated, and this reader cannot
 * read it. `readReproductionClaim` in `./reproduction-claim.ts` makes the same
 * trade for the same reason and says so in the same place. A fourth state for
 * "stated, unrecognised" is a ruling, not a silent choice.
 */

import {
  NOTEBOOK_PROVENANCE_SIGNALS,
  NOTEBOOK_PROVENANCE_VALUES,
  type NotebookProvenance,
  type TrustSignalDescriptor,
} from '../evidence/trust-signal.ts';

/**
 * The notebook extension key, per Typed Standards §8.7.4.
 *
 * Declared here rather than imported from `./prompt.ts` for the client-safety
 * reason in this file's header; `notebook-provenance-reading.test.ts` pins it
 * equal to `prompt.ts`'s `NOTEBOOK_EXTENSION_KEY`, so the two cannot drift.
 */
export const NOTEBOOK_EXTENSION_KEY = 'org.civicaitools.notebook';

/** The producer's two assertions, plus the honest reading of neither. */
export type NotebookProvenanceState = NotebookProvenance | 'not_stated';

/**
 * One reading: a `TrustSignalDescriptor` — `{ tier, label, detail? }`, the shape
 * `<TrustSignal>` renders — plus which of the three states produced it.
 *
 * It EXTENDS the descriptor rather than restating its members so `detail` keeps
 * exactly the optionality the vocabulary gives it; all three readings carry one
 * today and `notebook-provenance-reading.test.ts` pins that, because the
 * narrative sentence is the load-bearing layer (P5), not an optional flourish.
 */
export interface NotebookProvenanceReading extends TrustSignalDescriptor {
  /** Which of the three. `not_stated` is never one of the producer assertions. */
  state: NotebookProvenanceState;
}

/**
 * The third state's reader-facing text — the only copy this module authors.
 *
 * It states the reading and names the class that produces it WITHOUT asserting
 * that this particular package belongs to it (P3: no false precision), and it
 * says in plain words that an absence is not a failure, because a reader who
 * has just been shown a notebook full of code will otherwise supply their own
 * reason for the silence.
 */
export const NOTEBOOK_PROVENANCE_NOT_STATED_SIGNAL: TrustSignalDescriptor = {
  tier: 'normal',
  label: 'Whether this notebook ran is not stated',
  detail:
    'Nothing in the package says either way, as in a package published before notebooks recorded this. An absence, not a failure.',
};

/**
 * Read the notebook extension's `provenance` value — the object at
 * `notebook.metadata.extensions["org.civicaitools.notebook"]`, or nothing.
 *
 * Takes `unknown` on purpose: what reaches this comes out of stored package
 * bytes that are never regenerated, so every shape a past producer could have
 * written has to arrive here without throwing.
 */
export function readNotebookProvenance(extension: unknown): NotebookProvenanceReading {
  const stated =
    extension !== null && typeof extension === 'object'
      ? (extension as Record<string, unknown>).provenance
      : undefined;
  // Matched against the canonical vocabulary rather than against literals, so a
  // value added there is read here without a second edit.
  const asserted: NotebookProvenance | undefined = NOTEBOOK_PROVENANCE_VALUES.find(
    (value) => value === stated,
  );
  if (asserted === undefined) {
    return { state: 'not_stated', ...NOTEBOOK_PROVENANCE_NOT_STATED_SIGNAL };
  }
  return { state: asserted, ...NOTEBOOK_PROVENANCE_SIGNALS[asserted] };
}

/**
 * The same reading taken from a whole notebook — what every rendering surface
 * actually holds, since the record page passes the stored notebook straight
 * through (`renderPkg.extensions["org.civicaitools.notebook"]` IS the notebook,
 * and the provenance stamp is nested in ITS `metadata.extensions`).
 */
export function readNotebookProvenanceOfNotebook(notebook: unknown): NotebookProvenanceReading {
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
  return readNotebookProvenance(extension);
}
