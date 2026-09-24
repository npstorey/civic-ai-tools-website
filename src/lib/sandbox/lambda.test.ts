// The lambda executor driver (#530 P2, rulings D1, D2, D5, D6).
//
// Every run here goes through `executeNotebook` with EXECUTOR_DRIVER=lambda
// and the driver's OWN client: the real AWS SDK, signing with the default
// credential chain, pointed by the SDK's own AWS_ENDPOINT_URL_LAMBDA at a
// loopback stand-in for the Lambda API that records each request and answers
// as the function's handler does. So what is asserted is the request the
// driver really sends and how it reads what really comes back. The two
// credential values are placeholders, like the S3 drive's in
// scripts/outbound-proxy.test.mjs: the stand-in checks nothing.
//
// What each group can fail on:
//   - SELECTION AND THE INVOKE: `lambda` is an accepted driver, and the call is
//     a synchronous Invoke of the named function, logs not requested.
//   - THE PAYLOAD: the staged file, the nbconvert argv and the version probe
//     are the ones the session drivers run (D1); the two portal tokens are not
//     in it (D5).
//   - THE ANSWER: the executed bytes, the version, the invocation id (the
//     response's request id, else the handler's), nbconvert's failure, and the
//     two size refusals (D2).
//   - SETTINGS: the function is required and shaped, the region comes from
//     EXECUTOR_LAMBDA_REGION or the SDK chain or the run refuses naming both,
//     and a failed call is made once, not retried (D6).
//   - THE TRANSPORT: with a proxy, the dispatcher the driver builds carries the
//     header timeout it is given, not the global one (D6).
//   - THE LISTS: the names held on the function are the names the notebook's
//     environment carries and the names the handler adds.
//
// Run with: npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Notebook } from '../notebook-author/cells.ts';

// --- the stand-in for the Lambda API ------------------------------------------

interface Recorded {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface Answer {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
  /** Hold the response this long before answering. */
  delayMs?: number;
}

const requests: Recorded[] = [];
let answers: Answer[] = [];

const EXECUTED_NOTEBOOK = { cells: [], metadata: { executed: true }, nbformat: 4, nbformat_minor: 5 };

/** What the handler returns for a run that worked. */
function handlerAnswer(overrides: Record<string, unknown> = {}): Answer {
  return {
    headers: { 'x-amzn-requestid': 'invoke-request-id-7' },
    body: {
      protocol: 1,
      requestId: 'handler-reported-id',
      exitCode: 0,
      executed: Buffer.from(JSON.stringify(EXECUTED_NOTEBOOK)).toString('base64'),
      python: '3.13.7',
      ...overrides,
    },
  };
}

const api = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    const answer = answers.shift() ?? handlerAnswer();
    setTimeout(() => {
      res.writeHead(answer.status ?? 200, { 'content-type': 'application/json', ...(answer.headers ?? {}) });
      res.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
    }, answer.delayMs ?? 0);
  });
});
await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
const API = `http://127.0.0.1:${(api.address() as net.AddressInfo).port}`;

// --- the environment ------------------------------------------------------------

const FUNCTION = 'civic-notebook-executor';
const BASE_ENV: Record<string, string | null> = {
  EXECUTOR_DRIVER: 'lambda',
  EXECUTOR_LAMBDA_FUNCTION: FUNCTION,
  EXECUTOR_LAMBDA_REGION: 'us-east-1',
  AWS_ENDPOINT_URL_LAMBDA: API,
  AWS_ACCESS_KEY_ID: 'probe',
  AWS_SECRET_ACCESS_KEY: 'probe',
  AWS_SESSION_TOKEN: null,
  AWS_PROFILE: null,
  AWS_REGION: null,
  AWS_DEFAULT_REGION: null,
  AWS_CONFIG_FILE: '/nonexistent/aws-config',
  AWS_SHARED_CREDENTIALS_FILE: '/nonexistent/aws-credentials',
  AWS_EC2_METADATA_DISABLED: 'true',
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: null,
  AWS_CONTAINER_CREDENTIALS_FULL_URI: null,
  SOCRATA_APP_TOKEN: null,
  DC_API_KEY: null,
  HTTP_PROXY: null,
  http_proxy: null,
  HTTPS_PROXY: null,
  https_proxy: null,
  NO_PROXY: null,
  no_proxy: null,
  EXECUTOR_SESSION_TIMEOUT_S: null,
  EXECUTOR_CELL_TIMEOUT_S: null,
};

