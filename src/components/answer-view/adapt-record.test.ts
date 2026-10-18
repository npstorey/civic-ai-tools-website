// LAYOUT-WEB W3 P2: the record adapter — a published record and its row in,
// the answer view's model out (design §4.2 option A, the third adapter).
//
// WHAT IS DRIVEN. `adaptRecord`, a pure function, called with packages shaped
// as the store holds them. The page's render test
// (`src/app/(app)/evidence/[slug]/record-page-layout.test.ts`) drives the same
// adapter through the page and reads the markup; this file reads the model.
//
// WHAT EACH AUTHOR LINE READS (design §6), measured where the record states it:
//   - the question: the package's `prompt`, the question the person asked —
//     "Question, written by the person who asked";
//   - the answer: `cost.model` — "Answer, written by the model <name>";
//   - the citation: assembled by the page from the row, so by this instance;
//   - the steps: written when the page renders, by this instance;
//   - B, the instructions: the instance composed them only for a record
//     captured by its own chat flow (`captureMethod` `chat-flow-stream`, the
//     package's signed label, else the row's; `serverAddressPolicy` in
//     `packager.ts` reads the same label for the same question). A record a
//     Claude Code session captured carries the instructions that session sent
//     (`skillMetadataOverride`), and one that states no capture method does not
//     say who wrote them: no line;
//   - G, the summary: the package carries `summary` as a string, and nothing
//     that names what produced it. The publish dialog fills it from the
//     notebook's structured summary, a model call, the answer's first
//     paragraph, or what the person typed (`PublishEvidenceDialog.tsx`), and
//     records none of the four. No line: an author is not guessed.
//
// THE FIXTURES CAN FAIL. Each package's `output` differs from its notebook's
// rendering cell, so an adapter that read the wrong one shows it; each author
// line is computed from §6's words with the fixture's instance and model.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/answer-view/adapt-record.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptNotebook } from './adapt-notebook.ts';
import { formatModelName } from '../../lib/models.ts';

/**
 * The module this phase adds, named by a specifier typed `string` so the
 * compiler does not resolve it: the red commit holds this file before the
 * module exists, and must type-check (the seam `skeleton-states-that-it-did-not-run.test.ts` uses).
 */
const ADAPTER: string = './adapt-record.ts';

type Model = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface AdapterModule {
  adaptRecord?: (input: Record<string, unknown>) => Model;
}
const mod = (await import(ADAPTER).catch(() => null)) as AdapterModule | null;

function adapter(): (input: Record<string, unknown>) => Model {
  assert.ok(mod?.adaptRecord, `no record adapter: ${ADAPTER} exporting adaptRecord(input) does not exist`);
  return mod!.adaptRecord!;
}

// --- Fixtures -------------------------------------------------------------------

const INSTANCE = 'records.example.test';
const MODEL = 'openai/gpt-4o';
const OUTPUT = 'OUTPUTFIELD-w3p2: the record’s `output` field.';
const CELL_ANSWER = 'CELLANSWER-w3p2: the rendering cell’s markdown.';
const TABLE = { output_type: 'execute_result', metadata: {}, data: { 'text/html': '<table><tr><td>TABLE-w3p2</td></tr></table>' } };
const markdown = (md: string) => ({ output_type: 'display_data', metadata: {}, data: { 'text/markdown': md } });

function notebook(provenance: 'executed' | 'skeleton' | null, outputs: unknown[] | null) {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { extensions: provenance === null ? {} : { 'org.civicaitools.notebook': { provenance } } },
    cells: [
      { cell_type: 'markdown', metadata: {}, source: ['# NOTEBOOKMARKER-w3p2\n'] },
      ...(outputs === null ? [] : [{ cell_type: 'code', metadata: { role: 'synthesis' }, execution_count: 1, source: ['display(Markdown(a))\n'], outputs }]),
    ],
  };
}

function pkg(overrides: Record<string, unknown> = {}, nb: unknown = undefined): Record<string, unknown> {
  return {
    metadata: { schemaVersion: '0.1.0', packageId: 'w3p2', createdAt: '2026-10-09T16:10:07.804Z', signingKeyId: 'platform:fixture', captureMethod: 'chat-flow-stream', contentProfile: 'datHere' },
    prompt: { hash: 'd'.repeat(64), visibility: 'full_text', text: 'PROMPTMARKER-w3p2 How many?' },
    queries: [
      { tool: 'socrata__get_data', operationType: 'query', datasetId: 'aaaa-1111', portal: 'data.example.test', arguments: { dataset_id: 'aaaa-1111' }, resultRows: 12, resultColumns: 3, duration_ms: 410 },
    ],
    cost: { model: MODEL, promptTokens: 10, completionTokens: 5, totalTokens: 15, durationMs: 1000 },
    skillMetadata: { skillText: 'SKILLMARKER-w3p2', systemPromptHash: 'e'.repeat(64) },
    output: OUTPUT,
    summary: 'SUMMARYMARKER-w3p2',
    dataSources: [],
    extensions: nb === undefined ? {} : { 'org.civicaitools.notebook': nb },
    ...overrides,
  };
}

