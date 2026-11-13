// S2-B D3, R5 and F9 (npstorey/civic-ai-tools#309): what the chooser line says about a loaded pack, and what an
// in-loop record says it considered.
//
// D3 = A (the owner's ruling 6754135228). A loaded source the record names as a pack reads
// "Loaded: NYC City Record (a pack recorded as nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx, using Socrata)."
// The clause is bundle revision 3's fallback (`:331`) for an inventory this site does not resolve: no author, no
// name for the pack inside it. The id comes from the record and is never shortened, linked or split; the line
// carries it as one code part (the seat's 6779017419). The base's name is this site's name for the call's
// `mcp.source`.
//
// HOW A SOURCE IS KNOWN TO BE A PACK. By what the record states, and nothing installed: a call span whose
// `tool.name` begins with the source's offered alias and `__` and that states `mcp.pack_id`. A call refused by the
// pack's filter states it too. A pack that loaded and made no call states no pack id, so it reads as any loaded
// source. When one source's calls state two different pack ids (or two bases), the record does not say which one
// the source was, so the line names the source without a clause.
//
// R5 (D4 = A). "A pack is …" follows the groups once, and only when a pack clause shows, as a line of its own kind
// (`kind: 'definition'`), which `WhereItWent.tsx` renders as a paragraph after the groups.
//
// F9, case 1 (the seat's 6768947217, item 4). Bundle `:70`: the in-loop sentence is "followed, when the record
// carries composition.considered, by that entry's sentences" (`:88`). The inventory's id (this site has no name
// for it) and its version print whole; a recorded rule and rule version are echoed through `echoCapped`. A record
// with no `considered`, or one that is not well formed, states no count.
//
// RED at tree 5b (d99f2532): the Loaded line names no pack, there is no definition line, and the first line is the
// in-loop sentence alone.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooserFromPackage, chooserFromTrace, chooserLines } from './source-chooser.ts';
import { CHOOSER_REASONS, ECHO_LIMIT, SOURCE_CHOOSER_TEXT as T } from '../sources/copy.ts';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PACK_ID = 'nyc-record@https://data.cityofnewyork.us/d/dg92-zbpx';
const OTHER_PACK_ID = 'nyc-record@https://data.cityofnewyork.us/d/aaaa-1111';
const R5 = 'A pack is a source with no server of its own. Its requests go through the server of the source named after “using”, limited to what the pack fixes in advance, such as one dataset.';
const D3_LINE = `Loaded: NYC City Record (a pack recorded as ${PACK_ID}, using Socrata).`;
const D3_PARTS = [{ text: 'Loaded: NYC City Record (a pack recorded as ' }, { text: PACK_ID, code: true }, { text: ', using Socrata).' }];
const INVENTORY = { id: 'civic', version: '2026-11-09.1+ed7302810ed4', hash: 'ed7302810ed46a452381083e50fefe99ce284bcbbfdcf926d4c192c069453442' };
const CONSIDERED = { inventory: INVENTORY, total: 7, listed: 4, rule: 'directory-set', ruleVersion: '1' };
const SHOWN = 'The model was shown 4 of the 7 sources in the source inventory civic (version 2026-11-09.1+ed7302810ed4).';
const DIRECTORY_SET_1 = 'Those were the sources set up on the site that ran this question, less any turned off for it.';

// --- Fixture traces ------------------------------------------------------------------------------

const OFFERED = [
  { sourceId: 'socrata', alias: 'socrata', reason: 'selected' },
  { sourceId: 'data-commons', alias: 'data_commons', reason: 'selected' },
  { sourceId: 'nyc-record', alias: 'nyc_record', reason: 'selected' },
];
const attr = (key: string, value: string | boolean) =>
  ({ key, value: typeof value === 'boolean' ? { boolValue: value } : { stringValue: value } });
const root = (considered?: unknown) => ({
  name: 'analysis',
  spanId: 'root',
  attributes: [
    attr('analysis.routing', JSON.stringify({ method: 'in-loop', version: '0.8.0' })),
    attr('analysis.sources_offered', JSON.stringify(OFFERED)),
    ...(considered === undefined ? [] : [attr('analysis.considered', JSON.stringify(considered))]),
  ],
});
const load = (alias: string, outcome: string) => ({
  name: 'mcp_tool_call',
  parentSpanId: 'root',
  attributes: [attr('tool.name', 'load_source'), attr('tool.operation_type', 'load_source'), attr('tool.arguments', JSON.stringify({ alias })), attr('tool.load_outcome', outcome)],
});
/** A data call as the loop writes it: a pack's call names the base's source and alias, and the pack's id. */
const call = (toolName: string, packId?: string, refused = false, base = 'socrata') => ({
  name: 'mcp_tool_call',
  parentSpanId: 'root',
  attributes: [
    attr('tool.name', toolName),
    attr('tool.operation_type', 'query'),
    attr('mcp.source', base),
    attr('mcp.alias', base),
    ...(packId ? [attr('mcp.pack_id', packId)] : []),
    ...(refused ? [attr('error', true)] : []),
  ],
});
const traceOf = (spans: unknown[], considered?: unknown) => ({ resourceSpans: [{ scopeSpans: [{ spans: [root(considered), ...spans] }] }] });
/** The record a trace is packaged into: the composition the chooser reads, with the same trace. */
const recordOf = (spans: unknown[], considered?: unknown) => ({
  trace: traceOf(spans, considered),
  extensions: {
    'org.civicaitools.composition': {
      sourcesOffered: OFFERED,
      routing: { method: 'in-loop', version: '0.8.0' },
      definitionHash: 'f'.repeat(64),
      ...(considered === undefined ? {} : { considered }),
    },
  },
});

