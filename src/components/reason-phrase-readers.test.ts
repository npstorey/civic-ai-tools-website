// #426 (Wave N11 P3, criterion A5; the owner's ruling R5): a recorded tool
// call's `reason` phrase reaches a reader only through `reasonWithoutIdentifier`
// (`src/lib/streaming.ts`), on every call, answered or rejected — and a surface
// that turns the phrase into words also reads whether the call was rejected.
//
// WHY THE PHRASE. `generateToolReason` writes `to look up ${id}` for a `fetch`,
// so the phrase of a `fetch` names `record:<portal>/<dataset>/<row>`. Printed on
// a surface as the call runs, or in the chat output's deliberative trace, it
// puts a portal in front of a reader — for a rejected call, one the request
// never reached (design-principles.md, the corollary on a step a document cannot
// account for).
//
// THE UNIVERSE IS DERIVED (D10), and it is stricter than "every .tsx": it is
// every tracked non-test `.tsx`/`.jsx` (from `git ls-files`), AND every tracked
// local module one of them imports at run time (a value import, by relative path
// or the `@/` alias; `import type` is skipped) — the modules a surface renders
// from. Each is read as a TypeScript syntax tree, so a comment never counts.
//
// THE RULE IS ON READS, not on one render shape. A READ is `x.reason`,
// `x['reason']`, an identifier named `reason`, or `reason` destructured under
// another name. Each read must be one of:
//   - sanitised — an argument of `reasonWithoutIdentifier`, or of a function in
//     the same file that reads that parameter only through it, or a read of a
//     binding whose initializer produced it through the sanitiser;
//   - kept under its own name — `{ reason: x.reason }`, `{ reason }`,
//     `const reason = x.reason`, `<Card reason={x.reason} />` — so wherever it
//     goes next, it is read again, by this rule;
//   - a test that renders nothing — `x.reason && …`, `if (reason)`, a comparison.
// Anything else is a finding: rendered as a JSX child or an element attribute,
// interpolated, concatenated, put in an array, passed to another function,
// returned, or bound under another name (so a rename cannot carry the phrase out
// of sight). Then: a file whose reads turn the phrase into words (sanitised or
// not) must also read `failed`, or a rejected call reads there as an answered one.
//
// RED at f32b679, measured: `ToolCallCard.tsx:190` and `ChatNotebookOutput.tsx:293`
// (each rendered as a JSX child, raw); `ChatNotebookOutput.tsx` reading no
// `failed`; and `useNotebookStream.ts:189`, a third surface no list named and a
// `.tsx`-only scan cannot see — the notebook page's live progress line, which the
// hook builds as `fetch (to look up record:…)` and `NotebookProgress.tsx` renders
// while the call runs.
//
// LISTS, each checked in both directions. `NOT_A_CALL_PHRASE` names a file whose
// `reason` is not a tool call's phrase, with why; an entry that no longer names
// an unsanitised read in the universe is stale and fails. The sanitiser's name
// and home are an anchor: the home must declare it, and no other tracked module
// may declare a lookalike.
//
// BLIND SPOTS. A module two imports away from a surface (a formatter imported by
// a formatter); a re-export (`export … from`); a phrase read through a computed
// key or under another field name; a whole record stringified (`JSON.stringify(q)`
// renders its phrase and is not a read of `reason`); scope resolution by name
// through enclosing blocks and parameters, not by the type checker; a file that
// reads `failed` for another purpose passes the second half; and the
// executed-notebook generator (`notebook-author/tool-to-cell.ts`), which no
// surface imports at run time, is outside the universe.
// `deliberative-trace-line.test.ts` drives the chat output's words; this file
// reads the wiring.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/reason-phrase-readers.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PHRASE = 'reason';
const OUTCOME = 'failed';
const SANITISER = 'reasonWithoutIdentifier';
const SANITISER_HOME = 'src/lib/streaming.ts';

/** Files whose `reason` is not a recorded tool call's phrase — each with why. */
const NOT_A_CALL_PHRASE: Record<string, string> = {
  'src/lib/evidence/lifecycle.ts':
    "a withdrawal's or reinstatement's stated reason: words the signer wrote for readers, which the record page " +
    "renders on purpose (as `withdrawnReason` / `reinstatedReason`); not a tool call's phrase, and no call outcome belongs beside it",
};

