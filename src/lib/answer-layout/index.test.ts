// LAYOUT-WEB W4 P1: the layouts, their check, the reading, the name map and the
// placement rule (`index.ts`, `reading.ts`).
//
// WHAT IS PINNED HERE, by criterion:
//   (2) the site checks a layout with produce-core's `buildLayoutNode` and no
//       parser of its own: the same payloads go to the site's reading and to
//       the builder, and each is accepted or refused by both. Each malformed
//       payload breaks one rule of the builder, which the builder's own message
//       names; a well-formed payload that names an unknown part is accepted by
//       both (spec §8.14.4).
//   (3) `answer-first` v1 equals, field by field, a literal copy of the spec's
//       §8.14.1 example payload.
//   item 3: `envelope-order` v1, field by field; the reading's three forms.
//   ORCH reading 1: the name map, pinned as a table.
//   item 7 (the W4 amendment): the placement rule.
//   item 4 and reading 5: the reader's choice and its session key.
// The surfaces' render tests are in `answer-view-layout.test.ts` and
// `record-page-layout.test.ts`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLayoutNode } from '@typedstandards/produce-core';
import {
  ANSWER_FIRST,
  BUILT_IN_INSTANCE_LAYOUTS,
  BUILT_IN_LAYOUTS,
  DISCLOSURE_SECTIONS,
  ENVELOPE_ORDER,
  PAGE_PARTS,
  disclosureOrder,
  layoutId,
  layoutLine,
  pageOrder,
  parseStoredLayoutChoice,
  placeParts,
  selectLayout,
  unknownPartNames,
  type LayoutPayload,
} from './index.ts';
import { AnswerLayoutConfigurationError, checkLayout, resolveAnswerLayouts } from './reading.ts';
import { COMPARISON_STORAGE_KEY, LAYOUT_STORAGE_KEY, MODE_STORAGE_KEY } from '../query-presentation.ts';
import { DISCLOSURE_LABEL, PART_ORDER } from '../../components/answer-view/view-model.ts';

// --- (3): answer-first v1 is the spec's example ------------------------------------------
//
// A literal copy of the example payload in hub
// `docs/architecture/typed-standards-specification.md` §8.14.1, as it reads at
// hub 9a6eff5 (spec v0.1.12, `:1494-1506`). Copied by hand from the spec, not
// from `index.ts`, so the two can disagree.
const SPEC_8_14_1_EXAMPLE = {
  name: 'answer-first',
  version: 1,
  appliesTo: ['default', 'datHere'],
  order: ['status', 'answer', 'citation', 'steps', 'sources', 'disclosure', 'actions'],
  disclosure: {
    label: 'Learn more about how this analysis was produced',
    order: ['A', 'B', 'C', 'D', 'E', 'G', 'signers', 'attestations', 'verification'],
    openByDefault: false,
  },
  steps: { placement: 'beside', openByDefault: true },
  rendererVersion: 'answer-view/1',
};

test('W4 P1 (3) answer-first v1 equals the spec’s §8.14.1 example, field by field', () => {
  assert.deepEqual(Object.keys(ANSWER_FIRST), Object.keys(SPEC_8_14_1_EXAMPLE), 'the seven fields, in the example’s order');
  for (const field of Object.keys(SPEC_8_14_1_EXAMPLE) as Array<keyof typeof SPEC_8_14_1_EXAMPLE>) {
    assert.deepEqual(ANSWER_FIRST[field], SPEC_8_14_1_EXAMPLE[field], `${field}`);
  }
  assert.equal(JSON.stringify(ANSWER_FIRST), JSON.stringify(SPEC_8_14_1_EXAMPLE), 'byte for byte, as JSON');
  assert.equal(ANSWER_FIRST.disclosure.label, DISCLOSURE_LABEL, 'the disclosure label the site ships');
});

// --- item 3: envelope-order v1 --------------------------------------------------------------

test('W4 P1 item 3: envelope-order v1, field by field', () => {
  assert.deepEqual(ENVELOPE_ORDER, {
    name: 'envelope-order',
    version: 1,
    appliesTo: ['default', 'datHere'],
    order: ['status', 'disclosure', 'steps', 'answer', 'sources', 'citation', 'actions'],
    disclosure: ANSWER_FIRST.disclosure,
    steps: { placement: 'beside', openByDefault: true },
    rendererVersion: 'answer-view/1',
  });
  assert.deepEqual(ENVELOPE_ORDER.disclosure, SPEC_8_14_1_EXAMPLE.disclosure, 'the same disclosure as answer-first');
});

