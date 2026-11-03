/**
 * Guard: every `ui-*` class referenced from a className attribute resolves to
 * a selector defined in globals.css.
 *
 * A missing class is silent in a way a missing token is not. A mistyped
 * custom-property reference at least leaves a declaration in the cascade
 * (dropped, but present); a className that matches no selector renders
 * nothing extra at all -- no build error, no console warning, no failing
 * test, just a control that looks like every other <button> until someone
 * opens a browser. #220 P4 moved the button/field selectors off their old
 * city-prefixed names to this ui- prefix for exactly this reason: same
 * failure mode as the token rename this repo already got bitten by (see
 * design-tokens.test.ts), louder consequence.
 *
 * Scope is deliberately the `ui-` prefix, not "every className in the repo".
 * Tailwind utility classes (`flex`, `gap-2`, ...) are not defined in
 * globals.css at all -- they are compiled from usage -- so a fully general
 * "every className must resolve" check would either false-positive on every
 * Tailwind class or require reimplementing Tailwind's own class scanner.
 * `ui-` is this codebase's own low-level component-class namespace, chosen
 * in #220 P4 specifically because it collides with nothing else (checked
 * against this repo's CSS, the bpmn-js shipped assets, and Tailwind) --
 * which makes it a clean, false-positive-free boundary for a test.
 *
 * The extraction is anchored on `className="..."` / `className='...'`
 * string-literal attribute values, not "any `ui-` text anywhere in the
 * file" -- `fontFamily: 'ui-monospace, ...'` (a CSS system-font keyword,
 * used in several notebook-output components) would otherwise be a false
 * positive on day one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = fileURLToPath(import.meta.url);
const APP_ROOT = path.dirname(HERE);
const SRC_ROOT = path.dirname(APP_ROOT);
const GLOBALS_CSS = path.join(APP_ROOT, 'globals.css');

/**
 * `ui-*` classes referenced in className attributes that are legitimately
 * NOT selectors in globals.css (e.g. handled by a different stylesheet).
 * One line of justification each -- see design-tokens.test.ts for why this
 * is a named allowlist rather than a pattern exclusion.
 */
const DEFINED_ELSEWHERE: Record<string, string> = {};

const SCANNED_EXTENSIONS = /\.(tsx|ts|jsx|js)$/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return SCANNED_EXTENSIONS.test(entry.name) ? [full] : [];
  });
}

/** `className="a b c"` or `className='a b c'` -- the plain string-literal
 *  form used everywhere in this codebase today. Dynamic forms (template
 *  literals, clsx()) are not present as of #220 P4; if one is introduced,
 *  this test will not see the classes inside it, same limitation
 *  design-tokens.test.ts accepts for var(--c-${key}) construction. */
const CLASSNAME_ATTR = /className=["']([^"']*)["']/g;

/** Every class name that appears as a selector component in globals.css,
 *  restricted to the ui- namespace this test governs. Comments removed
 *  first so a commented-out rule does not count as a definition. Matches
 *  `.ui-foo` wherever it appears in a selector (base, compound like
 *  `.ui-field input`, or pseudo-class like `.ui-button:hover`) -- the
 *  trailing [a-zA-Z0-9-]+ stops at `:` or whitespace, so pseudo-classes
 *  are not folded into the class name. */