const saved = new Map<string, string | undefined>();
function setEnv(values: Record<string, string | null>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    if (value === null) delete process.env[name];
    else process.env[name] = value;
  }
}
setEnv(BASE_ENV);

// Loaded after EXECUTOR_DRIVER is set: the seam picks its driver on first use.
const { executeNotebook, executeNotebookWith, NotebookExecutionError } = await import('./execute.ts');

before(() => {
  requests.length = 0;
});
after(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  api.close();
});

const NOTEBOOK = { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 } as unknown as Notebook;

/** One run with `vars` on top of the base environment, restored after. */
async function run(
  vars: Record<string, string | null> = {},
  scripted: Answer[] = [],
  notebook: Notebook = NOTEBOOK,
  opts: { signal?: AbortSignal } = {},
): Promise<{ calls: Recorded[]; result?: Awaited<ReturnType<typeof executeNotebook>>; error?: unknown }> {
  requests.length = 0;
  answers = [...scripted];
  const before = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name] ?? null]));
  setEnv(vars);
  try {
    const result = await executeNotebook(notebook, opts);
    return { calls: [...requests], result };
  } catch (error) {
    return { calls: [...requests], error };
  } finally {
    setEnv(before);
  }
}

const VERSION_PROBE =
  'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")';

/** The argv the container driver runs nbconvert with at the defaults (the P1 pin). */
const NBCONVERT_ARGS = [
  'nbconvert', '--to', 'notebook', '--execute',
  '--ExecutePreprocessor.timeout', '120', '--ExecutePreprocessor.allow_errors=False',
  '--output', '/tmp/executed.ipynb', '/tmp/notebook.ipynb',
];

// --- selection and the invoke -------------------------------------------------

test('EXECUTOR_DRIVER=lambda runs the notebook through one synchronous invoke of the named function', async () => {
  const { calls, result, error } = await run();
  assert.equal(error, undefined, `the run failed: ${String(error)}`);
  assert.equal(calls.length, 1, `the run made ${calls.length} requests to the Lambda API`);
  const [call] = calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `/2015-03-31/functions/${FUNCTION}/invocations`);
  assert.equal(call.headers['x-amz-invocation-type'], 'RequestResponse');
  assert.equal(call.headers['x-amz-log-type'], 'None', 'the invoke must not ask for the function log');
  assert.match(String(call.headers.authorization ?? ''), /^AWS4-HMAC-SHA256 /, 'the invoke was not signed');
  assert.deepEqual(result?.notebook, EXECUTED_NOTEBOOK);
  assert.equal(result?.pythonVersion, '3.13.7');
});

test('the invocation id is the response request id, else the id the handler reports', async () => {
  const withHeader = await run();
  assert.equal(withHeader.result?.sandboxId, 'invoke-request-id-7');
  const answer = handlerAnswer();
  answer.headers = {};
  const withoutHeader = await run({}, [answer]);
  assert.equal(withoutHeader.result?.sandboxId, 'handler-reported-id');
});

// --- the payload --------------------------------------------------------------

test('the payload carries the staged notebook, the nbconvert argv and the probe the session drivers run', async () => {
  const { calls, error } = await run();
  assert.equal(error, undefined, `the run failed: ${String(error)}`);
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.protocol, 1);
  assert.deepEqual(payload.files, [{ path: '/tmp/notebook.ipynb', content: JSON.stringify(NOTEBOOK) }]);
  assert.equal(payload.command.cmd, 'jupyter');
  assert.deepEqual(payload.command.args, NBCONVERT_ARGS);
  assert.equal(payload.readBack, '/tmp/executed.ipynb');
  assert.deepEqual(payload.versionProbe, { cmd: 'python3', args: ['-c', VERSION_PROBE] });
  assert.equal(payload.timeoutMs, 180_000);
});

