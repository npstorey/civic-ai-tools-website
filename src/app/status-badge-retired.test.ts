// UX-2 P5 criterion 1 (R18 C; #92 item 4, G0-12): the verification-status
// verdict leaves every reader surface.
//
//   (a) No `StatusBadge` is defined anywhere in the tracked source: not as a
//       function, a const, a class, or an export alias.
//   (b) No string a reader can meet equals one of the retired status labels:
//       "Unverified", "Consistency tested", "Evaluated", "Fully attested".
//       Read as every string literal, template-literal piece and JSX text in
//       the tracked source (tests excluded), compared after trimming.
//
// THE UNIVERSE is `git ls-files` (every tracked `.ts`, `.tsx`, `.js`, `.jsx`,
// `.mjs` under `src/`, tests excluded), so a file in a directory that does not
// exist yet is covered; a new file is covered once it is added to the index.
//
// THE ALLOWLIST is bidirectional: an entry that names a file no longer tracked,
// or a file that no longer carries the hit it was allowed for, fails, as a
// hit outside it does. It is empty: nothing is allowed.
//
// On the base (`71460c3`): three definitions (`[slug]/page.tsx:192`,
// `DashboardTabs.tsx:95`, `EvidenceIndex.tsx:47`) and the filter's four
// labels (`EvidenceIndex.tsx:28-31`).
//
// BLIND SPOTS. A label assembled at run time from pieces (`'Fully ' + x`) or
// rendered from a data value (`status.replace(/_/g, ' ')` under CSS
// capitalisation) is not a literal; the registry and analysis-page render tests
// read those surfaces' markup. The instrument is shown able to fail on
// synthetic sources in the last test.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const RETIRED_LABELS = ['Unverified', 'Consistency tested', 'Evaluated', 'Fully attested'];

/** Files allowed to carry a hit, with the hit and why. Empty: nothing is allowed. */
const ALLOWLIST: Array<{ file: string; hit: string; why: string }> = [];

interface Hit { file: string; line: number; kind: 'definition' | 'label'; text: string }

function scan(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const label = (node: ts.Node, raw: string) => {
    const text = raw.trim();
    if (RETIRED_LABELS.includes(text)) hits.push({ file, line: at(node), kind: 'label', text });
  };
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === 'StatusBadge') {
      hits.push({ file, line: at(node), kind: 'definition', text: 'StatusBadge' });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'StatusBadge') {
      hits.push({ file, line: at(node), kind: 'definition', text: 'StatusBadge' });
    }
    if (ts.isExportSpecifier(node) && node.name.text === 'StatusBadge') {
      hits.push({ file, line: at(node), kind: 'definition', text: 'StatusBadge' });
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) label(node, node.text);
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) label(node, node.text);
    if (ts.isJsxText(node)) label(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function trackedSources(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', 'src'], { cwd: REPO, encoding: 'utf8' });
  return out.split('\0').filter((f) => /\.(tsx?|jsx?|mjs)$/.test(f) && !/\.test\.[a-z]+$/.test(f) && !f.endsWith('.d.ts'));
}

/** Hits outside the allowlist, and allowlist entries that no longer describe the tree. */
function verdict(files: Map<string, string>, allow: typeof ALLOWLIST): { unallowed: Hit[]; stale: string[] } {
  const hits = [...files].flatMap(([file, source]) => scan(file, source));
  const allowed = (h: Hit) => allow.some((a) => a.file === h.file && a.hit === h.text);
  const stale = allow
    .filter((a) => !files.has(a.file) || !hits.some((h) => h.file === a.file && h.text === a.hit))
    .map((a) => `${a.file} (${a.hit}): ${files.has(a.file) ? 'no longer carries the hit' : 'no longer tracked'}`);
  return { unallowed: hits.filter((h) => !allowed(h)), stale };
}

const describe = (hits: Hit[]) => hits.map((h) => `${h.file}:${h.line} ${h.kind} ${JSON.stringify(h.text)}`).join('\n  ');

test('premise: the universe is the tracked source, and it is not empty', () => {
  const files = trackedSources();
  assert.ok(files.length > 200, `only ${files.length} tracked sources`);
  assert.ok(files.includes('src/components/evidence/EvidenceIndex.tsx'));
});

test('UX-2 P5 C1 (a): no StatusBadge is defined in the tracked source', () => {
  const files = new Map(trackedSources().map((f) => [f, fs.readFileSync(path.join(REPO, f), 'utf8')]));
  const { unallowed } = verdict(files, ALLOWLIST);
  const definitions = unallowed.filter((h) => h.kind === 'definition');
  assert.equal(definitions.length, 0, `StatusBadge is still defined:\n  ${describe(definitions)}`);
});

test('UX-2 P5 C1 (b): no reader-facing string equals a retired status label', () => {
  const files = new Map(trackedSources().map((f) => [f, fs.readFileSync(path.join(REPO, f), 'utf8')]));
  const { unallowed } = verdict(files, ALLOWLIST);
  const labels = unallowed.filter((h) => h.kind === 'label');
  assert.equal(labels.length, 0, `a retired status label is still in the source:\n  ${describe(labels)}`);
});

test('UX-2 P5 C1: every allowlist entry still describes the tree', () => {
  const files = new Map(trackedSources().map((f) => [f, fs.readFileSync(path.join(REPO, f), 'utf8')]));
  assert.deepEqual(verdict(files, ALLOWLIST).stale, []);
});

test('the instrument fails: on a definition, on each kind of label, and on a stale allowlist entry', () => {
  const synthetic = new Map([
    ['src/x/A.tsx', `function StatusBadge() { return null; }\nconst o = [{ label: 'Unverified' }];`],
    ['src/x/B.tsx', `export const StatusBadge = () => <span> Fully attested </span>;\nconst t = \`Evaluated\`;`],
    ['src/x/C.ts', `export { Badge as StatusBadge } from './badge';\nconst s = "Consistency tested";`],
    ['src/x/D.ts', `const fine = 'Consistency test'; const alsoFine = 'Unverified signature';`],
  ]);
  const { unallowed, stale } = verdict(synthetic, [{ file: 'src/x/gone.ts', hit: 'Evaluated', why: 'decoy' }, { file: 'src/x/D.ts', hit: 'Evaluated', why: 'decoy' }]);
  assert.deepEqual(unallowed.map((h) => `${h.file} ${h.kind} ${h.text}`).sort(), [
    'src/x/A.tsx definition StatusBadge',
    'src/x/A.tsx label Unverified',
    'src/x/B.tsx definition StatusBadge',
    'src/x/B.tsx label Evaluated',
    'src/x/B.tsx label Fully attested',
    'src/x/C.ts definition StatusBadge',
    'src/x/C.ts label Consistency tested',
  ]);
  assert.equal(stale.length, 2, `stale: ${JSON.stringify(stale)}`);
});
