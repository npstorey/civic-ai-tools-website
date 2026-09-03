// What a generated notebook is allowed to say about itself (Wave N8 P5, #341
// and the notebook-identity half of #324).
//
// Two claims live in the cover cell of every notebook, and at the base both
// were made unconditionally:
//
//   1. "This notebook contains a complete, reproducible analysis of the query
//      above" (prompt.ts:81). A notebook whose every fetch FAILED said this
//      too — and `validateExecutedNotebook` reported it `ok`, because the two
//      validators it ran check extension shape and an all-failed notebook is
//      perfectly well shaped. Its synthesis cell falls back to displaying the
//      original chat answer, so the original figures rendered as the
//      document's conclusion with nothing behind them, under cover text
//      telling the reader they could re-run it and get the same numbers.
//
//   2. The title `# Civic AI Data Analysis` (prompt.ts:73, notebook.ts:106) —
//      the reference deployment's name, hardcoded into a file every instance's
//      readers download, three lines above an attribution line that was
//      already honest about an instance having declared no identity (#258 A2).
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCell0Source } from './prompt.ts';
import { synthesizeNotebook } from './synthesize.ts';
import { stampExecutedNotebook } from './phase-d.ts';
import { validateCoverClaims, validateExecutedNotebook, validateReproducedFetches } from './validate.ts';
import { parseReproductionClaim, reproductionClaimSentence } from './reproduction-claim.ts';
import { countAnalysisStepCells, countReproducedFetchCells } from './tool-to-cell.ts';
import { generateNotebook } from '../notebook.ts';
import { modelAccessPhrase } from '../model-catalog.ts';

const CLAIM = 'complete, reproducible analysis';

const BASE_INPUTS = {
  query: 'Top 5 complaint types in Brooklyn over the past 30 days',
  defaultPortal: 'data.cityofnewyork.us',
  modelName: 'anthropic/claude-sonnet-4-6',
  modelAccess: modelAccessPhrase('openai-compatible'),
  generatedAt: '2026-05-21T14:00:00.000Z',
  finalAnswer: 'Noise complaints led with 4,812 reports.',
};

const SUCCESSFUL_CALL = {
  name: 'get_data',
  operationType: 'query',
  args: {
    type: 'query',
    portal: 'data.cityofnewyork.us',
    dataset_id: 'erm2-nwe9',
    select: 'complaint_type, count(*) as count',
    group: 'complaint_type',
    limit: 5,
  },
  reason: 'to aggregate by complaint_type',
  resultSummary: { rows: 5, columns: 2 },
};

const FAILED_CALL = {
  name: 'get_data',
  operationType: 'query',
  args: {
    type: 'query',
    portal: 'data.cityofnewyork.us',
    dataset_id: 'erm2-nwe9',
    select: 'complaint_type, count(*) as count',
  },
  reason: 'to aggregate by complaint_type',
  failed: true,
  failureKind: 'timeout' as const,
};

const SUCCESSFUL_DISCOVERY = {
  name: 'get_data',
  operationType: 'catalog',
  args: { type: 'catalog', portal: 'data.cityofnewyork.us', query: 'noise complaints' },
  resultSummary: { rows: 40, columns: 4 },
};

const FAILED_DISCOVERY = {
  name: 'get_data',
  operationType: 'catalog',
  args: { type: 'catalog', portal: 'data.cityofnewyork.us', query: 'noise complaints' },
  failed: true,
  failureKind: 'unavailable' as const,
};

function allFailed() {
  return synthesizeNotebook({ ...BASE_INPUTS, toolCalls: [FAILED_DISCOVERY, FAILED_CALL] });
}

function oneSucceeded() {
  return synthesizeNotebook({ ...BASE_INPUTS, toolCalls: [FAILED_DISCOVERY, SUCCESSFUL_CALL] });
}

function coverText(notebook: { cells: Array<{ source: string[] }> }): string {
  return notebook.cells[0].source.join('');
}

