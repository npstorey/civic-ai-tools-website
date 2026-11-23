// A notebook's environment holds a source's key only when its run reads that
// source (#807), on every driver.
//
// Both keys are set in the app's environment, as decoys generated per run. Each
// notebook is written by the real `synthesizeNotebook`, and its reach is the
// one it returns, so the names below come from the cells, not from a list in
// this file. Each driver is read where it hands the keys over:
//   - a session driver: the env given to `createSession` and to the nbconvert
//     command (the vercel-sandbox driver puts that env on `Sandbox.create`);
//   - the container driver, real, with `spawn` recorded: the `-e NAME` flags on
//     the nbconvert exec, and the values in the CLI's environment;
//   - the Lambda driver: in `./lambda.test.ts`, through its loopback Lambda
//     API, which reads the request the real SDK sends.
//
// WHAT MAKES IT ABLE TO FAIL. Three runs with three different answers: Data
// Commons alone, no data step, and both sources. A driver that hands over both
// keys, or neither, on every run fails two of the three.
//
// Run with: npm test

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { synthesizeNotebook } from '../notebook-author/synthesize.ts';
import type { PhaseAToolCall } from '../notebook-author/tool-to-cell.ts';
import { executeNotebookWith } from './execute.ts';
import { createContainerDriver, type DockerSpawn } from './container.ts';
import type { CreateSessionOptions, ExecutorCommand, SessionExecutorDriver } from './driver.ts';

const DECOYS = {
  SOCRATA_APP_TOKEN: `decoy${randomBytes(6).toString('hex')}`,
  DC_API_KEY: `decoy${randomBytes(6).toString('hex')}`,
};
const CLEARED = [
  'SANDBOX_SNAPSHOT_ID', 'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy',
  'EXECUTOR_SESSION_TIMEOUT_S', 'EXECUTOR_CELL_TIMEOUT_S', 'EXECUTOR_CONTAINER_IMAGE',
];
const saved = Object.fromEntries([...CLEARED, ...Object.keys(DECOYS)].map((name) => [name, process.env[name]]));
for (const name of CLEARED) delete process.env[name];
Object.assign(process.env, DECOYS);
after(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const SOCRATA: PhaseAToolCall = {
  name: 'get_data',
  args: { type: 'query', portal: 'data.cityofnewyork.us', dataset_id: 'erm2-nwe9', query: 'SELECT count(*)' },
  resultSummary: { rows: 1, columns: 1 },
};
const DATA_COMMONS: PhaseAToolCall = {
  name: 'get_observations',
  args: { variable_dcid: 'Count_Person', place_dcid: 'geoId/36' },
  resultSummary: { rows: 3, columns: 4 },
};
const CATALOG: PhaseAToolCall = { name: 'get_data', args: { type: 'catalog', portal: 'data.cityofnewyork.us', query: 'permits' } };

const RUNS: Array<{ label: string; toolCalls: PhaseAToolCall[]; expected: string[] }> = [
  { label: 'a run with only a Data Commons step', toolCalls: [DATA_COMMONS], expected: ['DC_API_KEY'] },
  { label: 'a run with no data step', toolCalls: [CATALOG], expected: [] },
  { label: 'a run with both', toolCalls: [SOCRATA, DATA_COMMONS], expected: ['DC_API_KEY', 'SOCRATA_APP_TOKEN'] },
];

function synthesize(toolCalls: PhaseAToolCall[]) {
  const synthesis = synthesizeNotebook({
    query: 'How many permits were issued?',
    defaultPortal: 'data.cityofnewyork.us',
    toolCalls,
    finalAnswer: 'The answer.',
    modelName: 'fixture/model',
    modelAccess: 'through a fixture endpoint',
    generatedAt: '2026-11-23T00:00:00.000Z',
  });
  // Typed loosely so this file also type-checks where the option does not exist.
  return { notebook: synthesis.notebook, opts: { reach: (synthesis as unknown as { reach?: unknown }).reach } as never };
}

const KEY_NAMES = Object.keys(DECOYS);
const keysIn = (env: Record<string, string | undefined>) => KEY_NAMES.filter((name) => env[name] !== undefined).sort();

test('premise: both keys are set in the app\'s environment', () => {
  assert.deepEqual(keysIn(process.env), ['DC_API_KEY', 'SOCRATA_APP_TOKEN']);
});

// --- a session driver: the env given to createSession ---------------------------

const EXECUTED = Buffer.from(JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }));

