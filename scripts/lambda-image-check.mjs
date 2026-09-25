#!/usr/bin/env node
/**
 * Builds the notebook executor's Lambda image (the `lambda` target of
 * docker/executor/Dockerfile) and checks it under the AWS Lambda Runtime
 * Interface Emulator (#530 P2). CI's `lambda executor image` job runs each step
 * below as its own step; run locally, the same commands do the same thing.
 *
 *   node --experimental-strip-types scripts/lambda-image-check.mjs <step>
 *
 *   build          both targets: the lambda image and the container image the
 *                  parity leg compares against
 *   pins           every pin, the runtime client's among them, is what
 *                  `pip freeze` reports in the lambda image (ruling D4)
 *   handler-tests  docker/executor/lambda/test_handler.py, in the image, as a
 *                  user nothing else runs as; D2's boundary is here
 *   start          the emulator (pinned, checksummed) serving the image, run as
 *                  Lambda runs it: read-only root, writable /tmp, a user of its
 *                  own; the two portal tokens set on the function as decoys
 *   parity         the parity fixture through the container driver and through
 *                  the lambda driver; `executor-parity.mjs compare` must pass
 *                  with only its five masked fields
 *   isolation      ruling D3: what one run leaves, the next run cannot see
 *   secrets        ruling D5: the tokens reach the notebook from the function,
 *                  and the function's log carries no token and no traceback
 *   matplotlib     the read-only root puts no text into a notebook's output
 *   size           ruling D2 end to end: an executed notebook over the limit is
 *                  refused by name, and a large one under it returns
 *   ca             a CA the operator supplies: docs/deploy.md's derived-image
 *                  recipe, built with a throwaway CA, runs a notebook that
 *                  fetches from a TLS origin that CA signed, with requests and
 *                  with urllib. Its own emulators, origin and network, so it
 *                  needs only `build`
 *   stop           removes the emulator containers
 *   all            every step, in order, and exit non-zero if any failed
 *
 * Each observation that could pass by seeing nothing has a control that shows
 * it can see the thing it looks for: a planted leftover the probe finds before
 * a run clears it, a decoy the leak check finds in a line that carries it, the
 * matplotlib warning the probe finds under the image's own cache, the base
 * image failing the CA probe's fetches on the certificate.
 *
 * Credential-free by construction, like every job in ci.yml: the lambda
 * driver reaches the emulator through a client that signs nothing
 * (scripts/lambda-emulator.mjs), the emulator binary comes from its GitHub
 * release and is checked against the SHA-256 below, and the two tokens are
 * decoys generated per run.
 */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD_CONTEXT = 'docker/executor';
/** Throwaway tags, named so no tag-agreement test reads them as the driver's image. */
export const LAMBDA_IMAGE = 'lambda-image-check:local';
export const CONTAINER_IMAGE = 'lambda-image-check-container:local';
const EMULATOR_CONTAINER = 'lambda-image-check-rie';
/** An uncommon port: 9000 is commonly an object store's on a developer machine. */
const EMULATOR_PORT = 19090;
export const EMULATOR_ENDPOINT = `http://127.0.0.1:${EMULATOR_PORT}`;
/** Lambda runs the image as a user of its own; the emulator leg uses one the image does not define. */
const LAMBDA_LIKE_USER = '993:990';

/** The emulator release, pinned, with the digests GitHub publishes for it. */
export const EMULATOR_RELEASE = 'v1.37';
export const EMULATOR_SHA256 = {
  x64: { asset: 'aws-lambda-rie-x86_64', sha256: '6b1e686e62ab2baf5759c412c4864276ef2a88b094fca53ec070637ccba9b9a5' },
  arm64: { asset: 'aws-lambda-rie-arm64', sha256: 'ec2e5d09633d853834c008b1ef264bf834b258a94d551d2b2074966494b39a21' },
};

const STATE_DIR = path.join(tmpdir(), 'lambda-image-check');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

// --- plumbing ----------------------------------------------------------------

function run(cmd, args, { env, quiet = true, input, timeoutMs, onTimeout } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env: env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    // A watchdog, so a hang reads as a failure instead of a job that never ends.
    const watchdog = timeoutMs
      ? setTimeout(() => { onTimeout?.(); child.kill('SIGKILL'); }, timeoutMs)
      : null;
    child.on('close', () => { if (watchdog) clearTimeout(watchdog); });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; if (!quiet) process.stdout.write(d); });
    child.stderr.on('data', (d) => { stderr += d; if (!quiet) process.stderr.write(d); });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: `${stderr}${err.message}` }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