const linesOfRecord = (spans: unknown[], considered?: unknown) => chooserLines(chooserFromPackage(recordOf(spans, considered))) as unknown as Loose[];
const loadedLine = (lines: Loose[]) => lines.find((l) => String(l.text).startsWith(T.loaded));
const definitions = (lines: Loose[]) => lines.filter((l) => l.kind === 'definition');

// --- D3 and R5 -------------------------------------------------------------------------------------

test('S2-B D3: a loaded pack whose call states its id reads with the clause, the id whole in one code part', () => {
  const lines = linesOfRecord([load('nyc_record', 'loaded'), call('nyc_record__get_data', PACK_ID)]);
  const loaded = loadedLine(lines);
  assert.equal(loaded?.text, D3_LINE);
  assert.deepEqual(loaded?.parts, D3_PARTS);
});

test('S2-B D3: the id is never cut to the echo limit, linked or split, and the line\'s period follows the base\'s name', () => {
  assert.ok(PACK_ID.length > ECHO_LIMIT, 'premise: the id is longer than the echo limit');
  const loaded = loadedLine(linesOfRecord([load('nyc_record', 'loaded'), call('nyc_record__get_data', PACK_ID)]));
  const code = (loaded?.parts as Loose[] | undefined)?.filter((p) => p.code === true) ?? [];
  assert.deepEqual(code.map((p) => p.text), [PACK_ID]);
  assert.equal(String(loaded?.text).includes('…'), false);
  assert.ok(String(loaded?.text).endsWith('using Socrata).'));
});

test('S2-B R5: the definition follows the groups once, last, only beside a pack clause', () => {
  const lines = linesOfRecord([load('nyc_record', 'loaded'), call('nyc_record__get_data', PACK_ID), call('nyc_record__get_data', PACK_ID)]);
  assert.deepEqual(definitions(lines), [{ text: R5, kind: 'definition' }]);
  assert.deepEqual(lines.at(-1), { text: R5, kind: 'definition' });
  assert.ok(String(lines.at(-2)?.text).startsWith(T.neverAsked), 'the definition is not after the groups');
});

test('S2-B D3: a pack call refused by the pack\'s filter states the id too, so the clause shows', () => {
  const lines = linesOfRecord([load('nyc_record', 'loaded'), call('nyc_record__get_data', PACK_ID, true)]);
  assert.equal(loadedLine(lines)?.text, D3_LINE);
  assert.equal(definitions(lines).length, 1);
});

test('S2-B D3 (R\'s open note on R4): a pack that loaded and made no call reads as any loaded source, with no definition', () => {
  const lines = linesOfRecord([load('nyc_record', 'loaded')]);
  assert.deepEqual(loadedLine(lines), { text: `${T.loaded}NYC City Record.` });
  assert.deepEqual(definitions(lines), []);
});

test('S2-B D3: the pack beside a loaded Socrata: the two joined by "; ", the clause on the pack only, the definition once', () => {
  const lines = linesOfRecord([
    load('socrata', 'loaded'),
    load('nyc_record', 'loaded'),
    call('socrata__get_data'),
    call('nyc_record__get_data', PACK_ID),
  ]);
  const loaded = loadedLine(lines);
  assert.equal(loaded?.text, `Loaded: Socrata${T.separator}NYC City Record (a pack recorded as ${PACK_ID}, using Socrata).`);
  assert.deepEqual(loaded?.parts, [{ text: `Loaded: Socrata${T.separator}NYC City Record (a pack recorded as ` }, { text: PACK_ID, code: true }, { text: ', using Socrata).' }]);
  assert.equal(definitions(lines).length, 1);
});

test('S2-B D3 (pinned): when one source\'s calls state two different pack ids, the line names the source without a clause', () => {
  const lines = linesOfRecord([load('nyc_record', 'loaded'), call('nyc_record__get_data', PACK_ID), call('nyc_record__fetch', OTHER_PACK_ID)]);
  assert.deepEqual(loadedLine(lines), { text: `${T.loaded}NYC City Record.` });
  assert.deepEqual(definitions(lines), []);
});

