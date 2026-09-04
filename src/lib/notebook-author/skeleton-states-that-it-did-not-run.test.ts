// P2 red instrument, Wave N10 (#409, #401) — criterion 4.
//
// THE PROPERTY: a notebook in a signed package states whether it RAN. The
// executed path already says so; the skeleton says nothing, and nothing on
// any page reads the value even when it is there. A reader looking at a
// skeleton sees a notebook full of code and no statement that none of it was
// executed — the absence reads as "executed" because that is the only value
// the vocabulary has ever carried.
//
// Three states, not two. `executed` and `skeleton` are both assertions the
// producer makes. A package built before this field existed carries neither,
// and that is a THIRD thing — "not stated" — which must not be rendered as
// either of the other two. Absent is absent.
//
// WHAT WAS MEASURED AT 7f52a6b (by the ORCH, 2026-09-04, before this file):
//
//   1. `generateNotebook` (`src/lib/notebook.ts:313`) returns a notebook whose
//      `metadata` is exactly `{ kernelspec, language_info }` (`:455-466`).
//      There is no `extensions` key at all, so no provenance stamp. The local
//      `Notebook` interface (`:45-59`) does not admit one either — its
//      `metadata` is typed to those two members, so stamping requires widening
//      the type as well as writing the value.
//
//   2. The executed path DOES stamp, at `src/lib/notebook-author/synthesize.ts:183-191`,
//      spreading onto `metadata.extensions[NOTEBOOK_EXTENSION_KEY]` with
//      `provenance: 'executed'`.
//
//   3. The vocabulary already reserves the skeleton value.
//      `trust-signal.ts:748-749` declares `NOTEBOOK_PROVENANCE_VALUES =
//      ['executed', 'skeleton']` with the comment "`'skeleton'` is reserved
//      (no code path writes it yet)", and `NOTEBOOK_PROVENANCE_SIGNALS`
//      carries a reader-facing descriptor for BOTH. So the vocabulary is not
//      what is missing — the writer and the reader are.
//
//   4. Nothing renders the value. `git grep -n NOTEBOOK_PROVENANCE_SIGNALS`
//      over `src/` returns its declaration and `trust-signal.test.ts` — ONE
//      consumer, its own test. `NotebookSection.tsx` never mentions
//      `provenance`. The record page tests only the extension's PRESENCE
//      (`evidence/[slug]/page.tsx:609`, `:776`: `!== undefined`) and never
//      reads inside it. (`page.tsx:756`'s `renderPkg.provenance` is the
//      package-level PROV-O graph, a different field — do not confuse them.)
//
//   5. The trap. `validateNotebookProvenance` (`validate.ts:54-72`) accepts
//      ONLY `'executed'`: a notebook stamped `'skeleton'` produces the issue
//      `expected "executed", got "skeleton"`. So stamping the skeleton
//      naively makes it fail `validateExecutedNotebook`. The validator is for
//      executed notebooks and must never be run on a skeleton — a stamped
//      skeleton is not a validation failure, and the phase states that rule
//      rather than loosening the validator.
//
// EXPECTED AT 7f52a6b: the two `guard` tests pass — they establish that the
// vocabulary exists, that the executed path stamps, and that the validator
// would reject a stamped skeleton, so the failures below are about the writer
// and the reader and not about a missing vocabulary. The three property tests
// fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateNotebook } from '../notebook.ts';
import type { ToolCall } from '../../hooks/useStreamingComparison.ts';
import { validateNotebookProvenance } from './validate.ts';
// The executed producer, driven rather than described — see the last test.
import { synthesizeNotebook } from './synthesize.ts';
import {
  NOTEBOOK_PROVENANCE_VALUES,
  NOTEBOOK_PROVENANCE_SIGNALS,
} from '../evidence/trust-signal.ts';

const NOTEBOOK_EXTENSION_KEY = 'org.civicaitools.notebook';