function stamp(synth: ReturnType<typeof synthesizeNotebook>) {
  stampExecutedNotebook(
    synth.notebook,
    { executedAt: '2026-05-21T14:23:45.000Z', executionDuration_ms: 12340 },
    synth.dataFrameVariables,
  );
  return synth.notebook;
}

test('#341: a notebook whose every fetch failed does not claim a reproducible analysis', () => {
  // RED at the base: prompt.ts:81 was unconditional, so this notebook — which
  // contains no fetch at all — told the reader that re-running its cells would
  // reproduce the same numbers.
  const notebook = allFailed().notebook;
  const cover = coverText(notebook);

  assert.doesNotMatch(cover, new RegExp(CLAIM));
  assert.match(cover, /This notebook reproduces no data fetch/);
  assert.match(cover, /why each step produced nothing to re-run/);
  // And it names the specific trap: the synthesis cell falls back to the
  // original answer text, so its figures are not this notebook's output.
  assert.match(cover, /come from that analysis text, not from data this\nnotebook fetched/);
  assert.equal(
    notebook.cells.filter(c => c.cell_type === 'code' && c.source.join('').includes('= fetch_')).length,
    0,
    'the fixture must really contain no fetch — otherwise this test proves nothing',
  );
});

test('#341: a notebook that never fetched is not told its requests failed', () => {
  // The false-precision trap on the other side of the same conditional. An
  // analysis can answer from discovery alone — catalog searches that all
  // SUCCEEDED — and still render no fetch step. The cover text for zero
  // reproduced fetches is therefore written about the DOCUMENT ("no step
  // re-runs a request"), never about the requests: telling this reader that
  // every request "returned no data" would be a new false claim in the cell
  // that exists to stop one.
  const cover = coverText(
    synthesizeNotebook({ ...BASE_INPUTS, toolCalls: [SUCCESSFUL_DISCOVERY] }).notebook,
  );
  assert.doesNotMatch(cover, new RegExp(CLAIM));
  assert.match(cover, /reproduces no data fetch/);
  assert.doesNotMatch(cover, /returned no data/, 'the discovery call did return data');
  assert.doesNotMatch(cover, /every request/);
});

test('#341: a notebook with one surviving fetch keeps the claim', () => {
  // The positive control. A conditional that is always false would satisfy the
  // test above while removing a true statement from every notebook.
  //
  // The claim it keeps is no longer "a complete, reproducible analysis" — #371
  // and ruling D3 removed that: this fixture's other call was REJECTED, and a
  // notebook where one of two steps ran is not a complete analysis of anything.
  // What it keeps is the claim's replacement, which carries its own numerator
  // and denominator and so cannot overstate itself at any threshold.
  const cover = coverText(oneSucceeded().notebook);
  assert.ok(
    cover.replace(/\s+/g, ' ').includes(reproductionClaimSentence(1, 2)),
    `the surviving fetch is not claimed at all:\n${cover}`,
  );
  assert.doesNotMatch(cover, new RegExp(CLAIM), '#371: never as a bare adjective');
  assert.doesNotMatch(cover, /No data was fetched/);
});

test('#341: validateExecutedNotebook reports an all-failed notebook', () => {
  // RED at the base: validate.ts:140-145 merged the provenance and execution
  // validators only, so this notebook validated `ok: true` and the pipeline
  // emitted it as valid.
  const result = validateExecutedNotebook(stamp(allFailed()));
  assert.equal(result.ok, false);
  const messages = result.issues.map(i => i.message).join(' | ');
  assert.match(messages, /no step re-runs a data fetch/);
  assert.ok(
    result.issues.some(i => i.path === 'cells'),
    `the issue must point at the cells, not at a metadata path: ${JSON.stringify(result.issues)}`,
  );
});

test('#341: a stamped notebook that reproduces a fetch still validates clean', () => {
  // The other positive control — and the one that would catch a check written
  // so broadly that every notebook fails it.
  const result = validateExecutedNotebook(stamp(oneSucceeded()));
  assert.deepEqual(result.issues, [], `unexpected issues: ${JSON.stringify(result.issues)}`);
  assert.ok(result.ok);
});