function fail(message) {
  console.log(`::error::${message.split('\n')[0]}`);
  console.error(message);
  return false;
}

function ok(message) {
  console.log(`OK — ${message}`);
  return true;
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function loadTables() {
  const { PINNED_LIBRARIES, PYTHON_RUNTIME_VERSION } = await import('../src/lib/notebook-author/prompt.ts');
  const { EXECUTOR_TOOLING_PACKAGES, EXECUTOR_LAMBDA_RUNTIME_PACKAGES } = await import('../src/lib/sandbox/driver.ts');
  return { PINNED_LIBRARIES, PYTHON_RUNTIME_VERSION, EXECUTOR_TOOLING_PACKAGES, EXECUTOR_LAMBDA_RUNTIME_PACKAGES };
}

/** `docker run --rm` of the lambda image with its entrypoint replaced. */
function inLambdaImage(args, extra = []) {
  return run('docker', ['run', '--rm', ...extra, '--entrypoint', args[0], LAMBDA_IMAGE, ...args.slice(1)]);
}

/** A notebook of code cells, each a string of source. */
function notebookOf(...sources) {
  return {
    cells: sources.map((source, i) => ({
      cell_type: 'code', execution_count: null, id: `c${i}`, metadata: {}, outputs: [], source,
    })),
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/** Run `notebook` through the lambda driver on the emulator. Returns { result } or { error }. */
async function throughLambda(notebook, env = process.env) {
  const { executeNotebookWith } = await import('../src/lib/sandbox/execute.ts');
  const { emulatorLambdaDriver } = await import('./lambda-emulator.mjs');
  const driver = await emulatorLambdaDriver(EMULATOR_ENDPOINT, env);
  try {
    return { result: await executeNotebookWith(driver, notebook) };
  } catch (error) {
    return { error };
  }
}

/** Every stream output of an executed notebook, by name. */
function streams(notebook, name) {
  return notebook.cells.flatMap((cell) =>
    (cell.outputs ?? []).filter((o) => o.name === name).map((o) => [].concat(o.text).join('')),
  );
}

// --- steps -------------------------------------------------------------------

async function stepBuild() {
  for (const [target, tag] of [['lambda', LAMBDA_IMAGE], ['container', CONTAINER_IMAGE]]) {
    const started = Date.now();
    const result = await run('docker', ['build', '--progress=plain', '--target', target, '-t', tag, BUILD_CONTEXT], { quiet: false });
    if (result.code !== 0) return fail(`the ${target} target did not build (exit ${result.code}); see the build output above`);
    ok(`${tag} (target ${target}) built in ${Math.round((Date.now() - started) / 1000)}s`);
  }
  return true;
}

async function stepPins() {
  const { PINNED_LIBRARIES, PYTHON_RUNTIME_VERSION, EXECUTOR_TOOLING_PACKAGES, EXECUTOR_LAMBDA_RUNTIME_PACKAGES } = await loadTables();
  const { parseFreeze, comparePins } = await import('./executor-image-check.mjs');
  const expected = [
    ...Object.entries(PINNED_LIBRARIES).map(([name, version]) => ({ name, version, source: 'PINNED_LIBRARIES' })),
    ...Object.entries(EXECUTOR_TOOLING_PACKAGES).map(([name, version]) => ({ name, version, source: 'EXECUTOR_TOOLING_PACKAGES' })),
    ...Object.entries(EXECUTOR_LAMBDA_RUNTIME_PACKAGES).map(([name, version]) => ({ name, version, source: 'EXECUTOR_LAMBDA_RUNTIME_PACKAGES' })),
  ];
  const freeze = await inLambdaImage(['pip', 'freeze']);
  if (freeze.code !== 0) return fail(`\`pip freeze\` exited ${freeze.code} in ${LAMBDA_IMAGE}:\n${freeze.stderr}`);
  const problems = comparePins(expected, parseFreeze(freeze.stdout));
  if (problems.length > 0) {
    return fail(`PIN MISMATCH in ${LAMBDA_IMAGE} — ${problems.length} of ${expected.length}:\n  ${problems.join('\n  ')}`);
  }
  const check = await inLambdaImage(['pip', 'check']);
  if (check.code !== 0) return fail(`DOES NOT CO-INSTALL — \`pip check\` in ${LAMBDA_IMAGE}:\n${(check.stdout + check.stderr).trim()}`);
  const py = await inLambdaImage(['python', '-c', 'import sys, awslambdaric; print("%d.%d" % sys.version_info[:2])']);
  if (py.code !== 0 || py.stdout.trim() !== PYTHON_RUNTIME_VERSION) {
    return fail(`PYTHON MISMATCH — expected ${PYTHON_RUNTIME_VERSION}, ${LAMBDA_IMAGE} runs ${py.stdout.trim() || `nothing (exit ${py.code})`}`);
  }
  return ok(`all ${expected.length} pins are what pip freeze reports in ${LAMBDA_IMAGE}, pip check is clean, python ${PYTHON_RUNTIME_VERSION}`);
}

async function stepHandlerTests() {
  const name = `lambda-handler-tests-${randomBytes(3).toString('hex')}`;
  const result = await run('docker', [
    'run', '--rm', '--name', name, '--read-only', '--tmpfs', '/tmp:exec,mode=1777', '--user', LAMBDA_LIKE_USER,
    '-e', 'LAMBDA_HANDLER_TEST_SANDBOX=1',
    '-v', `${path.join(REPO_ROOT, BUILD_CONTEXT, 'lambda')}:/src:ro`,
    '--entrypoint', 'python', LAMBDA_IMAGE, '-m', 'unittest', 'discover', '-s', '/src', '-p', 'test_*.py', '-v',
  ], { timeoutMs: 180_000, onTimeout: () => { void run('docker', ['rm', '-f', name]); } });
  const out = `${result.stdout}${result.stderr}`;
  const ran = Number(/^Ran (\d+) tests?/m.exec(out)?.[1] ?? 0);
  if (result.code !== 0 || !/^OK\b/m.test(out)) return fail(`HANDLER TESTS FAILED (exit ${result.code}):\n${out.trim()}`);
  if (/skipped/i.test(out)) return fail(`handler tests were skipped, so they read nothing:\n${out.trim()}`);
  if (ran < 10) return fail(`only ${ran} handler tests ran; the suite has more, so discovery missed some`);
  return ok(`${ran} handler tests passed in ${LAMBDA_IMAGE}, none skipped`);
}

/** The emulator binary for this machine, downloaded once and checked against its pinned digest. */
async function emulatorBinary() {
  const pin = EMULATOR_SHA256[process.arch];
  if (!pin) throw new Error(`no pinned emulator for architecture ${process.arch}`);
  mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `${pin.asset}-${EMULATOR_RELEASE}`);
  if (!existsSync(file)) {
    const url = `https://github.com/aws/aws-lambda-runtime-interface-emulator/releases/download/${EMULATOR_RELEASE}/${pin.asset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`the emulator download answered ${res.status} (${url})`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (digest !== pin.sha256) throw new Error(`the emulator binary's SHA-256 is ${digest}, not the pinned ${pin.sha256}`);
  chmodSync(file, 0o755);
  return file;
}

async function stepStart() {
  await run('docker', ['rm', '-f', EMULATOR_CONTAINER]);
  const binary = await emulatorBinary();
  const decoys = {
    SOCRATA_APP_TOKEN: `decoy${randomBytes(8).toString('hex')}`,
    DC_API_KEY: `decoy${randomBytes(8).toString('hex')}`,
  };
  const started = await run(
    'docker',
    [
      'run', '-d', '--name', EMULATOR_CONTAINER,
      '--read-only', '--tmpfs', '/tmp:exec,mode=1777', '--user', LAMBDA_LIKE_USER,
      '-p', `127.0.0.1:${EMULATOR_PORT}:8080`,
      '-v', `${binary}:/aws-lambda-rie:ro`,
      // Set on the function, as ruling D5 sets them: by name, values from this process's environment.
      '-e', 'SOCRATA_APP_TOKEN', '-e', 'DC_API_KEY',
      '-e', 'AWS_LAMBDA_FUNCTION_TIMEOUT=300',
      '--entrypoint', '/aws-lambda-rie', LAMBDA_IMAGE, 'python', '-m', 'awslambdaric', 'handler.handler',
    ],
    { env: { ...process.env, ...decoys } },
  );
  if (started.code !== 0) return fail(`the emulator did not start (exit ${started.code}):\n${started.stderr}`);
  writeFileSync(STATE_FILE, JSON.stringify({ decoys }));

  // Ready when it answers an invoke; a protocol it does not speak is refused as data.
  const { invokeEmulator } = await import('./lambda-emulator.mjs');
  for (let i = 0; i < 60; i += 1) {
    try {
      const { body } = await invokeEmulator(EMULATOR_ENDPOINT, { protocol: 0 });
      if (JSON.parse(body).refused === 'protocol') {
        return ok(`the emulator ${EMULATOR_RELEASE} serves ${LAMBDA_IMAGE} read-only as ${LAMBDA_LIKE_USER} at ${EMULATOR_ENDPOINT}`);
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const logs = await run('docker', ['logs', EMULATOR_CONTAINER]);
  return fail(`the emulator never answered an invoke:\n${logs.stdout}${logs.stderr}`);
}

async function stepParity() {
  const outDir = path.join(STATE_DIR, 'parity');
  mkdirSync(outDir, { recursive: true });
  const env = { ...process.env, EXECUTOR_CONTAINER_IMAGE: CONTAINER_IMAGE };
  delete env.SOCRATA_APP_TOKEN;
  delete env.DC_API_KEY;
  const legs = [
    ['container', ['--driver', 'container']],
    ['lambda', ['--driver', 'lambda', '--lambda-endpoint', EMULATOR_ENDPOINT]],
  ];
  for (const [leg, args] of legs) {
    const result = await run(
      process.execPath,
      ['--experimental-strip-types', 'scripts/executor-parity.mjs', 'run', ...args, '--out', path.join(outDir, `${leg}.json`)],
      { env, quiet: false },
    );
    if (result.code !== 0) return fail(`the ${leg} leg of the parity notebook failed (exit ${result.code})`);
  }
  const compare = await run(
    process.execPath,
    ['--experimental-strip-types', 'scripts/executor-parity.mjs', 'compare', path.join(outDir, 'container.json'), path.join(outDir, 'lambda.json')],
    { quiet: false },
  );
  if (compare.code !== 0) return fail('PARITY FAIL — the lambda leg differs from the container leg outside the five masked fields');
  const lambda = JSON.parse(readFileSync(path.join(outDir, 'lambda.json'), 'utf8'));
  const { PINNED_LIBRARIES } = await loadTables();
  if (JSON.stringify(lambda.libraries) !== JSON.stringify(PINNED_LIBRARIES)) {
    return fail(`the lambda leg's environment.libraries is ${JSON.stringify(lambda.libraries)}, not the pin table`);
  }
  return ok('the parity notebook is identical through the container and lambda drivers, with only the five fields masked');
}

/** A notebook cell that reports what it can see: /tmp, and live processes carrying `marker`. */
function observerSource(marker) {
  return [
    'import json, os',
    'me = os.getuid()',
    'live = []',
    "for p in os.listdir('/proc'):",
    '    if not p.isdigit():',
    '        continue',
    '    try:',
    "        if os.stat(f'/proc/{p}').st_uid != me:",
    '            continue',
    "        state = open(f'/proc/{p}/stat', 'rb').read().rsplit(b')', 1)[1].split()[0]",
    "        cmd = open(f'/proc/{p}/cmdline', 'rb').read().replace(b'\\0', b' ').decode()",
    "        if state != b'Z':",
    '            live.append(cmd)',
    '    except OSError:',
    '        pass',
    `print(json.dumps({'run': ${JSON.stringify(marker)}, 'tmp': sorted(os.listdir('/tmp')), 'leftovers': [c for c in live if 'LEFTOVER' in c]}))`,
  ].join('\n');
}

function observed(result) {
  return JSON.parse(streams(result.notebook, 'stdout').join('').trim().split('\n').at(-1));
}

async function containerSees(marker) {
  const ps = await run('docker', ['exec', EMULATOR_CONTAINER, 'sh', '-c', `ls /tmp; for c in /proc/[0-9]*/cmdline; do tr '\\0' ' ' < "$c"; echo; done`]);
  return ps.stdout.split('\n').filter((line) => line.includes(marker));
}

async function stepIsolation() {
  const id = randomBytes(4).toString('hex');
  const LEFT = `LEFTOVER-${id}`;

  // CONTROL: plant a file and a detached process in the function's container,
  // as its user, and show the probe of the container sees both.
  // The marker rides in the shell's own command line: `sleep` would refuse an
  // extra argument and exit at once, leaving nothing planted.
  await run('docker', ['exec', '-d', EMULATOR_CONTAINER, 'setsid', 'sh', '-c', `touch /tmp/${LEFT}-planted; sleep 600; : ${LEFT}-planted`]);
  await new Promise((r) => setTimeout(r, 500));
  const planted = await containerSees(`${LEFT}-planted`);
  if (planted.length < 2) return fail(`the control could not plant a leftover in the container (saw ${JSON.stringify(planted)}); the probe proves nothing`);
  const afterPlant = await throughLambda(notebookOf(observerSource(`clean-${id}`)));
  if (afterPlant.error) return fail(`the run after the plant failed: ${afterPlant.error.message}`);
  const seenAfterPlant = observed(afterPlant.result);
  if (seenAfterPlant.leftovers.length || seenAfterPlant.tmp.some((n) => n.includes(LEFT))) {
    return fail(`the run saw what was planted before it: ${JSON.stringify(seenAfterPlant)}`);
  }

  // RUN 1 leaves a file, a detached process, and a process that waits, then
  // asks the Runtime API for the next event and answers it. The wait is the
  // point: it wakes after run 1 has returned, when the next event it could
  // take is run 2's. That is the cross-run threat ruling D3's sweep closes. A
  // caller that asks at once takes run 1's own event instead, which is D3's
  // accepted residual (a run can replace its own response); measured under
  // the emulator, that also leaves the emulator unable to serve the next
  // invoke, so it is not driven here.
  const nextCaller = [
    'import sys, time, urllib.request',
    "api = '127.0.0.1:9001'",
    'time.sleep(8)',
    'while True:',
    '    try:',
    "        r = urllib.request.urlopen(f'http://{api}/2018-06-01/runtime/invocation/next', timeout=600)",
    "        rid = r.headers['Lambda-Runtime-Aws-Request-Id']",
    "        urllib.request.urlopen(urllib.request.Request(f'http://{api}/2018-06-01/runtime/invocation/{rid}/response', data=b'\"FORGED\"', method='POST'))",
    '    except Exception:',
    '        time.sleep(0.2)',
  ].join('\n');
  const leaver = notebookOf(
    [
      'import subprocess, sys',
      `open('/tmp/${LEFT}.txt', 'w').write('left behind')`,
      `subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)', '${LEFT}-sleeper'], start_new_session=True)`,
      `subprocess.Popen([sys.executable, '-c', ${JSON.stringify(nextCaller)}, '${LEFT}-next-caller'], start_new_session=True)`,
      "print('left three things')",
    ].join('\n'),
  );
  const run1 = await throughLambda(leaver);
  // Residual, by ruling D3: during its own run, a leftover may replace that run's response.
  if (run1.error) return fail(`run 1 failed: ${run1.error.name}: ${run1.error.message}`);
  const left = await containerSees(LEFT);
  if (left.some((line) => !line.includes('-planted'))) {
    return fail(`after run 1 returned, the container still holds what it left: ${JSON.stringify(left)}`);
  }

  // RUN 2 must see none of it, and must get its own response. RUN 3, issued
  // after the caller would have woken, must get its own too.
  for (const [label, wait] of [['run 2', 0], ['run 3', 9_000]]) {
    await new Promise((r) => setTimeout(r, wait));
    const next = await throughLambda(notebookOf(observerSource(`${label}-${id}`)));
    if (next.error) return fail(`${label} failed, so it did not get its own response: ${next.error.name}: ${next.error.message}`);
    const seen = observed(next.result);
    if (seen.run !== `${label}-${id}`) return fail(`${label} received another run's response: ${JSON.stringify(seen)}`);
    if (seen.leftovers.length || seen.tmp.some((n) => n.includes(LEFT))) {
      return fail(`${label} saw what run 1 left: ${JSON.stringify(seen)}`);
    }
  }
  return ok(
    "a planted file and process (seen by the control), and run 1's file, detached process and delayed /next caller, " +
      'were gone before the next run; runs 2 and 3, the second after the caller would have woken, each got its own response',
  );
}

/** Every line of the function's log, read through a marker so the read is known to be complete. */
async function functionLog() {
  const marker = `log-marker-${randomBytes(4).toString('hex')}`;
  await run('docker', ['exec', EMULATOR_CONTAINER, 'sh', '-c', `echo ${marker} > /proc/1/fd/1`]);
  for (let i = 0; i < 40; i += 1) {
    const logs = await run('docker', ['logs', EMULATOR_CONTAINER]);
    const text = `${logs.stdout}${logs.stderr}`;
    if (text.includes(marker)) return text.slice(0, text.indexOf(marker));
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the function log never showed the marker, so it cannot be read");
}

async function stepSecrets() {
  const state = readState();
  if (!state) return fail('no emulator state; run the start step first');
  const traceMarker = `trace${randomBytes(6).toString('hex')}`;
  const leaks = (text) => [...Object.values(state.decoys), traceMarker].filter((value) => text.includes(value));
  if (leaks(`x ${state.decoys.SOCRATA_APP_TOKEN} ${state.decoys.DC_API_KEY} ${traceMarker}`).length !== 3) {
    return fail('the leak check cannot see what it looks for');
  }

  const sha = (value) => createHash('sha256').update(value).digest('hex');
  const reporter = notebookOf(
    "import hashlib, os\nfor n in ('SOCRATA_APP_TOKEN', 'DC_API_KEY'):\n    print(n, hashlib.sha256(os.environ.get(n, '').encode()).hexdigest())",
  );
  const reported = await throughLambda(reporter);
  if (reported.error) return fail(`the token-reporting run failed: ${reported.error.message}`);
  const lines = streams(reported.result.notebook, 'stdout').join('');
  for (const [name, value] of Object.entries(state.decoys)) {
    if (!lines.includes(`${name} ${sha(value)}`)) return fail(`the notebook did not receive ${name} from the function's environment`);
  }

  const failing = await throughLambda(notebookOf(`raise ValueError(${JSON.stringify(traceMarker)})`));
  if (!failing.error || !String(failing.error.stderr ?? '').includes(traceMarker)) {
    return fail('the failing notebook did not fail with its traceback returned to the driver');
  }
  const found = leaks(await functionLog());
  if (found.length) return fail(`the function's log carries ${found.length} of the decoy tokens and the traceback marker`);
  return ok("the tokens reached the notebook from the function's environment; the function's log carries neither token nor traceback");
}

const MATPLOTLIB_PROBE = [
  'import logging',
  'logging.basicConfig(level=logging.INFO)',
  'import matplotlib',
  "matplotlib.use('Agg')",
  'import matplotlib.pyplot',
].join('\n');

async function stepMatplotlib() {
  // CONTROL: the same import in the same image and posture, without the
  // handler's cache, prints the warning the probe looks for.
  const control = await inLambdaImage(['python', '-c', MATPLOTLIB_PROBE], ['--read-only', '--tmpfs', '/tmp:exec,mode=1777', '--user', LAMBDA_LIKE_USER]);
  if (!/temporary cache directory/.test(control.stderr)) {
    return fail(`the control did not show matplotlib's warning under the image's own cache, so the probe proves nothing:\n${control.stderr}`);
  }
  const probed = await throughLambda(notebookOf(MATPLOTLIB_PROBE));
  if (probed.error) return fail(`the matplotlib probe failed: ${probed.error.message}`);
  const stderr = streams(probed.result.notebook, 'stderr');
  if (stderr.length) return fail(`a notebook importing matplotlib gained ${stderr.length} stderr output(s): ${JSON.stringify(stderr)}`);
  return ok('a notebook importing matplotlib at INFO gains no output under the read-only root (the control shows the warning without the seeded cache)');
}

async function stepSize() {
  const big = await throughLambda(notebookOf(`print('A' * ${7 * 1024 * 1024})`));
  if (!big.error || big.error.name !== 'LambdaResponseTooLargeError') {
    return fail(`an executed notebook over 6 MiB was not refused by name: ${big.error ? big.error.name : 'it returned'}`);
  }
  const large = await throughLambda(notebookOf(`print('A' * ${2 * 1024 * 1024})`));
  if (large.error) return fail(`an executed notebook of about 2 MiB, under the limit, failed: ${large.error.name}`);
  return ok(`over the limit: ${big.error.message}; about 2 MiB under it returned whole`);
}

// --- ca: a CA the operator supplies ------------------------------------------

/** The `ca` step's own containers, network and image; `stop` removes them too. */
const CA_NETWORK = 'lambda-image-check-ca';
const CA_ORIGIN_CONTAINER = 'lambda-image-check-ca-origin';
const CA_ORIGIN_HOST = 'origin.ca-check.test';
const CA_DERIVED_IMAGE = 'lambda-image-check-ca:local';
const CA_EMULATORS = {
  derived: { container: 'lambda-image-check-rie-ca', port: 19091 },
  control: { container: 'lambda-image-check-rie-ca-control', port: 19092 },
};
/** Where docs/deploy.md keeps the derived-image recipe this step builds. */
const CA_RECIPE_MARKER = '<!-- lambda-image-check: ca recipe -->';

/**
 * The derived-image recipe exactly as docs/deploy.md gives it, with its FROM
 * line pointed at the image this job built. Building the documented recipe,
 * not a copy of it, is what keeps the page and this check the same claim.
 */
function caRecipe() {
  const doc = readFileSync(path.join(REPO_ROOT, 'docs/deploy.md'), 'utf8');
  const at = doc.indexOf(CA_RECIPE_MARKER);
  if (at < 0) throw new Error(`docs/deploy.md has no ${CA_RECIPE_MARKER} block`);
  const block = /```dockerfile\n([\s\S]*?)\n[ \t]*```/.exec(doc.slice(at));
  if (!block) throw new Error(`no dockerfile block follows ${CA_RECIPE_MARKER} in docs/deploy.md`);
  // The block sits in a list item, so every line carries the item's indent.
  const indented = block[1].split('\n');
  const indent = Math.min(...indented.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length));
  const lines = indented.map((l) => l.slice(indent));
  const from = lines.findIndex((l) => /^FROM\s/.test(l));
  if (from < 0) throw new Error('the documented recipe has no FROM line');
  lines[from] = `FROM ${LAMBDA_IMAGE}`;
  return lines.join('\n');
}

/** A TLS origin that answers every GET with ORIGIN_BODY. */
const ORIGIN_BODY = 'ca-check-origin-ok';
const ORIGIN_SERVER = `
import http.server, ssl
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = ${JSON.stringify(ORIGIN_BODY)}.encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
server = http.server.ThreadingHTTPServer(('0.0.0.0', 8443), H)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain('/work/origin.crt', '/work/origin.key')
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
`;

/** Fetches the origin with both libraries a notebook reaches for, and says how each went. */
const CA_PROBE = `
import os, urllib.request, requests
url = 'https://${CA_ORIGIN_HOST}:8443/'
try:
    print('requests', requests.get(url, timeout=20).text)
except Exception as e:
    print('requests-failed', type(e).__name__, 'CERTIFICATE_VERIFY_FAILED' in str(e))
try:
    print('urllib', urllib.request.urlopen(url, timeout=20).read().decode())
except Exception as e:
    print('urllib-failed', type(e).__name__, 'CERTIFICATE_VERIFY_FAILED' in str(e))
`.trim();

/** A throwaway CA, and a certificate for the origin it signs, made with the image's own openssl. */
async function makeCertificates(dir) {
  const script = [
    'set -e',
    'cd /work',
    'openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout ca.key -out proxy-ca.crt -subj "/CN=lambda-image-check throwaway CA"'
      + ' -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"',
    `openssl req -newkey rsa:2048 -nodes -keyout origin.key -out origin.csr -subj "/CN=${CA_ORIGIN_HOST}"`,
    `printf '%s\\n' "subjectAltName=DNS:${CA_ORIGIN_HOST}" "basicConstraints=critical,CA:FALSE" "keyUsage=critical,digitalSignature,keyEncipherment" "extendedKeyUsage=serverAuth" "authorityKeyIdentifier=keyid" "subjectKeyIdentifier=hash" > origin.ext`,
    'openssl x509 -req -in origin.csr -CA proxy-ca.crt -CAkey ca.key -CAcreateserial -days 1 -extfile origin.ext -out origin.crt',
    'chmod 644 /work/*',
  ].join('\n');
  return run('docker', ['run', '--rm', '--user', '0', '-v', `${dir}:/work`, '--entrypoint', 'sh', LAMBDA_IMAGE, '-c', script]);
}

async function startCaEmulator({ container, port }, image, binary) {
  await run('docker', ['rm', '-f', container]);
  const started = await run('docker', [
    'run', '-d', '--name', container, '--network', CA_NETWORK,
    '--read-only', '--tmpfs', '/tmp:exec,mode=1777', '--user', LAMBDA_LIKE_USER,
    '-p', `127.0.0.1:${port}:8080`,
    '-v', `${binary}:/aws-lambda-rie:ro`,
    '-e', 'AWS_LAMBDA_FUNCTION_TIMEOUT=300',
    '--entrypoint', '/aws-lambda-rie', image, 'python', '-m', 'awslambdaric', 'handler.handler',
  ]);
  if (started.code !== 0) throw new Error(`the emulator for ${image} did not start (exit ${started.code}):\n${started.stderr}`);
  const endpoint = `http://127.0.0.1:${port}`;
  const { invokeEmulator } = await import('./lambda-emulator.mjs');
  for (let i = 0; i < 60; i += 1) {
    try {
      const { body } = await invokeEmulator(endpoint, { protocol: 0 });
      if (JSON.parse(body).refused === 'protocol') return endpoint;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the emulator for ${image} never answered at ${endpoint}`);
}

async function removeCaResources() {
  await run('docker', ['rm', '-f', CA_EMULATORS.derived.container, CA_EMULATORS.control.container, CA_ORIGIN_CONTAINER]);
  await run('docker', ['network', 'rm', CA_NETWORK]);
}

async function stepCa() {
  const dir = mkdtempSync(path.join(tmpdir(), 'lambda-image-check-ca-'));
  chmodSync(dir, 0o777);
  try {
    await removeCaResources();
    const made = await makeCertificates(dir);
    if (made.code !== 0) return fail(`the throwaway CA could not be made (exit ${made.code}):\n${made.stderr}`);

    // The documented recipe, built with the throwaway CA as the operator's.
    writeFileSync(path.join(dir, 'Dockerfile'), caRecipe());
    const built = await run('docker', ['build', '-t', CA_DERIVED_IMAGE, dir]);
    if (built.code !== 0) return fail(`the documented derived image did not build (exit ${built.code}):\n${built.stderr}`);

    const net = await run('docker', ['network', 'create', CA_NETWORK]);
    if (net.code !== 0) return fail(`the check's network could not be created:\n${net.stderr}`);
    const origin = await run('docker', [
      'run', '-d', '--name', CA_ORIGIN_CONTAINER, '--network', CA_NETWORK, '--network-alias', CA_ORIGIN_HOST,
      '--user', '0', '-v', `${dir}:/work:ro`, '--entrypoint', 'python', LAMBDA_IMAGE, '-c', ORIGIN_SERVER,
    ]);
    if (origin.code !== 0) return fail(`the TLS origin did not start:\n${origin.stderr}`);

    const binary = await emulatorBinary();
    const outcomes = {};
    for (const [leg, image] of [['derived', CA_DERIVED_IMAGE], ['control', LAMBDA_IMAGE]]) {
      const endpoint = await startCaEmulator(CA_EMULATORS[leg], image, binary);
      const { executeNotebookWith } = await import('../src/lib/sandbox/execute.ts');
      const { emulatorLambdaDriver } = await import('./lambda-emulator.mjs');
      const executed = await executeNotebookWith(await emulatorLambdaDriver(endpoint), notebookOf(CA_PROBE));
      outcomes[leg] = streams(executed.notebook, 'stdout').join('');
    }

    // CONTROL: the base image, on the same network, fails both fetches on the
    // certificate, so the origin is reachable and the check can see a failure.
    for (const lib of ['requests', 'urllib']) {
      if (!new RegExp(`^${lib}-failed \\S+ True$`, 'm').test(outcomes.control)) {
        return fail(`the control did not fail ${lib}'s fetch on the certificate, so the check proves nothing:\n${outcomes.control}`);
      }
    }
    for (const lib of ['requests', 'urllib']) {
      if (!new RegExp(`^${lib} ${ORIGIN_BODY}$`, 'm').test(outcomes.derived)) {
        return fail(`a notebook on the documented derived image could not fetch with ${lib} from an origin its CA signed:\n${outcomes.derived}`);
      }
    }
    return ok('a notebook on the documented derived image trusts the operator\'s CA with requests and urllib; the base image fails both on the certificate');
  } catch (err) {
    return fail(`the ca step failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    await removeCaResources();
    await run('docker', ['rmi', '-f', CA_DERIVED_IMAGE]);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function stepStop() {
  await run('docker', ['rm', '-f', EMULATOR_CONTAINER]);
  await removeCaResources();
  return ok('the emulator containers are removed');
}

const STEPS = {
  build: stepBuild,
  pins: stepPins,
  'handler-tests': stepHandlerTests,
  start: stepStart,
  parity: stepParity,
  isolation: stepIsolation,
  secrets: stepSecrets,
  matplotlib: stepMatplotlib,
  size: stepSize,
  ca: stepCa,
  stop: stepStop,
};

async function main() {
  const step = process.argv[2];
  if (step === 'all') {
    let passed = true;
    for (const name of Object.keys(STEPS)) {
      console.log(`\n== ${name}`);
      passed = (await STEPS[name]()) && passed;
    }
    process.exit(passed ? 0 : 1);
  }
  if (!STEPS[step]) {
    console.error(`usage: lambda-image-check.mjs <${[...Object.keys(STEPS), 'all'].join('|')}>`);
    process.exit(2);
  }
  process.exit((await STEPS[step]()) ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.log(`::error::lambda-image-check crashed: ${err instanceof Error ? err.message : err}`);
    console.error(err);
    process.exit(1);
  });
}
