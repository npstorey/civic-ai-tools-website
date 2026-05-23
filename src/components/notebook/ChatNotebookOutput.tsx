'use client';

/**
 * Phase 2a1 — chat-output renderer for executed-notebook responses.
 *
 * Renders sections A through G matching the evidence detail page layout for
 * datHere-content-profile packages (src/app/evidence/[slug]/page.tsx §A-G).
 * Each section is honest about pre-publish state: no slug yet, no
 * `EvidencePackage` row in the DB, no Rekor entry. Sections that would
 * normally pull from the package read from the in-flight notebook + the
 * useNotebookStream state instead.
 *
 * Sections:
 *   A · Initial prompt    — verbatim user input
 *   B · System prompts    — pre-publish stub describing the composed overlay
 *   C · Model + environment — model name, runtime, MCP servers
 *   D · Deliberative trace — Phase A tool calls (collapsed)
 *   E · Answer notebook   — NotebookSection (.ipynb download + cell preview)
 *   F · Rendered answer   — synthesis cell rendered as markdown (hero)
 *   G · Summary           — one-line blurb derived from synthesis
 *
 * Signers, attestations placeholder, and citation block are rendered by
 * sibling components composed at the bottom of this output.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatModelName } from '@/lib/models';
import NotebookSection from '@/components/evidence/NotebookSection';
import ChatSignersSection from './ChatSignersSection';
import ChatCitationPreview from './ChatCitationPreview';
import { buildChatEvidenceView } from './buildChatEvidenceView';
import type { Notebook } from '@/lib/notebook-author';
import type { CapturedToolCall } from '@/hooks/useNotebookStream';

interface ChatNotebookOutputProps {
  notebook: Notebook;
  prompt: string;
  model: string;
  portal: string;
  toolCalls: CapturedToolCall[];
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

function formatHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Derive an MCP-server-host string from the portal value the user picked.
 *  Phase 1 always uses the Socrata MCP server for `data.cityofnewyork.us`
 *  and similar portals. This is a chat-time approximation; on publish, the
 *  evidence package carries the real `org.civicaitools.environment.mcpServers`. */
function approximateMcpServers(portal: string): string[] {
  const servers: string[] = [];
  if (portal && portal !== '__all__') {
    servers.push(formatHost(process.env.NEXT_PUBLIC_SOCRATA_MCP_URL || 'https://socrata-mcp.civicaitools.org'));
  }
  return servers;
}

export default function ChatNotebookOutput({
  notebook,
  prompt,
  model,
  portal,
  toolCalls,
  title,
}: ChatNotebookOutputProps) {
  const view = buildChatEvidenceView({ notebook, prompt, model, portal, toolCalls });
  const mcpServers = approximateMcpServers(portal);
  const portalLabel = portal && portal !== '__all__' ? portal : 'all portals';

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
          padding: '16px 20px', backgroundColor: 'rgba(16, 63, 239, 0.04)',
          borderLeft: '3px solid var(--nyc-blue)', borderRadius: '0 4px 4px 0',
          fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
        }}>
          {view.prompt}
        </div>
      </Section>

      {/* B · System prompts (pre-publish stub) */}
      <Section title="B · System prompts">
        <div style={{
          padding: '12px 16px', border: '1px solid var(--border-color)', borderRadius: '6px',
          fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6,
        }}>
          The system prompt is composed from the base civic-data skill
          guidance plus the web overlay (and any portal-specific overlays).
          Its content hash is captured at execution time and embedded in the
          evidence package when this analysis is published. Full text is
          available on the detail page once published.
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
        <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
          Re-executing this notebook against the documented runtime + stable
          upstream data reproduces section F (OES §9.1.3). The notebook
          metadata records the sandbox runtime versions used at execution.
        </div>
        <NotebookSection notebook={view.notebook} slug={placeholderSlug} />
      </Section>

      {/* F · Rendered answer — hero */}
      <Section title="F · Rendered answer">
        <div style={{
          padding: '16px 20px', border: '1px solid var(--border-color)',
          borderRadius: '6px', backgroundColor: 'white',
          fontSize: '15px', lineHeight: 1.6, color: 'var(--text-primary)',
        }}>
          {view.synthesisMarkdown ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{view.synthesisMarkdown}</ReactMarkdown>
          ) : (
            <em style={{ color: 'var(--text-muted)' }}>
              No synthesis was produced for this analysis.
            </em>
          )}
        </div>
      </Section>

      {/* G · Summary */}
      <Section title="G · Summary">
        <div style={{
          padding: '12px 16px', backgroundColor: 'rgba(16, 63, 239, 0.04)',
          borderLeft: '3px solid var(--nyc-blue)', borderRadius: '0 4px 4px 0',
          fontSize: '14px', lineHeight: 1.6, color: 'var(--text-secondary)',
        }}>
          {view.summary || (
            <em style={{ color: 'var(--text-muted)' }}>
              Summary will be generated at publish time.
            </em>
          )}
        </div>
      </Section>

      {/* Signers + attestations + citation — sibling sections beneath G */}
      <ChatSignersSection executedAt={view.executedAt} />
      <ChatCitationPreview prompt={view.prompt} executedAt={view.executedAt} />
    </div>
  );
}
