/**
 * Guard: the notebook extension key has one declaration family (#403; Wave
 * N11 #434, P2).
 *
 * WHAT IT GUARDS. A signed package carries its notebook under one key (Typed
 * Standards §8.7.4). Every producer writes under it — the skeleton generator,
 * the executed pipeline, the publish dialog — and every reader looks under it:
 * the record page, the bundle route, and the content hash that decides what a
 * datHere signature covers. A site that restates the string instead of
 * importing it is one edit away from looking under a key no producer wrote: the
 * page would show no notebook, the bundle route would answer 500, and nothing
 * would say why. At `567e2f2` the key had six named declarations in this tree —
 * two lib exports, two app-local copies (the record page and the bundle route)
 * and two test-local copies — plus three inline uses in code. This file holds
 * the tree to the two lib exports.
 *
 * THE TWO DECLARATIONS, both kept on purpose. `./prompt.ts` is the executed
 * pipeline's; it reaches `../site-config.ts`, which reads server environment,
 * so it cannot ride into a client bundle. `./notebook-provenance-reading.ts`
 * imports only pure data, so it is the one a client component — and every
 * other reader — imports. The first test pins them equal to each other and to
 * the protocol string.
 *
 * THE UNIVERSE, DERIVED. Two questions, each answered by git over every
 * tracked file, with no directory list and no extension list in front of it:
 *   - the string: `git grep -l -F <key>` — code, tests, docs and data,
 *     wherever they sit;
 *   - the name: `git grep -l -w -F NOTEBOOK_EXTENSION_KEY`.
 * Git answers or the scan throws. A file that is not yet staged is not
 * tracked and is not scanned; it is seen the moment it is staged, before a
 * commit can carry it. (The precedents are `../model-loop/model-call-registry
 * .test.ts` and `scripts/env-reads-declared.test.mjs`.)
 *
 * HOW A FILE IS READ. A file whose name matches /\.(c|m)?[jt]sx?$/ is parsed
 * into a TypeScript syntax tree. A comment is not a node of that tree, so the
 * key in prose — which is most of what the tree carries — is never counted.
 * Any other file in the universe is not code, and must be of a kind NON_CODE
 * names with the reason that kind carries the string. A file of any other kind
 * (a Python helper, a workflow, a talk deck) fails until it is classified.
 *
 * WHICH LITERAL FORMS COUNT. A string literal, or a template literal with no
 * substitution, whose WHOLE text is the key. That covers an object key, an
 * element access, a variable, parameter, class-field or enum initializer, a
 * default export, a comparison, an argument and a JSX attribute. It does NOT
 * cover the key as a substring of a longer string (the bundle route's error
 * message is one), a template literal with a substitution (`./validate.ts`'s
 * issue paths, which interpolate the constant), JSX text, a regular expression,
 * or a string assembled by concatenation. Each counted site has a FORM: a
 * declaration, where the literal initialises a binding (a variable, a class
 * field, an enum member, a parameter or destructuring default, a default
 * export); or a use, which is everything else.
 *
 * THE RULES. Every list is checked in both directions.
 *   1. The value. Both declarations equal the protocol string (restated once
 *      here, to pin them), and the dependency that fingerprints the notebook
 *      for a datHere signature looks under the same key. That dependency is
 *      checked by running it, not by reading it (see below).
 *   2. Declarations. The declaration-form sites in the whole universe are
 *      exactly the two in PINNED, each an exported top-level `const` bound to
 *      the key itself. A declaration anywhere else fails and cannot be
 *      allowlisted; a PINNED file that no longer holds its declaration fails.
 *   3. Uses. A use-form site outside a test must sit in a file on ALLOW, which
 *      states why that file cannot import. ALLOW is empty at this commit,
 *      because every inline use in code was converted to an import. An ALLOW
 *      entry whose file no longer carries a use fails. A use-form site in a
 *      TEST is permitted by class (TEST_FIXTURES, with its reason), and the
 *      class must still describe a site. A test-local declaration is not a
 *      fixture: rule 2 refuses it.
 *   4. The name. Every binding of `NOTEBOOK_EXTENSION_KEY` is either a PINNED
 *      declaration, or an import, re-export or destructured dynamic import from
 *      a module whose export chain ends at a pinned declaration. The chain is
 *      followed through re-exports, not listed: `./index.ts` re-exports
 *      `./prompt.ts`'s. A module that marks itself `'use client'` must reach
 *      the client-safe declaration.
 *   5. The non-code kinds. Each NON_CODE kind must still describe a file in the
 *      universe.
 *
 * THE DECLARATION THIS TREE CANNOT SEE. `@typedstandards/verify-core` declares
 * its own copy of the key (`dist/canonicalization.js` in 0.9.0) and uses it to
 * decide what a datHere content hash covers; the website reaches it through
 * `../evidence/canonicalization.ts`. It is a dependency, so it is untracked
 * and the text scan cannot read it. Rule 1 runs it instead: it fingerprints a
 * package whose notebook sits under this tree's key, then refuses one whose
 * notebook sits under another key. If the two copies ever disagreed, every
 * datHere publish would throw. This check turns that into a named test failure
 * rather than a publish failure.
 *
 * BLIND SPOTS, stated so nobody has to infer them:
 *   - Dependencies other than the one run above. `node_modules` is not
 *     tracked, so a package that restates the key and reads it on some other
 *     path is invisible here.
 *   - The forms "WHICH LITERAL FORMS COUNT" excludes. A reader that assembled
 *     the key from parts, under a name other than `NOTEBOOK_EXTENSION_KEY`,
 *     would pass; one that spelled it with an escape sequence is outside what
 *     git's fixed-string search finds.
 *   - Non-code files are classified, not parsed. A JSON file that code read
 *     the key from would count as data.
 *   - Other repositories. The harness, the server and the standard carry the
 *     string too; each is its own tree.
 *   - Whether a site is reachable. A use in dead code still counts, which is
 *     the safe direction.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import canonicalize from 'canonicalize';
import ts from 'typescript';
import {
  computeContentHashSha256,
  DATHERE_AG_JUPYTER_CANONICALIZATION,
} from '../evidence/canonicalization.ts';
import { NOTEBOOK_EXTENSION_KEY } from './notebook-provenance-reading.ts';
import { NOTEBOOK_EXTENSION_KEY as KEY_FROM_PROMPT } from './prompt.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const THIS_FILE = 'src/lib/notebook-author/notebook-extension-key.test.ts';
const NAME = 'NOTEBOOK_EXTENSION_KEY';
const CODE = /\.(c|m)?[jt]sx?$/;
const TEST = /\.test\.(c|m)?[jt]sx?$/;

/** The two declarations of the key, each with the reason it exists. */
const PINNED: Record<string, string> = {
  'src/lib/notebook-author/prompt.ts':
    "the executed pipeline's; it reaches ../site-config.ts, which reads server environment, so it is server-side only",
  'src/lib/notebook-author/notebook-provenance-reading.ts':
    'the client-safe one: it imports only pure data, so a client component, and every other reader, imports this',
};
const CLIENT_SAFE = 'src/lib/notebook-author/notebook-provenance-reading.ts';

