// The container executor and the egress-proxy variables (#494, Wave N16 P2).
//
// Every test here drives a WHOLE session through the real container driver
// (`createContainerDriver`), with `child_process.spawn` replaced by a recorder
// through the driver's own `spawn` seam. So what is asserted is the argv and
// the spawn options the driver really hands the `docker` CLI — not a helper
// called on the side. No docker, no network, no proxy.
//
// Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createContainerDriver, resolveContainerImage } from './container.ts';
import type { ContainerDriverDeps, DockerSpawn } from './container.ts';
import { NotebookExecutionError } from './driver.ts';
import { errorClassOf, notebookExecutionErrorMessage } from '../streaming.ts';

const CONTAINER_ID = 'c0ffee000000';

interface SpawnCall {
  command: string;
  args: string[];
  options: Record<string, unknown>;
}

/**
 * A stand-in for `spawn` that records each call and answers like the CLI:
 * `docker run -d` prints a container id, `cat` of the executed notebook
 * prints bytes, everything else exits 0 with no output.
 */
function recordingSpawn(): { calls: SpawnCall[]; spawn: DockerSpawn } {
  const calls: SpawnCall[] = [];
  const spawn: DockerSpawn = (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } as Record<string, unknown> });
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { end: (data?: string) => void };
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      end: () => {
        setImmediate(() => {
          if (args[0] === 'run') child.stdout.emit('data', Buffer.from(`${CONTAINER_ID}\n`));
          if (args.includes('cat') && args.at(-1) === '/tmp/executed.ipynb') {
            child.stdout.emit('data', Buffer.from('{"cells":[]}'));
          }
          child.emit('close', 0);
        });
      },
    };
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  return { calls, spawn };
}

/**
 * One session, shaped as `executeNotebook` shapes it: boot, stage the notebook,
 * run nbconvert with the notebook env, read the result back, ask for the python
 * version, stop.
 */
async function driveSession(deps: ContainerDriverDeps): Promise<void> {
  const driver = createContainerDriver(deps);
  const session = await driver.createSession({ timeoutMs: 60_000, env: { NOTEBOOK_EXTRA: 'one' } });
  await session.writeFiles([{ path: '/tmp/notebook.ipynb', content: '{}' }]);
  await session.runCommand({
    cmd: 'jupyter',
    args: ['nbconvert', '--execute', '/tmp/notebook.ipynb'],
    env: { NOTEBOOK_EXTRA: 'one' },
  });
  await session.readFileToBuffer('/tmp/executed.ipynb');
  await session.runCommand({ cmd: 'python3', args: ['-c', 'print(1)'] });
  await session.stop();
}

/**
 * The spawn options a session passed before #494: stdio pipes and nothing
 * else. Compared by KEY, and the stdio value on its own, so a regression that
 * hands the CLI an environment fails by naming the key, and the failure output
 * never prints the environment of the machine running the suite.
 */
function assertOptionsAsBefore494(call: SpawnCall): void {
  assert.deepEqual(
    Object.keys(call.options),
    ['stdio'],
    `docker ${call.args[0]} was spawned with option keys ${JSON.stringify(Object.keys(call.options))}; ` +
      'with no proxy configured it must receive no env option, so the CLI inherits process.env as before',
  );
  assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe']);
}

/**
 * Every `docker` argv a session with no proxy makes, in order, byte for byte:
 * what it made before #494, with one change #521 made on purpose. The command's
 * own variable passes by name (`-e NOTEBOOK_EXTRA`); before #521 its value was
 * on the command line (`-e NOTEBOOK_EXTRA=one`).
 */
function argvWithNoProxy(): string[][] {
  return [
    ['run', '-d', '--rm', resolveContainerImage(), 'sleep', 'infinity'],
    ['exec', '-i', CONTAINER_ID, 'sh', '-c', `cat > '/tmp/notebook.ipynb'`],
    ['exec', '-e', 'NOTEBOOK_EXTRA', CONTAINER_ID, 'jupyter', 'nbconvert', '--execute', '/tmp/notebook.ipynb'],
    ['exec', CONTAINER_ID, 'cat', '/tmp/executed.ipynb'],
    ['exec', CONTAINER_ID, 'python3', '-c', 'print(1)'],
    ['kill', CONTAINER_ID],
  ];
}

/**
 * The options of a session with no proxy: every invocation as before #494
 * (stdio pipes only), except the nbconvert exec, which since #521 hands the CLI
 * an environment carrying its own variable. With `env: {}` as the session's
 * environment, that is exactly the variable.
 */
