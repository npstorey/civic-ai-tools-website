/**
 * Notebook execution for the executed-notebook pipeline (ADR-0005 Phase C,
 * project plan N4) — driver-dispatching since S3b P4.
 *
 * The orchestration is runtime-agnostic: boot an executor session, write the
 * notebook in, run `jupyter nbconvert --execute` against it, and read the
 * executed notebook back as JSON. Which runtime boots is a driver decision
 * (`NotebookExecutorDriver` in `./driver.ts`):
 *
 *   - 'vercel-sandbox' (default): Vercel Sandbox microVM — the demo
 *     deployment's behavior, unchanged when the var is unset
 *     (`./vercel-sandbox.ts`).
 *   - 'container': the host container runtime via the docker CLI, using the
 *     prebuilt image from `docker/executor/Dockerfile` (`./container.ts`).
 *
 * Selection follows the DB_DRIVER / BLOB_DRIVER pattern (`src/lib/db/
 * index.ts`, `src/lib/storage/index.ts`): EXECUTOR_DRIVER env var, lazy
 * dynamic import so the non-selected driver's SDK never loads, loud failure
 * on unknown values.
 */
import type { Notebook } from '../notebook-author/cells.ts';
import { PINNED_LIBRARIES, PYTHON_RUNTIME_VERSION } from '../notebook-author/prompt.ts';
import { executorToolingPipSpecs, ExecutorSettingError, NotebookExecutionError } from './driver.ts';
import type { ExecutorSession, NotebookExecutorDriver } from './driver.ts';

export { ExecutorSettingError, NotebookExecutionError } from './driver.ts';

/**
 * The session cap and the per-cell limit, in seconds, when nothing sets them.
 * The cap is the wall-clock limit on the whole session: boot, staging, every
 * cell, and read-back. The per-cell limit is nbconvert's
 * `ExecutePreprocessor.timeout`. They were constants until #530 (ruling D7)
 * made them EXECUTOR_SESSION_TIMEOUT_S and EXECUTOR_CELL_TIMEOUT_S, for every
 * driver; these defaults are the values the constants held (ADR-0005 Risks:
 * 90-120 s per notebook).
 */
export const DEFAULT_SESSION_TIMEOUT_S = 180;
export const DEFAULT_CELL_TIMEOUT_S = 120;
/**
 * The largest value either setting takes: a day. A Node timer given more than
 * about 24.8 days fires at once, so an unbounded cap would kill every session
 * the moment it started.
 */
const MAX_TIMEOUT_S = 86_400;

/** Path inside the session where the unexecuted notebook is written. */
const NOTEBOOK_IN_PATH = '/tmp/notebook.ipynb';
/** Path inside the session where jupyter writes the executed notebook. */
const NOTEBOOK_OUT_PATH = '/tmp/executed.ipynb';

/** Environment-variable names this module honors. */
const ENV_EXECUTOR_DRIVER = 'EXECUTOR_DRIVER';
const ENV_SNAPSHOT_ID = 'SANDBOX_SNAPSHOT_ID';
const ENV_SOCRATA_TOKEN = 'SOCRATA_APP_TOKEN';
const ENV_DC_API_KEY = 'DC_API_KEY';
const ENV_SESSION_TIMEOUT = 'EXECUTOR_SESSION_TIMEOUT_S';
const ENV_CELL_TIMEOUT = 'EXECUTOR_CELL_TIMEOUT_S';

export interface ExecutorTimeouts {
  /** The session cap, in milliseconds, as `CreateSessionOptions.timeoutMs` takes it. */
  sessionMs: number;
  /** The per-cell limit, in seconds, as nbconvert takes it. */
  cellS: number;
}

/** A timeout setting's value: blank is the default; otherwise 1 to MAX_TIMEOUT_S whole seconds. */
function wholeSeconds(variable: string, raw: string | undefined, fallback: number): number {
  const value = (raw ?? '').trim();
  if (value === '') return fallback;
  const seconds = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  if (!(seconds <= MAX_TIMEOUT_S)) {
    throw new ExecutorSettingError(
      variable,
      `${variable} must be a whole number of seconds from 1 to ${MAX_TIMEOUT_S} (docs/deploy.md, executor settings).`,
    );
  }
  return seconds;
}

/**
 * Resolve the session cap and the per-cell limit (#530, ruling D7). Exported
 * for tests and the parity harness; `executeNotebook` calls it before it
 * starts anything, so a refusal leaves no runtime behind.
 *
 * THE GUARD: the cap must be greater than the per-cell limit. The cap covers
 * the container or sandbox start, staging and read-back as well as the cells,
 * so a cap at or below the per-cell limit ends a notebook before its slowest
 * permitted cell can finish, and the reader sees a timeout the per-cell limit
 * said would not happen. Refused, not corrected: an operator who set both
 * finds out at the first run which one to change.
 */
