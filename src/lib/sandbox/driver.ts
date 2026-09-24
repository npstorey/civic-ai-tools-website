/**
 * Notebook-executor driver seam (S3b P4).
 *
 * Everything `executeNotebook` asks of an execution runtime goes through this
 * interface: create a session (with a wall-clock cap), run commands in it,
 * stage files, read the executed notebook back, and tear the runtime down.
 * The surface mirrors what the pipeline actually used of `@vercel/sandbox`
 * (Sandbox.create / runCommand / writeFiles / readFileToBuffer / stop) so the
 * default driver is a relocation, not a redesign.
 *
 * Drivers sit BELOW notebook orchestration: they receive and return opaque
 * bytes and command results. The executed-notebook bytes feed evidence
 * packages, so a driver must not transform notebook content — differences
 * between runtimes are limited to what the runtimes inherently differ in
 * (instance ids, durations, python patch version, per-cell execution
 * timestamps); `scripts/executor-parity.mjs` documents and enforces that
 * list.
 *
 * Driver selection lives in `./execute.ts` (EXECUTOR_DRIVER env var,
 * mirroring the DB_DRIVER / BLOB_DRIVER patterns in `src/lib/db/index.ts`
 * and `src/lib/storage/index.ts`).
 */

/**
 * Notebook tooling installed alongside the pinned scientific stack in every
 * executor runtime — the container image (docker/executor/Dockerfile), the
 * sandbox snapshot (scripts/build-sandbox-snapshot.ts) and the fresh-sandbox
 * pip fallback (./execute.ts). ONE TABLE FOR BOTH EXECUTORS: every consumer
 * derives its `name==version` specs from here, and
 * `src/lib/sandbox/executor-pins.test.ts` asserts VERSION equality (not
 * names) against the image.
 *
 * PINNED, because an executed notebook's bytes come out of `nbformat` and
 * `nbconvert` and go into a signed package: two builds of an executor on
 * different days carrying different versions can sign different bytes for
 * the same inputs. A pin is what makes "the same notebook" mean the same
 * thing across builds (#450).
 *
 * The versions are the ones the reference deployment's current sandbox
 * snapshot holds, read by the operator before this table was written (Wave
 * N12 / card C7; no snapshot is rebuilt to match it). Transitive versions
 * observed in that same snapshot, recorded for the next reader and NOT
 * installed as pins here: jupyter-core 5.9.1, jupyter-client 8.8.0,
 * nbclient 0.10.4, traitlets 5.15.0, pip 26.0.1, python 3.13.1.
 */
export const EXECUTOR_TOOLING_PACKAGES = {
  jupyter: '1.1.1',
  ipykernel: '7.2.0',
  nbformat: '5.10.4',
  nbconvert: '7.17.1',
} as const;

/**
 * Major version of `@vercel/sandbox` this repository is written against, and
 * a FLOOR the installed dependency may not drift from —
 * `src/lib/sandbox/executor-pins.test.ts` reads the installed package's own
 * version and fails when its major is not this one.
 *
 * NOT to be raised here as a bookkeeping edit: 2.x removes the sandbox
 * instance id that `./vercel-sandbox.ts` reads and stamps into the
 * execution metadata of published records, and 3.x deprecates the runtime
 * option and moves the managed Python off the pinned
 * PYTHON_RUNTIME_VERSION. Upgrading is its own issue with its own
 * record-shape measurement (Wave N12 / card C6).
 */
export const SANDBOX_SDK_MAJOR = 1;

/**
 * The AWS Lambda runtime interface client the `lambda` target of
 * docker/executor/Dockerfile installs (#530, ruling D4), pinned like the rest:
 * `./container.test.ts` holds the Dockerfile's pins to the union of this table
 * and the two above, and `./executor-pins.test.ts` holds this one to the
 * lambda stage alone. It is the function's runtime, not the notebook's: the
 * notebook runs in a subprocess the handler starts, and the executed bytes
 * come out of the pinned nbconvert.
 */
export const EXECUTOR_LAMBDA_RUNTIME_PACKAGES = {
  awslambdaric: '4.0.4',
} as const;

/**
 * `name==version` pip specs for the tooling table, in table order. Every
 * executor install path calls this rather than spelling the versions again.
 */
export function executorToolingPipSpecs(): string[] {
  return Object.entries(EXECUTOR_TOOLING_PACKAGES).map(([name, version]) => `${name}==${version}`);
}

/** A single command to run inside an executor session. */
export interface ExecutorCommand {
  cmd: string;
  args: string[];
  /**
   * Env for this command. The driver merges its own runtime-specific base
   * env on top (e.g. the vercel-sandbox driver's CA-bundle TLS paths);
   * caller-provided keys win on collision.
   */
  env?: Record<string, string>;
  /** AbortSignal for the caller's wrapping timeout. */
  signal?: AbortSignal;
}

