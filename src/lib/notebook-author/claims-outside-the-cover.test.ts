// P8 red instrument, Wave N9 (#384), stage 1 — the cold read's F3 and F6.
//
// F3, measured at 4ec45c0. `prompt.ts:203` (`CELL_4_HEADER`, unchanged since
// the base of the wave) emits, two cells under the cover: "Each step below
// corresponds to one discovery call from the original analysis. The same
// helper functions and arguments are used so the analysis is fully
// reproducible." Driven: cell [4] carries it under a cover stating "re-runs a
// live request in 1 of its 3 analysis steps" and a "Notebook structure" line
// that says discovery calls are NOT numbered among the steps. The validator
// cannot see it: `claimsCompleteness` is scoped to the cover section by
// design (`reproduction-claim.ts`, `coverSectionBody`), so criterion 7's
// "never a bare complete" is met for the cover and false for the document.
//
// THE PROPERTY: no generator-written markdown cell claims completeness or
// full reproducibility as a bare adjective, anywhere in the document, and
// the validator reports one that does.
//
// THE SCOPE, stated so a reader's question or a data value cannot trip it,
// and proposed here for the validator stage 2 extends:
//   - the cover cell is checked by `coverSectionBody` (its own prose, not the
//     `**Query:**` line the reader wrote — #371's lesson, kept);
//   - every OTHER markdown cell is checked over its PROSE: fenced code,
//     inline code spans, markdown link targets, double-quoted strings and
//     prefixed identifiers (`record:…`, `dataset:…`, `https:…`) are stripped
//     first. Measured against both generators at 4ec45c0, those are the only
//     channels a data value reaches markdown through: a dataset id, portal or
//     column is written in backticks by every renderer in `tool-to-cell.ts`;
//     a search query reaches the discovery bullet in double quotes
//     (`generateToolReason`: `to find datasets about "…"`); a fetch id is a
//     prefixed identifier; a where-clause value never reaches prose at all
//     (`generateToolReason` says "to filter … records", not the filter). The
//     model's answer is a CODE cell (`display(Markdown(…))`), not scanned.
//   - the pattern is the cover check's `\bcomplete\b` plus "fully / completely
//     / entirely / wholly reproducible". "completed" and "reproducibility" do
//     not match it, so `FAILURE_REASON.unknown` ("could not be completed") and
//     the footer's "## Reproducibility" heading are not claims.
//
// F6, measured at 4ec45c0. `ChatNotebookOutput.tsx:319-323` asserts, above
// every notebook, that "the notebook states how many of them do". A
// discovery-only notebook renders no step and states no count (P4 emits none
// when no step exists — `prompt.ts`, `countLine`), and `NotebookSection`
// renders no sentence for it, so the line is false for that document. The
// proposed condition: the sentence is written by ONE formatter that reads
// the claim the notebook makes (`readReproductionClaim`) and says, for a
// null claim, that the notebook states no count — a client-safe function in
// `reproduction-claim.ts` beside the parser, used by the component instead
// of a literal (docs/design-principles.md, principle 5: narrative written
// once, server-side; principle 3: no signal, no claim). Red by its absence —
// the seam pattern `evidence/query-step.test.ts` used.
//
// SCOPE. Both generators (`synthesizeNotebook` + `stampExecutedNotebook`,
// and the skeleton `generateNotebook`), driven over the cold read's run
// shape plus one run whose values carry the claim words. The component is
// read as source (no JSX render under `node --test`). Not covered: the
// bundle route's commitment cell (prepended at download; its text is hashes).
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/notebook-author/claims-outside-the-cover.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { synthesizeNotebook } from './synthesize.ts';
import { stampExecutedNotebook } from './phase-d.ts';
import { validateExecutedNotebook } from './validate.ts';
import { markdownCell, type Notebook, type NotebookCell } from './cells.ts';
import { findCoverCell, coverSectionBody, readReproductionClaim, type ReproductionClaim } from './reproduction-claim.ts';
import type { PhaseAToolCall } from './tool-to-cell.ts';
import { generateNotebook } from '../notebook.ts';
import { modelAccessPhrase } from '../model-catalog.ts';
import type { ToolCall } from '../../hooks/useStreamingComparison.ts';