const ROW = { slug: 'w3p2-record', summary: 'ROWSUMMARY-w3p2', contentProfile: 'datHere', captureMethod: 'chat-flow-stream' };

/** The page's input for a package as stored, with the output already inline (no blob). */
function input(p: Record<string, unknown> | null, row: Record<string, unknown> = ROW, instance: string | null = INSTANCE) {
  return {
    stored: p,
    resolution: p === null ? null : { pkg: p, outputIsBlob: false, outputBlobRef: null, skillTextIsBlob: false, skillTextBlobRef: null },
    row,
    instance,
  };
}

// §6's words, with the fixture's instance and model.
const SECTION_6 = {
  question: 'Question, written by the person who asked',
  answer: `Answer, written by the model ${formatModelName(MODEL)}`,
  computed: 'Tables and figures, computed in the sandbox from the data returned',
  citation: `Citation, assembled by ${INSTANCE}`,
  steps: `Steps, written by ${INSTANCE} from the model's calls`,
  instructions: `Instructions, written by ${INSTANCE} and the data source's skill`,
};

/** The executed run's answer part for a notebook, as its own adapter takes it. */
function runAnswer(nb: unknown) {
  return adaptNotebook({
    notebook: nb as never, prompt: 'x', model: MODEL, portal: 'data.example.test', toolCalls: [], instance: INSTANCE, socrataMcpUrl: null,
  }).answer;
}

// --- Criterion (6): the answer -----------------------------------------------------

test('W3 P2 (6) a record carrying an executed notebook with a rendering cell answers with that cell’s outputs, as adapt-notebook takes them', () => {
  for (const [name, outputs] of [
    ['one markdown output', [markdown(CELL_ANSWER)]],
    ['a markdown output and a table', [markdown(CELL_ANSWER), TABLE]],
  ] as const) {
    const nb = notebook('executed', [...outputs]);
    const model = adapter()(input(pkg({}, nb)));
    assert.notDeepEqual(model.answer?.content, { kind: 'markdown', markdown: OUTPUT }, `${name}: the answer is the cell’s, not the record’s output`);
    assert.deepEqual(model.answer, runAnswer(nb), `${name}: the record’s answer part is the executed run’s, for the same notebook`);
  }
  const table = adapter()(input(pkg({}, notebook('executed', [markdown(CELL_ANSWER), TABLE]))));
  assert.deepEqual(table.answer.authors.map((a: { text: string }) => a.text), [SECTION_6.answer, SECTION_6.computed], 'a table the cell computed names both authors');
});

test('W3 P2 (6) otherwise the answer is the record’s output: no notebook, no rendering cell, or a notebook that does not say it ran', () => {
  for (const [name, nb] of [
    ['no notebook', undefined],
    ['an executed notebook with no rendering cell', notebook('executed', null)],
    ['an executed notebook whose rendering cell holds no output', notebook('executed', [])],
    ['a skeleton notebook with a rendering cell', notebook('skeleton', [markdown(CELL_ANSWER)])],
    ['a notebook that does not state whether it ran', notebook(null, [markdown(CELL_ANSWER)])],
  ] as const) {
    const model = adapter()(input(pkg({}, nb)));
    assert.deepEqual(model.answer?.content, { kind: 'markdown', markdown: OUTPUT }, `${name}: the answer is the record’s output`);
    assert.deepEqual(model.answer.authors, [{ key: 'answer', text: SECTION_6.answer }], `${name}: one author, the model`);
    assert.equal(model.disclosure.answerAgain, true, `${name}: the answer is placed again as F`);
  }
});

test('W3 P2 (6) an answer over 2000 characters reaches the model whole, from the output and from a rendering cell', () => {
  const long = `LONGSTART-w3p2 ${'The figures were read from the portal. '.repeat(120)}LONGEND-w3p2`;
  assert.ok(long.length > 4000, 'premise: the answer is over 2000 characters, twice over');
  const fromOutput = adapter()(input(pkg({ output: long })));
  assert.equal(fromOutput.answer.content.markdown, long);
  const fromCell = adapter()(input(pkg({}, notebook('executed', [markdown(long)]))));
  assert.equal(fromCell.answer.content.markdown, long);
});

