/**
 * Vercel Sandbox integration for the executed-notebook pipeline (ADR-0005
 * Phase C, project plan N4).
 *
 * Boots a python3.13 sandbox from a pre-built snapshot (sub-second cold
 * start per ADR-0005 Context), writes the notebook in, runs
 * `jupyter nbconvert --execute` against it, and reads the executed
 * notebook back as JSON. The snapshot embeds the pinned scientific stack
 * (pandas/requests/numpy/matplotlib) AND jupyter so cold start is fast;
 * the build script that produces the snapshot lives at
 * `scripts/build-sandbox-snapshot.ts` (project-plan N5).
 *
 * Auth is OIDC-automatic on Vercel deployments; local dev needs
 * `VERCEL_OIDC_TOKEN` (via `vercel link` + `vercel env pull`) OR the
 * VERCEL_TOKEN+VERCEL_TEAM_ID+VERCEL_PROJECT_ID triple.
 */
import { Sandbox } from '@vercel/sandbox';
import type { Notebook } from '../notebook-author/cells.ts';
import { PINNED_LIBRARIES, PYTHON_RUNTIME_VERSION } from '../notebook-author/prompt.ts';

/**
 * Wall-clock timeout for a single sandbox execution. The notebook itself
 * may run for up to NOTEBOOK_TIMEOUT_S; the sandbox timeout adds headroom
 * for boot, writeFiles, and readback. Per ADR-0005 Risks: 90-120s timeout.
 */
const SANDBOX_TIMEOUT_MS = 180_000;
const NOTEBOOK_TIMEOUT_S = 120;

/** Path inside the sandbox where the unexecuted notebook is written. */
const NOTEBOOK_IN_PATH = '/tmp/notebook.ipynb';
/** Path inside the sandbox where jupyter writes the executed notebook. */
const NOTEBOOK_OUT_PATH = '/tmp/executed.ipynb';

/** Environment-variable names this module honors at module load time. */
const ENV_SNAPSHOT_ID = 'SANDBOX_SNAPSHOT_ID';
const ENV_SOCRATA_TOKEN = 'SOCRATA_APP_TOKEN';
const ENV_DC_API_KEY = 'DC_API_KEY';

export interface ExecuteNotebookOptions {
  /** Snapshot to boot from. Defaults to env `SANDBOX_SNAPSHOT_ID`. */
  snapshotId?: string;
  /** Hard timeout for the whole sandbox session (ms). */
  timeoutMs?: number;
  /** Timeout passed to `jupyter nbconvert --ExecutePreprocessor.timeout`. */
  notebookTimeoutS?: number;
  /** Extra env vars passed to the sandbox. */
  extraEnv?: Record<string, string>;
  /** AbortSignal for the caller's wrapping timeout. */
  signal?: AbortSignal;
}

