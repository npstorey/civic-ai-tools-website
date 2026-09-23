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
 *   docker build -t civic-notebook-executor:0.2.0 docker/executor
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
 *
 * EGRESS PROXY (#494, rulings D3 and D9). With a proxy configured, the
 * notebook's own requests inside the container go through it: every
 * `docker exec` passes `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` in both
 * spellings BY NAME (`-e HTTP_PROXY`), and the values ride in the environment
 * of the spawned `docker` CLI, which resolves a bare `-e NAME` from its own
 * environment. So no proxy value is ever on a `docker` command line. The
 * values are the ones `resolveProxySettings` resolves for the app itself (see
 * `resolveContainerProxyEnv`). A proxy address carrying a user or password
 * refuses the session before `docker run` (`ContainerProxyUserinfoError`).
 * With none configured, every invocation is exactly what it was before.
 * `docker run` and `docker kill` never carry the variables: the idle
 * `sleep infinity` makes no requests.
 */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { resolveProxySettings } from '../outbound-proxy.ts';
import { NotebookExecutionError } from './driver.ts';
import type {
  CreateSessionOptions,
  ExecutorCommand,
  ExecutorCommandResult,
  ExecutorSession,
  NotebookExecutorDriver,
} from './driver.ts';

/** Default tag produced by `docker build -t … docker/executor`. */
export const DEFAULT_CONTAINER_IMAGE = 'civic-notebook-executor:0.2.0';

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

/**
 * How the driver starts the `docker` CLI. The real driver uses
 * `child_process.spawn`; a test passes a recorder so every invocation's argv
 * and spawn options can be read offline, through the same code path.
 */
export type DockerSpawn = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio & { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

type EnvRecord = Record<string, string | undefined>;

export interface ContainerDriverDeps {
  /** Defaults to `child_process.spawn`. */
  spawn?: DockerSpawn;
  /**
   * The environment the proxy variables are read from, and the base of the
   * environment a proxied exec hands the CLI. Defaults to `process.env`, read
   * at session start.
   */
  env?: EnvRecord;
}

/**
 * The six names a proxied session passes into the container, both spellings:
 * curl reads only lower-case `http_proxy`, Python reads both, and other tools
 * in an image differ again, so the container gets each under both.
 */
export const CONTAINER_PROXY_ENV_NAMES = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
] as const;

/**
 * Refused at session start (ruling D9): a proxy address that carries a user or
 * password. Passed into the container, it would sit in the environment of
 * model-written notebook code. The message names the VARIABLE, never any part
 * of its value. A `NotebookExecutionError`, so the notebook route logs its
 * class and exit code, shows the reader the correlation-id copy, and never
 * sends or logs its message (`src/app/api/query-notebook/route.ts`).
 */
export class ContainerProxyUserinfoError extends NotebookExecutionError {
  /** The variable whose value carried the user or password. */
  readonly variable: string;
  constructor(variable: string) {
    super(
      `${variable} carries a user or password, which EXECUTOR_DRIVER=container refuses to pass into ` +
        'the notebook container. Use a proxy address without one (docs/deploy.md, egress proxy).',
    );
    this.name = 'ContainerProxyUserinfoError';
    this.variable = variable;
  }
}

/**
 * True when a proxy address carries userinfo. Read from the text, not from
 * `new URL`: without a scheme (`user:pass@host:3128`) the URL parser takes
 * `user:` for the scheme and reports no user at all.
 */
function carriesUserinfo(address: string): boolean {
  const authority = address.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
  return authority.includes('@');
}

/**
 * What a proxied session adds to each `docker exec`: the six `-e NAME` flags,
 * and the environment the CLI is spawned with, which carries their values.
 * `null` when no proxy is configured, so the driver adds nothing at all.
 *
 * The values are the app's own resolution (`resolveProxySettings`): lower case
 * wins, and `NO_PROXY` is the loopback defaults followed by the operator's
 * list. One addition follows the app's routing rather than a client's: undici
 * sends https through the http proxy when no https proxy is set, and curl and
 * Python do not fall back on their own, so with only an http proxy set the
 * container is given it for https too.
 *
 * Throws `ContainerProxyUserinfoError` for a proxy address carrying a user or
 * password, naming the variable whose value won.
 */
export function resolveContainerProxyEnv(
  env: EnvRecord,
): { flags: string[]; spawnEnv: EnvRecord } | null {
  const settings = resolveProxySettings(env);
  if (!settings.enabled) return null;

  if (settings.httpProxy && carriesUserinfo(settings.httpProxy)) {
    throw new ContainerProxyUserinfoError(env.http_proxy !== undefined ? 'http_proxy' : 'HTTP_PROXY');
  }
  if (settings.httpsProxy && carriesUserinfo(settings.httpsProxy)) {
    throw new ContainerProxyUserinfoError(env.https_proxy !== undefined ? 'https_proxy' : 'HTTPS_PROXY');
  }

  const httpsProxy = settings.httpsProxy || settings.httpProxy;
  return {
    flags: CONTAINER_PROXY_ENV_NAMES.flatMap((name) => ['-e', name]),
    spawnEnv: {
      ...env,
      HTTP_PROXY: settings.httpProxy,
      http_proxy: settings.httpProxy,
      HTTPS_PROXY: httpsProxy,
      https_proxy: httpsProxy,
      NO_PROXY: settings.noProxy,
      no_proxy: settings.noProxy,
    },
  };
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
  spawnDocker: DockerSpawn,
  args: string[],
  opts: { stdin?: string; signal?: AbortSignal; env?: EnvRecord } = {},
): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawnDocker('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(opts.signal ? { signal: opts.signal } : {}),
      // Only a proxied exec passes one; otherwise the key is absent and the
      // CLI inherits process.env exactly as before #494.
      // (The cast: the framework's ProcessEnv declares NODE_ENV required.)
      ...(opts.env ? { env: opts.env as NodeJS.ProcessEnv } : {}),
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

export function createContainerDriver(deps: ContainerDriverDeps = {}): NotebookExecutorDriver {
  const spawnDocker: DockerSpawn = deps.spawn ?? spawn;
  return {
    name: 'container',

    async createSession(opts: CreateSessionOptions): Promise<ExecutorSession> {
      // Resolved once per session, before any docker call: a proxy address
      // carrying a user or password refuses here (D9), and every exec of the
      // session then carries the same names and values (D3).
      const proxy = resolveContainerProxyEnv(deps.env ?? process.env);
      const proxyFlags = proxy ? proxy.flags : [];
      const execEnv = proxy ? { env: proxy.spawnEnv } : {};

      const image = resolveContainerImage();
      // `--rm` so a killed/stopped container removes itself; `sleep infinity`
      // keeps it idle between execs (the create/exec/read/teardown shape).
      const run = await runDocker(spawnDocker, ['run', '-d', '--rm', image, 'sleep', 'infinity']);
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
        void runDocker(spawnDocker, ['kill', containerId]).catch(() => {
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
            spawnDocker,
            // Proxy names first, so a key in the command's own env wins on
            // collision, as ExecutorCommand promises.
            ['exec', ...proxyFlags, ...envFlags, containerId, command.cmd, ...command.args],
            { ...(command.signal ? { signal: command.signal } : {}), ...execEnv },
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
              spawnDocker,
              ['exec', '-i', ...proxyFlags, containerId, 'sh', '-c', `cat > ${shellSingleQuote(file.path)}`],
              {
                stdin: file.content,
                ...(writeOpts?.signal ? { signal: writeOpts.signal } : {}),
                ...execEnv,
              },
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
          const result = await runDocker(
            spawnDocker,
            ['exec', ...proxyFlags, containerId, 'cat', path],
            execEnv,
          );
          if (result.exitCode !== 0) return null;
          return result.stdout;
        },

        async stop(): Promise<void> {
          clearTimeout(killTimer);
          // --rm removes the container once killed; a second kill (after the
          // cap fired) fails harmlessly and is swallowed by the caller.
          const result = await runDocker(spawnDocker, ['kill', containerId]);
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
