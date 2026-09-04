// The three readings of "did this notebook run", and the one that is easiest to
// fake (#409 P2, #401).
//
// The instrument in `skeleton-states-that-it-did-not-run.test.ts` asserts that
// `readNotebookProvenance` exists and answers `not_stated` for `{}` and for
// `undefined`. Both of those are objects this file could have written to say
// whatever it wanted. That is exactly the shape the wave before this one was
// caught by: a criterion demonstrated on a fixture built so it cannot fail is
// not demonstrated. So the "not stated" reading is driven HERE against
// `fixtures/pre-stamp-package.json` — a package whose notebook is the verbatim
// output of `generateNotebook` at `7f52a6b`, the last commit before the stamp
// existed. Nothing about it was arranged; it is what the generator produced.
//
// The assertions below then close the gap that would let that fixture drift
// into meaninglessness: today's generator, given the same arguments, must
// produce a notebook differing from the frozen one ONLY by the stamp. A fixture
// that stopped resembling current output would still answer `not_stated` and
// would no longer be evidence of anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateNotebook } from '../notebook.ts';
import type { ToolCall } from '../../hooks/useStreamingComparison.ts';
import { NOTEBOOK_EXTENSION_KEY as KEY_FROM_PROMPT } from './prompt.ts';
import {
  NOTEBOOK_EXTENSION_KEY,
  NOTEBOOK_PROVENANCE_NOT_STATED_SIGNAL,
  readNotebookProvenance,
  readNotebookProvenanceOfNotebook,
} from './notebook-provenance-reading.ts';
import { NOTEBOOK_PROVENANCE_SIGNALS } from '../evidence/trust-signal.ts';

/** The arguments the frozen fixture was generated from — see fixtures/README.md. */
const FIXTURE_QUESTION = 'How many noise complaints were filed last year?';
const FIXTURE_PORTAL = 'data.cityofnewyork.us';
const FIXTURE_ANSWER = 'About 412,000 noise complaints were filed.';
const FIXTURE_TOOL_CALLS = [
  { name: 'get_data', args: { type: 'catalog', portal: FIXTURE_PORTAL, query: 'noise complaints' } },
  { name: 'get_data', args: { type: 'metadata', portal: FIXTURE_PORTAL, dataset_id: 'erm2-nwe9' } },
  {
    name: 'get_data',
    args: {
      type: 'query',
      portal: FIXTURE_PORTAL,
      dataset_id: 'erm2-nwe9',
      select: 'count(*)',
      where: "complaint_type like 'Noise%'",
    },
  },
] as unknown as ToolCall[];
const NO_ATTRIBUTION = { origin: null, host: null, platformTitle: null };

interface StoredPackage {
  extensions: Record<string, unknown>;
}