// --- Fixtures ---------------------------------------------------------------

const PORTAL = 'data.cityofnewyork.us';
const OTHER_PORTAL = 'data.other-portal.example';
const QUESTION = 'How many noise complaints were filed last year?';
const ANSWER = 'About 412,000 noise complaints were filed.';

/** The cold read's run: get_data, search, fetch on a record: id, one rejected get_data. */
function coldReadCalls(): PhaseAToolCall[] {
  return [
    {
      name: 'get_data',
      args: { type: 'query', portal: PORTAL, dataset_id: 'erm2-nwe9', select: 'count(*)' },
      resultSummary: { rows: 1, columns: 1 },
      operationType: 'query',
      reason: 'to retrieve specific fields from 311 Service Requests',
    },
    { name: 'search', args: { query: 'noise complaints' }, resultSummary: { rows: 1, columns: 2 }, operationType: 'search', reason: 'to find datasets about "noise complaints"' },
    { name: 'fetch', args: { id: `record:${OTHER_PORTAL}:abcd-1234:row-1` }, resultSummary: { rows: 1, columns: 4 }, reason: `to look up record:${OTHER_PORTAL}:abcd-1234:row-1` },
    {
      name: 'get_data',
      args: { type: 'query', portal: PORTAL, dataset_id: 'efgh-5678', select: 'count(*)', where: "borough='QUEENS'" },
      operationType: 'query',
      reason: 'to filter dataset efgh-5678 records',
      failed: true,
      failureKind: 'timeout',
    },
  ];
}

/**
 * The same run with the claim words placed where DATA reaches markdown: a
 * search query in the discovery bullet's quotes, a fetch id, a where clause,
 * a dataset id in backticks, and a rejection whose kind reads "could not be
 * completed". None of these is a claim the notebook makes.
 */
function valueBearingCalls(): PhaseAToolCall[] {
  return [
    {
      name: 'get_data',
      args: { type: 'query', portal: PORTAL, dataset_id: 'comp-lete', select: 'count(*)', where: "status='complete' AND note LIKE '%fully reproducible%'" },
      resultSummary: { rows: 1, columns: 1 },
      operationType: 'query',
      reason: 'to filter dataset comp-lete records',
    },
    { name: 'search', args: { query: 'complete building permits' }, resultSummary: { rows: 1, columns: 2 }, operationType: 'search', reason: 'to find datasets about "complete building permits"' },
    { name: 'fetch', args: { id: `record:${OTHER_PORTAL}:abcd-1234:row-complete` }, resultSummary: { rows: 1, columns: 4 }, reason: `to look up record:${OTHER_PORTAL}:abcd-1234:row-complete` },
    {
      name: 'get_data',
      args: { type: 'query', portal: PORTAL, dataset_id: 'efgh-5678', select: 'count(*)' },
      operationType: 'query',
      reason: 'to retrieve specific fields from dataset efgh-5678',
      failed: true,
      failureKind: 'unknown',
    },
  ];
}

function executed(toolCalls: PhaseAToolCall[], query: string): Notebook {
  const synth = synthesizeNotebook({
    query,
    defaultPortal: PORTAL,
    toolCalls,
    finalAnswer: ANSWER,
    modelName: 'fake/model',
    modelAccess: modelAccessPhrase('openai-compatible'),
    generatedAt: '2026-09-03T00:00:00.000Z',
  });
  stampExecutedNotebook(synth.notebook, { executedAt: '2026-09-03T00:01:00.000Z', executionDuration_ms: 1000 }, synth.dataFrameVariables);
  return synth.notebook;
}

function skeleton(toolCalls: PhaseAToolCall[], query: string): Notebook {
  return generateNotebook(query, PORTAL, toolCalls as unknown as ToolCall[], ANSWER, { origin: null, host: null, platformTitle: null }) as unknown as Notebook;
}

