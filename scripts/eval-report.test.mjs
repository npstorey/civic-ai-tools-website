// The November 2026 model evaluation's document and data (#740, P2b).
//
//   A7             `node scripts/eval-report.mjs --check` passes on the committed
//                  document: every block between `<!-- table:<name> -->` markers
//                  is what the script renders from docs/model-evaluation-2026-11/.
//   the decoy      a figure typed into a fixture copy of the document fails the
//                  check, naming its block, and a re-render restores the copy to
//                  the committed document byte for byte.
//   the data       the two results files are the bytes the owner's terminal wrote
//                  (their sha256), and every score and review is keyed by a row
//                  of the run.
//   the hygiene    no committed file under the data directory, and not the
//                  document, holds the harness's `Key check:` line or a balance.
//
// BLIND SPOTS, stated so a green is read as no more than it is: the check reads
// the blocks between markers only. A figure typed into the prose outside them is
// not caught here; the document's rule is that the prose names a table instead
// of repeating its figures, and that rule is held by review.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATA, DOC, PROBE_FILE, RUN_FILE, TABLE_NAMES, blocks, qwk, readData, relativeScore, render, renderTable } from './eval-report.mjs';

const SCRIPT = fileURLToPath(new URL('./eval-report.mjs', import.meta.url));
const report = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** The block `name` of `text`, as its lines. */
function blockLines(text, name) {
  const { lines, found } = blocks(text);
  const b = found.find((x) => x.name === name);
  assert.ok(b, `the document holds a ${name} block`);
  return { lines, start: b.start, end: b.end };
}

test('A7: the document is what eval-report.mjs renders from the committed files', () => {
  const check = report(['--check']);
  assert.equal(check.status, 0, `eval-report.mjs --check exits 0\n${check.stdout}${check.stderr}`);
  assert.match(check.stdout, new RegExp(`as rendered \\(${TABLE_NAMES.length} blocks\\)`));
});