const PORTAL = 'data.cityofnewyork.us';
const ANSWERED = 'erm2-nwe9';
const QUESTION = 'How many noise complaints were filed last year?';
const ANSWER = 'About 412,000 noise complaints were filed.';

/** No attribution configured — the shape `claims-outside-the-cover.test.ts:147` uses. */
const NO_ATTRIBUTION = { origin: null, host: null, platformTitle: null };

interface NotebookLike {
  metadata: {
    extensions?: Record<string, Record<string, unknown> | undefined>;
    [k: string]: unknown;
  };
  cells: unknown[];
}

/**
 * One skeleton, from the real generator: a run whose `get_data` answered.
 * Nothing about this notebook was executed — that is the whole point of the
 * skeleton path, and the thing it does not say.
 */
function skeleton(): NotebookLike {
  const toolCalls = [
    { name: 'get_data', args: { type: 'query', dataset_id: ANSWERED, portal: PORTAL, select: 'count(*)' } },
  ];
  return generateNotebook(
    QUESTION,
    PORTAL,
    toolCalls as unknown as ToolCall[],
    ANSWER,
    NO_ATTRIBUTION,
  ) as unknown as NotebookLike;
}

function notebookExtension(nb: NotebookLike): Record<string, unknown> | undefined {
  return nb.metadata.extensions?.[NOTEBOOK_EXTENSION_KEY];
}

// --- Guards: green at base, so the failures below mean what they say --------

test('guard: the vocabulary already reserves the skeleton value and describes it for a reader', () => {
  assert.deepEqual(
    [...NOTEBOOK_PROVENANCE_VALUES],
    ['executed', 'skeleton'],
    'the canonical vocabulary is the two producer assertions',
  );
  assert.ok(
    NOTEBOOK_PROVENANCE_SIGNALS.skeleton?.label,
    'a reader-facing descriptor for skeleton already exists — what is missing is a writer and a reader, not a vocabulary',
  );
  assert.ok(NOTEBOOK_PROVENANCE_SIGNALS.executed?.label);
});

test('guard: the validator accepts only "executed", so a stamped skeleton must never be run through it', () => {
  const stamped = {
    metadata: { extensions: { [NOTEBOOK_EXTENSION_KEY]: { provenance: 'skeleton' } } },
    cells: [],
  };
  const result = validateNotebookProvenance(stamped as never);
  assert.equal(
    result.ok,
    false,
    'if this ever passes, the validator was loosened — the rule is that it is for EXECUTED notebooks and is not run on a skeleton',
  );
  assert.match(
    result.issues.map((i) => i.message).join(' | '),
    /expected "executed", got "skeleton"/,
    'the exact trap: stamping the skeleton and then validating it reports a failure that is not one',
  );
});

// --- Red at 7f52a6b ---------------------------------------------------------

test('a skeleton notebook states that it did not run', () => {
  const ext = notebookExtension(skeleton());
  assert.notEqual(
    ext,
    undefined,
    'generateNotebook returns metadata with no extensions key at all (notebook.ts:455-466), so a skeleton in a signed package is silent about whether it ran',
  );
  assert.equal(
    ext?.provenance,
    'skeleton',
    `the skeleton carries ${JSON.stringify(ext?.provenance)}; 'skeleton' has been reserved in the vocabulary with no code path writing it`,
  );
});

/**
 * The reader this phase must add, named as a module specifier typed `string`
 * so the compiler does not resolve it: the module is what the phase creates,
 * and this file must compile at the base. This is the seam
 * `rejected-call-every-surface.test.ts` uses for the same purpose.
 *
 * Proposed: `readNotebookProvenance(extension)` → one of three states.
 * `executed` and `skeleton` are the producer's own assertions; `not_stated`
 * is the honest reading of a package that carries neither, which every
 * package published before the field existed does. It must never be rendered
 * as either assertion.
 */
const READER_MODULE: string = './notebook-provenance-reading.ts';