// --- Criterion (1): who wrote each part, by what the record states -------------------

test('W3 P2 (1) the author lines read §6’s words, for a record its instance’s chat flow captured', () => {
  const model = adapter()(input(pkg({}, notebook('executed', null))));
  assert.deepEqual(model.answer.authors, [{ key: 'answer', text: SECTION_6.answer }]);
  assert.equal(model.recordCitation?.author, SECTION_6.citation);
  assert.equal(model.citation, null, 'the record has no pre-publication preview');
  assert.equal(model.steps?.author, SECTION_6.steps);
  assert.equal(model.disclosure.question?.author, SECTION_6.question);
  assert.equal(model.disclosure.recordInstructions?.author, SECTION_6.instructions);
  assert.deepEqual(model.disclosure.summary, { kind: 'stated', author: null, text: 'SUMMARYMARKER-w3p2' },
    'G carries the record’s summary under no author line: the record does not state what produced it');
});

test('W3 P2 (1) B names no author for a record captured elsewhere, or one that states no capture method', () => {
  const claudeCode = adapter()(input(
    pkg({ metadata: { schemaVersion: '0.1.0', packageId: 'w3p2', createdAt: '2026-10-09T16:10:07.804Z', signingKeyId: 'x', captureMethod: 'claude-code-jsonl-readback' } }),
    { ...ROW, captureMethod: 'claude-code-jsonl-readback' },
  ));
  assert.ok(claudeCode.disclosure.recordInstructions, 'premise: B renders (the record carries its skill text)');
  assert.equal(claudeCode.disclosure.recordInstructions.author, null, 'a Claude Code capture: the instance did not write its instructions');

  const unstated = adapter()(input(
    pkg({ metadata: { schemaVersion: '0.1.0', packageId: 'w3p2', createdAt: '2026-05-02T10:00:00.000Z', signingKeyId: 'x' } }),
    { ...ROW, captureMethod: null, contentProfile: null },
  ));
  assert.equal(unstated.disclosure.recordInstructions.author, null, 'no capture method stated: no author named');

  const rowOnly = adapter()(input(
    pkg({ metadata: { schemaVersion: '0.1.0', packageId: 'w3p2', createdAt: '2026-05-02T10:00:00.000Z', signingKeyId: 'x' } }),
    { ...ROW, captureMethod: 'chat-flow-stream' },
  ));
  assert.equal(rowOnly.disclosure.recordInstructions.author, SECTION_6.instructions, 'the row states it when the package predates the label');
});

test('W3 P2 (1) with no instance declared, the lines that name it are omitted and the others stay', () => {
  const model = adapter()(input(pkg(), ROW, null));
  assert.equal(model.recordCitation?.author, null);
  assert.equal(model.steps?.author, null);
  assert.equal(model.disclosure.recordInstructions?.author, null);
  assert.equal(model.disclosure.question?.author, SECTION_6.question);
  assert.deepEqual(model.answer.authors, [{ key: 'answer', text: SECTION_6.answer }]);
});

// --- The parts the record has, and only those ---------------------------------------

test('W3 P2 the record’s parts: the status row’s reading and links, the refused lines, the steps, no sources line', () => {
  const refused = pkg({
    queries: [
      { tool: 'get_data', operationType: 'query', datasetId: 'aaaa-1111', portal: 'data.example.test', arguments: { dataset_id: 'aaaa-1111' }, resultRows: 12, resultColumns: 3, duration_ms: 410 },
      { tool: 'get_data', operationType: 'query', datasetId: 'bbbb-2222', portal: 'data.example.test', arguments: { dataset_id: 'bbbb-2222' }, failed: true, failureKind: 'timeout', duration_ms: 1200 },
    ],
  }, notebook('executed', null));
  const model = adapter()(input(refused));
  assert.deepEqual(model.status.facts.map((f: { text: string }) => f.text), ['Executed in a signed sandbox', 'Typed Standards §8.7', 'Download notebook (.ipynb)']);
  assert.equal(model.status.facts[2].href, '/api/records/w3p2-record/bundle');
  assert.equal(model.status.refused, '1 of 2 requests did not complete.');
  assert.equal(model.status.unrecorded, null);
  assert.equal(model.steps.kind, 'step-view');
  assert.equal(model.steps.view.steps.length, 2, 'one step per signed entry');
  assert.equal(model.sources, null, 'no sources line: see the page test’s header');
  assert.equal(model.disclosure.recordTrace.length, 2, 'D: one entry per call');
  assert.match(model.disclosure.recordTrace[1].outcome, /^This request did not complete\./);
  assert.equal(model.disclosure.recordNotebook.slug, 'w3p2-record');
});

