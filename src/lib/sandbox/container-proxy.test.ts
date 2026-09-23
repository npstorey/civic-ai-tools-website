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

/** Every `docker` argv a session made before #494, in order, byte for byte. */
function argvBefore494(): string[][] {
  return [
    ['run', '-d', '--rm', resolveContainerImage(), 'sleep', 'infinity'],
    ['exec', '-i', CONTAINER_ID, 'sh', '-c', `cat > '/tmp/notebook.ipynb'`],
    ['exec', '-e', 'NOTEBOOK_EXTRA=one', CONTAINER_ID, 'jupyter', 'nbconvert', '--execute', '/tmp/notebook.ipynb'],
    ['exec', CONTAINER_ID, 'cat', '/tmp/executed.ipynb'],
    ['exec', CONTAINER_ID, 'python3', '-c', 'print(1)'],
    ['kill', CONTAINER_ID],
  ];
}

// Criterion 4 (#494): with none of the proxy variables set, the driver's
// `docker` invocations are what they were before — the same argv, and spawn
// options that carry no `env` key, so the CLI inherits `process.env` exactly as
// it did. The fixture's command env is not empty, so an argv builder that
// dropped or reordered the existing `-e K=V` pairs would fail here too.
test('with no proxy variables set, every docker invocation is byte-identical to before #494', async () => {
  const { calls, spawn } = recordingSpawn();
  await driveSession({ spawn });

  assert.deepEqual(
    calls.map((call) => call.command),
    calls.map(() => 'docker'),
  );
  assert.deepEqual(
    calls.map((call) => call.args),
    argvBefore494(),
  );
  for (const call of calls) {
    assert.deepEqual(
      call.options,
      { stdio: ['pipe', 'pipe', 'pipe'] },
      `docker ${call.args[0]} was spawned with options ${JSON.stringify(call.options)}; with no proxy ` +
        'configured it must receive no env option, so the CLI inherits process.env as it did before',
    );
  }
});