test('the settings reach the payload: the cell limit in the argv, the cap as timeoutMs', async () => {
  const { calls } = await run({ EXECUTOR_SESSION_TIMEOUT_S: '200', EXECUTOR_CELL_TIMEOUT_S: '90' });
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.command.args[payload.command.args.indexOf('--ExecutePreprocessor.timeout') + 1], '90');
  assert.equal(payload.timeoutMs, 200_000);
});

/** Decoys generated per run: only a driver that sent them can put them in a request. */
const DECOYS = {
  SOCRATA_APP_TOKEN: `decoy${randomBytes(6).toString('hex')}`,
  DC_API_KEY: `decoy${randomBytes(6).toString('hex')}`,
};

test('the leak check can fail: it finds a decoy in a body that carries it', () => {
  for (const value of Object.values(DECOYS)) {
    assert.ok(`{"env":{"X":"${value}"}}`.includes(value));
  }
});

test('D5: the portal tokens are never in the invoke, whatever the app environment carries', async () => {
  const { calls, error } = await run(DECOYS);
  assert.equal(error, undefined, `the run failed: ${String(error)}`);
  const raw = calls[0].body + JSON.stringify(calls[0].headers);
  for (const [name, value] of Object.entries(DECOYS)) {
    assert.ok(!raw.includes(value), `the invoke carried the value of ${name}`);
    assert.ok(!(name in JSON.parse(calls[0].body).command.env), `the invoke named ${name}`);
  }
});

// --- the answer ---------------------------------------------------------------

test("nbconvert's failure reaches the route as it does from the other drivers", async () => {
  const { error } = await run({}, [handlerAnswer({ exitCode: 1, stderr: 'Traceback: probe', executed: undefined })]);
  assert.ok(error instanceof NotebookExecutionError, `expected a NotebookExecutionError, got ${String(error)}`);
  const err = error as InstanceType<typeof NotebookExecutionError>;
  assert.equal(err.message, 'jupyter nbconvert failed (exit 1)');
  assert.equal(err.exitCode, 1);
  assert.equal(err.stderr, 'Traceback: probe');
});

test("D2: the handler's refusal of an oversized response names its size", async () => {
  const { error } = await run({}, [
    { body: { protocol: 1, requestId: 'r', refused: 'response-too-large', bytes: 7_000_001, limit: 6_291_456 } },
  ]);
  assert.ok(error instanceof NotebookExecutionError);
  assert.equal((error as Error).name, 'LambdaResponseTooLargeError');
  assert.match((error as Error).message, /7000001 bytes/);
});

test("D2: Lambda's own ResponseSizeTooLarge is the same refusal", async () => {
  const { error } = await run({}, [
    {
      headers: { 'x-amz-function-error': 'Unhandled' },
      body: { errorType: 'Function.ResponseSizeTooLarge', errorMessage: 'Response payload size exceeded' },
    },
  ]);
  assert.equal((error as Error)?.name, 'LambdaResponseTooLargeError');
});

test("a function error is named by its type, and its message is carried nowhere", async () => {
  const marker = `marker${randomBytes(4).toString('hex')}`;
  const { error } = await run({}, [
    { headers: { 'x-amz-function-error': 'Unhandled' }, body: { errorType: 'Runtime.ExitError', errorMessage: marker } },
  ]);
  assert.ok(error instanceof NotebookExecutionError);
  const err = error as Error & { kind?: string; stderr?: string };
  assert.equal(err.name, 'LambdaInvokeError');
  assert.equal(err.kind, 'Runtime.ExitError');
  for (const text of [err.message, err.stack ?? '', err.stderr ?? '', String(err)]) {
    assert.ok(!text.includes(marker), 'the function error message was carried into the error');
  }
});

/** A notebook whose one cell's source is `n` bytes of `A`, which JSON never escapes. */
function paddedNotebook(n: number): Notebook {
  return {
    cells: [{ cell_type: 'markdown', id: 'pad', metadata: {}, source: 'A'.repeat(n) }],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  } as unknown as Notebook;
}

