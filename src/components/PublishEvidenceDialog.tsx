'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ToolCall, EvidenceTrace } from '@/hooks/useStreamingComparison';
import { generateNotebook } from '@/lib/notebook';
import type { Notebook } from '@/lib/notebook-author/cells';
import { normalizeVisibility } from '@/lib/evidence/visibility';

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
  /** #112: the EXECUTED notebook from a signed-sandbox session. When present,
   *  it is carried into the package verbatim — its metadata already holds the
   *  `org.civicaitools.execution` extension and the
   *  `notebookProvenance: "executed"` discriminator (Q31) — instead of
   *  regenerating a skeleton via generateNotebook. */
  executedNotebook?: Notebook | null;
  /** #112: pre-fill for the summary field (e.g. the notebook's structured
   *  two-clause summary). When provided, the LLM auto-generation is skipped. */
  initialSummary?: string;
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
  executedNotebook,
  initialSummary,
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
  const [summary, setSummary] = useState(initialSummary || firstParagraph);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [userEditedSummary, setUserEditedSummary] = useState(false);
  const [promptVisibility, setPromptVisibility] = useState<'full_text' | 'hash_only'>('full_text');
  // Visibility choice (civic-ai-tools#71 scope item 7): COMMITTED is the
  // default — attest by default, publish by choice. The request-level flag is
  // sent explicitly either way (the API's own default stays "published" for
  // client back-compat; the UI default is the product decision).
  const [visibility, setVisibility] = useState<'committed' | 'published'>('committed');
  const [resultVisibility, setResultVisibility] = useState<'committed' | 'published'>('published');
  const [dialogState, setDialogState] = useState<DialogState>('form');
  const [resultUrl, setResultUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [urlCopied, setUrlCopied] = useState(false);
  // Unsigned-tier gate-off (ADR-0020, S3a P3): whether this instance holds a
  // signing key, fetched presence-only from /api/evidence/signing-status.
  // null = not yet known (treated as available; the SERVER gate is the
  // enforcement — this state only drives the explanatory affordance).
  const [signingConfigured, setSigningConfigured] = useState<boolean | null>(null);

  const router = useRouter();

  // Track whether we've already kicked off summary generation for this session
  const summaryRequested = useRef(false);
  // Track whether we've asked for the signing tier for this open.
  const signingStatusRequested = useRef(false);

  // Ask the producer tier once per dialog session. When the instance runs
  // unsigned, the seal/commit server gate refuses every persist — render a
  // disabled action with an explanation instead of a dead button that errors.
  useEffect(() => {
    if (!isOpen || signingStatusRequested.current) return;
    signingStatusRequested.current = true;
    fetch('/api/evidence/signing-status')
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        setSigningConfigured(data.signingConfigured !== false);
      })
      .catch(() => {
        // Unknown tier → leave the action enabled; the server gate still
        // enforces and its refusal message renders in the error state.
        setSigningConfigured(null);
      });
  }, [isOpen]);

  // Auto-generate summary when dialog opens — only once per open. Skipped
  // when a structured summary was provided (#112: the executed notebook's
  // two-clause summary is the better default — it was produced alongside the
  // analysis, not paraphrased after the fact).
  useEffect(() => {
    if (!isOpen || summaryRequested.current || userEditedSummary || initialSummary) return;
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
      // #112 — no skeleton downgrade: when the session executed in the signed
      // sandbox, carry the EXECUTED notebook verbatim (it embeds the
      // `org.civicaitools.execution` extension and the Q31
      // `notebookProvenance: "executed"` discriminator in its own metadata).
      // Only chat-flow sessions, which never had an executed artifact,
      // generate the skeleton notebook (`notebookProvenance: "skeleton"`
      // semantics per Q31).
      const notebook = executedNotebook ?? generateNotebook(queryText, portal, toolCalls, output);

      // captureMethod (ADR-0003/0011) is `chat-flow-stream` for BOTH paths
      // through this dialog: the platform captured the model's bytes at the
      // wire layer — streamed to the browser (chat flow) or to the server
      // (notebook mode's Phase A). The vocabulary is fixed per ADR-0011;
      // executed-vs-skeleton is the ORTHOGONAL notebookProvenance axis (Q31),
      // carried inside the notebook extension, not a captureMethod value.
      //
      // contentProfile (ADR-0004) is `datHere` when the user opted into
      // full-text prompt visibility: the chat-flow capture has all the
      // inputs the A-G envelope requires (full prompt text, system prompt,
      // output, trace, notebook, summary), so the package is published as
      // a datHere-content-profile envelope. The packager auto-adds the
      // `org.civicaitools.environment` extension and promotes `summary`
      // into canonical JSON. For `hash_only` prompts the contentProfile
      // falls back to default (OES §9.1.1 requires full_text); the package
      // retains its existing shape (summary stays DB-only).
      const contentProfile = promptVisibility === 'full_text' ? 'datHere' : 'default';

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
          captureMethod: 'chat-flow-stream',
          contentProfile,
          visibility,
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
      // `url` is absent for committed-visibility responses; the slug-derived
      // page is creator-only until the record is published.
      setResultUrl(data.url ?? `/evidence/${data.slug}`);
      // Read-side normalization only (ADR-0016 §A): the response may carry
      // either vocabulary. The local state union and the request value it sends
      // stay on the legacy labels in this phase.
      setResultVisibility(
        normalizeVisibility(data.visibility) === 'sealed' ? 'committed' : 'published',
      );
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

  // #86 (published path) — the highest-frequency post-publish intent is "let me
  // see what I just published", so it is the primary affordance: client-side
  // navigation to the evidence page (not an auto-redirect — the user chooses).
  const handleView = () => {
    router.push(resultUrl);
  };

  // #86 (published path) — "let me share this" without leaving: native share
  // sheet where available (mobile), clipboard + toast otherwise (desktop). A
  // dismissed share sheet is a no-op (no surprise copy). Only ever wired for a
  // PUBLISHED result — a committed record is private, so Share is meaningless.
  const handleShare = async () => {
    const fullUrl = `${window.location.origin}${resultUrl}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url: fullUrl });
      } catch {
        // User dismissed the share sheet (or it failed) — do nothing.
      }
      return;
    }
    await navigator.clipboard.writeText(fullUrl);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
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

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
                  Visibility
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === 'committed'}
                      onChange={() => setVisibility('committed')}
                      style={{ marginTop: '3px' }}
                    />
                    <span>
                      Commit (default)
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Signed, timestamped, and registered on the public transparency
                        log — but the content stays private to you. Publish later from
                        your dashboard.
                      </span>
                    </span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === 'published'}
                      onChange={() => setVisibility('published')}
                      style={{ marginTop: '3px' }}
                    />
                    <span>
                      Publish now
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Content becomes public and listed in the registry immediately.
                        Publication is not reversible.
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              {/* Unsigned-tier gate-off (ADR-0020, S3a P3): with no signing
                  key, neither Commit (sealed) nor Publish (public) is
                  reachable — the action renders disabled with an explanation,
                  mirroring the server-side gate. */}
              {signingConfigured === false && (
                <div style={{
                  padding: '12px',
                  marginBottom: '12px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(255, 179, 32, 0.12)',
                  border: '1px solid var(--nyc-caution, #FFB320)',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  color: 'var(--text-secondary)',
                }}>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    This instance is running unsigned.
                  </strong>{' '}
                  No signing key is configured, so evidence cannot be committed
                  or published — an unsigned package can reach neither the
                  sealed nor the public state. The analysis itself still works;
                  an operator enables signing via the instance setup guide.
                </div>
              )}

              <button
                onClick={handlePublish}
                disabled={!title.trim() || !summary.trim() || signingConfigured === false}
                style={{
                  width: '100%',
                  padding: '10px 20px',
                  backgroundColor: 'var(--nyc-blue)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: title.trim() && summary.trim() && signingConfigured !== false ? 'pointer' : 'not-allowed',
                  opacity: title.trim() && summary.trim() && signingConfigured !== false ? 1 : 0.5,
                }}
              >
                {signingConfigured === false
                  ? 'Unavailable (running unsigned)'
                  : visibility === 'committed' ? 'Commit' : 'Publish'}
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
                <span style={{ fontSize: '16px', fontWeight: 600 }}>
                  {resultVisibility === 'committed' ? 'Committed' : 'Published'}
                </span>
              </div>

              {resultVisibility === 'committed' ? (
                /* COMMITTED — a private record. Preserve the creator-only copy +
                   the URL box (the creator's own handle to open / re-open it);
                   no public "Share" affordance, because the content is private
                   and a shared link is meaningless to anyone else (#86). */
                <>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                    Your evidence is committed — signed and registered, content private to you.
                    Only you can open this page; publish it anytime from your dashboard:
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
                    The cryptographic commitment (hash, signature, timestamp, transparency-log
                    proof) is publicly verifiable; the content and this page are not.
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
                </>
              ) : (
                /* PUBLISHED — a public record. Two distinct affordances instead
                   of a raw URL to parse (#86): primary "View" (navigates) +
                   secondary "Share" (copy / native share). The raw URL stays
                   reachable via Share and the destination URL bar; closing the
                   dialog (header ×, backdrop, or "Keep chatting") returns to the
                   chat to continue. */
                <>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: '0 0 16px' }}>
                    Your evidence page is live.
                  </p>

                  <button
                    onClick={handleView}
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
                      marginBottom: '8px',
                    }}
                  >
                    View your evidence page →
                  </button>

                  <button
                    onClick={handleShare}
                    style={{
                      width: '100%',
                      padding: '10px 20px',
                      backgroundColor: 'white',
                      color: urlCopied ? 'var(--nyc-success)' : 'var(--text-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {urlCopied ? 'Link copied' : 'Share'}
                  </button>

                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '16px 0 0' }}>
                    The record is signed, timestamped, and registered on the public transparency log.
                  </p>

                  <button
                    onClick={handleClose}
                    style={{
                      width: '100%',
                      marginTop: '12px',
                      padding: '6px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Keep chatting
                  </button>
                </>
              )}
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