test('W3 P2 a record whose package cannot be loaded keeps the row’s parts: the summary, the citation, the status links', () => {
  const model = adapter()(input(null));
  assert.deepEqual(model.answer, { content: { kind: 'absent' }, authors: [], streaming: false }, 'no answer is invented, and no author line names one');
  assert.equal(model.steps, null);
  assert.deepEqual(model.disclosure.summary, { kind: 'stated', author: null, text: 'ROWSUMMARY-w3p2' });
  assert.equal(model.disclosure.question, undefined);
  assert.equal(model.recordCitation.author, SECTION_6.citation);
  assert.deepEqual(model.status.facts.map((f: { text: string }) => f.text), ['Typed Standards §8.7', 'Download notebook (.ipynb)']);
});

// --- R7 P4 a2, carried: C's "MCP servers" expression ---------------------------------

test('R7 P4 a2 carried: C’s MCP servers line is each entry’s host, or its raw value when the URL has no host or does not parse', () => {
  const PURL = 'pkg:npm/%40example/hosted-source@0.1.0';
  assert.equal(new URL(PURL).host, '', 'premise: the purl parses with an empty host');
  const model = adapter()(input(pkg({
    extensions: {
      'org.civicaitools.environment': {
        mcpServers: [{ url: 'https://mcp.example.test/mcp' }, { url: PURL }, { url: 'not a url' }],
      },
    },
  })));
  const item = model.disclosure.environment.find((i: { label: string }) => i.label === 'MCP servers');
  assert.equal(item?.value, `mcp.example.test, ${PURL}, not a url`);
});

// --- The model crosses the client boundary --------------------------------------------

/** A value the server can hand a client component: no function, no class instance. */
function assertPlainData(value: unknown, at: string): void {
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return;
  assert.equal(typeof value, 'object', `${at} is a ${typeof value}`);
  if (Array.isArray(value)) { value.forEach((v, i) => assertPlainData(v, `${at}[${i}]`)); return; }
  const proto = Object.getPrototypeOf(value);
  assert.ok(proto === Object.prototype || proto === null, `${at} is an instance of ${proto?.constructor?.name}`);
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) assertPlainData(v, `${at}.${k}`);
}

test('W3 P2 the model is plain data, so the server page can hand it to the client view', () => {
  for (const p of [pkg({}, notebook('executed', [markdown(CELL_ANSWER), TABLE])), pkg(), null]) {
    assertPlainData(adapter()(input(p)), 'model');
  }
});

// --- W3 P2 fix 1 -------------------------------------------------------------------

test('W3 P2 fix 1 (1) an output blob the page could not fetch: the answer names no author and states that it is unavailable', () => {
  const blobRef = { ref: `blob:sha256:${'a'.repeat(64)}`, url: 'https://blobs.example.test/x.md', contentType: 'text/markdown', size: 1234 };
  const stored = pkg({ output: blobRef });
  const model = adapter()({
    stored,
    resolution: { pkg: { ...stored, output: 'PLACEHOLDER-w3p2f1' }, outputIsBlob: true, outputBlobRef: blobRef, outputUnavailable: true, skillTextIsBlob: false, skillTextBlobRef: null },
    row: ROW,
    instance: INSTANCE,
  });
  assert.equal(model.answer.content.kind, 'unavailable', 'the answer is stated unavailable, not rendered from the placeholder');
  assert.deepEqual(model.answer.authors, [], 'no line names the model over the site’s words');
  assert.equal(model.disclosure.answerNote, undefined, 'an output that was not fetched is not called verified');
  assert.equal(model.disclosure.answerAgain, true, 'F still says so, in the same words');
});

test('W3 P2 fix 1 (3) a multi-turn record’s transcript reaches the model whole', () => {
  const transcript = Array.from({ length: 6 }, (_, i) => `### Turn ${i} — ${i % 2 ? 'Assistant' : 'User'}\n\n${'Counted by month. '.repeat(30)}`).join('\n\n');
  assert.ok(transcript.length > 2000, 'premise: over 2000 characters');
  const model = adapter()(input(pkg({
    output: transcript,
    extensions: { 'org.civicaitools.multi-turn': { version: '0.1.0', turns: [{ index: 0, role: 'user', content: 'x' }] } },
  })));
  assert.deepEqual(model.answer.content, { kind: 'markdown', markdown: transcript });
});
