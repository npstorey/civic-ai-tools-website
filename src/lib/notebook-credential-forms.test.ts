// #516 P9 — a notebook output never carries the value of a notebook credential.
//
// One removal, in `src/lib/streaming.ts`, and its twin in the one-shot
// function's handler:
//   - the shared vectors (`docker/executor/lambda/credential_forms.json`) hold
//     `notebookCredentialForms` and `withoutCredentials` here, and
//     `credential_forms` and `without_credentials` in `handler.py` (its own
//     tests, run in the lambda image, read the same file), to one list of
//     forms and one result;
//   - `withoutCredentialsIn` is that removal over every key and string of a
//     notebook, changing nothing else;
//   - the two routes that hand a notebook on — the notebook route to the
//     stream, the publish route to the package — call it, and P3's traceback
//     path calls `withoutCredentials`: one removal for all three.
//
// BLIND SPOT, stated: the last test reads the two route files' source for the
// import and the call. It shows the call is there, not that every path through
// the route reaches it; the driven test
// (`src/app/api/notebook-outputs-credentials-driven.test.ts`) shows that.
//
// Run with: npm test
//   (or: node --test --experimental-strip-types src/lib/notebook-credential-forms.test.ts)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { notebookCredentialForms, withoutCredentials, withoutCredentialsIn } from './streaming.ts';

interface Vectors {
  forms: Array<{ env: Record<string, string>; expected: Array<[string, string]> }>;
  removals: Array<{ env: Record<string, string>; text: string; expected: string }>;
}
const VECTORS = JSON.parse(
  fs.readFileSync(new URL('../../docker/executor/lambda/credential_forms.json', import.meta.url), 'utf8'),
) as Vectors;

test('the forms are the shared vectors’ on every case', () => {
  assert.ok(VECTORS.forms.length > 5);
  for (const { env, expected } of VECTORS.forms) {
    assert.deepEqual(notebookCredentialForms(env), expected, JSON.stringify(env));
  }
});

test('the removal is the shared vectors’ on every case', () => {
  assert.ok(VECTORS.removals.length > 3);
  for (const { env, text, expected } of VECTORS.removals) {
    assert.equal(withoutCredentials(text, env), expected, JSON.stringify(env));
  }
});

const ENV = { SOCRATA_APP_TOKEN: 'fixture socrata/p9', DC_API_KEY: 'fixture "dc"' };

test('withoutCredentialsIn reaches every key and every string, at any depth, and keeps the rest', () => {
  const input = {
    cells: [
      {
        outputs: [
          { output_type: 'stream', text: ['a fixture socrata/p9\n', 'b fixture%20socrata%2Fp9\n'] },
          { output_type: 'error', ename: 'ValueError', evalue: 'fixture \\"dc\\"', traceback: ['x fixture "dc"'] },
          { output_type: 'display_data', metadata: { 'fixture socrata/p9': true }, data: { 'text/html': ['<b>fixture "dc"</b>'] } },
        ],
        execution_count: 3,
      },
    ],
    metadata: { n: 1.5, ok: false, none: null },
  };
  const snapshot = structuredClone(input);
  assert.deepEqual(withoutCredentialsIn(input, ENV), {
    cells: [
      {
        outputs: [
          { output_type: 'stream', text: ['a [SOCRATA_APP_TOKEN removed]\n', 'b [SOCRATA_APP_TOKEN removed]\n'] },
          { output_type: 'error', ename: 'ValueError', evalue: '[DC_API_KEY removed]', traceback: ['x [DC_API_KEY removed]'] },
          { output_type: 'display_data', metadata: { '[SOCRATA_APP_TOKEN removed]': true }, data: { 'text/html': ['<b>[DC_API_KEY removed]</b>'] } },
        ],
        execution_count: 3,
      },
    ],
    metadata: { n: 1.5, ok: false, none: null },
  });
  assert.deepEqual(input, snapshot, 'the input was changed in place');
});

test('withoutCredentialsIn keeps key order, and keeps a parsed `__proto__` key as a key', () => {
  const parsed = JSON.parse('{"z": "fixture-dc", "__proto__": {"k": "fixture socrata/p9"}, "a": 1}') as Record<string, unknown>;
  const out = withoutCredentialsIn(parsed, ENV) as Record<string, unknown>;
  assert.deepEqual(Object.keys(out), ['z', '__proto__', 'a']);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(out, '__proto__')?.value, { k: '[SOCRATA_APP_TOKEN removed]' });
});

test('with neither credential set, withoutCredentialsIn returns the value itself', () => {
  const notebook = { cells: [{ outputs: [{ text: ['fixture socrata/p9'] }] }] };
  assert.equal(withoutCredentialsIn(notebook, {}), notebook);
  assert.equal(withoutCredentialsIn(notebook, { SOCRATA_APP_TOKEN: '', DC_API_KEY: undefined }), notebook);
});

test('the notebook route and the publish route call the one removal, from src/lib/streaming.ts', () => {
  for (const file of ['../app/api/query-notebook/route.ts', '../app/api/evidence/route.ts']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import \{[^}]*\bwithoutCredentialsIn\b[^}]*\} from '@\/lib\/streaming';/, `${file} does not import withoutCredentialsIn from @/lib/streaming`);
    assert.match(source, /\bwithoutCredentialsIn\((?:execution\.notebook|submittedNotebook), process\.env\)/, `${file} does not call it`);
  }
  const streaming = fs.readFileSync(new URL('./streaming.ts', import.meta.url), 'utf8');
  assert.match(streaming, /withoutCredentials\(withoutTerminalCodes\(err\.stderr\), env\)/, 'the traceback path no longer calls withoutCredentials');
});
