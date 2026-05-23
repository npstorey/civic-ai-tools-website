'use client';

/**
 * Phase 2a N7 — render an executed notebook in the chat output area.
 *
 * Layout:
 *   - "About this analysis" + "Setup" disclosures (collapsed by default) —
 *     onboarding markdown + env/imports/helpers code cells.
 *   - Analysis trail — pipeline header + alternating markdown / code-with-
 *     outputs pairs (rendered prominently — this is the per-step trail).
 *   - Synthesis cell — the prominent "answer" body.
 *   - Comparison cell — visually distinct callout box at the end.
 *   - Footer — citations + reproducibility metadata in a small disclosure.
 *
 * Honest framing: this component never "summarizes" the notebook into a
 * different shape. It renders cells in order; the synthesis cell IS the
 * answer, the comparison cell IS the reproducibility surface.
 */
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Notebook, NotebookCell } from '@/lib/notebook-author';
import { CellOutputs } from './CellOutputs';
import { classifyCells } from './classify-cells';

interface NotebookRendererProps {
  notebook: Notebook;
  validation?: { ok: boolean; issues: { path: string; message: string }[] };
}

function sourceText(cell: NotebookCell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '');
}

const codeBlockStyle: React.CSSProperties = {
  margin: 0,
  padding: '12px 16px',
  background: 'var(--card-background, #fafafa)',
  border: '1px solid var(--border-color, #e5e5e5)',
  borderRadius: '4px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '13px',
  lineHeight: '1.5',
  whiteSpace: 'pre-wrap',
  overflowX: 'auto',
};

function MarkdownCellView({ cell }: { cell: NotebookCell }) {
  return (
    <div className="response-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{sourceText(cell)}</ReactMarkdown>
    </div>
  );
}

function CodeCellView({ cell, hideSource }: { cell: NotebookCell; hideSource?: boolean }) {
  const src = sourceText(cell);
  const [sourceVisible, setSourceVisible] = useState(!hideSource);
  return (
    <div>
      {hideSource && (
        <button
          type="button"
          onClick={() => setSourceVisible((v) => !v)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '4px 0',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
          aria-expanded={sourceVisible}
        >
          {sourceVisible ? '▾' : '▸'} {sourceVisible ? 'Hide code' : 'Show code'}
        </button>
      )}
      {sourceVisible && <pre style={codeBlockStyle}>{src}</pre>}
      <CellOutputs outputs={cell.outputs} />
    </div>
  );
}

function CellView({ cell, hideSource }: { cell: NotebookCell; hideSource?: boolean }) {
  return cell.cell_type === 'markdown'
    ? <MarkdownCellView cell={cell} />
    : <CodeCellView cell={cell} hideSource={hideSource} />;
}

function Disclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        border: '1px solid var(--border-color, #e5e5e5)',
        borderRadius: '4px',
        background: 'var(--nyc-white, #ffffff)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          padding: '12px 16px',
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '12px' }}>{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && (
        <div
          style={{
            padding: '0 16px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function ComparisonCellCallout({ cell }: { cell: NotebookCell }) {
  return (
    <div
      style={{
        border: '2px solid var(--nyc-blue, #0039a6)',
        borderRadius: '4px',
        background: 'rgba(0, 57, 166, 0.04)',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
      aria-labelledby="notebook-comparison-heading"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: 'var(--nyc-blue, #0039a6)',
          }}
        />
        <h3
          id="notebook-comparison-heading"
          style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--nyc-blue, #0039a6)' }}
        >
          Reproducibility check — original vs. current
        </h3>
      </div>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        These values were captured when the notebook was first executed.
        Re-executing the notebook below recomputes them against live data
        and prints the deltas. The notebook is honest about drift.
      </p>
      <CodeCellView cell={cell} hideSource={false} />
    </div>
  );
}

function ValidationBanner({
  validation,
}: {
  validation: NonNullable<NotebookRendererProps['validation']>;
}) {
  if (validation.ok) return null;
  return (
    <div
      role="status"
      style={{
        border: '1px solid var(--nyc-error, #ec131e)',
        background: 'rgba(236, 19, 30, 0.06)',
        color: 'var(--nyc-error, #ec131e)',
        borderRadius: '4px',
        padding: '12px 16px',
        fontSize: '13px',
      }}
    >
      <strong>Notebook validation issues:</strong>
      <ul style={{ margin: '4px 0 0 16px' }}>
        {validation.issues.map((issue, i) => (
          <li key={i}>
            <code>{issue.path}</code>: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function NotebookRenderer({ notebook, validation }: NotebookRendererProps) {
  const { setup, analysis, synthesis, footer, comparison } = classifyCells(notebook);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        maxWidth: '900px',
        margin: '0 auto',
      }}
    >
      {validation && <ValidationBanner validation={validation} />}

      {setup.length > 0 && (
        <Disclosure title="Setup — environment, imports, and helper functions">
          {setup.map((cell, i) => (
            <CellView key={`setup-${i}`} cell={cell} hideSource={cell.cell_type === 'code'} />
          ))}
        </Disclosure>
      )}

      {analysis.length > 0 && (
        <section
          aria-labelledby="notebook-analysis-heading"
          style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
        >
          {analysis.map((cell, i) => (
            <CellView
              key={`analysis-${i}`}
              cell={cell}
              hideSource={cell.cell_type === 'code'}
            />
          ))}
        </section>
      )}

      {synthesis && (
        <section
          aria-labelledby="notebook-synthesis-heading"
          style={{
            borderLeft: '4px solid var(--nyc-success, #00b703)',
            background: 'rgba(0, 183, 3, 0.04)',
            padding: '16px 20px',
            borderRadius: '0 4px 4px 0',
          }}
        >
          <MarkdownCellView cell={synthesis} />
        </section>
      )}

      {comparison && <ComparisonCellCallout cell={comparison} />}

      {footer && (
        <Disclosure title="Citations, reproducibility guide, and generation metadata">
          <MarkdownCellView cell={footer} />
        </Disclosure>
      )}
    </div>
  );
}