/** Non-test files whose USE of the literal is allowed, each with why the file
 *  cannot import. Empty at this commit: every inline use was converted. */
const ALLOW: Record<string, string> = {};

/** The one class of use permitted without a per-file entry. */
const TEST_FIXTURES = {
  applies: (file: string): boolean => TEST.test(file),
  reason:
    "a test fixture restating the key is the protocol's bytes written out. If the constant ever changed, the fixture " +
    'fails loudly rather than misleading a reader. The drift this guard exists for is a production writer and reader ' +
    'disagreeing, and a test is neither. A test-local DECLARATION is not a fixture, and rule 2 refuses it.',
};

/** Kinds of file that carry the key or the name and are not code, each with why. */
const NON_CODE: Record<string, string> = {
  '.md':
    'prose — the publish contract, the setup guide, the vocabulary and a fixtures README — naming the key a reader ' +
    'meets in a package',
  '.json':
    "data — a stored package (the frozen pre-stamp fixture) whose bytes carry the key the way every package's do",
};

// --- git -----------------------------------------------------------------------

/** Every tracked file carrying `pattern` as a fixed string (as a word, when asked). */
function gitFilesCarrying(pattern: string, asWord: boolean): string[] {
  let listing: string;
  try {
    listing = execFileSync(
      'git',
      ['grep', '-l', '-z', '--full-name', '-F', ...(asWord ? ['-w'] : []), '-e', pattern],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    // `git grep` exits 1 when nothing matches, which is an answer. Anything else is not.
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
  return listing
    .split('\0')
    .filter((file) => file !== '')
    .filter((file) => existsSync(join(REPO_ROOT, file))); // a tracked file deleted from the working tree has nothing to read
}

// --- the syntax tree -----------------------------------------------------------

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(c|m)?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
}

function readSource(file: string): ts.SourceFile {
  return parse(file, readFileSync(join(REPO_ROOT, file), 'utf8'));
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function excerpt(sf: ts.SourceFile, node: ts.Node): string {
  return node.getText(sf).replace(/\s+/g, ' ').slice(0, 100);
}

function isWrapper(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  );
}

// --- literal sites -------------------------------------------------------------

type Form = 'declaration' | 'use';

interface LiteralSite {
  file: string;
  line: number;
  form: Form;
  excerpt: string;
}

/** A declaration when the literal initialises a binding; a use otherwise. */
function formOf(literal: ts.Node): Form {
  let node = literal;
  while (node.parent && isWrapper(node.parent)) node = node.parent;
  const parent = node.parent;
  if (!parent) return 'use';
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isEnumMember(parent)) &&
    parent.initializer === node
  ) {
    return 'declaration';
  }
  if (ts.isExportAssignment(parent)) return 'declaration';
  return 'use';
}

