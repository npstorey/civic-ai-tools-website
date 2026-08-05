/**
 * Driver #2: local container runtime (S3b P4 — the portable executor).
 *
 * Runs the notebook via the host container runtime's `docker` CLI (any
 * Docker-compatible runtime works). The prebuilt image at
 * `docker/executor/Dockerfile` is the container equivalent of the Vercel
 * Sandbox snapshot: python3.13 + the pinned scientific stack + jupyter/
 * nbconvert baked in, so per-run cost is container start + exec only.
 *
 * Build the image once (and after any pinned-version change):
 *
 *   docker build -t civic-notebook-executor:0.1.0 docker/executor
 *
 * `src/lib/sandbox/container.test.ts` asserts the Dockerfile's pins against
 * the single source (`src/lib/notebook-author/prompt.ts:PINNED_LIBRARIES`),
 * so image/source drift fails `npm test`.
 *
 * Session shape mirrors the sandbox driver: `docker run -d … sleep infinity`
 * boots an idle container (create), each step is a `docker exec` (exec/read),
 * and `docker kill` tears it down (teardown). Timeout semantics match the
 * sandbox driver's create-time cap: a wall-clock timer kills the container
 * on overrun, which surfaces as a failed in-flight exec and maps into the
 * same NotebookExecutionError shape upstream.
 *
 * The container joins the runtime's default network so notebook helper
 * functions can reach civic-data endpoints, matching sandbox behavior.
 */
import { spawn } from 'node:child_process';
import { NotebookExecutionError } from './driver.ts';
import type {
  CreateSessionOptions,
  ExecutorCommand,
  ExecutorCommandResult,
  ExecutorSession,
  NotebookExecutorDriver,
} from './driver.ts';

/** Default tag produced by `docker build -t … docker/executor`. */
export const DEFAULT_CONTAINER_IMAGE = 'civic-notebook-executor:0.1.0';

const ENV_CONTAINER_IMAGE = 'EXECUTOR_CONTAINER_IMAGE';

/** Resolve the executor image tag (EXECUTOR_CONTAINER_IMAGE, else default). */
export function resolveContainerImage(
  env: Record<string, string | undefined> = process.env,
): string {
  const image = env[ENV_CONTAINER_IMAGE];
  return image && image.trim().length > 0 ? image.trim() : DEFAULT_CONTAINER_IMAGE;
}

/** `-e K=V` flag pairs for `docker exec` from an env record. */
export function buildDockerEnvFlags(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
}

/** Single-quote a string for `sh -c` (used for in-container file paths). */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface DockerResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
}

/**
 * Run the docker CLI with array args (no shell interpolation). Rejects only
 * on spawn failure (docker binary missing); CLI failures resolve with a
 * non-zero exitCode so callers decide what is fatal.
 */
function runDocker(
  args: string[],
  opts: { stdin?: string; signal?: AbortSignal } = {},
): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      reject(
        new NotebookExecutionError(
          'docker CLI unavailable — the container executor driver requires a running host container runtime',
          { cause: err },
        ),
      );
    });
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
    child.stdin.end(opts.stdin ?? '');
  });
}

export function createContainerDriver(): NotebookExecutorDriver {
  return {
    name: 'container',

    async createSession(opts: CreateSessionOptions): Promise<ExecutorSession> {
      const image = resolveContainerImage();
      // `--rm` so a killed/stopped container removes itself; `sleep infinity`
      // keeps it idle between execs (the create/exec/read/teardown shape).
      const run = await runDocker(['run', '-d', '--rm', image, 'sleep', 'infinity']);
      if (run.exitCode !== 0) {
        throw new NotebookExecutionError(
          `docker run failed (exit ${run.exitCode}) — is the container runtime up and the image "${image}" built? (docker build -t ${image} docker/executor)`,
          { exitCode: run.exitCode, stderr: run.stderr.toString('utf8') },
        );
      }
      const containerId = run.stdout.toString('utf8').trim();

      // Wall-clock cap, mirroring the sandbox driver's create-time timeout:
      // kill the container on overrun; any in-flight exec then fails and the
      // orchestrator maps it into NotebookExecutionError.
      let timedOut = false;
      const killTimer = setTimeout(() => {
        timedOut = true;
        void runDocker(['kill', containerId]).catch(() => {
          /* container already gone */
        });
      }, opts.timeoutMs);
      killTimer.unref();

      return {
        id: containerId,
        // The prebuilt image bakes the pinned stack (test-enforced), so the
        // orchestrator never pip-installs here.
        stackPreinstalled: true,

        async runCommand(command: ExecutorCommand): Promise<ExecutorCommandResult> {
          const envFlags = buildDockerEnvFlags(command.env ?? {});
          const result = await runDocker(
            ['exec', ...envFlags, containerId, command.cmd, ...command.args],
            command.signal ? { signal: command.signal } : {},
          );
          return {
            exitCode: result.exitCode,
            stdout: async () => result.stdout.toString('utf8'),
            stderr: async () => {
              const text = result.stderr.toString('utf8');
              return timedOut
                ? `${text}\n[container-executor] wall-clock cap (${opts.timeoutMs}ms) exceeded — container killed`
                : text;
            },
          };
        },

        async writeFiles(files, writeOpts) {
          for (const file of files) {
            const result = await runDocker(
              ['exec', '-i', containerId, 'sh', '-c', `cat > ${shellSingleQuote(file.path)}`],
              { stdin: file.content, ...(writeOpts?.signal ? { signal: writeOpts.signal } : {}) },
            );
            if (result.exitCode !== 0) {
              throw new NotebookExecutionError(
                `container write failed for ${file.path} (exit ${result.exitCode})`,
                { exitCode: result.exitCode, stderr: result.stderr.toString('utf8') },
              );
            }
          }
        },

        async readFileToBuffer(path: string): Promise<Buffer | null> {
          const result = await runDocker(['exec', containerId, 'cat', path]);
          if (result.exitCode !== 0) return null;
          return result.stdout;
        },

        async stop(): Promise<void> {
          clearTimeout(killTimer);
          // --rm removes the container once killed; a second kill (after the
          // cap fired) fails harmlessly and is swallowed by the caller.
          const result = await runDocker(['kill', containerId]);
          if (result.exitCode !== 0 && !timedOut) {
            throw new NotebookExecutionError(
              `docker kill failed (exit ${result.exitCode})`,
              { exitCode: result.exitCode, stderr: result.stderr.toString('utf8') },
            );
          }
        },
      };
    },
  };
}
