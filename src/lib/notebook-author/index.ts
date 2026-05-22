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
  validateExecutedNotebook,
} from './validate.ts';
export {
  NOTEBOOK_EXTENSION_KEY,
  EXECUTION_EXTENSION_KEY,
  PINNED_LIBRARIES,
  PYTHON_RUNTIME_VERSION,
} from './prompt.ts';
