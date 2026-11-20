// The rule: notebook HTML output is sanitized before display. These cases pin
// how `sanitizeNotebookHtml` writes its result; the render through the
// component, on a live run and on a stored record, is driven in
// `notebook-html-output.test.ts`.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeNotebookHtml } from './notebook-html.ts';

const CASES: [name: string, input: string, output: string][] = [
  ['an allowlisted element keeps only its numeric table attributes', '<table border="1" class="x"><tr style="a"><th colspan="2" halign="left">a</th><td rowspan=3>b</td></tr></table>', '<table border="1"><tr><th colspan="2">a</th><td rowspan="3">b</td></tr></table>'],
  ['an attribute value that is not digits is dropped', '<td colspan="2 x">z</td>', '<td>z</td>'],
  ['text is escaped and well-formed character references are kept', 'a < b > c &amp; d &lt; e & f', 'a &lt; b &gt; c &amp; d &lt; e &amp; f'],
  ['an element left open is closed', '<div><b>x', '<div><b>x</b></div>'],
  ['an end tag with nothing open is dropped', '</b>x', 'x'],
  ['an end tag closes the elements opened inside it', '<div><b><i>x</div>y', '<div><b><i>x</i></b></div>y'],
  ['an element outside the allowlist is dropped and its text kept', '<font>x</font><a>y</a>', 'xy'],
  ['a style element is dropped with its content', '<style>.a{}</style><STYLE >.b{}</style >ok', 'ok'],
  ['comments, doctypes and processing instructions are dropped', '<!DOCTYPE html><!-- c --><?x y?><p>p</p><!--> <!--->', '<p>p</p> '],
  ['a quoted attribute value may hold a closing bracket', '<td title=">"><b>x</b></td>', '<td><b>x</b></td>'],
  ['input that ends inside a tag drops that tag', '<p>a</p><td title="x', '<p>a</p>'],
  ['a dropped element with no end tag drops the rest of the input', '<p>a</p><style>b', '<p>a</p>'],
];

for (const [name, input, output] of CASES) {
  test(`notebook HTML output is sanitized before display: ${name}`, () => {
    assert.equal(sanitizeNotebookHtml(input), output);
  });
}

test('notebook HTML output is sanitized before display: the result is stable when sanitized again', () => {
  for (const [, input] of CASES) {
    const once = sanitizeNotebookHtml(input);
    assert.equal(sanitizeNotebookHtml(once), once, input);
  }
});
