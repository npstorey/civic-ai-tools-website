'use client';

import { useState, useEffect, useRef } from 'react';
import type { ToolCall, EvidenceTrace } from '@/hooks/useStreamingComparison';
import { generateNotebook } from '@/lib/notebook';

interface PublishEvidenceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  queryText: string;
  output: string;
  toolCalls: ToolCall[];
  evidenceTrace: EvidenceTrace;
  model: string;
  portal: string;
  promptTokens?: number;
  completionTokens?: number;
  duration_ms?: number;
}

type DialogState = 'form' | 'publishing' | 'success' | 'error';

export default function PublishEvidenceDialog({
  isOpen,
  onClose,
  queryText,
  output,
  toolCalls,
  evidenceTrace,
  model,
  portal,
  promptTokens,
  completionTokens,
  duration_ms,
}: PublishEvidenceDialogProps) {
  const defaultTitle = queryText.length > 80
    ? queryText.slice(0, 77) + '...'
    : queryText;

  // Extract first paragraph of output for default summary
  const firstParagraph = output.split(/\n\n/)[0]
    ?.replace(/[#*_`\[\]>]/g, '')
    ?.trim()
    ?.slice(0, 300) || '';

  const [title, setTitle] = useState(defaultTitle);
  const [summary, setSummary] = useState(firstParagraph);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [userEditedSummary, setUserEditedSummary] = useState(false);
  const [promptVisibility, setPromptVisibility] = useState<'full_text' | 'hash_only'>('full_text');
  const [dialogState, setDialogState] = useState<DialogState>('form');
  const [resultUrl, setResultUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [urlCopied, setUrlCopied] = useState(false);

  // Track whether we've already kicked off summary generation for this session
  const summaryRequested = useRef(false);

  // Auto-generate summary when dialog opens — only once per open
  useEffect(() => {
    if (!isOpen || summaryRequested.current || userEditedSummary) return;
    summaryRequested.current = true;
    setSummaryLoading(true);

    fetch('/api/evidence/generate-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: queryText,
        output,
        toolCalls: toolCalls.map(tc => ({ name: tc.name, args: tc.args })),
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        // Only replace if the user hasn't started typing
        if (data.summary && !userEditedSummary) {
          setSummary(data.summary);
        }
      })
      .catch(() => {
        // Silently fall back to the default firstParagraph summary
      })
      .finally(() => {
        setSummaryLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePublish = async () => {
    setDialogState('publishing');
    try {
      // Generate Jupyter notebook from the same data used for the "Download Notebook"
      // button, and include it as the first evidence package extension.
      const notebook = generateNotebook(queryText, portal, toolCalls, output);

      // Capture-method selection (ADR-0003 + ADR-0004):
      // - `datHere` when the user opted into full-text prompt visibility:
      //   the chat-flow capture has all the inputs the A-G envelope requires
      //   (full prompt text, system prompt, output, trace, notebook, summary)
      //   so the package is published as a datHere-flavored envelope. The
      //   packager auto-adds the `org.civicaitools.environment` extension and
      //   promotes `summary` into canonical JSON.
      // - `chat-flow-stream` when the user selected hash_only: datHere requires
      //   full_text per OES §9.1.1, so we fall back to the wire-layer-verbatim
      //   label. Package retains its existing shape (summary stays DB-only).
      const captureMethod = promptVisibility === 'full_text' ? 'datHere' : 'chat-flow-stream';

      const response = await fetch('/api/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trace: evidenceTrace,
          prompt: queryText,
          output,
          toolCalls,
          model,
          portal,
          tokenUsage: { promptTokens, completionTokens },
          duration_ms,
          promptVisibility,
          title,
          summary,
          captureMethod,
          extensions: {
            'org.civicaitools.notebook': notebook,
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      setResultUrl(data.url);
      setDialogState('success');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Publishing failed');
      setDialogState('error');
    }
  };

  const handleClose = () => {
    setDialogState('form');
    setResultUrl('');
    setErrorMessage('');
    setUrlCopied(false);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          width: '100%',
          maxWidth: '520px',
          maxHeight: '90vh',
          overflow: 'auto',
          margin: '16px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            Publish as Evidence
          </h2>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '4px',
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div style={{ padding: '20px 24px 24px' }}>
          {/* Form state */}
          {dialogState === 'form' && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  Summary
                  {summaryLoading && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)',
                    }}>
                      <span style={{
                        width: '10px', height: '10px',
                        border: '1.5px solid var(--border-color)',
                        borderTopColor: 'var(--nyc-blue)',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                      }} />
                      Generating...
                    </span>
                  )}
                </label>
                <textarea
                  value={summary}
                  onChange={(e) => { setSummary(e.target.value); setUserEditedSummary(true); }}
                  rows={4}
                  disabled={summaryLoading && !userEditedSummary}
                  placeholder={summaryLoading ? 'Generating summary...' : ''}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    opacity: summaryLoading && !userEditedSummary ? 0.6 : 1,
                  }}
                />
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  A 2-4 sentence description for non-technical readers. Auto-generated on open — edit as needed.
                </p>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
                  Prompt visibility
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
                    <input
                      type="radio"
                      name="promptVisibility"
                      checked={promptVisibility === 'full_text'}
                      onChange={() => setPromptVisibility('full_text')}
                      style={{ marginTop: '3px' }}
                    />
                    <span>
                      Include full prompt text
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Anyone can see exactly what you asked
                      </span>
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
                    <input
                      type="radio"
                      name="promptVisibility"
                      checked={promptVisibility === 'hash_only'}
                      onChange={() => setPromptVisibility('hash_only')}
                      style={{ marginTop: '3px' }}
                    />
                    <span>
                      Hash only
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Hides your exact question while still allowing verification
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <button
                onClick={handlePublish}
                disabled={!title.trim() || !summary.trim()}
                style={{
                  width: '100%',
                  padding: '10px 20px',
                  backgroundColor: 'var(--nyc-blue)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: title.trim() && summary.trim() ? 'pointer' : 'not-allowed',
                  opacity: title.trim() && summary.trim() ? 1 : 0.5,
                }}
              >
                Publish
              </button>
            </>
          )}

          {/* Publishing state */}
          {dialogState === 'publishing' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{
                width: '24px',
                height: '24px',
                border: '3px solid var(--border-color)',
                borderTopColor: 'var(--nyc-blue)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 12px',
              }} />
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0 }}>
                Packaging and storing evidence...
              </p>
              <style jsx>{`
                @keyframes spin { to { transform: rotate(360deg); } }
              `}</style>
            </div>
          )}

          {/* Success state */}
          {dialogState === 'success' && (
            <div style={{ padding: '8px 0' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px',
                color: 'var(--nyc-success)',
              }}>
                <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                </svg>
                <span style={{ fontSize: '16px', fontWeight: 600 }}>Published</span>
              </div>

              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                Your evidence record is live at:
              </p>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 12px',
                backgroundColor: 'var(--nyc-gray-50, #f5f5f5)',
                borderRadius: '4px',
                marginBottom: '16px',
              }}>
                <code style={{
                  flex: 1,
                  fontSize: '13px',
                  wordBreak: 'break-all',
                  color: 'var(--nyc-blue)',
                }}>
                  {typeof window !== 'undefined' ? window.location.origin : ''}{resultUrl}
                </code>
                <button
                  onClick={async () => {
                    const fullUrl = `${window.location.origin}${resultUrl}`;
                    await navigator.clipboard.writeText(fullUrl);
                    setUrlCopied(true);
                    setTimeout(() => setUrlCopied(false), 2000);
                  }}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    padding: '4px 10px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    color: urlCopied ? 'var(--nyc-success)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {urlCopied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px' }}>
                The evidence page will be available once the viewing interface is built. The data is already stored and accessible via the API.
              </p>

              <button
                onClick={handleClose}
                style={{
                  width: '100%',
                  padding: '10px 20px',
                  backgroundColor: 'var(--nyc-blue)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          )}

          {/* Error state */}
          {dialogState === 'error' && (
            <div style={{ padding: '8px 0' }}>
              <div style={{
                padding: '12px',
                backgroundColor: 'rgba(236, 19, 30, 0.08)',
                borderRadius: '4px',
                marginBottom: '16px',
                fontSize: '14px',
                color: 'var(--nyc-error)',
              }}>
                {errorMessage}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setDialogState('form')}
                  style={{
                    flex: 1,
                    padding: '10px 20px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    fontSize: '14px',
                    cursor: 'pointer',
                    backgroundColor: 'white',
                  }}
                >
                  Back
                </button>
                <button
                  onClick={handlePublish}
                  style={{
                    flex: 1,
                    padding: '10px 20px',
                    backgroundColor: 'var(--nyc-blue)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
