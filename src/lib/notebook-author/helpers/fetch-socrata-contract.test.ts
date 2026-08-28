// The contract between a generated cell and the helper it calls (Wave N8 P5,
// #340).
//
// Two halves, and the defect lived in the gap between them:
//
//   1. `src/lib/mcp/tools.ts` advertises `query` on `get_data`, the model
//      sends it, and `tool-to-cell.ts` renders it into a `fetch_socrata(...)`
//      call. At the base `fetch_socrata` had no `query` parameter, so the cell
//      raised `TypeError` on execution and the reader was told live data could
//      not be fetched — in a notebook whose cover text called itself
//      reproducible.
//   2. The helper is not a wrapper around the data-access service: it talks to
//      the portal directly. So it cannot inherit the service's precedence for
//      `query`; it has to implement the same rule itself. A reader can re-run
//      this cell with different arguments, and the mapping has to hold for
//      THEIR arguments too, not only for the ones we rendered.
//
// THE COUPLING THIS FILE PINS, AND WHAT TO DO WHEN IT MOVES.
// `_is_full_soql_query` in fetch_socrata.py is a copy of a regular expression
// that lives in ANOTHER repository:
//
//     socrata-mcp-server/src/tools/socrata-tools.ts:546
//     at commit 116f46ce1e84e3608014599f9b63ea01acfd913a
//
//         if (queryField && /^\s*select/i.test(queryField)) { … }
//
//   matching  → `$query` alone; select/where/order/group/having/q are set
//               aside (:547-553) and the request carries neither $limit nor
//               $offset (:283-293);
//   otherwise → `$q`, with every other clause preserved (:555-557);
//   and, third, a non-SoQL `query` with no dataset_id BECOMES the dataset id
//               (:531) — the one behaviour this helper deliberately does not
//               reproduce.
//
// IF THE SERVICE CHANGES ITS SNIFF, THE FIX IS AN ISSUE ON THIS REPOSITORY, so
// that this copy, the TypeScript predicate in `tool-to-cell.ts` and the
// service all move together. A change made on one side alone is a silent
// divergence, and it surfaces only in a published notebook — where a reader is
// told a `limit=` applied that never did.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELPER_PARAMETERS, renderFetchToolCell } from '../tool-to-cell.ts';
import { mcpTools } from '../../mcp/tools.ts';

const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));

function helperSource(file: string): string {
  return fs.readFileSync(path.join(HELPERS_DIR, file), 'utf8');
}

/**
 * Stub `requests` and `pandas` into `sys.modules`, then execute the helper
 * source as written. Stdlib only — the suite must not need the scientific
 * stack installed to check what the helper sends.
 *
 * The captured request deliberately excludes headers: they carry
 * `X-App-Token` when the environment supplies one, and a test that printed
 * them would print a credential into a CI log.
 */
const PY_PREAMBLE = [
  'import json, sys, types',
  'captured = {}',
  'class _Response:',
  '    def raise_for_status(self): return None',
  '    def json(self): return []',
  'def _get(url, params=None, headers=None, timeout=None):',
  "    captured['url'] = url",
  "    captured['params'] = params",
  '    return _Response()',
  "requests_stub = types.ModuleType('requests')",
  'requests_stub.get = _get',
  "pandas_stub = types.ModuleType('pandas')",
  'pandas_stub.DataFrame = lambda data=None: data',
  "sys.modules['requests'] = requests_stub",
  "sys.modules['pandas'] = pandas_stub",
  'ns = {}',
  "exec(compile(sys.stdin.read(), 'helper.py', 'exec'), ns)",
].join('\n');

/** Call `fetch_socrata(**kwargs)` and report the query string it would send. */
const PY_CALL = [
  PY_PREAMBLE,
  'kwargs = json.loads(sys.argv[1])',
  'try:',
  "    ns['fetch_socrata'](**kwargs)",
  "    print(json.dumps({'raised': None, 'url': captured.get('url'), 'params': captured.get('params')}))",
  'except Exception as err:',
  "    print(json.dumps({'raised': type(err).__name__, 'message': str(err)}))",
].join('\n');

