// Guard: the executor image check loads with no package installed.
//
// THE PROPERTY. `scripts/executor-image-check.mjs` runs in the required CI job
// `executor image build` on a runner where `npm ci` is never run, by design
// (`.github/workflows/ci.yml`, the job's own comment: the job is
// credential-free and dependency-free). The script reads its pin tables by
// importing `src/lib/notebook-author/prompt.ts` and `src/lib/sandbox/driver.ts`
// under Node's type stripping. So every module reachable from the script, by
// a static import, a re-export, a dynamic `import('…')` or a `require('…')`,
// must name only relative files and Node built-ins — never a package. One
// package specifier anywhere in that graph and the job dies with
// ERR_MODULE_NOT_FOUND before it reads a single pin.
//
// WHY IT EXISTS (#599 W3). W3 gave `src/lib/portal-lock.ts` an import of
// `./mcp/operation-types.ts`, which imports `@typedstandards/civic-typed-router`;
// `prompt.ts` reaches `portal-lock.ts` through `site-config.ts`. Every test in
// `npm test` passed, because `npm test` runs with `node_modules` installed. The
// job failed at its `pins`, `imports` and `parity` steps (run 38838368949). A
// check that runs where packages exist cannot see a module graph that must
// load where they do not; this one reads the graph instead.
//
// HOW THE GRAPH IS READ. The walk starts at the script itself, so its own two
// entry modules are found, not listed here. Each `.ts`, `.tsx`, `.js`, `.mjs`
// or `.cjs` file is parsed into a TypeScript syntax tree (the pattern
// `src/lib/notebook-author/notebook-extension-key.test.ts` uses to read
// imports, including `await import('…')`), and every module specifier is
// collected:
//   - `import … from`, `import '…'`, `export … from`, `import x = require('…')`;
//   - `import('…')` and `require('…')` with a string literal.
// A whole-declaration `import type` / `export type` is skipped: type stripping
// erases it, so it loads nothing. A declaration whose named imports are all
// `type`-marked is NOT skipped — it is read as a load, which can over-report
// and cannot under-report. A relative specifier is resolved as Node resolves
// it under type stripping (the file as named; a missing extension is tried as
// `.ts`, `.tsx`, `.js`, `.mjs`, then `/index.ts`), and walked. `node:` and a
// bare Node built-in name are allowed. Anything else is a package, and fails.
//
// BLIND SPOTS, stated:
//   - A COMPUTED specifier (`import(name)`, `require(a + b)`) cannot be read.
//     It is not ignored: it fails the guard as unreadable, naming the file and
//     line, so a new one has to be looked at by a person.
//   - A non-code import (`.json`, `.css`) is resolved but not parsed.
//   - The walk reads source text. It does not run the graph, so a module that
//     loads a package by some other route (`createRequire`, a loader hook, an
//     `eval`) is invisible to it. The CI job itself remains the real reading;
//     this guard is what makes the failure visible under `npm test` too.
//   - It reads the tree as checked out, which is what the job loads.
//
// Run with: npm test   (or: node --test scripts/executor-check-imports-no-package.test.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = 'scripts/executor-image-check.mjs';
const CODE = /\.(?:[cm]?js|tsx?)$/;
const BUILTINS = new Set(builtinModules);

/** Every module specifier `text` loads, with its line; `null` for a computed one. */
export function specifiersOf(file, text) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const at = (node, specifier) => out.push({ specifier, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  const literal = (node) => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null);
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly) at(node, literal(node.moduleSpecifier));
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && !node.isTypeOnly) at(node, literal(node.moduleSpecifier));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (!node.isTypeOnly) at(node, literal(node.moduleReference.expression));
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      if (isImport || isRequire) at(node, literal(node.arguments[0]));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function resolveRelative(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.join(base, 'index.ts')];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

/**
 * Walk the graph from `entry` (a path under `root`). Returns the files read
 * and every problem: a package specifier, a computed one, or a relative one
 * that resolves to no file.
 */
export function walk(root, entry) {
  const seen = new Set();
  const problems = [];
  const queue = [path.join(root, entry)];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!CODE.test(file)) continue;
    const rel = path.relative(root, file);
    for (const { specifier, line } of specifiersOf(file, readFileSync(file, 'utf8'))) {
      if (specifier === null) {
        problems.push(`${rel}:${line} loads a computed specifier, which this guard cannot read`);
      } else if (specifier.startsWith('node:') || BUILTINS.has(specifier)) {
        continue;
      } else if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
        const target = resolveRelative(file, specifier);
        if (target) queue.push(target);
        else problems.push(`${rel}:${line} loads '${specifier}', which resolves to no file`);
      } else {
        problems.push(`${rel}:${line} loads the package '${specifier}'`);
      }
    }
  }
  return { files: [...seen].map((f) => path.relative(root, f)).sort(), problems };
}

test('every module the executor image check loads names only relative files and Node built-ins', () => {
  const { files, problems } = walk(REPO_ROOT, ENTRY);
  // PREMISE: the walk reached both entry modules the script imports, so an
  // empty problem list is about the graph and not about a walk that stopped.
  for (const reached of ['src/lib/notebook-author/prompt.ts', 'src/lib/sandbox/driver.ts']) {
    assert.ok(files.includes(reached), `the walk never reached ${reached}; it read: ${files.join(', ')}`);
  }
  assert.deepEqual(
    problems,
    [],
    'the `executor image build` job loads this graph with no package installed (no `npm ci`), so each of these fails it with ERR_MODULE_NOT_FOUND:\n  ' +
      problems.join('\n  '),
  );
});

test('the instrument can fail: a seeded package import, a computed specifier and an unresolved file are each reported; type-only imports are not', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'executor-graph-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'scripts', 'entry.mjs'), [
      "import { readFileSync } from 'node:fs';",
      "import path from 'path';",
      "const a = await import('../src/a.ts');",
    ].join('\n'));
    writeFileSync(path.join(root, 'src', 'a.ts'), [
      "import type { T } from 'type-only-package';",
      "export type { U } from 'another-type-only-package';",
      "import { b } from './b.ts';",
      "export { c } from './c';",
      'export const a = b;',
    ].join('\n'));
    writeFileSync(path.join(root, 'src', 'b.ts'), [
      "import { seeded } from 'seeded-package';",
      "const name = 'x'; await import(name);",
      "import './missing.ts';",
      'export const b = seeded;',
    ].join('\n'));
    writeFileSync(path.join(root, 'src', 'c.ts'), "export const c = require('@scope/required-package');\n");
    const { files, problems } = walk(root, 'scripts/entry.mjs');
    assert.deepEqual(files, ['scripts/entry.mjs', 'src/a.ts', 'src/b.ts', 'src/c.ts']);
    assert.deepEqual(problems, [
      "src/b.ts:1 loads the package 'seeded-package'",
      'src/b.ts:2 loads a computed specifier, which this guard cannot read',
      "src/b.ts:3 loads './missing.ts', which resolves to no file",
      "src/c.ts:1 loads the package '@scope/required-package'",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
