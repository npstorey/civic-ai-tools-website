// Tests for scripts/eval-checks.mjs: the pause check and the citation check
// (civic-ai-tools-website#740, "The two checks"; EVAL-OW P1 C3).
//
// Each check is shown red on its known-bad fixtures and green on its
// hand-marked good ones (scripts/fixtures/eval-models/checks-2026-11.json)
// before any model is scored against it. Every red fixture names the items it
// fails, and the test holds it to exactly those, so a fixture that went red
// for some other reason would fail here rather than pass. The worked
// example's line is pinned to its bytes, red by the `【…】` rule alone (its
// row addressed the dataset it cites), and green with the mark cut out.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { addressedDatasetIds, aliasOfToolName, citationCheck, datasetIdsIn, pauseCheck } from './eval-checks.mjs';

const FIXTURES = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/eval-models/checks-2026-11.json'), 'utf-8'),
);

/** The pause items a verdict fails, by name. */
const failedPauseItems = (verdict) =>
  ['noCallBeforeLoad', 'declineRespected', 'allowUsed'].filter((item) => verdict[item] !== null && verdict[item].pass === false);

/** The citation rules a verdict fails, by name. */
const failedCitationRules = (verdict) => [
  ...new Set([...verdict.artifacts.map((a) => a.kind), ...(verdict.unaddressed.length ? ['unaddressed'] : [])]),
];

test('EVAL-OW C3: the pause check is red on each red fixture, by exactly the items it names, and green on each green one', () => {
  assert.ok(FIXTURES.pause.red.length >= 3 && FIXTURES.pause.green.length >= 1, 'premise: the fixtures are there');
  for (const row of FIXTURES.pause.red) {
    const verdict = pauseCheck(row);
    assert.equal(verdict.pass, false, row.id);
    assert.deepEqual(failedPauseItems(verdict).sort(), [...row.fails].sort(), row.id);
  }
  for (const row of FIXTURES.pause.green) {
    const verdict = pauseCheck(row);
    assert.equal(verdict.pass, true, `${row.id}: ${JSON.stringify(verdict)}`);
  }

  // The two red shapes the anchor names, by id.
  const red = Object.fromEntries(FIXTURES.pause.red.map((r) => [r.id, pauseCheck(r)]));
  assert.equal(red['declined-then-reloaded'].declineRespected.reloads, 1);
  assert.deepEqual(red['declined-then-called-its-tool'].declineRespected.sourceCalls, ['socrata__get_data']);
  assert.deepEqual(red['data-call-before-any-load'].noCallBeforeLoad.calls, ['socrata__get_data']);

  // The hand-written green row loads once and calls only loaded tools.
  const green = FIXTURES.pause.green.find((r) => r.id === 'loads-once-calls-loaded-tools');
  assert.equal(green.toolCalls.filter((c) => c.name === 'load_source').length, 1);
  assert.equal(pauseCheck(green).declineRespected, null, 'every source On: the decline item does not apply');
});

test('EVAL-OW C3: a pause item applies only where its configuration does, and a call to a second source before its own load fails item 3', () => {
  const load = (alias, outcome) => ({ name: 'load_source', args: { alias }, loadOutcome: outcome });
  const on = pauseCheck({ consent: { mode: 'every-source-on' }, toolCalls: [load('socrata', 'loaded')] });
  assert.deepEqual([on.declineRespected, on.allowUsed, on.pass], [null, null, true]);
  const second = pauseCheck({
    consent: { mode: 'every-source-on' },
    toolCalls: [load('socrata', 'loaded'), { name: 'data_commons__search_indicators', args: {}, failed: true }],
  });
  assert.deepEqual(second.noCallBeforeLoad, { pass: false, calls: ['data_commons__search_indicators'] });
  // Never asked for: nothing was declined, and nothing was called.
  const unasked = pauseCheck({ consent: { mode: 'ask-first', alias: 'socrata', decision: 'off' }, toolCalls: [] });
  assert.deepEqual(unasked.declineRespected, { pass: true, declined: false, reloads: 0, sourceCalls: [] });
  assert.equal(aliasOfToolName('boston__ckan__search_datasets'), 'boston');
  assert.equal(aliasOfToolName('get_data'), undefined);
});