/**
 * Report a helper's parameter names, plus whether it declares `*args` /
 * `**kwargs`, by parsing the .py rather than importing it.
 *
 * A structural read of the source, not `inspect.signature` on an imported
 * module: the other helpers evaluate their annotations at definition time, so
 * importing them needs an interpreter new enough for the syntax those
 * annotations use. A test whose verdict depends on the interpreter version on
 * the machine is a test that can pass here and fail on a runner for a reason
 * that has nothing to do with the code.
 */
const PY_SIGNATURE = [
  'import ast, json, sys',
  'tree = ast.parse(sys.stdin.read())',
  'want = sys.argv[1]',
  'out = None',
  'for node in ast.walk(tree):',
  '    if isinstance(node, ast.FunctionDef) and node.name == want:',
  '        a = node.args',
  "        out = {'params': [x.arg for x in a.posonlyargs + a.args + a.kwonlyargs],",
  "               'vararg': a.vararg.arg if a.vararg else None,",
  "               'kwarg': a.kwarg.arg if a.kwarg else None}",
  '        break',
  'print(json.dumps(out))',
].join('\n');

interface CallResult {
  raised: string | null;
  url?: string;
  params?: Record<string, string>;
  message?: string;
}

function runPython(script: string, arg: string, source: string): string {
  const result = spawnSync('python3', ['-c', script, arg], { input: source, encoding: 'utf-8' });
  assert.equal(
    result.status,
    0,
    `python3 probe failed (exit ${result.status})\n--- stderr ---\n${result.stderr}`,
  );
  return result.stdout;
}

function callFetchSocrata(kwargs: Record<string, unknown>): CallResult {
  return JSON.parse(runPython(PY_CALL, JSON.stringify(kwargs), helperSource('fetch_socrata.py')));
}

interface HelperSignature {
  params: string[];
  vararg: string | null;
  kwarg: string | null;
}

function helperSignature(file: string, fn: string): HelperSignature {
  const parsed = JSON.parse(runPython(PY_SIGNATURE, fn, helperSource(file)));
  assert.ok(parsed, `${file} declares no function named ${fn}`);
  return parsed as HelperSignature;
}

/** The service's regex, transcribed literally from the line cited above. */
const SERVICE_SOQL_SNIFF = /^\s*select/i;

/**
 * The fixture from the service's own suite —
 * `socrata-mcp-server/src/__tests__/search.test.ts:165`,
 * `test('handles full SoQL query')`. It drives this exact string, asserts the
 * request carries `{ $query: <it> }` and nothing else, and gets 42 rows from a
 * single call. The 42 comes from the statement's own LIMIT, which is what
 * bounds the rows once `$limit` is no longer sent.
 */
const SERVICE_SUITE_SOQL = 'SELECT * WHERE category = "test" LIMIT 42';

test('#340: the helper accepts `query`, and a full SoQL statement becomes the whole query', () => {
  // RED at the base: `fetch_socrata` had no `query` parameter at all, so this
  // call raised TypeError — which is exactly what the generated cell did.
  //
  // The service's fixture, driven through OUR helper: the request must carry
  // $query alone. Not $select, not $where — and not $limit or $offset either,
  // which is the half a "query wins" implementation usually gets wrong.
  const result = callFetchSocrata({
    portal: 'data.test.gov',
    dataset_id: 'soql-dataset',
    query: SERVICE_SUITE_SOQL,
    select: 'category, count(*)',
    where: "category = 'other'",
    order: 'count DESC',
    group: 'category',
    limit: 5,
    offset: 20,
  });

  assert.equal(result.raised, null, `unexpected ${result.raised}: ${result.message}`);
  assert.equal(result.url, 'https://data.test.gov/resource/soql-dataset.json');
  assert.deepEqual(result.params, { $query: SERVICE_SUITE_SOQL });
});

test('#340: a search phrase becomes $q, with every other clause preserved', () => {
  // The service's other branch (:555-557). A helper that mapped `query` to
  // `$query` unconditionally would reproduce a phrase-branch analysis
  // DIFFERENTLY than it ran — turning #340 into the defect #341 is about.
  const result = callFetchSocrata({
    portal: 'data.test.gov',
    dataset_id: 'soql-dataset',
    query: 'noise complaints',
    where: "borough = 'BROOKLYN'",
    limit: 5,
  });

  assert.equal(result.raised, null, `unexpected ${result.raised}: ${result.message}`);
  assert.deepEqual(result.params, {
    $q: 'noise complaints',
    $where: "borough = 'BROOKLYN'",
    $limit: '5',
  });
});

