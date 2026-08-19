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