test('D2: a payload of exactly 6 MiB is sent, and one byte more is refused before any request', async () => {
  const LIMIT = 6 * 1024 * 1024;
  const probe = await run({}, [], paddedNotebook(0));
  assert.equal(probe.error, undefined, `the run failed: ${String(probe.error)}`);
  const pad = LIMIT - Buffer.byteLength(probe.calls[0].body);

  const atLimit = await run({}, [], paddedNotebook(pad));
  assert.equal(atLimit.error, undefined, `a payload of exactly ${LIMIT} bytes was refused: ${String(atLimit.error)}`);
  assert.equal(Buffer.byteLength(atLimit.calls[0].body), LIMIT);

  const over = await run({}, [], paddedNotebook(pad + 1));
  assert.ok(over.error instanceof NotebookExecutionError, 'a payload one byte over the limit was not refused');
  assert.match((over.error as Error).message, new RegExp(`${LIMIT + 1} bytes`));
  assert.equal(over.calls.length, 0, 'the oversized payload was sent');
});

// --- settings -----------------------------------------------------------------

/** A run that must be refused before any request, naming `variable`. */
async function assertRefused(vars: Record<string, string | null>, variable: string, alsoNames: string[] = []) {
  const { calls, error } = await run(vars);
  assert.ok(error, `${JSON.stringify(vars)} ran; it must be refused`);
  const err = error as Error & { variable?: string };
  assert.equal(err.name, 'ExecutorSettingError');
  assert.equal(err.variable, variable);
  for (const name of [variable, ...alsoNames]) assert.ok(err.message.includes(name), `the message does not name ${name}`);
  assert.equal(calls.length, 0, 'a request was made before the refusal');
}

test('EXECUTOR_LAMBDA_FUNCTION is required and shaped', async () => {
  await assertRefused({ EXECUTOR_LAMBDA_FUNCTION: null }, 'EXECUTOR_LAMBDA_FUNCTION');
  await assertRefused({ EXECUTOR_LAMBDA_FUNCTION: '  ' }, 'EXECUTOR_LAMBDA_FUNCTION');
  await assertRefused({ EXECUTOR_LAMBDA_FUNCTION: '--help' }, 'EXECUTOR_LAMBDA_FUNCTION');
  // An ARN with a qualifier, its account part built rather than written out.
  const arn = ['arn', 'aws', 'lambda', 'us-east-1', '0'.repeat(12), 'function', 'civic-notebook-executor', 'live'].join(':');
  const { calls, error } = await run({ EXECUTOR_LAMBDA_FUNCTION: arn });
  assert.equal(error, undefined, `an ARN with a qualifier was refused: ${String(error)}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `/2015-03-31/functions/${encodeURIComponent(arn)}/invocations`);
});

test('the region: EXECUTOR_LAMBDA_REGION, else the SDK chain, else a refusal naming both', async () => {
  await assertRefused({ EXECUTOR_LAMBDA_REGION: null }, 'EXECUTOR_LAMBDA_REGION', ['AWS_REGION']);
  await assertRefused({ EXECUTOR_LAMBDA_REGION: 'Not A Region' }, 'EXECUTOR_LAMBDA_REGION');
  const fromChain = await run({ EXECUTOR_LAMBDA_REGION: null, AWS_REGION: 'eu-west-1' });
  assert.equal(fromChain.error, undefined, `the SDK chain's region was not used: ${String(fromChain.error)}`);
  assert.match(String(fromChain.calls[0].headers.authorization), /\/eu-west-1\/lambda\/aws4_request/);
});

test('a failed invoke is made once, not retried: a retry would run the notebook again', async () => {
  const throttled = {
    status: 429,
    headers: { 'x-amzn-errortype': 'TooManyRequestsException' },
    body: { message: 'Rate exceeded' },
  };
  const { calls, error } = await run({}, [throttled, throttled, throttled]);
  assert.equal(calls.length, 1, `the driver made ${calls.length} attempts`);
  assert.equal((error as Error)?.name, 'LambdaInvokeError');
  assert.equal((error as Error & { kind?: string }).kind, 'TooManyRequestsException');
});

test("the caller's signal stops the invoke", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const started = Date.now();
  const { error } = await run({}, [{ ...handlerAnswer(), delayMs: 5_000 }], NOTEBOOK, { signal: controller.signal });
  assert.ok(error instanceof NotebookExecutionError, `the aborted run did not fail: ${String(error)}`);
  assert.ok(Date.now() - started < 3_000, 'the invoke was not stopped by the signal');
});

