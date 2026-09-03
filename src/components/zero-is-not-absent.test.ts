// P8 red instrument, Wave N9 (#384), stage 1 — the cold read's F4.
//
// THE DEFECT, measured at 4ec45c0. P1 made `tokens_used` absent on the wire
// when the endpoint reported no usage, and deliberately preserved a REPORTED
// zero (`openrouter-streaming.ts:233-237`, `openrouter.ts:61-68`; driven and
// pinned in `src/lib/model-loop/absent-usage.test.ts`, REPORTED_ZERO). Three
// render sites then guard the token line with `{tokens_used && (…)}` —
// `ResponsePanel.tsx:382`, `McpResponseDisplay.tsx:224`, `:715` — and React
// renders `0 && <x/>` as the text node "0". An endpoint that streams
// `usage.total_tokens: 0` (several local servers and proxies do) puts a
// stray "0" in the footer. The neighbouring visibility checks are the same
// class: `ResponsePanel.tsx:360` `(duration_ms || tokens_used) &&`, `:377`
// `{duration_ms &&`, `McpResponseDisplay.tsx:688` and `:710`
// `… && duration_ms && (`. `:679` is not — it wraps the pair in `!!(…)`.
//
// THE PROPERTY, not the patch: in these components, a NUMBER is never the
// operand that decides whether a JSX child renders. `!!x`, `x !== undefined`,
// `x > 0` and a boolean computed above the JSX all pass; a bare numeric
// field (alone, or as one side of an `||`) followed by `&& (` or `&& <` does
// not. Zero is a measurement, and "absent" is the only thing that hides a
// line (docs/design-principles.md, principle 3).
//
// SCOPE, and its blind spot. The universe is the two files that render the
// footer token line and their four numeric props (`duration_ms`,
// `tokens_used`, `prompt_tokens`, `completion_tokens`) plus `TimingFooter`'s
// `totalDuration`; the check is a source scan. It does not render: no test
// in this repository renders a `.tsx` (there is no jsdom, no testing-library,
// no `react-dom/server` import under `src/`, and `--experimental-strip-types`
// does not transform JSX), so the render half of F4 is read from the JSX,
// as the cold read read it, and is stated here as unverified in a browser.
// The instrument demonstrates it can fail: (b) runs the pattern over the
// exact shapes it must catch and must ignore.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/components/zero-is-not-absent.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPONENTS = ['./ResponsePanel.tsx', './shared/McpResponseDisplay.tsx'] as const;

const NUMERIC_FIELDS = ['tokens_used', 'duration_ms', 'prompt_tokens', 'completion_tokens', 'totalDuration'];

/**
 * A bare numeric field deciding a rendered child: at the head of a JSX
 * expression (`{field &&`) or mid-chain (`&& field &&`), alone or as one side
 * of an `||` in parentheses, immediately followed by the element (`(` or `<`).
 */
function bareNumericGuard(): RegExp {
  const field = `(?:${NUMERIC_FIELDS.join('|')})`;
  return new RegExp(`(?:\\{|&&)\\s*\\(?\\s*${field}(?:\\s*\\|\\|\\s*${field})?\\s*\\)?\\s*&&\\s*[(<]`, 'g');
}

function sourceOf(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function findGuards(source: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  for (const m of source.matchAll(bareNumericGuard())) {
    found.push({ line: lineOf(source, m.index ?? 0), text: m[0].replace(/\s+/g, ' ').trim() });
  }
  return found;
}

// --- (a) RED at 4ec45c0: seven sites across the two files -------------------

test('F4 (a) no JSX child in the footer components is gated by a bare numeric field — a reported 0 must not render as "0"', () => {
  const offending: string[] = [];
  for (const relative of COMPONENTS) {
    const source = sourceOf(relative);
    for (const { line, text } of findGuards(source)) {
      offending.push(`${relative.replace('./', 'src/components/')}:${line}: ${text}`);
    }
  }
  assert.deepEqual(
    offending,
    [],
    `${offending.length} JSX guard(s) render a number as a child when it is 0:\n  ${offending.join('\n  ')}\n` +
      'React renders `0 && <x/>` as the text "0"; the wire preserves a reported zero on purpose (#374, P1). ' +
      'Guard on presence (`!== undefined`, `!!`), never on the value.',
  );
});

// --- (b) the instrument can fail: the shapes it catches and the shapes it ignores ---

test('F4 (b) the pattern catches every defect shape at the base and ignores the presence-guarded ones', () => {
  const caught = [
    '{tokens_used && (',
    '{duration_ms && (',
    '{!isLoading && (duration_ms || tokens_used) && (',
    '{!(toolsCalled.length > 0 && duration_ms) && tokens_used && (',
    '{toolsCalled.length > 0 && duration_ms && (',
    '{tokens_used &&\n        <span>',
  ];
  for (const shape of caught) {
    assert.equal(findGuards(shape).length, 1, `must catch: ${JSON.stringify(shape)}`);
  }
  const ignored = [
    '{showFooter && !!(duration_ms || tokens_used) && (',
    '{tokens_used !== undefined && (',
    '{!!tokens_used && (',
    '{tokens_used > 0 && (',
    'showFooter={!isLoading && !!(duration_ms || tokens_used)}',
    '{token_limit_exceeded && (',
    '{resultSummary && (',
  ];
  for (const shape of ignored) {
    assert.equal(findGuards(shape).length, 0, `must ignore: ${JSON.stringify(shape)}`);
  }
});

// --- (c) the universe is still where this instrument looks ------------------

test('F4 (c) both components still declare the numeric props this instrument scans for', () => {
  for (const relative of COMPONENTS) {
    const source = sourceOf(relative);
    for (const field of ['tokens_used', 'duration_ms']) {
      assert.match(source, new RegExp(`\\b${field}\\?: number`), `${relative} no longer declares ${field}?: number — re-anchor`);
    }
  }
});
