// #516 P3 — the two bounds on a notebook failure, unit by unit:
// `notebookTracebackForReader` (what the reader is sent) and
// `notebookFailureFacts` (what the log line may add). The route-level drive,
// with the real executor path, is `src/app/api/query-notebook-traceback-driven.test.ts`;
// this file holds the edges that drive does not reach.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/notebook-traceback.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTEBOOK_CREDENTIAL_VARIABLES,
  NOTEBOOK_TRACEBACK_MAX_CHARS,
  notebookFailureFacts,
  notebookTracebackForReader,
} from './streaming.ts';
import { FUNCTION_HELD_VARIABLES } from './sandbox/lambda.ts';

const SESSION = { path: 'session' } as const;
const ONE_SHOT = { path: 'one-shot' } as const;
const NO_ENV = {};

const HEADER = 'nbclient.exceptions.CellExecutionError: An error occurred while executing the following cell:';
const RULE = '-'.repeat(75);

test('the names whose values are removed are the names the notebook is handed', () => {
  // `lambda.test.ts` holds FUNCTION_HELD_VARIABLES equal to the names
  // `buildNotebookEnv` supplies; this holds the removal list equal to it.
  assert.deepEqual([...NOTEBOOK_CREDENTIAL_VARIABLES].sort(), [...FUNCTION_HELD_VARIABLES].sort());
});

test('no marker, no traceback: a setup failure’s stderr is never the reader’s', () => {
  assert.equal(notebookTracebackForReader({ stderr: `${HEADER}\nKeyError: 'x'` }, NO_ENV), undefined);
});

test('the one-shot path sends no traceback (G0-9)', () => {
  assert.equal(notebookTracebackForReader({ stderr: `${HEADER}\nKeyError: 'x'`, notebookFailure: ONE_SHOT }, NO_ENV), undefined);
});

test('nbconvert’s own frames above its exception line are dropped, and colour codes are removed', () => {
  const stderr = `[NbConvertApp] Converting notebook\nTraceback (most recent call last):\n  File "x"\n${HEADER}\n\u001b[31mKeyError\u001b[39m: 'x'\r\n`;
  assert.equal(notebookTracebackForReader({ stderr, notebookFailure: SESSION }, NO_ENV), `${HEADER}\nKeyError: 'x'`);
});

test('the bound keeps the tail, and a credential at the cut is removed before the cut is made', () => {
  const value = 'fixture-credential-at-the-cut';
  const tail = `\nKeyError: 'the end'`;
  // The value straddles the point the cut would fall on, were it made first.
  const filler = 'y'.repeat(NOTEBOOK_TRACEBACK_MAX_CHARS - tail.length - Math.floor(value.length / 2));
  const stderr = `${HEADER}\n${'z'.repeat(5000)}${value}${filler}${tail}`;
  const out = notebookTracebackForReader({ stderr, notebookFailure: SESSION }, { DC_API_KEY: value })!;
  assert.ok(out.endsWith(tail.trim()), 'the tail was not kept');
  assert.match(out, /^\[\d+ earlier characters not shown\]\n/);
  assert.ok(out.length <= NOTEBOOK_TRACEBACK_MAX_CHARS + 40, `not bounded: ${out.length}`);
  for (let n = 6; n <= value.length; n++) {
    assert.ok(!out.includes(value.slice(0, n)) && !out.includes(value.slice(-n)), 'part of the value survived the cut');
  }
});

test('both credentials are removed raw, URL-encoded and JSON-escaped', () => {
  const socrata = 'fixture "socrata"/p3+value';
  const dc = 'fixture-dc';
  const stderr = `${HEADER}\n${socrata}\n${encodeURIComponent(socrata)}\n${JSON.stringify(socrata)}\n${dc}`;
  const out = notebookTracebackForReader({ stderr, notebookFailure: SESSION }, { SOCRATA_APP_TOKEN: socrata, DC_API_KEY: dc })!;
  for (const form of [socrata, encodeURIComponent(socrata), JSON.stringify(socrata).slice(1, -1), dc]) {
    assert.ok(!out.includes(form), `${form} survived:\n${out}`);
  }
  assert.equal(out.split('[SOCRATA_APP_TOKEN removed]').length - 1, 3);
  assert.equal(out.split('[DC_API_KEY removed]').length - 1, 1);
});

test('facts: the class is the LAST header’s (a chained exception prints its cause first), with its cell', () => {
  const stderr = [
    HEADER, '------------------', 'df["x"]', '------------------', '',
    RULE, 'KeyError                                  Traceback (most recent call last)', 'File /lib/pandas.py:3812',
    'KeyError: x', '', 'The above exception was the direct cause of the following exception:', '',
    RULE, 'ValueError                                Traceback (most recent call last)', 'Cell In[7], line 1',
    'ValueError: missing column',
  ].join('\n');
  assert.deepEqual(notebookFailureFacts({ stderr, notebookFailure: SESSION }, NO_ENV), {
    pythonErrorClass: 'ValueError',
    cellExecutionCount: 7,
    stderrBytes: new TextEncoder().encode(stderr).length,
  });
});

test('facts: a timeout names nbclient’s exception, and a header not under a rule is not read', () => {
  const stderr = [
    'nbclient.exceptions.CellTimeoutError: A cell timed out while it was being executed, after 3 seconds.',
    'Here is a preview of the cell contents:',
    'Brooklyn                                  Traceback (most recent call last)',
  ].join('\n');
  assert.deepEqual(notebookFailureFacts({ stderr, notebookFailure: SESSION }, NO_ENV), {
    pythonErrorClass: 'CellTimeoutError',
    stderrBytes: new TextEncoder().encode(stderr).length,
  });
});

test('facts: a setup failure logs its size alone; no stderr logs nothing', () => {
  const stderr = `${HEADER}\n${RULE}\nKeyError   Traceback (most recent call last)`;
  assert.deepEqual(notebookFailureFacts({ stderr }, NO_ENV), { stderrBytes: new TextEncoder().encode(stderr).length });
  assert.deepEqual(notebookFailureFacts({}, NO_ENV), {});
});

test('facts: a credential in a header’s place is removed before the class is read', () => {
  const value = 'FixtureCredentialShapedLikeAClass';
  const stderr = [HEADER, RULE, `${value}   Traceback (most recent call last)`, 'Cell In[1], line 1'].join('\n');
  const facts = notebookFailureFacts({ stderr, notebookFailure: SESSION }, { SOCRATA_APP_TOKEN: value });
  assert.ok(!JSON.stringify(facts).includes(value), JSON.stringify(facts));
  // With the value removed the line is no longer a header, so the class falls
  // back to nbclient's own exception.
  assert.equal(facts.pythonErrorClass, 'CellExecutionError');
});