// --- the transport ------------------------------------------------------------

/** A loopback CONNECT proxy that tunnels to a local origin holding its headers `holdMs`. */
async function slowOriginBehindProxy(holdMs: number) {
  const origin = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    }, holdMs);
  });
  await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
  const seen: string[] = [];
  const proxy = http.createServer((_req, res) => {
    res.writeHead(502);
    res.end();
  });
  proxy.on('connect', (req, client) => {
    seen.push(req.url ?? '');
    const upstream = net.connect((origin.address() as net.AddressInfo).port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  return {
    seen,
    proxyUrl: `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`,
    close: () => {
      proxy.close();
      origin.close();
    },
  };
}

test('with a proxy, the invoke transport carries its own header timeout, not the global one', async () => {
  const { lambdaTransport, invokeWaitMs, INVOKE_GRACE_MS } = await import('./lambda.ts');
  const { HttpRequest } = await import('@smithy/core/protocols');
  assert.equal(invokeWaitMs(180_000), 180_000 + INVOKE_GRACE_MS, 'the wait must cover the session cap');

  const slow = await slowOriginBehindProxy(1_000);
  try {
    const env = { HTTPS_PROXY: slow.proxyUrl, HTTP_PROXY: slow.proxyUrl };
    const request = () =>
      new HttpRequest({
        protocol: 'http:', hostname: 'lambda-probe.invalid', port: 80, method: 'POST', path: '/2015-03-31/functions/f/invocations',
        headers: { host: 'lambda-probe.invalid' }, body: '{}',
      });
    const short = lambdaTransport(300, env).requestHandler;
    assert.ok(short, 'with a proxy configured the client must be given a request handler');
    await assert.rejects(short.handle(request()), 'a 300 ms header timeout let a 1 s header wait through');
    const long = lambdaTransport(5_000, env).requestHandler;
    const { response } = await long!.handle(request());
    assert.equal(response.statusCode, 200);
    assert.ok(slow.seen.every((target) => target.startsWith('lambda-probe.invalid')), 'the proxy was not told the destination');
  } finally {
    slow.close();
  }
  assert.deepEqual(Object.keys(lambdaTransport(5_000, {})), [], 'with no proxy the client must keep the default transport');
});

// --- the lists ---------------------------------------------------------------

test('the names held on the function are the notebook env names and the names the handler adds', async () => {
  const { FUNCTION_HELD_VARIABLES } = await import('./lambda.ts');
  const handlerSource = readFileSync(new URL('../../../docker/executor/lambda/handler.py', import.meta.url), 'utf8');
  const inHandler = /FUNCTION_HELD_VARIABLES = \(([^)]*)\)/.exec(handlerSource)?.[1];
  assert.ok(inHandler, 'handler.py declares no FUNCTION_HELD_VARIABLES tuple');
  assert.deepEqual([...inHandler.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]), [...FUNCTION_HELD_VARIABLES]);

  // The names buildNotebookEnv supplies, read off a run rather than the source.
  let seenEnv: Record<string, string> = {};
  const capturing = {
    name: 'capture',
    async runNotebook(one: { command: { env: Record<string, string> } }) {
      seenEnv = one.command.env;
      return { id: 'x', exitCode: 0, stderr: '', executed: Buffer.from('{"cells":[]}'), pythonVersion: '3.13.0' };
    },
  };
  setEnv(DECOYS);
  try {
    await executeNotebookWith(capturing as never, NOTEBOOK);
  } finally {
    setEnv({ SOCRATA_APP_TOKEN: null, DC_API_KEY: null });
  }
  assert.deepEqual(Object.keys(seenEnv).sort(), [...FUNCTION_HELD_VARIABLES].sort());
});