interface ReaderModule {
  readNotebookProvenance?: (extension: unknown) => { state: string; label: string; detail: string };
}

test('a reader turns the stamp into one of three states, and a package carrying neither key reads "not stated"', async () => {
  const mod = (await import(READER_MODULE).catch(() => null)) as ReaderModule | null;
  assert.ok(
    mod?.readNotebookProvenance,
    `no reader of the value exists: NOTEBOOK_PROVENANCE_SIGNALS' only consumer is its own test, ` +
      `NotebookSection.tsx never mentions provenance, and the record page tests the extension's ` +
      `presence alone (page.tsx:609, :776). Proposed seam: ${READER_MODULE} exporting readNotebookProvenance`,
  );
  const read = mod!.readNotebookProvenance!;

  assert.equal(read({ provenance: 'executed' }).state, 'executed');
  assert.equal(read({ provenance: 'skeleton' }).state, 'skeleton');

  // The third state, and the reason there are three: a package that predates
  // the field asserts nothing, and "nothing" is not "executed".
  assert.equal(read({}).state, 'not_stated', 'an extension with no provenance key asserts nothing');
  assert.equal(read(undefined).state, 'not_stated', 'no extension at all asserts nothing');

  for (const state of ['executed', 'skeleton', 'not_stated']) {
    const rendered = read(state === 'not_stated' ? {} : { provenance: state });
    assert.ok(rendered.label && rendered.detail, `${state} renders reader-facing text, not a raw value`);
  }
});

test('the two stamps cannot drift: both producers write a value the canonical vocabulary declares', async () => {
  const stamped = notebookExtension(skeleton())?.provenance;
  assert.ok(
    typeof stamped === 'string' && (NOTEBOOK_PROVENANCE_VALUES as readonly string[]).includes(stamped),
    `the skeleton's stamp (${JSON.stringify(stamped)}) is not a member of NOTEBOOK_PROVENANCE_VALUES — ` +
      'the executed path writes "executed" at synthesize.ts:189 and the skeleton must write the reserved ' +
      'sibling from the same declaration, not a bare literal of its own',
  );

  // ADDED BY THE FIX (P2 IMPL), and the reason: as written above, this test is
  // titled for two producers and reads ONE. It restates the executed path's
  // value in prose ("the executed path writes \"executed\" at synthesize.ts:189")
  // rather than driving that producer, so the executed stamp could change to
  // anything at all and nothing here would notice — which is the drift the
  // criterion asks to be made impossible. Both producers are pure synchronous
  // functions, so both are driven, and the pair is asserted against the
  // canonical vocabulary AS A SET. That fails in both directions: a producer
  // writing a value outside the list, and two producers writing the same value.
  const executedStamp = (
    synthesizeNotebook({
      query: QUESTION,
      defaultPortal: PORTAL,
      modelName: 'anthropic/claude-sonnet-4-6',
      modelAccess: 'through an OpenAI-compatible API',
      generatedAt: '2026-09-04T00:00:00.000Z',
      finalAnswer: ANSWER,
      toolCalls: [
        {
          name: 'get_data',
          operationType: 'query',
          args: { type: 'query', portal: PORTAL, dataset_id: ANSWERED, select: 'count(*)' },
          reason: 'to count the records',
          resultSummary: { rows: 1, columns: 1 },
        },
      ],
    }).notebook.metadata.extensions as Record<string, Record<string, unknown>>
  )[NOTEBOOK_EXTENSION_KEY]?.provenance;

  assert.deepEqual(
    [stamped, executedStamp].sort(),
    [...NOTEBOOK_PROVENANCE_VALUES].sort(),
    `the skeleton stamps ${JSON.stringify(stamped)} and the executed path stamps ` +
      `${JSON.stringify(executedStamp)}; together they must be exactly ` +
      `${JSON.stringify([...NOTEBOOK_PROVENANCE_VALUES])} — the vocabulary is a closed list of two ` +
      'producer assertions, and each producer writes one of them',
  );
});
