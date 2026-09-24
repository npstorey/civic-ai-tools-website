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
 *
 * THE NOTEBOOK'S OWN VARIABLES PASS THE SAME WAY (#521, ruling D8). A
 * command's env — for nbconvert, the two data-portal tokens
 * `buildNotebookEnv` supplies — reaches the container as `-e NAME`, with the
 * value in the spawned CLI's environment. Until #521 it went on the command
 * line as `-e NAME=value`, where `ps` and `/proc/<pid>/cmdline` could read it
 * for the length of every run. See `passByName`.
 *
 * SETTINGS (#530, ruling D7). Besides the image, eight named settings shape
 * the invocations, each unset by default and each leaving the argv exactly as
 * it was when unset: the CLI binary (EXECUTOR_CONTAINER_CLI), and seven that
 * add flags to `docker run` — memory, CPUs, a process limit, the network, the
 * user, the OCI runtime, and a hardening switch. See
 * `resolveContainerSettings`. There is no free-form argument setting: each
 * value is checked against its own shape, and none can start with `-`.
 */
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { ExecutorSettingError, NotebookExecutionError } from './driver.ts';
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

/** The CLI every invocation spawns when EXECUTOR_CONTAINER_CLI is unset. */
export const DEFAULT_CONTAINER_CLI = 'docker';

const ENV_CONTAINER_CLI = 'EXECUTOR_CONTAINER_CLI';
const ENV_CONTAINER_MEMORY = 'EXECUTOR_CONTAINER_MEMORY';
const ENV_CONTAINER_CPUS = 'EXECUTOR_CONTAINER_CPUS';
const ENV_CONTAINER_PIDS_LIMIT = 'EXECUTOR_CONTAINER_PIDS_LIMIT';
const ENV_CONTAINER_NETWORK = 'EXECUTOR_CONTAINER_NETWORK';
const ENV_CONTAINER_USER = 'EXECUTOR_CONTAINER_USER';
const ENV_CONTAINER_RUNTIME = 'EXECUTOR_CONTAINER_RUNTIME';
const ENV_CONTAINER_HARDENED = 'EXECUTOR_CONTAINER_HARDENED';

/** The flags EXECUTOR_CONTAINER_HARDENED adds: no Linux capabilities, and no privilege gain through setuid. */
export const HARDENED_RUN_FLAGS = ['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'] as const;

/** A network or runtime name as the CLI spells one: no leading `-`, no whitespace, no separators. */
const RUNTIME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** What `resolveContainerSettings` resolves: the CLI, and the flags `docker run` carries. */
export interface ContainerSettings {
  /** The binary every invocation spawns: a name found on PATH, or a path. */
  cli: string;
  /** Flags `run` carries between `--rm` and the image, in a fixed order. Empty at the defaults. */
  runFlags: string[];
}

/**
 * One setting's value: `null` when blank, the trimmed value when it is of the
 * setting's shape. Anything else refuses, naming the variable and the shape,
 * never the value. Every shape excludes a leading `-` and whitespace, so no
 * value can be read by the CLI as another argument.
 */
function settingValue(
  variable: string,
  raw: string | undefined,
  isShaped: (value: string) => boolean,
  expects: string,
): string | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  if (!isShaped(value)) {
    throw new ExecutorSettingError(
      variable,
      `${variable} must be ${expects} (docs/deploy.md, executor settings).`,
    );
  }
  return value;
}

/**
 * Resolve the container settings (#530, ruling D7) from the environment.
 * Called at session start, before any CLI call, so a refusal leaves no
 * container behind. At the defaults the CLI is `docker` and `run` carries no
 * extra flag, so every invocation is what it was before the settings existed.
 */
