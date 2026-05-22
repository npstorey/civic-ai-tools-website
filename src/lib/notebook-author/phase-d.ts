/**
 * Phase D (ADR-0005 §1): post-execution stamping and comparison-cell append.
 *
 * Phase D runs after Vercel Sandbox returns the executed notebook with cell
 * outputs embedded. It:
 *   1. Extracts prominent metrics from the metric-capture cell's stdout
 *      (the cell synthesize.ts inserts before the synthesis cell).
 *   2. Appends the comparison cell per ADR-0005 §5 / OES §9.1.4: original
 *      values as Python literals, `recompute_key_metrics()` reading from
 *      the dfN DataFrames in the notebook's namespace, and a delta loop.
 *   3. Stamps `metadata.extensions[org.civicaitools.execution]` with the
 *      execution telemetry needed for verifiers to reason about the
 *      determinism property.
 *
 * Phase D is a pure function over (executed notebook + execution metadata);
 * no Vercel Sandbox calls happen here.
 */
import type { Notebook, NotebookCell } from './cells.ts';
import { codeCell, markdownCell } from './cells.ts';
import {
  EXECUTION_EXTENSION_KEY,
  NOTEBOOK_EXTENSION_KEY,
  PINNED_LIBRARIES,
  PYTHON_RUNTIME_VERSION,
} from './prompt.ts';

export interface ExecutionMetadata {
  executedAt: string;
  executionDuration_ms: number;
  sandboxId?: string;
  /** Python interpreter version reported by the sandbox; defaults to `PYTHON_RUNTIME_VERSION`. */
  pythonVersion?: string;
  /** Override pinned-library versions actually present in the sandbox; defaults to `PINNED_LIBRARIES`. */
  libraries?: Record<string, string>;
}

const METRIC_CAPTURE_MARKER = '_civic_capture=';
/** Limits to keep the comparison cell's `original = {…}` literal at a sane size. */
const MAX_METRIC_KEYS = 16;
const MAX_HEAD_ROWS = 5;

interface CapturedMetrics {
  /** Per-DataFrame metric blob keyed by variable name (e.g. `df1`). */
  byDataFrame: Record<string, { rows: number; head: Record<string, unknown>[] }>;
}

/**
 * Scan the executed notebook for the metric-capture cell's stdout. Returns
 * an empty payload (not null) when no capture line was found, so callers
 * can always emit a comparison cell shell.
 */
export function extractCapturedMetrics(notebook: Notebook): CapturedMetrics {
  const empty: CapturedMetrics = { byDataFrame: {} };
  for (const cell of notebook.cells) {
    if (cell.cell_type !== 'code') continue;
    const outputs = (cell.outputs as Array<Record<string, unknown>> | undefined) ?? [];
    for (const output of outputs) {
      if (output.output_type !== 'stream') continue;
      const rawText = output.text;
      const text = Array.isArray(rawText) ? rawText.join('') : (rawText as string | undefined);
      if (!text) continue;
      const idx = text.indexOf(METRIC_CAPTURE_MARKER);
      if (idx < 0) continue;
      const jsonStart = idx + METRIC_CAPTURE_MARKER.length;
      const jsonText = text.slice(jsonStart).trim();
      try {
        const parsed = JSON.parse(jsonText);
        if (parsed && typeof parsed === 'object') {
          return { byDataFrame: parsed as CapturedMetrics['byDataFrame'] };
        }
      } catch {
        // Fall through to next output.
      }
    }
  }
  return empty;
}

function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'float("nan")';
    return String(value);
  }
  return JSON.stringify(value);
}

interface OriginalEntry { key: string; value: unknown }

function flattenMetricsToOriginal(metrics: CapturedMetrics): OriginalEntry[] {
  const entries: OriginalEntry[] = [];
  const dfNames = Object.keys(metrics.byDataFrame);
  for (const dfName of dfNames) {
    const block = metrics.byDataFrame[dfName];
    if (!block) continue;
    entries.push({ key: `${dfName}_n_rows`, value: block.rows });
    const head = (block.head ?? []).slice(0, MAX_HEAD_ROWS);
    head.forEach((row, idx) => {
      if (!row || typeof row !== 'object') return;
      for (const [field, val] of Object.entries(row)) {
        if (entries.length >= MAX_METRIC_KEYS) return;
        entries.push({ key: `${dfName}_row${idx}_${field}`, value: val });
      }
    });
    if (entries.length >= MAX_METRIC_KEYS) break;
  }
  return entries.slice(0, MAX_METRIC_KEYS);
}

export function buildMetricCaptureCell(dataFrameVariables: readonly string[]): NotebookCell {
  const candidates = dataFrameVariables.length === 0 ? ['df1'] : dataFrameVariables;
  const source = [
    '# Capture prominent metrics for the comparison cell appended at publish time.',
    '# This cell prints a single `_civic_capture=…` line that the publisher\'s',
    '# Phase D parses; the line is informational and harmless on re-execution.',
    'import json as _json',
    '',
    '_civic_capture = {}',
    `_civic_candidates = ${JSON.stringify(candidates)}`,
    'for _name in _civic_candidates:',
    '    _df = globals().get(_name)',
    '    if _df is None:',
    '        continue',
    '    try:',
    '        rows = int(len(_df))',
    '        head = _df.head(5).to_dict("records")',
    '        _civic_capture[_name] = {"rows": rows, "head": head}',
    '    except Exception:',
    '        continue',
    '',
    'print("_civic_capture=" + _json.dumps(_civic_capture, default=str))',
  ].join('\n');
  return codeCell(source);
}

