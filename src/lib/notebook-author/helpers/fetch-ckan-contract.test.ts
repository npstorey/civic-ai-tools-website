// The contract between a CKAN datastore cell and the helper it calls: `q` (FIX-1 FX-C).
//
// The hosted CKAN server's `ckan_datastore_search` takes `q` as a string or as an object such as
// `{"column": "word"}` from upstream v0.4.146 (`src/tools/datastore.ts:213`). It sends a string as is and an object as
// compact JSON (`:238-241`):
//
//     if (typeof params.q === 'string') { if (params.q) apiParams.q = params.q; }
//     else if (params.q && Object.keys(params.q).length > 0) { apiParams.q = JSON.stringify(params.q); }
//
// CKAN reads the JSON form as a search scoped to the named columns. The cell writes an object `q` as a Python dict
// (`pyRepr`), so the helper has to make the same choice the server makes. Handed a dict, the requests library
// iterates it as a sequence of values and sends its KEYS, so `q={"title": "parks"}` would leave as `q=title`: a
// full-text search for a column's name, different rows from the answer's, and nothing in the notebook saying so.
//
// RECORDED AT THE REQUEST. The stub below does not read the `params` dict the helper builds: it encodes it into the
// query string the way requests 2.32.3 does (the executor image's pin, `docker/executor/Dockerfile`), with
// `RequestEncodingMixin._encode_params` transcribed from `requests/models.py` at that version, and the assertions
// decode that query string. The suite stays stdlib-only, as `fetch-socrata-contract.test.ts` does. If the pin moves,
// re-read `_encode_params` at the new version against the transcription before trusting a green here.
//
// The expected value is `JSON.stringify` of the same object, computed here in JavaScript: the server's own
// expression, not a Python reimplementation of it.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFetchToolCell } from '../tool-to-cell.ts';

const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));
const HELPER_SOURCE = fs.readFileSync(path.join(HELPERS_DIR, 'fetch_ckan.py'), 'utf8');
const SERVER_URL = 'https://ckan.example.test';

/**
 * Stub `requests` and `pandas`, then execute the helper source as written.
 *
 * Compiled with `from __future__ import annotations` so the helper's `str | None` annotations are not evaluated at
 * definition time: the verdict must not depend on whether the machine's python3 is older than 3.10. Nothing else in
 * the helper reads its annotations.
 */
const PY_PREAMBLE = [
  'import __future__, json, sys, types',
  'from urllib.parse import parse_qsl, urlencode',
  'captured = {}',
  '# requests 2.32.3, requests/models.py, RequestEncodingMixin._encode_params, for a dict of params',
  '# (requests.compat.basestring is (str, bytes); to_key_val_list(dict) is list(dict.items())).',
  'def _encode_params(data):',
  '    result = []',
  '    for k, vs in list(data.items()):',
  '        if isinstance(vs, (str, bytes)) or not hasattr(vs, "__iter__"):',
  '            vs = [vs]',
  '        for v in vs:',
  '            if v is not None:',
  '                result.append((k.encode("utf-8") if isinstance(k, str) else k,',
  '                               v.encode("utf-8") if isinstance(v, str) else v))',
  '    return urlencode(result, doseq=True)',
  'class _Response:',
  '    def raise_for_status(self): return None',
  "    def json(self): return {'success': True, 'result': {'records': []}}",
  'def _get(url, params=None, headers=None, timeout=None):',
  "    captured['url'] = url",
  "    captured['query'] = _encode_params(params)",
  '    return _Response()',
  "requests_stub = types.ModuleType('requests')",
  'requests_stub.get = _get',
  "pandas_stub = types.ModuleType('pandas')",
  'pandas_stub.DataFrame = lambda data=None: data',
  "sys.modules['requests'] = requests_stub",
  "sys.modules['pandas'] = pandas_stub",
  "ns = {'pd': pandas_stub}",
  "exec(compile(sys.stdin.read(), 'fetch_ckan.py', 'exec', flags=__future__.annotations.compiler_flag, dont_inherit=True), ns)",
  'def _report(raised=None, message=None):',
  "    query = captured.get('query')",
  "    sent = None if query is None else [v for k, v in parse_qsl(query, keep_blank_values=True) if k == 'q']",
  "    print(json.dumps({'raised': raised, 'message': message, 'url': captured.get('url'), 'query': query, 'q': sent}))",
].join('\n');

/** Call `fetch_ckan(server_url, **kwargs)` and report the request it sent. */
const PY_CALL = [
  PY_PREAMBLE,
  'kwargs = json.loads(sys.argv[1])',
  'try:',
  "    ns['fetch_ckan'](**kwargs)",
  '    _report()',
  'except Exception as err:',
  '    _report(type(err).__name__, str(err))',
].join('\n');