export function resolveExecutorTimeouts(
  env: Record<string, string | undefined> = process.env,
): ExecutorTimeouts {
  const sessionS = wholeSeconds(ENV_SESSION_TIMEOUT, env[ENV_SESSION_TIMEOUT], DEFAULT_SESSION_TIMEOUT_S);
  const cellS = wholeSeconds(ENV_CELL_TIMEOUT, env[ENV_CELL_TIMEOUT], DEFAULT_CELL_TIMEOUT_S);
  if (sessionS <= cellS) {
    throw new ExecutorSettingError(
      ENV_SESSION_TIMEOUT,
      `${ENV_SESSION_TIMEOUT} must be greater than ${ENV_CELL_TIMEOUT}: the session cap also covers the start, ` +
        'staging and read-back, so a cap at or below the per-cell limit ends a notebook before its slowest ' +
        'permitted cell can finish (docs/deploy.md, executor settings).',
    );
  }
  return { sessionMs: sessionS * 1000, cellS };
}

export type ExecutorDriverName = 'vercel-sandbox' | 'container';

/**
 * Resolve the configured driver name. Exported for tests; the unknown-value
 * throw is deliberately loud and lazy (first execution, not import time).
 */
export function resolveExecutorDriverName(
  env: Record<string, string | undefined> = process.env,
): ExecutorDriverName {
  const driver = env[ENV_EXECUTOR_DRIVER] || 'vercel-sandbox';
  if (driver === 'vercel-sandbox' || driver === 'container') return driver;
  throw new Error(
    `Unsupported EXECUTOR_DRIVER "${driver}" (expected "vercel-sandbox" or "container")`,
  );
}

let _driver: NotebookExecutorDriver | null = null;

async function getDriver(): Promise<NotebookExecutorDriver> {
  if (!_driver) {
    const name = resolveExecutorDriverName();
    if (name === 'container') {
      const { createContainerDriver } = await import('./container.ts');
      _driver = createContainerDriver();
    } else {
      const { createVercelSandboxDriver } = await import('./vercel-sandbox.ts');
      _driver = createVercelSandboxDriver();
    }
  }
  return _driver;
}

export interface ExecuteNotebookOptions {
  /** Snapshot to boot from (vercel-sandbox driver only). Defaults to env `SANDBOX_SNAPSHOT_ID`. */
  snapshotId?: string;
  /**
   * Hard timeout for the whole execution session (ms). Defaults to
   * EXECUTOR_SESSION_TIMEOUT_S. Given here, it is not held to the guard in
   * `resolveExecutorTimeouts`: the parity harness's timeout proof sets a cap
   * below the per-cell limit on purpose.
   */
  timeoutMs?: number;
  /** Timeout passed to `jupyter nbconvert --ExecutePreprocessor.timeout`. Defaults to EXECUTOR_CELL_TIMEOUT_S. */
  notebookTimeoutS?: number;
  /** Extra env vars passed to the session. */
  extraEnv?: Record<string, string>;
  /** AbortSignal for the caller's wrapping timeout. */
  signal?: AbortSignal;
}

export interface ExecutionResult {
  /** Executed notebook (with output cells embedded). */
  notebook: Notebook;
  /** Executor instance id (sandbox id or container id); carried through into
   *  the execution-metadata stamp. */
  sandboxId: string;
  /** Wall-clock duration from session boot to readback (ms). */
  executionDuration_ms: number;
  /** Python version reported by the session runtime. */
  pythonVersion: string;
  /** Pinned library versions actually present inside the session. */
  libraries: Record<string, string>;
}

function buildNotebookEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  const socrataToken = process.env[ENV_SOCRATA_TOKEN];
  if (socrataToken) env[ENV_SOCRATA_TOKEN] = socrataToken;
  const dcKey = process.env[ENV_DC_API_KEY];
  if (dcKey) env[ENV_DC_API_KEY] = dcKey;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      env[k] = v;
    }
  }
  return env;
}

async function ensureScientificStack(session: ExecutorSession): Promise<void> {
  const pipArgs = [
    'install', '--quiet', '--no-input',
    ...Object.entries(PINNED_LIBRARIES).map(([name, version]) => `${name}==${version}`),
    // Tooling carries its versions too (#450): nbformat/nbconvert write the
    // notebook bytes that go into a signed package, so a fresh sandbox must
    // install the versions the tooling table names, which the snapshot and
    // the container image also pin; pip resolves their dependencies here.
    ...executorToolingPipSpecs(),
  ];
  const result = await session.runCommand({ cmd: 'pip', args: pipArgs, env: {} });
  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    throw new NotebookExecutionError(
      `pip install failed (exit ${result.exitCode}) while preparing fresh sandbox`,
      { exitCode: result.exitCode, stderr },
    );
  }
}

