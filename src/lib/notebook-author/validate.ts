/**
 * Light-touch schema validator for the executed-notebook extensions per
 * spec §8.7.4 (specified by ADR-0005). Phase 1 owns this local sanity check
 * before the route returns the notebook; Phase 3 owns the full packager-
 * side enforcement when executed notebooks become evidence-package
 * payloads.
 *
 * The validator is intentionally narrow: it verifies the extension keys
 * exist, mandatory fields are present, and types are roughly right. It
 * does NOT do deep canonical-JSON validation — that lives in the
 * `civic-ai-tools-website/src/lib/evidence/packager.ts` Phase 3 work.
 *
 * One check reads the CELLS rather than the metadata (#341): whether any step
 * re-runs a data fetch. A notebook whose every fetch failed has perfectly
 * well-formed extensions, so a validator that only ever looked at shape
 * reported it as valid while it told its reader the analysis was reproducible.
 */
import type { Notebook } from './cells.ts';
import { EXECUTION_EXTENSION_KEY, NOTEBOOK_EXTENSION_KEY } from './prompt.ts';
import { countReproducedFetchCells } from './tool-to-cell.ts';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function getExtension(notebook: Notebook, key: string): Record<string, unknown> | null {
  const extensions = notebook.metadata.extensions as Record<string, unknown> | undefined;
  if (!extensions) return null;
  const ext = extensions[key];
  if (!ext || typeof ext !== 'object') return null;
  return ext as Record<string, unknown>;
}

/**
 * Validate that `metadata.extensions[org.civicaitools.notebook].provenance`
 * is set and equal to either `"executed"` or `"skeleton"`. Skeleton
 * notebooks are out of scope for this validator (they have their own
 * Phase 3 path), so we only accept `"executed"` here.
 */
export function validateNotebookProvenance(notebook: Notebook): ValidationResult {
  const issues: ValidationIssue[] = [];
  const ext = getExtension(notebook, NOTEBOOK_EXTENSION_KEY);
  if (!ext) {
    issues.push({
      path: `metadata.extensions["${NOTEBOOK_EXTENSION_KEY}"]`,
      message: 'extension missing on executed notebook',
    });
    return { ok: false, issues };
  }
  const provenance = ext.provenance;
  if (provenance !== 'executed') {
    issues.push({
      path: `metadata.extensions["${NOTEBOOK_EXTENSION_KEY}"].provenance`,
      message: `expected "executed", got ${JSON.stringify(provenance)}`,
    });
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Validate that `metadata.extensions[org.civicaitools.execution]` matches
 * the spec §8.7.4 shape: executedAt (ISO-8601 UTC), environment.python
 * (non-empty string), environment.libraries (object), executionDuration_ms
 * (non-negative integer); sandboxId and comparisonCellPresent are optional.
 */
export function validateExecutionExtension(notebook: Notebook): ValidationResult {
  const issues: ValidationIssue[] = [];
  const ext = getExtension(notebook, EXECUTION_EXTENSION_KEY);
  if (!ext) {
    issues.push({
      path: `metadata.extensions["${EXECUTION_EXTENSION_KEY}"]`,
      message: 'extension missing — required when provenance === "executed"',
    });
    return { ok: false, issues };
  }

  const executedAt = ext.executedAt;
  if (typeof executedAt !== 'string' || !ISO_8601_REGEX.test(executedAt)) {
    issues.push({
      path: `metadata.extensions["${EXECUTION_EXTENSION_KEY}"].executedAt`,
      message: `must be ISO-8601 UTC timestamp; got ${JSON.stringify(executedAt)}`,
    });
  }

  const environment = ext.environment as Record<string, unknown> | undefined;
  if (!environment || typeof environment !== 'object') {
    issues.push({
      path: `metadata.extensions["${EXECUTION_EXTENSION_KEY}"].environment`,
      message: 'must be an object',
    });
  } else {
    if (typeof environment.python !== 'string' || environment.python.length === 0) {
      issues.push({
        path: `metadata.extensions["${EXECUTION_EXTENSION_KEY}"].environment.python`,
        message: 'must be a non-empty version string',
      });
    }
    const libs = environment.libraries as Record<string, unknown> | undefined;
    if (!libs || typeof libs !== 'object' || Array.isArray(libs)) {
      issues.push({
        path: `metadata.extensions["${EXECUTION_EXTENSION_KEY}"].environment.libraries`,
        message: 'must be an object mapping library name to pinned version',
      });
    } else if (Object.keys(libs).length === 0) {
      issues.push({
        path: `metadata.extensions["${EXECUTION_EXTENSION_KEY}"].environment.libraries`,
        message: 'must contain at least one pinned library',
      });
    }
  }

  const dur = ext.executionDuration_ms;
  if (typeof dur !== 'number' || !Number.isFinite(dur) || dur < 0 || !Number.isInteger(dur)) {
    issues.push({
      path: `metadata.extensions["${EXECUTION_EXTENSION_KEY}"].executionDuration_ms`,
      message: `must be a non-negative integer; got ${JSON.stringify(dur)}`,
    });
  }

  // Optional fields — only fail if present with wrong shape.
  if (ext.sandboxId !== undefined && typeof ext.sandboxId !== 'string') {
    issues.push({
      path: `metadata.extensions["${EXECUTION_EXTENSION_KEY}"].sandboxId`,
      message: 'when present, must be a string',
    });
  }
  if (ext.comparisonCellPresent !== undefined && typeof ext.comparisonCellPresent !== 'boolean') {
    issues.push({
      path: `metadata.extensions["${EXECUTION_EXTENSION_KEY}"].comparisonCellPresent`,
      message: 'when present, must be a boolean',
    });
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Report a notebook in which no step re-runs a data fetch (#341).
 *
 * Until this existed, a notebook whose every fetching tool call had failed
 * validated `ok`: the two validators above check extension shape, and the
 * shape of an all-failed notebook is perfectly well formed. Meanwhile its
 * synthesis cell falls back to displaying the original answer text, so the
 * original figures rendered as the document's conclusion with nothing behind
 * them, under cover text that called the analysis reproducible.
 *
 * Derived from the cells rather than from a stamped count, so it cannot be
 * satisfied by a claim: `isReproducedFetchCell` recognises the assignment the
 * renderer emits, and it is exported from the module that emits it.
 */
export function validateReproducedFetches(notebook: Notebook): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (countReproducedFetchCells(notebook.cells) === 0) {
    issues.push({
      path: 'cells',
      message:
        'no step re-runs a data fetch, so nothing in this notebook is reproducible ' +
        'against a live source — whatever it concludes rests on no request this ' +
        'document can repeat',
    });
  }
  return { ok: issues.length === 0, issues };
}

/** Run every validator and merge their issues. */
export function validateExecutedNotebook(notebook: Notebook): ValidationResult {
  const provenance = validateNotebookProvenance(notebook);
  const execution = validateExecutionExtension(notebook);
  const fetches = validateReproducedFetches(notebook);
  const issues = [...provenance.issues, ...execution.issues, ...fetches.issues];
  return { ok: issues.length === 0, issues };
}
