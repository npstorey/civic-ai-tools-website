/**
 * The record page does not assert reproduction over a notebook that may never
 * have run (#416, Wave N10 P6).
 *
 * THE DEFECT. `app/(app)/evidence/[slug]/page.tsx` rendered, unconditionally
 * whenever the notebook extension existed:
 *
 *     Re-executing this notebook against the documented runtime + stable
 *     upstream data reproduces section F (Typed Standards §8.7.3).
 *
 * directly above `<NotebookSection>`, which since #401 may state on the very
 * next line that the notebook never ran, or that whether it ran is not stated.
 * A record page contradicting itself in two adjacent sentences — and the
 * contradiction lands on almost every record: measured over production on
 * 2026-09-05, of 34 published records 25 carry a notebook extension, of which 1
 * reads `executed`, 24 state nothing at all, and 0 read `skeleton`.
 *
 * "Not stated" read as "executed" is the exact failure the three-state
 * vocabulary exists to prevent (`notebook-provenance-reading.ts`'s header, and
 * `docs/design-principles.md` Principle 3).
 *
 * WHY THE FIX HAD TO MOVE THE SENTENCE FIRST. `npm test` globs
 * `src/**` + `/*.test.ts` and `scripts/**` + `/*.test.mjs`. `.test.tsx` is not
 * in the glob and this repository has zero `.test.tsx` files, so a claim
 * rendered in JSX has no runnable assertion over it — not a skipped one, none
 * at all. The choice is now a pure function and this file drives it.
 *
 * WHAT IS OUT OF SCOPE HERE, stated so no reader infers otherwise: the
 * "Skeleton notebook (not executed)" copy `NotebookSection` shows is a separate
 * ruling and is not touched by this phase. This file asserts only what the PAGE
 * is entitled to claim above the download button.
 *
 * FIXTURES. All three readings, built from the vocabulary that owns them rather
 * than from literals, and the third — a notebook with no `provenance` key at all
 * — is the one that matters: it is 24 of the 25 live records, and it is the case
 * a careless fixture omits because the other two are the ones with names.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  NOTEBOOK_REPRODUCTION_ASSERTION,
  reproductionAssertionFor,
} from './reproduction-assertion.ts';
import {
  NOTEBOOK_EXTENSION_KEY,
  readNotebookProvenanceOfNotebook,
} from './notebook-provenance-reading.ts';
import {
  NOTEBOOK_PROVENANCE_EXECUTED,
  NOTEBOOK_PROVENANCE_SKELETON,
} from '../evidence/trust-signal.ts';

/** A stored notebook carrying the producer's provenance stamp, or none. */
function notebookStamped(provenance: string | undefined): unknown {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      extensions: {
        [NOTEBOOK_EXTENSION_KEY]: provenance === undefined ? {} : { provenance },
      },
    },
    cells: [{ cell_type: 'markdown', source: ['## How to use this notebook'] }],
  };
}

/** The 24-record majority: published before the field existed, no stamp at all. */
const NOTEBOOK_NO_PROVENANCE_KEY = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells: [{ cell_type: 'markdown', source: ['## How to use this notebook'] }],
};

test('#416: the fixtures really read as three different states', () => {
  // Without this, every assertion below could be satisfied by three inputs that
  // read the same way — the converse of a red that was never shown.
  assert.equal(readNotebookProvenanceOfNotebook(notebookStamped(NOTEBOOK_PROVENANCE_EXECUTED)).state, 'executed');
  assert.equal(readNotebookProvenanceOfNotebook(notebookStamped(NOTEBOOK_PROVENANCE_SKELETON)).state, 'skeleton');
  assert.equal(readNotebookProvenanceOfNotebook(NOTEBOOK_NO_PROVENANCE_KEY).state, 'not_stated');
  assert.equal(readNotebookProvenanceOfNotebook(notebookStamped(undefined)).state, 'not_stated');
});

test('#416: an executed notebook entitles the page to the reproduction claim', () => {
  assert.equal(
    reproductionAssertionFor(notebookStamped(NOTEBOOK_PROVENANCE_EXECUTED)),
    NOTEBOOK_REPRODUCTION_ASSERTION,
    'the claim must still be made where the package asserts the notebook ran — a fix ' +
      'that removes the sentence everywhere is not this fix',
  );
});

test('#416: a skeleton notebook does not', () => {
  assert.equal(
    reproductionAssertionFor(notebookStamped(NOTEBOOK_PROVENANCE_SKELETON)),
    null,
    'the page asserts that re-executing this notebook reproduces section F, above a ' +
      'notebook whose own package says it was never executed',
  );
});

test('#416: a notebook that states no provenance does not — the 24-record majority', () => {
  // The case that matters. `not_stated` covers a package published before the
  // field existed and a value outside the vocabulary, and reads the same for
  // both: something is unknown, and unknown is not "executed".
  assert.equal(
    reproductionAssertionFor(NOTEBOOK_NO_PROVENANCE_KEY),
    null,
    'the page asserts reproduction over a notebook whose package says nothing about ' +
      'whether it ever ran — reading an absence as an assertion',
  );
  assert.equal(reproductionAssertionFor(notebookStamped(undefined)), null, 'extension present, stamp absent');
  assert.equal(
    reproductionAssertionFor(notebookStamped('partially-executed')),
    null,
    'a provenance value this reader does not recognise is not an assertion that it ran',
  );
  // And the shapes stored bytes can actually take, none of which may throw.
  for (const shape of [null, undefined, {}, [], 'a notebook', 42]) {
    assert.equal(reproductionAssertionFor(shape), null, `unreadable shape: ${JSON.stringify(shape)}`);
  }
});

test('#416: the claim exists exactly once, and the record page reads it from there', () => {
  // A guard, not a tidiness check. The sentence was JSX, which is why it could
  // be made unconditionally with nothing able to fail; a second copy anywhere is
  // that state returning, and the function above would keep passing over it.
  const repoRoot = new URL('../../..', import.meta.url).pathname;
  const tracked = execFileSync('git', ['ls-files', '-z', '--full-name'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter((f) => /\.(c|m)?[jt]sx?$/.test(f) && !/\.test\.(c|m)?[jt]sx?$/.test(f));
  assert.ok(tracked.length > 50, 'the scan found almost no source files — it has stopped measuring');

  const carriers = tracked.filter((file) => {
    try {
      // The FULL sentence, and two looser probes are why. `reproduces section F`
      // matches `components/notebook/ChatNotebookOutput.tsx`, whose comment
      // records the #371 history of a claim it no longer makes;
      // `documented runtime + stable upstream data` additionally matches
      // `lib/evidence/packager.ts`, which describes what a record package is
      // for. Neither renders the claim. What separates making a claim from
      // writing about one is making it in full, so that is the needle.
      return readFileSync(repoRoot + file, 'utf8').includes(NOTEBOOK_REPRODUCTION_ASSERTION);
    } catch {
      return false; // tracked but deleted from the working tree
    }
  });
  assert.deepEqual(
    carriers,
    ['src/lib/notebook-author/reproduction-assertion.ts'],
    'the reproduction claim is written somewhere other than the module that owns it — ' +
      'a copy in JSX is the shape this phase removed, and it cannot be asserted over',
  );

  const page = readFileSync(repoRoot + 'src/app/(app)/evidence/[slug]/page.tsx', 'utf8');
  assert.match(
    page,
    /reproductionAssertionFor/,
    'the record page does not read the claim from the module that decides it',
  );
});
