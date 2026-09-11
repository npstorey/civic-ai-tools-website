// THROWAWAY — Wave N11 (#434) P2 red instruments. Not for merge; the PR carrying it is closed unmerged.
//
// 1. The notebook extension key (#403). Every non-test code site that spells the key as an exact string
//    literal is one of the two pinned lib declarations, or is allowlisted by reason. Universe: every file
//    git finds carrying the string. Comments are blanked first (newlines kept, so line numbers hold).
//    At 567e2f2 it must fail naming exactly the two app-local declarations.
// 2. The copy (#416, D7 = B). The skeleton reading is "Analysis notebook (not executed)" in code and in the
//    vocabulary row, and the vocabulary no longer calls `skeleton` reserved (false since N10 P2).
// 3. The deploy checklist (carried at G3/G5). The SITE_DEFAULT_PORTAL row states that an instance fronting
//    one portal sets the server's DATA_PORTAL_URL to the same portal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const KEY = 'org.civicaitools.notebook';
const PINNED = new Set(['src/lib/notebook-author/prompt.ts', 'src/lib/notebook-author/notebook-provenance-reading.ts']);
const ALLOW = {
  'scripts/rehearse-instance-identity.ts': 'operator rehearsal script that builds a package by hand (red instrument only)',
  'src/components/PublishEvidenceDialog.tsx': 'client component that writes the extension key into a publish body (red instrument only)',
};
const EXACT = new RegExp(`['"\`]${KEY.replace(/\./g, '\\.')}['"\`]`);

function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

test('#403: the key is declared only in the two pinned lib modules; every other code site is allowlisted by reason', () => {
  const files = execFileSync('git', ['grep', '-lF', KEY], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((p) => p && /\.(c|m)?[jt]sx?$/.test(p) && !/\.test\.(c|m)?[jt]sx?$/.test(p));
  assert.ok(files.length >= 10, `git grep found ${files.length} code files carrying the key — the scan stopped measuring`);
  const offenders = [];
  for (const f of files) {
    if (PINNED.has(f) || f in ALLOW) continue;
    blankComments(readFileSync(path.join(root, f), 'utf8')).split('\n').forEach((line, i) => {
      if (EXACT.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `the key spelled as a literal outside the pinned declarations and the allowlist:\n  ${offenders.join('\n  ')}`);
});

test('#416 (D7 = B): the reading is "Analysis notebook (not executed)", and the vocabulary no longer calls skeleton reserved', () => {
  const signals = readFileSync(path.join(root, 'src/lib/evidence/trust-signal.ts'), 'utf8');
  const vocab = readFileSync(path.join(root, 'docs/trust-signal-vocabulary.md'), 'utf8');
  const problems = [];
  if (!/label: 'Analysis notebook \(not executed\)'/.test(signals)) problems.push('trust-signal.ts: the skeleton label is not "Analysis notebook (not executed)"');
  if (!/\| `skeleton` \| Normal \| Analysis notebook \(not executed\) \|/.test(vocab)) problems.push('trust-signal-vocabulary.md: the skeleton row does not read "Analysis notebook (not executed)"');
  if (/no code path writes it yet/.test(vocab)) problems.push('trust-signal-vocabulary.md: still says skeleton is reserved ("no code path writes it yet")');
  assert.deepEqual(problems, []);
});

test('deploy checklist: the SITE_DEFAULT_PORTAL row names the server layer (DATA_PORTAL_URL) it must agree with', () => {
  const row = readFileSync(path.join(root, 'docs/deploy.md'), 'utf8').split('\n').find((l) => l.startsWith('| `SITE_DEFAULT_PORTAL`'));
  assert.ok(row, 'no SITE_DEFAULT_PORTAL row in docs/deploy.md');
  assert.match(row, /DATA_PORTAL_URL/, 'the SITE_DEFAULT_PORTAL row does not say the server\'s DATA_PORTAL_URL must name the same portal');
});