/** Every string literal (or substitution-free template) whose whole text is `key`. Pure. */
function literalSites(file: string, text: string, key: string): LiteralSite[] {
  const sf = parse(file, text);
  const sites: LiteralSite[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === key) {
      sites.push({ file, line: lineOf(sf, node), form: formOf(node), excerpt: excerpt(sf, node.parent) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

// --- bindings of the name ------------------------------------------------------

type BindingKind = 'declaration' | 'import' | 'reexport' | 'dynamic-import' | 'other';

interface NameBinding {
  file: string;
  line: number;
  kind: BindingKind;
  /** The module specifier an import, re-export or dynamic import names. */
  specifier?: string;
  /** For a declaration: an exported top-level `const` bound to the key literal itself. */
  pinnedShape?: boolean;
  excerpt: string;
}

function specifierText(node: ts.Expression | undefined): string | undefined {
  return node && ts.isStringLiteral(node) ? node.text : undefined;
}

/** The specifier of `import('…')` or `await import('…')`, or undefined. */
function dynamicImportSpecifier(initializer: ts.Expression | undefined): string | undefined {
  let node: ts.Node | undefined = initializer;
  while (node && (ts.isAwaitExpression(node) || isWrapper(node))) {
    node = (node as ts.AwaitExpression).expression;
  }
  if (node && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return specifierText(node.arguments[0]);
  }
  return undefined;
}

function hasPinnedShape(declaration: ts.VariableDeclaration, key: string): boolean {
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)) return false;
  const statement = list.parent;
  if (!ts.isVariableStatement(statement) || !ts.isSourceFile(statement.parent)) return false;
  const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  const init = declaration.initializer;
  return (
    exported &&
    init !== undefined &&
    (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) &&
    init.text === key
  );
}

/** Every place `file` binds the name `NOTEBOOK_EXTENSION_KEY`, classified. Pure. */
function nameBindings(file: string, text: string, key: string): NameBinding[] {
  const sf = parse(file, text);
  const out: NameBinding[] = [];
  const push = (node: ts.Node, kind: BindingKind, extra: Partial<NameBinding> = {}): void => {
    out.push({ file, line: lineOf(sf, node), kind, excerpt: excerpt(sf, node), ...extra });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node) && (node.name.text === NAME || node.propertyName?.text === NAME)) {
      // `import { OTHER as NOTEBOOK_EXTENSION_KEY }` binds the name to something else.
      if ((node.propertyName ?? node.name).text !== NAME) push(node, 'other');
      else push(node, 'import', { specifier: specifierText(node.parent.parent.parent.moduleSpecifier) });
    } else if (ts.isExportSpecifier(node) && (node.name.text === NAME || node.propertyName?.text === NAME)) {
      const declaration = node.parent.parent;
      // Without a module, `export { NOTEBOOK_EXTENSION_KEY }` exports a local
      // binding, which is classified where it is bound.
      if (declaration.moduleSpecifier !== undefined) {
        if ((node.propertyName ?? node.name).text !== NAME) push(node, 'other');
        else push(node, 'reexport', { specifier: specifierText(declaration.moduleSpecifier) });
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === NAME) {
      push(node, 'declaration', { pinnedShape: hasPinnedShape(node, key) });
    } else if (
      ts.isBindingElement(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === NAME) ||
        (node.propertyName !== undefined && ts.isIdentifier(node.propertyName) && node.propertyName.text === NAME))
    ) {
      const holder = node.parent.parent;
      const specifier = ts.isVariableDeclaration(holder) ? dynamicImportSpecifier(holder.initializer) : undefined;
      const imported =
        node.propertyName !== undefined && ts.isIdentifier(node.propertyName)
          ? node.propertyName.text
          : ts.isIdentifier(node.name)
            ? node.name.text
            : undefined;
      if (specifier !== undefined && imported === NAME && ts.isIdentifier(node.name)) {
        push(node, 'dynamic-import', { specifier });
      } else {
        push(node, 'other');
      }
    } else if (
      (ts.isParameter(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isImportClause(node) ||
        ts.isNamespaceImport(node) ||
        ts.isImportEqualsDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === NAME
    ) {
      push(node, 'other');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// --- following a module to the declaration it exports --------------------------

/** A relative or `@/` specifier resolved to a tracked source path, or undefined. */
function resolveModule(fromFile: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith('@/')) base = posix.join('src', specifier.slice(2));
  else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  } else return undefined; // a package, not a module in this tree
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (CODE.test(candidate) && existsSync(join(REPO_ROOT, candidate))) return candidate;
  }
  return undefined;
}

/** The PINNED declaration `file`'s export of the name leads to, following
 *  re-exports (`export { NAME } from`, `export * from`, and an imported binding
 *  exported again), or undefined. */
function declarationReachedFrom(file: string, seen: Set<string> = new Set()): string | undefined {
  if (file in PINNED) return file;
  if (seen.has(file)) return undefined;
  seen.add(file);
  const sf = readSource(file);
  let importedFrom: string | undefined;
  for (const statement of sf.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.name.text === NAME && (element.propertyName ?? element.name).text === NAME) {
          const specifier = specifierText((statement as ts.ImportDeclaration).moduleSpecifier);
          importedFrom = specifier === undefined ? undefined : resolveModule(file, specifier);
        }
      }
    }
  }
  for (const statement of sf.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const specifier = specifierText(statement.moduleSpecifier);
    const clause = statement.exportClause;
    const exportsName =
      clause === undefined
        ? specifier !== undefined // `export * from '…'`
        : ts.isNamedExports(clause) &&
          clause.elements.some((e) => e.name.text === NAME && (e.propertyName ?? e.name).text === NAME);
    if (!exportsName) continue;
    const target = specifier !== undefined ? resolveModule(file, specifier) : importedFrom;
    const reached = target === undefined ? undefined : declarationReachedFrom(target, seen);
    if (reached !== undefined) return reached;
  }
  return undefined;
}

