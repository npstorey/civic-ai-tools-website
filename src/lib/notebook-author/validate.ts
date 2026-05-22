/**
 * Light-touch schema validator for the executed-notebook extensions per
 * OES §9.1.4 (specified by ADR-0005). Phase 1 owns this local sanity check
 * before the route returns the notebook; Phase 3 owns the full packager-
 * side enforcement when executed notebooks become evidence-package
 * payloads.
 *
 * The validator is intentionally narrow: it verifies the extension keys
 * exist, mandatory fields are present, and types are roughly right. It
 * does NOT do deep canonical-JSON validation — that lives in the
 * `civic-ai-tools-website/src/lib/evidence/packager.ts` Phase 3 work.
 */
import type { Notebook } from './cells.ts';
import { EXECUTION_EXTENSION_KEY, NOTEBOOK_EXTENSION_KEY } from './prompt.ts';

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
 * the OES §9.1.4 shape: executedAt (ISO-8601 UTC), environment.python
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

/** Run both validators and merge their issues. */
export function validateExecutedNotebook(notebook: Notebook): ValidationResult {
  const provenance = validateNotebookProvenance(notebook);
  const execution = validateExecutionExtension(notebook);
  const issues = [...provenance.issues, ...execution.issues];
  return { ok: issues.length === 0, issues };
}