/** Execute a generated cell's code beside the helper, and report the request it sent. */
const PY_CELL = [
  PY_PREAMBLE,
  "exec(compile(sys.argv[1], 'cell.py', 'exec'), ns)",
  '_report()',
].join('\n');

interface SentRequest {
  raised: string | null;
  message: string | null;
  url: string | null;
  /** The query string as requests would put it on the wire. */
  query: string | null;
  /** Every `q` value in that query string, decoded; `null` when no request was sent. */
  q: string[] | null;
}

function runPython(script: string, arg: string): SentRequest {
  const result = spawnSync('python3', ['-c', script, arg], {
    input: HELPER_SOURCE,
    encoding: 'utf-8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(result.status, 0, `python3 probe failed (exit ${result.status})\n--- stderr ---\n${result.stderr}`);
  return JSON.parse(result.stdout) as SentRequest;
}

function callFetchCkan(kwargs: Record<string, unknown>): SentRequest {
  const sent = runPython(PY_CALL, JSON.stringify({ server_url: SERVER_URL, resource_id: 'fxc-resource-0001', ...kwargs }));
  assert.equal(sent.raised, null, `fetch_ckan raised ${sent.raised}: ${sent.message}`);
  assert.equal(sent.url, `${SERVER_URL}/api/3/action/datastore_search`);
  return sent;
}

test('FX-C: an object q is sent as compact JSON, the server\'s form, not as its keys', () => {
  // RED at the base: the helper put the dict into `params` as is, and requests sent `q=title`.
  const q = { title: 'parks' };
  const sent = callFetchCkan({ q });
  assert.deepEqual(sent.q, ['{"title":"parks"}'], `the request carried ${sent.query}`);
  assert.deepEqual(sent.q, [JSON.stringify(q)]);
});

test('FX-C: an object q with non-ASCII values and two keys equals JSON.stringify of it, byte for byte, keys in the call\'s order', () => {
  // Shaped to fail: `json.dumps` escapes non-ASCII by default (`é`), where `JSON.stringify` does not; and the
  // keys are out of alphabetical order, so a helper that sorted them would differ.
  const q = { zona: 'Città Alta – Bergamo', 'nome del parco': 'Parc du Mont-Royal, été' };
  const sent = callFetchCkan({ q });
  assert.deepEqual(sent.q, [JSON.stringify(q)], `the request carried ${sent.query}`);
  assert.equal(
    Buffer.compare(Buffer.from(sent.q![0], 'utf8'), Buffer.from(JSON.stringify(q), 'utf8')),
    0,
    'the parameter is not JSON.stringify\'s bytes',
  );
  assert.ok(sent.q![0].startsWith('{"zona":'), `the keys left in another order: ${sent.q![0]}`);

  // The characters both encoders escape: a quote, a backslash, a newline, a tab and another control character.
  const escaped = { 'col "a"': 'back\\slash\nline\ttab\u0001end' };
  assert.deepEqual(callFetchCkan({ q: escaped }).q, [JSON.stringify(escaped)]);
});

test('FX-C (pin): a string q is sent as is; an empty string or an empty object sends no q, as the server does', () => {
  assert.deepEqual(callFetchCkan({ q: 'pothole repair' }).q, ['pothole repair']);
  assert.deepEqual(callFetchCkan({ q: 'città alta' }).q, ['città alta']);
  // A string that happens to look like JSON is still a string: sent untouched.
  assert.deepEqual(callFetchCkan({ q: '{"title": "parks"}' }).q, ['{"title": "parks"}']);
  assert.deepEqual(callFetchCkan({ q: '' }).q, []);
  assert.deepEqual(callFetchCkan({ q: {} }).q, []);
  assert.deepEqual(callFetchCkan({}).q, []);
});

test('FX-C: a cell written from a datastore call with an object q passes q= to fetch_ckan, and running it sends the server\'s form', () => {
  const q = { title: 'parks', zona: 'Città Alta' };
  const cell = renderFetchToolCell(
    { name: 'ckan__ckan_datastore_search', args: { server_url: SERVER_URL, resource_id: 'fxc-resource-0002', q } },
    { dataFrameIndex: 1, defaultPortal: '' },
  );
  assert.ok(cell, 'a datastore call renders no cell');
  const code = cell!.cells.filter(c => c.cell_type === 'code').map(c => [c.source].flat().join('')).join('\n');
  // The cell passes the call's object as a Python dict, as at the base.
  assert.match(code, /\bq=\{\s*"title": "parks",\s*"zona": "Città Alta",\s*\},/, `the cell does not pass q=:\n${code}`);

  // RED at the base: the cell ran, and its request searched for `title` and `zona`.
  const sent = runPython(PY_CELL, code);
  assert.equal(sent.url, `${SERVER_URL}/api/3/action/datastore_search`, `the cell sent no request:\n${code}`);
  assert.deepEqual(sent.q, [JSON.stringify(q)], `the cell's request carried ${sent.query}`);
});