function isClientModule(file: string): boolean {
  for (const statement of readSource(file).statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === 'use client') return true;
  }
  return false;
}

/** Rule 4 over a set of bindings. `isClient` is injected so the rule can be driven. */
function bindingProblems(bindings: NameBinding[], isClient: (file: string) => boolean): string[] {
  const problems: string[] = [];
  for (const b of bindings) {
    const at = `${b.file}:${b.line}`;
    if (b.kind === 'declaration') {
      if (!(b.file in PINNED)) problems.push(`${at} declares ${NAME} — import it from ${CLIENT_SAFE} instead`);
      continue;
    }
    if (b.kind === 'other') {
      problems.push(`${at} binds ${NAME} to something that is not an import of it: ${b.excerpt}`);
      continue;
    }
    const target = b.specifier === undefined ? undefined : resolveModule(b.file, b.specifier);
    const reached = target === undefined ? undefined : declarationReachedFrom(target);
    if (reached === undefined) {
      problems.push(`${at} takes ${NAME} from '${b.specifier}', whose exports lead to neither pinned declaration`);
    } else if (reached !== CLIENT_SAFE && isClient(b.file)) {
      problems.push(`${at} is a 'use client' module but reaches ${reached}, which is not client-safe — import from ${CLIENT_SAFE}`);
    }
  }
  return problems;
}

