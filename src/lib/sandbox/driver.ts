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
 * executor runtime (sandbox snapshot, fresh-sandbox pip fallback, container
 * image). Unpinned by design — nbconvert executes the notebook but its
 * version is not part of the notebook's reproducibility contract the way the
 * scientific-stack pins (PINNED_LIBRARIES) are.
 */
export const EXECUTOR_TOOLING_PACKAGES = [
  'jupyter',
  'ipykernel',
  'nbformat',
  'nbconvert',
] as const;

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

export interface NotebookExecutorDriver {
  readonly name: string;
  createSession(opts: CreateSessionOptions): Promise<ExecutorSession>;
}

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
