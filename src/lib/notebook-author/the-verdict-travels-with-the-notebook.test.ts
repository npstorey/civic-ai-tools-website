// P3 instrument, Wave N10 (#409, #400) — criterion 5, in D1's shape (A).
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
// ---------------------------------------------------------------------------
// WHAT THE PHASE CHANGED IN THIS FILE, AND THE MEASUREMENTS THAT FORCED IT.
// Two things, both address-and-mechanism, neither a weakening: every assertion
// that was here is still here, at the address the implementation actually uses,
// and each has gained a stronger sibling.
//
//   (a) THE VERDICT IS NOT A TOP-LEVEL KEY ON THE NOTEBOOK. This file proposed
//       `build(notebook, verdict).validation` — a `validation` key beside
//       `cells`. Measured against nbformat 5.10.4, that shape is invalid: the
//       nbformat v4 root schema is CLOSED (`additionalProperties: false`), and
//       `nbformat.validate` on a notebook carrying a top-level `validation`
//       fails with "Additional properties are not allowed ('validation' was
//       unexpected)"; the same notebook carrying it under `metadata` validates
//       (`metadata` is `additionalProperties: true`). And this extension IS a
//       downloaded `.ipynb`: `NotebookSection`'s button serialises it verbatim,
//       `/api/records/[slug]/bundle` serves it as `application/x-ipynb+json`.
//       The top-level shape would have bought the verdict at the cost of the
//       artifact it is a verdict about. The verdict therefore sits at
//       `metadata.extensions["org.civicaitools.notebook"].validation`, beside
//       the provenance stamp #401 put there — one address for what a notebook
//       says about itself. The assertion below is the same deep-equality at
//       that address, PLUS a new one that the nbformat root gains no key at
//       all, which is the check that would have caught the shape this file
//       first proposed.
//
//   (b) THE VERDICT IS ATTACHED AT THE SOURCE, NOT AT PUBLISH TIME. This file
//       asserted that `PublishEvidenceDialog.tsx` mentions the verdict. The
//       dialog is three hops from where the verdict is known, and #400 is a
//       defect of TRANSPORT — the fact was computed and dropped by an
//       intermediate. Attaching it in the route, where the validator returns,
//       means no intermediate has to remember to forward it: the dialog posts
//       the executed notebook verbatim and the verdict arrives in the package
//       without the dialog knowing verdicts exist. Asserting the dialog names
//       the verdict would, under this mechanism, be satisfiable by a comment —
//       a fake pass. It is replaced by two assertions that bite: the route
//       attaches it, and the dialog still carries the notebook verbatim (the
//       one thing the dialog can do to break the chain).
//
// AND THE CRITERION THAT COULD NOT FAIL. The preview fixture's computed verdict
// IS `{ ok: true, issues: [] }` — identical to the literal it replaces — so
// "computed, not literal" proves nothing by itself. The last two tests drive a
// fixture whose verdict DISAGREES through the same rendering path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateNotebook } from '../notebook.ts';
import type { ToolCall } from '../../hooks/useStreamingComparison.ts';
import { validateExecutedNotebook } from './validate.ts';
import {
  buildSampleExecutedNotebook,
  buildSampleRejectedNotebook,
} from '../../components/notebook/__dev__/sampleExecutedNotebook.ts';
import { readNotebookValidationOfNotebook } from './notebook-validation-reading.ts';

const NOTEBOOK_EXTENSION_KEY = 'org.civicaitools.notebook';

const PORTAL = 'data.cityofnewyork.us';
const ANSWERED = 'erm2-nwe9';
const QUESTION = 'How many noise complaints were filed last year?';
const ANSWER = 'About 412,000 noise complaints were filed.';
const NO_ATTRIBUTION = { origin: null, host: null, platformTitle: null };

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