test('#341: the cover claim and the validator answer the same question', () => {
  // The two halves are computed by different means on purpose: the cover cell
  // from the tool calls (it is written before any step cell exists), the
  // validator from the cells themselves (so it cannot be satisfied by a claim
  // the metadata makes). They must still agree — a notebook that says it
  // reproduces nothing while validating clean, or the reverse, is a document
  // arguing with itself.
  //
  // The question is the same one; #371 sharpened what counts as an answer. It
  // used to be binary on both sides — "does the cover assert the claim" against
  // "does anything at all get reproduced" — and two notebooks with wildly
  // different bodies gave the same pair of answers. Now each side states a
  // ratio, and agreement means the same two numbers.
  for (const [label, synth] of [['all failed', allFailed()], ['one succeeded', oneSucceeded()]] as const) {
    const stated = parseReproductionClaim(coverText(synth.notebook));
    assert.ok(stated, `${label}: the cover text states no count`);
    assert.deepEqual(
      stated,
      {
        reRun: countReproducedFetchCells(synth.notebook.cells),
        steps: countAnalysisStepCells(synth.notebook.cells),
      },
      `${label}: cover text and cells disagree`,
    );
    // And the validator, which derives its own numbers from the cells, agrees
    // with both: nothing it reports is about the count these two just matched.
    assert.deepEqual(validateCoverClaims(synth.notebook).issues, [], `${label}: validator disagrees`);
    assert.equal(
      validateReproducedFetches(synth.notebook).ok,
      stated!.reRun > 0,
      `${label}: the zero threshold and the count disagree`,
    );
  }
});

// --- #324: the notebook's own identity -------------------------------------

const TITLE_VARS = ['PUBLISHER_PLATFORM_AGENT_TITLE', 'EVIDENCE_PLATFORM_AGENT_TITLE'] as const;

function withPlatformTitle<T>(title: string | null, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const name of TITLE_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  if (title !== null) process.env.PUBLISHER_PLATFORM_AGENT_TITLE = title;
  try {
    return fn();
  } finally {
    for (const name of TITLE_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

test('#324: the executed notebook is titled by the instance, or by nothing', () => {
  // RED at the base: `# Civic AI Data Analysis` on every instance, in a file
  // readers download — while the "via …" line immediately below already
  // omitted an identity the instance had not declared (#258 A2). One line
  // borrowed a name; the next refused to.
  const declared = withPlatformTitle('Harbor City Data Lab', () =>
    buildCell0Source({ query: 'How many permits?', generatedAt: '2026-06-01', portals: [] }));
  assert.match(declared, /^# Harbor City Data Lab Data Analysis$/m);
  assert.doesNotMatch(declared, /Civic AI/);

  const undeclared = withPlatformTitle(null, () =>
    buildCell0Source({ query: 'How many permits?', generatedAt: '2026-06-01', portals: [] }));
  assert.match(undeclared, /^# Data Analysis$/m);
  assert.doesNotMatch(undeclared, /Civic AI/, 'no borrowed name on an instance that declared none');
});

test('#324: the downloadable skeleton notebook is titled the same way', () => {
  // The second copy of the same hardcoded line (notebook.ts:106). It takes its
  // identity as a threaded parameter rather than from the environment, because
  // it is bundled into client components — so the conditional is on the
  // threaded value, and both copies had to move for the defect to close.
  const declared = generateNotebook('q', 'data.example.gov', [], 'answer', {
    origin: 'https://harbor.example.org',
    host: 'harbor.example.org',
    platformTitle: 'Harbor City Data Lab',
  });
  assert.equal(declared.cells[0].source[0], '# Harbor City Data Lab Data Analysis\n');

  const undeclared = generateNotebook('q', 'data.example.gov', [], 'answer', {
    origin: null,
    host: null,
    platformTitle: null,
  });
  assert.equal(undeclared.cells[0].source[0], '# Data Analysis\n');
  assert.doesNotMatch(JSON.stringify(undeclared), /Civic AI/);
});