export function resolveContainerSettings(env: EnvRecord = process.env): ContainerSettings {
  const cli = settingValue(
    ENV_CONTAINER_CLI,
    env[ENV_CONTAINER_CLI],
    (v) => /^[A-Za-z0-9_./][A-Za-z0-9_./-]*$/.test(v),
    'a command name or a path, such as podman or /usr/local/bin/docker',
  );
  const memory = settingValue(
    ENV_CONTAINER_MEMORY,
    env[ENV_CONTAINER_MEMORY],
    (v) => /^\d+(\.\d+)?[bkmg]?$/i.test(v) && Number.parseFloat(v) > 0,
    'a memory size above zero, such as 2g or 512m',
  );
  const cpus = settingValue(
    ENV_CONTAINER_CPUS,
    env[ENV_CONTAINER_CPUS],
    (v) => /^(\d+(\.\d+)?|\.\d+)$/.test(v) && Number(v) > 0,
    'a number of CPUs above zero, such as 1.5',
  );
  const pidsLimit = settingValue(
    ENV_CONTAINER_PIDS_LIMIT,
    env[ENV_CONTAINER_PIDS_LIMIT],
    (v) => /^[1-9]\d*$/.test(v),
    'a whole number of processes above zero',
  );
  const network = settingValue(
    ENV_CONTAINER_NETWORK,
    env[ENV_CONTAINER_NETWORK],
    (v) => RUNTIME_NAME.test(v),
    'a network name, such as notebook-egress',
  );
  const user = settingValue(
    ENV_CONTAINER_USER,
    env[ENV_CONTAINER_USER],
    (v) => /^[A-Za-z0-9_][A-Za-z0-9_.-]*(:[A-Za-z0-9_][A-Za-z0-9_.-]*)?$/.test(v),
    'a user, or user:group, by name or id, such as 10001:10001',
  );
  const runtime = settingValue(
    ENV_CONTAINER_RUNTIME,
    env[ENV_CONTAINER_RUNTIME],
    (v) => RUNTIME_NAME.test(v),
    'an OCI runtime name the container runtime knows, such as runsc',
  );
  const hardened = settingValue(
    ENV_CONTAINER_HARDENED,
    env[ENV_CONTAINER_HARDENED],
    (v) => /^(1|true|0|false)$/i.test(v),
    '1 or true to switch it on, 0 or false to leave it off',
  );

  const runFlags: string[] = [];
  if (memory !== null) runFlags.push('--memory', memory);
  if (cpus !== null) runFlags.push('--cpus', cpus);
  if (pidsLimit !== null) runFlags.push('--pids-limit', pidsLimit);
  if (network !== null) runFlags.push('--network', network);
  if (user !== null) runFlags.push('--user', user);
  if (runtime !== null) runFlags.push('--runtime', runtime);
  if (hardened !== null && /^(1|true)$/i.test(hardened)) runFlags.push(...HARDENED_RUN_FLAGS);
  return { cli: cli ?? DEFAULT_CONTAINER_CLI, runFlags };
}

/** `-e NAME` flags for `docker exec`, one per name, in order: names only, never a value. */
export function dockerEnvNameFlags(names: readonly string[]): string[] {
  return names.flatMap((name) => ['-e', name]);
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
 * What a proxied session passes into the container on each `docker exec`: the
 * six names, both spellings, with the values `passByName` hands the CLI.
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
 *
 * `../outbound-proxy.ts` is loaded only when a proxy address is set at all.
 * It imports `undici`, and this driver also runs where no dependency is
 * installed: CI's `executor image build` job runs the parity notebook through
 * it without `npm ci`. The check below only decides whether to load the
 * resolver; the resolver decides everything else. It cannot skip a
 * configuration the resolver would call enabled, because that needs one of
 * these four to be non-empty.
 */
export async function resolveContainerProxyEnv(
  env: EnvRecord,
): Promise<Record<(typeof CONTAINER_PROXY_ENV_NAMES)[number], string> | null> {
  const anyAddress = [env.HTTP_PROXY, env.http_proxy, env.HTTPS_PROXY, env.https_proxy].some(
    (value) => (value ?? '').trim().length > 0,
  );
  if (!anyAddress) return null;

  const { resolveProxySettings } = await import('../outbound-proxy.ts');
  const settings = resolveProxySettings(env);
  if (!settings.enabled) return null;

  if (settings.httpProxy && carriesUserinfo(settings.httpProxy)) {
    throw new ContainerProxyUserinfoError(env.http_proxy !== undefined ? 'http_proxy' : 'HTTP_PROXY');
  }
  if (settings.httpsProxy && carriesUserinfo(settings.httpsProxy)) {
    throw new ContainerProxyUserinfoError(env.https_proxy !== undefined ? 'https_proxy' : 'HTTPS_PROXY');
  }

  const httpsProxy = settings.httpsProxy || settings.httpProxy;
  // In CONTAINER_PROXY_ENV_NAMES order, which is the order of the flags.
  return {
    HTTP_PROXY: settings.httpProxy,
    http_proxy: settings.httpProxy,
    HTTPS_PROXY: httpsProxy,
    https_proxy: httpsProxy,
    NO_PROXY: settings.noProxy,
    no_proxy: settings.noProxy,
  };
}

/**
 * How one `docker exec` passes `vars` into the container: `-e NAME` for each
 * name, and the environment the CLI is spawned with, which carries the values.
 * The CLI resolves a bare `-e NAME` from its own environment, so no value is
 * ever on a command line (#494 for the proxy variables, #521 for the
 * notebook's own).
 *
 * With nothing to pass, no `env` option at all, so the CLI inherits
 * `process.env` exactly as it did before either change. Otherwise the CLI gets
 * the whole environment (`env`, as spawn would pass it with no `env` option)
 * with `vars` on top: later keys win, so a command's own variable wins over a
 * proxy variable of the same name, as `ExecutorCommand.env` promises.
 */
function passByName(env: EnvRecord, vars: Record<string, string>): { flags: string[]; spawnEnv?: EnvRecord } {
  const names = Object.keys(vars);
  if (names.length === 0) return { flags: [] };
  return { flags: dockerEnvNameFlags(names), spawnEnv: { ...env, ...vars } };
}

interface DockerResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
}

