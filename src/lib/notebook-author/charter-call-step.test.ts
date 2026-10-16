// #617 P4 criterion 4 — a NYC Charter, Laws and Rules call in both notebooks,
// as a step each can honestly describe.
//
// Both generators read a call by its upstream name (`tool-to-cell.ts`'s
// `byUpstreamName`, `notebook.ts`'s `toolsCalled`), and `isAnalysisStep` is
// the one definition of a step both use. Charter's tools:
//   - `get_section` returns the text of a section of law: what an answer
//     about the law rests on. It is a STEP. Neither notebook has a helper that
//     calls a hosted source, so it is a step NOT REPRODUCED: stated, with no
//     code cell and no citation, in both documents. Filed under "discovery",
//     the executed notebook would tell its reader the step was a lookup the
//     data fetches below already encode, which nothing below does.
//   - `search`, `list_titles`, `get_title` and `get_version` find or list
//     what the corpus holds (matching sections, its chapters, its currency
//     date): discovery, listed once in the executed notebook's summary.
//
// THE SHAPE THAT CAN FAIL. The run holds a Charter search, a section read and
// a version read, and no other call: a generator that files the section read
// under discovery renders no step at all, and one that borrows Boston's
// "aggregated data" sentence for every not-reproduced step names a helper
// that has nothing to do with the call. The discovery line is read for its
// subject (b2): a Charter search finds sections of law, not datasets.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/notebook-author/charter-call-step.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateToolReason } from '../streaming.ts';
import { generateNotebook } from '../notebook.ts';
import {
  countAnalysisSteps,
  isAnalysisStep,
  renderDiscoverySummaryCell,
  renderFetchToolCell,
  type PhaseAToolCall,
} from './tool-to-cell.ts';

const call = (name: string, args: Record<string, unknown>, operationType?: string): PhaseAToolCall => ({
  name,
  args,
  ...(operationType ? { operationType } : {}),
  reason: generateToolReason(args, name),
});

const SEARCH = call('nyc_charter__search', { query: 'rent stabilization' }, 'search');
const SECTION = call('nyc_charter__get_section', { citation: '§ 26-504', corpus: 'admin_code' });
const VERSION = call('nyc_charter__get_version', {});
const RUN = [SEARCH, SECTION, VERSION];

const text = (cells: Array<{ source: string[] | string; cell_type?: string }>) =>
  cells.map((cell) => (Array.isArray(cell.source) ? cell.source.join('') : cell.source)).join('\n');

test('the section read is a step; the search and the version read are discovery', () => {
  assert.equal(isAnalysisStep(SECTION), true, 'get_section is filed as discovery');
  for (const other of [SEARCH, VERSION, call('nyc_charter__list_titles', { corpus: 'charter' }), call('nyc_charter__get_title', { corpus: 'charter', title: 'Chapter 1' })]) {
    assert.equal(isAnalysisStep(other), false, `${other.name} is filed as a step`);
  }
  assert.equal(countAnalysisSteps(RUN), 1);
});

test('executed notebook: the section read is a step not reproduced, named as Charter\'s, with no code cell and no citation', () => {
  const out = renderFetchToolCell(SECTION, { dataFrameIndex: 1, defaultPortal: '' });
  assert.ok(out, 'the section read renders no step');
  assert.ok(out!.cells.every((cell) => cell.cell_type === 'markdown'), 'a code cell is written for a step no helper can re-run');
  assert.equal(out!.producedDataFrame, false);
  assert.equal(out!.citation, null, 'a source is cited for a fetch this notebook did not make');
  const md = text(out!.cells);
  assert.match(md, /^#### Not reproduced: `get_section`/, md);
  assert.match(md, /NYC Charter, Laws and Rules/, `the step does not name the source it read:\n${md}`);
  assert.match(md, /section/, md);
  assert.doesNotMatch(md, /aggregat|fetch_opencontext|Socrata|dataset/i, `the step borrows another source's sentence:\n${md}`);
});

test('executed notebook: the search and the version read are listed once as discovery, the search by what it finds', () => {
  for (const discovery of [SEARCH, VERSION]) {
    assert.equal(renderFetchToolCell(discovery, { dataFrameIndex: 1, defaultPortal: '' }), null, `${discovery.name} renders as a step`);
  }
  const summary = renderDiscoverySummaryCell(RUN, '');
  assert.ok(summary, 'no discovery summary');
  const md = text([summary!]);
  assert.match(md, /- `search` \(search\) — to find sections of law about "rent stabilization"/, md);
  assert.match(md, /- `get_version`/, md);
  assert.doesNotMatch(md, /get_section/, 'the step is also listed as discovery');
  assert.doesNotMatch(md, /dataset/i, md);
});

test('skeleton notebook: the same run has one step, the section read, stated as not reproduced with no URL', () => {
  const nb = generateNotebook('What does the law say about rent stabilization?', null, RUN as never, 'An answer.', { origin: null, host: null, platformTitle: null } as never);
  const all = text(nb.cells as never);
  const steps = all.match(/^## Step \d+:/gm) ?? [];
  assert.equal(steps.length, 1, `the skeleton renders ${steps.length} steps:\n${all}`);
  assert.match(all, /\*Not reproduced below\.\* This step called `get_section`/, all);
  assert.doesNotMatch(all, /url = "/, 'the skeleton writes a URL for a call that named none');
});