/**
 * Execute a notebook end-to-end via the configured executor driver.
 *
 * The flow:
 *   1. Boot a session (vercel-sandbox: from `SANDBOX_SNAPSHOT_ID` snapshot
 *      when set, else a fresh python3.13 sandbox with inline pip install;
 *      container: the prebuilt executor image).
 *   2. Write the notebook JSON to `/tmp/notebook.ipynb`.
 *   3. Run `jupyter nbconvert --to notebook --execute` against it.
 *   4. Read `/tmp/executed.ipynb` back and parse as JSON.
 *   5. Stop the session (best-effort; errors are swallowed).
 *
 * Throws `NotebookExecutionError` when nbconvert exits non-zero or readback
 * fails. The caller (Phase D) is responsible for the comparison-cell append
 * and execution-metadata stamping.
 */
export async function executeNotebook(
  notebook: Notebook,
  opts: ExecuteNotebookOptions = {},
): Promise<ExecutionResult> {
  const snapshotId = opts.snapshotId ?? process.env[ENV_SNAPSHOT_ID];
  // Resolved on every run, before the driver starts anything: a malformed
  // setting refuses here and leaves no runtime behind.
  const configured = resolveExecutorTimeouts();
  const timeoutMs = opts.timeoutMs ?? configured.sessionMs;
  const notebookTimeoutS = opts.notebookTimeoutS ?? configured.cellS;
  const env = buildNotebookEnv(opts.extraEnv);
  const startedAt = Date.now();

  const driver = await getDriver();
  const session = await driver.createSession({ timeoutMs, env, snapshotId });
  try {
    // Without a preinstalled stack (fresh sandbox), pip-install the pins.
    if (!session.stackPreinstalled) {
      await ensureScientificStack(session);
    }

    // Stage the notebook on the session filesystem.
    const notebookJson = JSON.stringify(notebook);
    await session.writeFiles(
      [{ path: NOTEBOOK_IN_PATH, content: notebookJson }],
      opts.signal ? { signal: opts.signal } : undefined,
    );

    // Execute the notebook in-place: nbconvert reads NOTEBOOK_IN_PATH, runs
    // every cell, and writes the executed copy to NOTEBOOK_OUT_PATH. Use a
    // generous per-cell timeout via --ExecutePreprocessor.timeout (seconds).
    const convertResult = await session.runCommand({
      cmd: 'jupyter',
      args: [
        'nbconvert',
        '--to', 'notebook',
        '--execute',
        '--ExecutePreprocessor.timeout', String(notebookTimeoutS),
        '--ExecutePreprocessor.allow_errors=False',
        '--output', NOTEBOOK_OUT_PATH,
        NOTEBOOK_IN_PATH,
      ],
      env,
      signal: opts.signal,
    });
    if (convertResult.exitCode !== 0) {
      const stderr = await convertResult.stderr();
      throw new NotebookExecutionError(
        `jupyter nbconvert failed (exit ${convertResult.exitCode})`,
        { exitCode: convertResult.exitCode, stderr },
      );
    }

    // Read the executed notebook back as bytes, parse JSON.
    const buffer = await session.readFileToBuffer(NOTEBOOK_OUT_PATH);
    if (!buffer) {
      throw new NotebookExecutionError(`executed notebook not found at ${NOTEBOOK_OUT_PATH}`);
    }
    let executed: Notebook;
    try {
      executed = JSON.parse(buffer.toString('utf8')) as Notebook;
    } catch (parseErr) {
      throw new NotebookExecutionError('executed notebook JSON parse error', { cause: parseErr });
    }

    // Capture runtime detail by asking the session what python it has.
    const versionResult = await session.runCommand({
      cmd: 'python3',
      args: [
        '-c',
        'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")',
      ],
    });
    const pythonVersion = versionResult.exitCode === 0
      ? (await versionResult.stdout()).trim() || PYTHON_RUNTIME_VERSION
      : PYTHON_RUNTIME_VERSION;

    return {
      notebook: executed,
      sandboxId: session.id,
      executionDuration_ms: Date.now() - startedAt,
      pythonVersion,
      libraries: { ...PINNED_LIBRARIES },
    };
  } finally {
    // Best-effort cleanup; if the caller's signal aborted, stop() may also
    // throw — we swallow because the user already saw the abort.
    try {
      await session.stop();
    } catch {
      /* ignore */
    }
  }
}
