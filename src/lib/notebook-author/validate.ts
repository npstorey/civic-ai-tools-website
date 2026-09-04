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
import {
  bodyClaim,
  claimsCompleteness,
  findCoverCell,
  parseReproductionClaim,
} from './reproduction-claim.ts';
import { countAnalysisStepCells, countReproducedFetchCells } from './tool-to-cell.ts';

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
 * is `"executed"`.
 *
 * THIS VALIDATOR IS FOR EXECUTED NOTEBOOKS AND IS NEVER RUN ON A SKELETON.
 * Since #401 the skeleton generator (`src/lib/notebook.ts`) stamps the
 * vocabulary's other value, `"skeleton"`, so a skeleton put through here
 * reports `expected "executed", got "skeleton"` — a document doing exactly what
 * it should, reported as a defect. That is a call-site error, not a reason to
 * widen the accepted values: this function's whole job is to refuse a notebook
 * that claims execution it cannot show, and a value it accepted would be a
 * value that claim could hide behind. A SKELETON IS NOT A VALIDATION FAILURE
 * AND CARRIES NO VERDICT.
 *
 * The one production caller is the executed pipeline, through
 * `validateExecutedNotebook` at `src/app/api/query-notebook/route.ts`, on a
 * notebook the sandbox has just run. `validator-not-run-on-a-skeleton.test.ts`
 * pins that — it fails when a second caller appears, and when the listed one
 * stops calling — and the guard in
 * `skeleton-states-that-it-did-not-run.test.ts` fails if the accepted values
 * are ever widened to admit `"skeleton"` here.
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

/**
 * Report a cover text whose claim about the document is not what the document
 * shows (#371, ruling D3).
 *
 * `validateReproducedFetches` above answers one question — is anything
 * reproduced at all — and reported only at zero, so a notebook where three of
 * four fetches were rejected passed while telling its reader the analysis was
 * complete. This asks the harder question: does the cover cell's stated count
 * match the cells under it, and does it assert completeness at all.
 *
 * Both numbers are derived FROM THE CELLS, by the same detectors the renderers
 * own, so a notebook cannot satisfy this by stamping a number on itself. The
 * cover cell is found BY CONTENT, not at index 0: `/api/evidence/[slug]/bundle`
 * prepends a commitment cell before a reader downloads the file.
 *
 * A notebook with no cover cell is reported rather than skipped. Skipping it
 * would make this check pass for exactly the document it cannot read, which is
 * the one shape a validator may not treat as clean.
 */
export function validateCoverClaims(notebook: Notebook): ValidationResult {
  const issues: ValidationIssue[] = [];
  const cover = findCoverCell(notebook.cells);
  if (!cover) {
    issues.push({
      path: 'cells',
      message:
        'no cover cell: this notebook states nothing about how much of itself re-runs a ' +
        'live request, so a reader has no claim to check against the steps below',
    });
    return { ok: false, issues };
  }

  const coverText = cover.source.join('');
  const reRun = countReproducedFetchCells(notebook.cells);
  const steps = countAnalysisStepCells(notebook.cells);
  const stated = parseReproductionClaim(coverText);

  if (stated === null) {
    if (steps > 0) {
      issues.push({
        path: 'cells',
        message:
          `the cover text states no count, and the cells show ${reRun} of ${steps} steps ` +
          're-running a live request — a reader is left to infer from the body how much of ' +
          'this notebook rests on data it fetched',
      });
    }
  } else if (stated.reRun !== reRun || stated.steps !== steps) {
    issues.push({
      path: 'cells',
      message:
        `the cover text claims ${stated.reRun} of ${stated.steps} steps re-run a live ` +
        `request; the cells show ${reRun} of ${steps}`,
    });
  }

  if (claimsCompleteness(coverText)) {
    issues.push({
      path: 'cells',
      message:
        'the cover text calls the analysis complete. "a complete, reproducible analysis" is ' +
        'not a claim this document can make as a bare adjective: it re-runs a live request ' +
        `in ${reRun} of its ${steps} analysis steps, and the count is what it must say`,
    });
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Report a bare completeness claim anywhere in the document, not only in the
 * cover (#384 P8, F3).
 *
 * `validateCoverClaims` reads the cover section, by design: that is where the
 * count lives and where a reader's own question sits five lines above it. The
 * step-section header then said "the analysis is fully reproducible" two
 * cells down, under a cover stating "1 of its 3", and nothing could see it.
 *
 * THE SCOPE, and how it is determined. Every markdown cell is a cell the
 * generator authored — the model's answer is a CODE cell (`display(Markdown
 * (…))`) and code output is never a cell source — so the universe is
 * `cell_type === 'markdown'`. The cover cell (found by content) is left to
 * `validateCoverClaims`, which reads its own section body and never the
 * `**Query:**` line. Every other markdown cell is read through
 * `markdownProse`, which strips the channels a data value reaches markdown
 * through (code spans and fences, link targets, double-quoted strings,
 * prefixed identifiers — see its header for the measurement), so a search
 * phrase, a fetch id, a dataset id or a where clause cannot be read as a
 * claim. The words are the cover check's own.
 */
export function validateBodyClaims(notebook: Notebook): ValidationResult {
  const issues: ValidationIssue[] = [];
  const cover = findCoverCell(notebook.cells);
  notebook.cells.forEach((cell, index) => {
    if (cell.cell_type !== 'markdown' || cell === cover) return;
    const claim = bodyClaim(Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? ''));
    if (claim === null) return;
    issues.push({
      path: `cells[${index}]`,
      message:
        `a cell outside the cover calls the analysis complete or fully reproducible: ${JSON.stringify(claim)}. ` +
        'The cover states how many steps re-run a live request, and that count is the only claim this ' +
        'document can make about itself',
    });
  });
  return { ok: issues.length === 0, issues };
}

/** Run every validator and merge their issues. */
export function validateExecutedNotebook(notebook: Notebook): ValidationResult {
  const provenance = validateNotebookProvenance(notebook);
  const execution = validateExecutionExtension(notebook);
  const fetches = validateReproducedFetches(notebook);
  const cover = validateCoverClaims(notebook);
  const body = validateBodyClaims(notebook);
  const issues = [...provenance.issues, ...execution.issues, ...fetches.issues, ...cover.issues, ...body.issues];
  return { ok: issues.length === 0, issues };
}
