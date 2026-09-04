// P3 red instrument, Wave N10 (#409, #400) — criterion 5, in D1's shape (A).
//
// THE PROPERTY: an executed notebook the validator REJECTED cannot reach a
// signed package without the verdict travelling with it. The validator runs,
// says no, and the pipeline publishes anyway — so the package asserts a
// notebook that reproduces the analysis while the one component that checked
// found it does not. Nothing downstream can recover that fact, because the
// verdict is computed, emitted onto the wire, and then dropped.
//
// D1 was ruled **A** by the owner: the package carries the verdict and the
// page states it. NOT B — there is no publish gate, and no user is stopped.
// Disclosure, not validation (docs/design-principles.md Principle 1): the
// reader is told what was found and decides what it is worth.
//
// WHAT WAS MEASURED AT 7f52a6b (by the ORCH, 2026-09-04, before this file):
//
//   1. `api/query-notebook/route.ts:277` runs `validateExecutedNotebook` and
//      `:278-284` emits the verdict as `validation` on the `notebook` event.
//      `:293` then emits `publish_inputs` unconditionally — nothing branches
//      on `validation.ok`, so a rejected notebook proceeds to the publish.
//
//   2. The verdict reaches no package. `PublishEvidenceDialog.tsx:214-216`
//      assembles the extension as `extensions: { 'org.civicaitools.notebook':
//      notebook }` — the bare notebook, no verdict beside it.
//
//   3. Nothing renders it. The only reader of a `validation` prop anywhere is
//      the dev preview route, and it is fed a HARDCODED literal:
//      `__dev__/sampleExecutedNotebook.ts:182` is `{ ok: true, issues: [] }`.
//      A rendering path exists, wired to a fixture that can never disagree.
//
//   4. The validator really does reject. Driven at the base against a notebook
//      with no extensions and no cells: `ok: false`, four issues, including
//      "no step re-runs a data fetch, so nothing in this notebook is
//      reproducible against a live source". This matters more than it looks —
//      see the first guard.
//
// THE GUARD THAT MAKES THIS CRITERION ABLE TO FAIL. "A notebook the validator
// rejects" describes the empty set unless the validator can actually say no.
// If it always returned `ok: true`, every assertion here would pass on a
// population of zero and prove nothing — the exact shape Wave N9's P6 fell
// into. The first test drives a rejection and asserts it is real BEFORE the
// property tests below rely on rejections existing.
//
// EXPECTED AT 7f52a6b: the two guards pass; the two property tests fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateNotebook } from '../notebook.ts';
import type { ToolCall } from '../../hooks/useStreamingComparison.ts';
import { validateExecutedNotebook } from './validate.ts';

const NOTEBOOK_EXTENSION_KEY = 'org.civicaitools.notebook';

const PORTAL = 'data.cityofnewyork.us';
const ANSWERED = 'erm2-nwe9';
const QUESTION = 'How many noise complaints were filed last year?';
const ANSWER = 'About 412,000 noise complaints were filed.';
const NO_ATTRIBUTION = { origin: null, host: null, platformTitle: null };

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

// --- Guards: green at base, and they are what make the rest meaningful ------

test('guard: the validator can actually reject — "a notebook the validator rejects" is not the empty set', () => {
  const defective = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] };
  const verdict = validateExecutedNotebook(defective as never);

  assert.equal(
    verdict.ok,
    false,
    'if the validator cannot say no, every assertion in this file passes over a population of zero',
  );
  assert.ok(verdict.issues.length > 0, 'a rejection carries issues a reader could be shown');
  assert.ok(
    verdict.issues.every((i) => typeof i.path === 'string' && typeof i.message === 'string'),
    'each issue names where and what — the shape a reader-facing surface would render',
  );
});