// --- the scan ------------------------------------------------------------------

function kindOf(file: string): string {
  return posix.extname(file) || posix.basename(file);
}

interface Scan {
  literalUniverse: string[];
  nameUniverse: string[];
  sites: LiteralSite[];
  bindings: NameBinding[];
  nonCode: string[];
}

let scanned: Scan | undefined;

function scan(): Scan {
  if (scanned) return scanned;
  const literalUniverse = gitFilesCarrying(NOTEBOOK_EXTENSION_KEY, false);
  const nameUniverse = gitFilesCarrying(NAME, true);
  const sites: LiteralSite[] = [];
  const bindings: NameBinding[] = [];
  for (const file of literalUniverse.filter((f) => CODE.test(f))) {
    sites.push(...literalSites(file, readFileSync(join(REPO_ROOT, file), 'utf8'), NOTEBOOK_EXTENSION_KEY));
  }
  for (const file of nameUniverse.filter((f) => CODE.test(f))) {
    bindings.push(...nameBindings(file, readFileSync(join(REPO_ROOT, file), 'utf8'), NOTEBOOK_EXTENSION_KEY));
  }
  const nonCode = [...new Set([...literalUniverse, ...nameUniverse].filter((f) => !CODE.test(f)))].sort();
  scanned = { literalUniverse, nameUniverse, sites, bindings, nonCode };
  return scanned;
}

function describe(site: LiteralSite): string {
  return `${site.file}:${site.line} (${site.form}) ${site.excerpt}`;
}

// --- the tests -----------------------------------------------------------------

test('the key is the protocol string, in both declarations and in the dependency that fingerprints the notebook', () => {
  assert.equal(
    NOTEBOOK_EXTENSION_KEY,
    'org.civicaitools.notebook',
    'the key every published package carries its notebook under. Changing it is a protocol change, not a ' +
      'refactor: every package already stored keeps the old one',
  );
  assert.equal(
    KEY_FROM_PROMPT,
    NOTEBOOK_EXTENSION_KEY,
    "prompt.ts's declaration and the client-safe one are two bindings of one key and must be equal",
  );

  // @typedstandards/verify-core declares its own copy and uses it to pick what a
  // datHere content hash covers. It is untracked, so it is run, not read.
  const notebook = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [{ cell_type: 'markdown', metadata: {}, source: ['fingerprinted'] }],
  };
  assert.equal(
    computeContentHashSha256({ extensions: { [NOTEBOOK_EXTENSION_KEY]: notebook } }, DATHERE_AG_JUPYTER_CANONICALIZATION),
    createHash('sha256').update(canonicalize(notebook) as string).digest('hex'),
    'the datHere content hash must fingerprint the notebook this tree puts under its key — if it does not, the ' +
      "dependency's copy of the key has drifted from this one",
  );
  assert.throws(
    () =>
      computeContentHashSha256(
        { extensions: { 'org.civicaitools.not-the-notebook': notebook } },
        DATHERE_AG_JUPYTER_CANONICALIZATION,
      ),
    'and it must refuse a notebook under any other key; without this, the assertion above could pass by hashing ' +
      'whatever it was handed',
  );
});