test('S2-B D3: a pack id is tied to a source by the call\'s alias prefix, so a requested, not loaded pack takes no clause', () => {
  const lines = linesOfRecord([load('socrata', 'loaded'), load('nyc_record', 'declined'), call('socrata__get_data'), call('nyc_record__get_data', PACK_ID, true)]);
  assert.deepEqual(loadedLine(lines), { text: `${T.loaded}Socrata.` });
  const asked = lines.find((l) => String(l.text).startsWith(T.askedNotLoaded.trimEnd()));
  assert.deepEqual(asked?.items, [`NYC City Record${T.reasonSeparator}${CHOOSER_REASONS.declined}`]);
  assert.deepEqual(definitions(lines), []);
});

test('S2-B D3 decoy: a record whose loaded source states no pack id has no clause, no code part and no definition', () => {
  const lines = linesOfRecord([load('socrata', 'loaded'), call('socrata__get_data')]);
  assert.deepEqual(loadedLine(lines), { text: `${T.loaded}Socrata.` });
  assert.equal(lines.some((l) => l.parts !== undefined || l.kind !== undefined), false);
});

test('S2-B D3: a run page reads the same line from the trace as the record page does from the record', () => {
  const spans = [load('nyc_record', 'loaded'), call('nyc_record__get_data', PACK_ID)];
  assert.deepEqual(chooserLines(chooserFromTrace(traceOf(spans, CONSIDERED))!), chooserLines(chooserFromPackage(recordOf(spans, CONSIDERED))));
});

// --- F9: what the record says it considered ------------------------------------------------------

test('S2-B F9: an in-loop record with considered states the count, the inventory and the rule\'s words after the in-loop sentence', () => {
  const [first] = linesOfRecord([load('socrata', 'loaded')], CONSIDERED);
  assert.deepEqual(first, { text: `${T.inLoop} ${SHOWN} ${DIRECTORY_SET_1}` });
});

test('S2-B F9: a run page reads the root span\'s analysis.considered the same way', () => {
  const [first] = chooserLines(chooserFromTrace(traceOf([load('socrata', 'loaded')], CONSIDERED))!);
  assert.equal(first.text, `${T.inLoop} ${SHOWN} ${DIRECTORY_SET_1}`);
});

test('S2-B F9: a rule, or a rule version, this site has no words for is named as recorded, echoed capped', () => {
  const [unknown] = linesOfRecord([], { ...CONSIDERED, rule: 'nearest-sources', ruleVersion: '3' });
  assert.equal(unknown.text, `${T.inLoop} ${SHOWN} They were chosen by a rule recorded as nearest-sources, version 3, which this site has no words for.`);
  const [laterVersion] = linesOfRecord([], { ...CONSIDERED, ruleVersion: '2' });
  assert.equal(laterVersion.text, `${T.inLoop} ${SHOWN} They were chosen by a rule recorded as directory-set, version 2, which this site has no words for.`);
  const long = 'r'.repeat(ECHO_LIMIT + 10);
  const [capped] = linesOfRecord([], { ...CONSIDERED, rule: long, ruleVersion: long });
  const cut = `${'r'.repeat(ECHO_LIMIT - 1)}…`;
  assert.equal(capped.text, `${T.inLoop} ${SHOWN} They were chosen by a rule recorded as ${cut}, version ${cut}, which this site has no words for.`);
});

test('S2-B F9: the inventory\'s id and version print whole, however long', () => {
  const inventory = { ...INVENTORY, id: `civic-${'i'.repeat(60)}`, version: `2026-11-09.1+${'a'.repeat(60)}` };
  const [first] = linesOfRecord([], { ...CONSIDERED, inventory });
  assert.ok(String(first.text).includes(`in the source inventory ${inventory.id} (version ${inventory.version}).`), first.text);
});

test('S2-B F9 decoy: a record with no considered, or one not well formed, states no count; an all-sources record states none either', () => {
  assert.deepEqual(linesOfRecord([load('socrata', 'loaded')])[0], { text: T.inLoop });
  for (const bad of [{ ...CONSIDERED, listed: '4' }, { ...CONSIDERED, inventory: { id: 'civic' } }, { ...CONSIDERED, rule: 7 }, 'directory-set', null]) {
    assert.deepEqual(linesOfRecord([load('socrata', 'loaded')], bad)[0], { text: T.inLoop }, JSON.stringify(bad));
  }
  const allSources = { ...recordOf([], CONSIDERED) };
  (allSources.extensions['org.civicaitools.composition'] as Loose).routing = { method: 'all-sources' };
  assert.deepEqual(chooserLines(chooserFromPackage(allSources)), [{ text: T.allSources }]);
});
