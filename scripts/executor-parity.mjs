#!/usr/bin/env node
/**
 * Executor-driver parity harness (S3b P4).
 *
 * Executes a deterministic fixture notebook (scripts/fixtures/
 * parity-notebook.ipynb — NO network calls, fixed inputs, seeded RNG) on a
 * named notebook-executor driver and writes a NORMALIZED ExecutionResult
 * JSON. Two normalized results from two drivers must be identical; the
 * `compare` mode diffs them and exits non-zero on mismatch.
 *
 * The normalization list below is the explicit contract for what the two
 * runtimes "inherently differ in" — everything else in the executed
 * notebook bytes must match. MASKED FIELDS (each replaced with "[masked]"):
 *
 *   1. `.sandboxId`                — runtime instance id (Vercel sandbox id
 *                                    vs container id; unique per run).
 *   2. `.executionDuration_ms`     — wall-clock timing (varies per run).
 *   3. `.pythonVersion`            — PATCH component only (both runtimes pin
 *                                    python 3.13; the patch level is the
 *                                    image's, e.g. "3.13.5" → "3.13.[masked]").
 *   4. `.notebook.metadata.language_info.version`
 *                                  — same patch-level normalization; nbformat
 *                                    records the kernel's full version.
 *   5. every `cell.metadata.execution`
 *                                  — nbclient per-cell execution-timing
 *                                    metadata (ISO timestamps of the
 *                                    execute_request/reply messages).
 *
 * Nothing else is masked. Cell sources, stream outputs, execution_count,
 * rich outputs (including the matplotlib PNG bytes — same pinned wheel,
 * Agg backend, version chunk stripped in-fixture), and the pinned-library
 * table must be byte-identical across drivers.
 *
 * Usage (container leg — needs a running container runtime + built image;
 * see docker/executor/Dockerfile):
 *
 *   node --experimental-strip-types scripts/executor-parity.mjs run \
 *     --driver container --out parity-container.json
 *
 * Usage (vercel-sandbox leg — needs Vercel Sandbox auth). `op run` is
 * recommended so the op:// references in .env.parity.local resolve into the
 * process environment in one command:
 *
 *   op run --env-file=.env.parity.local -- node --experimental-strip-types \
 *     scripts/executor-parity.mjs run --driver vercel-sandbox --out parity-vercel.json
 *
 * Any env-injection mechanism that gets the Vercel Sandbox auth values into
 * the process environment is acceptable (CI secrets, container secrets, a
 * secret manager) — never a plaintext literal in a dot-file.
 *
 * Compare (exit 0 = parity, exit 1 = mismatch, differences listed):
 *
 *   node --experimental-strip-types scripts/executor-parity.mjs compare \
 *     parity-container.json parity-vercel.json
 *
 * Driver error-path and timeout proofs (container leg):
 *
 *   node --experimental-strip-types scripts/executor-parity.mjs run \
 *     --driver container --fixture scripts/fixtures/error-notebook.ipynb --expect error
 *   node --experimental-strip-types scripts/executor-parity.mjs run \
 *     --driver container --fixture scripts/fixtures/timeout-notebook.ipynb \
 *     --timeout-ms 20000 --expect timeout
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_FIXTURE = 'scripts/fixtures/parity-notebook.ipynb';
const MASKED = '[masked]';
const DRIVERS = ['vercel-sandbox', 'container'];

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    [
      'usage:',
      '  executor-parity.mjs run --driver <vercel-sandbox|container> [--fixture <path>]',
      '                          [--out <path>] [--timeout-ms <n>] [--expect <success|error|timeout>]',
      '  executor-parity.mjs compare <a.json> <b.json>',
      '',
      'vercel-sandbox leg (op run recommended for auth; any env-injection',
      'mechanism works — never a plaintext dot-file literal), one command:',
      '  op run --env-file=.env.parity.local -- node --experimental-strip-types \\',
      '    scripts/executor-parity.mjs run --driver vercel-sandbox --out parity-vercel.json',
    ].join('\n'),
  );
  process.exit(2);
}

/** Mask the patch component of a "major.minor.patch[...]" version string. */
function maskPatchVersion(version) {
  if (typeof version !== 'string') return version;
  return version.replace(/^(\d+\.\d+)\.\S+$/, `$1.${MASKED}`);
}

/** Normalize an ExecutionResult per the masked-field contract in the header. */
export function normalizeExecutionResult(result) {
  const clone = structuredClone(result);
  clone.sandboxId = MASKED; // (1) runtime instance id
  clone.executionDuration_ms = MASKED; // (2) wall-clock timing
  clone.pythonVersion = maskPatchVersion(clone.pythonVersion); // (3)
  const nb = clone.notebook;
  if (nb?.metadata?.language_info?.version !== undefined) {
    nb.metadata.language_info.version = maskPatchVersion(nb.metadata.language_info.version); // (4)
  }
  for (const cell of nb?.cells ?? []) {
    if (cell.metadata && 'execution' in cell.metadata) {
      cell.metadata.execution = MASKED; // (5) nbclient per-cell timing metadata
    }
  }
  return clone;
}

