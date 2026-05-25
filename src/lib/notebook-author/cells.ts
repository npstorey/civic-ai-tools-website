/**
 * Low-level Jupyter notebook cell builders for the executed-notebook path.
 *
 * Mirrors the existing skeleton-notebook generator in `src/lib/notebook.ts`
 * but exported standalone so the executed-notebook synthesizer can compose
 * cells without pulling in the client-side ToolCall type. Stays compatible
 * with Jupyter nbformat v4.5+ (which is what the chat-flow skeleton emits).
 */
export type CellSource = string | readonly string[];

export interface NotebookCell {
  cell_type: 'code' | 'markdown';
  /** nbformat v4.5 required cell id. Auto-assigned by the cell builders so
   *  jupyter nbconvert / nbformat don't emit MissingIDFieldWarning. */
  id: string;
  metadata: Record<string, unknown>;
  source: string[];
  outputs?: unknown[];
  execution_count?: number | null;
}

/** Cell-id counter to give every cell a unique id within the notebook.
 *  nbformat v4.5 requires the id field (1–64 chars, alphanumeric +
 *  `_-`); nbconvert otherwise emits MissingIDFieldWarning. The counter is
 *  per-process and per-notebook is acceptable for the v1 cell-id scheme
 *  because a fresh notebook is built once per pipeline invocation and the
 *  id only needs to be unique inside that notebook. */
let _cellIdCounter = 0;
function nextCellId(): string {
  _cellIdCounter += 1;
  return `cell-${_cellIdCounter.toString(36).padStart(4, '0')}`;
}

/** Test-only: reset the cell-id counter between assertions so the ids in
 *  a fresh notebook are reproducible (cell-0001, cell-0002, …). */
export function _resetCellIdCounterForTests(): void {
  _cellIdCounter = 0;
}

export interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: {
    kernelspec: { display_name: string; language: string; name: string };
    language_info: { name: string; version: string };
    extensions?: Record<string, unknown>;
    [key: string]: unknown;
  };
  cells: NotebookCell[];
}

/**
 * Coerce a string-or-lines source into the Jupyter cell-source shape
 * (array of strings, each terminated by `\n` except the last).
 */
export function asSourceLines(source: CellSource): string[] {
  const lines = typeof source === 'string' ? source.split('\n') : Array.from(source);
  return lines.map((l, i) => (i < lines.length - 1 ? l + '\n' : l));
}

export function markdownCell(source: CellSource, metadata: Record<string, unknown> = {}): NotebookCell {
  return {
    cell_type: 'markdown',
    id: nextCellId(),
    metadata,
    source: asSourceLines(source),
  };
}

export function codeCell(source: CellSource, metadata: Record<string, unknown> = {}): NotebookCell {
  return {
    cell_type: 'code',
    id: nextCellId(),
    metadata,
    source: asSourceLines(source),
    outputs: [],
    execution_count: null,
  };
}

/**
 * Build an empty Jupyter v4.5 notebook with the kernel/language metadata
 * that the Vercel Sandbox python3.13 runtime expects. Callers fill in
 * `cells` and optionally `metadata.extensions`.
 */
export function emptyNotebook(pythonVersion = '3.13'): Notebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: pythonVersion,
      },
    },
    cells: [],
  };
}
