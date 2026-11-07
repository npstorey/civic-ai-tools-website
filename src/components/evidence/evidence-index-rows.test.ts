// UX-2 P5 criteria 2 and 4, and the filter's words (X7) and the failure words
// (X8): the registry (`EvidenceIndex`) driven on the surface harness, its list
// request answered by this test.
//
// CRITERION 2 (R18 C; relay 13 ruling 1). A registry row is a P7 row whose
// trailing column holds P6 `line` signals in the neutral tier, each with its
// glyph and its label: "Made by AI-assisted analysis · <model display name>"
// and the reviews line (`reviewsLine`, R4 B's words with the rating word in
// parentheses, G0-13 a). The row carries NO "Sources used" signal in P5 (the
// owner's ruling (c)). No `verificationStatus` word reaches the row, and the raw
// model id does not either. A withdrawn row carries `ui-row--withdrawn`.
//
// CRITERION 4 (#701 item 1, G0-12). A failed list fetch says so, in X8's words,
// instead of "No analyses published yet."; a response that arrives after a
// newer request's response does not overwrite it.
//
// WHAT MAKES IT ABLE TO FAIL. Three rows with distinct kinds and counts: none;
// one expert review rated "concerns"; one evaluation and one consistency test,
// withdrawn. Each row's `verificationStatus` is a different retired word, so a
// row that renders the status shows one. The out-of-order case resolves the
// older request LAST, with a record the newer one does not hold.
//
// BLIND SPOTS. No layout and no browser events: the select's change and the
// checkbox are called as React would call their handlers. Where the trailing
// column sits at 639 and 640 px is criterion 8's instrument.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_SURFACE_STUBS, h, mount, registerSurfaceHooks, textOf, type HostElement, type Surface } from '../sources/surface-test-harness.ts';
import { classesOf, within } from '../ui/ui-test-helpers.ts';

registerSurfaceHooks({ ...CONSENT_SURFACE_STUBS });

const { default: EvidenceIndex } = await import('./EvidenceIndex.tsx');
const { formatModelName } = await import('../../lib/models.ts');
const { reviewsLine } = await import('../../lib/evidence/review-summary.ts');

const ORIGIN = 'https://app.fixture.example';
const MODEL = 'anthropic/claude-sonnet-5.5';
const MODEL_NAME = formatModelName(MODEL);

/** X8, ruled. */
const LOAD_FAILED = 'The analyses could not be loaded. Reloading the page tries again.';
/** X7, ruled: the filter's options, in order, and the values the list route reads. */
const FILTER = [
  ['All analyses', ''],
  ['No reviews yet', 'none'],
  ['Expert review', 'expert'],
  ['Evaluation', 'evaluation'],
  ['Consistency test', 'consistency'],
] as const;
const RETIRED = /\b(unverified|consistency[ _]tested|evaluated|fully[ _]attested)\b/i;

function item(slug: string, extra: Record<string, unknown>) {
  return {
    id: `id-${slug}`, slug, title: `Title ${slug}`, summary: `Summary ${slug}.`, model: MODEL,
    withdrawnAt: null, reinstatedAt: null, createdAt: '2026-11-01T00:00:00.000Z', creatorName: 'Fixture Author', ...extra,
  };
}

const ROWS = [
  item('no-reviews', { verificationStatus: 'unverified', reviews: { expertRatings: [], evaluations: 0, consistencyTests: 0 } }),
  item('one-expert', { verificationStatus: 'fully_attested', reviews: { expertRatings: ['concerns'], evaluations: 0, consistencyTests: 0 } }),
  item('two-machine', {
    verificationStatus: 'consistency_tested', withdrawnAt: '2026-11-02T00:00:00.000Z',
    reviews: { expertRatings: [], evaluations: 1, consistencyTests: 1 },
  }),
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const page = (records: unknown[]) => json({ records, total: records.length, page: 1, totalPages: 1 });

/** Every list request the registry sends, by its full address; each answered by `answer`. */
function answerWith(answer: (url: URL) => Promise<Response> | Response): URL[] {
  const sent: URL[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, ORIGIN);
    sent.push(url);
    return answer(url);
  }) as typeof fetch;
  return sent;
}