test('guard: P2 holds — a skeleton stamps its provenance and carries no verdict', () => {
  const nb = generateNotebook(
    QUESTION,
    PORTAL,
    [{ name: 'get_data', args: { type: 'query', dataset_id: ANSWERED, portal: PORTAL, select: 'count(*)' } }] as unknown as ToolCall[],
    ANSWER,
    NO_ATTRIBUTION,
  ) as unknown as { metadata: { extensions?: Record<string, Record<string, unknown>> } };

  const ext = nb.metadata.extensions?.[NOTEBOOK_EXTENSION_KEY];
  assert.equal(ext?.provenance, 'skeleton', 'P2 shipped the stamp');
  assert.equal(
    ext?.validation,
    undefined,
    'a skeleton carries NO verdict — absent is absent. The validator is for executed notebooks ' +
      'and is never run on a skeleton (P2), so there is no verdict to carry and none must be invented',
  );
});

// --- Red at 7f52a6b ---------------------------------------------------------

/**
 * The seam this phase must add, named as a specifier typed `string` so the
 * compiler does not resolve it — the module is what the phase creates, and
 * this file must compile at the base. The pattern
 * `rejected-call-every-surface.test.ts` uses for the same purpose.
 *
 * Proposed: `buildNotebookExtension(notebook, validation?)` → the value that
 * goes under `extensions['org.civicaitools.notebook']`. One pure function, so
 * the assembly the publish dialog does inline today becomes something a test
 * can drive. A skeleton passes no verdict and the key is absent.
 */
const EXTENSION_MODULE: string = './notebook-extension.ts';

interface ExtensionModule {
  buildNotebookExtension?: (
    notebook: unknown,
    validation?: { ok: boolean; issues: { path: string; message: string }[] },
  ) => Record<string, unknown>;
}

test('the verdict travels with the notebook into the package', async () => {
  const mod = (await import(EXTENSION_MODULE).catch(() => null)) as ExtensionModule | null;
  assert.ok(
    mod?.buildNotebookExtension,
    `no pure function builds the notebook extension: PublishEvidenceDialog.tsx:214-216 assembles ` +
      `it inline as the bare notebook, so the verdict computed at query-notebook/route.ts:277 ` +
      `reaches no package. Proposed seam: ${EXTENSION_MODULE} exporting buildNotebookExtension`,
  );
  const build = mod!.buildNotebookExtension!;

  const rejected = validateExecutedNotebook({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] } as never);
  assert.equal(rejected.ok, false, 'fixture premise: this verdict is a rejection');

  const withVerdict = build({ nbformat: 4, cells: [] }, rejected);
  assert.deepEqual(
    withVerdict.validation,
    rejected,
    'the package carries the verdict the validator actually returned, issues and all — ' +
      'not a boolean, and not a recomputation a reader would have to trust',
  );

  // A skeleton passes no verdict, and absent stays absent (P2's rule, D1's "a
  // skeleton carries no verdict").
  const skeleton = build({ nbformat: 4, cells: [] });
  assert.equal(
    'validation' in skeleton,
    false,
    'no verdict was computed for a skeleton, so the key is absent — never `ok: true`, which would ' +
      'assert a check that never ran',
  );
});

test('the publish path hands the verdict to the package, and the dev fixture does not fake one', () => {
  const dialog = sourceOf('../../components/PublishEvidenceDialog.tsx');
  assert.match(
    dialog,
    /buildNotebookExtension|validation/,
    'PublishEvidenceDialog.tsx assembles `extensions: { "org.civicaitools.notebook": notebook }` ' +
      'with no verdict beside it — the stream carries `validation` on the notebook event and the ' +
      'dialog drops it before POSTing',
  );

  const fixture = sourceOf('../../components/notebook/__dev__/sampleExecutedNotebook.ts');
  assert.doesNotMatch(
    fixture,
    /validation:\s*\{\s*ok:\s*true,\s*issues:\s*\[\]\s*\}/,
    'the only renderer of a verdict anywhere is the dev preview route, and it is fed a hardcoded ' +
      '`{ ok: true, issues: [] }` (sampleExecutedNotebook.ts:182) — a fixture that can never ' +
      'disagree with the validator is not evidence that the surface works. It must be computed.',
  );
});