function assertOptionsWithNoProxy(calls: SpawnCall[]): void {
  for (const call of calls) {
    if (!call.args.includes('jupyter')) {
      assertOptionsAsBefore494(call);
      continue;
    }
    assert.deepEqual(Object.keys(call.options), ['stdio', 'env'], 'the nbconvert exec must hand the CLI an environment');
    assert.deepEqual(call.options.env, { NOTEBOOK_EXTRA: 'one' });
  }
}

// Criterion 4 (#494): with none of the proxy variables set, the driver's
// `docker` invocations are what they were before — the same argv, and spawn
// options that carry no `env` key, so the CLI inherits `process.env` exactly as
// it did. The fixture's command env is not empty, so an argv builder that
// dropped or reordered the command's variables would fail here too. The one
// difference from before #494 is #521's: the command's variable passes by name.
test('with no proxy variables set, every docker invocation is as before #494, but for #521', async () => {
  const { calls, spawn } = recordingSpawn();
  // An explicit empty environment: the outcome must not depend on whether the
  // machine running the suite happens to have a proxy configured.
  await driveSession({ spawn, env: {} });

  assert.deepEqual(
    calls.map((call) => call.command),
    calls.map(() => 'docker'),
  );
  assert.deepEqual(
    calls.map((call) => call.args),
    argvWithNoProxy(),
  );
  assertOptionsWithNoProxy(calls);
});

// --- Criterion 1 (#494, ruling D3): the notebook container inherits the proxy --

/** The six names, both spellings, that every exec of a proxied session passes. */
const SIX_NAMES = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'];

/** Each `-e NAME` pair in an argv whose operand is a bare name, in order. */
function bareEnvNames(args: string[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === '-e' && !args[i + 1].includes('=')) names.push(args[i + 1]);
  }
  return names;
}

/** Proxy values, and parts of them, that must appear in no argv. */
function assertNoValueInAnyArgv(calls: SpawnCall[], forbidden: string[]): void {
  assert.ok(calls.length > 0, 'no docker call was recorded, so the check below would pass over nothing');
  for (const call of calls) {
    const argv = call.args.join('\u0000');
    for (const part of forbidden) {
      assert.ok(
        !argv.includes(part),
        `docker ${call.args[0]} carried "${part}" on its command line; a proxy value must reach the ` +
          'container through the CLI process environment, never through argv (ps shows argv)',
      );
    }
  }
}

test('a proxied session passes all six names by name on every exec, values in the CLI environment', async () => {
  const env = {
    PATH: '/usr/bin:/bin',
    HTTP_PROXY: 'http://proxy-http.example:3128',
    HTTPS_PROXY: 'http://proxy-https.example:3129',
    NO_PROXY: 'data.internal.example',
  };
  const { calls, spawn } = recordingSpawn();
  await driveSession({ spawn, env });

  const execs = calls.filter((call) => call.args[0] === 'exec');
  assert.equal(execs.length, 4, 'the session shape drives four execs; fewer would leave some unasserted');
  for (const exec of execs) {
    // The nbconvert exec also passes its own variable, by name, after the six (#521).
    assert.deepEqual(
      bareEnvNames(exec.args),
      exec.args.includes('jupyter') ? [...SIX_NAMES, 'NOTEBOOK_EXTRA'] : SIX_NAMES,
      `docker ${exec.args.slice(0, 3).join(' ')}… did not pass the six proxy names by name`,
    );
    assert.ok(
      exec.args.lastIndexOf('-e') < exec.args.indexOf(CONTAINER_ID),
      'every -e flag must precede the container id, or docker hands it to the command instead',
    );
    const spawnEnv = exec.options.env as Record<string, string> | undefined;
    assert.ok(spawnEnv, 'a proxied exec must hand the CLI an environment that carries the values');
    assert.equal(spawnEnv.HTTP_PROXY, 'http://proxy-http.example:3128');
    assert.equal(spawnEnv.http_proxy, 'http://proxy-http.example:3128');
    assert.equal(spawnEnv.HTTPS_PROXY, 'http://proxy-https.example:3129');
    assert.equal(spawnEnv.https_proxy, 'http://proxy-https.example:3129');
    // Composed as resolveProxySettings composes it: loopback first, then the operator's list.
    assert.equal(spawnEnv.NO_PROXY, 'localhost,127.0.0.1,[::1],data.internal.example');
    assert.equal(spawnEnv.no_proxy, 'localhost,127.0.0.1,[::1],data.internal.example');
    // The rest of the environment is inherited, as it was without an env option.
    assert.equal(spawnEnv.PATH, '/usr/bin:/bin');
  }

  // The notebook's own env still reaches nbconvert, by name after the proxy
  // names, with its value in the CLI's environment (#521).
  const nbconvert = execs.find((call) => call.args.includes('jupyter'));
  assert.ok(nbconvert);
  assert.ok(
    nbconvert.args.indexOf('NOTEBOOK_EXTRA') > nbconvert.args.lastIndexOf('no_proxy'),
    'the command env must follow the proxy names',
  );
  assert.equal((nbconvert.options.env as Record<string, string>).NOTEBOOK_EXTRA, 'one');

  assertNoValueInAnyArgv(calls, [
    'proxy-http.example',
    'proxy-https.example',
    '3128',
    '3129',
    'data.internal.example',
  ]);

  // run and kill need nothing from the proxy and are left exactly as they were.
  const expected = argvWithNoProxy();
  assert.deepEqual(calls[0].args, expected[0]);
  assert.deepEqual(calls.at(-1)?.args, expected.at(-1));
  assertOptionsAsBefore494(calls[0]);
  assertOptionsAsBefore494(calls[calls.length - 1]);
});