const rowsOf = (s: Surface) => s.elements().filter((el) => classesOf(el).includes('ui-row'));
const signalsOf = (row: HostElement) => within(row).filter((el) => classesOf(el).includes('ui-signal'));
const labelOf = (signal: HostElement) => textOf(within(signal).find((el) => classesOf(el).includes('ui-signal-label')) ?? signal);

// --- Criterion 2 --------------------------------------------------------------------

test('UX-2 P5 C2: each registry row is a P7 row with two neutral line signals, glyph and label: how it was made, and its reviews', async () => {
  answerWith(() => page(ROWS));
  const s = await mount(h(EvidenceIndex, {}));
  const rows = rowsOf(s);
  assert.equal(rows.length, 3, `the registry renders ${rows.length} P7 rows; it reads: ${s.text().slice(0, 300)}`);
  for (const [i, row] of rows.entries()) {
    const signals = signalsOf(row);
    const expected = ['Made by AI-assisted analysis · ' + MODEL_NAME, reviewsLine((ROWS[i] as unknown as { reviews: Parameters<typeof reviewsLine>[0] }).reviews)];
    assert.ok(expected[1].length > 0, 'the reviews line is not empty');
    assert.deepEqual(signals.map(labelOf), expected, `row ${ROWS[i].slug}`);
    for (const signal of signals) {
      assert.ok(classesOf(signal).includes('ui-signal--neutral') && classesOf(signal).includes('ui-signal--line'), `a ${classesOf(signal).join(' ')} signal`);
      assert.ok(within(signal).some((el) => el.type === 'svg' && classesOf(el).includes('ui-signal-glyph')), 'each signal has its glyph');
    }
  }
  s.unmount();
});

test('UX-2 P5 C2 / G0-13 a: the reviews line carries the count, the kinds and the expert review\'s rating word', async () => {
  answerWith(() => page(ROWS));
  const s = await mount(h(EvidenceIndex, {}));
  const lines = rowsOf(s).map((row) => signalsOf(row).map(labelOf)[1] ?? '');
  assert.equal(lines[0], 'No reviews yet');
  assert.match(lines[1], /\b1 expert review \(concerns\)/);
  assert.match(lines[2], /^2 reviews: 1 evaluation, 1 consistency test$/);
  s.unmount();
});

test('UX-2 P5 C2 (relay 13, ruling 1): no row carries "Sources used"; no row shows a verification status word or the raw model id; each shows the model\'s display name', async () => {
  assert.notEqual(MODEL_NAME, MODEL, 'premise: the catalog names the fixture model');
  answerWith(() => page(ROWS));
  const s = await mount(h(EvidenceIndex, {}));
  const rows = rowsOf(s);
  assert.equal(rows.length, 3, 'premise: three P7 rows');
  for (const row of rows) {
    const text = textOf(row);
    assert.ok(!/Sources used/i.test(text), `a row reads "Sources used": ${text}`);
    assert.ok(!RETIRED.test(text), `a row shows a verification status word: ${text}`);
    assert.ok(!text.includes(MODEL), `a row shows the raw model id: ${text}`);
    assert.ok(text.includes(MODEL_NAME), `a row does not name the model: ${text}`);
  }
  s.unmount();
});

test('UX-2 P5 C2: a withdrawn row carries ui-row--withdrawn, and only it', async () => {
  answerWith(() => page(ROWS));
  const s = await mount(h(EvidenceIndex, {}));
  const withdrawn = rowsOf(s).map((row) => classesOf(row).includes('ui-row--withdrawn'));
  assert.deepEqual(withdrawn, [false, false, true]);
  s.unmount();
});

// --- X7: the filter -----------------------------------------------------------------