// --- The scope ---------------------------------------------------------------

const text = (cell: NotebookCell): string => (Array.isArray(cell.source) ? cell.source.join('') : String(cell.source));

/** A markdown cell's prose: what the generator wrote about the document, with every data channel removed. */
function prose(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/"[^"\n]*"/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:[^\s`)]+/gi, ' ');
}

/** The cover check's `\bcomplete\b`, plus the adverb forms of "reproducible". */
const BARE_CLAIM = /\b(?:fully|completely|entirely|wholly)\s+reproducible\b|\bcomplete\b/i;

/** Every claim in the document, by cell: the cover through its own section body, every other markdown cell through its prose. */
function claimsIn(notebook: Notebook): string[] {
  const cover = findCoverCell(notebook.cells);
  const found: string[] = [];
  notebook.cells.forEach((cell, i) => {
    if (cell.cell_type !== 'markdown') return;
    const scanned = cell === cover ? coverSectionBody(text(cell)) : prose(text(cell));
    const m = BARE_CLAIM.exec(scanned);
    if (m) {
      const line = scanned.split('\n').find((l) => BARE_CLAIM.test(l)) ?? m[0];
      found.push(`[${i}${cell === cover ? ' cover' : ''}] ${line.trim()}`);
    }
  });
  return found;
}

// --- F3 (a) RED at 4ec45c0: cell 4 -----------------------------------------

test('F3 (a) the executed notebook: no generator-written markdown cell, inside the cover or outside it, claims completeness or full reproducibility', () => {
  const notebook = executed(coldReadCalls(), QUESTION);
  const claim = readReproductionClaim(notebook.cells);
  assert.deepEqual(claim, { reRun: 1, steps: 3 }, 'the run shape: the cover states 1 of 3 (P4, green at base)');
  assert.deepEqual(
    claimsIn(notebook),
    [],
    `a cell claims what the cover does not: under a cover stating "${claim!.reRun} of its ${claim!.steps}", the document says:\n  ` +
      claimsIn(notebook).join('\n  '),
  );
});

test('F3 (b) control: the skeleton notebook makes no such claim either', () => {
  assert.deepEqual(claimsIn(skeleton(coldReadCalls(), QUESTION)), []);
});

// --- F3 (c) RED at 4ec45c0: the validator cannot see a body cell -------------

test('F3 (c) validateExecutedNotebook reports a completeness claim in a body cell, naming it', () => {
  const notebook = executed(coldReadCalls(), QUESTION);
  // Stage 2 removes the generator's own claim from cell 4; this one is
  // injected so the check stays meaningful after it does. A paragraph cell
  // is neither a step cell nor a reproduced-fetch cell, so the counts the
  // cover states are untouched.
  const cover = findCoverCell(notebook.cells);
  assert.ok(cover, 'the notebook has a cover cell');
  const at = notebook.cells.indexOf(cover!) + 1;
  notebook.cells.splice(at, 0, markdownCell('The same helper functions and arguments are used so the analysis is fully reproducible.'));
  const result = validateExecutedNotebook(notebook);
  const reported = result.issues.filter((issue) => /reproducible|complete/i.test(issue.message));
  assert.ok(
    reported.length > 0,
    `the validator saw no claim in a body cell (issues: ${JSON.stringify(result.issues)}). ` +
      '`claimsCompleteness` reads the cover section only; a claim two cells down is invisible to it.',
  );
});

// --- F3 (d) the scope: what must never be read as a claim --------------------