function definedUiClasses(): Set<string> {
  const css = fs.readFileSync(GLOBALS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return new Set([...css.matchAll(/\.(ui-[a-zA-Z0-9-]+)/g)].map((m) => m[1]));
}

test('every ui-* className used in src/ is defined in globals.css', () => {
  const defined = definedUiClasses();
  const allowed = new Set(Object.keys(DEFINED_ELSEWHERE));

  const missing: string[] = [];

  for (const file of sourceFiles(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file);
    const contents = fs.readFileSync(file, 'utf8');

    for (const match of contents.matchAll(CLASSNAME_ATTR)) {
      const classList = match[1].split(/\s+/).filter(Boolean);
      for (const cls of classList) {
        if (!cls.startsWith('ui-')) continue;
        if (defined.has(cls) || allowed.has(cls)) continue;
        const line = contents.slice(0, match.index).split('\n').length;
        missing.push(`${rel}:${line}  ${cls}`);
      }
    }
  }

  assert.deepEqual(
    [...new Set(missing)].sort(),
    [],
    'These ui-* classNames match no selector in src/app/globals.css. A ' +
      'missing class renders the element completely unstyled with no build ' +
      'or test failure to flag it -- either add the selector to globals.css, ' +
      'fix the className typo, or add a justified DEFINED_ELSEWHERE entry to ' +
      'this file if the class is legitimately styled elsewhere.',
  );
});

test('every allowlist entry is still load-bearing', () => {
  const defined = definedUiClasses();
  const redundant = Object.keys(DEFINED_ELSEWHERE).filter((c) => defined.has(c));
  assert.deepEqual(
    redundant,
    [],
    'These classes are now defined in globals.css, so their DEFINED_ELSEWHERE ' +
      'entries are dead. Remove them.',
  );
});

// --- The primitives' class tables (UX-1 P0, F1) -----------------------------
//
// The two tests above read `className="..."` attribute literals only. The ui-*
// primitives under src/components/ui/ choose classes from tables (a variant
// map, a size map) and join them, and a class written that way never appears
// in a className attribute, so the scan above cannot see it.
//
// This test closes that gap by reading every string a primitive module holds.
// It parses each non-test module under src/components/ui/ with the TypeScript
// compiler and collects:
//   - every ui-* word of every string literal and every template literal
//     without substitutions, wherever it sits: an attribute, a table, an
//     argument;
//   - every template literal WITH substitutions that holds a ui- prefix.
// A class built from a template cannot be checked (`ui-card--${tone}`), so it
// fails here outright. A primitive writes each class it can emit in full.
//
// Scope, and its blind spot. The directory, not the class namespace: outside
// src/components/ui/ only the attribute scan above applies, because a
// string-literal scan of the whole tree would read `fontFamily: 'ui-monospace,
// ...'` as a class. A ui- word inside a string that is not a class, in a
// primitive, would be checked as one; none exists, and it would be a
// false positive (loud), not a miss.

const PRIMITIVES_DIR = path.join(SRC_ROOT, 'components', 'ui');
const UI_WORD = /(?:^|\s)(ui-[a-zA-Z0-9-]+)/g;

function primitiveModules(): string[] {
  return sourceFiles(PRIMITIVES_DIR).filter((f) => !/\.test\.(c|m)?[jt]sx?$/.test(f));
}

/** Every ui-* word in the string literals of `file`, with its line; and every substituted template holding `ui-`. */
function classWordsIn(file: string): { words: { cls: string; line: number }[]; dynamic: number[] } {
  const text = fs.readFileSync(file, 'utf8');
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const words: { cls: string; line: number }[] = [];
  const dynamic: number[] = [];
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const m of node.text.matchAll(UI_WORD)) words.push({ cls: m[1], line: lineOf(node) });
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      if (parts.some((part) => /(?:^|\s)ui-/.test(part))) dynamic.push(lineOf(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { words, dynamic };
}

test('every ui-* class a primitive in src/components/ui/ can emit is defined in globals.css', () => {
  const defined = definedUiClasses();
  const allowed = new Set(Object.keys(DEFINED_ELSEWHERE));
  const modules = primitiveModules();
  assert.ok(modules.length > 0, 'no primitive modules found under src/components/ui/: the scan has stopped measuring');

  const missing: string[] = [];
  const dynamic: string[] = [];
  let seen = 0;
  for (const file of modules) {
    const rel = path.relative(SRC_ROOT, file);
    const found = classWordsIn(file);
    seen += found.words.length;
    for (const { cls, line } of found.words) {
      if (!defined.has(cls) && !allowed.has(cls)) missing.push(`${rel}:${line}  ${cls}`);
    }
    for (const line of found.dynamic) dynamic.push(`${rel}:${line}`);
  }

  assert.ok(seen > 0, 'the primitives hold no ui-* class at all: the scan has stopped measuring');
  assert.deepEqual(
    [...new Set(missing)].sort(),
    [],
    'These ui-* classes, written in a primitive under src/components/ui/, match no selector in ' +
      'src/app/globals.css. A primitive emits them from a class table, so the className scan above ' +
      'cannot see them; an undefined one renders unstyled with no other failure. Add the selector, ' +
      'or fix the name.',
  );
  assert.deepEqual(
    dynamic.sort(),
    [],
    'These template literals build a ui-* class from a substitution, which no guard can check. ' +
      'Write each class in full (a table of literal names), as the other primitives do.',
  );
});