test('the lower-case spelling wins, and both spellings carry the value that won', async () => {
  const env = {
    HTTP_PROXY: 'http://upper-loses.example:1',
    http_proxy: 'http://lower-wins.example:2',
    HTTPS_PROXY: 'http://upper-loses.example:3',
    https_proxy: 'http://lower-wins.example:4',
    NO_PROXY: 'upper-loses.example',
    no_proxy: 'lower-wins.example',
  };
  const { calls, spawn } = recordingSpawn();
  await driveSession({ spawn, env });

  const spawnEnv = calls.find((call) => call.args[0] === 'exec')?.options.env as Record<string, string>;
  assert.ok(spawnEnv, 'a proxied exec must hand the CLI an environment');
  assert.equal(spawnEnv.HTTP_PROXY, 'http://lower-wins.example:2');
  assert.equal(spawnEnv.http_proxy, 'http://lower-wins.example:2');
  assert.equal(spawnEnv.HTTPS_PROXY, 'http://lower-wins.example:4');
  assert.equal(spawnEnv.https_proxy, 'http://lower-wins.example:4');
  assert.equal(spawnEnv.NO_PROXY, 'localhost,127.0.0.1,[::1],lower-wins.example');
  assert.equal(spawnEnv.no_proxy, 'localhost,127.0.0.1,[::1],lower-wins.example');
  assertNoValueInAnyArgv(calls, ['lower-wins.example', 'upper-loses.example']);
});

test('with only HTTP_PROXY set, https destinations in the container use it, as the app does', async () => {
  // undici's EnvHttpProxyAgent sends https through the http proxy when no
  // https proxy is set; curl and Python do not fall back on their own, so the
  // driver passes the fallback explicitly. With only HTTPS_PROXY set the app
  // sends http:// direct, and the container is told the same (an empty value).
  const first = recordingSpawn();
  await driveSession({ spawn: first.spawn, env: { HTTP_PROXY: 'http://only-http.example:3128' } });
  let spawnEnv = first.calls.find((call) => call.args[0] === 'exec')?.options.env as Record<string, string>;
  assert.ok(spawnEnv, 'a proxied exec must hand the CLI an environment');
  assert.equal(spawnEnv.HTTPS_PROXY, 'http://only-http.example:3128');
  assert.equal(spawnEnv.https_proxy, 'http://only-http.example:3128');
  assert.equal(spawnEnv.NO_PROXY, 'localhost,127.0.0.1,[::1]');

  const second = recordingSpawn();
  await driveSession({ spawn: second.spawn, env: { HTTPS_PROXY: 'http://only-https.example:3129' } });
  spawnEnv = second.calls.find((call) => call.args[0] === 'exec')?.options.env as Record<string, string>;
  assert.ok(spawnEnv, 'a proxied exec must hand the CLI an environment');
  assert.equal(spawnEnv.HTTP_PROXY, '');
  assert.equal(spawnEnv.http_proxy, '');
  assert.equal(spawnEnv.HTTPS_PROXY, 'http://only-https.example:3129');
});

test('NO_PROXY alone configures no proxy, and changes nothing', async () => {
  const { calls, spawn } = recordingSpawn();
  await driveSession({ spawn, env: { NO_PROXY: 'data.internal.example' } });
  assert.deepEqual(calls.map((call) => call.args), argvWithNoProxy());
  for (const call of calls) {
    if (call.args.includes('jupyter')) {
      // The session's environment is spread under the command's variable (#521).
      assert.deepEqual(call.options.env, { NO_PROXY: 'data.internal.example', NOTEBOOK_EXTRA: 'one' });
    } else {
      assertOptionsAsBefore494(call);
    }
  }
});

