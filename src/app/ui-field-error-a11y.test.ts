/**
 * Guard: the invalid-field marking and its assistive-technology counterpart
 * ship together, from the same file.
 *
 * `.ui-field--error` (globals.css) paints a field red. As of this test it has
 * zero consumers, and `aria-invalid` appears nowhere in src/ -- the app has
 * never had a per-field failure to signal, so the styling is an unconsumed
 * state affordance rather than dead debt (#275). That is a stable, harmless
 * state. The failure mode this guard exists for is the transition out of it.
 *
 * Whoever first needs a validation error will find the class that already
 * exists, apply it, and be done -- because it looks done. The field turns
 * red, the change reviews cleanly, and the error is invisible to anyone
 * using a screen reader. That is a worse outcome than having neither half,
 * because the sighted reviewer now has positive evidence the state "works".
 * Nothing in the build, the linter, or the rest of the suite catches it:
 * ui-class-names.test.ts checks only that a used class is *defined*, which a
 * red-border-only consumer satisfies perfectly.
 *
 * So the check is one-directional and deliberately blunt: if a source file
 * reaches into the `ui-field--` modifier namespace at all, that file must
 * also carry `aria-invalid` (the programmatic state) and `aria-describedby`
 * (the association to the message that says what is wrong). Both, in the
 * same file, so the visual and non-visual halves cannot be introduced by
 * separate code paths and drift apart later.
 *
 * What it deliberately does NOT verify, since a text scan cannot:
 *   - that `aria-invalid` is bound to a condition rather than hardcoded true,
 *     or that it is cleared when the field becomes valid again;
 *   - that `aria-describedby` points at an id that exists and holds the
 *     message;
 *   - that the message is announced when it appears (role="alert", or an
 *     aria-live region that may legitimately live in a parent component --
 *     which is why announcement is not required in-file here).
 * It is a tripwire that forces the pair to be considered together, not a
 * proof that the wiring is correct. The remediation message below says so,
 * so nobody reads a passing run as an accessibility sign-off.
 *
 * Nor does it catch a validation error built without this class family at
 * all (inline red styles, a new selector outside `ui-field--`). That is the
 * accepted edge: the guard covers the specific trap #275 identified -- the
 * existing affordance being picked up half-way -- and the anchor test below
 * keeps it from silently ceasing to cover even that.
 *
 * Scanning convention (own recursive walker, self-exclusion, deepEqual
 * against [] with a remediation message) follows the sibling guards:
 * ui-class-names.test.ts, design-tokens.test.ts, no-google-font-egress.test.ts.
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

const SCANNED_EXTENSIONS = /\.(tsx|ts|jsx|js)$/;

/**
 * The trigger is the modifier namespace, not the exact class name.
 *
 * `ui-field--error` as a bare literal is only the most obvious way to reach
 * for this state. Matching the `ui-field--` prefix instead also catches the
 * assembled forms a literal match would miss entirely -- a ternary inside a
 * template literal, a clsx object key, a constant hoisted to the top of the
 * file, and (the one a literal search cannot see at all) a modifier built by
 * interpolation as `ui-field--${state}`. `.ui-field--error` is the only
 * `ui-field--*` selector in globals.css, so the wider prefix costs no false
 * positives while closing the evasion the narrow form leaves open.
 */
const ERROR_MODIFIER = /ui-field--/;

/**
 * What a file touching that namespace must also contain, and why. Reported
 * per-attribute so a half-wired consumer is told which half is missing.
 */
const REQUIRED_ATTRIBUTES: Record<string, string> = {
  'aria-invalid': 'the programmatic invalid state, for assistive technology',
  'aria-describedby': 'the association from the field to its error message',
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return SCANNED_EXTENSIONS.test(entry.name) ? [full] : [];
  });
}

/** The whole check, as a pure function, so the fixtures below can prove it
 *  actually detects something while the real tree has nothing to detect. */
function missingAttributes(contents: string): string[] {
  if (!ERROR_MODIFIER.test(contents)) return [];
  return Object.keys(REQUIRED_ATTRIBUTES).filter((attr) => !contents.includes(attr));
}