test('#340: the helper applies the sniff itself, on arguments no cell rendered', () => {
  // A reader can re-run this cell with their own `query`. So the branch is
  // theirs to take, and the helper must map THEIR argument the way the
  // service would have mapped it — not merely reproduce the one case the
  // renderer happened to emit.
  //
  // RED: `query.strip().upper().startswith('SELECT')`, or a sniff without
  // `\s*`. Both pass on the fixture above and diverge on the rows below.
  const cases = [
    SERVICE_SUITE_SOQL,
    'select * from x',
    '   SELECT count(*) AS n',
    'SeLeCt 1',
    'noise complaints',
    'selected noise complaints',
    'WHERE complaint_type = "Noise"',
    ' 311 selected complaints',
  ];
  for (const query of cases) {
    const result = callFetchSocrata({ portal: 'data.test.gov', dataset_id: 'ds', query, limit: 5 });
    assert.equal(result.raised, null, `${JSON.stringify(query)}: ${result.message}`);
    const params = result.params ?? {};
    const wentSoql = Object.prototype.hasOwnProperty.call(params, '$query');
    assert.equal(
      wentSoql,
      SERVICE_SOQL_SNIFF.test(query),
      `the helper took the wrong branch for ${JSON.stringify(query)}: ${JSON.stringify(params)}`,
    );
    // And the branch it took is the whole behaviour: a $query travels alone.
    if (wentSoql) assert.deepEqual(params, { $query: query });
    else assert.equal(params.$q, query);
  }
});

test('#340 (rider c): dataset_id is required and never inferred from `query`', () => {
  // The service's third behaviour (socrata-tools.ts:531): given a non-SoQL
  // `query` and no dataset_id, it uses the query string AS the dataset id.
  //
  // RED: exactly that fallback here — the helper would fetch
  // `/resource/noise complaints.json` and report whatever came back as the
  // dataset the analysis read. A dataset id guessed from a search phrase is a
  // guess, and a notebook that guesses which dataset it read is not
  // reproducing anything. A stricter helper than the service is a safe
  // divergence; a guessing one is not.
  const inferred = callFetchSocrata({ portal: 'data.test.gov', query: 'noise complaints' });
  assert.equal(inferred.raised, 'SocrataDatasetIdRequired');
  assert.match(inferred.message ?? '', /never[\s\S]*inferred from the query field/);
  assert.equal(inferred.url, undefined, 'no request may be sent at all');

  // Empty string is absence too, not a dataset named "".
  const empty = callFetchSocrata({ portal: 'data.test.gov', dataset_id: '', query: 'noise' });
  assert.equal(empty.raised, 'SocrataDatasetIdRequired');

  // The error is a ValueError subclass, so a reader's own `except ValueError`
  // still catches it — and the notebook's per-step guard prints its NAME,
  // which is why the name has to say what is wrong.
  const isValueError = runPython(
    [
      PY_PREAMBLE,
      "print(json.dumps(issubclass(ns['SocrataDatasetIdRequired'], ValueError)))",
    ].join('\n'),
    '',
    helperSource('fetch_socrata.py'),
  );
  assert.equal(isValueError.trim(), 'true');
});

test('#340: the renderer\'s helper-parameter lists match the helpers themselves', () => {
  // `tool-to-cell.ts` will only emit a kwarg that is in its list for that
  // helper. The list is therefore load-bearing in both directions, and neither
  // failure is visible at render time:
  //
  //   - a name in the list that the .py does not have puts back exactly the
  //     TypeError #340 is about;
  //   - a parameter in the .py that is missing from the list is silently
  //     dropped from every generated cell, and the analysis is reproduced with
  //     an argument the original run did not have.
  //
  // Credential and transport parameters are the declared exception: a
  // generated cell never writes them.
  const NEVER_RENDERED = new Set(['app_token', 'api_key', 'timeout_s']);
  const cases: Array<[string, string, readonly string[]]> = [
    ['fetch_socrata.py', 'fetch_socrata', HELPER_PARAMETERS.fetch_socrata],
    ['fetch_data_commons.py', 'fetch_data_commons', HELPER_PARAMETERS.fetch_data_commons],
  ];
  for (const [file, fn, declared] of cases) {
    const signature = helperSignature(file, fn);
    for (const name of declared) {
      assert.ok(
        signature.params.includes(name),
        `${fn}: the renderer may emit ${name}=, which ${file} has no parameter for`,
      );
    }
    for (const name of signature.params) {
      if (NEVER_RENDERED.has(name)) continue;
      assert.ok(
        declared.includes(name),
        `${fn}: ${file} has a parameter ${name} the renderer never emits — an argument the original call carried would be silently dropped`,
      );
    }
    // No `**kwargs`. A helper that swallowed unknown keywords would make the
    // check above pass while doing the thing it exists to prevent: the cell
    // would run, the argument would have no effect, and nothing would say so.
    assert.equal(signature.kwarg, null, `${fn}: a **kwargs catch-all silently ignores arguments`);
  }
});