export function buildComparisonCell(args: {
  executedAt: string;
  entries: readonly OriginalEntry[];
  dataFrameVariables: readonly string[];
}): NotebookCell {
  const { executedAt, entries, dataFrameVariables } = args;
  const candidates = dataFrameVariables.length === 0 ? ['df1'] : dataFrameVariables;
  const literalLines = entries.length === 0
    ? ['original = {}']
    : ['original = {',
       ...entries.map(({ key, value }) => `    ${JSON.stringify(key)}: ${pyLiteral(value)},`),
       '}'];

  const source = [
    `# Comparison: original vs. current (appended by Phase D at executedAt = ${executedAt})`,
    '#',
    '# Original values were captured when the notebook was first executed by the',
    '# publisher\'s pipeline. On re-execution against live data, the same metrics',
    '# are extracted from the DataFrames computed above and a per-key delta is',
    '# printed below. See ADR-0005 §5 / OES §9.1.4 for the canonical shape.',
    '',
    `# ORIGINAL VALUES (captured at executedAt = ${executedAt})`,
    ...literalLines,
    '',
    '# CURRENT VALUES (re-computed from the DataFrames above)',
    'def recompute_key_metrics():',
    '    current = {}',
    `    candidates = ${JSON.stringify(candidates)}`,
    '    for name in candidates:',
    '        df = globals().get(name)',
    '        if df is None:',
    '            continue',
    '        try:',
    '            current[f"{name}_n_rows"] = int(len(df))',
    '            head = df.head(5).to_dict("records")',
    '            for idx, row in enumerate(head):',
    '                for field, value in row.items():',
    '                    current[f"{name}_row{idx}_{field}"] = value',
    '        except Exception:',
    '            continue',
    '    return current',
    '',
    'current = recompute_key_metrics()',
    '',
    '# DELTAS',
    'for k in original:',
    '    if k in current:',
    '        cur, orig = current[k], original[k]',
    '        if isinstance(orig, (int, float)) and isinstance(cur, (int, float)):',
    '            delta = cur - orig',
    '        else:',
    '            delta = (orig, cur)',
    '        print(f"{k}: original={orig!r}, current={cur!r}, delta={delta!r}")',
    '    else:',
    '        print(f"{k}: original={original[k]!r}, current=<not present>, delta=<unavailable>")',
  ].join('\n');
  return codeCell(source);
}

function comparisonCellHeader(): NotebookCell {
  return markdownCell([
    '## Comparison: original vs. current',
    '',
    'This cell was appended at publish time. Re-execute the notebook to compare',
    'today\'s numbers against the values captured when the notebook was first',
    'executed by the publisher\'s pipeline.',
  ].join('\n'));
}

export interface StampOutputs {
  notebook: Notebook;
  /** The execution-extension content written into the notebook metadata. */
  executionExtension: Record<string, unknown>;
  /** Final list of original-value entries captured into the comparison cell. */
  comparisonEntries: OriginalEntry[];
  /** Whether the comparison cell carries any literal entries. */
  comparisonCellPresent: boolean;
}

/**
 * Append the comparison cell and stamp `metadata.extensions[…execution]`.
 * Mutates and returns the notebook for ergonomics; callers passing in a
 * shared reference should clone first if they need the pre-stamped shape.
 */
export function stampExecutedNotebook(
  notebook: Notebook,
  meta: ExecutionMetadata,
  dataFrameVariables: readonly string[],
): StampOutputs {
  const metrics = extractCapturedMetrics(notebook);
  const entries = flattenMetricsToOriginal(metrics);
  const comparisonCellPresent = entries.length > 0;

  notebook.cells.push(comparisonCellHeader());
  notebook.cells.push(buildComparisonCell({
    executedAt: meta.executedAt,
    entries,
    dataFrameVariables,
  }));

  const libraries = meta.libraries ?? { ...PINNED_LIBRARIES };
  const executionExtension: Record<string, unknown> = {
    executedAt: meta.executedAt,
    environment: {
      python: meta.pythonVersion ?? PYTHON_RUNTIME_VERSION,
      libraries,
    },
    executionDuration_ms: Math.max(0, Math.round(meta.executionDuration_ms)),
    comparisonCellPresent,
  };
  if (meta.sandboxId) executionExtension.sandboxId = meta.sandboxId;

  notebook.metadata.extensions = {
    ...(notebook.metadata.extensions ?? {}),
    [NOTEBOOK_EXTENSION_KEY]: {
      ...(((notebook.metadata.extensions ?? {})[NOTEBOOK_EXTENSION_KEY] as Record<string, unknown> | undefined) ?? {}),
      provenance: 'executed',
    },
    [EXECUTION_EXTENSION_KEY]: executionExtension,
  };

  return { notebook, executionExtension, comparisonEntries: entries, comparisonCellPresent };
}
