'use client';

/**
 * Phase 2a1 — chat-output renderer for executed-notebook responses.
 * Phase 2a2 refinements layered in:
 *   - Item 1: Section B now surfaces the composed system prompt inline
 *             behind a disclosure; SHA-256 hash (truncated) is visible.
 *   - Item 2: Section F renders the rendering code cell's outputs verbatim
 *             (markdown via display_data, tables via DataFrame outputs,
 *             plain text via stream). Legacy notebooks (no synthesis-role
 *             code cell) fall back to ReactMarkdown over the legacy
 *             `## Synthesis` markdown body.
 *   - Item 3: Section G renders the structured two-clause summary from
 *             notebook root metadata; falls back to a one-line derived
 *             summary when the structured field is absent.
 *   - Item 4: Signers/citation handed the active platform key id so the
 *             pre-publish framing is honest (handled in the sibling
 *             ChatSignersSection component).
 *
 * Each section is honest about pre-publish state: no slug yet, no
 * `EvidencePackage` row in the DB, no Rekor entry.
 *
 * Sections:
 *   A · Initial prompt    — verbatim user input
 *   B · System prompts    — inline composed prompt behind disclosure
 *   C · Model + environment — model name, runtime, MCP servers
 *   D · Deliberative trace — Phase A tool calls (collapsed)
 *   E · Answer notebook   — NotebookSection (.ipynb download + cell preview)
 *   F · Rendered answer   — outputs of the rendering code cell (hero)
 *   G · Summary           — structured two-clause blurb
 *
 * Signers, attestations placeholder, and citation block are rendered by
 * sibling components composed at the bottom of this output.
 */
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatModelName } from '@/lib/models';
import NotebookSection from '@/components/evidence/NotebookSection';
import ChatSignersSection from './ChatSignersSection';
import ChatCitationPreview from './ChatCitationPreview';
import RenderingCellOutputs from './RenderingCellOutputs';
import { approximateMcpServers, buildChatEvidenceView } from './buildChatEvidenceView';
import { useSocrataMcpUrl } from '@/components/McpRoutingProvider';
import type { Notebook } from '@/lib/notebook-author';
import { readReproductionClaim, reproductionScopeSentence } from '@/lib/notebook-author/reproduction-claim';
import type { CapturedToolCall } from '@/hooks/useNotebookStream';

