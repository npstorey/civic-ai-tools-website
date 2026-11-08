// UX-2 P4b: the Sources panel is removed from every page (#729 comment
// 6728493444, "507 - a"). Its rows and controls are the Settings overlay's.
//
// WHAT IS READ. Every `.tsx` file `git ls-files` tracks under `src/` (tests
// and the panel's own file excepted), parsed by the TypeScript compiler: no
// JSX element named `SourcesPanel`, no import of `sources/SourcesPanel`, and
// no "Data sources this site can use", the panel's drawer summary. The driven
// half (home, `/ask`, `/explore` rendered) is in `just-in-time-line.test.ts`
// and `consent-surfaces-driven.test.ts` (flag 9).
//
// BLIND SPOTS, stated. A mount through `createElement(SourcesPanel)` or a
// renamed import is seen only by the import check; an untracked file is not
// seen.
//
// WHAT MAKES IT ABLE TO FAIL. At the base `QueryForm.tsx` and
// `TraceControls.tsx` mount the panel inside that drawer. The decoy below
// shows the scan reads a mount.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = path.resolve(SRC, '..');
const PANEL_FILE = 'src/components/sources/SourcesPanel.tsx';
const SUMMARY = 'Data sources this site can use';

interface Finding { file: string; what: string }

function findingsIn(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const out: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sf) === 'SourcesPanel') out.push({ file, what: '<SourcesPanel>' });
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /(^|\/)SourcesPanel$/.test(node.moduleSpecifier.text)) out.push({ file, what: `import ${node.moduleSpecifier.text}` });
    if (ts.isJsxText(node) && node.getText(sf).includes(SUMMARY)) out.push({ file, what: SUMMARY });
    if (ts.isStringLiteralLike(node) && node.text.includes(SUMMARY)) out.push({ file, what: SUMMARY });
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const tracked = execFileSync('git', ['ls-files', '--', 'src'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.tsx') && !/\.test\.tsx?$/.test(f) && f !== PANEL_FILE);

test('premise: the scan reads the tracked .tsx files under src/, the two former mounts among them', () => {
  assert.ok(tracked.length > 50, `only ${tracked.length} tracked .tsx files were found`);
  for (const f of ['src/components/QueryForm.tsx', 'src/components/explore/TraceControls.tsx']) assert.ok(tracked.includes(f), `the scan does not see ${f}`);
});

test('decoy: a drawer mounting the panel reads as three findings', () => {
  const decoy = `import SourcesPanel from '@/components/sources/SourcesPanel';\nexport function X() { return <details><summary>${SUMMARY}</summary><SourcesPanel /></details>; }`;
  assert.deepEqual(findingsIn('decoy.tsx', decoy).map((f) => f.what).sort(), ['<SourcesPanel>', SUMMARY, 'import @/components/sources/SourcesPanel'].sort());
});

test('UX-2 P4b: no tracked component mounts the Sources panel or names its drawer', () => {
  const found = tracked.flatMap((file) => findingsIn(file, fs.readFileSync(path.join(ROOT, file), 'utf8')));
  assert.deepEqual(found, [], `the Sources panel is still mounted: ${JSON.stringify(found)}`);
});