test('UX-2 P5 X7: the filter offers the reviews kinds in the ruled words, and choosing one asks the list for it', async () => {
  const sent = answerWith(() => page(ROWS));
  const s = await mount(h(EvidenceIndex, {}));
  const selects = s.elements().filter((el) => el.type === 'select');
  const filter = selects.find((sel) => within(sel).some((o) => o.type === 'option' && textOf(o) === 'All analyses'));
  assert.ok(filter, `no select offers "All analyses"; the selects offer ${JSON.stringify(selects.map((sel) => within(sel).filter((o) => o.type === 'option').map((o) => textOf(o))))}`);
  const options = within(filter).filter((o) => o.type === 'option').map((o) => [textOf(o), String(o.props.value)]);
  assert.deepEqual(options, FILTER.map(([label, value]) => [label, value]));
  await s.type(filter, 'expert');
  const last = sent.at(-1)!;
  assert.equal(last.searchParams.get('reviews'), 'expert', `the list was asked ${last.search}`);
  assert.equal(last.searchParams.get('status'), null, 'the retired status filter is not sent');
  s.unmount();
});

// --- Criterion 4 --------------------------------------------------------------------

test('UX-2 P5 C4 (X8): a list request that fails says so, in the ruled words, and not "No analyses published yet."', async () => {
  for (const fail of [() => json({ error: 'fixture' }, 500), () => { throw new TypeError('fixture network failure'); }]) {
    answerWith(fail as () => Response);
    const s = await mount(h(EvidenceIndex, {}));
    const text = s.text();
    assert.ok(text.includes(LOAD_FAILED), `the registry reads: ${text.slice(0, 300)}`);
    assert.ok(!text.includes('No analyses published yet.'), 'a failure is not an empty registry');
    s.unmount();
  }
});

test('premise (C4): an empty registry still reads "No analyses published yet."', async () => {
  answerWith(() => page([]));
  const s = await mount(h(EvidenceIndex, {}));
  assert.ok(s.text().includes('No analyses published yet.'));
  assert.ok(!s.text().includes(LOAD_FAILED));
  s.unmount();
});

test('UX-2 P5 C4 (#701 item 1): a response that arrives after a newer request\'s does not overwrite it', async () => {
  const pending: Array<{ url: URL; resolve: (r: Response) => void }> = [];
  answerWith((url) => new Promise<Response>((resolve) => pending.push({ url, resolve })));
  const s = await mount(h(EvidenceIndex, {}));
  assert.equal(pending.length, 1, 'premise: the first request is in flight');
  const checkbox = s.elements().find((el) => el.type === 'input' && el.props.type === 'checkbox');
  assert.ok(checkbox, 'premise: the "Include withdrawn" checkbox');
  await s.check(checkbox);
  assert.equal(pending.length, 2, 'premise: a second, newer request is in flight');
  assert.equal(pending[1].url.searchParams.get('withdrawn'), 'include');
  // A response body is read over several turns of the event loop; wait them out.
  const drain = async () => { for (let i = 0; i < 20; i += 1) { await new Promise((r) => setTimeout(r, 0)); await s.settle(); } };
  pending[1].resolve(page([item('newer', { verificationStatus: 'unverified', reviews: { expertRatings: [], evaluations: 0, consistencyTests: 0 } })]));
  await drain();
  assert.ok(s.text().includes('Title newer'), `premise: the newer response rendered; the registry reads: ${s.text().slice(0, 300)}`);
  pending[0].resolve(page([item('older', { verificationStatus: 'unverified', reviews: { expertRatings: [], evaluations: 0, consistencyTests: 0 } })]));
  await drain();
  const text = s.text();
  assert.ok(text.includes('Title newer'), `the registry reads: ${text.slice(0, 300)}`);
  assert.ok(!text.includes('Title older'), 'the older response overwrote the newer one');
  s.unmount();
});

// --- The record frame (#729 P5; U6): the registry sits in `ui-page--record` ---------

test('UX-2 P5 (record frame): the registry page sits in the ui-page--record frame', async () => {
  answerWith(() => page(ROWS));
  const { default: RecordsPage } = await import('../../app/(app)/records/page.tsx');
  const s = await mount(h(RecordsPage as never, {}));
  const frames = s.elements().filter((el) => classesOf(el).includes('ui-page') && classesOf(el).includes('ui-page--record'));
  assert.equal(frames.length, 1, `the registry renders ${frames.length} ui-page--record frames`);
  s.unmount();
});