/**
 * Non-vacuity anchor. With zero consumers in the tree, the scan below passes
 * whether or not it works -- including if `.ui-field--error` were renamed or
 * dropped, which would leave ERROR_MODIFIER matching nothing, forever, in
 * silence. This test is what makes that loud instead.
 */
test('the invalid-field selector this guard watches still exists', () => {
  const css = fs.readFileSync(GLOBALS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  assert.ok(
    /\.ui-field--error\b/.test(css),
    'globals.css no longer defines .ui-field--error, so ERROR_MODIFIER in ' +
      'this file now matches nothing and this guard is watching an empty ' +
      'namespace. If the invalid-field styling was renamed, point ' +
      'ERROR_MODIFIER at the new name. If it was genuinely dropped along ' +
      'with the ability to mark a field invalid, delete this guard in the ' +
      'same change -- do not leave it passing vacuously.',
  );
});

/**
 * Positive control. The scan over src/ finds nothing today, so on its own it
 * cannot distinguish "no unpaired consumers" from "the detection is broken".
 * These fixtures exercise the predicate directly, including the assembled
 * forms a plain `ui-field--error` substring search would not catch.
 */
test('the pairing check detects an unpaired consumer', () => {
  const fixtures: { name: string; source: string; missing: string[] }[] = [
    {
      name: 'literal class, no ARIA at all',
      source: '<div className="ui-field ui-field--error"><input id="q" /></div>',
      missing: ['aria-invalid', 'aria-describedby'],
    },
    {
      name: 'literal class with the state but no message association',
      source: '<div className="ui-field ui-field--error"><input aria-invalid={true} /></div>',
      missing: ['aria-describedby'],
    },
    {
      name: 'class list assembled by interpolation',
      source: 'const cls = `ui-field ${invalid ? "ui-field--error" : ""}`;',
      missing: ['aria-invalid', 'aria-describedby'],
    },
    {
      name: 'modifier name itself assembled by interpolation',
      source: 'const cls = `ui-field--${fieldState}`;',
      missing: ['aria-invalid', 'aria-describedby'],
    },
    {
      name: 'fully paired consumer',
      source:
        '<div className="ui-field ui-field--error">' +
        '<input aria-invalid={true} aria-describedby="q-error" />' +
        '<p id="q-error" role="alert">Choose a portal to search.</p></div>',
      missing: [],
    },
    {
      name: 'a field with no error state at all',
      source: '<div className="ui-field"><input id="q" /></div>',
      missing: [],
    },
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(
      missingAttributes(fixture.source),
      fixture.missing,
      `pairing check gave the wrong answer for: ${fixture.name}`,
    );
  }
});

test('every ui-field--error consumer in src/ also carries the ARIA state', () => {
  const files = sourceFiles(SRC_ROOT).filter((file) => file !== HERE);

  // A walker that silently returns nothing would make the assertion below
  // pass forever. src/ has well over a hundred scannable files.
  assert.ok(
    files.length > 50,
    `only ${files.length} source files found under ${SRC_ROOT} -- the walker ` +
      'is not seeing the tree, so the scan below proves nothing.',
  );

  const unpaired: string[] = [];

  for (const file of files) {
    const contents = fs.readFileSync(file, 'utf8');
    const missing = missingAttributes(contents);
    if (missing.length > 0) {
      unpaired.push(`${path.relative(SRC_ROOT, file)}  missing: ${missing.join(', ')}`);
    }
  }

  assert.deepEqual(
    unpaired.sort(),
    [],
    'These files mark a form field invalid without the assistive-technology ' +
      'half of that state, which ships a validation error that is visible to ' +
      'sighted users and absent for everyone else. In the same component, on ' +
      'the field itself: set aria-invalid while (and only while) the field is ' +
      'actually invalid, and point aria-describedby at the id of visible text ' +
      'saying what is wrong -- driven by the same condition that adds the ' +
      'class, so the two cannot diverge. Also make sure the message is ' +
      'announced when it appears (role="alert" on it, or an existing ' +
      'aria-live region); this text scan cannot check that part, or that the ' +
      'state is cleared on recovery, so passing here is not an accessibility ' +
      'sign-off. See docs/design-principles.md, Family 1.',
  );
});
