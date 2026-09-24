// The executor's settings (#530 P1, rulings D7 and D8).
//
// Every test here drives the REAL path: `executeNotebook` with
// EXECUTOR_DRIVER=container, which spawns the container CLI by name. The CLI
// it finds is a recording fake written into a temporary directory at the
// front of PATH, so what is asserted is the argv the driver really hands the
// CLI, and the environment the CLI really carries — no docker, no network.
//
// What each group can fail on:
//   - THE PIN. At the defaults, the invocation list is today's, byte for byte.
//     A setting that leaked a flag at its default, or reordered the argv,
//     fails here.
//   - EACH SETTING, DRIVEN. Each of the two timeouts and eight container
//     settings, set away from its default, changes exactly what it names.
//   - THE GUARDS. A session cap not above the per-cell limit, a value that is
//     not a whole number, and a container value that could be read as another
//     argument are refused before any CLI call.
//   - #521. With the two notebook tokens set, no argv carries either value, and
//     the container still receives each under its own name.
//   - THE CONTRACT ROWS. Each setting has an ENV_SPEC row and a compose entry,
//     and every EXECUTOR_* row is described in docs/deploy.md.
//
// Run with: npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Notebook } from '../notebook-author/cells.ts';
import { ENV_SPEC } from '../../../scripts/preflight-env.mjs';
import { parseComposeService } from '../../../scripts/check-compose-env.mjs';

const CONTAINER_ID = 'fakecontainer01';

/** The settings ruled at G0 (D7): two for every driver, eight for the container. */
const SETTINGS = [
  'EXECUTOR_SESSION_TIMEOUT_S',
  'EXECUTOR_CELL_TIMEOUT_S',
  'EXECUTOR_CONTAINER_CLI',
  'EXECUTOR_CONTAINER_MEMORY',
  'EXECUTOR_CONTAINER_CPUS',
  'EXECUTOR_CONTAINER_PIDS_LIMIT',
  'EXECUTOR_CONTAINER_NETWORK',
  'EXECUTOR_CONTAINER_USER',
  'EXECUTOR_CONTAINER_RUNTIME',
  'EXECUTOR_CONTAINER_HARDENED',
] as const;

/** Variables the outcome must not depend on, cleared for the whole file. */
const CLEARED = [
  ...SETTINGS,
  'EXECUTOR_CONTAINER_IMAGE',
  'SOCRATA_APP_TOKEN',
  'DC_API_KEY',
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
  'FAKE_CLI_SLOW',
];

const dir = mkdtempSync(join(tmpdir(), 'executor-settings-'));
const LOG = join(dir, 'calls.jsonl');
const PIDFILE = join(dir, 'inflight.pid');

/**
 * The fake CLI. It records its own name, its argv, and, for every bare
 * `-e NAME`, the value its own environment carries under that name — which is
 * the value a real CLI hands the container. `run` prints a container id; `cat`
 * prints an executed notebook; `python3` prints a version; the nbconvert exec
 * exits 0, or with FAKE_CLI_SLOW=1 waits 8 s with its pid on file, so `kill`
 * can end it the way a killed container ends an in-flight exec.
 */