/** Deep structural diff; returns ["path: a-side vs b-side", …]. */
function deepDiff(a, b, at = '$', diffs = [], limit = 25) {
  if (diffs.length >= limit) return diffs;
  if (Object.is(a, b)) return diffs;
  const aType = Array.isArray(a) ? 'array' : typeof a;
  const bType = Array.isArray(b) ? 'array' : typeof b;
  if (aType !== bType || a === null || b === null || (aType !== 'object' && aType !== 'array')) {
    const show = (v) => {
      const s = JSON.stringify(v);
      return s === undefined ? String(v) : s.length > 120 ? `${s.slice(0, 117)}…` : s;
    };
    diffs.push(`${at}: ${show(a)} vs ${show(b)}`);
    return diffs;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!(key in a)) diffs.push(`${at}.${key}: (absent) vs present`);
    else if (!(key in b)) diffs.push(`${at}.${key}: present vs (absent)`);
    else deepDiff(a[key], b[key], `${at}.${key}`, diffs, limit);
    if (diffs.length >= limit) break;
  }
  return diffs;
}

async function commandRun(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      driver: { type: 'string' },
      fixture: { type: 'string', default: DEFAULT_FIXTURE },
      out: { type: 'string' },
      'timeout-ms': { type: 'string' },
      expect: { type: 'string', default: 'success' },
    },
  });
  const driver = values.driver;
  if (!driver || !DRIVERS.includes(driver)) {
    usage(`--driver must be one of: ${DRIVERS.join(', ')}`);
  }
  const expect = values.expect;
  if (!['success', 'error', 'timeout'].includes(expect)) {
    usage('--expect must be one of: success, error, timeout');
  }
  if (expect === 'success' && !values.out) {
    usage('--out is required when expecting success (the normalized JSON is the artifact)');
  }
  const timeoutMs = values['timeout-ms'] ? Number(values['timeout-ms']) : undefined;
  if (values['timeout-ms'] && !Number.isFinite(timeoutMs)) usage('--timeout-ms must be a number');

  // Select the driver BEFORE the seam module loads its lazy singleton.
  process.env.EXECUTOR_DRIVER = driver;
  const { executeNotebook, NotebookExecutionError } = await import(
    '../src/lib/sandbox/execute.ts'
  );

  const fixturePath = path.resolve(REPO_ROOT, values.fixture);
  const notebook = JSON.parse(await readFile(fixturePath, 'utf8'));
  console.log(`[parity] driver=${driver} fixture=${path.relative(REPO_ROOT, fixturePath)}`);

  const startedAt = Date.now();
  let result;
  try {
    result = await executeNotebook(notebook, {
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    if (!(err instanceof NotebookExecutionError)) throw err;
    if (expect === 'error') {
      console.log('[parity] EXPECTED ERROR PATH — execution failed as intended:');
      console.log(`         name=${err.name} exitCode=${err.exitCode}`);
      console.log(`         message=${err.message}`);
      const tail = (err.stderr ?? '').trim().split('\n').slice(-6).join('\n         ');
      if (tail) console.log(`         stderr tail:\n         ${tail}`);
      return;
    }
    if (expect === 'timeout') {
      const cap = timeoutMs ?? 180_000;
      const slack = 30_000; // boot + kill latency headroom
      if (elapsed > cap + slack) {
        console.error(
          `[parity] FAIL: execution errored after ${elapsed}ms, past cap ${cap}ms + slack`,
        );
        process.exit(1);
      }
      console.log(
        `[parity] EXPECTED TIMEOUT PATH — killed at wall-clock cap (elapsed ${elapsed}ms, cap ${cap}ms):`,
      );
      console.log(`         name=${err.name} exitCode=${err.exitCode} message=${err.message}`);
      return;
    }
    console.error(`[parity] FAIL: execution errored (exitCode=${err.exitCode}): ${err.message}`);
    if (err.stderr) console.error(err.stderr.trim().split('\n').slice(-10).join('\n'));
    process.exit(1);
  }

  if (expect !== 'success') {
    console.error(`[parity] FAIL: expected ${expect}, but execution succeeded`);
    process.exit(1);
  }

  const normalized = normalizeExecutionResult(result);
  const json = `${JSON.stringify(normalized, null, 2)}\n`;
  const outPath = path.resolve(values.out);
  await writeFile(outPath, json, 'utf8');
  console.log(
    `[parity] OK — ${normalized.notebook.cells.length} cells executed; normalized result → ${outPath}`,
  );
}

async function commandCompare(argv) {
  const [aPath, bPath] = argv;
  if (!aPath || !bPath) usage('compare needs two normalized-result JSON paths');
  const a = JSON.parse(await readFile(path.resolve(aPath), 'utf8'));
  const b = JSON.parse(await readFile(path.resolve(bPath), 'utf8'));
  const diffs = deepDiff(a, b);
  if (diffs.length === 0) {
    console.log(`[parity] PARITY OK — ${aPath} and ${bPath} are identical after normalization`);
    return;
  }
  console.error(`[parity] PARITY FAIL — ${diffs.length}+ difference(s):`);
  for (const diff of diffs) console.error(`  ${diff}`);
  process.exit(1);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'run') return commandRun(rest);
  if (command === 'compare') return commandCompare(rest);
  usage(`unknown command "${command ?? ''}"`);
}

main().catch((err) => {
  console.error('[parity] FAILED:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