test('W4 P1 item 3: both built-ins pass the builder unchanged and name no part the renderer does not know', () => {
  for (const layout of BUILT_IN_LAYOUTS) {
    assert.deepEqual(checkLayout(structuredClone(layout), 'built-in'), layout, `${layout.name}: the builder keeps every field`);
    assert.deepEqual(unknownPartNames(layout), [], `${layout.name}: every name is known`);
  }
  assert.deepEqual(BUILT_IN_INSTANCE_LAYOUTS, { default: ANSWER_FIRST, offered: [ANSWER_FIRST, ENVELOPE_ORDER] });
});

// --- (2): the site's check is the builder's -------------------------------------------------

/** The builder, fed as the site feeds it: the payload, then fixed determinism inputs. */
function builderAccepts(payload: unknown): { ok: true } | { ok: false; message: string } {
  try {
    buildLayoutNode({
      ...(payload as object),
      packageId: 'p',
      createdAt: '2026-10-19T00:00:00.000Z',
      signingKeyId: 'k',
      signer: { bindingTier: 'pseudonymous', identifier: 'i', displayName: 'd' },
    } as Parameters<typeof buildLayoutNode>[0]);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** The site's reading, given the payload as `ANSWER_LAYOUT`'s JSON. */
function siteAccepts(payload: unknown): { ok: true } | { ok: false; message: string } {
  try {
    resolveAnswerLayouts({ inline: JSON.stringify(payload) }, { warn: () => {} });
    return { ok: true };
  } catch (err) {
    assert.ok(err instanceof AnswerLayoutConfigurationError, `the reading refuses with its typed error: ${String(err)}`);
    return { ok: false, message: err.message };
  }
}

const VALID: LayoutPayload = { ...structuredClone(ENVELOPE_ORDER), name: 'fixture-valid' };
const without = (field: string) => {
  const copy = structuredClone(VALID) as unknown as Record<string, unknown>;
  delete copy[field];
  return copy;
};
const withField = (field: string, value: unknown) => ({ ...structuredClone(VALID), [field]: value });
const withDisclosure = (fields: Record<string, unknown>) => ({ ...structuredClone(VALID), disclosure: { ...VALID.disclosure, ...fields } });
const withSteps = (fields: Record<string, unknown>) => ({ ...structuredClone(VALID), steps: { ...VALID.steps, ...fields } });

/** Each breaks one rule; the pattern is the builder's words for that rule. */
const MALFORMED: Array<[string, unknown, RegExp]> = [
  ['no name', without('name'), /name is required/],
  ['a name that is not a string', withField('name', 7), /name must be a string/],
  ['no version', without('version'), /version is required/],
  ['version 0', withField('version', 0), /version must be an integer of at least 1/],
  ['version 1.5', withField('version', 1.5), /version must be an integer of at least 1/],
  ['version "1"', withField('version', '1'), /version must be an integer of at least 1/],
  ['no appliesTo', without('appliesTo'), /appliesTo is required/],
  ['an empty appliesTo', withField('appliesTo', []), /appliesTo must not be empty/],
  ['an appliesTo that is a string', withField('appliesTo', 'default'), /appliesTo must be an array of strings/],
  ['an appliesTo entry that is not a string', withField('appliesTo', ['default', 3]), /appliesTo\[1\] must be a string/],
  ['an empty order', withField('order', []), /order must not be empty/],
  ['a repeated order entry', withField('order', ['status', 'answer', 'status']), /order must not repeat an entry: "status" at 0 and 2/],
  ['an order entry that is null', withField('order', ['status', null]), /order\[1\] must be a string/],
  ['no disclosure', without('disclosure'), /disclosure is required/],
  ['a disclosure that is an array', withField('disclosure', []), /disclosure must be an object/],
  ['no disclosure label', withDisclosure({ label: undefined }), /disclosure\.label is required/],
  ['a disclosure order that is not an array', withDisclosure({ order: 'A' }), /disclosure\.order must be an array of strings/],
  ['a disclosure openByDefault that is a string', withDisclosure({ openByDefault: 'false' }), /disclosure\.openByDefault must be a boolean/],
  ['a disclosure member outside the table', withDisclosure({ collapsed: true }), /disclosure has a member outside §8\.14\.1: "collapsed"/],
  ['no steps', without('steps'), /steps is required/],
  ['a steps placement that is a number', withSteps({ placement: 1 }), /steps\.placement must be a string/],
  ['no steps openByDefault', withSteps({ openByDefault: undefined }), /steps\.openByDefault is required/],
  ['a steps member outside the table', withSteps({ collapsed: false }), /steps has a member outside §8\.14\.1: "collapsed"/],
  ['no rendererVersion', without('rendererVersion'), /rendererVersion is required/],
  ['a top-level member outside the table', withField('layoutNodeId', 'x'), /input has a member outside §8\.14\.1: "layoutNodeId"/],
  ['a payload that is null', null, /name is required/],
  ['a payload that is an array', ['answer-first'], /input has a member outside §8\.14\.1: "0"/],
];

/** Well-formed: an unknown part on the page and in the disclosure, a placement the site does not know. */
const ACCEPTED: Array<[string, unknown]> = [
  ['the fixture itself', VALID],
  ['an unknown part on the page and in the disclosure', {
    ...structuredClone(VALID),
    order: [...VALID.order, 'TIMELINE-w4p1'],
    disclosure: { ...VALID.disclosure, order: ['APPENDIX-w4p1', ...VALID.disclosure.order] },
  }],
  ['an empty disclosure order', withDisclosure({ order: [] })],
  ['a repeated disclosure entry (the builder checks repeats in order only)', withDisclosure({ order: ['A', 'A', 'B'] })],
  ['a steps placement no renderer names', withSteps({ placement: 'SIDEWAYS-w4p1' })],
];

test('W4 P1 (2) each malformed payload breaks one rule of the builder, in the builder’s own words', () => {
  for (const [name, payload, rule] of MALFORMED) {
    const builder = builderAccepts(payload);
    assert.equal(builder.ok, false, `${name}: the builder refuses it`);
    if (!builder.ok) {
      assert.match(builder.message, /^buildLayoutNode: /, `${name}: the message is the builder's`);
      assert.match(builder.message, rule, `${name}: the builder names the rule it breaks: ${builder.message}`);
    }
  }
});

test('W4 P1 (2) the same payloads, to the site’s reading and to buildLayoutNode: the same accept or refuse on each', () => {
  for (const [name, payload] of [...MALFORMED.map(([n, p]) => [n, p] as const), ...ACCEPTED]) {
    const builder = builderAccepts(payload);
    const site = siteAccepts(payload);
    assert.equal(site.ok, builder.ok, `${name}: the builder ${builder.ok ? 'accepts' : 'refuses'} it, the site ${site.ok ? 'accepts' : 'refuses'} it`);
    if (!builder.ok && !site.ok) {
      assert.equal(site.message, `ANSWER_LAYOUT: ${builder.message}`, `${name}: the site refuses with the builder's message, naming the setting`);
    }
  }
  assert.ok(ACCEPTED.every(([, p]) => builderAccepts(p).ok), 'premise: the builder accepts every well-formed payload');
});

test('W4 P1 (2) the path form reads the file and refuses with the builder’s message too', () => {
  const files: Record<string, string> = {
    '/layouts/good.json': JSON.stringify(VALID),
    '/layouts/bad.json': JSON.stringify(withField('version', 0)),
  };
  const readFile = (p: string) => {
    if (!(p in files)) throw new AnswerLayoutConfigurationError('ANSWER_LAYOUT_PATH names a file this server cannot read.');
    return files[p];
  };
  assert.equal(resolveAnswerLayouts({ path: '/layouts/good.json' }, { readFile }).default.name, 'fixture-valid');
  assert.throws(
    () => resolveAnswerLayouts({ path: '/layouts/bad.json' }, { readFile }),
    (err: Error) => err.message === 'ANSWER_LAYOUT_PATH (the file it names): buildLayoutNode: version must be an integer of at least 1',
  );
  assert.throws(() => resolveAnswerLayouts({ path: '/nowhere/w4p1-missing.json' }), /ANSWER_LAYOUT_PATH names a file this server cannot read/);
});

// --- item 3: the reading -------------------------------------------------------------------

test('W4 P1 item 3: absent means the built-in default; blank is absent', () => {
  for (const setting of [{}, { inline: '' }, { inline: '   ', path: '\n', url: ' ' }]) {
    const reading = resolveAnswerLayouts(setting);
    assert.equal(reading.default, ANSWER_FIRST);
    assert.deepEqual(reading.offered, [ANSWER_FIRST, ENVELOPE_ORDER]);
  }
});

test('W4 P1 item 3: a configured layout is the default and is offered first, beside the built-ins', () => {
  const reading = resolveAnswerLayouts({ inline: JSON.stringify(VALID) });
  assert.deepEqual(reading.default, VALID);
  assert.deepEqual(reading.offered.map(layoutId), ['fixture-valid@1', 'answer-first@1', 'envelope-order@1']);
  const builtIn = resolveAnswerLayouts({ inline: JSON.stringify(ENVELOPE_ORDER) });
  assert.deepEqual(builtIn.offered.map(layoutId), ['envelope-order@1', 'answer-first@1'], 'a built-in, configured, is offered once');
  assert.deepEqual(builtIn.default, ENVELOPE_ORDER);
});

test('W4 P1 item 3: the URL form is refused, never ignored, and names the forms that work', () => {
  for (const setting of [{ url: 'https://records.example.test/api/records/x/package' }, { url: 'https://x.test/p', inline: JSON.stringify(VALID) }]) {
    assert.throws(() => resolveAnswerLayouts(setting), (err: Error) =>
      err instanceof AnswerLayoutConfigurationError &&
      /ANSWER_LAYOUT_URL is set, and this version does not read it/.test(err.message) &&
      /arrives with LAYOUT-WEB W4 P2/.test(err.message) &&
      /ANSWER_LAYOUT or ANSWER_LAYOUT_PATH/.test(err.message));
  }
});

test('W4 P1 item 3: both document forms set, a document that is not JSON, and a built-in’s name with other fields are refused', () => {
  assert.throws(() => resolveAnswerLayouts({ inline: JSON.stringify(VALID), path: '/x.json' }), /ANSWER_LAYOUT and ANSWER_LAYOUT_PATH are both set/);
  assert.throws(() => resolveAnswerLayouts({ inline: '{"name": "answer-first",' }), /ANSWER_LAYOUT does not contain valid JSON/);
  const twin = { ...structuredClone(ANSWER_FIRST), order: [...ANSWER_FIRST.order].reverse() };
  assert.throws(() => resolveAnswerLayouts({ inline: JSON.stringify(twin) }), /named answer-first v1, a built-in's name and version, with different fields/);
});

test('W4 P1 reading 6: a configured layout naming an unknown part is accepted, and the reading says so in one server log line', () => {
  const lines: string[] = [];
  const payload = { ...structuredClone(VALID), order: [...VALID.order, 'TIMELINE-w4p1'], disclosure: { ...VALID.disclosure, order: ['APPENDIX-w4p1', ...VALID.disclosure.order] } };
  const reading = resolveAnswerLayouts({ inline: JSON.stringify(payload) }, { warn: (line) => lines.push(line) });
  assert.deepEqual(reading.unknownParts, ['TIMELINE-w4p1', 'APPENDIX-w4p1']);
  assert.deepEqual(lines, ['[answer-layout] ANSWER_LAYOUT names parts this renderer does not know, which render nothing: "TIMELINE-w4p1", "APPENDIX-w4p1".']);
  resolveAnswerLayouts({ inline: JSON.stringify(VALID) }, { warn: (line) => lines.push(line) });
  assert.equal(lines.length, 1, 'a layout whose names are all known logs nothing');
});

// --- reading 1: the name map, pinned ----------------------------------------------------------

test('W4 P1 reading 1: the name map, page parts and disclosure sections, in their default places', () => {
  assert.deepEqual(PAGE_PARTS.map((p) => [p.name, p.view]), [
    ['status', 'status-row'],
    ['answer', 'answer'],
    ['citation', 'citation'],
    ['steps', 'steps'],
    ['sources', 'sources'],
    ['disclosure', 'disclosure'],
    ['actions', 'actions'],
  ]);
  assert.deepEqual(DISCLOSURE_SECTIONS.map((s) => [s.name, s.view]), [
    ['A', 'question'],
    ['B', 'instructions'],
    ['C', 'environment'],
    ['D', 'trace'],
    ['E', 'notebook'],
    ['F', 'answer-again'],
    ['G', 'summary'],
    ['signers', 'signers'],
    ['provenance-graph', 'provenance-graph'],
    ['additional-artifacts', 'additional-artifacts'],
    ['evaluations', 'evaluations'],
    ['attestations', 'attestations'],
    ['verification', 'verification'],
    [null, 'surface-extras'],
  ]);
  assert.deepEqual([...PART_ORDER], ['status-row', 'answer', 'citation', 'steps', 'sources', 'disclosure', 'actions'], 'the view’s part order is the table’s');
});

// --- item 7: the placement rule -----------------------------------------------------------------

test('W4 P1 item 7: under answer-first, every part and every section sits at its default place', () => {
  assert.deepEqual(pageOrder(ANSWER_FIRST), {
    order: ['status-row', 'answer', 'citation', 'steps', 'sources', 'disclosure', 'actions'],
    unknown: [],
  });
  assert.deepEqual(disclosureOrder(ANSWER_FIRST), {
    order: [
      'question', 'instructions', 'environment', 'trace', 'notebook', 'answer-again', 'summary', 'signers',
      'provenance-graph', 'additional-artifacts', 'evaluations', 'attestations', 'verification', 'surface-extras',
    ],
    unknown: [],
  }, 'F and the record’s three unnamed sections at their default places');
});

test('W4 P1 item 7: a part a layout does not name renders directly after the part before it in the default order, or first', () => {
  const table = [{ name: 'a', view: 'A' }, { name: 'b', view: 'B' }, { name: 'c', view: 'C' }, { name: null, view: 'X' }] as const;
  assert.deepEqual(placeParts(table, ['c', 'a']).order, ['C', 'X', 'A', 'B'], 'b after a; the unnameable part after c, the part before it');
  assert.deepEqual(placeParts(table, ['b']).order, ['A', 'B', 'C', 'X'], 'a first, as nothing precedes it');
  assert.deepEqual(placeParts(table, []).order, ['A', 'B', 'C', 'X'], 'nothing named: the default places');
  assert.deepEqual(placeParts(table, ['c', 'c', 'b']).order, ['A', 'C', 'X', 'B'], 'a repeated name keeps its first place');
  assert.deepEqual(placeParts(table, ['X', 'zz', 'c', 'zz']), { order: ['A', 'B', 'C', 'X'], unknown: ['X', 'zz'] }, 'an unknown name, and the unnameable part’s view name, render nothing');
  assert.deepEqual(pageOrder(ENVELOPE_ORDER).order, ['status-row', 'disclosure', 'steps', 'answer', 'sources', 'citation', 'actions']);
});

test('W4 P1 item 7: an eighth part needs one row and no layout change; the built-ins stay valid', () => {
  const eighth = [...PAGE_PARTS, { name: 'routing', view: 'routing' }] as const;
  assert.equal(BUILT_IN_LAYOUTS.length, 2, 'premise: the two built-ins');
  for (const layout of BUILT_IN_LAYOUTS) {
    const placed = placeParts(eighth, layout.order);
    assert.equal(placed.order.at(-1), 'routing', `${layout.name}: the new part renders at its default place`);
    assert.equal(placed.order.length, 8, `${layout.name}: every part present`);
  }
});

// --- item 4, reading 5: the reader's choice ----------------------------------------------------

test('W4 P1 item 4: the session key sits beside the mode and comparison keys, and is its own', () => {
  assert.equal(LAYOUT_STORAGE_KEY, 'civicaitools.answerLayout');
  assert.equal(new Set([MODE_STORAGE_KEY, COMPARISON_STORAGE_KEY, LAYOUT_STORAGE_KEY]).size, 3);
});

test('W4 P1 item 4: a stored choice counts only when the instance offers it; otherwise the instance’s default', () => {
  const offered = BUILT_IN_INSTANCE_LAYOUTS.offered;
  assert.equal(parseStoredLayoutChoice('envelope-order@1', offered), 'envelope-order@1');
  for (const raw of [null, '', 'envelope-order', 'envelope-order@2', 'fixture-valid@1']) {
    assert.equal(parseStoredLayoutChoice(raw, offered), null, `${JSON.stringify(raw)} is no choice`);
  }
  assert.equal(selectLayout(BUILT_IN_INSTANCE_LAYOUTS, null), ANSWER_FIRST, 'no choice: the default');
  assert.equal(selectLayout(BUILT_IN_INSTANCE_LAYOUTS, 'envelope-order@1'), ENVELOPE_ORDER, 'the choice');
  assert.equal(selectLayout(BUILT_IN_INSTANCE_LAYOUTS, 'gone@1'), ANSWER_FIRST, 'a choice the instance no longer offers: the default');
  const configured = { default: VALID, offered: [VALID, ANSWER_FIRST, ENVELOPE_ORDER] };
  assert.equal(selectLayout(configured, null), VALID, 'the instance’s default is its own');
});

test('W4 P1 (5) the foot line, word for word', () => {
  assert.equal(layoutLine(ANSWER_FIRST), 'Shown under layout answer-first v1');
  assert.equal(layoutLine(ENVELOPE_ORDER), 'Shown under layout envelope-order v1');
});
