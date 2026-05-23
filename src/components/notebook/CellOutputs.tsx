'use client';

/**
 * Render the `outputs` array of a Jupyter code cell. Covers the four output
 * types the Vercel Sandbox python3.13 runtime emits when executing the
 * executed-notebook structure:
 *
 *   - `stream` (stdout / stderr) — pre/code formatting.
 *   - `display_data` / `execute_result` with `text/html` — DataFrame tables,
 *     rendered as raw HTML (pandas emits a safe `<table>` here).
 *   - `display_data` / `execute_result` with `image/png` — matplotlib charts,
 *     decoded from base64.
 *   - `display_data` / `execute_result` with `text/plain` only — small
 *     scalar / repr.
 *   - `error` — traceback string array.
 */

interface JupyterOutputBase {
  output_type: string;
}

interface JupyterStreamOutput extends JupyterOutputBase {
  output_type: 'stream';
  name?: 'stdout' | 'stderr';
  text?: string | string[];
}

interface JupyterMimeBundle {
  [mime: string]: string | string[] | unknown;
}

interface JupyterRichOutput extends JupyterOutputBase {
  output_type: 'display_data' | 'execute_result';
  data?: JupyterMimeBundle;
  metadata?: Record<string, unknown>;
}

interface JupyterErrorOutput extends JupyterOutputBase {
  output_type: 'error';
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

type JupyterOutput = JupyterStreamOutput | JupyterRichOutput | JupyterErrorOutput | JupyterOutputBase;

function joinSource(value: string | string[] | unknown): string {
  if (Array.isArray(value)) return value.join('');
  if (typeof value === 'string') return value;
  return '';
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

const stderrBlockStyle: React.CSSProperties = {
  ...codeBlockStyle,
  background: 'rgba(236, 19, 30, 0.04)',
  borderColor: 'rgba(236, 19, 30, 0.4)',
  color: 'var(--nyc-error, #ec131e)',
};

function StreamOutput({ output }: { output: JupyterStreamOutput }) {
  const text = joinSource(output.text);
  if (!text) return null;
  return (
    <pre style={output.name === 'stderr' ? stderrBlockStyle : codeBlockStyle}>{text}</pre>
  );
}

function HtmlTableOutput({ html }: { html: string }) {
  return (
    <div
      className="notebook-output-table"
      style={{
        overflowX: 'auto',
        border: '1px solid var(--border-color, #e5e5e5)',
        borderRadius: '4px',
      }}
      // pandas-emitted DataFrame HTML is a static <table>. We constrain it
      // visually in CSS rather than parsing/transforming it.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function PngImageOutput({ pngBase64 }: { pngBase64: string }) {
  // pandas / matplotlib emits already-base64-encoded PNG bytes.
  const trimmed = pngBase64.trim();
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`data:image/png;base64,${trimmed}`}
      alt="Notebook output chart"
      style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
    />
  );
}

function RichOutput({ output }: { output: JupyterRichOutput }) {
  const data = output.data ?? {};
  const html = joinSource(data['text/html']);
  if (html) return <HtmlTableOutput html={html} />;
  const png = joinSource(data['image/png']);
  if (png) return <PngImageOutput pngBase64={png} />;
  const plain = joinSource(data['text/plain']);
  if (plain) return <pre style={codeBlockStyle}>{plain}</pre>;
  return null;
}

function ErrorOutput({ output }: { output: JupyterErrorOutput }) {
  const lines = (output.traceback ?? []).map(stripAnsi).join('\n');
  const header = `${output.ename ?? 'Error'}: ${output.evalue ?? ''}`.trim();
  return (
    <pre style={stderrBlockStyle}>{[header, lines].filter(Boolean).join('\n')}</pre>
  );
}

const ANSI_PATTERN = /\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, '');
}

export function CellOutputs({ outputs }: { outputs: unknown[] | undefined }) {
  if (!outputs || outputs.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
      {outputs.map((raw, i) => {
        const out = raw as JupyterOutput;
        switch (out.output_type) {
          case 'stream':
            return <StreamOutput key={i} output={out as JupyterStreamOutput} />;
          case 'display_data':
          case 'execute_result':
            return <RichOutput key={i} output={out as JupyterRichOutput} />;
          case 'error':
            return <ErrorOutput key={i} output={out as JupyterErrorOutput} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