// --- The universe ---------------------------------------------------------------

const isModule = (f: string): boolean => /\.(c|m)?[jt]sx?$/.test(f) && !/\.test\.(c|m)?[jt]sx?$/.test(f);
const isSurface = (f: string): boolean => /\.[jt]sx$/.test(f) && !/\.test\.[jt]sx$/.test(f);

function tracked(): string[] {
  const listing = execFileSync('git', ['ls-files', '-z', '--full-name'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = listing.split('\0').filter((f) => f !== '' && isModule(f) && existsSync(posix.join(REPO_ROOT, f)));
  assert.ok(files.length > 0, 'git ls-files reported no source files: the scan has stopped measuring');
  return files;
}

export function parse(file: string, text: string): ts.SourceFile {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX
    : /\.jsx$/.test(file) ? ts.ScriptKind.JSX
    : /\.(c|m)?ts$/.test(file) ? ts.ScriptKind.TS
    : ts.ScriptKind.JS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

function candidatesFor(file: string, specifier: string): string[] {
  let base: string;
  if (specifier.startsWith('@/')) base = posix.join('src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(file), specifier));
  else return [];
  const stem = base.replace(/\.(c|m)?[jt]sx?$/, '');
  return [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.mjs`, posix.join(base, 'index.ts'), posix.join(base, 'index.tsx')];
}

/** The tracked local modules a file imports at run time — value imports only. */
function runtimeImports(file: string, sf: ts.SourceFile, known: Set<string>): string[] {
  const out: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const clause = st.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    const hasValue = clause.name !== undefined ||
      (bindings !== undefined && (ts.isNamespaceImport(bindings) || bindings.elements.some((e) => !e.isTypeOnly)));
    if (!hasValue) continue;
    const hit = candidatesFor(file, st.moduleSpecifier.text).find((c) => known.has(c));
    if (hit) out.push(hit);
  }
  return out;
}

// --- Reading one file ----------------------------------------------------------------

export type Verdict = 'raw' | 'sanitised' | 'kept' | 'test';

export interface Read {
  line: number;
  text: string;
  verdict: Verdict;
  why: string;
}

const TRANSPARENT = (n: ts.Node): boolean =>
  ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) ||
  ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n);

const COMPARISONS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.InstanceOfKeyword, ts.SyntaxKind.InKeyword,
]);

function nameText(n: ts.PropertyName | ts.JsxAttributeName): string {
  return ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) ? n.text : n.getText();
}

function isIntrinsic(tag: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tag) ? /^[a-z]/.test(tag.text) || tag.text.includes('-') : !ts.isPropertyAccessExpression(tag);
}

/** An identifier read as a value — not a declaration's name, a key, a member name, a type or a JSX attribute's name. */
function isValueIdentifier(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) ||
    ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) ||
    ts.isEnumMember(p)) && p.name === id) return false;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) ||
    ts.isClassDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) && p.name === id) return false;
  if (ts.isBindingElement(p)) return false;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return false;
  if (ts.isJsxAttribute(p)) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p)) return false;
  for (let a: ts.Node | undefined = p; a; a = a.parent) if (ts.isTypeNode(a)) return false;
  return true;
}

function enclosingFunctionName(n: ts.Node): string | undefined {
  for (let a: ts.Node | undefined = n.parent; a; a = a.parent) {
    if (ts.isFunctionDeclaration(a) && a.name) return a.name.text;
    if ((ts.isArrowFunction(a) || ts.isFunctionExpression(a)) && ts.isVariableDeclaration(a.parent) && ts.isIdentifier(a.parent.name)) {
      return a.parent.name.text;
    }
  }
  return undefined;
}

/** Where a phrase read goes: the verdict, and why. */
function classify(read: ts.Node, sf: ts.SourceFile, sanitising: Map<string, Set<number>>): { verdict: Verdict; why: string } {
  let top: ts.Node = read;
  for (;;) {
    const p = top.parent;
    if (!p) return { verdict: 'raw', why: 'reaches the top of the file' };
    if (TRANSPARENT(p)) { top = p; continue; }
    if (ts.isConditionalExpression(p)) {
      if (p.condition === top) return { verdict: 'test', why: 'tested' };
      top = p;
      continue;
    }
    if (ts.isBinaryExpression(p)) {
      const op = p.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        if (p.left === top) return { verdict: 'test', why: 'tested' };
        top = p;
        continue;
      }
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.PlusToken) {
        top = p;
        continue;
      }
      if (COMPARISONS.has(op)) return { verdict: 'test', why: 'compared' };
      if (op === ts.SyntaxKind.EqualsToken && p.right === top) {
        const left = p.left;
        const same = (ts.isIdentifier(left) && left.text === PHRASE) ||
          (ts.isPropertyAccessExpression(left) && left.name.text === PHRASE);
        return same ? { verdict: 'kept', why: 'assigned under its own name' } : { verdict: 'raw', why: `assigned to ${left.getText(sf)}` };
      }
      return { verdict: 'raw', why: `an operand of ${ts.tokenToString(op) ?? 'an operator'}` };
    }
    if (ts.isTemplateSpan(p)) { top = p.parent; continue; }
    if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return { verdict: 'test', why: 'negated' };
    if (ts.isTypeOfExpression(p)) return { verdict: 'test', why: 'typeof' };
    if ((ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) && p.expression === top) return { verdict: 'test', why: 'tested' };
    if (ts.isExpressionStatement(p)) return { verdict: 'test', why: 'evaluated for nothing' };
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const callee = p.expression;
      if (callee === top) return { verdict: 'raw', why: 'called' };
      const index = (p.arguments ?? ts.factory.createNodeArray()).indexOf(top as ts.Expression);
      if (ts.isIdentifier(callee) && callee.text === SANITISER) return { verdict: 'sanitised', why: `through ${SANITISER}` };
      if (ts.isIdentifier(callee) && sanitising.get(callee.text)?.has(index)) {
        return { verdict: 'sanitised', why: `through ${callee.text}, which reads it only through ${SANITISER}` };
      }
      return { verdict: 'raw', why: `passed to ${callee.getText(sf)}` };
    }
    if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === top) {
      return { verdict: 'raw', why: `read through ${p.getText(sf).slice(top.getText(sf).length)}` };
    }
    if (ts.isPropertyAssignment(p) && p.initializer === top) {
      return nameText(p.name) === PHRASE ? { verdict: 'kept', why: 'kept under its own name' } : { verdict: 'raw', why: `stored as ${nameText(p.name)}` };
    }
    if (ts.isShorthandPropertyAssignment(p)) return { verdict: 'kept', why: 'kept under its own name' };
    if (ts.isVariableDeclaration(p) && p.initializer === top) {
      return ts.isIdentifier(p.name) && p.name.text === PHRASE
        ? { verdict: 'kept', why: 'bound under its own name' }
        : { verdict: 'raw', why: `bound as ${p.name.getText(sf)}` };
    }
    if (ts.isJsxExpression(p)) {
      const host = p.parent;
      if (ts.isJsxAttribute(host)) {
        const tag = host.parent.parent.tagName;
        const name = nameText(host.name);
        if (!isIntrinsic(tag) && name === PHRASE) return { verdict: 'kept', why: 'handed to a component as its own reason' };
        return { verdict: 'raw', why: isIntrinsic(tag) ? `rendered as the ${name} attribute` : `handed to a component as ${name}` };
      }
      return { verdict: 'raw', why: 'rendered as a JSX child' };
    }
    if (ts.isArrayLiteralExpression(p)) return { verdict: 'raw', why: 'put in an array' };
    return { verdict: 'raw', why: `used in a ${ts.SyntaxKind[p.kind]}` };
  }
}

/** Same-file functions that read a parameter only through the sanitiser (or only test it): name → parameter indexes. */
function sanitisingFunctions(sf: ts.SourceFile): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const consider = (name: string, fn: ts.SignatureDeclarationBase & { body?: ts.Node }): void => {
    if (!fn.body) return;
    fn.parameters.forEach((param, i) => {
      if (!ts.isIdentifier(param.name)) return;
      const pname = param.name.text;
      let reads = 0;
      let clean = true;
      const visit = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && n.text === pname && isValueIdentifier(n)) {
          reads++;
          const { verdict } = classify(n, sf, new Map());
          if (verdict !== 'sanitised' && verdict !== 'test') clean = false;
        }
        ts.forEachChild(n, visit);
      };
      visit(fn.body!);
      if (reads > 0 && clean) {
        if (!out.has(name)) out.set(name, new Set());
        out.get(name)!.add(i);
      }
    });
  };
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name) consider(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) consider(n.name.text, n.initializer);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

/** The declaration an identifier resolves to: the nearest enclosing scope that binds its name. */
function declarationOf(id: ts.Identifier): ts.Node | undefined {
  const binds = (name: ts.BindingName): boolean =>
    ts.isIdentifier(name) ? name.text === id.text : name.elements.some((e) => !ts.isOmittedExpression(e) && binds(e.name));
  for (let a: ts.Node | undefined = id.parent; a; a = a.parent) {
    if (ts.isFunctionLike(a)) {
      const param = a.parameters.find((p) => binds(p.name));
      if (param) return param;
    }
    if (ts.isBlock(a) || ts.isSourceFile(a) || ts.isModuleBlock(a) || ts.isCaseClause(a) || ts.isDefaultClause(a)) {
      for (const st of a.statements) {
        if (!ts.isVariableStatement(st)) continue;
        const decl = st.declarationList.declarations.find((d) => binds(d.name));
        if (decl) return decl;
      }
    }
    if ((ts.isForStatement(a) || ts.isForOfStatement(a) || ts.isForInStatement(a)) && a.initializer && ts.isVariableDeclarationList(a.initializer)) {
      const decl = a.initializer.declarations.find((d) => binds(d.name));
      if (decl) return decl;
    }
    if (ts.isCatchClause(a) && a.variableDeclaration && binds(a.variableDeclaration.name)) return a.variableDeclaration;
  }
  return undefined;
}

/**
 * Whether a binding holds the phrase only as the sanitiser returned it —
 * `const reason = reasonWithoutIdentifier(tool.reason) || \`Query ${i + 1}\``
 * (`notebook.ts:467`): its initializer calls the sanitiser, and no read inside
 * it is raw. A read of such a binding is sanitised wherever it goes next.
 */
function boundThroughSanitiser(decl: ts.Node | undefined, sf: ts.SourceFile, sanitising: Map<string, Set<number>>): boolean {
  if (!decl || !ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name) || !decl.initializer) return false;
  let calls = false;
  let raw = false;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === SANITISER) calls = true;
    const isRead = (ts.isPropertyAccessExpression(n) && n.name.text === PHRASE) || (ts.isIdentifier(n) && n.text === PHRASE && isValueIdentifier(n));
    if (isRead && classify(n, sf, sanitising).verdict === 'raw') raw = true;
    ts.forEachChild(n, visit);
  };
  visit(decl.initializer);
  return calls && !raw;
}

export function readsOf(file: string, sf: ts.SourceFile): { reads: Read[]; readsOutcome: boolean } {
  const sanitising = sanitisingFunctions(sf);
  const reads: Read[] = [];
  let readsOutcome = false;
  const at = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const record = (n: ts.Node): void => {
    // The sanitiser's own body reads its parameter to decide; that is the rule, not a reader of it.
    if (file === SANITISER_HOME && enclosingFunctionName(n) === SANITISER) return;
    if (ts.isIdentifier(n)) {
      const decl = declarationOf(n);
      if (boundThroughSanitiser(decl, sf, sanitising)) {
        reads.push({ line: at(n), text: n.getText(sf), verdict: 'sanitised', why: `bound through ${SANITISER} at :${at(decl!)}` });
        return;
      }
    }
    const { verdict, why } = classify(n, sf, sanitising);
    reads.push({ line: at(n), text: n.getText(sf), verdict, why });
  };
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      if (n.name.text === PHRASE && !(ts.isBinaryExpression(n.parent) && n.parent.left === n && n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken)) record(n);
      if (n.name.text === OUTCOME) readsOutcome = true;
    } else if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression)) {
      if (n.argumentExpression.text === PHRASE) record(n);
      if (n.argumentExpression.text === OUTCOME) readsOutcome = true;
    } else if (ts.isIdentifier(n)) {
      if (n.text === PHRASE && (isValueIdentifier(n) || ts.isShorthandPropertyAssignment(n.parent))) record(n);
      if (n.text === OUTCOME && (isValueIdentifier(n) || ts.isShorthandPropertyAssignment(n.parent))) readsOutcome = true;
    } else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      const from = n.propertyName ? nameText(n.propertyName) : ts.isIdentifier(n.name) ? n.name.text : undefined;
      if (from === OUTCOME) readsOutcome = true;
      if (from === PHRASE && !(ts.isIdentifier(n.name) && n.name.text === PHRASE)) {
        reads.push({ line: at(n), text: n.getText(sf), verdict: 'raw', why: `destructured as ${n.name.getText(sf)}` });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { reads, readsOutcome };
}

/** A file's findings: every raw read, and a missing outcome read where the phrase becomes words. */
export function problemsOf(file: string, sf: ts.SourceFile): { problems: string[]; sites: Read[]; raw: Read[] } {
  const { reads, readsOutcome } = readsOf(file, sf);
  const raw = reads.filter((r) => r.verdict === 'raw');
  const sites = reads.filter((r) => r.verdict === 'raw' || r.verdict === 'sanitised');
  const problems = raw.map((r) => `${file}:${r.line} ${r.why}, not through ${SANITISER}: \`${r.text}\``);
  if (sites.length > 0 && !readsOutcome) {
    problems.push(`${file} turns a recorded call's reason into words and never reads \`${OUTCOME}\` — a rejected call reads there as an answered one`);
  }
  return { problems, sites, raw };
}

// --- The instrument, against decoys ------------------------------------------------------

test('the instrument: reads are found by syntax and judged by where they go (decoys)', () => {
  const src = [
    "import { reasonWithoutIdentifier } from '@/lib/streaming';",
    'function safe(r?: string) { return reasonWithoutIdentifier(r); }',
    'export function A({ q, reason }: { q: { reason?: string; failed?: boolean }; reason?: string }) {',
    '  const shown = reasonWithoutIdentifier(q.reason);',
    '  const why = q.reason;',
    '  const { reason: alias } = q;',
    '  return (',
    '    <div>',
    '      {/* {q.reason} inside a comment */}',
    '      <Card reason={q.reason} />',
    '      <Card label={q.reason} />',
    '      <span title={q.reason}>x</span>',
    '      <b>{shown}</b>',
    '      <b>{safe(q.reason)}</b>',
    '      {q.reason && <i>{`why: ${reason}`}</i>}',
    '      {q.reason === "x" ? null : <u>{why}{alias}</u>}',
    '    </div>',
    '  );',
    '}',
  ].join('\n');
  const { reads, readsOutcome } = readsOf('decoy.tsx', parse('decoy.tsx', src));
  const byLine = reads.map((r) => [r.line, r.verdict]);
  assert.deepEqual(byLine, [
    [4, 'sanitised'], // reasonWithoutIdentifier(q.reason)
    [5, 'raw'], //       bound as why — a rename cannot carry it out of sight
    [6, 'raw'], //       destructured as alias
    [10, 'kept'], //     <Card reason=…>: the component reads it again
    [11, 'raw'], //      <Card label=…>: renamed across a component
    [12, 'raw'], //      an element attribute renders
    [14, 'sanitised'], // a same-file function that reads it only through the sanitiser
    [15, 'test'], //     q.reason && …
    [15, 'raw'], //      interpolated into a template
    [16, 'test'], //     compared
  ]);
  assert.equal(readsOutcome, false, 'the decoy reads no `failed`');
  const { problems } = problemsOf('decoy.tsx', parse('decoy.tsx', src));
  assert.ok(problems.some((p) => p.includes('never reads `failed`')), 'a surface that renders the phrase without reading `failed` is a finding');
  const withOutcome = problemsOf('ok.tsx', parse('ok.tsx', [
    "import { reasonWithoutIdentifier } from '@/lib/streaming';",
    'export const B = ({ q }: { q: { reason?: string; failed?: boolean } }) => <b data-failed={q.failed}>{reasonWithoutIdentifier(q.reason)}</b>;',
  ].join('\n')));
  assert.deepEqual(withOutcome.problems, [], 'a sanitised render beside a `failed` read is clean');
  assert.equal(withOutcome.sites.length, 1);
});

test('the instrument: a binding made through the sanitiser stays sanitised wherever it goes; a label built from the raw phrase does not (decoys)', () => {
  const src = [
    "import { reasonWithoutIdentifier } from './streaming.ts';",
    'export function heading(tool: { reason?: string }, i: number) {',
    '  const reason = reasonWithoutIdentifier(tool.reason) || `Query ${i + 1}`;',
    '  return [`## Step ${i + 1}: ${reason}`];',
    '}',
    'export function label(raw: { reason?: unknown }, op: string) {',
    '  const reason = raw.reason as string | undefined;',
    '  return [op, reason ? `(${reason})` : null].filter(Boolean).join(" ");',
    '}',
  ].join('\n');
  const { reads } = readsOf('decoy.ts', parse('decoy.ts', src));
  assert.deepEqual(reads.map((r) => [r.line, r.verdict]), [
    [3, 'sanitised'], // tool.reason, inside the sanitiser
    [4, 'sanitised'], // the binding made through it, interpolated later
    [7, 'kept'], //      raw.reason, bound under its own name
    [8, 'test'], //      reason ? … — tested
    [8, 'raw'], //       (${reason}) — a label built from the raw phrase
  ]);
});

// --- The anchor and the list, both directions ----------------------------------------------

const FILES = tracked();
const KNOWN = new Set(FILES);
const TREES = new Map<string, ts.SourceFile>();
const treeOf = (file: string): ts.SourceFile => {
  if (!TREES.has(file)) TREES.set(file, parse(file, readFileSync(posix.join(REPO_ROOT, file), 'utf8')));
  return TREES.get(file)!;
};
const SURFACES = FILES.filter(isSurface);
const UNIVERSE = [...new Set([...SURFACES, ...SURFACES.flatMap((f) => runtimeImports(f, treeOf(f), KNOWN))])].sort();

test('the anchor: the sanitiser’s home declares it, and no other tracked module declares a lookalike', () => {
  const declares = (file: string): boolean => {
    let found = false;
    const walk = (n: ts.Node): void => {
      if ((ts.isFunctionDeclaration(n) && n.name?.text === SANITISER) ||
        (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === SANITISER)) found = true;
      ts.forEachChild(n, walk);
    };
    walk(treeOf(file));
    return found;
  };
  assert.ok(declares(SANITISER_HOME), `${SANITISER_HOME} declares no ${SANITISER}`);
  const others = FILES.filter((f) => f !== SANITISER_HOME && declares(f));
  assert.deepEqual(others, [], `a second ${SANITISER} would let a surface sanitise through a lookalike: ${others.join(', ')}`);
});

test('NOT_A_CALL_PHRASE, both directions: every entry is in the universe and still carries an unsanitised read', () => {
  for (const [file, why] of Object.entries(NOT_A_CALL_PHRASE)) {
    assert.ok(why.length > 0, `${file} is listed with no reason`);
    assert.ok(UNIVERSE.includes(file), `${file} is listed but no surface imports it at run time any more — the entry is stale`);
    assert.ok(problemsOf(file, treeOf(file)).raw.length > 0, `${file} is listed but carries no unsanitised read any more — the entry is stale`);
  }
});

// --- The universe ------------------------------------------------------------------------------

test('every read of a recorded call’s reason phrase, across every surface and the modules it renders from, goes through reasonWithoutIdentifier, and reads failed beside it', () => {
  assert.ok(SURFACES.length >= 70, `the universe starts from every tracked non-test .tsx; git ls-files returned ${SURFACES.length}`);
  const problems: string[] = [];
  const sites: string[] = [];
  for (const file of UNIVERSE) {
    if (file in NOT_A_CALL_PHRASE) continue;
    const found = problemsOf(file, treeOf(file));
    if (found.sites.length > 0) sites.push(`${file} (${found.sites.map((s) => `:${s.line} ${s.verdict}`).join(', ')})`);
    problems.push(...found.problems);
  }
  console.log(`# universe: ${SURFACES.length} surfaces + ${UNIVERSE.length - SURFACES.length} modules they render from`);
  console.log(`# sites where the phrase becomes words: ${sites.length}\n${sites.map((s) => `#   ${s}`).join('\n')}`);
  assert.deepEqual(problems, [], problems.join('\n'));
});