test('A7: a decoy figure typed into a fixture copy of the document fails the check, and a re-render restores it', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'eval-report-'));
  try {
    const committed = readFileSync(DOC, 'utf8');
    const { lines, start, end } = blockLines(committed, 'agreement');
    const at = lines.findIndex((l, i) => i > start && i < end && l.startsWith('| Dataset Selection |'));
    assert.ok(at > 0, "the agreement block has a Dataset Selection row");
    const cells = lines[at].split(' | ');
    cells[1] = String(Number(cells[1]) + 1);
    const decoyed = [...lines.slice(0, at), cells.join(' | '), ...lines.slice(at + 1)].join('\n');
    assert.notEqual(decoyed, committed);
    const copy = join(scratch, 'model-evaluation-2026-11.md');
    writeFileSync(copy, decoyed);

    const red = report(['--doc', copy, '--check']);
    assert.equal(red.status, 1, `--check exits 1 on the decoy\n${red.stdout}${red.stderr}`);
    assert.match(red.stdout, /drift in agreement$/m, 'and names the block that drifted, and only it');

    const rerender = report(['--doc', copy]);
    assert.equal(rerender.status, 0, `${rerender.stdout}${rerender.stderr}`);
    assert.equal(readFileSync(copy, 'utf8'), committed, 'the re-render is the committed document, byte for byte');
    assert.equal(report(['--doc', copy, '--check']).status, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('the markers: a missing, unknown, doubled or unclosed block is refused before anything renders', () => {
  const committed = readFileSync(DOC, 'utf8');
  const D = readData();
  const cases = {
    missing: committed.replace('<!-- table:agreement -->', '').replace('<!-- /table:agreement -->', ''),
    unknown: `${committed}\n<!-- table:decoy -->\n<!-- /table:decoy -->\n`,
    doubled: `${committed}\n<!-- table:agreement -->\n<!-- /table:agreement -->\n`,
    unclosed: `${committed}\n<!-- table:spend -->\n`,
  };
  for (const [name, text] of Object.entries(cases)) {
    assert.ok(render(text, D).errors.length > 0, `${name}: refused`);
  }
  assert.deepEqual(render(committed, D).errors, []);
  assert.deepEqual(render(committed, D).changed, []);

  const scratch = mkdtempSync(join(tmpdir(), 'eval-report-'));
  try {
    const copy = join(scratch, 'doc.md');
    writeFileSync(copy, cases.unknown);
    const run = report(['--doc', copy, '--check']);
    assert.equal(run.status, 2, `${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /decoy: no such table/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('the data: the results files are the bytes the run wrote, and every score is keyed by a row of the run', () => {
  assert.equal(sha256(join(DATA, RUN_FILE)), '37eb898cc1f43a5814fe1871f490a5b1864c4e4b59fdcefcc26149ec91d8ca5a');
  assert.equal(sha256(join(DATA, PROBE_FILE)), '312559dc3299ff2b6238586f86bcc2562b730bc27356f8060bfca8a42300233b');
  const D = readData();
  const keys = D.run.results.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, 'row keys are unique');
  assert.deepEqual(Object.keys(D.first.rows).sort(), [...keys].sort(), 'the first scores cover every row, and only rows');
  for (const k of Object.keys(D.second.rows)) assert.ok(keys.includes(k), `second score ${k} is a row`);
  for (const [k, s] of Object.entries(D.second.rows)) assert.equal(s.card, D.first.rows[k].card, `${k}: one card id in both readings`);
  const failing = D.run.results.filter((r) => r.checks.citation.pass === false).map((r) => r.key);
  assert.deepEqual(Object.keys(D.citation.rows).sort(), failing.sort(), 'one review for each citation failure, and no other');
  const served = new Set(D.run.results.concat(D.probe.results).flatMap((r) => r.requests).filter((q) => q.sent.provider).map((q) => q.provider));
  assert.deepEqual(Object.keys(D.terms.providers).sort(), [...served].sort(), 'a terms reading for each served open-weight provider, and no other');
});

test("the render agrees with the harness's own summary on the pause and citation checks", () => {
  const D = readData();
  const lines = renderTable('checks', D).split('\n').slice(2);
  assert.equal(lines.length, D.run.summary.length);
  for (const s of D.run.summary) {
    const cells = lines.find((l) => l.startsWith(`| ${s.modelName} |`))?.split(' | ');
    assert.ok(cells, `${s.modelName} has a row`);
    assert.equal(cells[1].replace(' of ', '/'), s.pauseCheckPassed, `${s.modelName}: pause`);
    assert.equal(cells[5].replace(' of ', '/'), s.citationCheckPassed, `${s.modelName}: citation`);
    assert.equal(cells[10].replace(' of ', '/'), s.expectedDatasetCalled, `${s.modelName}: expected dataset called`);
  }
});

test("the rubric's relative score, and the kappa, on cells that can fail", () => {
  // 5 at or within 10% of the lowest; 1 for the highest or 2x the median; 3 near the median; 4 below; 2 above.
  const cell = [100, 108, 150, 170, 400];
  assert.deepEqual(cell.map((v) => relativeScore(v, cell)), [5, 5, 3, 2, 1]);
  const spread = [100, 130, 200, 260, 300];
  assert.deepEqual(spread.map((v) => relativeScore(v, spread)), [5, 4, 3, 2, 1]);
  assert.equal(relativeScore(150, [100, 150, 150, 150, 150]), 1, 'the highest scores 1 even at the median');
  const same = [[1, 1], [3, 3], [5, 5], [4, 4]];
  assert.equal(qwk(same), 1);
  assert.ok(qwk([[1, 5], [2, 4], [4, 2], [5, 1]]) < 0, 'reversed scores give a negative kappa');
  assert.equal(qwk([]), null);
});

/** A `Key check:` line, or a dollar figure beside the words the harness and the Credits page use for a balance. */
const BALANCE = /Key check:|\b(?:balance|remaining|credits?)\b[^\n]{0,40}\$\s?\d|\$\s?\d[\d,.]*\s*(?:remaining|balance|credits?)\b/i;

test('the hygiene: no committed results file, and not the document, holds a Key check line or a balance', () => {
  // The test of the test: the shapes the run kit prints are caught.
  assert.match('Key check: OK (limit $10.00, used $1.23, remaining $8.77)', BALANCE);
  assert.match('Your balance: $112.40', BALANCE);
  assert.match('$112.40 remaining', BALANCE);
  assert.doesNotMatch('so the pay distribution is fairly balanced.', BALANCE);
  const files = readdirSync(DATA).map((n) => join(DATA, n)).concat(DOC);
  assert.ok(files.length >= 7);
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), BALANCE, f);
});
