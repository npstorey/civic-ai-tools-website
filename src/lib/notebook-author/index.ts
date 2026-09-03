/**
 * Public API for the executed-notebook synthesis pipeline (ADR-0005,
 * project-plan §6 Phase 1). Compose:
 *
 *   1. Capture Phase A outputs via the existing chat-flow streaming
 *      (`src/lib/openrouter-streaming.ts:queryWithMcpStreaming`).
 *   2. Build the pre-execution notebook with `synthesizeNotebook`.
 *   3. Submit it to Vercel Sandbox via `src/lib/sandbox/execute.ts`.
 *   4. Append the comparison cell + stamp execution metadata with
 *      `stampExecutedNotebook`.
 *   5. Validate the result with `validateExecutedNotebook` before
 *      returning to the client.
 */
export type { Notebook, NotebookCell, CellSource } from './cells.ts';
export { codeCell, markdownCell, emptyNotebook } from './cells.ts';
export type { PhaseAToolCall } from './tool-to-cell.ts';
export type { PhaseAOutputs, SynthesisOutputs } from './synthesize.ts';
export { synthesizeNotebook } from './synthesize.ts';
export type { ExecutionMetadata, StampOutputs } from './phase-d.ts';
export {
  extractCapturedMetrics,
  buildMetricCaptureCell,
  buildComparisonCell,
  stampExecutedNotebook,
} from './phase-d.ts';
export type { ValidationIssue, ValidationResult } from './validate.ts';
export {
  validateNotebookProvenance,
  validateExecutionExtension,
  // The two cell-derived checks are on the public API alongside the aggregate:
  // both answer a question about what the document CLAIMS, and a caller that
  // wants one of those answers without the extension-shape checks could not
  // reach it through `validateExecutedNotebook` alone.
  validateReproducedFetches,
  validateCoverClaims,
  validateExecutedNotebook,
} from './validate.ts';
export type { ReproductionClaim } from './reproduction-claim.ts';
export {
  COVER_SECTION_HEADING,
  coverSectionBody,
  reproductionClaimSentence,
  parseReproductionClaim,
  readReproductionClaim,
  claimsCompleteness,
} from './reproduction-claim.ts';
export {
  NOTEBOOK_EXTENSION_KEY,
  EXECUTION_EXTENSION_KEY,
  SUMMARY_EXTENSION_KEY,
  SYNTHESIS_CELL_ROLE,
  PINNED_LIBRARIES,
  PYTHON_RUNTIME_VERSION,
  buildSynthesisCellSource,
  parseSynthesisOutput,
} from './prompt.ts';
export type { StructuredSummary, ParsedSynthesisOutput } from './prompt.ts';
