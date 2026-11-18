/**
 * Guard: the directory's filter toggle stays usable at 640 px and up in a browser without the `::details-content`
 * pseudo-element (#791).
 *
 * At 640 px and up the directory hides the filter Disclosure's summary and shows its closed body through
 * `.directory-filter-toggle > .ui-disclosure::details-content`. An engine without that pseudo-element drops the
 * `::details-content` rule (an unknown pseudo-element invalidates the selector) but keeps the summary's
 * `display: none`, so the filters were hidden with no control to open them. Both rules therefore sit inside
 * `@supports selector(::details-content)`, which such an engine reads as false; there the toggle shown below 640 px
 * stays.
 *
 * WHAT IS READ: `src/app/globals.css` as written, comments removed, parsed into nested blocks. Asserted:
 *   1. the summary-hiding rule and the `::details-content` rule each appear, and every appearance sits inside both
 *      `@supports selector(::details-content)` and `@media (min-width: 640px)`, in either nesting order;
 *   2. no selector anywhere in the stylesheet holds `::details-content` outside such an `@supports` block.
 * NOT READ: the built stylesheet. Whether the build keeps the `@supports` block as written was measured by hand
 * (Next 16.4.5, Turbopack, Tailwind v4 through @tailwindcss/postcss: kept, nested as written; #791's PR).
 * NOT READ: any browser. Whether the toggle shows is a browser reading, recorded on the PR.
 *
 * Run with: npm test
 *   (or: node --test --experimental-strip-types src/app/directory-filter-fallback.test.ts)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GLOBALS_CSS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'globals.css');

const SUPPORTS = '@supports selector(::details-content)';
const MEDIA = '@media (min-width: 640px)';
const SUMMARY_RULE = '.directory-filter-toggle > .ui-disclosure > .ui-disclosure-summary';
const CONTENT_RULE = '.directory-filter-toggle > .ui-disclosure::details-content';

interface Block {
  /** The text before the `{`, whitespace collapsed. */
  prelude: string;
  /** The text between the braces that is not a nested block (declarations). */
  body: string;
  children: Block[];
}

/** Collapses whitespace in a prelude: runs to one space, one space around `>`, none inside parentheses or after `:`. */
function norm(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\s*>\s*/g, ' > ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/:\s+/g, ':').trim();
}

/** Parses CSS into nested blocks. Comments are removed; quoted strings are kept whole so a brace in one is not read. */
function parseBlocks(css: string): Block[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const root: Block = { prelude: '', body: '', children: [] };
  const stack: Block[] = [root];
  let text = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      const stop = end === -1 ? src.length - 1 : end;
      text += src.slice(i, stop + 1);
      i = stop;
    } else if (ch === '{') {
      const block: Block = { prelude: norm(text.slice(text.lastIndexOf(';') + 1)), body: '', children: [] };
      stack[stack.length - 1].body += text.slice(0, text.lastIndexOf(';') + 1);
      stack[stack.length - 1].children.push(block);
      stack.push(block);
      text = '';
    } else if (ch === '}') {
      const block = stack.pop();
      assert.ok(block && stack.length > 0, 'globals.css: a `}` closes no block');
      block.body += text;
      text = '';
    } else {
      text += ch;
    }
  }
  assert.equal(stack.length, 1, 'globals.css: every `{` is closed');
  return root.children;
}

/** Every block, with the preludes of the blocks that enclose it, outermost first. */
function walk(blocks: Block[], ancestors: string[] = []): { block: Block; ancestors: string[] }[] {
  return blocks.flatMap((block) => [{ block, ancestors }, ...walk(block.children, [...ancestors, block.prelude])]);
}

/** The places a style rule with this exact selector appears. */
function rulesNamed(blocks: Block[], selector: string) {
  return walk(blocks).filter(({ block }) => block.prelude.split(',').map((s) => norm(s)).includes(norm(selector)));
}

/** A rule is gated when an enclosing block is the `@supports` and an enclosing block is the 640 px media query. */
function gated(ancestors: string[]): boolean {
  return ancestors.includes(norm(SUPPORTS)) && ancestors.includes(norm(MEDIA));
}

/** Every selector that holds `::details-content` and has no enclosing `@supports selector(::details-content)`. */
function ungatedDetailsContent(blocks: Block[]): string[] {
  return walk(blocks)
    .filter(({ block }) => !block.prelude.startsWith('@') && block.prelude.includes('::details-content'))
    .filter(({ ancestors }) => !ancestors.includes(norm(SUPPORTS)))
    .map(({ block, ancestors }) => [...ancestors, block.prelude].join(' / '));
}

test('the parser and predicates can fail: a fixture with the rules outside the gate is caught, one inside passes', () => {
  const ungatedCss = `${MEDIA} { ${SUMMARY_RULE} { display: none; } ${CONTENT_RULE} { display: block; } }`;
  const gatedCss = `${SUPPORTS} { ${MEDIA} { ${SUMMARY_RULE} { display: none; } ${CONTENT_RULE} { display: block; } } }`;
  const wrappedCss = `${MEDIA} { a { content: '{'; } ${SUPPORTS} { ${SUMMARY_RULE} { display: none; } ${CONTENT_RULE} { display: block; } } }`;
  const bad = parseBlocks(ungatedCss);
  assert.equal(rulesNamed(bad, SUMMARY_RULE).length, 1);
  assert.equal(rulesNamed(bad, SUMMARY_RULE).every(({ ancestors }) => gated(ancestors)), false);
  assert.equal(ungatedDetailsContent(bad).length, 1);
  for (const css of [gatedCss, wrappedCss]) {
    const good = parseBlocks(css);
    for (const sel of [SUMMARY_RULE, CONTENT_RULE]) {
      assert.equal(rulesNamed(good, sel).length, 1, `${sel} found in ${css}`);
      assert.ok(rulesNamed(good, sel).every(({ ancestors }) => gated(ancestors)), `${sel} gated in ${css}`);
    }
    assert.deepEqual(ungatedDetailsContent(good), []);
  }
});

test('globals.css: the summary-hiding rule and the ::details-content rule sit only inside @supports selector(::details-content) at 640 px and up', () => {
  const blocks = parseBlocks(fs.readFileSync(GLOBALS_CSS, 'utf8'));
  for (const sel of [SUMMARY_RULE, CONTENT_RULE]) {
    const found = rulesNamed(blocks, sel);
    assert.ok(found.length > 0, `globals.css holds a rule for \`${sel}\``);
    const outside = found.filter(({ ancestors }) => !gated(ancestors)).map(({ ancestors }) => ancestors.join(' / ') || '(top level)');
    assert.deepEqual(outside, [], `\`${sel}\` appears outside \`${SUPPORTS}\` + \`${MEDIA}\`, under: ${outside.join('; ')}`);
  }
  const summary = rulesNamed(blocks, SUMMARY_RULE);
  assert.ok(summary.every(({ block }) => /display\s*:\s*none/.test(block.body)), 'the gated summary rule is the one that hides it');
});

test('globals.css: no selector holds ::details-content outside @supports selector(::details-content)', () => {
  const blocks = parseBlocks(fs.readFileSync(GLOBALS_CSS, 'utf8'));
  assert.deepEqual(ungatedDetailsContent(blocks), []);
});