const FAKE_CLI = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const byName = {};
for (let i = 0; i < args.length - 1; i += 1) {
  if (args[i] === '-e' && !args[i + 1].includes('=')) byName[args[i + 1]] = process.env[args[i + 1]] ?? null;
}
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ bin: path.basename(process.argv[1]), args, byName }) + '\\n');
if (args[0] === 'run') { process.stdout.write(${JSON.stringify(`${CONTAINER_ID}\n`)}); process.exit(0); }
if (args[0] === 'kill') {
  try { process.kill(Number(fs.readFileSync(${JSON.stringify(PIDFILE)}, 'utf8')), 'SIGKILL'); } catch {}
  process.exit(0);
}
let i = 1;
while (i < args.length && (args[i] === '-i' || args[i] === '-e')) i += args[i] === '-i' ? 1 : 2;
const cmd = args.slice(i + 1);
if (cmd[0] === 'sh') { process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); return; }
if (cmd[0] === 'jupyter' && process.env.FAKE_CLI_SLOW === '1') {
  fs.writeFileSync(${JSON.stringify(PIDFILE)}, String(process.pid));
  setTimeout(() => process.exit(0), 8000);
  return;
}
if (cmd[0] === 'cat') { process.stdout.write('{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}'); process.exit(0); }
if (cmd[0] === 'python3') { process.stdout.write('3.13.9\\n'); process.exit(0); }
process.exit(0);
`;

for (const name of ['docker', 'alt-cli']) {
  writeFileSync(join(dir, name), FAKE_CLI);
  chmodSync(join(dir, name), 0o755);
}

const saved: Record<string, string | undefined> = {};
for (const name of [...CLEARED, 'PATH', 'EXECUTOR_DRIVER']) saved[name] = process.env[name];
for (const name of CLEARED) delete process.env[name];
process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ''}`;
process.env.EXECUTOR_DRIVER = 'container';

// Loaded after EXECUTOR_DRIVER is set: the seam picks its driver on first use.
const { executeNotebook, NotebookExecutionError, resolveExecutorTimeouts } = await import('./execute.ts');