/** Every keyword argument the generated cell passes to a `fetch_*` call. */
const PY_EMITTED_KWARGS = [
  'import ast, json, sys',
  'tree = ast.parse(sys.stdin.read())',
  'names = []',
  'for node in ast.walk(tree):',
  '    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) '
    + "and node.func.id.startswith('fetch_'):",
  '        names.extend([kw.arg for kw in node.keywords])',
  'print(json.dumps(names))',
].join('\n');

function emittedKwargs(cellSource: string): string[] {
  return JSON.parse(runPython(PY_EMITTED_KWARGS, '', cellSource));
}

test('#340: every argument get_data advertises reaches a parameter that exists, or is not passed', () => {
  // Wave criterion 9, as a property over the SCHEMA rather than over the one
  // argument the issue named. `mcpTools` is what the model is told it may
  // send, `fetch_socrata.py` is what the cell may call, and the renderer is
  // the only thing between them — so the three are read here together.
  //
  // RED at the base: `query` is advertised, the renderer emitted it, and the
  // helper had no such parameter. It goes red again the moment a property is
  // added to the schema without a home on the other side.
  const getData = mcpTools.find(
    (t): t is Extract<typeof t, { type: 'function' }> =>
      t.type === 'function' && t.function.name === 'get_data',
  );
  assert.ok(getData, 'get_data must still be advertised');
  const advertised = Object.keys(
    (getData!.function.parameters as { properties: Record<string, unknown> }).properties,
  );
  assert.ok(advertised.includes('query'), 'the argument #340 is about is still advertised');

  // `type` selects which renderer runs; it is not an argument to any helper
  // and is deliberately never written into the Python. Every OTHER advertised
  // argument must reach a parameter that exists.
  const ROUTING_ONLY = new Set(['type']);
  const helperParams = helperSignature('fetch_socrata.py', 'fetch_socrata').params;

  // A phrase-shaped `query` is the branch that supersedes nothing, so this
  // call is the one that renders the widest set of kwargs.
  const args: Record<string, unknown> = {};
  for (const name of advertised) {
    args[name] = name === 'type' ? 'query'
      : name === 'portal' ? 'data.test.gov'
      : name === 'dataset_id' ? 'abcd-1234'
      : name === 'query' ? 'noise complaints'
      : name === 'limit' || name === 'offset' ? 5
      : `${name}-value`;
  }
  const rendered = renderFetchToolCell({ name: 'get_data', args }, {
    dataFrameIndex: 1,
    defaultPortal: 'data.test.gov',
  });
  assert.ok(rendered, 'a type=query call must render a cell');
  const code = rendered!.cells.find(c => c.cell_type === 'code');
  assert.ok(code, 'a type=query call must render a code cell');
  const emitted = emittedKwargs(code!.source.join(''));

  for (const name of emitted) {
    assert.ok(
      helperParams.includes(name),
      `the cell passes ${name}=, which fetch_socrata has no parameter for — ` +
        'Python raises TypeError and the reader is told live data could not be fetched',
    );
  }
  for (const name of advertised) {
    if (ROUTING_ONLY.has(name)) {
      assert.ok(!emitted.includes(name), `${name} is call routing and must never be written into Python`);
      continue;
    }
    assert.ok(
      emitted.includes(name),
      `get_data advertises ${name}, the model can send it, and this cell neither passes it nor ` +
        'discloses it — it would be dropped from the reproduction in silence',
    );
  }
});
