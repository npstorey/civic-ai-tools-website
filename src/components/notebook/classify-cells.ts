/**
 * Phase 2a renderer helper — partition an executed notebook's cells into
 * the regions the chat UI surfaces differently (setup vs. analysis trail
 * vs. synthesis answer vs. footer vs. comparison cell).
 *
 * The notebook structure is set by `src/lib/notebook-author/synthesize.ts`
 * and Phase D's `stampExecutedNotebook`. We detect each region by
 * structural hints in the cell source rather than by strict index so that
 * small future shape changes do not break rendering.
 */
import type { Notebook, NotebookCell } from '@/lib/notebook-author';

export interface ClassifiedCells {
  setup: NotebookCell[];
  analysis: NotebookCell[];
  synthesis: NotebookCell | null;
  footer: NotebookCell | null;
  comparison: NotebookCell | null;
}

function sourceText(cell: NotebookCell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
}

function isSynthesisCell(cell: NotebookCell): boolean {
  if (cell.cell_type !== 'markdown') return false;
  return /^\s*##\s+Synthesis\b/m.test(sourceText(cell));
}

function isFooterCell(cell: NotebookCell): boolean {
  if (cell.cell_type !== 'markdown') return false;
  const src = sourceText(cell);
  return /^\s*##\s+Citations\b/m.test(src) && /^\s*##\s+Reproducibility\b/m.test(src);
}

function isComparisonHeaderCell(cell: NotebookCell): boolean {
  if (cell.cell_type !== 'markdown') return false;
  return /^\s*##\s+Comparison:\s+original vs\.?\s+current/im.test(sourceText(cell));
}

function isComparisonCell(cell: NotebookCell): boolean {
  if (cell.cell_type !== 'code') return false;
  const src = sourceText(cell);
  return src.includes('ORIGINAL VALUES') && src.includes('recompute_key_metrics');
}

function isMetricCaptureCell(cell: NotebookCell): boolean {
  if (cell.cell_type !== 'code') return false;
  const src = sourceText(cell);
  return src.includes('_civic_capture=') && src.includes('_json.dumps');
}

function isCell4Header(cell: NotebookCell): boolean {
  if (cell.cell_type !== 'markdown') return false;
  return /^\s*##?\s+Data Analysis Pipeline\b/m.test(sourceText(cell));
}

export function classifyCells(notebook: Notebook): ClassifiedCells {
  const cells = notebook.cells;
  if (cells.length === 0) {
    return { setup: [], analysis: [], synthesis: null, footer: null, comparison: null };
  }

  let comparison: NotebookCell | null = null;
  let synthesis: NotebookCell | null = null;
  let footer: NotebookCell | null = null;
  let pipelineHeaderIdx = -1;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (isComparisonCell(cell)) comparison = cell;
    if (isSynthesisCell(cell)) synthesis = cell;
    if (footer === null && isFooterCell(cell)) footer = cell;
    if (pipelineHeaderIdx === -1 && isCell4Header(cell)) pipelineHeaderIdx = i;
  }

  // Setup region — everything up to (but not including) the pipeline header.
  // If the header is missing (defensive), treat the first 4 cells as setup.
  const setupEnd = pipelineHeaderIdx === -1 ? Math.min(4, cells.length) : pipelineHeaderIdx;
  const setup = cells.slice(0, setupEnd);

  // Analysis region — pipeline header onward, minus the synthesis/footer/
  // comparison cells (those are surfaced separately) and the metric-capture
  // and comparison-header cells (those are internals the renderer absorbs).
  const analysis: NotebookCell[] = [];
  for (let i = setupEnd; i < cells.length; i++) {
    const cell = cells[i];
    if (cell === synthesis) continue;
    if (cell === footer) continue;
    if (cell === comparison) continue;
    if (isMetricCaptureCell(cell)) continue;
    if (isComparisonHeaderCell(cell)) continue;
    analysis.push(cell);
  }

  return { setup, analysis, synthesis, footer, comparison };
}