before(() => rmSync(LOG, { force: true }));
after(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

interface Call {
  bin: string;
  args: string[];
  byName: Record<string, string | null>;
}

function readCalls(): Call[] {
  let text = '';
  try {
    text = readFileSync(LOG, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Call);
}

const NOTEBOOK: Notebook = { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 } as unknown as Notebook;

/** One run with `vars` set, returning every CLI call it made. Restores `vars` after. */
async function run(vars: Record<string, string> = {}): Promise<{ calls: Call[]; error?: unknown }> {
  rmSync(LOG, { force: true });
  rmSync(PIDFILE, { force: true });
  for (const [name, value] of Object.entries(vars)) process.env[name] = value;
  let error: unknown;
  try {
    await executeNotebook(NOTEBOOK);
  } catch (err) {
    error = err;
  } finally {
    for (const name of Object.keys(vars)) delete process.env[name];
  }
  return { calls: readCalls(), error };
}

const VERSION_PROBE =
  'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")';

/** Every invocation a run made at 6162e41, in order, byte for byte. */
function argvAt6162e41(cellTimeout = '120', runFlags: string[] = []): string[][] {
  return [
    ['run', '-d', '--rm', ...runFlags, 'civic-notebook-executor:0.2.0', 'sleep', 'infinity'],
    ['exec', '-i', CONTAINER_ID, 'sh', '-c', `cat > '/tmp/notebook.ipynb'`],
    [
      'exec', CONTAINER_ID, 'jupyter', 'nbconvert', '--to', 'notebook', '--execute',
      '--ExecutePreprocessor.timeout', cellTimeout, '--ExecutePreprocessor.allow_errors=False',
      '--output', '/tmp/executed.ipynb', '/tmp/notebook.ipynb',
    ],
    ['exec', CONTAINER_ID, 'cat', '/tmp/executed.ipynb'],
    ['exec', CONTAINER_ID, 'python3', '-c', VERSION_PROBE],
    ['kill', CONTAINER_ID],
  ];
}

// --- the pin ------------------------------------------------------------------

test('at the defaults, every CLI invocation is the one main made at 6162e41, byte for byte', async () => {
  const { calls, error } = await run();
  assert.equal(error, undefined, `the run failed: ${String(error)}`);
  assert.deepEqual(calls.map((call) => call.bin), calls.map(() => 'docker'), 'the default CLI is `docker`');
  assert.deepEqual(calls.map((call) => call.args), argvAt6162e41());
});

// --- each setting, driven away from its default --------------------------------

test('EXECUTOR_CELL_TIMEOUT_S reaches nbconvert as the per-cell limit', async () => {
  const { calls, error } = await run({ EXECUTOR_CELL_TIMEOUT_S: '90' });
  assert.equal(error, undefined, `the run failed: ${String(error)}`);
  assert.deepEqual(calls.map((call) => call.args), argvAt6162e41('90'));
});

test('EXECUTOR_SESSION_TIMEOUT_S is the wall-clock cap: the session is killed when it passes', async () => {
  const startedAt = Date.now();
  const { calls, error } = await run({
    EXECUTOR_SESSION_TIMEOUT_S: '2',
    EXECUTOR_CELL_TIMEOUT_S: '1',
    FAKE_CLI_SLOW: '1',
  });
  const elapsed = Date.now() - startedAt;
  assert.ok(error instanceof NotebookExecutionError, `the run was not stopped by the cap (it ended after ${elapsed} ms)`);
  assert.match((error as InstanceType<typeof NotebookExecutionError>).stderr ?? '', /wall-clock cap \(2000ms\) exceeded/);
  assert.ok(elapsed < 7000, `the cap is 2 s, but the run took ${elapsed} ms`);
  const kills = calls.filter((call) => call.args[0] === 'kill');
  assert.ok(kills.length >= 1, 'no kill was issued');
});

/** Each container setting, one value away from its default, and the run flags it must produce. */
const CONTAINER_CASES: Array<{ vars: Record<string, string>; flags: string[] }> = [
  { vars: { EXECUTOR_CONTAINER_MEMORY: '2g' }, flags: ['--memory', '2g'] },
  { vars: { EXECUTOR_CONTAINER_CPUS: '1.5' }, flags: ['--cpus', '1.5'] },
  { vars: { EXECUTOR_CONTAINER_PIDS_LIMIT: '256' }, flags: ['--pids-limit', '256'] },
  { vars: { EXECUTOR_CONTAINER_NETWORK: 'notebook-egress' }, flags: ['--network', 'notebook-egress'] },
  { vars: { EXECUTOR_CONTAINER_USER: '10001:10001' }, flags: ['--user', '10001:10001'] },
  { vars: { EXECUTOR_CONTAINER_RUNTIME: 'runsc' }, flags: ['--runtime', 'runsc'] },
  {
    vars: { EXECUTOR_CONTAINER_HARDENED: '1' },
    flags: ['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'],
  },
];

for (const { vars, flags } of CONTAINER_CASES) {
  const [name] = Object.keys(vars);
  test(`${name} adds ${flags.join(' ')} to docker run, and changes nothing else`, async () => {
    const { calls, error } = await run(vars);
    assert.equal(error, undefined, `the run failed: ${String(error)}`);
    assert.deepEqual(calls.map((call) => call.args), argvAt6162e41('120', flags));
  });
}

test('all the run settings together, in their fixed order before the image', async () => {
  const vars = Object.assign({}, ...CONTAINER_CASES.map((c) => c.vars)) as Record<string, string>;
  const { calls, error } = await run(vars);
  assert.equal(error, undefined, `the run failed: ${String(error)}`);
  assert.deepEqual(calls[0]?.args, argvAt6162e41('120', CONTAINER_CASES.flatMap((c) => c.flags))[0]);
});

test('EXECUTOR_CONTAINER_HARDENED reads 1/true as on and 0/false as off, in any case', async () => {
  for (const value of ['true', 'TRUE', ' 1 ']) {
    const { calls } = await run({ EXECUTOR_CONTAINER_HARDENED: value });
    assert.ok(calls[0]?.args.includes('--cap-drop'), `"${value}" did not switch hardening on`);
  }
  for (const value of ['0', 'false', 'False', '']) {
    const { calls } = await run({ EXECUTOR_CONTAINER_HARDENED: value });
    assert.deepEqual(calls[0]?.args, argvAt6162e41()[0], `"${value}" changed docker run`);
  }
});

test('EXECUTOR_CONTAINER_CLI names the binary every invocation is spawned with', async () => {
  for (const cli of ['alt-cli', join(dir, 'alt-cli')]) {
    const { calls, error } = await run({ EXECUTOR_CONTAINER_CLI: cli });
    assert.equal(error, undefined, `the run failed: ${String(error)}`);
    assert.equal(calls.length, 6);
    assert.deepEqual(calls.map((call) => call.bin), calls.map(() => 'alt-cli'), `"${cli}" was not the CLI spawned`);
    assert.deepEqual(calls.map((call) => call.args), argvAt6162e41());
  }
});

test('a blank setting is the default', async () => {
  const blanks = Object.fromEntries(SETTINGS.map((name) => [name, '  ']));
  const { calls, error } = await run(blanks);
  assert.equal(error, undefined, `the run failed: ${String(error)}`);
  assert.deepEqual(calls.map((call) => call.bin), calls.map(() => 'docker'));
  assert.deepEqual(calls.map((call) => call.args), argvAt6162e41());
});

test('unset, the timeouts are the constants main carried: a 180 s cap and a 120 s cell limit', () => {
  assert.deepEqual(resolveExecutorTimeouts({}), { sessionMs: 180_000, cellS: 120 });
  assert.deepEqual(resolveExecutorTimeouts({ EXECUTOR_SESSION_TIMEOUT_S: '', EXECUTOR_CELL_TIMEOUT_S: ' ' }), {
    sessionMs: 180_000,
    cellS: 120,
  });
});

// --- the guards ---------------------------------------------------------------

/** A run that must be refused before any CLI call, with an error naming `variable`. */
async function assertRefused(vars: Record<string, string>, variable: string): Promise<void> {
  const { calls, error } = await run(vars);
  assert.ok(error, `${JSON.stringify(vars)} ran; it must be refused`);
  assert.ok(error instanceof NotebookExecutionError, 'a settings refusal takes the notebook-execution error path');
  const err = error as InstanceType<typeof NotebookExecutionError> & { variable?: unknown };
  assert.equal(err.name, 'ExecutorSettingError');
  assert.equal(err.variable, variable);
  assert.ok(err.message.includes(variable), `the message does not name ${variable}: ${err.message}`);
  assert.equal(calls.length, 0, `the CLI was called ${calls.length} time(s) before the refusal`);
}

test('the session cap must be above the per-cell limit', async () => {
  await assertRefused({ EXECUTOR_SESSION_TIMEOUT_S: '120' }, 'EXECUTOR_SESSION_TIMEOUT_S');
  await assertRefused({ EXECUTOR_SESSION_TIMEOUT_S: '60', EXECUTOR_CELL_TIMEOUT_S: '90' }, 'EXECUTOR_SESSION_TIMEOUT_S');
  await assertRefused({ EXECUTOR_CELL_TIMEOUT_S: '180' }, 'EXECUTOR_SESSION_TIMEOUT_S');
  // One second of headroom is enough to pass the guard.
  const { error } = await run({ EXECUTOR_SESSION_TIMEOUT_S: '121' });
  assert.equal(error, undefined, `a session cap of 121 s over the 120 s cell limit was refused: ${String(error)}`);
});

test('a timeout must be a whole number of seconds, above zero and at most a day', async () => {
  for (const value of ['0', '-5', '1.5', '2m', 'abc', '86401']) {
    await assertRefused({ EXECUTOR_SESSION_TIMEOUT_S: value }, 'EXECUTOR_SESSION_TIMEOUT_S');
  }
  for (const value of ['0', '-1', '30s']) {
    await assertRefused({ EXECUTOR_CELL_TIMEOUT_S: value }, 'EXECUTOR_CELL_TIMEOUT_S');
  }
});

test('a container setting that is not of its own shape is refused, so none can add an argument', async () => {
  const cases: Array<[string, string]> = [
    ['EXECUTOR_CONTAINER_CLI', '--help'],
    ['EXECUTOR_CONTAINER_CLI', 'docker --tls'],
    ['EXECUTOR_CONTAINER_MEMORY', '-v'],
    ['EXECUTOR_CONTAINER_MEMORY', '2g --privileged'],
    ['EXECUTOR_CONTAINER_CPUS', '-1'],
    ['EXECUTOR_CONTAINER_CPUS', 'two'],
    ['EXECUTOR_CONTAINER_PIDS_LIMIT', '-1'],
    ['EXECUTOR_CONTAINER_PIDS_LIMIT', '0'],
    ['EXECUTOR_CONTAINER_NETWORK', '--privileged'],
    ['EXECUTOR_CONTAINER_NETWORK', 'a b'],
    ['EXECUTOR_CONTAINER_USER', '-u'],
    ['EXECUTOR_CONTAINER_USER', 'root; id'],
    ['EXECUTOR_CONTAINER_RUNTIME', '--privileged'],
    ['EXECUTOR_CONTAINER_HARDENED', 'yes'],
  ];
  for (const [name, value] of cases) await assertRefused({ [name]: value }, name);
});

// --- #521: the notebook's variables pass by name --------------------------------

/**
 * Decoy values, generated per run: a value that exists only in this process
 * can be found on a command line only if the driver put it there, and no
 * literal in any file (this one included) can stand in for it.
 */
const DECOYS = {
  SOCRATA_APP_TOKEN: `decoy${randomBytes(6).toString('hex')}`,
  DC_API_KEY: `decoy${randomBytes(6).toString('hex')}`,
};

test('the leak check can fail: it finds each decoy in an argv that carries it', () => {
  for (const [name, value] of Object.entries(DECOYS)) {
    assert.ok(leaks([['exec', '-e', `${name}=${value}`, CONTAINER_ID]]).includes(value), `missed ${name}`);
  }
});

/** Every decoy value found in any argv. */
function leaks(argvs: string[][]): string[] {
  const text = argvs.map((args) => args.join('\u0000')).join('\u0001');
  return Object.values(DECOYS).filter((value) => text.includes(value));
}

test('#521: no argv carries a notebook token, and the container still receives each by name', async () => {
  const { calls, error } = await run(DECOYS);
  assert.equal(error, undefined, `the run failed: ${String(error)}`);
  assert.equal(calls.length, 6, 'the run did not make the six invocations the leak check reads');
  assert.deepEqual(leaks(calls.map((call) => call.args)), [], 'a token value is on a CLI command line (ps shows argv)');

  const nbconvert = calls.find((call) => call.args.includes('jupyter'));
  assert.ok(nbconvert, 'no nbconvert exec was recorded');
  for (const [name, value] of Object.entries(DECOYS)) {
    assert.equal(
      nbconvert.byName[name],
      value,
      `the nbconvert exec does not pass ${name} by name with its value in the CLI's environment`,
    );
    assert.ok(
      nbconvert.args.indexOf(name) < nbconvert.args.indexOf(CONTAINER_ID),
      `-e ${name} must precede the container id`,
    );
  }
  // The other invocations never carried the notebook's variables, and still do not.
  for (const call of calls.filter((c) => c !== nbconvert)) {
    for (const name of Object.keys(DECOYS)) {
      assert.ok(!call.args.includes(name), `docker ${call.args[0]} passes ${name}`);
    }
  }
});

// --- the contract rows --------------------------------------------------------

const repoFile = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('each setting has an ENV_SPEC row and a bare pass-through in the compose app service', () => {
  const declared = new Set((ENV_SPEC as Array<{ name: string }>).map((row) => row.name));
  const { environment } = parseComposeService(repoFile('docker-compose.yml')) as {
    environment: Map<string, string | null>;
  };
  for (const name of SETTINGS) {
    assert.ok(declared.has(name), `ENV_SPEC has no row for ${name}`);
    assert.ok(environment.has(name), `docker-compose.yml's app service does not pass ${name}`);
  }
});

test('every EXECUTOR_* row in ENV_SPEC is described in docs/deploy.md', () => {
  const doc = repoFile('docs/deploy.md');
  const rows = (ENV_SPEC as Array<{ name: string }>).filter((row) => row.name.startsWith('EXECUTOR_'));
  assert.ok(rows.length >= 2, 'ENV_SPEC has fewer EXECUTOR_* rows than main had, so this check reads nothing');
  for (const { name } of rows) {
    assert.ok(doc.includes(`\`${name}\``), `docs/deploy.md does not name \`${name}\``);
  }
});