/**
 * Run the container CLI (`docker` unless EXECUTOR_CONTAINER_CLI names another)
 * with array args (no shell interpolation). Rejects only on spawn failure (the
 * binary missing); CLI failures resolve with a non-zero exitCode so callers
 * decide what is fatal.
 */
function runDocker(
  spawnDocker: DockerSpawn,
  cli: string,
  args: string[],
  opts: { stdin?: string; signal?: AbortSignal; env?: EnvRecord } = {},
): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    const child = spawnDocker(cli, args, {
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
          `${cli} CLI unavailable — the container executor driver requires a running host container runtime`,
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
      // Resolved once per session, before any CLI call: a malformed setting
      // (#530) or a proxy address carrying a user or password (D9) refuses
      // here, and every exec of the session then carries the same names and
      // values (D3).
      const env = deps.env ?? process.env;
      const { cli, runFlags } = resolveContainerSettings(env);
      const proxyValues = (await resolveContainerProxyEnv(env)) ?? {};
      // What the execs that carry no variables of their own (the write and the
      // read) pass: the proxy variables, or nothing.
      const proxyOnly = passByName(env, proxyValues);
      const proxyOnlySpawn = proxyOnly.spawnEnv ? { env: proxyOnly.spawnEnv } : {};

      const image = resolveContainerImage();
      // `--rm` so a killed/stopped container removes itself; `sleep infinity`
      // keeps it idle between execs (the create/exec/read/teardown shape).
      // The settings' flags sit between `--rm` and the image; none at the defaults.
      const run = await runDocker(spawnDocker, cli, ['run', '-d', '--rm', ...runFlags, image, 'sleep', 'infinity']);
      if (run.exitCode !== 0) {
        throw new NotebookExecutionError(
          `${cli} run failed (exit ${run.exitCode}) — is the container runtime up and the image "${image}" built? (docker build -t ${image} docker/executor)`,
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
        void runDocker(spawnDocker, cli, ['kill', containerId]).catch(() => {
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
          // Proxy variables first, then the command's own, which win on a
          // shared name (see `passByName`). All by name (#521).
          const byName = passByName(env, { ...proxyValues, ...(command.env ?? {}) });
          const result = await runDocker(
            spawnDocker,
            cli,
            ['exec', ...byName.flags, containerId, command.cmd, ...command.args],
            {
              ...(command.signal ? { signal: command.signal } : {}),
              ...(byName.spawnEnv ? { env: byName.spawnEnv } : {}),
            },
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
              cli,
              ['exec', '-i', ...proxyOnly.flags, containerId, 'sh', '-c', `cat > ${shellSingleQuote(file.path)}`],
              {
                stdin: file.content,
                ...(writeOpts?.signal ? { signal: writeOpts.signal } : {}),
                ...proxyOnlySpawn,
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
            cli,
            ['exec', ...proxyOnly.flags, containerId, 'cat', path],
            proxyOnlySpawn,
          );
          if (result.exitCode !== 0) return null;
          return result.stdout;
        },

        async stop(): Promise<void> {
          clearTimeout(killTimer);
          // --rm removes the container once killed; a second kill (after the
          // cap fired) fails harmlessly and is swallowed by the caller.
          const result = await runDocker(spawnDocker, cli, ['kill', containerId]);
          if (result.exitCode !== 0 && !timedOut) {
            throw new NotebookExecutionError(
              `${cli} kill failed (exit ${result.exitCode})`,
              { exitCode: result.exitCode, stderr: result.stderr.toString('utf8') },
            );
          }
        },
      };
    },
  };
}
