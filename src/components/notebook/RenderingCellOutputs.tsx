'use client';

/**
 * Phase 2a2 item 2: render the outputs of the rendering code cell tagged
 * `metadata.role === "synthesis"` as the sandbox produced them. Each output
 * is one of:
 *
 *   - `stream` (stdout / stderr) → rendered as plain monospaced text
 *   - `display_data` / `execute_result` → mime-bundle; prefer text/markdown,
 *     then text/html, then image/png, then text/plain (last-resort)
 *   - `error` → ename/evalue/traceback in a red error block (should not
 *     occur for a passing synthesis cell)
 *
 * Section F of the chat-output A-G renderer delegates to this component
 * when the executed notebook carries a rendering code cell. Legacy
 * notebooks fall back to ReactMarkdown on the `## Synthesis` markdown body
 * (handled in ChatNotebookOutput.tsx).
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NotebookOutput } from './buildChatEvidenceView';

function flattenText(text: string | string[] | undefined): string {
  if (!text) return '';
  return Array.isArray(text) ? text.join('') : text;
}

function flattenMime(value: string | string[] | undefined): string {
  return flattenText(value);
}

/** A single output rendered into a self-contained block. Pure render, no
 *  side effects. */
function OutputBlock({ output, index }: { output: NotebookOutput; index: number }) {
  const type = output.output_type;

  if (type === 'stream') {
    const text = flattenText(output.text);
    const isStderr = output.name === 'stderr';
    return (
      <pre
        key={index}
        style={{
          margin: 0,
          padding: '8px 12px',
          background: isStderr ? 'rgba(220, 38, 38, 0.06)' : '#f5f5f5',
          borderLeft: isStderr ? '3px solid #dc2626' : 'none',
          borderRadius: '4px',
          fontSize: '13px',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
          color: isStderr ? '#9b1c1c' : 'var(--text-primary)',
        }}
      >
        {text}
      </pre>
    );
  }

  if (type === 'display_data' || type === 'execute_result') {
    const data = output.data || {};
    const md = flattenMime(data['text/markdown'] as string | string[] | undefined);
    if (md && md.trim().length > 0) {
      return (
        <div
          key={index}
          style={{
            fontSize: '15px',
            lineHeight: 1.6,
            color: 'var(--text-primary)',
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
        </div>
      );
    }
    const html = flattenMime(data['text/html'] as string | string[] | undefined);
    if (html && html.trim().length > 0) {
      return (
        <div
          key={index}
          style={{ fontSize: '14px', overflow: 'auto' }}
          // Sandbox-emitted HTML — pandas DataFrame HTML in particular. The
          // sandbox executes notebook-author-supplied code, so this string
          // is not user-input from another origin; it's emitted by our own
          // signed sandbox pipeline. Phase 3 spec-side review may revisit
          // whether to sanitize as defense-in-depth.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }
    const pngB64 = flattenMime(data['image/png'] as string | string[] | undefined);
    if (pngB64 && pngB64.trim().length > 0) {
      return (
        <img
          key={index}
          src={`data:image/png;base64,${pngB64.trim()}`}
          alt="Synthesis cell output (image/png)"
          style={{ maxWidth: '100%', display: 'block', margin: '4px 0' }}
        />
      );
    }
    const plain = flattenMime(data['text/plain'] as string | string[] | undefined);
    if (plain && plain.trim().length > 0) {
      return (
        <pre
          key={index}
          style={{
            margin: 0,
            padding: '8px 12px',
            background: '#f5f5f5',
            borderRadius: '4px',
            fontSize: '13px',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
            color: 'var(--text-primary)',
          }}
        >
          {plain}
        </pre>
      );
    }
    return null;
  }

  if (type === 'error') {
    const traceback = Array.isArray(output.traceback) ? output.traceback.join('\n') : '';
    return (
      <pre
        key={index}
        style={{
          margin: 0,
          padding: '8px 12px',
          background: 'rgba(220, 38, 38, 0.06)',
          borderLeft: '3px solid #dc2626',
          borderRadius: '4px',
          fontSize: '13px',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
          color: '#9b1c1c',
        }}
      >
        {`${output.ename ?? 'Error'}: ${output.evalue ?? ''}\n${traceback}`}
      </pre>
    );
  }

  return null;
}

export default function RenderingCellOutputs({ outputs }: { outputs: NotebookOutput[] }) {
  if (outputs.length === 0) {
    return (
      <em style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
        The synthesis cell did not produce any outputs.
      </em>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {outputs.map((output, i) => (
        <OutputBlock key={i} output={output} index={i} />
      ))}
    </div>
  );
}