function sessionDouble() {
  const seen: { create?: Record<string, string>; nbconvert?: Record<string, string> } = {};
  const driver: SessionExecutorDriver = {
    name: 'session-double',
    async createSession(opts: CreateSessionOptions) {
      seen.create = opts.env;
      return {
        id: 'session-double',
        stackPreinstalled: true,
        async runCommand(command: ExecutorCommand) {
          if (command.cmd === 'jupyter') seen.nbconvert = command.env;
          return { exitCode: 0, stdout: async () => '3.13.1\n', stderr: async () => '' };
        },
        async writeFiles() {},
        async readFileToBuffer() { return EXECUTED; },
        async stop() {},
      };
    },
  };
  return { driver, seen };
}

for (const run of RUNS) {
  test(`a session driver: ${run.label} gets ${JSON.stringify(run.expected)} in the env given to createSession`, async () => {
    const { driver, seen } = sessionDouble();
    const { notebook, opts } = synthesize(run.toolCalls);
    await executeNotebookWith(driver, notebook, opts);
    assert.ok(seen.create && seen.nbconvert, 'premise: the session was created and nbconvert ran');
    assert.deepEqual(keysIn(seen.create), run.expected, 'the env given to createSession');
    assert.deepEqual(keysIn(seen.nbconvert), run.expected, 'the env given to the nbconvert command');
    for (const name of run.expected) assert.equal(seen.create[name], DECOYS[name as keyof typeof DECOYS], `${name} carries its value`);
  });
}

// --- the container driver: the -e names on the nbconvert exec --------------------

interface SpawnCall { args: string[]; env?: Record<string, string | undefined> }

function recordingSpawn(): { calls: SpawnCall[]; spawn: DockerSpawn } {
  const calls: SpawnCall[] = [];
  const spawn: DockerSpawn = (_command, args, options) => {
    calls.push({ args: [...args], env: (options as { env?: Record<string, string | undefined> }).env });
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: { end: (data?: string) => void } };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      end: () => {
        setImmediate(() => {
          if (args[0] === 'run') child.stdout.emit('data', Buffer.from('c0ffee000000\n'));
          if (args.includes('cat') && args.at(-1) === '/tmp/executed.ipynb') child.stdout.emit('data', EXECUTED);
          if (args.includes('python3')) child.stdout.emit('data', Buffer.from('3.13.1\n'));
          child.emit('close', 0);
        });
      },
    };
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  return { calls, spawn };
}

for (const run of RUNS) {
  test(`the container driver: ${run.label} passes ${JSON.stringify(run.expected)} by name to the nbconvert exec`, async () => {
    const { calls, spawn } = recordingSpawn();
    const { notebook, opts } = synthesize(run.toolCalls);
    await executeNotebookWith(createContainerDriver({ spawn, env: {} }), notebook, opts);
    const nbconvert = calls.find((c) => c.args[0] === 'exec' && c.args.includes('jupyter'));
    assert.ok(nbconvert, 'premise: the nbconvert exec was spawned');
    const named = nbconvert.args.flatMap((arg, i) => (arg === '-e' ? [nbconvert.args[i + 1]!] : []));
    assert.deepEqual(KEY_NAMES.filter((name) => named.includes(name)).sort(), run.expected, 'the -e names on the nbconvert exec');
    for (const name of run.expected) assert.equal(nbconvert.env?.[name], DECOYS[name as keyof typeof DECOYS], `${name}'s value is in the CLI's environment`);
    for (const call of calls) {
      for (const name of KEY_NAMES.filter((n) => !run.expected.includes(n))) {
        assert.ok(!call.args.includes(name), `docker ${call.args[0]} names ${name}`);
      }
    }
  });
}