/** Result of a completed executor command (mirrors @vercel/sandbox's shape). */
export interface ExecutorCommandResult {
  exitCode: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

/**
 * A booted execution runtime: a Vercel Sandbox microVM or a local container.
 * Sessions are single-use — one notebook execution, then `stop()`.
 */
export interface ExecutorSession {
  /**
   * Runtime instance id (sandbox id or container id). Carried through into
   * `ExecutionResult.sandboxId` and from there into the execution-metadata
   * stamp.
   */
  readonly id: string;
  /**
   * Whether the pinned scientific stack + notebook tooling are already
   * present when the session boots. True for snapshot-booted sandboxes and
   * for the prebuilt container image; false for a fresh sandbox, where the
   * orchestrator pip-installs the stack inline.
   */
  readonly stackPreinstalled: boolean;
  runCommand(command: ExecutorCommand): Promise<ExecutorCommandResult>;
  writeFiles(
    files: ReadonlyArray<{ path: string; content: string }>,
    opts?: { signal?: AbortSignal },
  ): Promise<void>;
  /** Read a file from the session filesystem; null when it does not exist. */
  readFileToBuffer(path: string): Promise<Buffer | null>;
  /** Tear the runtime down. Idempotent-enough: callers swallow errors. */
  stop(): Promise<void>;
}

export interface CreateSessionOptions {
  /**
   * Wall-clock cap for the whole session (ms). The driver kills the runtime
   * on overrun, which surfaces as a failed in-flight command.
   */
  timeoutMs: number;
  /** Env visible to the executed notebook (data-portal tokens + caller extras). */
  env: Record<string, string>;
  /**
   * vercel-sandbox driver only: snapshot to boot from. Ignored by the
   * container driver, whose prebuilt image is the equivalent concept.
   */
  snapshotId?: string;
}

/** A driver whose runtime lives across calls: create, exec, read, stop. */
export interface SessionExecutorDriver {
  readonly name: string;
  createSession(opts: CreateSessionOptions): Promise<ExecutorSession>;
}

/**
 * One notebook, as a one-shot driver runs it (#530, ruling D1). Every field is
 * built by `executeNotebook`, which builds the same values for the session
 * path, so the argv an executed notebook comes out of is one argv whichever
 * driver runs it. A one-shot driver stages `files`, runs `command`, reads
 * `readBack`, runs `versionProbe`, and returns what they produced; it composes
 * no command of its own.
 */
export interface NotebookRun {
  /** Files to stage before the command, as `ExecutorSession.writeFiles` takes them. */
  files: ReadonlyArray<{ path: string; content: string }>;
  /** The nbconvert command, with the notebook's environment. */
  command: { cmd: string; args: string[]; env: Record<string, string> };
  /** The file the command writes: the executed notebook. */
  readBack: string;
  /** The Python-version probe, run after the command. */
  versionProbe: { cmd: string; args: string[] };
  /** Wall-clock cap for the whole run (ms), as `CreateSessionOptions.timeoutMs`. */
  timeoutMs: number;
  signal?: AbortSignal;
}

/** What a one-shot run produced. `executeNotebook` interprets it as it does a session's results. */
export interface NotebookRunResult {
  /** The runtime instance id: for the lambda driver, the invocation's request id. */
  id: string;
  /** The command's exit code. */
  exitCode: number;
  /** The command's stderr; read only when `exitCode` is not 0. */
  stderr: string;
  /** The bytes at `readBack`, or null when the command wrote none. */
  executed: Buffer | null;
  /** The probe's trimmed stdout, or null when the probe failed. */
  pythonVersion: string | null;
}

/** A driver that takes a whole notebook per call: the remote shape, ADR-0023 §D. */
export interface OneShotExecutorDriver {
  readonly name: string;
  runNotebook(run: NotebookRun): Promise<NotebookRunResult>;
}

export type NotebookExecutorDriver = SessionExecutorDriver | OneShotExecutorDriver;

export class NotebookExecutionError extends Error {
  readonly stderr?: string;
  readonly exitCode?: number;
  constructor(message: string, opts: { stderr?: string; exitCode?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'NotebookExecutionError';
    this.stderr = opts.stderr;
    this.exitCode = opts.exitCode;
    if (opts.cause) (this as { cause?: unknown }).cause = opts.cause;
  }
}

/**
 * Refused before the executor starts anything (#530, ruling D7): an executor
 * setting whose value is not of its shape, or a session cap not above the
 * per-cell limit. A `NotebookExecutionError`, so the notebook route logs its
 * class and exit code and shows the reader the correlation-id copy, as it does
 * for `ContainerProxyUserinfoError`. The message names the variable and the
 * shape it expects, never the value: a value is corrected, not clamped, and
 * the operator who set it knows what it was.
 */
export class ExecutorSettingError extends NotebookExecutionError {
  /** The variable whose value was refused. */
  readonly variable: string;
  constructor(variable: string, message: string) {
    super(message);
    this.name = 'ExecutorSettingError';
    this.variable = variable;
  }
}