function preStampPackage(): StoredPackage {
  const path = fileURLToPath(new URL('./fixtures/pre-stamp-package.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as StoredPackage;
}

/** The generation date is the one part of a skeleton that moves with the clock. */
function withoutGenerationDate(text: string): string {
  return text.replace(/\*\*Generated:\*\* \d{4}-\d{2}-\d{2}/g, '**Generated:** <date>');
}

test('the extension key this client-safe module declares is the one prompt.ts declares', () => {
  assert.equal(
    NOTEBOOK_EXTENSION_KEY,
    KEY_FROM_PROMPT,
    'the reader re-declares the key rather than importing it from prompt.ts, which reaches site-config ' +
      'and so cannot ride into a client bundle. That is only safe while the two are equal.',
  );
});

test('the two producer assertions read back as themselves, in the vocabulary\'s own reviewed words', () => {
  const executed = readNotebookProvenance({ provenance: 'executed' });
  assert.equal(executed.state, 'executed');
  assert.equal(executed.label, NOTEBOOK_PROVENANCE_SIGNALS.executed.label);
  assert.equal(executed.detail, NOTEBOOK_PROVENANCE_SIGNALS.executed.detail);

  const skeleton = readNotebookProvenance({ provenance: 'skeleton' });
  assert.equal(skeleton.state, 'skeleton');
  assert.equal(skeleton.label, NOTEBOOK_PROVENANCE_SIGNALS.skeleton.label);
  assert.equal(skeleton.detail, NOTEBOOK_PROVENANCE_SIGNALS.skeleton.detail);

  // Neither reading is a failure, and the tier is where a surface would learn
  // otherwise: `alarm` paints red, `attention` paints amber. Both are calm.
  assert.equal(executed.tier, 'normal');
  assert.equal(skeleton.tier, 'normal');
});

test('every one of the three readings carries a narrative sentence, not just a label', () => {
  // `detail` is optional on a TrustSignalDescriptor, so the type cannot say
  // this. It is the load-bearing layer on these surfaces (design-principles P5:
  // "if the narrative sentence is wrong or missing, no amount of structured
  // metadata below it compensates"), which is why it is asserted instead.
  for (const extension of [{ provenance: 'executed' }, { provenance: 'skeleton' }, {}]) {
    const reading = readNotebookProvenance(extension);
    assert.ok(reading.label.length > 0, `${reading.state} has no label`);
    assert.ok(
      reading.detail !== undefined && reading.detail.length > 0,
      `${reading.state} renders a bare label with no sentence behind it`,
    );
    assert.notEqual(reading.label, reading.state, 'a reader is shown words, not the raw value');
  }
});

test('a package that genuinely predates the stamp reads "not stated" — not executed, not a failure', () => {
  const pkg = preStampPackage();
  const notebook = pkg.extensions[NOTEBOOK_EXTENSION_KEY];

  // The fixture's own premise, checked rather than assumed: if these ever fail,
  // the file stopped being a pre-stamp package and every assertion under it is
  // measuring nothing.
  assert.ok(notebook, 'the fixture package carries a notebook extension');
  assert.equal(
    JSON.stringify(pkg).includes('provenance'),
    false,
    'the frozen package must contain no provenance key anywhere — that is the whole point of it',
  );
  const nb = notebook as { nbformat: number; cells: unknown[]; metadata: Record<string, unknown> };
  assert.equal(nb.nbformat, 4);
  assert.ok(nb.cells.length > 0, 'a real notebook, not an empty stub that could not disagree');
  assert.deepEqual(
    Object.keys(nb.metadata).sort(),
    ['kernelspec', 'language_info'],
    'metadata carried exactly these two members before the stamp existed',
  );

  const reading = readNotebookProvenanceOfNotebook(notebook);
  assert.equal(reading.state, 'not_stated');
  assert.notEqual(reading.state, 'executed', 'absence must never be rendered as an assertion');
  assert.notEqual(reading.state, 'skeleton');
  assert.equal(reading.label, NOTEBOOK_PROVENANCE_NOT_STATED_SIGNAL.label);
  assert.equal(reading.detail, NOTEBOOK_PROVENANCE_NOT_STATED_SIGNAL.detail);
  // Not a failure: the third state is as calm as the two assertions.
  assert.equal(reading.tier, 'normal');
  assert.match(reading.detail ?? '', /not a failure/i);
});

test('the frozen fixture differs from today\'s skeleton by the stamp and nothing else', () => {
  const frozen = preStampPackage().extensions[NOTEBOOK_EXTENSION_KEY] as {
    metadata: Record<string, unknown>;
    cells: unknown[];
  };
  const current = generateNotebook(
    FIXTURE_QUESTION,
    FIXTURE_PORTAL,
    FIXTURE_TOOL_CALLS,
    FIXTURE_ANSWER,
    NO_ATTRIBUTION,
  );

  assert.deepEqual(current.metadata.kernelspec, frozen.metadata.kernelspec);
  assert.deepEqual(current.metadata.language_info, frozen.metadata.language_info);
  assert.equal(
    withoutGenerationDate(JSON.stringify(current.cells)),
    withoutGenerationDate(JSON.stringify(frozen.cells)),
    'same generator, same arguments: the cells must still match once the generation date is normalised. ' +
      'If they do not, the fixture is no longer "the same notebook before the stamp" and must be re-frozen ' +
      'from the pre-stamp commit — see fixtures/README.md.',
  );

  // The one difference, in both directions.
  assert.equal(frozen.metadata.extensions, undefined);
  assert.equal(
    (current.metadata.extensions?.[NOTEBOOK_EXTENSION_KEY] as Record<string, unknown>).provenance,
    'skeleton',
  );
  assert.equal(readNotebookProvenanceOfNotebook(current).state, 'skeleton');
  assert.equal(readNotebookProvenanceOfNotebook(frozen).state, 'not_stated');
});

// --- The reading reaches the page ------------------------------------------
//
// A reader is what #401 was missing: `NOTEBOOK_PROVENANCE_SIGNALS` had one
// consumer — its own test — so the value could have been stamped for another
// two waves and still shown on no page. The assertions above prove the reading
// is correct; these prove it is WIRED, which is the half that was absent.
//
// A text scan cannot render React, so this is a tripwire and not a screenshot:
// it says the record page's notebook section reaches the reader and hands what
// it gets to the shared signal component. It cannot say the row is visible, or
// that it is placed where a reader looks first. Nobody should read a passing
// run here as having seen the page.

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function sourceOf(repoRelativePath: string): string {
  return readFileSync(join(REPO_ROOT, repoRelativePath), 'utf8');
}

test('the record page\'s notebook section renders the reading, on every layout', () => {
  const section = sourceOf('src/components/evidence/NotebookSection.tsx');
  assert.match(
    section,
    /readNotebookProvenanceOfNotebook/,
    'NotebookSection must read the stamp off the notebook it was handed — the defect was a page that ' +
      'showed a notebook full of code and said nothing about whether any of it ran',
  );
  assert.match(
    section,
    /<TrustSignal[\s\S]{0,200}ran\.label/,
    'the reading is rendered through the shared trust-signal row, not restated inline',
  );
  assert.equal(
    /not_stated/.test(section),
    false,
    'the component must not branch on the state: all three readings render the same way, and a ' +
      'surface that special-cased "not stated" would be one edit away from hiding it again',
  );

  const page = sourceOf('src/app/(app)/evidence/[slug]/page.tsx');
  const renders = page.match(/<NotebookSection\b/g) ?? [];
  assert.ok(
    renders.length >= 2,
    `the record page renders <NotebookSection> ${renders.length} time(s); it has two layouts (the ` +
      'current section E and the legacy standalone section) and a reading that reaches only one of ' +
      'them is a reading a reader can miss',
  );
});