test('the scan measures: both universes come from git, and the reader tells code from comment', () => {
  const { literalUniverse, nameUniverse, sites, bindings, nonCode } = scan();
  assert.ok(
    literalUniverse.length >= 10,
    `git grep found ${literalUniverse.length} tracked files carrying the key — the scan has stopped measuring`,
  );
  assert.ok(
    literalUniverse.includes(THIS_FILE),
    'this file restates the key once, to pin it, and the scan must see it — is it staged?',
  );
  assert.ok(nonCode.length > 0, 'no non-code file carries the key: git grep has been narrowed to code');
  assert.ok(nameUniverse.length >= 10, `git grep found ${nameUniverse.length} files carrying the name`);
  for (const file of Object.keys(PINNED)) {
    assert.ok(
      sites.some((s) => s.file === file && s.form === 'declaration'),
      `the scan no longer sees the declaration in ${file}`,
    );
  }
  // One real re-export chain, so the chain-walk is shown running on the tree.
  const reexport = bindings.find((b) => b.file === 'src/lib/notebook-author/index.ts' && b.kind === 'reexport');
  assert.ok(reexport, 'the scan no longer sees ./index.ts re-export the name');
  assert.equal(
    declarationReachedFrom('src/lib/notebook-author/index.ts'),
    'src/lib/notebook-author/prompt.ts',
    'the chain-walk no longer follows ./index.ts to the declaration it re-exports',
  );

  // Every literal form, including the ones that must NOT count. `@KEY@` keeps
  // this file's own text free of further copies of the key.
  const FIXTURE = [
    "// '@KEY@' in a line comment",
    "/* '@KEY@' in a block comment */",
    "/** extensions['@KEY@'] in JSDoc */",
    "const message = 'Notebook extension (@KEY@) missing from package.';",
    'const path = `metadata.extensions["${key}"]`;',
    'const pattern = /@KEY@/;',
    "const joined = 'org.civicaitools' + '.notebook';",
    "const DECLARED = '@KEY@';",
    'let templated = `@KEY@`;',
    "function withDefault(k = '@KEY@') { return k; }",
    "const { fromDefault = '@KEY@' } = options;",
    "class Holder { static k = '@KEY@'; }",
    "enum Keys { Notebook = '@KEY@' }",
    "const read = pkg.extensions?.['@KEY@'];",
    "const written = { '@KEY@': notebook };",
    "const registry = { notebook: '@KEY@' as const };",
    "if (name === '@KEY@') { void name; }",
    'const element = <div data-key="@KEY@">@KEY@</div>;',
    "export default '@KEY@';",
  ]
    .join('\n')
    .replaceAll('@KEY@', NOTEBOOK_EXTENSION_KEY);
  assert.deepEqual(
    literalSites('fixture.tsx', FIXTURE, NOTEBOOK_EXTENSION_KEY).map((s) => `${s.line} ${s.form}`),
    [
      '8 declaration',
      '9 declaration',
      '10 declaration',
      '11 declaration',
      '12 declaration',
      '13 declaration',
      '14 use',
      '15 use',
      '16 use',
      '17 use',
      '18 use',
      '19 declaration',
    ],
    'the reader misread the fixture: lines 1-7 (comments, a substring, a substituted template, a regular ' +
      'expression, a concatenation) are not sites, and the JSX text on line 18 is not either',
  );

  const BINDINGS = [
    "import { NOTEBOOK_EXTENSION_KEY } from './notebook-provenance-reading.ts';",
    "import { NOTEBOOK_EXTENSION_KEY as FROM_PROMPT } from './prompt.ts';",
    "import { OTHER as NOTEBOOK_EXTENSION_KEY } from './elsewhere.ts';",
    "export { NOTEBOOK_EXTENSION_KEY } from './index.ts';",
    'export { NOTEBOOK_EXTENSION_KEY };',
    "const { NOTEBOOK_EXTENSION_KEY: fromDynamic } = await import('./prompt.ts');",
    'const { NOTEBOOK_EXTENSION_KEY: fromObject } = someModule;',
    "export const NOTEBOOK_EXTENSION_KEY = '@KEY@';",
    'function shadow(NOTEBOOK_EXTENSION_KEY: string) { return NOTEBOOK_EXTENSION_KEY; }',
    'const viaNamespace = prompt.NOTEBOOK_EXTENSION_KEY;',
  ]
    .join('\n')
    .replaceAll('@KEY@', NOTEBOOK_EXTENSION_KEY);
  const classified = nameBindings('src/lib/notebook-author/fixture.ts', BINDINGS, NOTEBOOK_EXTENSION_KEY);
  assert.deepEqual(
    classified.map((b) => `${b.line} ${b.kind}`),
    ['1 import', '2 import', '3 other', '4 reexport', '6 dynamic-import', '7 other', '8 declaration', '9 other'],
    'the binding reader misread the fixture (line 5 exports a local binding and line 10 reads a property; neither binds the name)',
  );
  assert.equal(classified.find((b) => b.line === 8)?.pinnedShape, true);

  // Rule 4 can fail: driven on bindings shaped like the defects it exists for.
  const client = (): boolean => true;
  const server = (): boolean => false;
  const viaIndex: NameBinding = {
    file: 'src/components/fixture.tsx',
    line: 1,
    kind: 'import',
    specifier: '@/lib/notebook-author',
    excerpt: '',
  };
  assert.deepEqual(bindingProblems([viaIndex], server), [], 'a server module may reach prompt.ts through ./index.ts');
  assert.equal(bindingProblems([viaIndex], client).length, 1, "a 'use client' module may not: ./index.ts leads to prompt.ts");
  assert.equal(
    bindingProblems([{ ...viaIndex, specifier: '@/lib/notebook-author/tool-to-cell' }], server).length,
    1,
    'an import from a module that does not export the name is refused',
  );
  assert.deepEqual(
    bindingProblems(
      [{ ...viaIndex, file: 'scripts/fixture.ts', kind: 'dynamic-import', specifier: '../src/lib/notebook-author/notebook-provenance-reading.ts' }],
      client,
    ),
    [],
    'a dynamic import of the client-safe declaration is accepted',
  );
});

