// THROWAWAY red instrument — Wave N11 P3 (#434), criterion 5 (#426). Never merged.
//
// THE PROPERTY (#406, #426): a surface that renders a recorded tool call's
// `reason` phrase renders it through `reasonWithoutIdentifier`
// (`src/lib/streaming.ts:921`) and states whether the call was rejected.
// `generateToolReason` writes `to look up ${id}` for a `fetch`, so a rejected
// fetch's phrase names `record:<portal>/<dataset>/<row>` — a portal the call
// never reached, printed on the surface that should say it was refused.
//
// THE UNIVERSE is derived, not listed (D10): every tracked non-test `.tsx` file,
// from `git ls-files`, read as a TypeScript syntax tree. A RENDER is a JSX child
// `{…}` whose value is the phrase itself — `x.reason`, `x['reason']`, a bare
// `reason`, or a template, concatenation or conditional carrying one. A prop
// (`reason={x.reason}`) renders nothing and is not a site; the component that
// receives it is. A comment is not syntax and never counts.
//
// RED at f32b679, measured by running this file: the sites it names are the
// sites the scan found; nothing lists them.
//
// BLIND SPOTS: a phrase renamed before it renders (`const why = q.reason`); a
// `.ts` formatter that interpolates it (the two that do — `notebook.ts:467`,
// `streaming.ts:1193` — already call the sanitiser); a `.tsx` that reads
// `failed` for some other purpose passes the second half.
//
// Run with: node --test --experimental-strip-types src/components/notebook/p3-red-reason-render.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { generateToolReason, reasonWithoutIdentifier } from '../../lib/streaming.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SANITISER = 'reasonWithoutIdentifier';

interface Render { line: number; text: string; sanitised: boolean }

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
}

/** Is this expression's rendered value (part of) a reason phrase? */
function carriesPhrase(expr: ts.Expression): boolean {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) return e.text === 'reason';
  if (ts.isPropertyAccessExpression(e)) return e.name.text === 'reason';
  if (ts.isElementAccessExpression(e)) {
    return ts.isStringLiteralLike(e.argumentExpression) && e.argumentExpression.text === 'reason';
  }
  if (ts.isTemplateExpression(e)) return e.templateSpans.some((s) => carriesPhrase(s.expression));
  if (ts.isConditionalExpression(e)) return carriesPhrase(e.whenTrue) || carriesPhrase(e.whenFalse);
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken) return carriesPhrase(e.left) || carriesPhrase(e.right);
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return carriesPhrase(e.right);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return carriesPhrase(e.left) || carriesPhrase(e.right);
    }
  }
  return false;
}

function callsSanitiser(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === SANITISER) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function rendersOf(sf: ts.SourceFile): Render[] {
  const out: Render[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      const raw = carriesPhrase(n.expression);
      const sanitised = !raw && callsSanitiser(n.expression);
      if (raw || sanitised) {
        out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: n.expression.getText(sf), sanitised });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function readsFailed(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'failed') found = true;
    else if (
      ts.isIdentifier(n) && n.text === 'failed' &&
      !ts.isPropertyAccessExpression(n.parent) && !ts.isPropertySignature(n.parent)
    ) found = true;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

// --- The instrument, checked against a decoy first -----------------------------

test('the instrument: raw renders are found, a sanitised one is told apart, a prop and a comment are not renders (decoy)', () => {
  const decoy = parse('decoy.tsx', [
    'export function A({ q, reason }: { q: { reason?: string }; reason?: string }) {',
    '  return (',
    '    <div>',
    '      {/* {q.reason} inside a comment */}',
    '      <C reason={q.reason} />',
    '      <span>{reasonWithoutIdentifier(q.reason)}</span>',
    '      <span>{q.reason}</span>',
    '      <span>{`why: ${reason}`}</span>',
    '      {q.reason && <b>{q["reason"]}</b>}',
    '    </div>',
    '  );',
    '}',
  ].join('\n'));
  assert.deepEqual(
    rendersOf(decoy).map((r) => [r.line, r.sanitised]),
    [[6, true], [7, false], [8, false], [9, false]],
  );
});

test('premise: a rejected fetch’s recorded phrase carries its identifier, and the sanitiser drops the phrase whole', () => {
  const phrase = generateToolReason({ id: 'record:data.example.org/efgh-5678/7' }, 'fetch');
  assert.match(phrase, /record:data\.example\.org\/efgh-5678\/7/);
  assert.equal(reasonWithoutIdentifier(phrase), undefined);
});

// --- The red --------------------------------------------------------------------

test('#426 RED: every surface that renders a recorded call’s reason renders it through reasonWithoutIdentifier, and reads failed', () => {
  const files = execFileSync('git', ['ls-files', '--', '*.tsx'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !f.endsWith('.test.tsx'));
  assert.ok(files.length >= 70, `the universe is every tracked non-test .tsx file; git ls-files returned ${files.length}`);
  const problems: string[] = [];
  const sites: string[] = [];
  for (const file of files) {
    const sf = parse(file, readFileSync(join(ROOT, file), 'utf8'));
    const renders = rendersOf(sf);
    if (renders.length === 0) continue;
    sites.push(`${file} (${renders.map((r) => `:${r.line}${r.sanitised ? ' sanitised' : ' raw'}`).join(', ')})`);
    for (const r of renders.filter((x) => !x.sanitised)) {
      problems.push(`${file}:${r.line} renders \`${r.text}\` raw, not through ${SANITISER}`);
    }
    if (!readsFailed(sf)) {
      problems.push(`${file} renders a recorded call's reason and never reads \`failed\` — a rejected call renders as an answered one`);
    }
  }
  console.log(`# sites the scan found: ${sites.length}\n${sites.map((s) => `#   ${s}`).join('\n')}`);
  assert.deepEqual(problems, [], problems.join('\n'));
});
