'use client';

import { useState } from 'react';

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
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
        This notebook reproduces the analysis steps in Python. Run it in Jupyter or upload to Google Colab.
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