interface ChatNotebookOutputProps {
  notebook: Notebook;
  prompt: string;
  model: string;
  portal: string;
  toolCalls: CapturedToolCall[];
  /** Phase 2a2 item 1: composed system prompt text streamed via SSE. */
  composedSystemPrompt?: string | null;
  composedSystemPromptHash?: string | null;
  /** Phase 2a2 item 4: active platform signing key id streamed via SSE. */
  signingKeyId?: string | null;
  /** Optional title — defaults to the prompt's first sentence/clause. */
  title?: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '32px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function ChatNotebookOutput({
  notebook,
  prompt,
  model,
  portal,
  toolCalls,
  composedSystemPrompt,
  composedSystemPromptHash,
  signingKeyId,
  title,
}: ChatNotebookOutputProps) {
  const view = buildChatEvidenceView({
    notebook,
    prompt,
    model,
    portal,
    toolCalls,
    composedSystemPrompt,
    composedSystemPromptHash,
    signingKeyId,
  });
  // #258 C5: the server-resolved SOCRATA_MCP_URL, threaded through
  // McpRoutingProvider — null (not configured) yields an empty list, and the
  // "MCP servers" row below is omitted rather than showing a fallback host.
  const socrataMcpUrl = useSocrataMcpUrl();
  const mcpServers = approximateMcpServers(portal, socrataMcpUrl);
  const portalLabel = portal && portal !== '__all__' ? portal : 'all portals';

  // Phase 2a2 item 1: compute line count once for the disclosure label.
  const composedPromptLineCount = useMemo(() => {
    if (!view.composedSystemPrompt) return 0;
    return view.composedSystemPrompt.split(/\r?\n/).length;
  }, [view.composedSystemPrompt]);

  // Slug is "(unpublished)" since the chat output is pre-publish. The
  // NotebookSection download filename uses this; we pick a slug-shaped
  // string that signals the pre-publish state honestly.
  const placeholderSlug = 'unpublished-chat-notebook';

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      {/* Pre-publish label row — mirrors the detail page's small label row
          ("Captured via Web chat · datHere content profile · …") but honest
          about not-yet-published state. */}
      <div style={{
        fontSize: '13px', color: 'var(--text-secondary)',
        marginBottom: '24px',
        display: 'flex', flexWrap: 'wrap', gap: '0 8px', alignItems: 'center',
      }}>
        <span>Captured via <strong>Web chat</strong></span>
        <span>·</span>
        <span>Executed in signed sandbox</span>
        <span>·</span>
        <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>not yet published</span>
      </div>

      {title && (
        <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '20px', lineHeight: 1.3 }}>
          {title}
        </h2>
      )}

      {/* A · Initial prompt */}
      <Section title="A · Initial prompt">
        <div style={{
          padding: '16px 20px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
          borderLeft: '3px solid var(--accent)', borderRadius: '0 4px 4px 0',
          fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
        }}>
          {view.prompt}
        </div>
      </Section>

      {/* B · System prompts (Phase 2a2 item 1: inline composed prompt + truncated hash) */}
      <Section title="B · System prompts">
        <div style={{
          padding: '12px 16px', border: '1px solid var(--border-color)', borderRadius: '6px',
          fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6,
        }}>
          <p style={{ margin: '0 0 10px' }}>
            The system prompt is composed from the base civic-data skill
            guidance plus the web overlay (and any portal-specific overlays).
            The content hash below is captured at execution time and embedded
            in the record package when this analysis is published.
          </p>
          {view.composedSystemPromptHash && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '6px 12px',
              alignItems: 'center', fontSize: '12px', color: 'var(--text-muted)',
              marginBottom: '8px',
            }}>
              <span>SHA-256:</span>
              <code
                title={view.composedSystemPromptHash}
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                  background: '#f5f5f5', padding: '1px 6px', borderRadius: '3px',
                }}
              >
                {view.composedSystemPromptHash.slice(0, 16)}…
              </code>
              <span style={{ fontStyle: 'italic' }}>
                (truncated; full hash is what the record package will sign)
              </span>
            </div>
          )}
          {view.composedSystemPrompt ? (
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: '13px', padding: '4px 0' }}>
                Show full system prompt ({composedPromptLineCount.toLocaleString()} lines)
              </summary>
              <pre style={{
                marginTop: '8px', padding: '12px 14px', background: '#f9f9f9',
                border: '1px solid var(--border-color)', borderRadius: '4px',
                fontSize: '12px', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                wordBreak: 'break-word', maxHeight: '420px', overflow: 'auto',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                color: 'var(--text-primary)',
              }}>
                {view.composedSystemPrompt}
              </pre>
            </details>
          ) : (
            <p style={{
              margin: 0, fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic',
            }}>
              Full text was not captured in this stream. (The route emits it as
              the first SSE event; if you opened this preview from a fixture
              or a cached page, the inline disclosure is unavailable.)
            </p>
          )}
        </div>
      </Section>

      {/* C · Model + environment */}
      <Section title="C · Model + environment">
        {(() => {
          const items: Array<{ label: string; value: React.ReactNode; mono?: boolean }> = [
            { label: 'Model', value: formatModelName(view.model) },
            { label: 'Data portal', value: portalLabel },
            ...(mcpServers.length > 0 ? [{
              label: 'MCP servers',
              value: mcpServers.join(', '),
            }] : []),
            ...(view.environment?.python ? [{
              label: 'Python runtime',
              value: view.environment.python,
            }] : []),
            ...(view.environment?.libraries
              ? Object.entries(view.environment.libraries).slice(0, 4).map(([name, version]) => ({
                  label: name,
                  value: version,
                  mono: true,
                }))
              : []),
            ...(view.executedAt ? [{
              label: 'Executed at',
              value: new Date(view.executedAt).toLocaleString(),
            }] : []),
            ...(view.executionDurationMs !== null && view.executionDurationMs !== undefined ? [{
              label: 'Sandbox duration',
              value: `${(view.executionDurationMs / 1000).toFixed(1)}s`,
            }] : []),
          ];
          return (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '12px',
            }}>
              {items.map((item) => (
                <div key={item.label} style={{
                  padding: '10px 14px', border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>
                    {item.label}
                  </div>
                  <div style={{
                    fontSize: item.mono ? '12px' : '14px',
                    color: item.mono ? 'var(--text-muted)' : 'var(--text-primary)',
                    fontWeight: 500,
                    fontFamily: item.mono ? 'monospace' : 'inherit',
                  }}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </Section>

      {/* D · Deliberative trace */}
      <Section title="D · Deliberative trace">
        {view.toolCalls.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No tool calls were captured for this analysis.
          </div>
        ) : (
          <details>
            <summary style={{
              cursor: 'pointer', fontSize: '13px',
              color: 'var(--text-secondary)', padding: '8px 0',
            }}>
              Show {view.toolCalls.length} tool {view.toolCalls.length === 1 ? 'call' : 'calls'}
            </summary>
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {view.toolCalls.map((q, i) => (
                <div key={i} style={{
                  padding: '10px 14px', border: '1px solid var(--border-color)',
                  borderRadius: '4px', fontSize: '13px',
                }}>
                  <div style={{ fontFamily: 'monospace', color: 'var(--text-primary)', marginBottom: '4px' }}>
                    {q.name}{q.operationType ? ` (${q.operationType})` : ''}
                  </div>
                  {q.reason && (
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      {q.reason}
                    </div>
                  )}
                  {q.resultSummary !== undefined && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Result: {q.resultSummary.rows} rows × {q.resultSummary.columns} cols
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </Section>

      {/* E · Answer notebook */}
      <Section title="E · Answer notebook">
        {/*
          The reproduction claim is CONDITIONAL, and the condition is in the
          notebook rather than here (#371). This line asserted flatly that
          re-executing the notebook reproduces section F, which is true only of
          the steps that re-run a live request — a notebook where three of four
          fetches were rejected got the same sentence. Then it said "the
          notebook states how many of them do", which a discovery-only notebook
          does not (#384 P8, F6). The sentence is now written by the one
          formatter that reads the claim off the cells, so it is true of a
          notebook that states a count and of one that states none.
        */}
        <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          {reproductionScopeSentence(readReproductionClaim(view.notebook.cells))}{' '}
          The notebook metadata records the sandbox runtime versions used at execution.
        </div>
        <NotebookSection notebook={view.notebook} slug={placeholderSlug} />
      </Section>

      {/* F · Rendered answer — hero (Phase 2a2 item 2: rendering code cell outputs) */}
      <Section title="F · Rendered answer">
        <div style={{
          padding: '16px 20px', border: '1px solid var(--border-color)',
          borderRadius: '6px', backgroundColor: 'white',
          fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)',
        }}>
          {view.renderingCellOutputs !== null ? (
            <RenderingCellOutputs outputs={view.renderingCellOutputs} />
          ) : view.synthesisMarkdown ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{view.synthesisMarkdown}</ReactMarkdown>
          ) : (
            <em style={{ color: 'var(--text-muted)' }}>
              No synthesis was produced for this analysis.
            </em>
          )}
        </div>
      </Section>

      {/* G · Summary (Phase 2a2 item 3: structured two-clause blurb) */}
      <Section title="G · Summary">
        <div style={{
          padding: '12px 16px', backgroundColor: 'rgba(var(--accent-rgb), 0.04)',
          borderLeft: '3px solid var(--accent)', borderRadius: '0 4px 4px 0',
          fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary)',
        }}>
          {view.structuredSummary ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Analysis:
                </span>{' '}
                {view.structuredSummary.analysisDescription}
              </div>
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  Headline finding:
                </span>{' '}
                {view.structuredSummary.headlineFinding}
              </div>
            </div>
          ) : view.derivedSummary ? (
            view.derivedSummary
          ) : (
            <em style={{ color: 'var(--text-muted)' }}>
              Summary will be generated at publish time.
            </em>
          )}
        </div>
      </Section>

      {/* Signers + attestations + citation — sibling sections beneath G */}
      <ChatSignersSection executedAt={view.executedAt} signingKeyId={view.signingKeyId} />
      <ChatCitationPreview
        prompt={view.prompt}
        executedAt={view.executedAt}
        structuredSummary={view.structuredSummary}
      />
    </div>
  );
}