test('#403: the key has exactly two declarations, both pinned', () => {
  const { sites, bindings } = scan();
  const declarations = sites.filter((s) => s.form === 'declaration');
  const extra = declarations.filter((s) => !(s.file in PINNED));
  assert.deepEqual(
    extra.map(describe),
    [],
    `declarations of the key outside the two pinned ones. A declaration is never allowlisted: import ` +
      `${NAME} from ${CLIENT_SAFE} (client-safe) instead:\n  ${extra.map(describe).join('\n  ')}`,
  );
  for (const [file, reason] of Object.entries(PINNED)) {
    assert.ok(reason.length > 0, `PINNED ${file} states no reason`);
    assert.equal(
      declarations.filter((s) => s.file === file).length,
      1,
      `${file} must declare the key exactly once — a pinned declaration that is gone or doubled is a failure`,
    );
    const named = bindings.filter((b) => b.file === file && b.kind === 'declaration');
    assert.ok(
      named.length === 1 && named[0].pinnedShape === true,
      `${file}'s declaration must be one exported top-level \`const ${NAME}\` bound to the key itself`,
    );
  }
});

test('#403: every other literal site is a test fixture, or sits in a file ALLOW names with its reason', () => {
  const { sites } = scan();
  const uses = sites.filter((s) => s.form === 'use');
  const unexplained = uses.filter((s) => !TEST_FIXTURES.applies(s.file) && !(s.file in ALLOW));
  assert.deepEqual(
    unexplained.map(describe),
    [],
    `the key spelled out in code rather than imported. Import ${NAME} from ${CLIENT_SAFE} (it is client-safe), ` +
      `or add the file to ALLOW with why it cannot:\n  ${unexplained.map(describe).join('\n  ')}`,
  );
  for (const [file, reason] of Object.entries(ALLOW)) {
    assert.ok(reason.length > 0, `ALLOW ${file} states no reason`);
    assert.ok(!TEST.test(file), `ALLOW lists the test ${file}; a test's uses are fixtures and need no entry`);
    assert.ok(uses.some((s) => s.file === file), `ALLOW lists ${file}, which no longer uses the literal — drop the entry`);
  }
  assert.ok(TEST_FIXTURES.reason.length > 0);
  assert.ok(
    uses.some((s) => TEST_FIXTURES.applies(s.file)),
    'TEST_FIXTURES describes no site any more — drop the class, and this assertion with it',
  );
});

test('#403: every binding of the name is a pinned declaration, or leads to one', () => {
  const problems = bindingProblems(scan().bindings, isClientModule);
  assert.deepEqual(problems, [], `bindings of ${NAME} that do not lead to a pinned declaration:\n  ${problems.join('\n  ')}`);
});

test('every non-code file carrying the key or the name is of a kind NON_CODE names', () => {
  const { nonCode } = scan();
  const unclassified = nonCode.filter((file) => !(kindOf(file) in NON_CODE));
  assert.deepEqual(
    unclassified,
    [],
    'files carrying the key that this guard cannot read. Classify the kind in NON_CODE with a reason, or make ' +
      'the file code',
  );
  for (const [kind, reason] of Object.entries(NON_CODE)) {
    assert.ok(reason.length > 0, `NON_CODE ${kind} states no reason`);
    assert.ok(nonCode.some((file) => kindOf(file) === kind), `NON_CODE names ${kind}, but no such file carries the key — drop it`);
  }
});