test("a command's own variable wins over a proxy variable of the same name, as ExecutorCommand promises", async () => {
  const { calls, spawn } = recordingSpawn();
  const driver = createContainerDriver({ spawn, env: { HTTPS_PROXY: 'http://session-proxy.example:3128' } });
  const session = await driver.createSession({ timeoutMs: 60_000, env: {} });
  await session.runCommand({ cmd: 'curl', args: ['-sI', 'https://data.example'], env: { HTTPS_PROXY: 'http://caller.example:1' } });
  await session.stop();

  const exec = calls.find((call) => call.args.includes('curl'));
  assert.ok(exec, 'the exec was not recorded');
  const spawnEnv = exec.options.env as Record<string, string>;
  assert.equal(spawnEnv.HTTPS_PROXY, 'http://caller.example:1', "the command's value must win");
  assert.equal(spawnEnv.https_proxy, 'http://session-proxy.example:3128', 'the other spelling keeps the proxy value');
  assert.equal(bareEnvNames(exec.args).filter((name) => name === 'HTTPS_PROXY').length, 1, 'HTTPS_PROXY is passed once');
  assertNoValueInAnyArgv(calls, ['caller.example', 'session-proxy.example']);
});

// --- Criterion 3 (#494, ruling D9): a credentialed proxy address is refused ---

const PROBE_PARTS = ['probe-user', 'probe-pass', 'proxy-host.example', '3128'];

/** Every part of the probe value that appears in `text`. */
function leakedParts(text: string): string[] {
  return PROBE_PARTS.filter((part) => text.includes(part));
}

test('the leak check can fail: it catches the user, the password, the host and the port', () => {
  for (const part of PROBE_PARTS) {
    assert.deepEqual(leakedParts(`refused: ${part}`), [part], `the check missed "${part}"`);
  }
  assert.deepEqual(leakedParts('http://probe-user:probe-pass@proxy-host.example:3128'), PROBE_PARTS);
});

const CREDENTIALED: Array<{ variable: string; env: Record<string, string> }> = [
  { variable: 'HTTP_PROXY', env: { HTTP_PROXY: 'http://probe-user:probe-pass@proxy-host.example:3128' } },
  { variable: 'https_proxy', env: { https_proxy: 'http://probe-user@proxy-host.example:3128' } },
  {
    variable: 'HTTPS_PROXY',
    env: { HTTP_PROXY: 'http://ok.example:1', HTTPS_PROXY: 'http://:probe-pass@proxy-host.example:3128' },
  },
  // No scheme: `new URL` reads `probe-user:` as the scheme and finds no user,
  // so the check must not rest on URL parsing alone.
  { variable: 'http_proxy', env: { http_proxy: 'probe-user:probe-pass@proxy-host.example:3128' } },
];

for (const { variable, env } of CREDENTIALED) {
  test(`a proxy address with a user or password in ${variable} is refused before any docker call`, async () => {
    const { calls, spawn } = recordingSpawn();
    const driver = createContainerDriver({ spawn, env });

    let caught: unknown;
    try {
      await driver.createSession({ timeoutMs: 60_000, env: {} });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'the session was created; a credentialed proxy address must refuse it');
    assert.equal(calls.length, 0, `docker was called ${calls.length} time(s) before the refusal`);
    assert.ok(caught instanceof NotebookExecutionError, 'the refusal must take the notebook-execution path');
    const err = caught as NotebookExecutionError & { variable?: unknown };
    assert.equal(err.name, 'ContainerProxyUserinfoError');
    assert.equal(err.variable, variable);
    assert.ok(err.message.includes(variable), `the message does not name ${variable}`);

    // What leaves the process: the route's log record and the reader's copy,
    // built exactly as src/app/api/query-notebook/route.ts builds them.
    const correlationId = 'nb-00000000';
    const logRecord = JSON.stringify({ correlationId, exitCode: err.exitCode, errorClass: errorClassOf(err) });
    const readerCopy = notebookExecutionErrorMessage(err.exitCode, correlationId);
    assert.equal(errorClassOf(err), 'ContainerProxyUserinfoError', 'the log must be able to name the refusal');
    for (const [surface, text] of [
      ['message', err.message],
      ['stack', err.stack ?? ''],
      ['stderr', err.stderr ?? ''],
      ['String(err)', String(err)],
      ['log record', logRecord],
      ['reader copy', readerCopy],
    ] as const) {
      assert.deepEqual(leakedParts(text), [], `the ${surface} carries part of the proxy value: ${text}`);
    }
  });
}