export interface ExecutionResult {
  /** Executed notebook (with output cells embedded). */
  notebook: Notebook;
  /** Sandbox id; carried through into the execution-metadata stamp. */
  sandboxId: string;
  /** Wall-clock duration from sandbox boot to readback (ms). */
  executionDuration_ms: number;
  /** Python version reported by the sandbox runtime. */
  pythonVersion: string;
  /** Pinned library versions actually present inside the sandbox. */
  libraries: Record<string, string>;
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

function buildSandboxEnv(extra?: Record<string, string>): Record<string, string> {
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

interface SandboxCreateBase {
  timeout: number;
  env: Record<string, string>;
}

function createSandbox(
  snapshotId: string | undefined,
  base: SandboxCreateBase,
): Promise<Sandbox> {
  if (snapshotId) {
    return Sandbox.create({
      ...base,
      source: { type: 'snapshot', snapshotId },
    });
  }
  // No snapshot configured — boot a fresh python3.13 sandbox and install
  // the pinned scientific stack inline. Slower (~10-30s cold start) and
  // intended only for the snapshot-build script + local-dev smoke tests.
  return Sandbox.create({
    ...base,
    runtime: 'python3.13',
  });
}

async function ensureScientificStack(sandbox: Sandbox): Promise<void> {
  const pipArgs = [
    'install', '--quiet', '--no-input',
    `pandas==${PINNED_LIBRARIES.pandas}`,
    `requests==${PINNED_LIBRARIES.requests}`,
    `numpy==${PINNED_LIBRARIES.numpy}`,
    `matplotlib==${PINNED_LIBRARIES.matplotlib}`,
    'jupyter', 'ipykernel', 'nbformat', 'nbconvert',
  ];
  const result = await sandbox.runCommand('pip', pipArgs);
  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    throw new NotebookExecutionError(
      `pip install failed (exit ${result.exitCode}) while preparing fresh sandbox`,
      { exitCode: result.exitCode, stderr },
    );
  }
}

/**
 * Execute a notebook end-to-end in Vercel Sandbox.
 *
 * The flow:
 *   1. Boot a sandbox (from `SANDBOX_SNAPSHOT_ID` snapshot when set, else a
 *      fresh python3.13 sandbox with inline pip install).
 *   2. Write the notebook JSON to `/tmp/notebook.ipynb`.
 *   3. Run `jupyter nbconvert --to notebook --execute` against it.
 *   4. Read `/tmp/executed.ipynb` back and parse as JSON.
 *   5. Stop the sandbox (best-effort; errors are swallowed).
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
  const timeoutMs = opts.timeoutMs ?? SANDBOX_TIMEOUT_MS;
  const notebookTimeoutS = opts.notebookTimeoutS ?? NOTEBOOK_TIMEOUT_S;
  const env = buildSandboxEnv(opts.extraEnv);
  const startedAt = Date.now();

  const sandbox = await createSandbox(snapshotId, { timeout: timeoutMs, env });
  try {
    // Without a snapshot, we still need the pinned scientific stack present.
    if (!snapshotId) {
      await ensureScientificStack(sandbox);
    }

    // Stage the notebook on the sandbox filesystem.
    const notebookJson = JSON.stringify(notebook);
    await sandbox.writeFiles(
      [{ path: NOTEBOOK_IN_PATH, content: notebookJson }],
      opts.signal ? { signal: opts.signal } : undefined,
    );

    // Execute the notebook in-place: nbconvert reads NOTEBOOK_IN_PATH, runs
    // every cell, and writes the executed copy to NOTEBOOK_OUT_PATH. Use a
    // generous per-cell timeout via --ExecutePreprocessor.timeout (seconds).
    const convertResult = await sandbox.runCommand({
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
    const buffer = await sandbox.readFileToBuffer({ path: NOTEBOOK_OUT_PATH });
    if (!buffer) {
      throw new NotebookExecutionError(`executed notebook not found at ${NOTEBOOK_OUT_PATH}`);
    }
    let executed: Notebook;
    try {
      executed = JSON.parse(buffer.toString('utf8')) as Notebook;
    } catch (parseErr) {
      throw new NotebookExecutionError('executed notebook JSON parse error', { cause: parseErr });
    }

    // Capture runtime detail by asking the sandbox what python it has.
    const versionResult = await sandbox.runCommand('python3', [
      '-c',
      'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")',
    ]);
    const pythonVersion = versionResult.exitCode === 0
      ? (await versionResult.stdout()).trim() || PYTHON_RUNTIME_VERSION
      : PYTHON_RUNTIME_VERSION;

    return {
      notebook: executed,
      sandboxId: sandbox.sandboxId,
      executionDuration_ms: Date.now() - startedAt,
      pythonVersion,
      libraries: { ...PINNED_LIBRARIES },
    };
  } finally {
    // Best-effort cleanup; if the caller's signal aborted, stop() may also
    // throw — we swallow because the user already saw the abort.
    try {
      await sandbox.stop();
    } catch {
      /* ignore */
    }
  }
}