/** The verdict's home inside the notebook, read the way a consumer reads it. */
function carriedVerdict(notebook: unknown): unknown {
  const metadata = (notebook as { metadata?: Record<string, unknown> }).metadata ?? {};
  const extensions = (metadata.extensions ?? {}) as Record<string, unknown>;
  const ext = (extensions[NOTEBOOK_EXTENSION_KEY] ?? {}) as Record<string, unknown>;
  return ext.validation;
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
  assert.equal(
    readNotebookValidationOfNotebook(nb),
    null,
    'and the reader says nothing about it either: a skeleton has no verdict to lack, so no row is ' +
      'rendered. Reporting an absent check on a document no check was ever going to run is noise, ' +
      'not disclosure',
  );
});

// --- Red at 7f52a6b ---------------------------------------------------------

/**
 * The seam this phase adds, named as a specifier typed `string` so the
 * compiler does not resolve it — the module is what the phase creates, and
 * this file must compile at the base. The pattern
 * `rejected-call-every-surface.test.ts` uses for the same purpose.
 *
 * `buildNotebookExtension(notebook, validation?)` → the value that goes under
 * `extensions['org.civicaitools.notebook']`. One pure function, so the assembly
 * that was inline becomes something a test can drive. A skeleton passes no
 * verdict and the key is absent.
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

  const input = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] };
  const withVerdict = build(input, rejected);
  assert.deepEqual(
    carriedVerdict(withVerdict),
    rejected,
    'the package carries the verdict the validator actually returned, issues and all — ' +
      'not a boolean, and not a recomputation a reader would have to trust',
  );

  // (a) in the header. The value under the extension key is a NOTEBOOK, and a
  // reader downloads it: nbformat v4's root schema is closed, so a key added
  // there makes the file this feature exists for fail validation in Jupyter.
  assert.deepEqual(
    Object.keys(withVerdict).sort(),
    Object.keys(input).sort(),
    'carrying the verdict must not add a key to the nbformat root — measured against nbformat ' +
      '5.10.4, the v4 root schema is additionalProperties:false while `metadata` is not, and this ' +
      'object is served as application/x-ipynb+json by /api/records/[slug]/bundle',
  );

  // The executed notebook lives in React state on the client and in the
  // stream's closure on the server; building the extension must not reach into
  // either.
  assert.deepEqual(
    input,
    { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] },
    'the input notebook is not mutated',
  );

  // The verdict describes the document, so attaching it must not change what a
  // re-run of the validator would say about that document. Driven on the shape
  // the route actually produces — a STAMPED notebook, which every notebook the
  // route attaches to is — and on the rejected fixture, so the assertion is
  // over a document the validator really does refuse.
  const stampedRejection = buildSampleRejectedNotebook();
  assert.equal(stampedRejection.validation.ok, false, 'fixture premise: this document is refused');
  assert.deepEqual(
    validateExecutedNotebook(stampedRejection.notebook),
    stampedRejection.validation,
    'carrying a verdict does not change the verdict: a reader who re-validates the published ' +
      'notebook gets what the package says they will',
  );

  // MEASURED NARROWING, stated rather than hidden. On a notebook carrying NO
  // notebook extension at all, attaching the verdict necessarily creates the
  // extension object to put it in, and `validateNotebookProvenance` then reports
  // `expected "executed", got undefined` where it had reported `extension
  // missing`. Same rejection, same issue count, one different sentence. It is
  // unreachable on the real path — the route attaches only to a stamped
  // notebook, and nothing in this repository attaches a verdict to a document it
  // did not produce — and it is asserted here so a later reader does not have to
  // rediscover it.
  const reValidated = validateExecutedNotebook(withVerdict as never);
  assert.equal(reValidated.ok, rejected.ok);
  assert.equal(reValidated.issues.length, rejected.issues.length);

  // A skeleton passes no verdict, and absent stays absent (P2's rule, and D1's
  // "a skeleton carries no verdict").
  const skeleton = build({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] });
  assert.equal(
    carriedVerdict(skeleton),
    undefined,
    'no verdict was computed for a skeleton, so the key is absent — never `ok: true`, which would ' +
      'assert a check that never ran',
  );
});

test('the publish path hands the verdict to the package, and the dev fixture does not fake one', () => {
  // (b) in the header: the attach site is the route, where the verdict is known.
  const route = sourceOf('../../app/api/query-notebook/route.ts');
  assert.match(
    route,
    /notebook: buildNotebookExtension\(stamped\.notebook, validation\)/,
    'the route must emit a notebook that carries its own verdict. Until #400 it emitted ' +
      '`stamped.notebook` with the verdict beside it on the event, and the first consumer that did ' +
      'not carry the second value forward dropped it for good',
  );

  // D1 = A, pinned: there is no publish gate, and no user meets a refusal.
  assert.doesNotMatch(
    route,
    /if\s*\(\s*!?\s*validation(\.ok)?\s*[)&|]/,
    'D1 was ruled A. Nothing in the route may branch on the verdict: `publish_inputs` is emitted ' +
      'for a rejected notebook exactly as for a clean one. Disclosure, not validation',
  );

  // The two intermediates between the route and the package, and the one thing
  // each can do to break the chain: rebuild the notebook instead of carrying it.
  // Neither does, and that is why the verdict survives the hops.
  const hook = sourceOf('../../hooks/useNotebookStream.ts');
  assert.match(
    hook,
    /const notebook = raw\.notebook as Notebook;/,
    'the stream hook stores the notebook the route sent, whole. A projection here would drop the ' +
      'verdict between the wire and the publish dialog',
  );

  const dialog = sourceOf('../../components/PublishEvidenceDialog.tsx');
  assert.match(
    dialog,
    /const notebook = executedNotebook \?\?[\s\S]{0,200}generateNotebook\(/,
    'the executed notebook reaches the dialog whole',
  );
  assert.match(
    dialog,
    /'org\.civicaitools\.notebook': notebook,/,
    'and is posted verbatim as the package extension — a projection here would strip the verdict ' +
      'the route attached, which is exactly the shape #400 is',
  );

  const fixture = sourceOf('../../components/notebook/__dev__/sampleExecutedNotebook.ts');
  assert.doesNotMatch(
    fixture,
    /validation:\s*\{\s*ok:\s*true,\s*issues:\s*\[\]\s*\}/,
    'the only renderer of a verdict anywhere is the dev preview route, and it is fed a hardcoded ' +
      '`{ ok: true, issues: [] }` (sampleExecutedNotebook.ts:182) — a fixture that can never ' +
      'disagree with the validator is not evidence that the surface works. It must be computed.',
  );
  assert.match(
    fixture,
    /validateExecutedNotebook\(/,
    'and computed means the validator is actually run over the notebook the fixture just built',
  );
});

// --- The criterion that could not fail, and the shape that can --------------
//
// `buildSampleExecutedNotebook`'s computed verdict is `{ ok: true, issues: [] }`
// — the same value as the literal it replaces. Nothing about the rendering path
// is demonstrated by a fixture whose verdict agrees with the old constant by
// coincidence. These two tests drive the other shape.

test('the dev fixtures are computed, and one of them disagrees with a clean verdict', () => {
  const clean = buildSampleExecutedNotebook();
  assert.deepEqual(
    clean.validation,
    validateExecutedNotebook(clean.notebook),
    'the clean fixture reports what the validator says about the notebook it hands over',
  );
  assert.equal(clean.validation.ok, true);
  assert.deepEqual(
    carriedVerdict(clean.notebook),
    clean.validation,
    'and the notebook it hands over carries that verdict, exactly as a package would',
  );

  const rejected = buildSampleRejectedNotebook();
  assert.equal(
    rejected.validation.ok,
    false,
    'THE FIXTURE THAT MAKES THIS CRITERION ABLE TO FAIL. The clean run validates clean, so a ' +
      '"computed" verdict equal to `{ ok: true, issues: [] }` demonstrates nothing on its own. ' +
      'This one is the same analysis with its data fetch refused — nothing in the notebook re-runs ' +
      'a live request — and the validator says so.',
  );
  assert.ok(rejected.validation.issues.length > 0);
  assert.deepEqual(
    rejected.validation,
    validateExecutedNotebook(rejected.notebook),
    'the rejected fixture is not hand-authored either: its verdict is the validator run over it',
  );
  assert.deepEqual(carriedVerdict(rejected.notebook), rejected.validation);
});

test('a reader of a rejected notebook is told what was found, calmly, from the notebook itself', () => {
  const rejected = buildSampleRejectedNotebook();
  const read = readNotebookValidationOfNotebook(rejected.notebook);
  assert.ok(read, 'a rejected notebook reads as something');
  assert.equal(read!.state, 'issues_found');
  assert.equal(
    read!.tier,
    'attention',
    'never `alarm`: that tier is a cryptographic integrity failure. This is disclosure of what a ' +
      'check found, not a failure banner (docs/design-principles.md Principle 1)',
  );
  assert.deepEqual(
    read!.issues,
    rejected.validation.issues,
    "the reader is handed the validator's own issues, not a count it would have to take on trust",
  );
  assert.ok(read!.label.includes(String(rejected.validation.issues.length)), 'the label states how many');
  assert.ok(read!.detail && read!.detail.length > 0, 'and a sentence saying what the check was');
  assert.doesNotMatch(
    `${read!.label} ${read!.detail}`,
    /invalid|failure|error|wrong|incorrect/i,
    'the words are about the document, not a verdict on the analysis and not an alarm',
  );

  const clean = readNotebookValidationOfNotebook(buildSampleExecutedNotebook().notebook);
  assert.equal(clean!.state, 'checked_clean');
  assert.equal(clean!.tier, 'normal', 'a clean verdict is calm and carries no chrome beyond one line');
  assert.deepEqual(clean!.issues, []);

  // An EXECUTED notebook in a package published before the verdict travelled is
  // a third thing, and it is named rather than collapsed into the clean
  // reading — #401's lesson one level up: silence that can only be read one way
  // is not silence.
  const preVerdict = {
    metadata: { extensions: { [NOTEBOOK_EXTENSION_KEY]: { provenance: 'executed' } } },
    cells: [],
  };
  const older = readNotebookValidationOfNotebook(preVerdict);
  assert.equal(older!.state, 'not_recorded');
  assert.equal(older!.tier, 'normal');

  // A verdict this reader cannot read is not a verdict it may report. It lands
  // on the same reading as no verdict at all, and the reader's header names the
  // imprecision that leaves. Unreachable from this repository's own producer —
  // the shape is written in one place — but the record page renders other
  // adopters' extensions.
  for (const unreadable of [{ ok: 'no' }, { ok: false }, { ok: false, issues: [{ path: 1 }] }, 'yes']) {
    const ext = { provenance: 'executed', validation: unreadable };
    assert.equal(
      readNotebookValidationOfNotebook({ metadata: { extensions: { [NOTEBOOK_EXTENSION_KEY]: ext } }, cells: [] })!.state,
      'not_recorded',
      `an unreadable verdict (${JSON.stringify(unreadable)}) is never coerced into a reported result`,
    );
  }

  // And a reading is never invented for a document the validator was never
  // going to see: the same unreadable value on a SKELETON reads as nothing.
  assert.equal(
    readNotebookValidationOfNotebook({
      metadata: { extensions: { [NOTEBOOK_EXTENSION_KEY]: { provenance: 'skeleton', validation: { ok: 'no' } } } },
      cells: [],
    }),
    null,
  );

  // And the surface renders it. A text scan cannot render React: this says the
  // reading reaches the notebook section and is handed to the shared signal
  // row, not that a reader saw it.
  const section = sourceOf('../../components/evidence/NotebookSection.tsx');
  assert.match(
    section,
    /readNotebookValidationOfNotebook/,
    'NotebookSection must read the verdict off the notebook it was handed, the same way it reads ' +
      'the provenance stamp — the defect was a verdict that reached no page at all',
  );
  assert.match(
    section,
    /<TrustSignal[\s\S]{0,200}checked\.label/,
    'rendered through the shared trust-signal row, not restated inline',
  );
  assert.match(
    section,
    /checked\.issues\.map/,
    'and the issues themselves are reachable — a count with nothing behind it is not disclosure',
  );
});
