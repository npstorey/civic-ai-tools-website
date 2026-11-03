/**
 * Guard: each colour token that a translucent wash reads through
 * `rgba(var(--<token>-rgb), α)` has an `-rgb` twin, and the twin is the
 * token's own hex as a channel triplet (UX-1 P0, criterion 2; F2).
 *
 * The twins are a pair that MUST stay in lockstep (globals.css says so for
 * `--accent` and `--info`), and until this test nothing held them there: a
 * token edited without its twin keeps every wash painted in the old colour,
 * with no build error and no failing test. P5 `Card`'s tinted tones read
 * `--success-rgb`, `--caution-rgb` and `--error-rgb`, which the stylesheet did
 * not define before this phase.
 *
 * WHAT IS COMPARED: the stylesheet's own defaults in `:root`. `--accent` and
 * `--accent-rgb` are also written at runtime from `SITE_BRAND_ACCENT`
 * (`src/lib/brand-config.ts` derives both from one configured value); that
 * path is not read here.
 *
 * The `--op-*` twins are out of this test's scope (UX-1 P0's non-goals).
 *
 * Run with: npm test
 *   (or: node --test --experimental-strip-types src/app/token-rgb-twins.test.ts)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GLOBALS_CSS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'globals.css');

const TWINNED = ['accent', 'info', 'success', 'caution', 'error'] as const;

/** The `:root` block's custom properties, by name; comments removed first. */
function rootProperties(css: string): Map<string, string> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const root = /(?:^|[\s}]):root\s*\{([^}]*)\}/.exec(stripped);
  assert.ok(root, 'globals.css has a :root block');
  const out = new Map<string, string>();
  for (const m of root[1].matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

/** `#RRGGBB` (or `#RGB`) as `r, g, b`; `null` for anything else. */
function hexToTriplet(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value);
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split('').map((c) => c + c).join('') : match[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
}

/** `r, g, b` normalised to single spaces; `null` when it is not three integers 0-255. */
function normaliseTriplet(value: string | undefined): string | null {
  if (value === undefined) return null;
  const parts = value.split(',').map((p) => p.trim());
  if (parts.length !== 3 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.map(Number).join(', ');
}

/** The comparison every case makes: the token's hex as a triplet, and the twin as written. */
function twinReading(props: Map<string, string>, token: string): { fromHex: string | null; twin: string | null } {
  return { fromHex: hexToTriplet(props.get(`--${token}`)), twin: normaliseTriplet(props.get(`--${token}-rgb`)) };
}

const PROPS = rootProperties(fs.readFileSync(GLOBALS_CSS, 'utf8'));

for (const token of TWINNED) {
  test(`--${token}-rgb exists and equals --${token} as a channel triplet`, () => {
    const { fromHex, twin } = twinReading(PROPS, token);
    assert.ok(fromHex !== null, `--${token} is a hex colour in :root (read: ${PROPS.get(`--${token}`) ?? 'absent'})`);
    assert.equal(
      twin,
      fromHex,
      `--${token}-rgb must be --${token}'s channel triplet. :root has --${token}: ${PROPS.get(`--${token}`)} ` +
        `and --${token}-rgb: ${PROPS.get(`--${token}-rgb`) ?? '(absent)'}.`,
    );
  });
}

test('the twin reader can fail: a twin off by one channel, a missing twin, and a malformed twin all read unequal', () => {
  const props = rootProperties(`
    :root {
      --a: #103FEF; --a-rgb: 16, 63, 238;
      --b: #70BAFF;
      --c: #008A02; --c-rgb: 0 138 2;
      --d: #FFB320; --d-rgb: 255,179,32;
    }`);
  for (const token of ['a', 'b', 'c']) {
    const { fromHex, twin } = twinReading(props, token);
    assert.notEqual(twin, fromHex, `fixture --${token}: the reader must report a mismatch`);
  }
  const { fromHex, twin } = twinReading(props, 'd');
  assert.equal(twin, fromHex, 'fixture --d: a matching twin written without spaces reads equal');
});