test('F3 (d) control: a reader’s question, a search phrase, a fetch id, a where clause, a dataset id and "could not be completed" are not claims the notebook makes', () => {
  const question = 'How complete is the 311 data for 2024?';
  const notebook = executed(valueBearingCalls(), question);
  const cover = findCoverCell(notebook.cells);
  assert.ok(cover && text(cover).includes(question), 'the question is in the cover cell');
  // The scan's own scope: with the generator's cell-4 claim set aside, nothing
  // in the value-bearing document reads as a claim.
  const claims = claimsIn(notebook).filter((c) => !/fully reproducible/i.test(c));
  assert.deepEqual(claims, [], `a data value was read as a claim: ${claims.join(' | ')}`);
  // And the validator agrees (green at base; pinned so stage 2's wider check keeps this scope).
  const result = validateExecutedNotebook(notebook);
  const falseClaims = result.issues.filter(
    (issue) => /complete|reproducible/i.test(issue.message) && !/fully reproducible/i.test(issue.message),
  );
  assert.deepEqual(falseClaims, [], `the validator read a data value or the reader’s question as a claim: ${JSON.stringify(falseClaims)}`);
});

test('F3 (e) the instrument can fail: the pattern catches the base’s sentence and the cover’s bare adjective, through the scope', () => {
  assert.ok(BARE_CLAIM.test(prose('The same helper functions and arguments are used so the analysis is fully reproducible.')));
  assert.ok(BARE_CLAIM.test(prose('This is a complete, reproducible analysis.')));
  assert.ok(!BARE_CLAIM.test(prose('The request could not be completed, so it returned no data.')));
  assert.ok(!BARE_CLAIM.test(prose('## Reproducibility')));
  assert.ok(!BARE_CLAIM.test(prose('- `search` (search) — to find datasets about "complete building permits"')));
  assert.ok(!BARE_CLAIM.test(prose(`to look up record:${OTHER_PORTAL}:abcd-1234:row-complete`)));
  assert.ok(!BARE_CLAIM.test(prose("We query the `comp-lete` dataset where `status='complete'`.")));
});

// --- F6: the section-E sentence -----------------------------------------------

/** Typed as `string` so the compiler does not resolve a named export that does not exist at the base. */
const CLAIM_MODULE: string = './reproduction-claim.ts';

interface ClaimModule {
  reproductionScopeSentence?: (claim: ReproductionClaim | null) => string;
}

test('F6 (a) one formatter writes the section-E sentence from the claim the notebook makes, and it is true of a notebook that states no count', async () => {
  const mod = (await import(CLAIM_MODULE)) as ClaimModule;
  assert.ok(
    typeof mod.reproductionScopeSentence === 'function',
    'no formatter writes the section-E sentence: ChatNotebookOutput.tsx:319-323 asserts "the notebook states how many ' +
      'of them do" above every notebook, and a discovery-only notebook states no count. Proposed seam: ' +
      `${CLAIM_MODULE} exporting reproductionScopeSentence(claim: ReproductionClaim | null): string.`,
  );
  const none = mod.reproductionScopeSentence!(null);
  assert.doesNotMatch(none, /states how many/i, `for a notebook that states no count the sentence still says it does: ${JSON.stringify(none)}`);
  assert.match(none, /\bno (?:such )?count\b|states no\b/i, `for a null claim the sentence does not say the notebook states no count: ${JSON.stringify(none)}`);
  const some = mod.reproductionScopeSentence!({ reRun: 1, steps: 3 });
  assert.match(some, /\b1 of (?:its )?3\b/, `for a stated claim the sentence does not carry it: ${JSON.stringify(some)}`);
});

test('F6 (b) a discovery-only notebook states no count — the case the sentence must be true of', () => {
  const notebook = executed([coldReadCalls()[1]], QUESTION);
  assert.equal(readReproductionClaim(notebook.cells), null, 'a discovery-only notebook renders no step and states no ratio (P4, green at base)');
});

test('F6 (c) declared: ChatNotebookOutput renders that sentence, not a literal that is false for some notebooks', () => {
  const source = readFileSync(fileURLToPath(new URL('../../components/notebook/ChatNotebookOutput.tsx', import.meta.url)), 'utf8');
  assert.doesNotMatch(
    source,
    /the notebook states how many of\s+them do/,
    'ChatNotebookOutput.tsx carries the literal "the notebook states how many of them do" above every notebook',
  );
  assert.match(source, /reproductionScopeSentence/, 'ChatNotebookOutput.tsx does not read the sentence from the formatter');
});
