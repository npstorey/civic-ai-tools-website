'use client';

import { useState } from 'react';
// What this section tells a reader about reproduction is read off the notebook
// in hand, never asserted beside the download button (#371). The parser is a
// pure string module with one type-only import; see its header for why it is
// not in `prompt.ts` with the builder.
import { readReproductionClaim } from '@/lib/notebook-author/reproduction-claim';
// Whether the notebook RAN is read off the notebook too, and is the first thing
// this section says (#401). Same client-safety constraint as the parser above —
// see the reader's header. The three readings and their words are decided
// there; this component renders what it is handed.
import { readNotebookProvenanceOfNotebook } from '@/lib/notebook-author/notebook-provenance-reading';
import TrustSignal from './TrustSignal';

interface NotebookCell {
  cell_type: 'code' | 'markdown';
  metadata?: Record<string, unknown>;
  source: string[] | string;
}

interface Notebook {
  nbformat?: number;
  nbformat_minor?: number;
  metadata?: Record<string, unknown>;
  cells?: NotebookCell[];
}

interface NotebookSectionProps {
  notebook: unknown;
  slug: string;
}

function cellSource(cell: NotebookCell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
}

export default function NotebookSection({ notebook, slug }: NotebookSectionProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  // Defensive type narrowing — extensions may be arbitrary JSON
  const nb = notebook as Notebook | null;
  const cells = Array.isArray(nb?.cells) ? nb.cells : [];
  const codeCells = cells.filter(c => c.cell_type === 'code');
  const totalCells = cells.length;

  // The claim this notebook makes about itself, or nothing. Until #371 this
  // section told every reader "This notebook reproduces the analysis steps in
  // Python" — a sentence that was equally true of a notebook where every fetch
  // was rejected, hardcoded above a download button that could not see the
  // cells. It can see them; the count is now read from the cover cell that
  // states it.
  //
  // `null` covers three cases and deliberately does not distinguish them: a
  // notebook published before the cover carried a count (stored package bytes
  // are never regenerated), one whose cover cell is absent, and one that renders
  // no analysis step and so has no ratio to state. In all three this section has
  // no signal, so it shows none — docs/design-principles.md Principle 3.
  const claim = readReproductionClaim(cells);

  // What this notebook says about whether it ran — executed, skeleton, or
  // neither. Always rendered, because the reading has three values and one of
  // them is "nothing was stated": showing the row only when a stamp is present
  // would put a package that predates the field back where #401 found it, silent
  // and therefore read as executed. All three are the calm tier; none is a
  // failure (docs/design-principles.md P1, P3).
  const ran = readNotebookProvenanceOfNotebook(notebook);

  const handleDownload = () => {
    const json = JSON.stringify(notebook, null, 2);
    const blob = new Blob([json], { type: 'application/x-ipynb+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `record-${slug}.ipynb`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{
      padding: '16px 20px', border: '1px solid var(--border-color)',
      borderRadius: '6px', backgroundColor: 'white',
    }}>
      <div style={{ marginBottom: '10px' }}>
        <TrustSignal tier={ran.tier} label={ran.label} detail={ran.detail} />
      </div>

      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
        {claim !== null && (
          <>
            This notebook re-runs a live request in {claim.reRun} of its {claim.steps} analysis
            steps.{' '}
          </>
        )}
        The steps are Python. Run it in Jupyter or upload to Google Colab.
      </p>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: previewOpen ? '16px' : 0, flexWrap: 'wrap' }}>
        <button
          onClick={handleDownload}
          style={{
            background: 'none', border: '1px solid var(--accent)', borderRadius: '4px',
            padding: '6px 14px', fontSize: '13px', cursor: 'pointer',
            color: 'var(--accent)', fontWeight: 500,
          }}
        >
          Download Notebook (.ipynb)
        </button>
        <button
          onClick={() => setPreviewOpen(!previewOpen)}
          style={{
            background: 'none', border: 'none', padding: '6px 8px',
            fontSize: '12px', cursor: 'pointer', color: 'var(--accent)',
          }}
        >
          {previewOpen ? 'Hide preview' : `Preview cells (${codeCells.length} code, ${totalCells} total)`}
        </button>
      </div>

      {previewOpen && codeCells.length > 0 && (
        <div>
          {codeCells.map((cell, i) => (
            <div key={i} style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>
                Code cell {i + 1}
              </div>
              <pre style={{
                padding: '10px 12px', backgroundColor: '#f5f5f5', borderRadius: '4px',
                fontSize: '12px', lineHeight: 1.5, overflow: 'auto', maxHeight: '200px',
                whiteSpace: 'pre', margin: 0,
              }}>
                {cellSource(cell)}
              </pre>
            </div>
          ))}
        </div>
      )}

      {previewOpen && codeCells.length === 0 && (
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
          No code cells in this notebook.
        </p>
      )}
    </div>
  );
}