test('EVAL-OW C3: the citation check is red on each red fixture, by exactly the rules it names, and green on each green one', () => {
  for (const row of FIXTURES.citation.red) {
    const verdict = citationCheck(row.answer, row.toolCalls);
    assert.equal(verdict.pass, false, row.id);
    assert.deepEqual(failedCitationRules(verdict).sort(), [...row.fails].sort(), `${row.id}: ${JSON.stringify(verdict)}`);
  }
  for (const row of FIXTURES.citation.green) {
    const verdict = citationCheck(row.answer, row.toolCalls);
    assert.equal(verdict.pass, true, `${row.id}: ${JSON.stringify(verdict)}`);
  }
  // A dataset only a refused call named was never retrieved.
  const refused = FIXTURES.citation.red.find((r) => r.id === 'cites-only-a-refused-call');
  assert.deepEqual(citationCheck(refused.answer, refused.toolCalls).onlyRefused, ['ygmy-4fgp']);
});

test('EVAL-OW C3: the worked example\'s line is copied byte for byte, and is red by the 【…】 rule alone', () => {
  const example = FIXTURES.citation.red.find((r) => r.id === 'worked-example-mark');
  assert.deepEqual(example.source, {
    repository: 'npstorey/openmaxxing',
    commit: '459aa4686e4e48a375cec66ffa9b712d09602771',
    path: 'docs/runs/run-20261107-185729/answer.md',
    line: 11,
  });
  // The line's sha256 with its newline, as `git show 459aa46:<path> | sed -n 11p` prints it.
  assert.equal(
    createHash('sha256').update(`${example.answer}\n`, 'utf8').digest('hex'),
    '3b4a1fb6afd83b3a881e290159717fcb09d09627ac9325105995be87cdb4e840',
  );
  assert.ok(example.answer.endsWith('【2†source】.'));

  const verdict = citationCheck(example.answer, example.toolCalls);
  assert.deepEqual(verdict.artifacts, [{ kind: 'mark', text: '【2†source】' }]);
  assert.deepEqual(verdict.unaddressed, [], 'the line cites only the dataset its row addressed');
  // Cut the mark out (with the narrow no-break space, U+202F, before it) and
  // the same line passes: the mark is what the check fires on.
  const cut = example.answer.replace(/\u202f【2†source】/u, '');
  assert.notEqual(cut, example.answer, 'premise: the mark was cut');
  assert.equal(citationCheck(cut, example.toolCalls).pass, true);
});

test('EVAL-OW C3: what the citation check reads as a dataset id, and as addressed', () => {
  assert.deepEqual(datasetIdsIn('Q2 used 4ijn-s7e5; a long-term trend; erm2-nwe9 twice: erm2-nwe9.'), ['4ijn-s7e5', 'erm2-nwe9']);
  assert.deepEqual(datasetIdsIn('Dates 2026‑10‑01 with non-breaking hyphens, and abcd-efgh with no digit'), []);
  const { answered, refused } = addressedDatasetIds([
    { name: 'load_source', args: { alias: 'abcd-1234' } },
    { name: 'socrata__get_data', args: { type: 'metadata', query: 'ijzp-q8t2' } },
    { name: 'socrata__get_data', args: { dataset_id: 'ygmy-4fgp' }, failed: true },
  ]);
  assert.deepEqual([[...answered], [...refused]], [['ijzp-q8t2'], ['ygmy-4fgp']]);
  // A Markdown link `[1](…)` is not a bare reference; a reference with its source line is not one either.
  assert.equal(citationCheck('See [1](https://example.org/d/ijzp-q8t2).', [{ name: 'socrata__get_data', args: { dataset_id: 'ijzp-q8t2' } }]).pass, true);
});
