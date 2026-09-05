/**
 * What the RECORD PAGE is entitled to claim about re-executing a notebook
 * (#416).
 *
 * NOT THE SAME CLAIM AS `./reproduction-claim.ts`, and the two are easy to
 * confuse. That one is a sentence the notebook writes about ITSELF, inside its
 * own cover cell, parsed back out of the document — "This notebook re-runs a
 * live request in 1 of its 4 analysis steps." This one is a sentence the PAGE
 * writes about the notebook, above the download button, in the record page's
 * section E. Different author, different surface, different failure mode.
 *
 * WHY IT IS A FUNCTION AND NOT JSX. It was JSX: the sentence sat in
 * `app/(app)/evidence/[slug]/page.tsx`, rendered unconditionally whenever the
 * notebook extension existed, directly above `<NotebookSection>` — which since
 * #401 may state on the very next line that the notebook never ran, or that
 * whether it ran is not stated. A page contradicting itself in two adjacent
 * sentences.
 *
 * It could not be tested where it stood. `npm test` globs `src/**` + `/*.test.ts`
 * and `scripts/**` + `/*.test.mjs`; `.test.tsx` is not in the glob and this
 * repository has zero `.test.tsx` files — a convention, not an oversight, so
 * nothing is being silently skipped. A claim rendered in JSX therefore has no
 * runnable assertion over it at all. Lifting the CHOICE out of the markup is
 * what makes one possible, and `reproduction-assertion.test.ts` drives all three
 * readings.
 *
 * THE RULE. The claim is made only where the package asserts the notebook was
 * executed. `skeleton` and `not_stated` get nothing — not a weaker sentence, not
 * a hedge — because absence is absence (`docs/design-principles.md` Principle 3)
 * and `NotebookSection` already states the reading directly below, in the
 * vocabulary that owns it. Saying less here is the whole point: the sentence as
 * written read "not stated" as "executed", which is the one reading the three-
 * state vocabulary exists to prevent.
 *
 * THE POPULATION THIS LANDS ON, measured over production on 2026-09-05: of 34
 * published records, 25 carry a notebook extension; of those, 1 reads
 * `executed`, 24 state no provenance at all, and 0 read `skeleton`. So this
 * sentence was standing above 24 notebooks whose provenance is unknown, and
 * after this change stands above 1.
 *
 * WHY THIS MODULE AND NOT THE PAGE'S OWN FILE. Same client-safety and testability
 * constraint as `./reproduction-claim.ts` and `./notebook-provenance-reading.ts`
 * — see their headers. This module imports one function from the reader beside
 * it and nothing else.
 */

import { readNotebookProvenanceOfNotebook } from './notebook-provenance-reading.ts';

/**
 * The one form of the claim. Owned here so `reproduction-assertion.test.ts` can
 * assert it appears exactly once in the tree: a second copy in JSX is how the
 * page came to make it unconditionally in the first place.
 */
export const NOTEBOOK_REPRODUCTION_ASSERTION =
  'Re-executing this notebook against the documented runtime + stable upstream data reproduces section F (Typed Standards §8.7.3).';

/**
 * The reproduction claim this notebook entitles its page to make, or `null` for
 * none.
 *
 * Takes `unknown` on purpose, like the reader it delegates to: what reaches this
 * comes out of stored package bytes that are never regenerated, so every shape a
 * past producer could have written has to arrive here without throwing.
 */
export function reproductionAssertionFor(notebook: unknown): string | null {
  const ran = readNotebookProvenanceOfNotebook(notebook);
  if (ran.state === 'executed') return NOTEBOOK_REPRODUCTION_ASSERTION;
  return null;
}
